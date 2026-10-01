import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  Clock,
  User,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Globe,
  Tag,
  ShieldCheck
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { fetchAuditLogs, AuditLog, AuditLogFilters } from '../services/authApi';

export const AuditLogView: React.FC = () => {
  const { authToken, showToast, isSuperAdminPortal, userRole } = useApp();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters state
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [status, setStatus] = useState('');

  /**
   * The role scope of this screen.
   *
   * It is the SIGNED-IN user's own role and is never sent to the API — the
   * backend derives the same value from the verified JWT and scopes the query
   * with it. It is displayed here so the user can see what the page covers.
   */
  const scopeRole = userRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'EXAM_CELL';

  const loadLogs = useCallback(async (showToastNotice = false) => {
    if (!authToken) {
      setLogs([]);
      setLoading(false);
      return;
    }
    try {
      setLoadError(null);
      // No `role` is sent: the API filters by the caller's own role.
      const filters: AuditLogFilters = {
        search: search.trim() || undefined,
        action: action || undefined,
        status: status || undefined,
        limit: 200
      };
      const data = await fetchAuditLogs(filters, authToken);

      // Defence in depth: the API is already role-scoped, so a row with any
      // other role is never rendered even if one were ever returned.
      const scoped = (data as AuditLog[]).filter(
        (log) => String(log.role || '').trim().toUpperCase() === scopeRole
      );

      setLogs(scoped);
      if (showToastNotice) {
        showToast(`Loaded ${scoped.length} ${scopeRole} audit logs.`);
      }
    } catch (err: any) {
      setLogs([]);
      const message = err?.message || 'Failed to load audit logs.';
      setLoadError(message);
      showToast(message);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [authToken, search, action, status, scopeRole, showToast]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  /**
   * Clear every role-specific cache when the session changes.
   *
   * On logout, or when a different role signs in, the previous role's rows are
   * dropped before the new request is issued, so no audit data (and no role,
   * user or cached response) survives a session change.
   */
  useEffect(() => {
    setLogs([]);
    setLoadError(null);
    setSearch('');
    setAction('');
    setStatus('');
    setIsRefreshing(false);
  }, [authToken, userRole]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadLogs(true);
  };

  const handleResetFilters = () => {
    setSearch('');
    setAction('');
    setStatus('');
  };

  const formatDateTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return {
        date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
    } catch {
      return { date: isoString, time: '' };
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-extrabold uppercase tracking-widest ${isSuperAdminPortal ? 'text-purple-700' : 'text-[#D71945]'}`}>
              System Security
            </span>
            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
              Immutable Log
            </span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">
            Audit Logs
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Activity ledger for the <strong>{scopeRole}</strong> role only — authentication events,
            configuration changes and data mutations performed by this role. The filter is applied by
            the server from your authenticated role, so another role's records are never returned to
            this page.
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={loading || isRefreshing}
          className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA] hover:border-slate-400 transition-all cursor-pointer self-start sm:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 text-[#64748B] ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh Logs</span>
        </button>
      </div>

      {/* Security Notice */}
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-xs">
        <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
        <div>
          <span className="font-bold text-[#111827]">Cryptographic Security Compliance:</span> All administrative transactions, logins, logouts, and master data modifications are recorded with timestamps, user context, and origin IP addresses. Credentials and authentication tokens are never captured.
        </div>
      </div>

      {/* Filters Card */}
      <div className="rounded-3xl border border-[#E5E7EB] bg-white p-5 sm:p-6 shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search email, name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-xs font-medium bg-[#F7F8FA] border border-[#E5E7EB] rounded-xl text-[#111827] placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D71945]/20 focus:border-[#D71945] transition-all"
            />
          </div>

          {/*
            Role scope — read-only.

            The role is NOT a filter the user can change: this page always shows
            the signed-in role's own records only, and the backend enforces that.
          */}
          <div>
            <label className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              Role Scope
            </label>
            <div
              className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-extrabold uppercase tracking-wide rounded-xl border ${
                scopeRole === 'SUPER_ADMIN'
                  ? 'bg-purple-50 text-purple-800 border-purple-200'
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
            >
              <span>{scopeRole}</span>
              <span className="text-[9px] font-bold normal-case tracking-normal opacity-70">
                your role only
              </span>
            </div>
          </div>

          {/* Action Filter */}
          <div>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs font-medium bg-[#F7F8FA] border border-[#E5E7EB] rounded-xl text-[#111827] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D71945]/20 focus:border-[#D71945] transition-all cursor-pointer"
            >
              <option value="">All Actions</option>
              <option value="LOGIN">LOGIN</option>
              <option value="LOGOUT">LOGOUT</option>
              <option value="CREATE_SUBJECT">CREATE_SUBJECT</option>
              <option value="UPDATE_SUBJECT">UPDATE_SUBJECT</option>
              <option value="DELETE_SUBJECT">DELETE_SUBJECT</option>
              <option value="CREATE_DEPARTMENT">CREATE_DEPARTMENT</option>
              <option value="UPDATE_DEPARTMENT">UPDATE_DEPARTMENT</option>
              <option value="DELETE_DEPARTMENT">DELETE_DEPARTMENT</option>
              <option value="CREATE_ACADEMIC_YEAR">CREATE_ACADEMIC_YEAR</option>
              <option value="UPDATE_ACADEMIC_YEAR">UPDATE_ACADEMIC_YEAR</option>
              <option value="DELETE_ACADEMIC_YEAR">DELETE_ACADEMIC_YEAR</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs font-medium bg-[#F7F8FA] border border-[#E5E7EB] rounded-xl text-[#111827] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D71945]/20 focus:border-[#D71945] transition-all cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
            </select>
          </div>
        </div>

        {/* Filter Summary */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#64748B] pt-2 border-t border-[#F1F5F9]">
          <span>
            Displaying <strong>{logs.length}</strong> <strong>{scopeRole}</strong> audit{' '}
            {logs.length === 1 ? 'event' : 'events'}
          </span>
          <span className="text-[10px] text-[#94A3B8]">
            This page never shows {scopeRole === 'SUPER_ADMIN' ? 'Exam Cell' : 'Super Admin'} activity.
          </span>
          {(search || action || status) && (
            <button
              onClick={handleResetFilters}
              className="font-bold text-[#D71945] hover:underline cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>

        {loadError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-800">
            {loadError}
          </div>
        )}
      </div>

      {/* Logs Table */}
      <div className="rounded-3xl border border-[#E5E7EB] bg-white overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-xs text-[#64748B]">
            <RefreshCw className="h-6 w-6 animate-spin text-[#D71945] mx-auto mb-2" />
            Querying audit log ledger...
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-[#111827]">
              No {scopeRole} audit logs recorded
            </h3>
            <p className="mt-1 text-xs text-[#64748B] max-w-sm mx-auto">
              No {scopeRole} audit records matched your filter criteria or no actions have been
              performed yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F7F8FA] text-[10px] font-extrabold uppercase tracking-wider text-[#64748B]">
                  <th className="py-3.5 px-4 sm:px-6">Timestamp</th>
                  <th className="py-3.5 px-4">User / Email</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Action</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4">Details / Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {logs.map(log => {
                  const dt = formatDateTime(log.created_at);
                  const isSuccess = log.status === 'SUCCESS';
                  const isFailed = log.status === 'FAILED';

                  return (
                    <tr key={log.id} className="hover:bg-[#F9FAFB] transition-colors">
                      {/* Timestamp */}
                      <td className="py-4 px-4 sm:px-6 whitespace-nowrap">
                        <div className="font-mono font-bold text-[#111827]">{dt.date}</div>
                        <div className="font-mono text-[10px] text-[#64748B]">{dt.time}</div>
                      </td>

                      {/* User */}
                      <td className="py-4 px-4">
                        <div className="font-bold text-[#111827]">{log.user_name || log.user_email}</div>
                        <div className="font-mono text-[11px] text-[#64748B]">{log.user_email}</div>
                      </td>

                      {/* Role */}
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-extrabold tracking-wide ${
                          log.role === 'SUPER_ADMIN'
                            ? 'bg-purple-100 text-purple-700 border border-purple-200'
                            : log.role === 'EXAM_CELL'
                            ? 'bg-rose-100 text-rose-700 border border-rose-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}>
                          {log.role}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="py-4 px-4">
                        <span className="font-mono font-extrabold text-[#111827]">
                          {log.action}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider uppercase ${
                          isSuccess
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : isFailed
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                          {isSuccess ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <XCircle className="h-3 w-3 text-rose-600" />}
                          {log.status}
                        </span>
                      </td>

                      {/* Details / IP */}
                      <td className="py-4 px-4 text-[#64748B]">
                        {log.metadata && Object.keys(log.metadata).length > 0 ? (
                          <div className="font-mono text-[11px] text-slate-700">
                            {Object.entries(log.metadata).map(([k, v]) => (
                              <span key={k} className="mr-2 inline-block">
                                <strong className="text-slate-900">{k}:</strong> {String(v)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">No extra metadata</span>
                        )}
                        {log.ip_address && (
                          <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                            IP: {log.ip_address}
                          </div>
                        )}
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
