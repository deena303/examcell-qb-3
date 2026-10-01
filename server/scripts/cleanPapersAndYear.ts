import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { getSupabaseClient } from '../services/supabaseQuestionBankService';

async function main() {
  const c = getSupabaseClient();
  console.log('--- Step 1: Delete all generated paper records and dependent data ---');

  // Delete in foreign key order:
  // 1. paper_request_notifications (references additional_paper_requests)
  const { error: notifErr, count: notifCount } = await c
    .from('paper_request_notifications')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('Deleted paper_request_notifications:', notifErr ? notifErr.message : 'OK');

  // 2. principal_paper_assignments
  try {
    const { error: ppaErr } = await c
      .from('principal_paper_assignments')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    console.log('Deleted principal_paper_assignments:', ppaErr ? ppaErr.message : 'OK');
  } catch (e: any) {
    console.log('principal_paper_assignments delete error:', e.message);
  }

  // 3. additional_paper_requests
  const { error: aprErr } = await c
    .from('additional_paper_requests')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('Deleted additional_paper_requests:', aprErr ? aprErr.message : 'OK');

  // 4. paper_set_tracking
  const { error: pstErr } = await c
    .from('paper_set_tracking')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('Deleted paper_set_tracking:', pstErr ? pstErr.message : 'OK');

  // 5. question_usage_history
  const { error: quhErr } = await c
    .from('question_usage_history')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('Deleted question_usage_history:', quhErr ? quhErr.message : 'OK');

  // 6. generated_papers
  const { error: gpErr } = await c
    .from('generated_papers')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('Deleted generated_papers:', gpErr ? gpErr.message : 'OK');

  console.log('\n--- Step 2: Permanently remove ONLY academic year 2026-2027 ---');
  const { data: targetYr, error: findErr } = await c
    .from('academic_years')
    .select('id, year_label')
    .eq('year_label', '2026-2027')
    .maybeSingle();

  if (targetYr) {
    console.log(`Found 2026-2027 record id: ${targetYr.id}. Deleting...`);
    const { error: delYrErr } = await c
      .from('academic_years')
      .delete()
      .eq('id', targetYr.id);
    if (delYrErr) {
      console.error('Failed to delete 2026-2027:', delYrErr.message);
    } else {
      console.log('Successfully deleted academic year 2026-2027 from database.');
    }
  } else {
    console.log('Academic year 2026-2027 was not found (already deleted).');
  }

  console.log('\n--- Step 3: Verification of remaining data ---');
  const { data: remainingYears } = await c
    .from('academic_years')
    .select('id, year_label, status, is_active')
    .order('year_label');
  console.log('Remaining Academic Years:');
  console.log(JSON.stringify(remainingYears, null, 2));

  const { count: remainingPapers } = await c
    .from('generated_papers')
    .select('*', { count: 'exact', head: true });
  console.log('Remaining generated_papers count:', remainingPapers);

  const { count: remainingQB } = await c
    .from('question_banks')
    .select('*', { count: 'exact', head: true });
  console.log('Remaining question_banks count:', remainingQB);

  const { count: remainingQ } = await c
    .from('questions')
    .select('*', { count: 'exact', head: true });
  console.log('Remaining questions count:', remainingQ);

  const { count: remainingSubs } = await c
    .from('subjects')
    .select('*', { count: 'exact', head: true });
  console.log('Remaining subjects count:', remainingSubs);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
