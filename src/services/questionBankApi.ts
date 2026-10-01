/**
 * Frontend API service for Question Bank extraction.
 * All requests go to /api/* which is proxied to the Express backend (port 4000) by Vite.
 * NO API keys or secrets here — everything stays server-side.
 */

export interface SubjectMismatchInfo {
  isMismatch: boolean;
  selectedSubjectCode: string;
  documentSubjectCode: string;
  documentSubjectName: string;
  message: string;
}

export interface ExtractionResponse {
  success: boolean;
  questionBankId: string | null;
  subjectMismatch?: SubjectMismatchInfo | null;
  metadata: {
    subjectName?: string;
    subjectCode?: string;
    department?: string;
    regulation?: string;
    semester?: string;
    totalUnitsDetected: number;
    totalPages: number;
    fileName?: string;
    fileSize?: string;
    isScannedImageOnly: boolean;
    questionBankId?: string;
    // Subject mismatch fields from backend
    selectedSubjectCode?: string;
    documentSubjectCode?: string;
    documentSubjectName?: string;
    isSubjectMismatch?: boolean;
    storagePath?: string;
    storageArchived?: boolean;
  };
  questions: any[]; // OcrExtractedQuestion[] — typed at usage site
  stats: {
    total: number;
    partA: number;
    partB: number;
    partC: number;
    approved: number;
    needsReview: number;
    lowConfidence: number;
  };
  error?: string;
  /** Backend-confirmed Gemini status, used to pick the right user wording. */
  geminiStatus?: string;
  errorCode?: string;
}

export interface ApprovalResponse {
  success: boolean;
  message: string;
  savedCount: number;
  bankId?: string;
  error?: string;
}

/**
 * Maps a backend-confirmed Gemini status to the exact user-facing wording.
 * An "authentication failed" message is only ever shown when the backend
 * actually reports geminiStatus === 'authentication_failed'.
 */
export function geminiStatusMessage(status: string | undefined): string | null {
  switch (status) {
    case 'authentication_failed':
      return 'Gemini authentication failed on the server. Please contact the administrator.';
    case 'permission_denied':
      return 'Gemini access was denied on the server. Please contact the administrator.';
    case 'model_unavailable':
      return 'Gemini model is currently unavailable. Please contact the administrator.';
    case 'rate_limited':
      return 'Gemini API rate limit reached. Please try again later.';
    case 'service_unavailable':
      return 'Gemini service is temporarily unavailable. Please try again later.';
    case 'not_configured':
      return 'Gemini extraction is not configured on the server. Please contact the administrator.';
    default:
      return null;
  }
}

/**
 * Sends a PDF/image file to the backend for Gemini extraction.
 * Returns the extracted questions and document metadata.
 *
 * @param file - The PDF or image file to extract from
 * @param subjectCode - The target subject code (e.g. "24AM411")
 * @param uploadedBy - Name of the uploader (optional)
 * @param onProgress - Optional callback for progress updates (0–100)
 * @param token - JWT of the signed-in user (required)
 */
export async function extractQuestionBank(
  file: File,
  subjectCode: string,
  uploadedBy?: string,
  onProgress?: (stage: string, percent: number) => void,
  academicYear?: string,
  department?: string,
  token?: string
): Promise<ExtractionResponse> {
  onProgress?.('Uploading question bank to server...', 10);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('subjectCode', subjectCode);
  if (uploadedBy) formData.append('uploadedBy', uploadedBy);
  if (academicYear) formData.append('academicYear', academicYear);
  if (department) formData.append('department', department);

  onProgress?.('Sending document to Gemini AI...', 25);

  let response: Response;
  try {
    response = await fetch('/api/question-banks/extract', {
      method: 'POST',
      body: formData,
      // Do NOT set Content-Type header — browser sets it with boundary for multipart
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  } catch (networkErr: any) {
    throw new Error(
      `Cannot reach the extraction server. Please ensure the backend is running:\n  npm run server\n\nError: ${networkErr?.message}`
    );
  }

  if (response.status === 401) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  onProgress?.('Processing Gemini AI response...', 75);

  let result: ExtractionResponse;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Server returned an unexpected response (HTTP ${response.status}). Check backend logs.`);
  }

  if (!response.ok || !result.success) {
    // Prefer the status-derived wording so the message always matches what the
    // backend actually confirmed, and never leak a raw Google API error.
    const mapped = geminiStatusMessage(result.geminiStatus);
    throw new Error(
      mapped || result.error || `Extraction failed (HTTP ${response.status})`
    );
  }

  onProgress?.('Preparing teacher review interface...', 95);

  return result;
}

/**
 * Saves the teacher-approved questions to Supabase via the backend.
 * Called when the teacher clicks "Add to Question Bank".
 * Falls back gracefully if Supabase is not configured.
 *
 * @param bankId - The questionBankId returned from extractQuestionBank()
 * @param subjectCode - The subject code
 * @param questions - The approved OcrExtractedQuestion objects
 */
export async function approveQuestionBank(
  bankId: string,
  subjectCode: string,
  questions: any[],
  token?: string
): Promise<ApprovalResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/question-banks/${bankId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ subjectCode, questions })
    });
  } catch (networkErr: any) {
    // Non-fatal — AppContext.addQuestions() is the primary save mechanism
    console.warn('[QuestionBankApi] Supabase save failed (non-fatal):', networkErr?.message);
    return {
      success: false,
      message: 'Backend unavailable — questions saved to local state only.',
      savedCount: 0
    };
  }

  try {
    const result: ApprovalResponse = await response.json();
    return result;
  } catch {
    return {
      success: false,
      message: 'Unexpected server response during approval.',
      savedCount: 0
    };
  }
}

/**
 * Checks if the backend is running and configured.
 *
 * `geminiConfigured` only means the key exists in the server environment.
 * `geminiAuthenticated` means a real Gemini API request succeeded.
 */
export async function checkBackendHealth(): Promise<{
  running: boolean;
  geminiConfigured: boolean;
  geminiAuthenticated: boolean;
  geminiModelAvailable: boolean;
  geminiStatus?: string;
  geminiMessage?: string;
  supabaseConfigured: boolean;
}> {
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      return {
        running: false,
        geminiConfigured: false,
        geminiAuthenticated: false,
        geminiModelAvailable: false,
        supabaseConfigured: false
      };
    }
    const data = await response.json();
    return {
      // "degraded" still means the API is up and answering.
      running: data.status === 'ok' || data.status === 'degraded' || data.status === 'configuration_error',
      geminiConfigured: !!data.geminiConfigured,
      geminiAuthenticated: !!data.geminiAuthenticated,
      geminiModelAvailable: !!data.geminiModelAvailable,
      geminiStatus: data.geminiStatus,
      geminiMessage: data.geminiMessage,
      supabaseConfigured: !!data.supabaseConfigured
    };
  } catch {
    return {
      running: false,
      geminiConfigured: false,
      geminiAuthenticated: false,
      geminiModelAvailable: false,
      supabaseConfigured: false
    };
  }
}

// ============================================================
// Question Bank listing
// ============================================================

/**
 * One ORIGINAL question bank row as returned by GET /api/question-banks.
 *
 * `total_questions` is the real database count (0 for an empty bank). It is
 * never null and never derived from browser state, so localhost and the
 * deployed build always render the same number.
 */
export interface QuestionBankListRow {
  id: string;
  subject_code: string;
  subject_name?: string | null;
  file_name: string;
  file_size_bytes?: number | null;
  total_pages?: number | null;
  total_units?: number | null;
  regulation?: string | null;
  storage_path?: string | null;
  uploaded_by?: string | null;
  status: string;
  academic_year?: string | null;
  department?: string | null;
  created_at: string;
  bank_type?: string;
  total_questions: number;
  part_a_count: number;
  part_b_count: number;
  part_c_count: number;
}

export interface QuestionBankFilters {
  academicYear?: string;
  department?: string;
  /**
   * Department allow-list for the COMMON flow. Sent as a comma-separated list
   * so the bank is resolved inside exactly the chosen departments.
   */
  departments?: string[];
  subjectCode?: string;
}

function filterQuery(filters: QuestionBankFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
      return;
    }
    if (value && value !== 'all') params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Lists ORIGINAL question banks.
 *
 * The Academic Year + Department + Subject Code combination is sent to the
 * server, which applies it authoritatively — the client never re-derives the
 * scope from a subject code alone.
 */
export async function fetchQuestionBanks(
  token: string,
  filters: QuestionBankFilters = {}
): Promise<QuestionBankListRow[]> {
  const res = await fetch(`/api/question-banks${filterQuery(filters)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) throw new Error(`Failed to load question banks (HTTP ${res.status}).`);
  const data = await res.json();
  if (!data || data.success === false) {
    throw new Error(data?.error || 'Failed to load question banks.');
  }
  return Array.isArray(data.questionBanks) ? data.questionBanks : [];
}

/**
 * Questions of exactly one question bank, from the database.
 * Never mixes another year / department / subject / bank.
 */
export async function fetchQuestionsForBank(token: string, bankId: string): Promise<any[]> {
  const res = await fetch(`/api/question-banks/${bankId}/questions`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) throw new Error(`Failed to load questions (HTTP ${res.status}).`);
  const data = await res.json();
  if (!data || data.success === false) {
    throw new Error(data?.error || 'Failed to load questions.');
  }
  return Array.isArray(data.questions) ? data.questions : [];
}

/** Normalizes a `questions` row part value to 'Part A' | 'Part B' | 'Part C'. */
function mapPart(raw: unknown): 'Part A' | 'Part B' | 'Part C' {
  const value = String(raw ?? '').trim().toUpperCase();
  if (value === 'PART A' || value === 'A') return 'Part A';
  if (value === 'PART C' || value === 'C') return 'Part C';
  return 'Part B';
}

function mapDifficulty(raw: unknown): 'Easy' | 'Medium' | 'Hard' {
  const value = String(raw ?? '').trim();
  return value === 'Easy' || value === 'Hard' ? value : 'Medium';
}

/**
 * Maps a database `questions` row to the frontend `Question` shape.
 *
 * `questionBankId` is preserved so the explorer can keep every question tied to
 * the one bank that was selected.
 */
export function mapDbQuestion(row: any): any {
  const part = mapPart(row?.part);
  return {
    id: String(row?.id ?? ''),
    subjectCode: row?.subject_code || '',
    unit: typeof row?.unit === 'number' ? row.unit : Number(row?.unit) || 0,
    topic: row?.topic || row?.unit_title || '',
    part,
    marks: typeof row?.marks === 'number' ? row.marks : (part === 'Part A' ? 2 : part === 'Part C' ? 15 : 13),
    questionText: row?.question_text || '',
    bloomsLevel: (row?.blooms_level || row?.btl_raw || 'K1') as any,
    co: row?.co || '',
    pi: row?.pi || '',
    difficulty: mapDifficulty(row?.difficulty),
    allowedFor: {
      internal1: row?.allowed_internal1 !== false,
      internal2: row?.allowed_internal2 !== false,
      endSem: row?.allowed_end_sem !== false
    },
    usageHistory: { internal1: false, internal2: false, endSem: false, timesUsed: 0 },
    status: row?.status === 'Approved' ? 'Approved' : (row?.status === 'pending' ? 'Pending' : 'Draft'),
    createdBy: row?.created_by || 'Exam Cell',
    createdDate: String(row?.created_at || '').slice(0, 10),
    orGroupId: row?.or_group_id || undefined,
    orOption: row?.or_option || undefined,
    subQuestions: Array.isArray(row?.sub_questions) && row.sub_questions.length > 0 ? row.sub_questions : undefined,
    ocrConfidence: typeof row?.ocr_confidence === 'number' ? row.ocr_confidence : undefined,
    sourceDocument: row?.source_document || undefined,
    sourcePage: typeof row?.source_page === 'number' ? row.source_page : undefined,
    questionBankId: row?.question_bank_id || undefined,
    bl: row?.btl_raw || undefined,
    updatedAt: row?.updated_at || undefined
  };
}
