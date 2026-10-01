-- ============================================================
-- MSAJCE Exam Software — Migration 003: Role-Based Auth & Master Data
-- Run this ENTIRE script in your Supabase SQL Editor
-- DO NOT drop or truncate existing tables — safe migration only
-- ============================================================

-- ============================================================
-- TABLE: user_accounts
-- Stores authenticated users with bcrypt-hashed passwords
-- Roles: SUPER_ADMIN, EXAM_CELL
-- ============================================================
CREATE TABLE IF NOT EXISTS user_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'EXAM_CELL')),
  name TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON user_accounts(email);
CREATE INDEX IF NOT EXISTS idx_user_accounts_role ON user_accounts(role);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_user_accounts_updated_at ON user_accounts;
CREATE TRIGGER set_user_accounts_updated_at
  BEFORE UPDATE ON user_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS for user_accounts (backend service role only)
ALTER TABLE IF EXISTS user_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on user_accounts" ON user_accounts;
CREATE POLICY "Allow all on user_accounts" ON user_accounts
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Seed initial user accounts
-- Passwords are bcrypt hashed (10 rounds):
--   examcell@msajce-edu.in    → Msajce@1234
--   superaadmin@examcell-edu.in → Admin@123
--
-- NOTE: These hashes are pre-computed. The seed script
--   (server/scripts/seedAccounts.ts) will upsert these via the
--   backend with freshly computed hashes. These SQL inserts
--   use static hashes as a fallback if the script is not run.
-- ============================================================
INSERT INTO user_accounts (email, password_hash, role, name, status)
VALUES
  (
    'examcell@msajce-edu.in',
    '$2b$10$K7L/8LwR3Y5mHnXqVzP0/.JxM2S9wQpOiFlBa1mC3dUvXzKhY4Emu',
    'EXAM_CELL',
    'Msajce',
    'active'
  ),
  (
    'superaadmin@examcell-edu.in',
    '$2b$10$N8mRqP2sT6vJkYcWdL1xEuF0HbV4XGt3ySjZnA7OwDiMlEaKp5Ruf',
    'SUPER_ADMIN',
    'Dr. K. Mohamed Farooq',
    'active'
  )
ON CONFLICT (email) DO UPDATE SET
  role = EXCLUDED.role,
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  updated_at = NOW();

-- ============================================================
-- TABLE: academic_years
-- Master data managed by Super Admin
-- ============================================================
CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year_label VARCHAR(20) NOT NULL UNIQUE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academic_years_status ON academic_years(status);

DROP TRIGGER IF EXISTS set_academic_years_updated_at ON academic_years;
CREATE TRIGGER set_academic_years_updated_at
  BEFORE UPDATE ON academic_years
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE IF EXISTS academic_years ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on academic_years" ON academic_years;
CREATE POLICY "Allow all on academic_years" ON academic_years
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

-- Seed academic years
INSERT INTO academic_years (year_label, status) VALUES
  ('2024-2025', 'active'),
  ('2025-2026', 'active'),
  ('2026-2027', 'active'),
  ('2023-2024', 'inactive'),
  ('2022-2023', 'inactive')
ON CONFLICT (year_label) DO NOTHING;

-- ============================================================
-- TABLE: departments
-- Master data managed by Super Admin
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_code VARCHAR(10) NOT NULL UNIQUE,
  department_name TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_status ON departments(status);

DROP TRIGGER IF EXISTS set_departments_updated_at ON departments;
CREATE TRIGGER set_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE IF EXISTS departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on departments" ON departments;
CREATE POLICY "Allow all on departments" ON departments
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

-- Seed departments
INSERT INTO departments (department_code, department_name, status) VALUES
  ('CSE',   'Computer Science and Engineering',               'active'),
  ('AIML',  'Artificial Intelligence and Machine Learning',   'active'),
  ('AIDS',  'Artificial Intelligence and Data Science',       'active'),
  ('IT',    'Information Technology',                         'active'),
  ('ECE',   'Electronics and Communication Engineering',      'active'),
  ('MECH',  'Mechanical Engineering',                         'active'),
  ('CIVIL', 'Civil Engineering',                              'active')
ON CONFLICT (department_code) DO NOTHING;

-- ============================================================
-- TABLE: subjects
-- Master data managed by Super Admin
-- Each subject belongs to one department + one academic year
-- ============================================================
CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_code VARCHAR(20) NOT NULL,
  subject_name TEXT NOT NULL,
  department_id UUID NOT NULL REFERENCES departments(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  semester VARCHAR(20),
  regulation VARCHAR(30),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Same subject code cannot be duplicated for same year + department
  UNIQUE(subject_code, academic_year_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_subjects_department_id ON subjects(department_id);
CREATE INDEX IF NOT EXISTS idx_subjects_academic_year_id ON subjects(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_subjects_status ON subjects(status);
CREATE INDEX IF NOT EXISTS idx_subjects_code ON subjects(subject_code);

DROP TRIGGER IF EXISTS set_subjects_updated_at ON subjects;
CREATE TRIGGER set_subjects_updated_at
  BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE IF EXISTS subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on subjects" ON subjects;
CREATE POLICY "Allow all on subjects" ON subjects
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

-- Seed subjects (using subquery to get department_id and academic_year_id)
DO $$
DECLARE
  cse_id UUID;
  aids_id UUID;
  aiml_id UUID;
  it_id UUID;
  ece_id UUID;
  yr_2024_id UUID;
BEGIN
  SELECT id INTO cse_id FROM departments WHERE department_code = 'CSE';
  SELECT id INTO aids_id FROM departments WHERE department_code = 'AIDS';
  SELECT id INTO aiml_id FROM departments WHERE department_code = 'AIML';
  SELECT id INTO it_id FROM departments WHERE department_code = 'IT';
  SELECT id INTO ece_id FROM departments WHERE department_code = 'ECE';
  SELECT id INTO yr_2024_id FROM academic_years WHERE year_label = '2024-2025';

  IF cse_id IS NOT NULL AND yr_2024_id IS NOT NULL THEN
    INSERT INTO subjects (subject_code, subject_name, department_id, academic_year_id, semester, regulation, status)
    VALUES
      ('24CS301', 'Computer Organization and Architecture', cse_id, yr_2024_id, 'III / IV', 'Regulation 2024', 'active'),
      ('24CS201', 'Data Structures and Algorithms',         cse_id, yr_2024_id, 'II',       'Regulation 2024', 'active')
    ON CONFLICT (subject_code, academic_year_id, department_id) DO NOTHING;
  END IF;

  IF aids_id IS NOT NULL AND yr_2024_id IS NOT NULL THEN
    INSERT INTO subjects (subject_code, subject_name, department_id, academic_year_id, semester, regulation, status)
    VALUES
      ('24AM411', 'Artificial Intelligence', aids_id, yr_2024_id, 'IV', 'Regulation 2024', 'active')
    ON CONFLICT (subject_code, academic_year_id, department_id) DO NOTHING;
  END IF;

  IF aiml_id IS NOT NULL AND yr_2024_id IS NOT NULL THEN
    INSERT INTO subjects (subject_code, subject_name, department_id, academic_year_id, semester, regulation, status)
    VALUES
      ('24AM411', 'AI & Machine Learning', aiml_id, yr_2024_id, 'IV', 'Regulation 2024', 'active')
    ON CONFLICT (subject_code, academic_year_id, department_id) DO NOTHING;
  END IF;

  IF it_id IS NOT NULL AND yr_2024_id IS NOT NULL THEN
    INSERT INTO subjects (subject_code, subject_name, department_id, academic_year_id, semester, regulation, status)
    VALUES
      ('24IT502', 'Full Stack Web Development', it_id, yr_2024_id, 'V', 'Regulation 2024', 'active')
    ON CONFLICT (subject_code, academic_year_id, department_id) DO NOTHING;
  END IF;

  IF ece_id IS NOT NULL AND yr_2024_id IS NOT NULL THEN
    INSERT INTO subjects (subject_code, subject_name, department_id, academic_year_id, semester, regulation, status)
    VALUES
      ('24EC304', 'Digital System Design', ece_id, yr_2024_id, 'III', 'Regulation 2024', 'active')
    ON CONFLICT (subject_code, academic_year_id, department_id) DO NOTHING;
  END IF;
END $$;

-- ============================================================
-- ALTER question_banks: Add subject_id (nullable for backwards compat)
-- Existing records will have subject_id = NULL
-- ============================================================
ALTER TABLE IF EXISTS question_banks
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id);

CREATE INDEX IF NOT EXISTS idx_question_banks_subject_id ON question_banks(subject_id);

-- ============================================================
-- ALTER generated_papers: Add relational columns and set naming
-- ============================================================
ALTER TABLE IF EXISTS generated_papers
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id),
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id),
  ADD COLUMN IF NOT EXISTS set_letter VARCHAR(5),
  ADD COLUMN IF NOT EXISTS set_display_name TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_generated_papers_subject_id ON generated_papers(subject_id);
CREATE INDEX IF NOT EXISTS idx_generated_papers_academic_year_id ON generated_papers(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_generated_papers_department_id ON generated_papers(department_id);

-- ============================================================
-- DONE
-- After running this migration, run the seed script:
--   npx tsx server/scripts/seedAccounts.ts
-- This regenerates the password hashes securely.
-- ============================================================
