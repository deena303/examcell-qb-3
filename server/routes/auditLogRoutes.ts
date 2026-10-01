import express, { Response } from 'express';
import { requireAuth, AuthenticatedRequest, type AppRole } from '../middleware/authMiddleware';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseQuestionBankService';

const router = express.Router();

/**
 * Which audit-log roles each authenticated role is allowed to READ.
 *
 * The scope is derived from the role inside the verified JWT — never from a
 * query parameter — so one role can never request another role's audit trail.
 *
 *   EXAM_CELL  -> only role = 'EXAM_CELL'
 *   SUPER_ADMIN-> only role = 'SUPER_ADMIN'
 *   PRINCIPAL  -> no audit-log access (an empty list means "not authorized")
 */
const AUDIT_SCOPE_BY_ROLE: Record<AppRole, AppRole[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN'],
  EXAM_CELL: ['EXAM_CELL'],
  PRINCIPAL: []
};

/** Normalizes a role for comparison: trimmed, upper-case. */
function normalizeRole(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/** Clamps the requested page size so a caller cannot ask for the whole table. */
function clampLimit(raw: unknown, fallback = 200, max = 1000): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * POST /api/audit-logs
 *
 * Legacy endpoint — the application itself writes audit rows through
 * `writeAuditLog()` (auditService) and `insertAuditLog()` (authRoutes).
 *
 * It is kept for compatibility but is now authenticated, and the recorded
 * `role` is ALWAYS taken from the caller's verified session. A client can no
 * longer forge a row attributed to another role, which is what would otherwise
 * let the two audit streams be mixed again.
 *
 * NEVER stores passwords, tokens, or API keys.
 */
router.post('/audit-logs', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSupabaseConfigured()) {
      // Silently succeed if Supabase is not configured (avoids blocking the app)
      return res.status(200).json({ success: true, skipped: true });
    }

    const { action, status, ip_address, user_agent, metadata } = req.body;

    // Identity and role are BOTH server-derived — a client can never attribute
    // a row to another account or to another role. Both come from the verified
    // JWT, never from the request body.
    const role = req.user!.role;
    const callerEmail = String(req.user!.email || '').toLowerCase().trim();
    const callerName = req.user!.name || null;

    if (!action || !status) {
      return res.status(400).json({ error: 'action and status are required.' });
    }

    // Safety check: reject if any sensitive keys are accidentally included
    const safeMetadata = metadata ? { ...metadata } : null;
    if (safeMetadata) {
      delete safeMetadata.password;
      delete safeMetadata.password_hash;
      delete safeMetadata.token;
      delete safeMetadata.api_key;
      delete safeMetadata.service_role_key;
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('audit_logs')
      .insert({
        user_id: req.user!.userId || null,
        user_email: callerEmail,
        user_name: callerName,
        role,
        action: String(action).toUpperCase(),
        status: String(status).toUpperCase(),
        ip_address: ip_address || null,
        user_agent: user_agent || null,
        metadata: safeMetadata,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[auditLog] Insert error:', error.message);
      // Don't block the caller — audit log failure should not break the app
      return res.status(200).json({ success: false, error: error.message });
    }

    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    console.error('[auditLog] POST error:', err?.message);
    return res.status(200).json({ success: false, error: err?.message });
  }
});

/**
 * GET /api/audit-logs
 *
 * Returns audit logs RESTRICTED to the caller's own role.
 *
 * The filter is applied in the DATABASE query, not in the response body, so the
 * API response itself only ever contains the authorized role's records — the
 * frontend never receives the other role's rows and hides them.
 *
 * Because the filter is part of the same query, it applies to every read: the
 * initial load, a refresh, a search, a sort and a limited page all operate on
 * the already-scoped set.
 *
 * The caller's role comes from the verified JWT (`req.user.role`). A `?role=`
 * parameter is NEVER trusted for scoping; if one is supplied it must fall
 * inside the caller's own scope, otherwise the request is rejected with 403.
 */
router.get('/audit-logs', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // ---- Authorisation is decided here, from the session, not the client ----
    const viewerRole = req.user!.role;
    const allowedRoles = AUDIT_SCOPE_BY_ROLE[viewerRole] ?? [];

    if (allowedRoles.length === 0) {
      return res.status(403).json({
        error: `Access denied. Audit logs are not available to the ${viewerRole} role.`,
        code: 'AUDIT_LOG_ACCESS_DENIED'
      });
    }

    // A client-supplied role is tolerated only when it is already inside the
    // caller's scope. Anything else is an attempted privilege escalation.
    const requestedRole = req.query.role ? normalizeRole(req.query.role) : null;
    if (requestedRole && !allowedRoles.includes(requestedRole as AppRole)) {
      return res.status(403).json({
        error: `Access denied. The ${viewerRole} role may only read ${allowedRoles.join(', ')} audit logs.`,
        code: 'AUDIT_LOG_SCOPE_ESCALATION'
      });
    }

    if (!isSupabaseConfigured()) {
      return res.json([]);
    }

    const { search, action, status, from, to, limit } = req.query;
    const client = getSupabaseClient();

    let query = client
      .from('audit_logs')
      .select('*')
      // ---- the role filter: applied in the database, before limit/order ----
      .in('role', allowedRoles)
      .order('created_at', { ascending: false })
      .limit(clampLimit(limit));

    if (action) query = query.eq('action', String(action).toUpperCase());
    if (status) query = query.eq('status', String(status).toUpperCase());
    if (from) query = query.gte('created_at', String(from));
    if (to) query = query.lte('created_at', String(to));
    if (search) {
      const s = String(search).toLowerCase().replace(/[,()]/g, ' ');
      query = query.or(`user_email.ilike.%${s}%,user_name.ilike.%${s}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Last-resort guarantee: never emit a row outside the authorized scope,
    // even if the database or a proxy altered the query.
    const rows = (data || []).filter(
      (row: any) => allowedRoles.includes(normalizeRole(row?.role) as AppRole)
    );

    return res.json(rows);
  } catch (err: any) {
    console.error('[auditLog] GET error:', err?.message);
    return res.status(500).json({ error: err?.message || 'Failed to fetch audit logs.' });
  }
});

export default router;
