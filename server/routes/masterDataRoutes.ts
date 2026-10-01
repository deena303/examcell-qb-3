import express, { Response } from 'express';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/authMiddleware';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseQuestionBankService';
import { countQuestionsForSubjects } from '../services/questionCountService';
import { isValidSemester, normalizeSemester, SEMESTER_OPTIONS } from '../services/subjectSemester';

const router = express.Router();

/**
 * Fire-and-forget audit log helper for master data CRUD actions.
 * NEVER stores passwords, tokens, or API keys.
 */
async function auditLog(
  req: AuthenticatedRequest,
  action: string,
  status: 'SUCCESS' | 'FAILED',
  metadata?: Record<string, any>
): Promise<void> {
  try {
    if (!isSupabaseConfigured() || !req.user) return;
    const ip = req.ip || req.headers['x-forwarded-for'] as string || null;
    const ua = req.headers['user-agent'] || null;
    const client = getSupabaseClient();
    await client.from('audit_logs').insert({
      user_id: req.user.userId,
      user_email: req.user.email,
      user_name: req.user.name,
      role: req.user.role,
      action: action.toUpperCase(),
      status,
      ip_address: ip,
      user_agent: ua,
      metadata: metadata || null,
      created_at: new Date().toISOString()
    });
  } catch (err: any) {
    console.warn('[audit] masterData log failed:', err?.message);
  }
}

router.get('/academic-years', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json([]);
    const client = getSupabaseClient();
    let query = client.from('academic_years').select('*').order('year_label', { ascending: false });
    if (req.query.activeOnly === 'true') query = query.eq('status', 'active');
    const { data, error } = await query;
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    console.error('[masterData] GET academic-years:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to fetch academic years.' });
  }
});

router.post('/academic-years', requireAuth, requireRole('SUPER_ADMIN', 'EXAM_CELL'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { year_label, status, start_year, end_year } = req.body;
    if (!year_label) return res.status(400).json({ error: 'year_label is required.' });
    const client = getSupabaseClient();
    const parts = String(year_label).split('-');
    const computedStart = start_year ?? (parts.length === 2 ? parseInt(parts[0]) : null);
    const computedEnd = end_year ?? (parts.length === 2 ? parseInt(parts[1]) : null);
    const { data, error } = await client
      .from('academic_years')
      .insert({ year_label: year_label.trim(), status: status || 'active', is_active: status !== 'inactive', start_year: computedStart, end_year: computedEnd })
      .select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Academic year already exists.' });
      throw error;
    }
    auditLog(req, 'CREATE_ACADEMIC_YEAR', 'SUCCESS', { year_label: data?.year_label });
    return res.status(201).json(data);
  } catch (err: any) {
    console.error('[masterData] POST academic-years:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to create academic year.' });
  }
});

router.put('/academic-years/:id', requireAuth, requireRole('SUPER_ADMIN', 'EXAM_CELL'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { year_label, status, start_year, end_year } = req.body;
    const client = getSupabaseClient();
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (year_label !== undefined) updates.year_label = year_label.trim();
    if (status !== undefined) { updates.status = status; updates.is_active = status === 'active'; }
    if (start_year !== undefined) updates.start_year = start_year;
    if (end_year !== undefined) updates.end_year = end_year;
    const { data, error } = await client.from('academic_years').update(updates).eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Academic year not found.' });
    auditLog(req, 'UPDATE_ACADEMIC_YEAR', 'SUCCESS', { id, year_label: data?.year_label });
    return res.json(data);
  } catch (err: any) {
    console.error('[masterData] PUT academic-years:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to update academic year.' });
  }
});

router.delete('/academic-years/:id', requireAuth, requireRole('SUPER_ADMIN', 'EXAM_CELL'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const client = getSupabaseClient();
    const { count: subjectCount } = await client.from('subjects').select('*', { count: 'exact', head: true }).eq('academic_year_id', id);
    if (subjectCount && subjectCount > 0) {
      const { data, error } = await client.from('academic_years').update({ status: 'inactive', is_active: false, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (error) throw error;
      return res.json({ ...data, _action: 'deactivated', message: 'Academic year deactivated (referenced by subjects).' });
    }
    const { error } = await client.from('academic_years').delete().eq('id', id);
    if (error) throw error;
    return res.json({ id, _action: 'deleted', message: 'Academic year deleted.' });
  } catch (err: any) {
    console.error('[masterData] DELETE academic-years:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to delete academic year.' });
  }
});

router.get('/departments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json([]);
    const client = getSupabaseClient();
    let query = client.from('departments').select('id, department_code, department_name, short_name, hod_name, is_common, is_active, status, created_at, updated_at').order('department_code');
    if (req.query.activeOnly === 'true') query = query.eq('status', 'active');
    const { data, error } = await query;
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    console.error('[masterData] GET departments:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to fetch departments.' });
  }
});

router.post('/departments', requireAuth, requireRole('SUPER_ADMIN', 'EXAM_CELL'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { department_code, department_name, short_name, hod_name, is_common, status } = req.body;
    if (!department_code || !department_name) return res.status(400).json({ error: 'department_code and department_name are required.' });
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('departments')
      .insert({ department_code: department_code.trim().toUpperCase(), department_name: department_name.trim(), short_name: short_name?.trim() || null, hod_name: hod_name?.trim() || null, is_common: is_common ?? false, is_active: status !== 'inactive', status: status || 'active' })
      .select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Department code already exists.' });
      throw error;
    }
    auditLog(req, 'CREATE_DEPARTMENT', 'SUCCESS', { department_code: data?.department_code });
    return res.status(201).json(data);
  } catch (err: any) {
    console.error('[masterData] POST departments:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to create department.' });
  }
});

router.put('/departments/:id', requireAuth, requireRole('SUPER_ADMIN', 'EXAM_CELL'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { department_code, department_name, short_name, hod_name, is_common, status } = req.body;
    const client = getSupabaseClient();
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (department_code !== undefined) updates.department_code = department_code.trim().toUpperCase();
    if (department_name !== undefined) updates.department_name = department_name.trim();
    if (short_name !== undefined) updates.short_name = short_name?.trim() || null;
    if (hod_name !== undefined) updates.hod_name = hod_name?.trim() || null;
    if (is_common !== undefined) updates.is_common = is_common;
    if (status !== undefined) { updates.status = status; updates.is_active = status === 'active'; }
    const { data, error } = await client.from('departments').update(updates).eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Department not found.' });
    const actionType = updates.status === 'inactive' ? 'DEACTIVATE_DEPARTMENT' : 'UPDATE_DEPARTMENT';
    auditLog(req, actionType, 'SUCCESS', { id, department_code: data?.department_code });
    return res.json(data);
  } catch (err: any) {
    console.error('[masterData] PUT departments:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to update department.' });
  }
});

router.delete('/departments/:id', requireAuth, requireRole('SUPER_ADMIN', 'EXAM_CELL'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const client = getSupabaseClient();
    const [{ count: subjectCount }, { count: qdCount }] = await Promise.all([
      client.from('subjects').select('*', { count: 'exact', head: true }).eq('department_id', id),
      client.from('question_departments').select('*', { count: 'exact', head: true }).eq('department_id', id),
    ]);
    const isReferenced = (subjectCount ?? 0) > 0 || (qdCount ?? 0) > 0;
    if (isReferenced) {
      const { data, error } = await client.from('departments').update({ status: 'inactive', is_active: false, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (error) throw error;
      return res.json({ ...data, _action: 'deactivated', message: 'Department deactivated (referenced by existing records).' });
    }
    const { error } = await client.from('departments').delete().eq('id', id);
    if (error) throw error;
    return res.json({ id, _action: 'deleted', message: 'Department deleted.' });
  } catch (err: any) {
    console.error('[masterData] DELETE departments:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to delete department.' });
  }
});

router.get('/subjects', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json([]);
    const client = getSupabaseClient();
    let query = client.from('subjects').select('*, departments (id, department_code, department_name, short_name, hod_name, is_common), academic_years (id, year_label, start_year, end_year)').order('subject_code');
    if (req.query.activeOnly === 'true') query = query.eq('status', 'active');
    if (req.query.academicYearId) query = query.eq('academic_year_id', req.query.academicYearId as string);
    if (req.query.departmentId) query = query.eq('department_id', req.query.departmentId as string);
    if (req.query.yearOfStudy) query = query.eq('year_of_study', req.query.yearOfStudy as string);
    const { data, error } = await query;
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    console.error('[masterData] GET subjects:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to fetch subjects.' });
  }
});

/**
 * GET /api/subjects/question-counts
 *
 * Real, database-backed question counts scoped to
 * Academic Year + Department + Subject Code (Spec §9–§13).
 *
 * Part of the existing /subjects resource — no duplicate API is created.
 * A failure is returned as `error`, never as 0 (Spec §15).
 *
 * Query: /api/subjects/question-counts?academicYearId=<uuid>&departmentId=<uuid>
 *   -> { counts: { "24CS514": 80 }, detail: {...}, error: null }
 */
router.get('/subjects/question-counts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.json({ counts: {}, detail: {}, error: null, databaseConfigured: false });
    }

    const client = getSupabaseClient();
    const { academicYearId, departmentId, subjectCodes } = req.query as Record<string, string>;

    // Resolve the human-readable year label + department code used by
    // question_banks.academic_year / question_banks.department
    let academicYear: string | null = null;
    let departmentCode: string | null = null;

    if (academicYearId) {
      const { data } = await client.from('academic_years').select('year_label').eq('id', academicYearId).maybeSingle();
      academicYear = data?.year_label ?? null;
    }
    if (departmentId) {
      const { data } = await client.from('departments').select('department_code').eq('id', departmentId).maybeSingle();
      departmentCode = data?.department_code ?? null;
    }

    // Subject codes: either supplied explicitly, or derived from the master
    // subjects table for the given year + department (Spec §18 — the Exam Cell
    // must see exactly the subjects Super Admin manages).
    let codes: string[] = [];
    if (subjectCodes) {
      codes = subjectCodes.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      let sq = client.from('subjects').select('subject_code, department_id, academic_year_id').eq('status', 'active');
      if (academicYearId) sq = sq.eq('academic_year_id', academicYearId);
      if (departmentId) sq = sq.eq('department_id', departmentId);
      const { data, error } = await sq;
      if (error) throw error;
      codes = Array.from(new Set((data || []).map((s: any) => s.subject_code).filter(Boolean)));
    }

    if (codes.length === 0) {
      return res.json({ counts: {}, detail: {}, error: null, databaseConfigured: true });
    }

    const result = await countQuestionsForSubjects({
      subjectCodes: codes,
      academicYear,
      departmentCode
    });

    if (result.error) {
      // Explicit failure — the UI shows "Unable to load question count" (Spec §15)
      return res.status(503).json({
        error: `Unable to load question counts: ${result.error}`,
        counts: null,
        detail: null
      });
    }

    return res.json({
      counts: result.counts,
      detail: result.detail,
      error: null,
      databaseConfigured: true,
      scope: { academicYear, departmentCode, subjectCount: codes.length }
    });
  } catch (err: any) {
    console.error('[masterData] GET subjects/question-counts:', err?.message);
    return res.status(503).json({
      error: `Unable to load question counts: ${err?.message || 'Unknown error'}`,
      counts: null,
      detail: null
    });
  }
});

router.post('/subjects', requireAuth, requireRole('SUPER_ADMIN', 'EXAM_CELL'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subject_code, subject_name, department_id, academic_year_id, semester, regulation, status, year_of_study, faculty_name, faculty_department } = req.body;
    if (!subject_code || !subject_name || !department_id || !academic_year_id) return res.status(400).json({ error: 'subject_code, subject_name, department_id, academic_year_id are required.' });
    if (!semester) return res.status(400).json({ error: `Semester is required. Choose one of: ${SEMESTER_OPTIONS.join(', ')}.` });
    if (!isValidSemester(semester)) {
      return res.status(400).json({ error: `Invalid semester "${semester}". Choose one of: ${SEMESTER_OPTIONS.join(', ')}.` });
    }
    const client = getSupabaseClient();
    const [{ data: yr }, { data: dept }] = await Promise.all([
      client.from('academic_years').select('id, status').eq('id', academic_year_id).single(),
      client.from('departments').select('id, status').eq('id', department_id).single(),
    ]);
    if (!yr) return res.status(400).json({ error: 'Invalid academic year.' });
    if (!dept) return res.status(400).json({ error: 'Invalid department.' });
    if (yr.status === 'inactive') return res.status(400).json({ error: 'Academic year is inactive.' });
    if (dept.status === 'inactive') return res.status(400).json({ error: 'Department is inactive.' });
    
    const insertPayload: Record<string, any> = {
      subject_code: subject_code.trim().toUpperCase(),
      subject_name: subject_name.trim(),
      department_id,
      academic_year_id,
      semester: normalizeSemester(semester) || null,
      regulation: regulation?.trim() || null,
      status: status || 'active'
    };
    if (year_of_study !== undefined) insertPayload.year_of_study = year_of_study?.trim() || '3rd Year';
    if (faculty_name !== undefined) insertPayload.faculty_name = faculty_name?.trim() || null;
    if (faculty_department !== undefined) insertPayload.faculty_department = faculty_department?.trim() || null;

    const { data, error } = await client.from('subjects').insert(insertPayload).select('*, departments (id, department_code, department_name, short_name, hod_name, is_common), academic_years (id, year_label, start_year, end_year)').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Subject with this code already exists for the selected department and academic year.' });
      throw error;
    }
    auditLog(req, 'CREATE_SUBJECT', 'SUCCESS', { subject_code: data?.subject_code, subject_name: data?.subject_name });
    return res.status(201).json(data);
  } catch (err: any) {
    console.error('[masterData] POST subjects:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to create subject.' });
  }
});

router.put('/subjects/:id', requireAuth, requireRole('SUPER_ADMIN', 'EXAM_CELL'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { subject_code, subject_name, department_id, academic_year_id, semester, regulation, status, year_of_study, faculty_name, faculty_department } = req.body;
    if (semester !== undefined && !isValidSemester(semester)) {
      return res.status(400).json({ error: `Invalid semester "${semester}". Choose one of: ${SEMESTER_OPTIONS.join(', ')}.` });
    }
    const client = getSupabaseClient();
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (subject_code !== undefined) updates.subject_code = subject_code.trim().toUpperCase();
    if (subject_name !== undefined) updates.subject_name = subject_name.trim();
    if (department_id !== undefined) updates.department_id = department_id;
    if (academic_year_id !== undefined) updates.academic_year_id = academic_year_id;
    if (semester !== undefined) updates.semester = normalizeSemester(semester);
    if (regulation !== undefined) updates.regulation = regulation?.trim() || null;
    if (status !== undefined) updates.status = status;
    if (year_of_study !== undefined) updates.year_of_study = year_of_study?.trim() || null;
    if (faculty_name !== undefined) updates.faculty_name = faculty_name?.trim() || null;
    if (faculty_department !== undefined) updates.faculty_department = faculty_department?.trim() || null;
    const { data, error } = await client.from('subjects').update(updates).eq('id', id).select('*, departments (id, department_code, department_name, short_name, hod_name, is_common), academic_years (id, year_label, start_year, end_year)').single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Subject not found.' });
    const actionType = updates.status === 'inactive' ? 'DEACTIVATE_SUBJECT' : 'UPDATE_SUBJECT';
    auditLog(req, actionType, 'SUCCESS', { id, subject_code: data?.subject_code, subject_name: data?.subject_name });
    return res.json(data);
  } catch (err: any) {
    console.error('[masterData] PUT subjects:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to update subject.' });
  }
});

/**
 * A record that belongs to one specific subject and therefore either blocks a
 * subject deletion or can be removed together with it.
 */
interface SubjectDependency {
  key: string;
  table: string;
  label: string;
  count: number;
  /** Row ids, so a cascade removes exactly what was inspected. */
  ids: string[];
  /** What these records are, for the confirmation dialog. */
  hint: string;
}

/** Cached probe: does this table actually carry this column? */
const subjectColumnCache = new Map<string, boolean>();
async function hasColumn(client: any, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = subjectColumnCache.get(key);
  if (cached !== undefined) return cached;
  const { error } = await client.from(table).select(column).limit(1);
  const available = !error;
  subjectColumnCache.set(key, available);
  return available;
}

/**
 * Reads `id` plus whichever of the optional identity columns the table has.
 *
 * Paged explicitly: PostgREST caps a single response (typically 1000 rows) and
 * `questions` is far larger than that, so an unpaged read would silently hide
 * dependents behind the cap and let a deletion orphan them.
 */
async function readIdentityRows(client: any, table: string, optional: string[]): Promise<Array<Record<string, any>>> {
  const present = await Promise.all(optional.map(async (c) => ((await hasColumn(client, table, c)) ? c : null)));
  const columns = ['id', ...present.filter(Boolean) as string[]];
  const select = columns.join(', ');
  const PAGE = 1000;
  const rows: Array<Record<string, any>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select(select).order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`inspect ${table}: ${error.message}`);
    const page = (data || []) as Array<Record<string, any>>;
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/** Splits an id list so a single request never exceeds PostgREST's URL limits. */
function chunk<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A subject is uniquely identified by academic_year_id + department_id +
 * subject_code. The same subject_code legitimately exists under several
 * departments and academic years, so every lookup below is scoped to that exact
 * triple. Legacy rows only carry the denormalised `academic_year` /
 * `department` text columns, which are resolved back to the same triple before
 * matching — `question_banks.subject_id` is NULL for most imported banks and
 * can therefore never be the sole key.
 */
async function collectSubjectDependencies(
  client: any,
  subject: Record<string, any>,
  yearLabel: string | null,
  departmentCodes: string[]
): Promise<{ dependencies: SubjectDependency[]; bankIds: string[]; questionIds: string[]; iatBankIds: string[] }> {
  const subjectId = subject.id;
  const subjectCode = String(subject.subject_code || '').toUpperCase();
  const yearId = subject.academic_year_id;
  const departmentId = subject.department_id;

  const matchesSubject = (row: Record<string, any>): boolean => {
    if (row.subject_id) return row.subject_id === subjectId;
    if (String(row.subject_code || '').toUpperCase() !== subjectCode) return false;
    // Code matches — the year and department must match too.
    if (row.academic_year_id) return row.academic_year_id === yearId;
    if (row.academic_year) return row.academic_year === yearLabel;
    if (row.department_id) return row.department_id === departmentId;
    if (row.department) return departmentCodes.includes(String(row.department).toUpperCase());
    // No year or department recorded at all: fall back to ownership by code.
    return true;
  };

  // Question banks — both original and scrutinized/reduced ones.
  const banks = (await readIdentityRows(client, 'question_banks', [
    'subject_code', 'subject_id', 'academic_year', 'academic_year_id', 'department', 'department_id', 'parent_question_bank_id'
  ])).filter(matchesSubject);
  const bankIds = banks.map((b) => b.id);

  // Questions inside those banks, plus anything already linked by subject_id.
  const questions = (await readIdentityRows(client, 'questions', [
    'subject_id', 'question_bank_id', 'department_scope', 'department_id', 'department'
  ])).filter((q) =>
    (q.subject_id && q.subject_id === subjectId) ||
    (q.question_bank_id && bankIds.includes(q.question_bank_id))
  );
  const questionIds = questions.map((q) => q.id);

  const papers = (await readIdentityRows(client, 'generated_papers', [
    'subject_code', 'subject_id', 'academic_year', 'academic_year_id', 'department', 'department_id', 'paper_code'
  ])).filter(matchesSubject);
  const paperIds = papers.map((p) => p.id);
  const paperCodes = papers.map((p) => p.paper_code).filter(Boolean);

  // Question selection / usage mappings that belong to those papers.
  const usageRows = await readIdentityRows(client, 'question_usage_history', ['paper_id', 'paper_code', 'question_id']);
  const usage = usageRows.filter((u) =>
    (u.paper_id && paperIds.includes(u.paper_id)) ||
    (u.paper_code && paperCodes.includes(u.paper_code)) ||
    (u.question_id && questionIds.includes(u.question_id))
  );

  const iatBanks = (await readIdentityRows(client, 'iat_generated_question_banks', [
    'subject_code', 'subject_id', 'academic_year', 'academic_year_id', 'department', 'department_id'
  ])).filter(matchesSubject);
  const iatBankIds = iatBanks.map((b) => b.id);

  const setTracking = (await readIdentityRows(client, 'paper_set_tracking', [
    'subject_id', 'academic_year_id', 'department_id', 'exam_type', 'set_name', 'paper_code'
  ])).filter((r) =>
    (r.subject_id && r.subject_id === subjectId) ||
    (r.academic_year_id === yearId && r.department_id === departmentId && r.paper_code && paperCodes.includes(r.paper_code))
  );

  const requests = (await readIdentityRows(client, 'additional_paper_requests', ['subject_id', 'academic_year_id', 'department_id']))
    .filter((r) => r.subject_id === subjectId);
  const requestIds = requests.map((r) => r.id);

  const notifications = (await readIdentityRows(client, 'paper_request_notifications', ['request_id']))
    .filter((n) => n.request_id && requestIds.includes(n.request_id));

  const assignments = (await readIdentityRows(client, 'principal_paper_assignments', [
    'subject_id', 'academic_year_id', 'department_id', 'paper_code', 'set_name'
  ])).filter((r) =>
    (r.subject_id && r.subject_id === subjectId) ||
    (r.academic_year_id === yearId && r.department_id === departmentId && r.paper_code && paperCodes.includes(r.paper_code))
  );

  const dependencies: SubjectDependency[] = [];
  const push = (key: string, table: string, label: string, rows: Array<Record<string, any>>, hint: string) => {
    if (rows.length === 0) return;
    dependencies.push({ key, table, label, count: rows.length, ids: rows.map((r) => r.id), hint });
  };

  push('question_banks', 'question_banks', 'Question bank(s)', banks,
    'Original and/or scrutinized (reduced) question banks of this subject.');
  push('questions', 'questions', 'Question(s)', questions,
    'Questions stored inside those question banks.');
  push('generated_papers', 'generated_papers', 'Generated paper(s)', papers,
    'Papers already generated from this subject.');
  push('question_usage_history', 'question_usage_history', 'Question usage record(s)', usage,
    'Question selection / usage history of those generated papers.');
  push('iat_generated_question_banks', 'iat_generated_question_banks', 'IAT generated bank(s)', iatBanks,
    'Scrutinized / reduced banks generated from this subject.');
  push('paper_set_tracking', 'paper_set_tracking', 'Generated set tracking record(s)', setTracking,
    'Set tracking rows recorded for the generated sets.');
  push('additional_paper_requests', 'additional_paper_requests', 'Additional paper request(s)', requests,
    'Principal approval requests raised for this subject.');
  push('paper_request_notifications', 'paper_request_notifications', 'Request notification(s)', notifications,
    'Notifications belonging to those requests.');
  push('principal_paper_assignments', 'principal_paper_assignments', 'Principal paper assignment(s)', assignments,
    'Papers assigned to a principal for this subject.');

  return { dependencies, bankIds, questionIds, iatBankIds };
}

/**
 * DELETE /api/subjects/:id?cascade=true
 *
 * Without `cascade` the route only reports what still references the subject and
 * refuses, so nothing is ever deleted by surprise. With `cascade` it removes
 * exactly the records that belong exclusively to that subject — children first —
 * and still refuses when any of them is shared with another department or is
 * the source of a bank outside this subject.
 */
router.delete('/subjects/:id', requireAuth, requireRole('SUPER_ADMIN', 'EXAM_CELL'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const cascade = req.query.cascade === 'true' || (req.body && req.body.cascade === true);
    const client = getSupabaseClient();

    const { data: subject, error: fetchErr } = await client
      .from('subjects')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!subject) return res.status(404).json({ error: 'Subject not found.' });

    const [{ data: yr }, { data: dept }] = await Promise.all([
      subject.academic_year_id
        ? client.from('academic_years').select('id, year_label').eq('id', subject.academic_year_id).maybeSingle()
        : Promise.resolve({ data: null as any }),
      subject.department_id
        ? client.from('departments').select('id, department_code, short_name').eq('id', subject.department_id).maybeSingle()
        : Promise.resolve({ data: null as any }),
    ]);
    const yearLabel: string | null = yr?.year_label ?? null;
    // question_banks / iat_generated_question_banks store the department as text.
    const departmentCodes = [dept?.department_code, dept?.short_name]
      .filter(Boolean)
      .map((c) => String(c).toUpperCase());

    const found = await collectSubjectDependencies(client, subject, yearLabel, departmentCodes);
    const publicDeps = found.dependencies.map(({ key, table, label, count, hint }) => ({ key, table, label, count, hint }));
    const idsFor = (table: string) => found.dependencies.find((d) => d.table === table)?.ids || [];

    if (found.dependencies.length > 0) {
      if (!cascade) {
        const summary = found.dependencies.map((d) => `${d.count} ${d.label.toLowerCase()}`).join(', ');
        auditLog(req, 'DELETE_SUBJECT', 'FAILED', {
          id,
          subject_code: subject.subject_code,
          reason: 'dependent_records_exist',
          dependencies: found.dependencies.map((d) => ({ table: d.table, count: d.count }))
        });
        return res.status(409).json({
          error: `This subject still has dependent records (${summary}). They must be removed first, or deleted together with the subject.`,
          _action: 'blocked',
          dependencies: publicDeps
        });
      }

      // ---- refuse to touch anything that is not exclusive to this subject ----
      const conflicts: string[] = [];

      const bankParentIdCol = await hasColumn(client, 'question_banks', 'parent_question_bank_id');
      if (bankParentIdCol && found.bankIds.length > 0) {
        const allBanks = await readIdentityRows(client, 'question_banks', ['parent_question_bank_id']);
        const usedAsSource = allBanks.filter(
          (b: any) => b.parent_question_bank_id && found.bankIds.includes(b.parent_question_bank_id) && !found.bankIds.includes(b.id)
        );
        if (usedAsSource.length > 0) {
          conflicts.push(`${usedAsSource.length} bank(s) outside this subject were generated from its question bank(s)`);
        }
      }

      if (found.questionIds.length > 0 && await hasColumn(client, 'question_departments', 'question_id')) {
        const mappings = await readIdentityRows(client, 'question_departments', ['department_id']);
        const shared = mappings.filter(
          (m: any) => found.questionIds.includes(m.id) && m.department_id !== subject.department_id
        );
        if (shared.length > 0) {
          conflicts.push(`${shared.length} question(s) are shared with another department`);
        }
      }

      if (conflicts.length > 0) {
        auditLog(req, 'DELETE_SUBJECT', 'FAILED', { id, subject_code: subject.subject_code, reason: 'shared_records', conflicts });
        return res.status(409).json({
          error: `Deletion stopped to protect shared data: ${conflicts.join('; ')}.`,
          _action: 'blocked',
          dependencies: publicDeps
        });
      }

      // ---- dependency-ordered cascade: children before parents ----
      const remove = async (table: string, ids: string[], label: string) => {
        if (ids.length === 0) return;
        for (const batch of chunk(ids)) {
          const { error } = await client.from(table).delete().in('id', batch);
          if (error) throw new Error(`could not delete ${label} from ${table}: ${error.message}`);
        }
        console.log(`[masterData] subject cascade: removed ${ids.length} ${label} from ${table}`);
      };

      if (found.iatBankIds.length > 0 && await hasColumn(client, 'iat_generated_questions', 'generated_bank_id')) {
        const iatQuestionIds: string[] = [];
        for (const batch of chunk(found.iatBankIds)) {
          const { data, error } = await client.from('iat_generated_questions').select('id').in('generated_bank_id', batch);
          if (error) throw new Error(`inspect iat_generated_questions: ${error.message}`);
          iatQuestionIds.push(...(data || []).map((r: any) => r.id));
        }
        await remove('iat_generated_questions', iatQuestionIds, 'IAT generated question(s)');
      }
      await remove('paper_request_notifications', idsFor('paper_request_notifications'), 'request notification(s)');
      await remove('principal_paper_assignments', idsFor('principal_paper_assignments'), 'principal paper assignment(s)');
      await remove('question_usage_history', idsFor('question_usage_history'), 'question usage record(s)');
      await remove('generated_papers', idsFor('generated_papers'), 'generated paper(s)');
      await remove('paper_set_tracking', idsFor('paper_set_tracking'), 'generated set tracking record(s)');
      await remove('additional_paper_requests', idsFor('additional_paper_requests'), 'additional paper request(s)');
      await remove('iat_generated_question_banks', found.iatBankIds, 'IAT generated bank(s)');
      await remove('questions', found.questionIds, 'question(s)');
      await remove('question_banks', found.bankIds, 'question bank(s)');
    }

    const { error: delErr } = await client.from('subjects').delete().eq('id', id);
    if (delErr) {
      if (delErr.code === '23503') {
        return res.status(409).json({
          error: 'This subject is still referenced by other records and was not deleted.',
          _action: 'blocked',
          dependencies: publicDeps
        });
      }
      throw delErr;
    }

    auditLog(req, 'DELETE_SUBJECT', 'SUCCESS', {
      id,
      subject_code: subject.subject_code,
      subject_name: subject.subject_name,
      academic_year_id: subject.academic_year_id,
      department_id: subject.department_id,
      cascade,
      removed: found.dependencies.map((d) => ({ table: d.table, count: d.count }))
    });

    return res.json({
      id,
      _action: 'deleted',
      message: `Subject ${subject.subject_code} deleted.`,
      cascaded: found.dependencies.map(({ table, label, count }) => ({ table, label, count }))
    });
  } catch (err: any) {
    console.error('[masterData] DELETE subjects:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to delete subject.' });
  }
});

router.get('/question-dept-mappings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json([]);
    const { questionId } = req.query;
    if (!questionId) return res.status(400).json({ error: 'questionId is required.' });
    const client = getSupabaseClient();
    const { data, error } = await client.from('question_departments').select('*, departments(id, department_code, department_name)').eq('question_id', questionId as string);
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.post('/question-dept-mappings', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { questionId, departmentIds, scope } = req.body;
    if (!questionId || !Array.isArray(departmentIds) || departmentIds.length === 0) return res.status(400).json({ error: 'questionId and departmentIds[] are required.' });
    const client = getSupabaseClient();
    await client.from('question_departments').delete().eq('question_id', questionId);
    const rows = departmentIds.map((department_id: string) => ({ question_id: questionId, department_id }));
    const { error } = await client.from('question_departments').insert(rows);
    if (error) throw error;
    const resolvedScope = scope || (departmentIds.length > 1 ? 'COMMON' : 'SPECIFIC');
    await client.from('questions').update({ department_scope: resolvedScope }).eq('id', questionId);
    return res.json({ questionId, departmentIds, scope: resolvedScope });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.get('/stats/summary', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json({ academicYears: 0, departments: 0, subjects: 0, questionBanks: 0, generatedPapers: 0 });
    const client = getSupabaseClient();
    const [aResult, dResult, sResult, qbResult, gpResult] = await Promise.all([
      client.from('academic_years').select('*', { count: 'exact', head: true }),
      client.from('departments').select('*', { count: 'exact', head: true }),
      client.from('subjects').select('*', { count: 'exact', head: true }),
      client.from('question_banks').select('*', { count: 'exact', head: true }),
      client.from('generated_papers').select('*', { count: 'exact', head: true }),
    ]);
    return res.json({ academicYears: aResult.count ?? 0, departments: dResult.count ?? 0, subjects: sResult.count ?? 0, questionBanks: qbResult.count ?? 0, generatedPapers: gpResult.count ?? 0 });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.get('/exam-patterns', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) return res.json([]);
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('exam_pattern_configs')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    console.error('[masterData] GET exam-patterns:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to fetch exam patterns.' });
  }
});

/**
 * Computes the total marks of a pattern configuration and validates it
 * against the declared max_marks (Spec §1 — the system must validate the
 * total marks before allowing the pattern to be saved).
 */
function validatePatternTotals(params: {
  maxMarks: number;
  partA?: any;
  partB?: any;
  partC?: any;
}): { valid: boolean; computed: number; breakdown: string; error?: string } {
  const count = (v: any, fallback = 0) => (v === undefined || v === null || v === '' ? fallback : Number(v));
  const partA = params.partA || {};
  const partB = params.partB || {};
  const partC = params.partC || null;

  const aCount = count(partA.count, partA.totalQuestions);
  const aMarks = count(partA.marks_per_question, partA.marksPerQuestion);
  const partATotal = aCount * aMarks;

  let partBTotal = 0;
  let partBSummary = '';
  if (partB.format === 'sections' && Array.isArray(partB.sections) && partB.sections.length > 0) {
    const lines = partB.sections.map((s: any) => {
      const answer = count(s.answer_count, 0);
      const perQ = count(s.marks_per_question, partB.marks_per_question);
      const subtotal = answer * perQ;
      partBTotal += subtotal;
      return `${s.name || 'Section'}: ${answer} × ${perQ} = ${subtotal}`;
    });
    partBSummary = lines.join(' + ');
  } else {
    const orPairs = count(partB.or_pairs, count(partB.orQuestionsCount, 0));
    const perQ = count(partB.marks_per_question, partB.marksPerQuestion);
    partBTotal = orPairs * perQ;
    partBSummary = `Part B: ${orPairs} × ${perQ} = ${partBTotal}`;
  }

  let partCTotal = 0;
  let partCSummary = '';
  if (partC && partC.enabled !== false) {
    const cCount = count(partC.count, 0);
    const cMarks = count(partC.marks_per_question, 0);
    partCTotal = cCount * cMarks;
    partCSummary = `Part C: ${cCount} × ${cMarks} = ${partCTotal}`;
  }

  const computed = partATotal + partBTotal + partCTotal;
  const breakdown = [
    `Part A: ${aCount} × ${aMarks} = ${partATotal}`,
    partBSummary,
    ...(partCSummary ? [partCSummary] : [])
  ].filter(Boolean).join(' + ');

  const valid = computed === Number(params.maxMarks);
  return {
    valid,
    computed,
    breakdown,
    error: valid
      ? undefined
      : `Total marks mismatch: Part A + Part B${partCSummary ? ' + Part C' : ''} = ${computed} marks, but Total Marks is set to ${params.maxMarks}. Adjust the section counts, questions to answer, or marks per question so the totals match.`
  };
}

/**
 * PUT /api/exam-patterns/:id
 * The Exam Cell may edit IAT I, IAT II and End Semester patterns (Spec §1).
 * Super Admin retains full control.
 */
router.put('/exam-patterns/:id', requireAuth, requireRole('EXAM_CELL', 'SUPER_ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      exam_name,
      duration,
      max_marks,
      regulation,
      show_bl_co_pi,
      show_course_obj,
      part_a_config,
      part_b_config,
      part_c_config,
      instructions,
      status
    } = req.body;

    // ---- Server-side total marks validation (Spec §1) ----
    if (max_marks !== undefined || part_a_config !== undefined || part_b_config !== undefined || part_c_config !== undefined) {
      const client0 = getSupabaseClient();
      const { data: current } = await client0
        .from('exam_pattern_configs')
        .select('max_marks, part_a_config, part_b_config, part_c_config, exam_type')
        .eq('id', id)
        .maybeSingle();

      if (!current) return res.status(404).json({ error: 'Exam pattern not found.' });

      const effectiveMax = max_marks !== undefined ? Number(max_marks) : Number(current.max_marks);
      const effectiveA = part_a_config !== undefined ? part_a_config : current.part_a_config;
      const effectiveB = part_b_config !== undefined ? part_b_config : current.part_b_config;
      const effectiveC = part_c_config !== undefined ? part_c_config : current.part_c_config;

      if (!Number.isFinite(effectiveMax) || effectiveMax <= 0) {
        return res.status(400).json({ error: 'Total Marks must be a positive number.' });
      }

      const check = validatePatternTotals({
        maxMarks: effectiveMax,
        partA: effectiveA,
        partB: effectiveB,
        partC: effectiveC
      });

      if (!check.valid) {
        auditLog(req, 'EXAM_PATTERN_EDIT_REJECTED', 'FAILED', {
          id,
          exam_type: current.exam_type,
          computedTotal: check.computed,
          declaredTotal: effectiveMax,
          breakdown: check.breakdown
        });
        return res.status(400).json({ error: check.error, computedTotal: check.computed, declaredTotal: effectiveMax, breakdown: check.breakdown });
      }
    }

    const client = getSupabaseClient();
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (exam_name !== undefined) updates.exam_name = exam_name;
    if (duration !== undefined) updates.duration = duration;
    if (max_marks !== undefined) updates.max_marks = max_marks;
    if (regulation !== undefined) updates.regulation = regulation;
    if (show_bl_co_pi !== undefined) updates.show_bl_co_pi = show_bl_co_pi;
    if (show_course_obj !== undefined) updates.show_course_obj = show_course_obj;
    if (part_a_config !== undefined) updates.part_a_config = part_a_config;
    if (part_b_config !== undefined) updates.part_b_config = part_b_config;
    if (part_c_config !== undefined) updates.part_c_config = part_c_config;
    if (instructions !== undefined) updates.instructions = instructions;
    if (status !== undefined) updates.status = status;

    const { data, error } = await client
      .from('exam_pattern_configs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Exam pattern not found.' });
    // Spec §19 — "Pattern edited"
    auditLog(req, 'EXAM_PATTERN_EDITED', 'SUCCESS', {
      id,
      exam_type: data.exam_type,
      exam_name: data.exam_name,
      max_marks: data.max_marks,
      duration: data.duration
    });
    return res.json(data);
  } catch (err: any) {
    console.error('[masterData] PUT exam-patterns:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to update exam pattern.' });
  }
});

export default router;
