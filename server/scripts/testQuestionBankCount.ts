/**
 * Verifies that the Question Bank count shown in the UI is always a number and
 * is derived from the database — including the 0-question and missing-value
 * cases (Change 3).
 *
 * Runs against the live Supabase project, exactly as localhost and production
 * do, and compares the API response against a direct database count.
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { getQuestionBanks, getQuestionsForBank, isSupabaseConfigured } from '../services/supabaseQuestionBankService';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

/** Mirrors exactly what QuestionBankView renders for a row. */
function displayedCount(bank: { total_questions: number; total_units: number | null }): { questions: number; units: number } {
  return {
    questions: Number.isFinite(bank.total_questions) ? Math.max(0, Math.trunc(bank.total_questions)) : 0,
    units: Number.isFinite(bank.total_units as number) ? Math.max(0, Math.trunc(bank.total_units as number)) : 0
  };
}

async function main() {
  if (!isSupabaseConfigured()) {
    console.error('Supabase is not configured — cannot run the count verification.');
    process.exit(1);
  }

  console.log('=== 1) every listed bank has a real, non-null count from the database ===');
  const all = await getQuestionBanks();
  check(`listing is non-empty (${all.length} banks)`, all.length > 0);

  let mismatches = 0;
  for (const bank of all) {
    const rows = await getQuestionsForBank(bank.id);
    const shown = displayedCount(bank).questions;
    if (shown !== rows.length) {
      mismatches++;
      console.log(`   MISMATCH ${bank.subject_code}/${bank.academic_year}/${bank.department}: shown=${shown} db=${rows.length}`);
    }
  }
  check('API count equals the direct database count for every bank', mismatches === 0);

  console.log('\n=== 2) the value is always a number, never null/undefined/NaN ===');
  const badType = all.filter(
    (b) => typeof b.total_questions !== 'number' || !Number.isFinite(b.total_questions) || b.total_questions < 0
  );
  check('total_questions is a finite, non-negative number on every row', badType.length === 0);
  const badUnits = all.filter((b) => b.total_units !== null && !Number.isFinite(b.total_units as number));
  check('total_units is a finite number or null', badUnits.length === 0);

  console.log('\n=== 3) the UI display rules ===');
  check('0 questions renders as 0 (not blank)', displayedCount({ total_questions: 0, total_units: 5 }).questions === 0);
  check('null count renders as 0 (not blank)', displayedCount({ total_questions: null as any, total_units: 5 }).questions === 0);
  check('undefined count renders as 0', displayedCount({ total_questions: undefined as any, total_units: 5 }).questions === 0);
  check('NaN count renders as 0', displayedCount({ total_questions: NaN, total_units: 5 }).questions === 0);
  check('a real count passes through unchanged', displayedCount({ total_questions: 252, total_units: 5 }).questions === 252);
  check('null units renders as 0', displayedCount({ total_questions: 10, total_units: null }).units === 0);
  check('a fractional count is truncated to a whole number', displayedCount({ total_questions: 12.9, total_units: 5 }).questions === 12);

  console.log('\n=== 4) acceptance subject: 24CE501 / CIVIL / 2024-2028 ===');
  const scoped = await getQuestionBanks({ academicYear: '2024-2028', department: 'CIVIL', subjectCode: '24CE501' });
  check('the selection returns only 24CE501 / CIVIL / 2024-2028 banks', scoped.length > 0
    && scoped.every((b) => b.subject_code === '24CE501' && b.department === 'CIVIL' && b.academic_year === '2024-2028'));
  for (const bank of scoped) {
    const shown = displayedCount(bank);
    const rows = await getQuestionsForBank(bank.id);
    check(
      `${bank.subject_code} shows ${shown.questions} questions / ${shown.units} units (database: ${rows.length})`,
      shown.questions === rows.length
    );
    check(
      `  and every question of that bank is ${bank.subject_code} in that one bank`,
      rows.every((q: any) => q.subject_code === bank.subject_code && q.question_bank_id === bank.id)
    );
  }

  console.log('\n=== 5) the same subject code under a different department is a different source ===');
  const otherDept = await getQuestionBanks({ academicYear: '2024-2028', department: 'CSE', subjectCode: '24CE501' });
  check('24CE501 under CSE returns nothing (no mixing)', otherDept.length === 0);
  const otherYear = await getQuestionBanks({ academicYear: '2025-2029', department: 'CIVIL', subjectCode: '24CE501' });
  check('24CE501 under 2025-2029 returns nothing (no mixing)', otherYear.length === 0);
  const otherSubject = await getQuestionBanks({ academicYear: '2024-2028', department: 'CIVIL', subjectCode: '24CS303' });
  check('24CS303 under CIVIL returns nothing (no mixing)', otherSubject.length === 0);

  console.log('\n=== 6) generated (reduced) banks never appear in the Question Bank listing ===');
  check('no IAT_GENERATED bank is listed', all.every((b) => (b.bank_type || 'ORIGINAL') === 'ORIGINAL'));

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
