// Note: dotenv is loaded once in app.ts (the Express entry point).
// This service module relies on process.env being already populated.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;
let _bucketVerified = false;
let _bucketAttempted = false;

function cleanEnvVal(val: string | undefined): string | undefined {
  if (!val) return undefined;
  let cleaned = val.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned || undefined;
}

/**
 * Safely resolves server-side Supabase credentials from environment.
 * Never logs or exposes the resolved key values.
 */
export function getSupabaseEnv(): { url: string | undefined; key: string | undefined } {
  // Read directly from process.env at call time (runtime environment).
  // VITE_ vars are intentionally excluded — service-role keys must never be in frontend env vars.
  const url = cleanEnvVal(process.env.SUPABASE_URL);

  const key = cleanEnvVal(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
              cleanEnvVal(process.env.SUPABASE_SERVICE_KEY) ||
              cleanEnvVal(process.env.SUPABASE_KEY);

  return { url, key };
}

/**
 * Checks whether Supabase is configured in the environment.
 * Single source of truth used across the server. Returns only boolean true/false.
 */
export function isSupabaseConfigured(): boolean {
  const { url, key } = getSupabaseEnv();
  if (!url || !key) return false;
  if (key.includes('PASTE_YOUR') || key === 'PASTE_YOUR_SERVICE_ROLE_eyJ_KEY_HERE') {
    return false;
  }
  if (!url.startsWith('https://') && !url.startsWith('http://')) return false;
  if (key.length < 10) return false;
  return true;
}

/**
 * Gets the shared server-side Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 * This client is used server-side only. Never exposed to the frontend.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const { url: supabaseUrl, key: supabaseKey } = getSupabaseEnv();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Database configuration is missing. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in environment variables.'
    );
  }

  _client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return _client;
}

/**
 * Logs structured Supabase errors without exposing secret keys.
 */
function logSupabaseError(action: string, table: string, error: any): void {
  console.error(`[Supabase] Error during ${action} on table "${table}":`);
  console.error(`  Table:   ${table}`);
  console.error(`  Message: ${error?.message || 'Unknown error'}`);
  console.error(`  Code:    ${error?.code || 'N/A'}`);
  if (error?.details) console.error(`  Details: ${error.details}`);
  if (error?.hint)    console.error(`  Hint:    ${error.hint}`);

  if (error?.code === '42P01') {
    console.error(`[Supabase] Table "${table}" does not exist in your Supabase database.`);
    console.error(`[Supabase] Run the migration SQL in "supabase/migrations/001_question_bank.sql" in your Supabase SQL Editor.`);
  } else if (error?.code === '42501') {
    console.error(`[Supabase] Row-Level Security (RLS) violation on table "${table}".`);
    console.error(`[Supabase] Your SUPABASE_SERVICE_ROLE_KEY in .env may be the anon/publishable key instead of the secret service_role key.`);
    console.error(`[Supabase] To resolve:`);
    console.error(`  1. Use your secret service_role key (starts with "eyJ...") from Supabase Dashboard > Project Settings > API.`);
    console.error(`  2. OR run "ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;" in Supabase SQL Editor.`);
  }
}

/**
 * Verifies if required tables exist in Supabase.
 */
export async function verifySupabaseTables(): Promise<{ ok: boolean; missingTables: string[] }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, missingTables: [] };
  }
  const client = getSupabaseClient();
  const missingTables: string[] = [];

  const { error: qbErr } = await client.from('question_banks').select('id').limit(1);
  if (qbErr && (qbErr.code === '42P01' || qbErr.message?.includes('does not exist'))) {
    missingTables.push('question_banks');
  }

  const { error: qErr } = await client.from('questions').select('id').limit(1);
  if (qErr && (qErr.code === '42P01' || qErr.message?.includes('does not exist'))) {
    missingTables.push('questions');
  }

  return {
    ok: missingTables.length === 0,
    missingTables
  };
}

const STORAGE_BUCKET = 'question-banks';

/**
 * Ensures the storage bucket exists, creating it (private) if missing.
 * Caches verification to avoid redundant checks on every upload.
 */
async function ensureBucketExists(client: SupabaseClient): Promise<boolean> {
  if (_bucketVerified) {
    return true;
  }

  // Probe the bucket directly — avoids needing listBuckets() admin permission
  // This works even with a publishable/anon key if bucket storage policies allow reads
  try {
    const { error: probeError } = await client.storage
      .from(STORAGE_BUCKET)
      .list('', { limit: 1 });

    if (!probeError) {
      // Bucket is accessible
      console.log(`[Supabase] Storage bucket "${STORAGE_BUCKET}" is accessible.`);
      _bucketVerified = true;
      return true;
    }

    // Bucket not found — try to create it (requires service_role key)
    if (_bucketAttempted) {
      return false;
    }
    _bucketAttempted = true;

    const { error: createError } = await client.storage.createBucket(STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: 52428800 // 50 MB
    });

    if (createError) {
      console.warn(`[Supabase] Bucket "${STORAGE_BUCKET}" not found and creation failed: ${createError.message}`);
      console.warn(`[Supabase] Please create a private bucket named "${STORAGE_BUCKET}" in Supabase Dashboard > Storage.`);
      return false;
    }

    console.log(`[Supabase] Storage bucket "${STORAGE_BUCKET}" created successfully (private).`);
    _bucketVerified = true;
    return true;
  } catch (err: any) {
    console.warn(`[Supabase] Storage bucket check exception: ${err?.message}`);
    return false;
  }
}

/**
 * Uploads the PDF buffer to Supabase Storage.
 * Path pattern: {subjectCode}/{questionBankId}/{safeFileName}
 * Example: 24CS402/<question-bank-id>/24CS402-DAA-QB.pdf
 */
export async function uploadPdfToStorage(
  pdfBuffer: Buffer,
  originalFileName: string,
  subjectCode: string,
  bankId: string
): Promise<{ path: string | null; error?: string }> {
  const client = getSupabaseClient();

  await ensureBucketExists(client);

  const safeFileName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${subjectCode}/${bankId}/${safeFileName}`;

  console.log('[Supabase] Uploading PDF...');

  const { data, error } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) {
    console.error('[Supabase] Storage upload failed:', error.message);
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  console.log(`[Supabase] Storage upload successful: ${storagePath}`);
  return { path: storagePath };
}

/**
 * Creates a new question_banks record in Supabase.
 * Returns the created record ID.
 */
export async function createQuestionBank(metadata: {
  id: string;
  subject_code: string;
  subject_name: string;
  file_name: string;
  file_size_bytes?: number;
  total_pages?: number;
  total_units?: number;
  regulation?: string;
  storage_path?: string | null;
  uploaded_by?: string;
  status?: string;
  academic_year?: string | null;
  department?: string | null;
}): Promise<string> {
  const client = getSupabaseClient();
  console.log('[Supabase] Creating question bank...');

  const rowData: Record<string, any> = {
    id: metadata.id,
    subject_code: metadata.subject_code,
    subject_name: metadata.subject_name || null,
    file_name: metadata.file_name,
    file_size_bytes: metadata.file_size_bytes || null,
    total_pages: metadata.total_pages || null,
    total_units: metadata.total_units || null,
    regulation: metadata.regulation || null,
    storage_path: metadata.storage_path || null,
    uploaded_by: metadata.uploaded_by || 'Exam Cell',
    status: metadata.status || 'pending_review',
    created_at: new Date().toISOString()
  };

  if (metadata.academic_year) {
    rowData.academic_year = metadata.academic_year;
  }
  if (metadata.department) {
    rowData.department = metadata.department;
  }

  let { data, error } = await client
    .from('question_banks')
    .insert(rowData)
    .select('id')
    .single();

  // If column doesn't exist (e.g. migration 002 not yet executed in Supabase), retry without academic_year/department
  if (error && (error.code === '42703' || error.message?.includes('column'))) {
    console.warn('[Supabase] academic_year/department column not found on question_banks table, inserting without them.');
    delete rowData.academic_year;
    delete rowData.department;
    const retry = await client
      .from('question_banks')
      .insert(rowData)
      .select('id')
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    logSupabaseError('createQuestionBank', 'question_banks', error);
    throw new Error(`Failed to create question bank record in Supabase: [${error.code}] ${error.message}`);
  }

  console.log(`[Supabase] Question bank created: ${data.id}`);
  return data.id;
}

/**
 * Returns the total count of question banks in Supabase.
 */
export async function getQuestionBankCount(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const client = getSupabaseClient();
    const { count, error } = await client
      .from('question_banks')
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.warn('[Supabase] getQuestionBankCount error:', error.message);
      return 0;
    }
    return count ?? 0;
  } catch (err: any) {
    console.warn('[Supabase] getQuestionBankCount failed:', err?.message);
    return 0;
  }
}

/** True when the error means the `bank_type` column (migration 012) is absent. */
function isMissingBankTypeColumn(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  return code === '42703' || /column .*bank_type|bank_type.*does not exist/i.test(msg);
}

/**
 * Number of questions per question bank, computed from the `questions` table.
 *
 * The count is ALWAYS read from the database — it is never derived from browser
 * state and never hardcoded. Identical in localhost and in production because
 * both call this same function.
 *
 * `questions` rows carry no `academic_year` / `department` of their own, so the
 * count is grouped by `question_bank_id`: the year + department + subject-code
 * scope lives on the `question_banks` row itself.
 *
 * The read is PAGINATED. PostgREST caps a single response at 1000 rows, so a
 * plain `.in()` request silently under-counts once the total question volume
 * crosses that limit (which is exactly the kind of bug that only shows up on a
 * real database). We page until a short page comes back, so the count is exact.
 */
async function getQuestionCountsByBankId(bankIds: string[]): Promise<Map<string, {
  total: number;
  partA: number;
  partB: number;
  partC: number;
}>> {
  const result = new Map<string, { total: number; partA: number; partB: number; partC: number }>();
  if (bankIds.length === 0) return result;

  const client = getSupabaseClient();
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 200; // 200k questions is far beyond any single bank set

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await client
      .from('questions')
      .select('question_bank_id, part')
      .in('question_bank_id', bankIds)
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      // The banks are still returned; the count simply reads as 0 and the UI
      // reports it as 0 rather than a blank cell.
      console.warn('[Supabase] getQuestionCountsByBankId error:', error.message);
      return result;
    }

    const rows = (data || []) as Array<{ question_bank_id: string | null; part: string | null }>;
    for (const row of rows) {
      const bankId = row?.question_bank_id;
      if (!bankId) continue;
      const bucket = result.get(bankId) || { total: 0, partA: 0, partB: 0, partC: 0 };
      bucket.total += 1;
      const part = String(row.part || '').trim().toUpperCase();
      if (part === 'PART A' || part === 'A') bucket.partA += 1;
      else if (part === 'PART C' || part === 'C') bucket.partC += 1;
      else bucket.partB += 1;
      result.set(bankId, bucket);
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return result;
}

export interface QuestionBankRow extends Record<string, any> {
  /** Real question count from the `questions` table. 0 when the bank is empty. */
  total_questions: number;
  part_a_count: number;
  part_b_count: number;
  part_c_count: number;
  /** Units detected for this bank. 0 when unknown (never a hardcoded default). */
  total_units: number | null;
  bank_type: string;
}

/**
 * Returns ORIGINAL question bank records from Supabase with their REAL question
 * counts.
 *
 * Filtering is authoritative and server-side. A subject is identified ONLY by
 * the combination Academic Year + Department + Subject Code, so the same subject
 * code under two departments stays two separate question-bank sources.
 *
 * Generated (reduced) banks are excluded: `bank_type = 'IAT_GENERATED'` rows are
 * listed by the IAT Generated Banks screen, and they hold no original questions.
 */
export async function getQuestionBanks(filters?: {
  academicYear?: string;
  department?: string;
  subjectCode?: string;
}): Promise<QuestionBankRow[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    const client = getSupabaseClient();

    const applyFilters = (q: any) => {
      let query = q;
      if (filters?.subjectCode) {
        query = query.eq('subject_code', filters.subjectCode);
      }
      if (filters?.academicYear) {
        // Exact match only. A bank with a NULL year must never appear under a
        // selected academic year.
        query = query.eq('academic_year', filters.academicYear);
      }
      if (filters?.department) {
        query = query.eq('department', filters.department);
      }
      return query;
    };

    let query = applyFilters(
      client
        .from('question_banks')
        .select('*')
        .eq('bank_type', 'ORIGINAL')
        .order('created_at', { ascending: false })
    );

    let { data, error } = await query;

    // Migration 012 not installed in this database — retry without bank_type.
    if (error && isMissingBankTypeColumn(error)) {
      const retry = applyFilters(
        client
          .from('question_banks')
          .select('*')
          .order('created_at', { ascending: false })
      );
      const result = await retry;
      if (result.error) {
        console.warn('[Supabase] getQuestionBanks error:', result.error.message);
        return [];
      }
      data = result.data;
      error = null;
    }

    if (error) {
      console.warn('[Supabase] getQuestionBanks error:', error.message);
      return [];
    }

    const rows = (data || []) as QuestionBankRow[];
    const counts = await getQuestionCountsByBankId(rows.map((b) => b.id));

    return rows.map((row) => {
      const c = counts.get(row.id);
      return {
        ...row,
        bank_type: row.bank_type || 'ORIGINAL',
        total_units: typeof row.total_units === 'number' ? row.total_units : null,
        total_questions: c ? c.total : 0,
        part_a_count: c ? c.partA : 0,
        part_b_count: c ? c.partB : 0,
        part_c_count: c ? c.partC : 0
      };
    });
  } catch (err: any) {
    console.warn('[Supabase] getQuestionBanks error:', err?.message);
    return [];
  }
}

/**
 * Returns every question belonging to ONE question bank.
 *
 * Scoped strictly by `question_bank_id`, which is the database-side expression of
 * the Academic Year + Department + Subject Code identity. Questions belonging to
 * another year, another department, another subject code, or another bank are
 * never returned — even when they share the same `subject_code`.
 */
export async function getQuestionsForBank(bankId: string): Promise<Array<Record<string, any>>> {
  if (!isSupabaseConfigured() || !bankId) return [];
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('questions')
      .select('*')
      .eq('question_bank_id', bankId)
      .order('part', { ascending: true })
      .order('unit', { ascending: true });
    if (error) {
      console.warn('[Supabase] getQuestionsForBank error:', error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.warn('[Supabase] getQuestionsForBank error:', err?.message);
    return [];
  }
}

/**
 * Maps an extracted question object to a database row.
 * Preserves null where appropriate without creating fake metadata.
 */
function mapQuestionToRow(
  q: any,
  bankId: string,
  subjectCode: string,
  status: 'Draft' | 'Approved' = 'Draft'
) {
  const now = new Date().toISOString();

  // Normalize part to Part A, Part B, Part C
  let part = 'Part B';
  if (q.part === 'A' || q.part === 'Part A') part = 'Part A';
  else if (q.part === 'C' || q.part === 'Part C') part = 'Part C';

  // Unit must be integer 1-5 or null
  const unitNum = typeof q.unit === 'number' ? Math.floor(q.unit) : parseInt(q.unit, 10);
  const unit = (!isNaN(unitNum) && unitNum >= 1 && unitNum <= 5) ? unitNum : null;

  // orOption must be 'A', 'B', or null (DB column is CHAR(1))
  let orOption: string | null = null;
  if (typeof q.orOption === 'string' && (q.orOption === 'A' || q.orOption === 'B')) {
    orOption = q.orOption;
  }

  // Difficulty check
  let difficulty = 'Medium';
  if (q.difficulty && ['Easy', 'Medium', 'Hard'].includes(q.difficulty)) {
    difficulty = q.difficulty;
  }

  return {
    question_bank_id: bankId,
    subject_code: subjectCode,
    unit: unit,
    unit_title: q.unitTitle || null,
    topic: q.topic || null,
    part: part,
    marks: typeof q.marks === 'number' ? q.marks : (part === 'Part A' ? 2 : part === 'Part C' ? 15 : 13),
    mark_breakdown: q.markBreakdown || null,
    question_text: q.questionText || '',
    blooms_level: q.bl || q.bloomsLevel || null,
    btl_raw: q.btl || null,
    co: q.co || null,
    pi: q.pi || null,
    difficulty: difficulty,
    or_group_id: q.orGroupId || null,
    or_option: orOption,
    sub_questions: Array.isArray(q.subQuestions) && q.subQuestions.length > 0 ? q.subQuestions : null,
    ocr_confidence: typeof q.ocrConfidence === 'number' ? q.ocrConfidence : null,
    source_document: q.sourceDocument || null,
    source_page: typeof q.sourcePage === 'number' ? q.sourcePage : null,
    source_page_end: typeof q.sourcePageEnd === 'number' ? q.sourcePageEnd : null,
    allowed_internal1: true,
    allowed_internal2: true,
    allowed_end_sem: true,
    status: status,
    created_by: 'Exam Cell OCR Engine',
    created_at: now,
    updated_at: now
  };
}

/**
 * Stores all extracted questions in Supabase with status 'Draft' during extraction.
 * Does NOT mark questions as exam-used.
 */
export async function insertExtractedQuestions(
  bankId: string,
  subjectCode: string,
  questions: any[]
): Promise<number> {
  if (!questions || questions.length === 0) return 0;

  const client = getSupabaseClient();
  console.log(`[Supabase] Inserting ${questions.length} questions...`);

  const rows = questions.map(q => mapQuestionToRow(q, bankId, subjectCode, 'Draft'));

  const { error } = await client.from('questions').insert(rows);

  if (error) {
    logSupabaseError('insertExtractedQuestions', 'questions', error);
    throw new Error(`Failed to insert questions into Supabase: [${error.code}] ${error.message}${error.hint ? ' - Hint: ' + error.hint : ''}`);
  }

  console.log(`[Supabase] Questions inserted successfully: ${rows.length}`);
  return rows.length;
}

/**
 * Saves teacher-approved questions to Supabase.
 * Updates draft records to 'Approved' and marks the question bank as 'approved'.
 */
export async function saveApprovedQuestions(
  bankId: string,
  subjectCode: string,
  questions: any[]
): Promise<number> {
  if (!questions || questions.length === 0) return 0;

  const client = getSupabaseClient();
  console.log(`[Supabase] Approving and updating ${questions.length} questions for bank ${bankId}...`);

  // Delete previous draft records for this bank to ensure clean replacement with teacher's edits
  const { error: delError } = await client
    .from('questions')
    .delete()
    .eq('question_bank_id', bankId);

  if (delError) {
    logSupabaseError('deleteDraftQuestions', 'questions', delError);
    throw new Error(`Failed to update questions: [${delError.code}] ${delError.message}`);
  }

  // Insert the approved questions
  const rows = questions.map(q => mapQuestionToRow(q, bankId, subjectCode, 'Approved'));
  const { error: insError } = await client.from('questions').insert(rows);

  if (insError) {
    logSupabaseError('saveApprovedQuestions', 'questions', insError);
    throw new Error(`Failed to save approved questions: [${insError.code}] ${insError.message}`);
  }

  // Update question bank status to 'approved'
  const { error: statusError } = await client
    .from('question_banks')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', bankId);

  if (statusError) {
    logSupabaseError('updateQuestionBankStatus', 'question_banks', statusError);
  }

  console.log(`[Supabase] Questions approved and saved successfully: ${rows.length}`);
  return rows.length;
}

/**
 * Updates the status of a question bank record.
 */
export async function updateQuestionBankStatus(
  bankId: string,
  status: 'pending_review' | 'approved' | 'rejected'
): Promise<void> {
  const client = getSupabaseClient();

  const { error } = await client
    .from('question_banks')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', bankId);

  if (error) {
    logSupabaseError('updateQuestionBankStatus', 'question_banks', error);
    throw new Error(`Failed to update question bank status: [${error.code}] ${error.message}`);
  }
}
