import { API_BASE, safeJsonParse } from './authApi';

/**
 * Generated paper archive — read side.
 *
 * The "Generated Question Papers" page is populated exclusively from Supabase
 * through GET /api/paper-sets/papers. There is no mock array and no
 * localStorage fallback: if the request fails the UI shows an error state
 * rather than inventing records.
 */

/** One question selection exactly as stored in `generated_paper_questions`. */
export interface ArchivedPaperQuestion {
  question_id: string | null;
  iat_question_id: string | null;
  question_bank_type: 'original' | 'reduced';
  question_bank_id: string | null;
  question_number: string | null;
  unit: number | null;
  part: string | null;
  marks: number | null;
  btl: string | null;
  co: string | null;
  pi: string | null;
  question_text: string | null;
  order_index: number;
}

/** A `generated_papers` row plus the labels its identity resolves to. */
export interface ArchivedGeneratedPaper {
  id: string;
  paper_code: string;

  // Identity is the triple — never the subject code on its own.
  academic_year_id: string | null;
  department_id: string | null;
  subject_id: string | null;
  academic_year: string | null;
  academic_year_label: string | null;
  department: string | null;
  department_label: string | null;
  department_name: string | null;
  subject_code: string | null;
  subject_name: string | null;
  subject_code_label: string | null;
  subject_name_label: string | null;
  semester: string | null;
  regulation: string | null;
  year_of_study: string | null;

  exam_type: string | null;
  set_letter: string | null;
  set_name: string | null;
  set_display_name: string | null;
  file_name: string | null;
  exam_date: string | null;
  duration: string | null;
  max_marks: number | null;
  status: string;

  question_bank_source: string | null;
  question_bank_type: 'original' | 'reduced';
  question_bank_id: string | null;
  iat_generated_bank_id: string | null;
  iat_generated_bank_name: string | null;

  created_by: string | null;
  generated_by: string | null;
  generated_at: string | null;
  created_at: string | null;
  principal_approval_required: boolean;
  principal_approval_status: string | null;
  approved_by: string | null;
  approved_at: string | null;

  question_count: number;
  questions: ArchivedPaperQuestion[];
}

export interface GeneratedPapersResponse {
  papers: ArchivedGeneratedPaper[];
  count: number;
  databaseConfigured: boolean;
  questionMappingsAvailable: boolean;
  error?: string;
}

export interface GeneratedPaperFilters {
  academicYearId?: string;
  departmentId?: string;
  subjectId?: string;
  examType?: string;
  setLetter?: string;
  status?: string;
  search?: string;
}

/**
 * Loads the archive from the backend.
 *
 * A non-2xx response is surfaced as `error` instead of an empty list, so the
 * page can distinguish "no papers yet" from "could not reach the database".
 */
export async function fetchGeneratedPapers(
  filters: GeneratedPaperFilters = {},
  token?: string
): Promise<GeneratedPapersResponse> {
  const params = new URLSearchParams();
  if (filters.academicYearId) params.set('academicYearId', filters.academicYearId);
  if (filters.departmentId) params.set('departmentId', filters.departmentId);
  if (filters.subjectId) params.set('subjectId', filters.subjectId);
  if (filters.examType) params.set('examType', filters.examType);
  if (filters.setLetter) params.set('setLetter', filters.setLetter);
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);

  const query = params.toString();
  const url = `${API_BASE}/paper-sets/papers${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  const data = await safeJsonParse<any>(res, 'GET /paper-sets/papers');
  if (!res.ok) {
    return {
      papers: [],
      count: 0,
      databaseConfigured: false,
      questionMappingsAvailable: false,
      error: data?.error || `Could not load generated papers (HTTP ${res.status}).`
    };
  }

  return {
    papers: Array.isArray(data?.papers) ? data.papers : [],
    count: Number(data?.count ?? 0),
    databaseConfigured: data?.databaseConfigured !== false,
    questionMappingsAvailable: data?.questionMappingsAvailable !== false
  };
}