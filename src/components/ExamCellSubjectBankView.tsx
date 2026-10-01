import React, { useState, useMemo, useEffect } from 'react';
import {
  BookOpen,
  Search,
  Filter,
  Layers,
  CalendarDays,
  Building2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Tag
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export const ExamCellSubjectBankView: React.FC = () => {
  const {
    dbSubjects,
    activeAcademicYearsList,
    activeDepartmentsList,
    academicYearsList,
    questions,
    masterDataLoading,
    refreshMasterData,
    selectedAcademicYear: sharedAcademicYearLabel,
    setSelectedAcademicYear: setSharedAcademicYear
  } = useApp();

  const [filterYearId, setFilterYearId] = useState<string>('');
  const [filterDeptId, setFilterDeptId] = useState<string>('');

  // ---- Academic year is shared application state ----
  // The shared label is resolved to the exact `academic_years` row here, so
  // this registry shows the same year as the rest of the workflow.
  useEffect(() => {
    if (!sharedAcademicYearLabel) return;
    const match = academicYearsList.find((y) => y.year_label === sharedAcademicYearLabel);
    if (!match || match.id === filterYearId) return;
    setFilterYearId(match.id);
    setFilterDeptId('');
  }, [sharedAcademicYearLabel, academicYearsList, filterYearId]);

  useEffect(() => {
    if (!filterYearId) return;
    const label = academicYearsList.find((y) => y.id === filterYearId)?.year_label || '';
    if (!label || label === sharedAcademicYearLabel) return;
    setSharedAcademicYear(label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterYearId, academicYearsList]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshMasterData();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Build question count lookup per subject code
  const questionCountMap = useMemo(() => {
    const counts: Record<string, number> = {};
    questions.forEach(q => {
      const code = q.subjectCode;
      if (code) {
        counts[code] = (counts[code] || 0) + 1;
      }
    });
    return counts;
  }, [questions]);

  // Filter subjects based on selected year, dept, and search query
  const filteredSubjects = useMemo(() => {
    return dbSubjects.filter(sub => {
      if (filterYearId && sub.academic_year_id !== filterYearId) return false;
      if (filterDeptId && sub.department_id !== filterDeptId) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const codeMatch = sub.subject_code.toLowerCase().includes(query);
        const nameMatch = sub.subject_name.toLowerCase().includes(query);
        const regMatch = sub.regulation?.toLowerCase().includes(query) || false;
        if (!codeMatch && !nameMatch && !regMatch) return false;
      }
      return true;
    });
  }, [dbSubjects, filterYearId, filterDeptId, searchQuery]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
              Course Catalogue
            </span>
            <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-[#D71945] border border-rose-200">
              Read-Only
            </span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Subject Bank
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Authoritative registry of academic subjects synchronized directly from Supabase Master Data.
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={masterDataLoading || isRefreshing}
          className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA] hover:border-slate-400 transition-all cursor-pointer self-start sm:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 text-[#64748B] ${(masterDataLoading || isRefreshing) ? 'animate-spin' : ''}`} />
          <span>Refresh Database</span>
        </button>
      </div>

      {/* Info Notice */}
      <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-xs text-blue-900">
        <BookOpen className="h-5 w-5 text-blue-600 shrink-0" />
        <div>
          <span className="font-bold">Database-Backed Master Data:</span> Subjects shown below are retrieved from Supabase and shared between Super Admin and Exam Cell. To add, edit, or deactivate subjects, contact a Super Administrator.
        </div>
      </div>

      {/* Filters Card */}
      <div className="rounded-3xl border border-[#E5E7EB] bg-white p-5 sm:p-6 shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by code, title, regulation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-xs font-medium bg-[#F7F8FA] border border-[#E5E7EB] rounded-xl text-[#111827] placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D71945]/20 focus:border-[#D71945] transition-all"
            />
          </div>

          {/* Academic Year Filter */}
          <div className="relative">
            <CalendarDays className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <select
              value={filterYearId}
              onChange={(e) => setFilterYearId(e.target.value)}
              className="w-full pl-10 pr-8 py-2.5 text-xs font-medium bg-[#F7F8FA] border border-[#E5E7EB] rounded-xl text-[#111827] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D71945]/20 focus:border-[#D71945] transition-all appearance-none cursor-pointer"
            >
              <option value="">All Academic Years ({academicYearsList.length})</option>
              {academicYearsList.map(y => (
                <option key={y.id} value={y.id}>
                  {y.year_label} {y.status === 'active' ? '(Active)' : '(Archived)'}
                </option>
              ))}
            </select>
          </div>

          {/* Department Filter */}
          <div className="relative">
            <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <select
              value={filterDeptId}
              onChange={(e) => setFilterDeptId(e.target.value)}
              className="w-full pl-10 pr-8 py-2.5 text-xs font-medium bg-[#F7F8FA] border border-[#E5E7EB] rounded-xl text-[#111827] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D71945]/20 focus:border-[#D71945] transition-all appearance-none cursor-pointer"
            >
              <option value="">All Departments ({activeDepartmentsList.length})</option>
              {activeDepartmentsList.map(d => (
                <option key={d.id} value={d.id}>
                  [{d.department_code}] {d.department_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Filter Summary */}
        <div className="flex items-center justify-between text-xs text-[#64748B] pt-2 border-t border-[#F1F5F9]">
          <span>
            Showing <strong>{filteredSubjects.length}</strong> of <strong>{dbSubjects.length}</strong> subjects in database
          </span>
          {(filterYearId || filterDeptId || searchQuery) && (
            <button
              onClick={() => {
                setFilterYearId('');
                // Clear the shared year too, otherwise the sync effect would
                // immediately re-apply it.
                setSharedAcademicYear('');
                setFilterDeptId('');
                setSearchQuery('');
              }}
              className="font-bold text-[#D71945] hover:underline cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Subjects Table */}
      <div className="rounded-3xl border border-[#E5E7EB] bg-white overflow-hidden shadow-xs">
        {masterDataLoading ? (
          <div className="p-12 text-center text-xs text-[#64748B]">
            <RefreshCw className="h-6 w-6 animate-spin text-[#D71945] mx-auto mb-2" />
            Loading subjects from Supabase...
          </div>
        ) : filteredSubjects.length === 0 ? (
          <div className="p-12 text-center">
            <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-[#111827]">No subjects found</h3>
            <p className="mt-1 text-xs text-[#64748B] max-w-sm mx-auto">
              No subjects matched the selected academic year, department, or search query.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA] text-[10px] font-extrabold uppercase tracking-wider text-[#64748B]">
                  <th className="py-3.5 px-4 sm:px-6">Subject Code</th>
                  <th className="py-3.5 px-4">Subject Name</th>
                  <th className="py-3.5 px-4">Department</th>
                  <th className="py-3.5 px-4">Academic Year</th>
                  <th className="py-3.5 px-4">Sem &amp; Reg</th>
                  <th className="py-3.5 px-4 text-center">Bank Questions</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredSubjects.map(sub => {
                  const deptCode = sub.departments?.department_code || activeDepartmentsList.find(d => d.id === sub.department_id)?.department_code || '—';
                  const yearLabel = sub.academic_years?.year_label || academicYearsList.find(y => y.id === sub.academic_year_id)?.year_label || '—';
                  const qCount = questionCountMap[sub.subject_code] || 0;

                  return (
                    <tr key={sub.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="py-4 px-4 sm:px-6 font-mono font-extrabold text-[#1976D2]">
                        <span className="inline-flex items-center rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-bold text-blue-700">
                          {sub.subject_code}
                        </span>
                      </td>
                      <td className="py-4 px-4 font-extrabold text-[#111827]">
                        {sub.subject_name}
                      </td>
                      <td className="py-4 px-4 font-medium text-[#64748B]">
                        <span className="font-bold text-[#111827]">[{deptCode}]</span> {sub.departments?.department_name || ''}
                      </td>
                      <td className="py-4 px-4 font-medium text-[#64748B]">
                        {yearLabel}
                      </td>
                      <td className="py-4 px-4 text-[#64748B]">
                        <div className="font-semibold text-[#111827]">Sem {sub.semester || '—'}</div>
                        <div className="text-[10px] text-[#94A3B8]">{sub.regulation || 'Regulation 2024'}</div>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          qCount > 0
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {qCount} Questions
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                          sub.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${sub.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {sub.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
