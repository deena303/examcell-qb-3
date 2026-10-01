-- ============================================================
-- Migration 015: Keep 2024-2028 active alongside 2026-2027
--
-- WHY
--   Migration 014 set 2026-2027 as the ONLY active academic year.
--   But 2026-2027 has no question banks at all, while 2024-2028 holds
--   12 of the 13 uploaded question banks. The screens that read
--   active years only — IAT Question Bank Generator, Import Question
--   Bank, Generate Paper, IAT Generated Banks, Subject Bank and the
--   header year selector — could therefore reach NO existing bank.
--
--   This migration re-activates 2024-2028 so those screens work again,
--   while 2026-2027 stays the default selection for new uploads
--   (the academic-years endpoint sorts year_label DESC, so 2026-2027
--   is still first).
--
-- ALSO
--   Syncs academic_years.is_active with academic_years.status. Migration
--   014 only set `status`, which left is_active=true on inactive years.
--   The application reads `status`, so this is a data-consistency fix.
--
-- Safe to run multiple times (idempotent).
-- No question banks, subjects or questions are modified.
-- Run in the Supabase SQL Editor.
-- ============================================================

-- 1. The two years that must be active.
UPDATE public.academic_years
   SET status     = 'active',
       is_active  = true,
       updated_at = NOW()
 WHERE year_label IN ('2024-2028', '2026-2027');

-- 2. Everything else is inactive.
UPDATE public.academic_years
   SET status     = 'inactive',
       is_active  = false,
       updated_at = NOW()
 WHERE year_label NOT IN ('2024-2028', '2026-2027');

-- 3. Keep the two flags in agreement for any row added later by mistake.
--    (Belt-and-braces: steps 1-2 already guarantee this.)
UPDATE public.academic_years
   SET is_active = (status = 'active')
 WHERE is_active IS DISTINCT FROM (status = 'active');
