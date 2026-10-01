/**
 * Audit Log role separation (Exam Cell vs Super Admin).
 *
 * Verifies the FULL path — frontend contract -> API -> Supabase query ->
 * response — against the running backend, exactly as localhost and the deployed
 * build do.
 *
 * Start the server first:
 *   npx tsx server/index.ts            (or set PORT and adjust BASE below)
 *   npx tsx server/scripts/testAuditLogRoleSeparation.ts
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseQuestionBankService';

const BASE = process.env.AUDIT_TEST_BASE || `http://127.0.0.1:${process.env.PORT || 4000}/api`;

const ACCOUNTS = {
  EXAM_CELL: { email: 'examcell@msajce-edu.in', password: 'Msajce@1234' },
  SUPER_ADMIN: { email: 'superadmin@examcell-edu.in', password: 'Admin@123' },
  PRINCIPAL: { email: 'principal@msajce-edu.in', password: 'Principal@1234' }
} as const;

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

async function login(email: string, password: string): Promise<{ token: string; role: string }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data: any = await res.json();
  if (!res.ok || !data.token) throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  return { token: data.token, role: data.user.role };
}

async function getAuditLogs(token: string, query = ''): Promise<{ status: number; rows: any[]; error?: string }> {
  const res = await fetch(`${BASE}/audit-logs${query}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  let rows: any[] = [];
  let error: string | undefined;
  try {
    const data: any = await res.json();
    rows = Array.isArray(data) ? data : [];
    if (!Array.isArray(data)) error = data?.error;
  } catch {
    error = 'non-JSON response';
  }
  return { status: res.status, rows, error };
}

const rolesIn = (rows: any[]) => [...new Set(rows.map((r) => String(r.role || '').toUpperCase()))].sort();

async function main() {
  if (!isSupabaseConfigured()) {
    console.error('Supabase is not configured.');
    process.exit(1);
  }

  const client = getSupabaseClient();
  const { count: totalRows } = await client.from('audit_logs').select('id', { count: 'exact', head: true });
  const { data: allRows } = await client.from('audit_logs').select('role');
  const dbRoleCounts = new Map<string, number>();
  for (const r of allRows || []) {
    const k = String(r.role).toUpperCase();
    dbRoleCounts.set(k, (dbRoleCounts.get(k) || 0) + 1);
  }

  console.log('=== DATABASE (unchanged, shared table) ===');
  console.log(`  total audit_logs rows      : ${totalRows}`);
  console.log(`  rows by role               : ${JSON.stringify([...dbRoleCounts.entries()].sort())}`);

  console.log('\n=== health ===');
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  check(`server is up (status=${health.status})`, health.status === 'ok' || health.status === 'degraded');

  const ec = await login(ACCOUNTS.EXAM_CELL.email, ACCOUNTS.EXAM_CELL.password);
  const sa = await login(ACCOUNTS.SUPER_ADMIN.email, ACCOUNTS.SUPER_ADMIN.password);
  console.log(`  logged in: EXAM_CELL=${ec.role}, SUPER_ADMIN=${sa.role}`);
  check('EXAM_CELL token carries role EXAM_CELL', ec.role === 'EXAM_CELL');
  check('SUPER_ADMIN token carries role SUPER_ADMIN', sa.role === 'SUPER_ADMIN');

  // ---------------------------------------------------------------- TEST 1
  console.log('\n=== TEST 1: SUPER_ADMIN sees only SUPER_ADMIN logs ===');
  const saRes = await getAuditLogs(sa.token);
  console.log(`  HTTP ${saRes.status}, ${saRes.rows.length} row(s), roles present: ${JSON.stringify(rolesIn(saRes.rows))}`);
  check('responds 200', saRes.status === 200);
  check('ZERO EXAM_CELL rows returned', rolesIn(saRes.rows).every((r) => r !== 'EXAM_CELL'));
  check('every row is role = SUPER_ADMIN', rolesIn(saRes.rows).length === 1 && rolesIn(saRes.rows)[0] === 'SUPER_ADMIN');
  check('rows are actually returned (data exists)', saRes.rows.length > 0);
  check('no superadmin email appears in an EXAM_CELL row', !saRes.rows.some((r) => String(r.role).toUpperCase() === 'EXAM_CELL'));

  // ---------------------------------------------------------------- TEST 2
  console.log('\n=== TEST 2: EXAM_CELL sees only EXAM_CELL logs (new session) ===');
  const ecRes = await getAuditLogs(ec.token);
  console.log(`  HTTP ${ecRes.status}, ${ecRes.rows.length} row(s), roles present: ${JSON.stringify(rolesIn(ecRes.rows))}`);
  check('responds 200', ecRes.status === 200);
  check('ZERO SUPER_ADMIN rows returned', !rolesIn(ecRes.rows).includes('SUPER_ADMIN'));
  check('every row is role = EXAM_CELL', rolesIn(ecRes.rows).length === 1 && rolesIn(ecRes.rows)[0] === 'EXAM_CELL');
  check('no superadmin account appears anywhere in the response',
    !JSON.stringify(ecRes.rows).toLowerCase().includes('superadmin@'));
  check('rows are actually returned (data exists)', ecRes.rows.length > 0);

  // ---------------------------------------------------------------- TEST 3
  console.log('\n=== TEST 3: EXAM_CELL repeated / refreshed reads stay scoped ===');
  for (const round of [1, 2, 3]) {
    const r = await getAuditLogs(ec.token, `?limit=${round * 25}`);
    check(`refresh #${round} (limit=${round * 25}) is EXAM_CELL only`,
      r.status === 200 && r.rows.every((x) => String(x.role).toUpperCase() === 'EXAM_CELL'));
  }

  // ---------------------------------------------------------------- TEST 4
  console.log('\n=== TEST 4: search, action and status filters keep the role scope ===');
  const scopedQueries = [
    '?search=examcell',
    '?action=LOGIN',
    '?status=SUCCESS',
    '?action=LOGIN&status=SUCCESS&search=a',
    '?limit=5&offset=0'
  ];
  for (const q of scopedQueries) {
    const r = await getAuditLogs(ec.token, q);
    check(`${q.padEnd(42)} -> 200, EXAM_CELL only, ${r.rows.length} row(s)`,
      r.status === 200 && r.rows.length > 0 && r.rows.every((x) => String(x.role).toUpperCase() === 'EXAM_CELL'));
  }
  // A search term that matches nothing must return nothing — still role-scoped.
  const noMatch = await getAuditLogs(ec.token, '?search=zzzz-no-such-user-zzzz');
  check('a search matching nothing returns 0 rows (not the other role)',
    noMatch.status === 200 && noMatch.rows.length === 0);

  // ---------------------------------------------------------------- TEST 5
  console.log('\n=== TEST 5: the frontend CANNOT widen the scope with ?role= ===');
  const escalate1 = await getAuditLogs(ec.token, '?role=SUPER_ADMIN');
  check('EXAM_CELL asking for ?role=SUPER_ADMIN -> 403', escalate1.status === 403);
  check('  and the body carries no audit rows', escalate1.rows.length === 0);
  const escalate2 = await getAuditLogs(ec.token, '?role=exAm_CeLl');
  check('EXAM_CELL asking for ?role=exAm_CeLl (own role) -> 200', escalate2.status === 200);
  check('  and every row is EXAM_CELL', escalate2.rows.every((x) => String(x.role).toUpperCase() === 'EXAM_CELL'));
  const escalate3 = await getAuditLogs(sa.token, '?role=EXAM_CELL');
  check('SUPER_ADMIN asking for ?role=EXAM_CELL -> 403', escalate3.status === 403);
  const escalate4 = await getAuditLogs(ec.token, '?role=PRINCIPAL');
  check('EXAM_CELL asking for ?role=PRINCIPAL -> 403', escalate4.status === 403);

  // ---------------------------------------------------------------- TEST 6
  console.log('\n=== TEST 6: other roles are denied outright ===');
  const pr = await login(ACCOUNTS.PRINCIPAL.email, ACCOUNTS.PRINCIPAL.password);
  const prRes = await getAuditLogs(pr.token);
  check('PRINCIPAL reading audit logs -> 403', prRes.status === 403);
  check('  and the body carries no audit rows', prRes.rows.length === 0);

  const anon = await getAuditLogs('not-a-real-token');
  check('invalid/absent token -> 401', anon.status === 401);

  // ---------------------------------------------------------------- TEST 6b
  console.log('\n=== TEST 6b: a row cannot be forged with the other role ===');
  const FORGED_ACTION = 'ZZ_FORGED_TEST';
  const forged = await fetch(`${BASE}/audit-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ec.token}` },
    body: JSON.stringify({
      user_email: 'superadmin@examcell-edu.in',   // must be overridden too
      user_name: 'ZZ Forged',
      role: 'SUPER_ADMIN',                        // must be ignored
      action: FORGED_ACTION,
      status: 'SUCCESS'
    })
  });
  const forgedBody: any = await forged.json().catch(() => ({}));
  check('EXAM_CELL POST is accepted (endpoint still works)', forged.status === 201);

  // Verify the persisted row directly in the shared table.
  const { data: forgedRows } = await client
    .from('audit_logs')
    .select('id, role, action, user_email')
    .eq('action', FORGED_ACTION);
  const forgedRow = (forgedRows || [])[0];
  check('the row was written', !!forgedRow);
  check('  role is the session role (EXAM_CELL), not the posted SUPER_ADMIN',
    String(forgedRow?.role || '').toUpperCase() === 'EXAM_CELL');
  check('  user_email is the session email, not the posted one',
    String(forgedRow?.user_email || '').toLowerCase() === ACCOUNTS.EXAM_CELL.email);

  const saPoison = await getAuditLogs(sa.token, `?search=${encodeURIComponent(FORGED_ACTION)}`);
  check('  the forged row does NOT appear in the Super Admin log', saPoison.rows.length === 0);
  const ecRows = await getAuditLogs(ec.token, '?limit=1000');
  check('  the forged row DOES appear in the Exam Cell log',
    ecRows.rows.some((r) => r.action === FORGED_ACTION && String(r.role).toUpperCase() === 'EXAM_CELL'));

  const unauthPost = await fetch(`${BASE}/audit-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_email: 'x@y.z', role: 'SUPER_ADMIN', action: 'ZZ_ANON', status: 'SUCCESS' })
  });
  check('unauthenticated POST -> 401', unauthPost.status === 401);

  // ---------------------------------------------------------------- TEST 7
  console.log('\n=== TEST 7: no existing audit data was deleted ===');
  const { count: totalAfter } = await client.from('audit_logs').select('id', { count: 'exact', head: true });
  const { data: afterRows } = await client.from('audit_logs').select('role');
  const afterCounts = new Map<string, number>();
  for (const r of afterRows || []) {
    const k = String(r.role).toUpperCase();
    afterCounts.set(k, (afterCounts.get(k) || 0) + 1);
  }
  console.log(`  rows by role after the run: ${JSON.stringify([...afterCounts.entries()].sort())}`);
  check('row count only grew (new logins written during the test), never shrank',
    (totalAfter ?? 0) >= (totalRows ?? 0));
  for (const role of ['EXAM_CELL', 'SUPER_ADMIN', 'PRINCIPAL', 'UNKNOWN', 'SYSTEM']) {
    check(`  historical ${role} rows are all still present`,
      (afterCounts.get(role) || 0) >= (dbRoleCounts.get(role) || 0));
  }
  check('both roles are still visible in the shared table',
    (afterCounts.get('EXAM_CELL') || 0) > 0 && (afterCounts.get('SUPER_ADMIN') || 0) > 0);

  // ---------------------------------------------------------------- cleanup
  // Remove ONLY the row this test forged. No historical audit data is touched.
  const { data: toDelete } = await client.from('audit_logs').select('id').eq('action', FORGED_ACTION);
  if ((toDelete || []).length > 0) {
    const { error: delErr } = await client
      .from('audit_logs')
      .delete()
      .in('id', (toDelete || []).map((r: any) => r.id));
    check(`test-forged row removed again (${(toDelete || []).length}); no historical data touched`, !delErr);
  }

  // ---------------------------------------------------------------- summary
  console.log('\n=== FINAL VISIBILITY SUMMARY ===');
  console.log(`  EXAM_CELL API response  -> ${JSON.stringify(rolesIn(ecRes.rows))}  (${ecRes.rows.length} rows)`);
  console.log(`  SUPER_ADMIN API response-> ${JSON.stringify(rolesIn(saRes.rows))}  (${saRes.rows.length} rows)`);
  check('the two portals receive disjoint role sets',
    !rolesIn(ecRes.rows).some((r) => rolesIn(saRes.rows).includes(r)));

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAILED:', e?.message || e); process.exit(1); });
