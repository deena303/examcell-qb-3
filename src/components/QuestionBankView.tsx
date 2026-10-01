import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Database,
  Plus,
  Search,
  Filter,
  Eye,
  Edit2,
  Trash2,
  CheckCircle2,
  Clock,
  BookOpen,
  Tag,
  Check,
  X,
  History,
  Info,
  UploadCloud,
  Sparkles,
  ArrowRight,
  ScanLine,
  FileText,
  Layers,
  ChevronDown
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AddQuestionModal } from './AddQuestionModal';
import { AddQuestionBankModal } from './AddQuestionBankModal';
import {
  fetchQuestionBanks,
  fetchQuestionsForBank,
  mapDbQuestion,
  QuestionBankListRow
} from '../services/questionBankApi';
import { Question, QuestionPart } from '../types';
import { INITIAL_QUESTIONS } from '../data/initialData';

/**
 * Ids of the bundled offline demo fixtures.
 *
 * These are placeholder rows used only so the UI is not empty before a database
 * is reachable. They are NEVER real question-bank data, so they are excluded
 * from the database-backed Questions Explorer — otherwise a fresh production
 * session would show invented questions next to the real ones.
 */
const DEMO_QUESTION_IDS = new Set(INITIAL_QUESTIONS.map((q) => q.id));

export const QuestionBankView: React.FC = () => {
  const {
    subjects,
    dbSubjects,
    departments,
    academicYears,
    academicYearsList,
    departmentsList,
    questions,
    selectedSubjectCode,
    setSelectedSubjectCode,
    deleteQuestion,
    currentUser,
    setActiveTab,
    authToken
  } = useApp();

  const dbSubjectsMapped = useMemo(() => {
    return dbSubjects
      .filter(s => s.status === 'active')
      .map(s => ({
        id: s.id,
        code: s.subject_code,
        name: s.subject_name,
        department: s.departments?.department_code || departmentsList.find(d => d.id === s.department_id)?.department_code || '',
        semester: s.semester || '',
        regulation: s.regulation || 'Regulation 2024',
        totalQuestions: 0,
        status: 'Active' as const,
        academicYear: s.academic_years?.year_label || academicYearsList.find(y => y.id === s.academic_year_id)?.year_label || '',
        units: []
      }));
  }, [dbSubjects, departmentsList, academicYearsList]);

  const subjectPool = dbSubjectsMapped.length > 0 ? dbSubjectsMapped : subjects;

  // Top Filter Bar State
  const [filterAcademicYear, setFilterAcademicYear] = useState<string>('all');
  const [filterDepartment, setFilterDepartment] = useState<string>('all');
  const [filterSubjectCode, setFilterSubjectCode] = useState<string>('all');

  // Question Banks from Supabase backend
  const [questionBanks, setQuestionBanks] = useState<QuestionBankListRow[]>([]);
  const [loadingBanks, setLoadingBanks] = useState<boolean>(true);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);

  // Questions of the selected bank, loaded from the database (not from the
  // browser cache) so a fresh production session shows the real questions.
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState<boolean>(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  /**
   * Local, in-session overrides layered on top of the database rows.
   *
   * The database is the source of truth for the question list, but the existing
   * single-question Add / Edit / Delete actions are local (they update the
   * in-memory store only). These overrides keep those actions working on top of
   * the database-backed list without ever mixing in another bank.
   */
  const [localQuestionOverrides, setLocalQuestionOverrides] = useState<
    Record<string, { deleted?: boolean; patch?: Partial<Question> }>
  >({});

  /** Replaces a question's row in the DB-backed list. */
  const patchDisplayedQuestion = useCallback((id: string, patch: Partial<Question>) => {
    setLocalQuestionOverrides((prev) => ({ ...prev, [id]: { ...prev[id], patch } }));
  }, []);

  /** Hides a question row after a delete. */
  const hideDisplayedQuestion = useCallback((id: string) => {
    setLocalQuestionOverrides((prev) => ({ ...prev, [id]: { ...prev[id], deleted: true } }));
  }, []);

  /**
   * Fetches ORIGINAL question banks. The Academic Year + Department + Subject
   * Code selection is sent to the server, which applies it authoritatively, so
   * the listing can never mix another year / department / subject.
   */
  useEffect(() => {
    if (!authToken) {
      setQuestionBanks([]);
      setLoadingBanks(false);
      return;
    }
    let isMounted = true;
    setLoadingBanks(true);
    setBanksError(null);
    fetchQuestionBanks(authToken, {
      academicYear: filterAcademicYear,
      department: filterDepartment,
      subjectCode: filterSubjectCode
    })
      .then(rows => {
        if (!isMounted) return;
        setQuestionBanks(rows);
        setSelectedBankId(prev => (prev && rows.some(b => b.id === prev) ? prev : null));
      })
      .catch(err => {
        if (!isMounted) return;
        setQuestionBanks([]);
        setBanksError(err?.message || 'Failed to load question banks.');
      })
      .finally(() => {
        if (isMounted) setLoadingBanks(false);
      });
    return () => {
      isMounted = false;
    };
  }, [authToken, filterAcademicYear, filterDepartment, filterSubjectCode]);

  // Questions Explorer state
  const [activeTab, setLocalActiveTab] = useState<'Overview' | 'Part A' | 'Part B' | 'Part C' | 'Usage History'>('Overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<string>('all');
  const [selectedBlooms, setSelectedBlooms] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [viewQuestionModal, setViewQuestionModal] = useState<Question | null>(null);

  // Filtered subjects for the top dropdown — scoped to the selected year/dept.
  const availableSubjects = useMemo(() => {
    return subjectPool.filter(s => {
      if (filterDepartment !== 'all' && s.department !== filterDepartment) return false;
      if (filterAcademicYear !== 'all' && s.academicYear && s.academicYear !== filterAcademicYear) return false;
      return true;
    });
  }, [subjectPool, filterDepartment, filterAcademicYear]);

  // The subject record that matches the FULL Academic Year + Department + Code
  // identity. A subject code alone is never enough to identify a subject.
  const selectedSubjectRecord = useMemo(() => {
    if (filterSubjectCode === 'all') return undefined;
    return dbSubjects.find(
      s =>
        s.subject_code === filterSubjectCode &&
        (filterDepartment === 'all' || (s.departments?.department_code || departmentsList.find(d => d.id === s.department_id)?.department_code) === filterDepartment) &&
        (filterAcademicYear === 'all' || (s.academic_years?.year_label || academicYearsList.find(y => y.id === s.academic_year_id)?.year_label) === filterAcademicYear)
    );
  }, [dbSubjects, filterSubjectCode, filterDepartment, filterAcademicYear, departmentsList, academicYearsList]);

  const currentSubject = selectedSubjectRecord
    ? {
        id: selectedSubjectRecord.id,
        code: selectedSubjectRecord.subject_code,
        name: selectedSubjectRecord.subject_name,
        department: filterDepartment,
        academicYear: filterAcademicYear
      }
    : (() => {
        const fallback = availableSubjects.find(s => s.code === selectedSubjectCode) || subjectPool[0];
        return fallback;
      })();

  // The bank currently being inspected.
  const selectedBank = useMemo(
    () => questionBanks.find(b => b.id === selectedBankId) ?? null,
    [questionBanks, selectedBankId]
  );

  const visibleBanks = useMemo(
    () => (selectedBank ? questionBanks.filter(b => b.id === selectedBank.id) : questionBanks),
    [questionBanks, selectedBank]
  );

  // Load the questions of the selected bank.
  useEffect(() => {
    if (!authToken || !selectedBankId) {
      setBankQuestions([]);
      setQuestionsError(null);
      return;
    }
    let cancelled = false;
    setLoadingQuestions(true);
    setQuestionsError(null);
    fetchQuestionsForBank(authToken, selectedBankId)
      .then(rows => {
        if (cancelled) return;
        setBankQuestions(rows.map(mapDbQuestion));
      })
      .catch(err => {
        if (cancelled) return;
        setBankQuestions([]);
        setQuestionsError(err?.message || 'Failed to load the questions of this question bank.');
      })
      .finally(() => !cancelled && setLoadingQuestions(false));
    return () => {
      cancelled = true;
    };
  }, [authToken, selectedBankId]);

  // Drop in-session overrides whenever a different bank is opened.
  useEffect(() => {
    setLocalQuestionOverrides({});
  }, [selectedBankId]);

  /**
   * Questions shown in the explorer.
   *
   * The database rows of the selected bank are authoritative. Locally added
   * questions (not yet in the database) are appended, and local edits/deletes
   * are layered on top — all still restricted to the selected Academic Year +
   * Department + Subject Code + question bank.
   */
  const subjectQuestions = useMemo(() => {
    const scopeCode = selectedBank
      ? selectedBank.subject_code
      : (currentSubject?.code || '');

    // Locally added questions that are not in the database yet, matched to the
    // same subject / department / academic year scope.
    const knownIds = new Set(bankQuestions.map((q) => q.id));
    const localAdditions = questions.filter((q) => {
      if (knownIds.has(q.id)) return false;
      if (DEMO_QUESTION_IDS.has(q.id)) return false;  // offline placeholder data
      if (q.questionBankId) return false;             // belongs to a different bank
      if (!scopeCode || q.subjectCode !== scopeCode) return false;
      if (q.department && filterDepartment !== 'all' && q.department !== filterDepartment) return false;
      if (q.academicYear && filterAcademicYear !== 'all' && q.academicYear !== filterAcademicYear) return false;
      return true;
    });

    const base = selectedBankId ? bankQuestions : localAdditions;

    return base
      .filter((q) => !localQuestionOverrides[q.id]?.deleted)
      .map((q) => {
        const patch = localQuestionOverrides[q.id]?.patch;
        return patch ? { ...q, ...patch } : q;
      });
  }, [
    bankQuestions,
    questions,
    currentSubject,
    selectedBank,
    selectedBankId,
    filterDepartment,
    filterAcademicYear,
    localQuestionOverrides
  ]);

  // Filter by Tab
  const tabFiltered = useMemo(() => {
    return subjectQuestions.filter(q => {
      if (activeTab === 'Part A') return q.part === 'Part A';
      if (activeTab === 'Part B') return q.part === 'Part B';
      if (activeTab === 'Part C') return q.part === 'Part C';
      return true; // Overview & Usage History
    });
  }, [subjectQuestions, activeTab]);

  // Filter by Search & controls
  const filteredQuestions = useMemo(() => {
    return tabFiltered.filter(q => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchText = q.questionText.toLowerCase().includes(query);
        const matchTopic = q.topic.toLowerCase().includes(query);
        const matchId = q.id.toLowerCase().includes(query);
        if (!matchText && !matchTopic && !matchId) return false;
      }
      if (selectedUnit !== 'all' && q.unit !== Number(selectedUnit)) return false;
      if (selectedBlooms !== 'all' && q.bloomsLevel !== selectedBlooms) return false;
      if (selectedStatus !== 'all' && q.status !== selectedStatus) return false;
      return true;
    });
  }, [tabFiltered, searchQuery, selectedUnit, selectedBlooms, selectedStatus]);

  // Calculate statistics
  const partACount = subjectQuestions.filter(q => q.part === 'Part A').length;
  const partBCount = subjectQuestions.filter(q => q.part === 'Part B').length;
  const partCCount = subjectQuestions.filter(q => q.part === 'Part C').length;
  const approvedCount = subjectQuestions.filter(q => q.status === 'Approved').length;
  const pendingCount = subjectQuestions.filter(q => q.status === 'Pending' || q.status === 'Draft').length;

  const handleEdit = (q: Question) => {
    setEditingQuestion(q);
    setModalOpen(true);
  };

  /**
   * Applies an edit made in the Add/Edit modal.
   * The modal writes to the in-memory store, so the DB-backed row is patched
   * here so the explorer reflects the change until the bank is reloaded.
   */
  const handleEditSaved = (questionId: string, patch: Partial<Question>) => {
    patchDisplayedQuestion(questionId, patch);
  };

  const handleAdd = () => {
    setEditingQuestion(null);
    setModalOpen(true);
  };

  /** Removes a question row and drops it from the in-memory store. */
  const markQuestionDeleted = (question: Question) => {
    deleteQuestion(question.id);
    hideDisplayedQuestion(question.id);
    if (viewQuestionModal?.id === question.id) setViewQuestionModal(null);
  };

  const handleDrillIntoBank = (bank: QuestionBankListRow) => {
    setSelectedBankId(bank.id);
    setSelectedSubjectCode(bank.subject_code);
    setFilterSubjectCode(bank.subject_code);
    setLocalActiveTab('Overview');
    const explorerEl = document.getElementById('questions-explorer-section');
    if (explorerEl) {
      explorerEl.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
              Repository
            </span>
            <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-xs font-bold text-[#D71945]">
              Question Banks
            </span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Question Banks & Questions
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Browse all uploaded question banks by Academic Year, Department, and Subject. Drill in to manage individual questions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setActiveTab('import-question-bank')}
            className="flex items-center gap-2 rounded-xl bg-[#D71945] px-4 py-2.5 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
          >
            <ScanLine className="h-4 w-4" />
            <span>Upload Question Bank (PDF)</span>
          </button>

          <button
            onClick={handleAdd}
            className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all cursor-pointer whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Add Single Question</span>
          </button>
        </div>
      </div>

      {/* TOP FILTER BAR */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[#D71945]" />
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-900">
              Filter Question Banks
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              setFilterAcademicYear('all');
              setFilterDepartment('all');
              setFilterSubjectCode('all');
            }}
            className="text-[11px] font-bold text-slate-500 hover:text-[#D71945] transition-colors cursor-pointer"
          >
            Reset Filters
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Academic Year */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Academic Year
            </label>
            <select
              value={filterAcademicYear}
              onChange={(e) => setFilterAcademicYear(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-[#F7F8FA] px-3 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            >
              <option value="all">All Academic Years</option>
              {academicYears.map(yr => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>

          {/* Department */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Department
            </label>
            <select
              value={filterDepartment}
              onChange={(e) => {
                setFilterDepartment(e.target.value);
                setFilterSubjectCode('all');
              }}
              className="w-full rounded-xl border border-slate-200 bg-[#F7F8FA] px-3 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            >
              <option value="all">All Departments</option>
              {departments.map(d => (
                <option key={d.code} value={d.code}>{d.code} – {d.name}</option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Subject
            </label>
            <select
              value={filterSubjectCode}
              onChange={(e) => setFilterSubjectCode(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-[#F7F8FA] px-3 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            >
              <option value="all">All Subjects</option>
              {availableSubjects.map(s => (
                <option key={s.id} value={s.code}>
                  {s.code} – {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Dynamic count display */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="font-bold text-slate-700">
            Showing <span className="text-[#D71945] font-black">{visibleBanks.length}</span> Question {visibleBanks.length === 1 ? 'Bank' : 'Banks'} for{' '}
            <span className="font-extrabold text-slate-900">{filterAcademicYear === 'all' ? 'All Years' : filterAcademicYear}</span>
            {' / '}
            <span className="font-extrabold text-slate-900">{filterDepartment === 'all' ? 'All Departments' : filterDepartment}</span>
            {' / '}
            <span className="font-extrabold text-slate-900">
              {filterSubjectCode === 'all'
                ? 'All Subjects'
                : `${filterSubjectCode} – ${selectedSubjectRecord?.subject_name || filterSubjectCode}`}
            </span>
          </p>

          {loadingBanks && (
            <span className="text-[11px] text-slate-400 font-semibold animate-pulse">
              Refreshing question banks...
            </span>
          )}
        </div>

        {banksError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-[11px] font-semibold text-red-800">
            {banksError}
          </div>
        )}
      </div>

      {/* QUESTION BANKS LIST LAYER */}
      <div className="overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white shadow-xs">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[#D71945]" />
            <h2 className="text-sm font-black text-slate-900">
              Question Banks Directory
            </h2>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            Click &quot;View Questions&quot; to drill down into question items
          </span>
        </div>

        {visibleBanks.length === 0 ? (
          <div className="p-12 text-center">
            <Database className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700">No Question Banks found</p>
            <p className="text-xs text-slate-500 mt-1">
              Try adjusting the filters above or upload a new Question Bank PDF.
            </p>
            <button
              onClick={() => setActiveTab('import-question-bank')}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#D71945] px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#b01438]"
            >
              <ScanLine className="h-4 w-4" />
              <span>Import Question Bank</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA] text-[#64748B] font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-3">Academic Year</th>
                  <th className="py-3 px-3">Department</th>
                  <th className="py-3 px-3">File Name</th>
                  <th className="py-3 px-3 text-center">Units</th>
                  <th className="py-3 px-3 text-center">Total Questions</th>
                  <th className="py-3 px-3">Uploaded Date</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {visibleBanks.map(bank => {
                  const isSelected = bank.id === selectedBankId;
                  // Real count from the database. Never hardcoded, never taken
                  // from browser state — a missing value renders as 0, not blank.
                  const bankQuestionsCount = Number.isFinite(bank.total_questions)
                    ? Math.max(0, Math.trunc(bank.total_questions))
                    : 0;
                  const bankUnits = Number.isFinite(bank.total_units as number)
                    ? Math.max(0, Math.trunc(bank.total_units as number))
                    : 0;

                  return (
                    <tr
                      key={bank.id}
                      className={`hover:bg-rose-50/40 transition-colors ${isSelected ? 'bg-rose-50/60 font-semibold' : ''}`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900">{bank.subject_code}</div>
                        <div className="text-[11px] text-slate-500 line-clamp-1">{bank.subject_name || 'Subject'}</div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                          {bank.academic_year || '—'}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 font-semibold text-slate-800">
                        {bank.department || '—'}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600 font-mono text-[11px]">
                        <div className="flex items-center gap-1.5 line-clamp-1">
                          <FileText className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                          <span>{bank.file_name}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-center font-bold text-slate-700">
                        {bankUnits}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-black text-[#1976D2]">
                          {bankQuestionsCount}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-slate-500 text-[11px]">
                        {bank.created_at
                          ? new Date(bank.created_at).toLocaleDateString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric'
                            })
                          : '—'}
                      </td>
                      <td className="py-3.5 px-3">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                          bank.status === 'rejected'
                            ? 'bg-red-100 text-red-800'
                            : bank.status === 'pending_review'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {bank.status === 'pending_review' ? 'Pending Review' : bank.status === 'rejected' ? 'Rejected' : 'Active'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleDrillIntoBank(bank)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-[#D71945] transition-all cursor-pointer shadow-xs"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>View Questions</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* QUESTIONS EXPLORER SECTION */}
      <div id="questions-explorer-section" className="space-y-6 pt-4">
        {/* Section Title & Selected Subject Badge */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 text-[#D71945] font-black">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#D71945]">
                  Questions Explorer
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                  {currentSubject?.code || '—'}
                </span>
              </div>
              <h2 className="text-xl font-black text-slate-900">
                {selectedBank
                  ? `${selectedBank.subject_code} – ${selectedBank.subject_name || 'Subject'}`
                  : (currentSubject?.name || 'Select a question bank to view its questions')}
              </h2>
              {/* The exact subject identity in use: Year + Department + Code */}
              <p className="mt-1 text-[11px] text-[#64748B]">
                <span className="font-bold text-slate-700">Currently viewing:</span>{' '}
                {selectedBank
                  ? `${selectedBank.academic_year || '—'} / ${selectedBank.department || '—'} / ${selectedBank.subject_code}`
                  : `${filterAcademicYear === 'all' ? 'All Years' : filterAcademicYear} / ${filterDepartment === 'all' ? 'All Departments' : filterDepartment} / ${filterSubjectCode === 'all' ? 'All Subjects' : filterSubjectCode}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selectedBank ? (
              <button
                type="button"
                onClick={() => setSelectedBankId(null)}
                className="rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2 text-xs font-bold text-[#64748B] shadow-xs hover:border-slate-400 hover:text-[#111827] cursor-pointer"
              >
                Back to all banks
              </button>
            ) : (
              <>
                <span className="text-xs font-bold text-slate-500">Switch Subject:</span>
                <select
                  value={filterSubjectCode === 'all' ? '' : filterSubjectCode}
                  onChange={(e) => {
                    setFilterSubjectCode(e.target.value || 'all');
                    setSelectedBankId(null);
                    if (e.target.value) setSelectedSubjectCode(e.target.value);
                  }}
                  className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-bold text-[#111827] shadow-xs focus:border-[#D71945] focus:outline-hidden"
                >
                  <option value="">Select subject…</option>
                  {availableSubjects.map((sub) => (
                    <option key={sub.id} value={sub.code}>
                      {sub.code} – {sub.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {questionsError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-[11px] font-semibold text-red-800">
            {questionsError}
          </div>
        )}

        {/* Statistics Cards for Selected Subject */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-xs">
            <span className="text-[11px] font-bold text-[#64748B] uppercase">Part A</span>
            <div className="mt-1 text-xl font-black text-[#111827]">{partACount} Questions</div>
            <span className="text-[10px] text-[#1976D2] font-semibold">2 Marks Short</span>
          </div>

          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-xs">
            <span className="text-[11px] font-bold text-[#64748B] uppercase">Part B</span>
            <div className="mt-1 text-xl font-black text-[#111827]">{partBCount} Questions</div>
            <span className="text-[10px] text-[#D71945] font-semibold">13 Marks Long</span>
          </div>

          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-xs">
            <span className="text-[11px] font-bold text-[#64748B] uppercase">Part C</span>
            <div className="mt-1 text-xl font-black text-[#111827]">{partCCount} Questions</div>
            <span className="text-[10px] text-[#111827] font-semibold">15 Marks App/Case</span>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-[#ECFDF3] p-4 shadow-xs">
            <span className="text-[11px] font-bold text-emerald-800 uppercase">Approved</span>
            <div className="mt-1 text-xl font-black text-emerald-900">{approvedCount}</div>
            <span className="text-[10px] text-emerald-700 font-semibold">Exam-ready</span>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-[#FFF8E7] p-4 shadow-xs col-span-2 sm:col-span-1">
            <span className="text-[11px] font-bold text-amber-800 uppercase">Pending</span>
            <div className="mt-1 text-xl font-black text-amber-900">{pendingCount}</div>
            <span className="text-[10px] text-amber-700 font-semibold">In review / draft</span>
          </div>
        </div>

        {/* Tabs: Overview, Part A, Part B, Part C, Usage History */}
        <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2 overflow-x-auto">
          {(['Overview', 'Part A', 'Part B', 'Part C', 'Usage History'] as const).map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => {
                  if (tab === 'Usage History') {
                    setActiveTab('usage-history');
                  } else {
                    setLocalActiveTab(tab);
                  }
                }}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#111827] text-white shadow-xs'
                    : 'text-[#64748B] hover:bg-[#F7F8FA] hover:text-[#111827]'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-3 shadow-xs">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-[#94A3B8]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search questions by text, ID or topic..."
              className="w-full rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] pl-10 pr-4 py-2 text-xs text-[#111827] placeholder:text-[#94A3B8] focus:border-[#D71945] focus:bg-white focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            {/* Unit Filter */}
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
              aria-label="Filter by Unit"
              className="rounded-xl border border-[#E5E7EB] bg-white px-2.5 py-2 text-xs text-[#111827] font-medium focus:border-[#D71945] focus:outline-hidden"
            >
              <option value="all">All Units (I–V)</option>
              <option value="1">Unit I</option>
              <option value="2">Unit II</option>
              <option value="3">Unit III</option>
              <option value="4">Unit IV</option>
              <option value="5">Unit V</option>
            </select>

            {/* Bloom's Level Filter */}
            <select
              value={selectedBlooms}
              onChange={(e) => setSelectedBlooms(e.target.value)}
              aria-label="Filter by Blooms Level"
              className="rounded-xl border border-[#E5E7EB] bg-white px-2.5 py-2 text-xs text-[#111827] font-medium focus:border-[#D71945] focus:outline-hidden"
            >
              <option value="all">All BL (K1–K6)</option>
              <option value="K1">K1 - Remember</option>
              <option value="K2">K2 - Understand</option>
              <option value="K3">K3 - Apply</option>
              <option value="K4">K4 - Analyze</option>
              <option value="K5">K5 - Evaluate</option>
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              aria-label="Filter by Status"
              className="rounded-xl border border-[#E5E7EB] bg-white px-2.5 py-2 text-xs text-[#111827] font-medium focus:border-[#D71945] focus:outline-hidden"
            >
              <option value="all">All Statuses</option>
              <option value="Approved">Approved</option>
              <option value="Pending">Pending</option>
              <option value="Draft">Draft</option>
            </select>
          </div>
        </div>

        {/* Questions Data Table */}
        <div className="overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA] text-[#64748B] font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4">Q. ID</th>
                  <th className="py-3.5 px-4 min-w-[280px]">Question Description</th>
                  <th className="py-3.5 px-3">Unit</th>
                  <th className="py-3.5 px-3">Part / Marks</th>
                  <th className="py-3.5 px-2">BL</th>
                  <th className="py-3.5 px-2">CO</th>
                  <th className="py-3.5 px-2">PI</th>
                  <th className="py-3.5 px-3">Eligibility (Allowed)</th>
                  <th className="py-3.5 px-3">Usage History</th>
                  <th className="py-3.5 px-3">Status</th>
                  <th className="py-3.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {loadingQuestions ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-500">
                      <span className="font-semibold">Loading questions from the database…</span>
                    </td>
                  </tr>
                ) : filteredQuestions.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-500">
                      {selectedBankId
                        ? 'This question bank has no questions matching the selected filters.'
                        : 'No questions found matching the selected filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredQuestions.map((q) => {
                    return (
                      <tr key={q.id} className="hover:bg-[#F7F8FA] transition-colors">
                        <td className="py-3.5 px-4 font-mono font-bold text-[#111827]">
                          {q.id}
                        </td>
                        <td className="py-3.5 px-4">
                          <p className="line-clamp-2 text-[#111827] font-medium leading-relaxed">
                            {q.questionText}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-[#64748B] flex-wrap">
                            <span className="font-semibold text-slate-700">{q.topic}</span>
                            {(q.scope === 'COMMON' || q.departmentScope === 'COMMON') && (
                              <span className="inline-flex items-center gap-1 rounded bg-rose-100 border border-rose-200 px-1.5 py-0.5 text-[10px] font-black text-[#D71945]">
                                COMMON{q.commonDepartments && q.commonDepartments.length > 0 ? ` (${q.commonDepartments.join(', ')})` : ''}
                              </span>
                            )}
                            {q.orGroupId && (
                              <span className="rounded bg-purple-100 px-1.5 py-0.5 font-bold text-purple-700">
                                OR Pair: {q.orGroupId}{q.orOption ? ` (${q.orOption})` : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3">
                          <span className="inline-flex rounded-md bg-[#F7F8FA] px-2 py-0.5 text-xs font-bold text-[#111827]">
                            Unit {q.unit}
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-bold ${
                            q.part === 'Part A'
                              ? 'bg-[#EAF3FF] text-[#1976D2]'
                              : q.part === 'Part C'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-rose-100 text-[#D71945]'
                          }`}>
                            {q.part} ({q.marks}M)
                          </span>
                        </td>
                        <td className="py-3.5 px-2 font-bold text-[#D71945]">
                          {q.bloomsLevel}
                        </td>
                        <td className="py-3.5 px-2 font-bold text-[#1976D2]">
                          {q.co}
                        </td>
                        <td className="py-3.5 px-2 text-[#64748B] font-mono text-[11px]">
                          {q.pi}
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-1 text-[10px] font-bold">
                            <span className={q.allowedFor.internal1 ? 'text-emerald-700' : 'text-slate-300'}>IA1</span>
                            <span>•</span>
                            <span className={q.allowedFor.internal2 ? 'text-emerald-700' : 'text-slate-300'}>IA2</span>
                            <span>•</span>
                            <span className={q.allowedFor.endSem ? 'text-emerald-700' : 'text-slate-300'}>End</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3">
                          <span className="text-[11px] font-semibold text-slate-700">
                            {q.usageHistory.timesUsed} {q.usageHistory.timesUsed === 1 ? 'time' : 'times'}
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            q.status === 'Approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {q.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setViewQuestionModal(q)}
                              title="View Question Details"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEdit(q)}
                              title="Edit Question"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#1976D2] transition-colors cursor-pointer"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                              if (window.confirm('Are you sure you want to delete this question?')) {
                                markQuestionDeleted(q);
                              }

                              }}
                              title="Delete Question"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
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
      </div>

      {/* Add / Edit Question Modal */}
      <AddQuestionModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingQuestion(null);
        }}
        editQuestion={editingQuestion}
        onSaved={handleEditSaved}
        defaultSubjectCode={currentSubject?.code || filterSubjectCode || subjects[0]?.code || ""}
      />

      {/* View Question Detail Modal */}
      {viewQuestionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl border border-[#E5E7EB]">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-[#1976D2]">{viewQuestionModal.id}</span>
                <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-bold text-[#D71945]">
                  {viewQuestionModal.part} ({viewQuestionModal.marks} Marks)
                </span>
              </div>
              <button
                onClick={() => setViewQuestionModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase text-[#64748B]">Question Text</label>
                <p className="mt-1 text-sm font-semibold text-[#111827] leading-relaxed">
                  {viewQuestionModal.questionText}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded-xl border border-[#E5E7EB] p-2 bg-white">
                  <div className="text-[10px] text-[#64748B]">Unit</div>
                  <div className="font-bold text-[#111827]">Unit {viewQuestionModal.unit}</div>
                </div>
                <div className="rounded-xl border border-[#E5E7EB] p-2 bg-white">
                  <div className="text-[10px] text-[#64748B]">Bloom&apos;s Level</div>
                  <div className="font-bold text-[#D71945]">{viewQuestionModal.bloomsLevel}</div>
                </div>
                <div className="rounded-xl border border-[#E5E7EB] p-2 bg-white">
                  <div className="text-[10px] text-[#64748B]">Course Outcome</div>
                  <div className="font-bold text-[#1976D2]">{viewQuestionModal.co}</div>
                </div>
                <div className="rounded-xl border border-[#E5E7EB] p-2 bg-white">
                  <div className="text-[10px] text-[#64748B]">PI</div>
                  <div className="font-bold text-[#111827]">{viewQuestionModal.pi}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-3">
                <div className="font-bold text-[#111827] mb-1">Audited Usage History:</div>
                <div className="text-[11px] text-[#64748B]">
                  Times Used: <strong className="text-[#111827]">{viewQuestionModal.usageHistory.timesUsed}</strong>
                  {viewQuestionModal.usageHistory.lastUsedPaperCode && (
                    <span> • Last Paper: <strong>{viewQuestionModal.usageHistory.lastUsedPaperCode}</strong> ({viewQuestionModal.usageHistory.lastUsedDate})</span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setViewQuestionModal(null)}
                className="rounded-xl bg-[#111827] px-5 py-2 text-xs font-bold text-white hover:bg-black"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Question Bank & Extraction Modal */}
      <AddQuestionBankModal
        isOpen={bankModalOpen}
        onClose={() => setBankModalOpen(false)}
        defaultSubjectCode={currentSubject?.code || filterSubjectCode || subjects[0]?.code || ""}
      />
    </div>
  );
};
