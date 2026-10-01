-- ============================================================
-- Migration 014: User Management Improvements & Academic Year Update
--
-- CHANGES (all additive — no existing rows deleted):
--   1. user_accounts.must_change_password  — first-login enforcement
--   2. user_accounts.department — for external user profiles
--   3. academic_years seed: mark 2026-2027 as active, others inactive
--   4. questions.pi — ensure column exists (guard, already in 001)
--
-- Safe to run multiple times (idempotent).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. user_accounts: add must_change_password
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_accounts'
      AND column_name  = 'must_change_password'
  ) THEN
    ALTER TABLE public.user_accounts
      ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Existing admin accounts do NOT need a forced password change.
UPDATE public.user_accounts
   SET must_change_password = false
 WHERE role IN ('SUPER_ADMIN', 'EXAM_CELL')
   AND email IN (
     'examcell@msajce-edu.in',
     'superaadmin@examcell-edu.in'
   );

-- ============================================================
-- 2. user_accounts: add department field (for external users)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_accounts'
      AND column_name  = 'department'
  ) THEN
    ALTER TABLE public.user_accounts
      ADD COLUMN department VARCHAR(20) NULL;
  END IF;
END $$;

-- ============================================================
-- 3. user_accounts: ensure PRINCIPAL role is allowed
-- ============================================================
DO $$
BEGIN
  -- Drop old constraint (which may not include PRINCIPAL)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_accounts_role_check'
      AND conrelid = 'public.user_accounts'::regclass
  ) THEN
    ALTER TABLE public.user_accounts DROP CONSTRAINT user_accounts_role_check;
  END IF;

  -- Re-add with all three allowed roles
  ALTER TABLE public.user_accounts
    ADD CONSTRAINT user_accounts_role_check
    CHECK (role IN ('SUPER_ADMIN', 'EXAM_CELL', 'PRINCIPAL'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 4. academic_years: set 2026-2027 as the current active year
-- ============================================================
INSERT INTO public.academic_years (year_label, status)
  VALUES ('2026-2027', 'active')
ON CONFLICT (year_label) DO UPDATE SET status = 'active', updated_at = NOW();

-- All other years become inactive
UPDATE public.academic_years
   SET status     = 'inactive',
       updated_at = NOW()
 WHERE year_label <> '2026-2027';

-- ============================================================
-- 5. questions.pi — guard: ensure column exists
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'questions'
      AND column_name  = 'pi'
  ) THEN
    ALTER TABLE public.questions ADD COLUMN pi TEXT NULL;
  END IF;
END $$;

-- ============================================================
-- DONE
-- After running this migration:
--   - The login flow checks must_change_password and redirects
--     new external users to the Change Password screen.
--   - The academic year dropdown will default to 2026-2027.
--   - Existing questions retain their pi values.
-- ============================================================
