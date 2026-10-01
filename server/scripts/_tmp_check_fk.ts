import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { getSupabaseClient } from '../services/supabaseQuestionBankService';

async function main() {
  const c = getSupabaseClient();
  
  // Let's test what tables reference subjects
  const testSubId = 'c66d3a5b-dcb9-4fc1-9568-971740d9290a';
  for (const t of ['question_banks', 'questions', 'iat_generated_question_banks', 'generated_papers', 'paper_set_tracking', 'additional_paper_requests']) {
    try {
      const { count, error } = await c.from(t).select('*', { count: 'exact', head: true }).eq('subject_id', testSubId);
      console.log(`FK test ${t}.subject_id: count=${count}, err=${error?.message || 'none'}`);
    } catch (e: any) {
      console.log(`FK test ${t}.subject_id: err=${e.message}`);
    }
  }

  // Let's check a subject that has NO dependencies
  const freeSub = '26f5575d-55fa-4633-8745-bf86b3738ee7'; // 24AD301 DATA SCIENCE
  for (const t of ['question_banks', 'questions', 'iat_generated_question_banks', 'generated_papers', 'paper_set_tracking', 'additional_paper_requests']) {
    try {
      const { count, error } = await c.from(t).select('*', { count: 'exact', head: true }).eq('subject_id', freeSub);
      console.log(`Free sub ${t}.subject_id: count=${count}`);
    } catch (e: any) {}
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
