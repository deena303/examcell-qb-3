import React, { useState } from 'react';
import { KeyRound, Eye, EyeOff, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { changePassword } from '../services/authApi';

/**
 * ChangePasswordView
 *
 * Shown to users whose must_change_password flag is true after first login.
 * The user CANNOT access any other portal page until this is completed.
 *
 * - Requires current (temporary) password for verification
 * - Enforces minimum 8-char new password
 * - Calls POST /api/users/:id/change-password via authApi
 * - On success, clears mustChangePassword and routes to dashboard
 * - Passwords are NEVER stored in state beyond this component render
 */
export const ChangePasswordView: React.FC = () => {
  const { authSession, setMustChangePassword, setActiveTab, showToast } = useApp();

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const strength = (() => {
    if (newPw.length === 0) return 0;
    let s = 0;
    if (newPw.length >= 8) s++;
    if (/[A-Z]/.test(newPw)) s++;
    if (/[0-9]/.test(newPw)) s++;
    if (/[^A-Za-z0-9]/.test(newPw)) s++;
    return s;
  })();

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][strength];
  const strengthColor = ['', '#EF4444', '#F59E0B', '#3B82F6', '#10B981'][strength];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPw) return setError('Please enter your current (temporary) password.');
    if (newPw.length < 8) return setError('New password must be at least 8 characters.');
    if (newPw !== confirmPw) return setError('New passwords do not match.');
    if (currentPw === newPw) return setError('New password must be different from the temporary password.');
    if (!authSession?.userId || !authSession?.token) return setError('Session expired. Please log in again.');

    setLoading(true);
    try {
      await changePassword(
        { userId: authSession.userId, currentPassword: currentPw, newPassword: newPw },
        authSession.token
      );
      setSuccess(true);
      showToast('Password changed successfully. Welcome to the portal!');
      // Clear the forced-change state and route to dashboard
      setTimeout(() => {
        setMustChangePassword(false);
        setActiveTab('dashboard');
      }, 1800);
    } catch (err: any) {
      setError(err?.message || 'Failed to change password. Please try again.');
    } finally {
      setLoading(false);
      // Clear sensitive fields from state immediately after submit attempt
      setCurrentPw('');
    }
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <h2 className="text-xl font-extrabold text-[#111827]">Password Changed!</h2>
        <p className="text-sm text-[#64748B]">Redirecting to your portal…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-md rounded-3xl border border-[#E5E7EB] bg-white p-8 shadow-xl">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
            <KeyRound className="h-7 w-7 text-amber-600" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-extrabold text-[#111827]">Change Temporary Password</h1>
            <p className="mt-1 text-xs text-[#64748B] max-w-xs">
              Your account was provisioned with a temporary password. Please create a new password to access the portal.
            </p>
          </div>
        </div>

        {/* Security notice */}
        <div className="mb-5 flex items-start gap-2.5 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-800 leading-relaxed">
            Your new password is encrypted before storage. The temporary password will be invalidated immediately.
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2.5 rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs" autoComplete="off">
          {/* Current (temporary) password */}
          <div>
            <label className="block font-bold text-[#111827] mb-1.5">
              Current (Temporary) Password
            </label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="Enter temporary password"
                className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2.5 pr-10 text-[#111827] focus:border-[#D71945] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-2.5 text-[#94A3B8] hover:text-[#64748B]"
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* New password */}
          <div>
            <label className="block font-bold text-[#111827] mb-1.5">New Password</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2.5 pr-10 text-[#111827] focus:border-[#D71945] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-2.5 text-[#94A3B8] hover:text-[#64748B]"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {/* Strength indicator */}
            {newPw.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex gap-1 flex-1">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-1 flex-1 rounded-full transition-all"
                      style={{ backgroundColor: i <= strength ? strengthColor : '#E5E7EB' }}
                    />
                  ))}
                </div>
                <span className="text-[10px] font-bold" style={{ color: strengthColor }}>
                  {strengthLabel}
                </span>
              </div>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <label className="block font-bold text-[#111827] mb-1.5">Confirm New Password</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2.5 pr-10 text-[#111827] focus:border-[#D71945] focus:outline-none"

              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-2.5 text-[#94A3B8] hover:text-[#64748B]"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirmPw && confirmPw !== newPw && (
              <p className="mt-1 text-[10px] text-rose-600">Passwords do not match.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !currentPw || !newPw || !confirmPw}
            className="mt-2 w-full rounded-xl bg-[#D71945] px-4 py-3 text-xs font-extrabold text-white shadow-md shadow-[#D71945]/25 hover:bg-[#c0153c] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? 'Changing Password…' : 'Set New Password & Access Portal'}
          </button>
        </form>
      </div>
    </div>
  );
};
