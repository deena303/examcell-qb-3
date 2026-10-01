import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Plus,
  Search,
  Mail,
  CheckCircle2,
  X,
  Eye,
  EyeOff,
  RefreshCw,
  AlertCircle,
  ShieldCheck,
  Clock,
  KeyRound
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { fetchUsers, createExternalUser, UserAccountRecord } from '../services/authApi';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  EXAM_CELL: 'Exam Cell',
  PRINCIPAL: 'Principal'
};

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-800 border border-purple-300',
  EXAM_CELL: 'bg-blue-50 text-blue-800 border border-blue-200',
  PRINCIPAL: 'bg-emerald-50 text-emerald-800 border border-emerald-200'
};

const DEPARTMENTS = ['CSE', 'AIML', 'AIDS', 'IT', 'ECE', 'MECH', 'CIVIL'];

function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '@#!$';
  const all = upper + lower + digits + special;
  let pw = '';
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += digits[Math.floor(Math.random() * digits.length)];
  pw += special[Math.floor(Math.random() * special.length)];
  for (let i = 3; i < 12; i++) {
    pw += all[Math.floor(Math.random() * all.length)];
  }
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

export const UsersManagementView: React.FC = () => {
  const { authSession, isSuperAdminPortal, showToast } = useApp();
  const token = authSession?.token ?? '';
  const myRole = authSession?.role ?? '';

  const [dbUsers, setDbUsers] = useState<UserAccountRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'EXAM_CELL' | 'PRINCIPAL'>('EXAM_CELL');
  const [department, setDepartment] = useState('CSE');
  const [tempPassword, setTempPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdUserPassword, setCreatedUserPassword] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const users = await fetchUsers(token);
      setDbUsers(users);
    } catch (err: any) {
      setError(err?.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filteredUsers = dbUsers.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (ROLE_LABELS[u.role] || u.role).toLowerCase().includes(q)
    );
  });

  const openModal = () => {
    setName('');
    setEmail('');
    setRole('EXAM_CELL');
    setDepartment('CSE');
    const pw = generateTempPassword();
    setTempPassword(pw);
    setShowPassword(true);
    setFormError(null);
    setCreatedUserPassword(null);
    setModalOpen(true);
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !email.trim() || !tempPassword) {
      return setFormError('All fields are required.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setFormError('Please enter a valid email address.');
    }
    if (tempPassword.length < 8) {
      return setFormError('Temporary password must be at least 8 characters.');
    }
    // Exam Cell cannot create Super Admin
    if (myRole === 'EXAM_CELL' && role === 'SUPER_ADMIN') {
      return setFormError('Exam Cell cannot create Super Admin accounts.');
    }

    setSubmitting(true);
    try {
      const result = await createExternalUser(
        { name: name.trim(), email: email.trim(), role, department, temporaryPassword: tempPassword },
        token
      );
      const savedPw = tempPassword; // capture before clearing
      setTempPassword('');          // clear from state immediately after send
      setCreatedUserPassword(savedPw);
      showToast(result.message || `Account created for ${email.trim()}.`);

      await loadUsers();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create user. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setCreatedUserPassword(null);
    setTempPassword('');
    setFormError(null);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#D71945]">
            {isSuperAdminPortal ? 'System Administration' : 'Academic Personnel'}
          </span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Staff & User Management
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Create and manage external staff accounts. Newly created users must change their password on first login.
          </p>
        </div>
        <button
          onClick={openModal}
          className="flex items-center gap-2 rounded-xl bg-[#D71945] px-4 py-2.5 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          <span>Add Staff Account</span>
        </button>
      </div>

      {/* Search + Refresh */}
      <div className="flex items-center gap-3 max-w-lg">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-[#94A3B8]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or role..."
            className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-10 pr-4 py-2 text-xs text-[#111827] focus:border-[#D71945] focus:outline-none"
          />
        </div>
        <button
          onClick={loadUsers}
          disabled={loading}
          className="p-2 rounded-xl border border-[#E5E7EB] bg-white text-[#64748B] hover:text-[#111827] hover:border-[#D71945] transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />

        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Users Grid */}
      {loading && dbUsers.length === 0 ? (
        <div className="text-center py-16 text-[#64748B] text-sm">Loading users…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((u) => {
            const isMe = u.id === authSession?.userId;
            return (
              <div
                key={u.id}
                className="rounded-3xl border border-[#E5E7EB] bg-white p-5 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        ROLE_COLORS[u.role] || 'bg-slate-100 text-slate-800 border border-slate-200'
                      }`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                    <div className="flex items-center gap-1">
                      {isMe && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-extrabold text-emerald-700">
                          YOU
                        </span>
                      )}
                      {u.must_change_password && (
                        <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[9px] font-extrabold text-amber-700 flex items-center gap-0.5">
                          <KeyRound className="h-2.5 w-2.5" /> TEMP PW
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3">
                    <h3 className="text-sm font-extrabold text-[#111827]">{u.name}</h3>
                    <div className="text-xs text-[#64748B] flex items-center gap-1.5 mt-0.5">
                      <Mail className="h-3 w-3 text-[#94A3B8]" />
                      <span className="truncate">{u.email}</span>
                    </div>
                    {u.department && (
                      <div className="text-xs text-[#64748B] mt-1">
                        Dept: <strong className="text-[#111827]">{u.department}</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-[#E5E7EB] flex items-center justify-between">
                  <span
                    className={`text-[10px] font-bold flex items-center gap-1 ${
                      u.status === 'active'
                        ? 'text-emerald-700'
                        : 'text-slate-500'
                    }`}>
                    <CheckCircle2 className="h-3 w-3" />
                    {u.status === 'active' ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-[10px] text-[#94A3B8] flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {new Date(u.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            );
          })}
          {filteredUsers.length === 0 && !loading && (
            <div className="col-span-full py-12 text-center text-sm text-[#64748B]">
              {search ? 'No users match your search.' : 'No users found. Click "Add Staff Account" to create one.'}
            </div>
          )}
        </div>
      )}

      {/* Create User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-[#E5E7EB] bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">

            {/* Success state — show temporary password to admin */}
            {createdUserPassword ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
                  <h3 className="text-lg font-extrabold text-[#111827] flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    Account Created
                  </h3>
                  <button onClick={closeModal} className="rounded-full p-1 text-[#94A3B8] hover:bg-[#F7F8FA]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
                  <p className="text-xs font-semibold text-emerald-800 mb-3">
                    The account has been created. Share the temporary password below securely with the staff member.
                    They will be required to change it on first login.
                  </p>
                  <div className="rounded-xl bg-white border border-emerald-300 px-4 py-3 font-mono text-sm font-black text-[#111827] text-center tracking-widest">
                    {createdUserPassword}
                  </div>
                  <p className="mt-2 text-[10px] text-emerald-700 text-center">
                    ⚠ This password will not be shown again. Copy it now.
                  </p>
                </div>
                <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-800">
                    This password is not stored in plaintext. It has been securely hashed on the server.
                    Never share this via email or chat logs.
                  </p>
                </div>
                <button
                  onClick={closeModal}
                  className="w-full rounded-xl bg-[#111827] py-2.5 text-xs font-bold text-white hover:bg-black"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
                  <h3 className="text-lg font-extrabold text-[#111827]">Add Staff Account</h3>
                  <button onClick={closeModal} className="rounded-full p-1 text-[#94A3B8] hover:bg-[#F7F8FA]">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {formError && (
                  <div className="mt-3 flex items-start gap-2 rounded-2xl bg-rose-50 border border-rose-200 px-3 py-2.5 text-xs text-rose-700">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {formError}
                  </div>
                )}

                <form onSubmit={handleAddUser} className="mt-4 space-y-4 text-xs">
                  <div>
                    <label className="block font-bold text-[#111827] mb-1">Staff Full Name *</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Dr. A. Rahman, Ph.D."
                      className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2 text-[#111827] focus:border-[#D71945] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#111827] mb-1">Institutional / External Email *</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. rahman.cse@msajce-edu.in"
                      className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2 text-[#111827] focus:border-[#D71945] focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-[#111827] mb-1">Role *</label>
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value as 'EXAM_CELL' | 'PRINCIPAL')}
                        className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2 font-semibold"
                      >
                        <option value="EXAM_CELL">Exam Cell</option>
                        <option value="PRINCIPAL">Principal</option>
                        {isSuperAdminPortal && <option value="SUPER_ADMIN" disabled>Super Admin (use seed script)</option>}
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-[#111827] mb-1">Department *</label>
                      <select
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2 font-semibold"
                      >
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block font-bold text-[#111827]">Temporary Password *</label>
                      <button
                        type="button"
                        onClick={() => setTempPassword(generateTempPassword())}
                        className="text-[10px] font-bold text-[#1976D2] hover:underline"
                      >
                        Regenerate
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={tempPassword}
                        onChange={(e) => setTempPassword(e.target.value)}
                        placeholder="Min 8 characters"
                        className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2 pr-10 font-mono text-[#111827] focus:border-[#D71945] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2 text-[#94A3B8] hover:text-[#64748B]"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-[#64748B]">
                      User will be required to change this on first login. Never share via unsecured channels.
                    </p>
                  </div>

                  <div className="mt-6 flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="rounded-xl border border-[#E5E7EB] px-4 py-2 font-bold text-[#64748B] hover:bg-[#F7F8FA]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-xl bg-[#D71945] px-5 py-2 font-bold text-white shadow-md hover:bg-[#c0153c] disabled:opacity-50"
                    >
                      {submitting ? 'Creating…' : 'Create Account'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
