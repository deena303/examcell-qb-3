import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Check, X, Power, PowerOff, CalendarDays } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AcademicYearRecord, createAcademicYear, updateAcademicYear, fetchAcademicYears } from '../../services/authApi';

export const AcademicYearsView: React.FC = () => {
  const { authToken, showToast } = useApp();
  const [years, setYears] = useState<AcademicYearRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingNew, setAddingNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await fetchAcademicYears(false);
    setYears(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!newLabel.trim()) { showToast('Please enter a year label.'); return; }
    if (!authToken) { showToast('Not authenticated.'); return; }
    setSaving(true);
    try {
      const created = await createAcademicYear(newLabel.trim(), authToken);
      setYears(prev => [created, ...prev]);
      setNewLabel('');
      setAddingNew(false);
      showToast(`Academic year "${created.year_label}" added.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to create academic year.');
    } finally { setSaving(false); }
  };

  const handleEdit = async (id: string) => {
    if (!editLabel.trim()) { showToast('Label cannot be empty.'); return; }
    if (!authToken) return;
    setSaving(true);
    try {
      const updated = await updateAcademicYear(id, { year_label: editLabel.trim() }, authToken);
      setYears(prev => prev.map(y => y.id === id ? updated : y));
      setEditingId(null);
      showToast('Academic year updated.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to update.');
    } finally { setSaving(false); }
  };

  const handleToggleStatus = async (year: AcademicYearRecord) => {
    if (!authToken) return;
    const newStatus = year.status === 'active' ? 'inactive' : 'active';
    try {
      const updated = await updateAcademicYear(year.id, { status: newStatus }, authToken);
      setYears(prev => prev.map(y => y.id === year.id ? updated : y));
      showToast(`Academic year "${year.year_label}" set to ${newStatus}.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to update status.');
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="border-b border-[#E5E7EB] pb-5 flex items-center justify-between">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-purple-700">Super Admin</span>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-[#111827]">Academic Years</h1>
          <p className="mt-1 text-sm text-[#64748B]">Manage academic years available to Exam Cell</p>
        </div>
        <button
          onClick={() => { setAddingNew(true); setNewLabel(''); }}
          className="flex items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-xs font-bold text-white hover:bg-purple-800 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" /> Add Year
        </button>
      </div>

      {/* Add New Row */}
      {addingNew && (
        <div className="flex items-center gap-3 rounded-2xl border border-purple-200 bg-purple-50/40 p-4">
          <CalendarDays className="h-5 w-5 text-purple-600 shrink-0" />
          <input
            autoFocus
            type="text"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAddingNew(false); }}
            placeholder="e.g. 2026-2030"
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#111827] focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none"
          />
          <button onClick={handleAdd} disabled={saving} className="flex items-center gap-1 rounded-lg bg-purple-700 px-3 py-2 text-xs font-bold text-white hover:bg-purple-800 disabled:opacity-60 transition-colors">
            <Check className="h-3.5 w-3.5" /> Save
          </button>
          <button onClick={() => setAddingNew(false)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Years Table */}
      <div className="rounded-3xl border border-[#E5E7EB] bg-white overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-8 text-center text-sm text-[#64748B]">Loading...</div>
        ) : years.length === 0 ? (
          <div className="p-12 text-center">
            <CalendarDays className="h-10 w-10 mx-auto text-[#D1D5DB] mb-3" />
            <p className="text-sm font-semibold text-[#64748B]">No academic years found.</p>
            <p className="text-xs text-[#94A3B8] mt-1">Run the SQL migration to seed initial data.</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA]">
                <th className="px-6 py-3 text-[11px] font-extrabold uppercase tracking-wider text-[#64748B]">Year Label</th>
                <th className="px-6 py-3 text-[11px] font-extrabold uppercase tracking-wider text-[#64748B]">Status</th>
                <th className="px-6 py-3 text-[11px] font-extrabold uppercase tracking-wider text-[#64748B] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {years.map(year => (
                <tr key={year.id} className="hover:bg-[#F7F8FA] transition-colors">
                  <td className="px-6 py-4">
                    {editingId === year.id ? (
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleEdit(year.id); if (e.key === 'Escape') setEditingId(null); }}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-sm font-medium text-[#111827] focus:border-purple-400 outline-none w-36"
                      />
                    ) : (
                      <span className="text-sm font-semibold text-[#111827]">{year.year_label}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${year.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {year.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      {editingId === year.id ? (
                        <>
                          <button onClick={() => handleEdit(year.id)} disabled={saving} className="flex items-center gap-1 rounded-lg bg-purple-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-800 disabled:opacity-60">
                            <Check className="h-3 w-3" /> Save
                          </button>
                          <button onClick={() => setEditingId(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditingId(year.id); setEditLabel(year.year_label); }} className="rounded-lg border border-slate-200 p-1.5 text-[#64748B] hover:bg-[#F7F8FA] hover:text-[#111827] transition-colors">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleToggleStatus(year)} title={year.status === 'active' ? 'Deactivate' : 'Activate'} className={`rounded-lg border p-1.5 transition-colors ${year.status === 'active' ? 'border-amber-200 text-amber-600 hover:bg-amber-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}>
                            {year.status === 'active' ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
