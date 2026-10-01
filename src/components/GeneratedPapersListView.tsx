import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  Eye,
  Sparkles,
  FileSpreadsheet,
  Download,
  ShieldCheck,
  FileDown,
  RefreshCw,
  AlertTriangle,
  Inbox
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { GeneratedPaper, PaperQuestionItem, PaperStatus, Question } from '../types';
import { exportToWordDocument } from '../utils/exportUtils';
import { paperFileName } from '../utils/paperFileName';
import {
  auditPaperDownload,
  fetchAcademicYears,
  fetchDepartments,
  AcademicYearRecord,
  DepartmentRecord
} from '../services/authApi';
import {
  fetchGeneratedPapers,
  ArchivedGeneratedPaper,
  ArchivedPaperQuestion
} from '../services/generatedPapersApi';

const ALL = 'all';

/** Statuses the archive can hold (mirrors the generated_papers CHECK list). */
const STATUS_BADGES: Record<string, string> = {
  Finalized: 'bg-[#EAF3FF] text-[#1976D2] border-[#1976D2]/30',
  Approved: 'bg-[#ECFDF3] text-[#027A48] border-[#027A48]/30',
  'HOD Review': 'bg-[#FFF8E7] text-[#B45309] border-[#F59E0B]/30',
  'Faculty Reviewed': 'bg-[#FFF8E7] text-[#B45309] border-[#F59E0B]/30',
  Rejected: 'bg-[#FFF0F3] text-[#D71945] border-[#D71945]/30'
};

/**
 * Rebuilds a full Question object from a stored selection so the preview, print
 * and Word export render exactly what was printed. The stored question id stays
 * authoritative — nothing unrelated is substituted.
 */
function toQuestion(row: ArchivedPaperQuestion, paper: ArchivedGeneratedPaper): Question {
  const bloomsLevel = (row.btl || 'K1') as Question['bloomsLevel'];
  return {
    id: row.question_id || row.iat_question_id || `${paper.id}-${row.order_index}`,
    subjectCode: paper.subject_code || '',
    unit: Number(row.unit) || 1,
    topic: paper.subject_name || '',
    part: (row.part || 'Part A') as Question['part'],
    marks: Number(row.marks) || 0,
    questionText: row.question_text || '',
    bloomsLevel,
    bl: bloomsLevel,
    co: row.co || '',
    pi: row.pi || '',
    difficulty: 'Medium',
    allowedFor: { internal1: true, internal2: true, endSem: true },
    usageHistory: {
      internal1: false,
      internal2: false,
      endSem: false,
      timesUsed: 0,
      lastUsedDate: '',
      lastUsedPaperCode: ''
    } as Question['usageHistory'],
    status: 'Approved',
    createdBy: paper.generated_by || '',
    createdDate: (paper.generated_at || '').split('T')[0] || '',
    questionNumber: row.question_number || undefined,
    questionBankId: row.question_bank_id || undefined,
    academicYear: paper.academic_year || undefined,
    department: paper.department || undefined
  };
}

/** Archived row -> the shape the preview and exporters expect. */
export function archivedPaperToGeneratedPaper(row: ArchivedGeneratedPaper): GeneratedPaper {
  const toItem = (q: ArchivedPaperQuestion): PaperQuestionItem => ({
    questionId: q.question_id || q.iat_question_id || '',
    questionNumber: q.question_number || String(q.order_index),
    question: toQuestion(q, row)
  });

  const items = [...(row.questions || [])].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  const byPart = (part: string): PaperQuestionItem[] =>
    items.filter(q => (q.part || '').toUpperCase().includes(part)).map(toItem);

  return {
    id: row.id,
    paperCode: row.paper_code,
    subjectCode: row.subject_code || row.subject_code_label || '',
    subjectName: row.subject_name || row.subject_name_label || '',
    department: row.department || row.department_label || '',
    departmentName: row.department_name || undefined,
    semester: row.semester || '',
    regulation: row.regulation || '',
    examType: row.exam_type as GeneratedPaper['examType'],
    examDate: row.exam_date || '',
    duration: row.duration || '',
    maxMarks: Number(row.max_marks) || 0,
    academicYear: row.academic_year || row.academic_year_label || '',
    status: (row.status || 'Draft') as PaperStatus,
    createdBy: row.created_by || row.generated_by || '',
    createdDate: (row.generated_at || row.created_at || '').split('T')[0],
    approvedBy: row.approved_by || undefined,
    yearOfStudy: row.year_of_study || undefined,
    partAQuestions: byPart('PART A'),
    partBQuestions: byPart('PART B'),
    partCQuestions: byPart('PART C'),
    validationPassed: true,
    validationIssues: [],
    setLetter: row.set_letter || undefined,
    setName: row.set_name || (row.set_letter ? `Set ${row.set_letter}` : undefined),
    setDisplayName: row.set_display_name || undefined,
    fileName: row.file_name || undefined,
    principalApprovalRequired: row.principal_approval_required,
    principalApprovalStatus: (row.principal_approval_status || undefined) as GeneratedPaper['principalApprovalStatus'],
    generatedBy: row.generated_by || undefined,
    generatedAt: row.generated_at || undefined,
    subjectId: row.subject_id,
    academicYearId: row.academic_year_id,
    departmentId: row.department_id,
    questionBankSource: row.question_bank_source === 'IAT_GENERATED' ? 'IAT_GENERATED' : 'ORIGINAL',
    questionBankId: row.question_bank_id || row.iat_generated_bank_id || undefined,
    iatGeneratedBankId: row.iat_generated_bank_id,
    iatGeneratedBankName: row.iat_generated_bank_name
  } as GeneratedPaper;
}

export const GeneratedPapersListView: React.FC = () => {
  const {
    dbSubjects,
    examPatterns,
    setActivePaper,
    loadArchivedPaper,
    setActiveTab,
    setPaperToReviewId,
    authToken,
    showToast,
    selectedAcademicYear: sharedAcademicYearLabel,
    setSelectedAcademicYear: setSharedAcademicYearLabel
  } = useApp();

  // ---- master data for the filters, always read from the database ----
  const [years, setYears] = useState<AcademicYearRecord[]>([]);
  const [depts, setDepts] = useState<DepartmentRecord[]>([]);

  useEffect(() => {
    Promise.all([fetchAcademicYears(false), fetchDepartments(false)]).then(([y, d]) => {
      setYears(y);
      setDepts(d);
    });
  }, []);

  // ---- server state ----
  const [papers, setPapers] = useState<ArchivedGeneratedPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mappingsAvailable, setMappingsAvailable] = useState(true);

  // ---- filters (all options come from the database) ----
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [yearId, setYearId] = useState<string>(ALL);
  const [deptId, setDeptId] = useState<string>(ALL);
  const [subjectId, setSubjectId] = useState<string>(ALL);
  const [examType, setExamType] = useState<string>(ALL);
  const [setLetter, setSetLetter] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Academic year is shared application state so the wizard and this page agree.
  // The shared value is a year LABEL, the filter works on the year ID.
  useEffect(() => {
    if (!sharedAcademicYearLabel || yearId !== ALL) return;
    const match = years.find(y => y.year_label === sharedAcademicYearLabel);
    if (match) setYearId(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedAcademicYearLabel, years]);

  useEffect(() => {
    if (yearId === ALL) return;
    const match = years.find(y => y.id === yearId);
    if (match && match.year_label !== sharedAcademicYearLabel) {
      setSharedAcademicYearLabel(match.year_label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearId]);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchGeneratedPapers({
      academicYearId: yearId === ALL ? undefined : yearId,
      departmentId: deptId === ALL ? undefined : deptId,
      subjectId: subjectId === ALL ? undefined : subjectId,
      examType: examType === ALL ? undefined : examType,
      setLetter: setLetter === ALL ? undefined : setLetter,
      status: status === ALL ? undefined : status,
      search: debouncedSearch || undefined
    }, authToken || undefined);
    setPapers(result.papers);
    setLoadError(result.error || null);
    setMappingsAvailable(result.questionMappingsAvailable);
    setLoading(false);
  }, [yearId, deptId, subjectId, examType, setLetter, status, debouncedSearch, authToken]);

  useEffect(() => { load(); }, [load]);

  // Changing year or department invalidates the subject selection.
  useEffect(() => { setSubjectId(ALL); }, [yearId, deptId]);

  // ---- filter options, all database-derived ----
  const yearOptions = useMemo(
    () => years.map(y => ({ id: y.id, label: y.year_label })),
    [years]
  );
  const deptOptions = useMemo(
    () => depts.map(d => ({ id: d.id, label: d.department_code })),
    [depts]
  );
  const subjectOptions = useMemo(() => {
    return (dbSubjects || [])
      .filter(s => (yearId === ALL || s.academic_year_id === yearId) && (deptId === ALL || s.department_id === deptId))
      .map(s => ({ id: s.id, label: `${s.subject_code} – ${s.subject_name}` }));
  }, [dbSubjects, yearId, deptId]);
  // Exam types come from the exam pattern configuration, never hardcoded.
  const examTypeOptions = useMemo(() => {
    const fromPatterns = (examPatterns || []).map(p => p.examType).filter(Boolean);
    const fromArchive = papers.map(p => p.exam_type).filter(Boolean);
    return Array.from(new Set<string>([...fromPatterns, ...fromArchive])).sort();
  }, [examPatterns, papers]);
  // Sets come from the records that actually exist in the archive.
  const setOptions = useMemo(
    () => Array.from(new Set(papers.map(p => (p.set_letter || '').trim().toUpperCase()).filter(Boolean))).sort(),
    [papers]
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(papers.map(p => p.status).filter(Boolean))).sort(),
    [papers]
  );

  const openPaper = (row: ArchivedGeneratedPaper) => {
    const paper = archivedPaperToGeneratedPaper(row);
    loadArchivedPaper(paper);
    setActivePaper(paper);
    setPaperToReviewId(row.id);
    setActiveTab('generate-paper');
  };

  const handleWordDownload = (row: ArchivedGeneratedPaper) => {
    const paper = archivedPaperToGeneratedPaper(row);
    exportToWordDocument(paper);
    const fileName = paperFileName(paper, 'docx');
    auditPaperDownload({
      paperCode: row.paper_code,
      examType: row.exam_type,
      setLetter: row.set_letter,
      subjectCode: row.subject_code,
      format: 'docx',
      fileName
    }, authToken || '');
    showToast(`Downloaded ${fileName}`);
  };

  const handlePdfDownload = (row: ArchivedGeneratedPaper) => {
    const paper = archivedPaperToGeneratedPaper(row);
    openPaper(row);
    showToast(`Use "Download PDF" in the preview to save ${paperFileName(paper, 'pdf')}.`);
  };

  const resetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setYearId(ALL);
    setSharedAcademicYearLabel('');
    setDeptId(ALL);
    setSubjectId(ALL);
    setExamType(ALL);
    setSetLetter(ALL);
    setStatus(ALL);
  };

  const selectClass = 'w-full rounded-xl border border-slate-200 bg-[#F7F8FA] px-2.5 py-2 text-xs font-bold text-slate-900 focus:border-[#D71945] focus:bg-white focus:outline-hidden';

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
            Exam Paper Archives
          </span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Generated Question Papers
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Read directly from the database. Every row is a stored Supabase record together with the
            questions it selected.
          </p>
        </div>

        <button
          onClick={() => setActiveTab('generate-paper')}
          className="flex items-center gap-2 rounded-xl bg-[#D71945] px-4 py-2.5 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          <Sparkles className="h-4 w-4" />
          <span>Generate New Paper</span>
        </button>
      </div>

      {/* Filters — every option is loaded from the database */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-[#94A3B8]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by paper code, subject code, subject name or set title..."
              className="w-full rounded-xl border border-slate-200 bg-[#F7F8FA] pl-10 pr-4 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#D71945] transition-colors cursor-pointer disabled:opacity-50"
              title="Reload from the database"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-bold text-slate-500 hover:text-[#D71945] transition-colors cursor-pointer shrink-0"
            >
              Reset Filters
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Academic Year</label>
            <select value={yearId} onChange={e => setYearId(e.target.value)} className={selectClass}>
              <option value={ALL}>All Academic Years</option>
              {yearOptions.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Department</label>
            <select value={deptId} onChange={e => setDeptId(e.target.value)} className={selectClass}>
              <option value={ALL}>All Departments</option>
              {deptOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Subject</label>
            <select
              value={subjectId}
              onChange={e => setSubjectId(e.target.value)}
              disabled={subjectOptions.length === 0}
              className={`${selectClass} disabled:opacity-60`}
            >
              <option value={ALL}>All Subjects</option>
              {subjectOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Exam Type</label>
            <select value={examType} onChange={e => setExamType(e.target.value)} className={selectClass}>
              <option value={ALL}>All Exam Types</option>
              {examTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Question Paper Set</label>
            <select value={setLetter} onChange={e => setSetLetter(e.target.value)} className={selectClass}>
              <option value={ALL}>All Sets</option>
              {setOptions.map(s => <option key={s} value={s}>Set {s}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className={selectClass}>
              <option value={ALL}>All Statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-600">
          <span>
            Found <span className="text-[#D71945] font-black">{papers.length}</span> question {papers.length === 1 ? 'paper' : 'papers'}
          </span>
          <span className="text-[11px] font-medium text-slate-400">
            {loading ? 'Loading from the database…' : 'Ordered by generation date'}
          </span>
        </div>

        {!mappingsAvailable && (
          <p className="text-[11px] leading-relaxed text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Question selections are not being stored yet — apply{' '}
            <span className="font-mono">supabase/migrations/016_generated_paper_questions.sql</span> in the Supabase
            SQL Editor to enable them.
          </p>
        )}
      </div>

      {/* Error state — never fall back to fake records */}
      {loadError ? (
        <div role="alert" className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
          <AlertTriangle className="h-10 w-10 mx-auto text-red-500 mb-3" />
          <p className="text-sm font-bold text-red-800">Generated papers could not be loaded</p>
          <p className="mt-1 text-xs text-red-700/80">{loadError}</p>
          <button
            onClick={() => load()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      ) : (
        /* Table */
        <div className="overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA] text-[#64748B] font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4">Academic Year</th>
                  <th className="py-3.5 px-3">Dept</th>
                  <th className="py-3.5 px-3">Subject Code</th>
                  <th className="py-3.5 px-4 min-w-[200px]">Subject Name &amp; Set Title</th>
                  <th className="py-3.5 px-3">Exam Type</th>
                  <th className="py-3.5 px-3 text-center">Set</th>
                  <th className="py-3.5 px-3">Questions</th>
                  <th className="py-3.5 px-3">Generated Date</th>
                  <th className="py-3.5 px-3">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-500">
                      Loading generated papers from the database…
                    </td>
                  </tr>
                ) : papers.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center">
                      <Inbox className="h-10 w-10 mx-auto text-[#D1D5DB] mb-3" />
                      <p className="text-sm font-bold text-slate-700">No generated question papers found.</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Generate a question paper and finalize it — it will appear here from the database.
                      </p>
                      <button
                        onClick={() => setActiveTab('generate-paper')}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#D71945] px-4 py-2.5 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] transition-all"
                      >
                        <Sparkles className="h-4 w-4" /> Generate New Paper
                      </button>
                    </td>
                  </tr>
                ) : (
                  papers.map((paper) => {
                    const letter = paper.set_letter || 'A';
                    const displayName = paper.set_display_name || `${paper.subject_name || paper.subject_code || ''} – Set ${letter}`;
                    const generatedOn = (paper.generated_at || paper.created_at || '').split('T')[0];

                    return (
                      <tr key={paper.id} className="hover:bg-[#F7F8FA] transition-colors">
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                            {paper.academic_year_label || paper.academic_year || '—'}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 font-bold text-slate-700 whitespace-nowrap">
                          {paper.department_label || paper.department || '—'}
                        </td>

                        <td className="py-3.5 px-3 font-mono font-extrabold text-[#D71945] whitespace-nowrap">
                          {paper.subject_code_label || paper.subject_code || '—'}
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-extrabold text-[#111827]">{displayName}</div>
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            Code: {paper.paper_code}
                            {paper.max_marks ? ` • Max: ${paper.max_marks}M` : ''}
                          </div>
                          <div className="mt-1 inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600 uppercase">
                            {paper.question_bank_type === 'reduced' ? 'Scrutinized Bank' : 'Original Bank'}
                          </div>
                          {paper.principal_approval_required && (
                            <span className="mt-1 ml-1 inline-flex items-center gap-1 rounded-md bg-purple-100 text-purple-800 px-2 py-0.5 text-[9px] font-bold">
                              <ShieldCheck className="h-3 w-3" /> Principal Approved
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            paper.exam_type === 'End Semester Examination'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-rose-100 text-[#D71945]'
                          }`}>
                            {paper.exam_type || '—'}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-center whitespace-nowrap">
                          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-[#1976D2] text-white font-black text-xs shadow-xs">
                            {letter}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-slate-700 whitespace-nowrap font-bold">
                          {paper.question_count}
                        </td>

                        <td className="py-3.5 px-3 text-slate-600 whitespace-nowrap text-[11px]">
                          {generatedOn || '—'}
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGES[paper.status] || 'bg-[#F1F5F9] text-[#64748B] border-[#CBD5E1]'}`}>
                            {paper.status}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleWordDownload(paper)}
                              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                              title="Download Word document"
                            >
                              <FileSpreadsheet className="h-3.5 w-3.5 text-blue-600" />
                              <span>Word</span>
                            </button>
                            <button
                              onClick={() => handlePdfDownload(paper)}
                              className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-[#FFF0F3] px-2.5 py-1 text-xs font-bold text-[#D71945] hover:bg-[#FFE0E6] transition-colors cursor-pointer"
                              title="Download PDF from the preview"
                            >
                              <FileDown className="h-3.5 w-3.5" />
                              <span>PDF</span>
                            </button>
                            <button
                              onClick={() => openPaper(paper)}
                              className="inline-flex items-center gap-1 rounded-xl bg-[#EAF3FF] px-3 py-1 text-xs font-bold text-[#1976D2] hover:bg-[#1976D2] hover:text-white transition-colors cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>View / Print</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};