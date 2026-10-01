import express, { Request, Response } from 'express';
import { loginUser } from '../services/authService';
import { isSupabaseConfigured, getSupabaseClient } from '../services/supabaseQuestionBankService';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';

const router = express.Router();

/**
 * Helper: insert an audit log entry (fire-and-forget).
 * Never stores passwords, tokens, or API keys.
 */
async function insertAuditLog(params: {
  user_id?: string | null;
  user_email: string;
  user_name?: string | null;
  role: string;
  action: string;
  status: string;
  ip_address?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, any> | null;
}): Promise<void> {
  try {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseClient();
    await client.from('audit_logs').insert({
      user_id: params.user_id || null,
      user_email: String(params.user_email).toLowerCase().trim(),
      user_name: params.user_name || null,
      role: String(params.role),
      action: String(params.action).toUpperCase(),
      status: String(params.status).toUpperCase(),
      ip_address: params.ip_address || null,
      user_agent: params.user_agent || null,
      metadata: params.metadata || null,
      created_at: new Date().toISOString()
    });
  } catch (err: any) {
    // Audit log failure must never break the auth flow
    console.warn('[audit] Failed to insert audit log:', err?.message);
  }
}

/**
 * POST /api/auth/login
 * Validates credentials, returns JWT token and user role.
 * The password is NEVER returned. Audit log recorded for success/failure.
 */
router.post('/auth/login', async (req: Request, res: Response) => {
  const ip = req.ip || req.headers['x-forwarded-for'] as string || null;
  const ua = req.headers['user-agent'] || null;

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
        error: 'Email and password are required.'
      });
    }

    if (!isSupabaseConfigured()) {
      return res.status(500).json({
        success: false,
        message: 'Database configuration is missing',
        error: 'Database configuration is missing. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify Environment Variables.'
      });
    }

    const result = await loginUser(email, password);

    // Audit log — success (fire-and-forget, no await blocking)
    insertAuditLog({
      user_id: result.userId,
      user_email: result.email,
      user_name: result.name,
      role: result.role,
      action: 'LOGIN',
      status: 'SUCCESS',
      ip_address: ip,
      user_agent: ua
    });

    // Return user info + token — password_hash is NEVER included
    return res.json({
      success: true,
      token: result.token,
      mustChangePassword: result.mustChangePassword || false,
      user: {
        id: result.userId,
        email: result.email,
        role: result.role,
        name: result.name
      }
    });
  } catch (err: any) {
    const isConfigError = err?.code === 'CONFIG_MISSING' || err?.message?.includes('Database configuration is missing');
    const isConnectionError = err?.code === 'SUPABASE_CONNECTION_ERROR' || err?.message?.includes('Supabase connection failed');
    const isAuthError = err?.code === 'INVALID_CREDENTIALS' ||
                        err?.message?.includes('Invalid email or password') ||
                        err?.message?.includes('not found');

    const statusCode = isAuthError ? 401 : 500;
    const message = isConfigError
      ? 'Database configuration is missing'
      : isConnectionError
      ? (err?.message || 'Supabase connection failed')
      : isAuthError
      ? 'Invalid email or password.'
      : (err?.message || 'Login failed.');

    // Audit log — failed login (do NOT record password, only email)
    const attemptedEmail = req.body?.email || 'unknown';
    if (isAuthError && !isConfigError && !isConnectionError) {
      insertAuditLog({
        user_id: null,
        user_email: String(attemptedEmail).toLowerCase().trim(),
        user_name: null,
        role: 'UNKNOWN',
        action: 'LOGIN',
        status: 'FAILED',
        ip_address: ip,
        user_agent: ua,
        metadata: { reason: 'Invalid credentials' }
      });
    }

    return res.status(statusCode).json({
      success: false,
      message,
      error: err?.message || message
    });
  }
});

/**
 * POST /api/auth/logout
 * Records a LOGOUT audit entry. The client clears its own JWT.
 */
router.post('/auth/logout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const ip = req.ip || req.headers['x-forwarded-for'] as string || null;
  const ua = req.headers['user-agent'] || null;

  // Fire-and-forget audit log
  if (req.user) {
    insertAuditLog({
      user_id: req.user.userId,
      user_email: req.user.email,
      user_name: req.user.name,
      role: req.user.role,
      action: 'LOGOUT',
      status: 'SUCCESS',
      ip_address: ip,
      user_agent: ua
    });
  }

  return res.json({ success: true, message: 'Logged out.' });
});

export default router;
