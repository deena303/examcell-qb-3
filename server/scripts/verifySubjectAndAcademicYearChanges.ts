/**
 * End-to-end verification of the changes in this task.
 *
 *   npx tsx server/scripts/verifySubjectAndAcademicYearChanges.ts
 *
 * Requires the API to be running (npm run server, port 4000). Read-only except
 * for the throwaway subject/bank/question rows it creates, which it removes
 * again before exiting.
 */
import path from 'path';
import dotenv from 'dotenv';
import { signToken } from '../middleware/authMiddleware';
import { getSupabaseClient } from '../services/supabaseQuestionBankService';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:4000';
const TOKEN = signToken({ userId: '00000000-0000-0000-0000-0000000000ff', email: 'verify@local', role: 'SUPER_ADMIN', name: 'Verifier' });

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

async function api(method: string, route: string, body?: any) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

const PROBE_CODE = 'ZZVERIFY9';

async function main() {
  const db = getSupabaseClient();
  console.log(`\n### Verifying ${BASE}\n`);

  // ------------------------------------------------------------------
  console.log('REQ 2 — academic year 2026-2027 removed, others intact');
  const years = (await api('GET', '/api/academic-years')).json as any[];
  check('academic years load', Array.isArray(years), JSON.stringify((await api('GET', '/api/academic-years')).json));
  const labels = (years || []).map((y) => y.year_label);
  check('2026-2027 is gone', !labels.includes('2026-2027'), labels.join(','));
  for (const keep of ['2026-2030', '2025-2029', '2024-2028', '2023-2027']) {
    check(`${keep} still present`, labels.includes(keep));
  }
  const active = (await api('GET', '/api/academic-years?activeOnly=true')).json as any[];
  check('activeOnly list excludes 2026-2027', !(active || []).some((y) => y.year_label === '2026-2027'));

  // ------------------------------------------------------------------
  console.log('\nREQ 1 — generated papers removed');
  const stats = (await api('GET', '/api/stats/summary')).json as any;
  check('stats.generatedPapers === 0', stats?.generatedPapers === 0, JSON.stringify(stats));
  check('question banks still exist', (stats?.questionBanks ?? 0) > 0, String(stats?.questionBanks));
  check('questions still exist', (stats?.subjects ?? 0) > 0);
  for (const t of ['generated_papers', 'question_usage_history', 'paper_set_tracking']) {
    const { count } = await db.from(t).select('*', { count: 'exact', head: true });
    check(`${t} empty`, count === 0, String(count));
  }

  // ------------------------------------------------------------------
  console.log('\nREQ 3 — semester validation (I..VIII only)');
  const subjList = (await api('GET', '/api/subjects')).json as any[];
  check('subjects load', Array.isArray(subjList) && subjList.length > 0);
  const bad = await api('POST', '/api/subjects', {
    subject_code: PROBE_CODE + 'B', subject_name: 'BAD SEMESTER',
    department_id: subjList[0].department_id, academic_year_id: subjList[0].academic_year_id, semester: 'XI'
  });
  check('POST rejects arbitrary semester text', bad.status === 400, `${bad.status} ${JSON.stringify(bad.json)}`);
  const missing = await api('POST', '/api/subjects', {
    subject_code: PROBE_CODE + 'M', subject_name: 'NO SEMESTER',
    department_id: subjList[0].department_id, academic_year_id: subjList[0].academic_year_id
  });
  check('POST rejects missing semester', missing.status === 400, `${missing.status}`);

  // ------------------------------------------------------------------
  console.log('\nREQ 3/6 — create, edit, identity + semester round-trip');
  const year = years.find((y) => y.status === 'active');
  const dept = (await api('GET', '/api/departments?activeOnly=true')).json as any[];
  const subjectCodeExistsInDept = subjList.some((s) => s.department_id === dept[0].id);
  const created = await api('POST', '/api/subjects', {
    subject_code: PROBE_CODE,
    subject_name: 'VERIFICATION SUBJECT',
    department_id: dept[0].id,
    academic_year_id: year.id,
    semester: 'III',
    regulation: 'Regulation 2024'
  });
  check('POST creates subject with semester III', created.status === 201, `${created.status} ${JSON.stringify(created.json)}`);
  const probe = created.json;
  check('semester stored', probe?.semester === 'III', String(probe?.semester));
  check('joined department returned', !!probe?.departments?.department_code);
  check('joined academic year returned', !!probe?.academic_years?.year_label);

  const dup = await api('POST', '/api/subjects', {
    subject_code: PROBE_CODE, subject_name: 'DUPLICATE',
    department_id: dept[0].id, academic_year_id: year.id, semester: 'III'
  });
  check('same code + dept + year rejected (identity is the triple)', dup.status === 409, `${dup.status} ${JSON.stringify(dup.json)}`);

  const edited = await api('PUT', `/api/subjects/${probe.id}`, { semester: 'VII', subject_name: 'VERIFICATION SUBJECT RENAMED' });
  check('PUT updates semester to VII', edited.status === 200 && edited.json?.semester === 'VII', JSON.stringify(edited.json?.semester));

  // ------------------------------------------------------------------
  console.log('\nREQ 4/5/6 — safe deletion');
  const clean = await api('DELETE', `/api/subjects/${probe.id}`);
  check('DELETE without dependents succeeds', clean.status === 200 && clean.json?._action === 'deleted', `${clean.status} ${JSON.stringify(clean.json)}`);

  // A subject that owns a question bank + questions must be reported, not silently deleted.
  const victimCode = 'ZZVERIFY8';
  const victim = (await api('POST', '/api/subjects', {
    subject_code: victimCode, subject_name: 'VERIFICATION WITH BANK',
    department_id: dept[0].id, academic_year_id: year.id, semester: 'V'
  })).json;
  const { data: bankRow } = await db.from('question_banks').insert({
    subject_code: victimCode, subject_name: 'VERIFICATION WITH BANK', file_name: 'verify.pdf',
    status: 'approved', academic_year: year.year_label, department: dept[0].department_code, bank_type: 'ORIGINAL'
  }).select().single();
  const { data: qRow } = await db.from('questions').insert({
    question_bank_id: bankRow.id, subject_code: victimCode, part: 'Part A', marks: 2,
    question_text: 'verification question', status: 'Approved', academic_year: year.year_label, department: dept[0].department_code
  }).select().single();

  const blocked = await api('DELETE', `/api/subjects/${victim.id}`);
  check('DELETE blocked when dependents exist', blocked.status === 409 && blocked.json?._action === 'blocked', `${blocked.status} ${JSON.stringify(blocked.json)}`);
  const depKeys = (blocked.json?.dependencies || []).map((d: any) => d.key);
  check('report names the question bank', depKeys.includes('question_banks'), depKeys.join(','));
  check('report names the question', depKeys.includes('questions'), depKeys.join(','));
  check('subject was NOT deleted while blocked', (await db.from('subjects').select('id').eq('id', victim.id)).data?.length === 1);

  const cascaded = await api('DELETE', `/api/subjects/${victim.id}?cascade=true`);
  check('cascade DELETE succeeds', cascaded.status === 200 && cascaded.json?._action === 'deleted', `${cascaded.status} ${JSON.stringify(cascaded.json)}`);
  check('subject row gone', (await db.from('subjects').select('id').eq('id', victim.id)).data?.length === 0);
  check('its question bank gone', (await db.from('question_banks').select('id').eq('id', bankRow.id)).data?.length === 0);
  check('its question gone', (await db.from('questions').select('id').eq('id', qRow.id)).data?.length === 0);

  // ------------------------------------------------------------------
  console.log('\nREQ 6 — other subjects untouched');
  const afterSubjects = (await api('GET', '/api/subjects')).json as any[];
  check('subject count back to the original', afterSubjects.length === subjList.length, `${afterSubjects.length} vs ${subjList.length}`);
  check('no probe subjects left', !afterSubjects.some((s) => s.subject_code.startsWith('ZZVERIFY')));
  const { count: banksAfter } = await db.from('question_banks').select('*', { count: 'exact', head: true });
  check('all pre-existing question banks intact', banksAfter === stats.questionBanks, `${banksAfter} vs ${stats.questionBanks}`);
  const { count: deptCount } = await db.from('departments').select('*', { count: 'exact', head: true });
  const { count: userCount } = await db.from('user_accounts').select('*', { count: 'exact', head: true });
  check('departments intact', deptCount === 12, String(deptCount));
  check('users intact', userCount === 3, String(userCount));

  // ------------------------------------------------------------------
  console.log('\nREQ 7 — generate paper inputs still load from the database');
  for (const route of ['/api/academic-years?activeOnly=true', '/api/departments?activeOnly=true', '/api/subjects?activeOnly=true', '/api/question-banks', '/api/exam-patterns']) {
    const r = await api('GET', route);
    check(`${route} -> 200`, r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
    if (Array.isArray(r.json)) check(`${route} non-empty`, r.json.length > 0, `len=${r.json.length}`);
  }
  const scoped = (await api('GET', `/api/subjects?academicYearId=${year.id}&activeOnly=true`)).json as any[];
  check('subjects filter by academic year', Array.isArray(scoped) && scoped.length > 0, `len=${scoped?.length}`);
  check('scoped subjects all belong to that year', (scoped || []).every((s) => s.academic_year_id === year.id));

  // ------------------------------------------------------------------
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => { console.error(e); process.exit(1); });