import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { getSupabaseClient } from '../services/supabaseQuestionBankService';

async function main() {
  const c = getSupabaseClient();
  const tables = [
    'generated_papers',
    'paper_set_tracking',
    'additional_paper_requests',
    'paper_request_notifications',
    'question_usage_history',
    'principal_paper_assignments'
  ];

  for (const t of tables) {
    const { data, error } = await c.from(t).select('*');
    console.log(`\n=== TABLE: ${t} (count: ${data?.length}) ===`);
    if (error) console.error('Error:', error.message);
    else if (data && data.length > 0) {
      console.log(JSON.stringify(data.slice(0, 10), null, 2));
    }
  }

  // Also check if any academic_year 2026-2027 dependencies exist
  console.log('\n=== Checking 2026-2027 references ===');
  const yrId = '0c2081dd-b50c-414e-8077-73beaa6597b3'; // 2026-2027
  for (const t of ['subjects', 'question_banks', 'questions', 'generated_papers', 'paper_set_tracking', 'additional_paper_requests']) {
    const { data: d1 } = await c.from(t).select('id').eq('academic_year_id', yrId);
    console.log(`${t}.academic_year_id = ${yrId}: count = ${d1?.length ?? 0}`);
  }
  for (const t of ['question_banks', 'generated_papers', 'paper_set_tracking']) {
    const { data: d2 } = await c.from(t).select('id').eq('academic_year', '2026-2027');
    console.log(`${t}.academic_year = '2026-2027': count = ${d2?.length ?? 0}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
