import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';
import { isSupabaseConfigured, getSupabaseClient } from '../services/supabaseQuestionBankService';

const router = express.Router();

/** Fire-and-forget audit log helper. */
async function insertAuditLog(params: {
  user_id?: string | null;
  user_email: string;
  user_name?: string | null;
  role: string;
  action: string;
  status: string;
  ip_address?: string | null;
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
      metadata: params.metadata || null,
      created_at: new Date().toISOString()
    });
  } catch (err: any) {
    console.warn('[audit] userManagementRoutes audit log failure:', err?.message);
  }
}

/**
 * GET /api/users
 * List all non-Super-Admin accounts (Exam Cell + external roles).
 * Only SUPER_ADMIN or EXAM_CELL may call this.
 */
router.get('/users', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user || !['SUPER_ADMIN', 'EXAM_CELL'].includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden.' });
  }

  if (!isSupabaseConfigured()) {
    return res.status(500).json({ success: false, error: 'Database not configured.' });
  }

  try {
    const client = getSupabaseClient();

    let query = client
      .from('user_accounts')
      .select('id, email, role, name, status, department, must_change_password, created_at, updated_at')
      .order('created_at', { ascending: false });

    // Exam Cell cannot see Super Admin accounts
    if (req.user.role === 'EXAM_CELL') {
      query = query.neq('role', 'SUPER_ADMIN');
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    // Never return password_hash
    return res.json({ success: true, users: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to list users.' });
  }
});

/**
 * POST /api/users
 * Create an external user account with a temporary password.
 * - SUPER_ADMIN can create any role except another SUPER_ADMIN (they use seed script).
 * - EXAM_CELL can create EXAM_CELL or PRINCIPAL accounts only.
 * - Password is bcrypt-hashed. Temporary password shown to admin once; never stored plaintext.
 * - must_change_password is set to TRUE for all newly created accounts.
 */
router.post('/users', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user || !['SUPER_ADMIN', 'EXAM_CELL'].includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden.' });
  }

  const { name, email, role, department, temporaryPassword } = req.body;

  if (!name || !email || !role || !temporaryPassword) {
    return res.status(400).json({ success: false, error: 'name, email, role, and temporaryPassword are required.' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address.' });
  }

  // Password strength: minimum 8 chars
  if (String(temporaryPassword).length < 8) {
    return res.status(400).json({ success: false, error: 'Temporary password must be at least 8 characters.' });
  }

  // Role restriction: Exam Cell cannot create Super Admin
  const allowedRoles = ['EXAM_CELL', 'PRINCIPAL'];
  const superAdminAllowedRoles = ['EXAM_CELL', 'PRINCIPAL'];
  if (req.user.role === 'EXAM_CELL' && !allowedRoles.includes(role)) {
    return res.status(403).json({ success: false, error: 'Exam Cell cannot create Super Admin accounts.' });
  }
  if (req.user.role === 'SUPER_ADMIN' && !superAdminAllowedRoles.includes(role) && role !== 'EXAM_CELL') {
    return res.status(403).json({ success: false, error: `Role "${role}" is not allowed.` });
  }
  if (!['EXAM_CELL', 'PRINCIPAL', 'SUPER_ADMIN'].includes(role)) {
    return res.status(400).json({ success: false, error: `Unknown role: ${role}` });
  }


  if (!isSupabaseConfigured()) {
    return res.status(500).json({ success: false, error: 'Database not configured.' });
  }

  try {
    const client = getSupabaseClient();
    const normalizedEmail = String(email).toLowerCase().trim();

    // Check for duplicate email
    const { data: existing } = await client
      .from('user_accounts')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    // Hash the temporary password — NEVER store plaintext
    const passwordHash = await bcrypt.hash(String(temporaryPassword), 10);

    const { data: newUser, error: insertError } = await client
      .from('user_accounts')
      .insert({
        email: normalizedEmail,
        password_hash: passwordHash,
        role,
        name: String(name).trim(),
        department: department ? String(department).trim() : null,
        status: 'active',
        must_change_password: true   // Always force password change on first login
      })
      .select('id, email, role, name, status, department, must_change_password, created_at')
      .single();

    if (insertError) throw new Error(insertError.message);

    // Audit log — NEVER log the password or hash
    const ip = req.ip || req.headers['x-forwarded-for'] as string || null;
    insertAuditLog({
      user_id: req.user.userId,
      user_email: req.user.email,
      user_name: req.user.name,
      role: req.user.role,
      action: 'EXTERNAL_USER_CREATED',
      status: 'SUCCESS',
      ip_address: ip,
      metadata: {
        created_user_email: normalizedEmail,
        created_user_role: role,
        created_user_name: String(name).trim(),
        created_user_department: department || null
        // temporaryPassword is intentionally OMITTED
      }
    });

    return res.status(201).json({
      success: true,
      message: `Account created for ${normalizedEmail}. They must change their password on first login.`,

      user: newUser  // password_hash is NOT in this SELECT
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to create user.' });
  }
});

/**
 * POST /api/users/:id/change-password
 * Allows an authenticated user to change their own password.
 * If must_change_password was true, it is set to false after success.
 * NEVER logs or returns password content.
 */
router.post('/users/:id/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Unauthorized.' });
  }

  const targetId = req.params.id;

  // Users can only change their own password; Super Admin can change anyone's
  if (req.user.userId !== targetId && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'You can only change your own password.' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required.' });
  }

  if (String(newPassword).length < 8) {
    return res.status(400).json({ success: false, error: 'New password must be at least 8 characters.' });
  }

  if (!isSupabaseConfigured()) {
    return res.status(500).json({ success: false, error: 'Database not configured.' });
  }

  try {
    const client = getSupabaseClient();

    const { data: user, error: fetchError } = await client
      .from('user_accounts')
      .select('id, email, password_hash, role, name, must_change_password')
      .eq('id', targetId)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    // Verify current password
    const isValid = await bcrypt.compare(String(currentPassword), user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, error: 'New password must be different from the current password.' });
    }

    const newHash = await bcrypt.hash(String(newPassword), 10);

    const { error: updateError } = await client
      .from('user_accounts')
      .update({
        password_hash: newHash,
        must_change_password: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', targetId);

    if (updateError) throw new Error(updateError.message);

    // Audit log — NEVER log password or hash
    const ip = req.ip || req.headers['x-forwarded-for'] as string || null;
    insertAuditLog({
      user_id: req.user.userId,
      user_email: req.user.email,
      user_name: req.user.name,
      role: req.user.role,
      action: 'PASSWORD_CHANGED',
      status: 'SUCCESS',
      ip_address: ip,
      metadata: { target_user_email: user.email }
    });

    return res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to change password.' });
  }
});

/**
 * PATCH /api/users/:id
 * Update user metadata (name, department, status).
 * Does NOT accept password changes here — use /change-password.
 */
router.patch('/users/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user || !['SUPER_ADMIN', 'EXAM_CELL'].includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden.' });
  }

  const { name, department, status } = req.body;

  if (!isSupabaseConfigured()) {
    return res.status(500).json({ success: false, error: 'Database not configured.' });
  }

  try {
    const client = getSupabaseClient();

    // Prevent Exam Cell from modifying Super Admin accounts
    if (req.user.role === 'EXAM_CELL') {
      const { data: target } = await client
        .from('user_accounts')
        .select('role')
        .eq('id', req.params.id)
        .maybeSingle();
      if (target?.role === 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, error: 'Exam Cell cannot modify Super Admin accounts.' });
      }
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = String(name).trim();
    if (department !== undefined) updates.department = department ? String(department).trim() : null;
    if (status !== undefined && ['active', 'inactive'].includes(status)) updates.status = status;

    const { data, error } = await client
      .from('user_accounts')
      .update(updates)
      .eq('id', req.params.id)
      .select('id, email, role, name, status, department, must_change_password, created_at')
      .single();

    if (error) throw new Error(error.message);
    return res.json({ success: true, user: data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to update user.' });
  }
});

export default router;
