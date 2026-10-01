/**
 * Operations: purge generated question papers + remove academic year 2026-2027.
 *
 * Run with:  npx tsx server/scripts/purgeGeneratedPapersAndAcademicYear.ts
 *
 * Scope and guarantees
 * --------------------
 *  - DATA ONLY. No table is dropped, recreated or altered. No schema change.
 *  - Foreign-key constraints stay enabled and are never bypassed: dependent
 *    rows are removed strictly before their parents, so the database never
 *    raises a constraint error and nothing is silently orphaned.
 *  - Touched tables
 *      question_usage_history  (question selections / usage mappings of papers)
 *      generated_papers        (the generated paper records)
 *      paper_set_tracking      (generated set metadata)
 *      academic_years          (the single 2026-2027 row)
 *  - Untouched: subjects, question_banks (original + scrutinized/reduced),
 *    questions, departments, user_accounts, exam_pattern_configs,
 *    exam_set_limits, audit_logs, additional_paper_requests,
 *    paper_request_notifications, iat_generated_question_banks.
 *
 * The equivalent single-transaction SQL is documented in
 * supabase/purge_generated_papers_and_academic_year.sql
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseQuestionBankService';

const ACADEMIC_YEAR_TO_REMOVE = '2026-2027';

/** Tables that may hold an academic_year_id / academic_year reference. */
const YEAR_REFERENCE_TABLES: Array<{ table: string; idColumn?: string; labelColumn?: string }> = [
  { table: 'subjects', idColumn: 'academic_year_id', labelColumn: 'academic_year' },
  { table: 'question_banks', idColumn: 'academic_year_id', labelColumn: 'academic_year' },
  { table: 'questions', idColumn: 'academic_year_id', labelColumn: 'academic_year' },
  { table: 'generated_papers', idColumn: 'academic_year_id', labelColumn: 'academic_year' },
  { table: 'question_usage_history', idColumn: 'academic_year_id', labelColumn: 'academic_year' },
  { table: 'paper_set_tracking', idColumn: 'academic_year_id' },
  { table: 'additional_paper_requests', idColumn: 'academic_year_id' },
  { table: 'iat_generated_question_banks', idColumn: 'academic_year_id', labelColumn: 'academic_year' },
];

const log = (...args: any[]) => console.log(...args);
const section = (t: string) => log(`\n=== ${t} ===`);

/** PostgREST / Postgres code for "this column (or table) is not there". */
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /column .* does not exist/i.test(error.message || '');
}

/** Cached "does this table actually carry this column?" probe. */
const columnCache = new Map<string, boolean>();
async function hasColumn(client: any, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = columnCache.get(key);
  if (cached !== undefined) return cached;
  const { error } = await client.from(table).select(column).limit(1);
  const available = error == null;
  columnCache.set(key, available);
  return available;
}

async function countRows(client: any, table: string): Promise<number> {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function deleteAll(client: any, table: string, label: string): Promise<number> {
  const before = await countRows(client, table);
  if (before === 0) {
    log(`  - ${label}: already empty, nothing to delete`);
    return 0;
  }
  const { error } = await client.from(table).delete().not('id', 'is', null);
  if (error) throw new Error(`delete ${table}: ${error.message}`);
  const after = await countRows(client, table);
  log(`  - ${label}: deleted ${before} row(s), ${after} remaining`);
  return before;
}

async function main() {
  if (!isSupabaseConfigured()) {
    console.error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
  }
  const client = getSupabaseClient();

  // ---------------------------------------------------------------
  // PHASE 1 — remove every generated question paper
  // ---------------------------------------------------------------
  section('PHASE 1 — Generated Papers purge');

  const preflight = {
    question_usage_history: await countRows(client, 'question_usage_history'),
    generated_papers: await countRows(client, 'generated_papers'),
    paper_set_tracking: await countRows(client, 'paper_set_tracking'),
  };
  log('Pre-flight row counts:', JSON.stringify(preflight));

  const preserved = {
    subjects: await countRows(client, 'subjects'),
    question_banks: await countRows(client, 'question_banks'),
    questions: await countRows(client, 'questions'),
    departments: await countRows(client, 'departments'),
    academic_years: await countRows(client, 'academic_years'),
    iat_generated_question_banks: await countRows(client, 'iat_generated_question_banks'),
    additional_paper_requests: await countRows(client, 'additional_paper_requests'),
    paper_request_notifications: await countRows(client, 'paper_request_notifications'),
  };
  log('Records that MUST survive:', JSON.stringify(preserved));

  // Dependency order: question_usage_history.paper_id references
  // generated_papers.id, so usage mappings go first. paper_set_tracking
  // references subjects / additional_paper_requests only, so it is safe.
  await deleteAll(client, 'question_usage_history', 'Question usage / selection history');
  await deleteAll(client, 'generated_papers', 'Generated papers');
  await deleteAll(client, 'paper_set_tracking', 'Generated set tracking metadata');

  // ---------------------------------------------------------------
  // PHASE 2 — remove ONLY academic year 2026-2027
  // ---------------------------------------------------------------
  section(`PHASE 2 — Academic year ${ACADEMIC_YEAR_TO_REMOVE}`);

  const { data: years, error: yearsErr } = await client
    .from('academic_years')
    .select('*')
    .eq('year_label', ACADEMIC_YEAR_TO_REMOVE);
  if (yearsErr) throw new Error(`read academic_years: ${yearsErr.message}`);
  if (!years || years.length === 0) {
    log(`  - No academic_years row labelled "${ACADEMIC_YEAR_TO_REMOVE}" — nothing to do.`);
  }

  for (const year of years || []) {
    log(`  - Target id=${year.id} status=${year.status}`);

    // Foreign-key inspection before deleting anything. A table that does not
    // carry one of the reference columns simply cannot block the delete.
    const blockers: string[] = [];
    for (const ref of YEAR_REFERENCE_TABLES) {
      let total = 0;
      for (const [column, value] of [[ref.idColumn, year.id], [ref.labelColumn, ACADEMIC_YEAR_TO_REMOVE]] as const) {
        if (!column) continue;
        if (!(await hasColumn(client, ref.table, column))) continue;
        const r = await client.from(ref.table).select('*', { count: 'exact', head: true }).eq(column, value as string);
        if (r.error) {
          if (isMissingColumn(r.error)) continue;
          throw new Error(`inspect ${ref.table}.${column}: ${r.error.message}`);
        }
        total += r.count ?? 0;
      }
      if (total > 0) {
        blockers.push(`${ref.table}: ${total}`);
        log(`    ! referenced by ${ref.table} (${total} row(s))`);
      }
    }

    if (blockers.length > 0) {
      // Only generated-paper data may be cleaned up implicitly; anything else
      // (subjects, banks, questions) must be handled deliberately by an admin,
      // so stop instead of deleting master data.
      const safeToClear = blockers.filter((b) =>
        b.startsWith('generated_papers:') ||
        b.startsWith('question_usage_history:') ||
        b.startsWith('paper_set_tracking:')
      );
      const unsafe = blockers.filter((b) => !safeToClear.includes(b));
      if (unsafe.length > 0) {
        console.error(`  !! ABORT — ${ACADEMIC_YEAR_TO_REMOVE} is still referenced by master data: ${unsafe.join(', ')}`);
        console.error('     Remove those records first, then re-run this script.');
        process.exitCode = 1;
        continue;
      }
      await deleteAll(client, 'question_usage_history', 'Question usage / selection history');
      await deleteAll(client, 'generated_papers', 'Generated papers');
      await deleteAll(client, 'paper_set_tracking', 'Generated set tracking metadata');
    }

    const { error: delErr } = await client.from('academic_years').delete().eq('id', year.id);
    if (delErr) throw new Error(`delete academic_years: ${delErr.message}`);
    log(`  - Deleted academic_years row ${year.id}`);
  }

  // ---------------------------------------------------------------
  // VERIFICATION
  // ---------------------------------------------------------------
  section('VERIFICATION');
  const after = {
    question_usage_history: await countRows(client, 'question_usage_history'),
    generated_papers: await countRows(client, 'generated_papers'),
    paper_set_tracking: await countRows(client, 'paper_set_tracking'),
    subjects: await countRows(client, 'subjects'),
    question_banks: await countRows(client, 'question_banks'),
    questions: await countRows(client, 'questions'),
    departments: await countRows(client, 'departments'),
    academic_years: await countRows(client, 'academic_years'),
    iat_generated_question_banks: await countRows(client, 'iat_generated_question_banks'),
  };
  log(JSON.stringify(after, null, 1));

  const { data: remainingYears } = await client.from('academic_years').select('year_label, status').order('year_label');
  log('Remaining academic years:', (remainingYears || []).map((y: any) => `${y.year_label} (${y.status})`).join(', '));

  const failures: string[] = [];
  if (after.generated_papers !== 0) failures.push(`generated_papers = ${after.generated_papers}`);
  if (after.question_usage_history !== 0) failures.push(`question_usage_history = ${after.question_usage_history}`);
  if (after.paper_set_tracking !== 0) failures.push(`paper_set_tracking = ${after.paper_set_tracking}`);
  if ((remainingYears || []).some((y: any) => y.year_label === ACADEMIC_YEAR_TO_REMOVE)) {
    failures.push(`academic year ${ACADEMIC_YEAR_TO_REMOVE} still present`);
  }
  for (const key of ['subjects', 'question_banks', 'questions', 'departments', 'iat_generated_question_banks'] as const) {
    if (after[key] !== preserved[key]) failures.push(`${key} changed: ${preserved[key]} -> ${after[key]}`);
  }

  if (failures.length > 0) {
    console.error('\nVERIFICATION FAILED:\n  - ' + failures.join('\n  - '));
    process.exitCode = 1;
    return;
  }
  log('\nOK — generated papers purged and the target academic year removed. Master data intact.');
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });