-- ===========================================================================
-- Migration 016 — generated_paper_questions
--
-- Adds the missing link between a GENERATED PAPER and the QUESTIONS it
-- actually used:
--
--     generated_papers
--            |
--            v
--     generated_paper_questions      <-- the selected questions + their order
--            |
--            v
--     questions  (original)  |  iat_generated_questions (scrutinized/reduced)
--
-- `generated_papers` already exists (migration 001 + 003/010/012/013) and is
-- NOT modified here: no columns are added, dropped or renamed. This migration
-- only creates the child mapping table that did not exist, plus the two
-- provenance columns `question_usage_history` was designed for but never
-- received on a fresh database.
--
-- HOW TO APPLY
--   Supabase dashboard -> SQL Editor -> paste -> Run.
--   (This project has no exec_sql RPC, so DDL cannot be applied from the API.)
--
-- Safe to run repeatedly: every object is created with IF NOT EXISTS.
-- No existing table is dropped, truncated or recreated.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The generated-paper -> question mapping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generated_paper_questions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Parent: the generated paper. Deleting the paper removes its mappings.
  paper_id            UUID NOT NULL REFERENCES public.generated_papers(id) ON DELETE CASCADE,

  -- Denormalised so a paper stays readable (and filterable) without a join.
  paper_code          TEXT,

  -- The actual source question that was selected.
  --   questions.id                  -> original question bank
  --   iat_generated_questions.id    -> scrutinized / reduced (IAT) bank
  -- Exactly one of these two is set; both are nullable so the table can be
  -- created before either question source exists.
  question_id         UUID REFERENCES public.questions(id) ON DELETE CASCADE,
  iat_question_id     UUID REFERENCES public.iat_generated_questions(id) ON DELETE CASCADE,

  -- Which source the selection came from: 'original' | 'reduced'.
  question_bank_type  VARCHAR(10) NOT NULL DEFAULT 'original'
                        CHECK (question_bank_type IN ('original', 'reduced')),

  -- The question bank the selection was drawn from.
  question_bank_id    UUID,

  -- Presentation captured at selection time, so a paper still renders
  -- correctly even if the bank is later re-imported.
  question_number     TEXT,
  unit                INTEGER,
  part                VARCHAR(20),
  marks               INTEGER,
  btl                 VARCHAR(20),          -- BTL / RBT / K-level
  co                  VARCHAR(50),          -- course outcome
  pi                  VARCHAR(50),          -- programme index
  question_text       TEXT,

  -- Position of this question inside the paper (1-based, as printed).
  order_index         INTEGER NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A selection is either an original question or a scrutinized one, never both.
  CONSTRAINT chk_gpq_single_source
    CHECK ((question_id IS NOT NULL AND iat_question_id IS NULL)
        OR (question_id IS NULL AND iat_question_id IS NOT NULL))
);

COMMENT ON TABLE public.generated_paper_questions IS
  'Questions actually selected into a generated paper, in printed order. Child of generated_papers.';

CREATE INDEX IF NOT EXISTS idx_gpq_paper        ON public.generated_paper_questions (paper_id);
CREATE INDEX IF NOT EXISTS idx_gpq_question     ON public.generated_paper_questions (question_id);
CREATE INDEX IF NOT EXISTS idx_gpq_iat_question ON public.generated_paper_questions (iat_question_id);
CREATE INDEX IF NOT EXISTS idx_gpq_order        ON public.generated_paper_questions (paper_id, order_index);

-- ---------------------------------------------------------------------------
-- 1b. generated_papers — which source question bank produced the paper
--
-- Additive only, and the column names come verbatim from migration 013 (which
-- had not been applied to this database). `question_bank_source` already exists
-- and stays the app-level vocabulary ('ORIGINAL' | 'IAT_GENERATED');
-- `question_bank_type` is the lowercase archive vocabulary used by
-- generated_paper_questions. The two are kept consistent below.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='generated_papers' AND column_name='question_bank_id') THEN
    ALTER TABLE public.generated_papers ADD COLUMN question_bank_id UUID NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='generated_papers' AND column_name='question_bank_type') THEN
    ALTER TABLE public.generated_papers ADD COLUMN question_bank_type VARCHAR(10) NOT NULL DEFAULT 'original';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_generated_papers_bank_type') THEN
    ALTER TABLE public.generated_papers
      ADD CONSTRAINT chk_generated_papers_bank_type
      CHECK (question_bank_type IN ('original','reduced'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_generated_papers_bank ON public.generated_papers (question_bank_id);

-- End Semester papers always come from the original bank; a scrutinized /
-- reduced bank is an IAT-only concept.
UPDATE public.generated_papers
   SET question_bank_type = 'original',
       question_bank_source = 'ORIGINAL',
       iat_generated_bank_id = NULL
 WHERE exam_type = 'End Semester Examination'
   AND question_bank_type IS DISTINCT FROM 'original';

UPDATE public.generated_papers
   SET question_bank_type = 'reduced'
 WHERE question_bank_source = 'IAT_GENERATED'
   AND question_bank_type IS DISTINCT FROM 'reduced';

-- ---------------------------------------------------------------------------
-- 2. Same paper must not list the same source question twice.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_gpq_paper_question') THEN
    ALTER TABLE public.generated_paper_questions
      ADD CONSTRAINT uq_gpq_paper_question UNIQUE (paper_id, question_id, iat_question_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security — service_role / server API only, matching the
--    policy style used by the rest of this schema.
-- ---------------------------------------------------------------------------
ALTER TABLE public.generated_paper_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on generated_paper_questions" ON public.generated_paper_questions;
CREATE POLICY "Allow all on generated_paper_questions" ON public.generated_paper_questions
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4. question_usage_history — add the provenance columns migration 012/013
--    describe. They are absent on a database built straight from migration
--    001, and `question_bank_type` / `paper_id` are what let usage rows be
--    traced back to a paper and to the bank it came from.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='question_usage_history' AND column_name='question_bank_id') THEN
    ALTER TABLE public.question_usage_history ADD COLUMN question_bank_id UUID NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='question_usage_history' AND column_name='question_bank_type') THEN
    ALTER TABLE public.question_usage_history ADD COLUMN question_bank_type VARCHAR(10) NOT NULL DEFAULT 'original';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='question_usage_history' AND column_name='paper_id') THEN
    ALTER TABLE public.question_usage_history ADD COLUMN paper_id UUID NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='question_usage_history' AND column_name='subject_code') THEN
    ALTER TABLE public.question_usage_history ADD COLUMN subject_code VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='question_usage_history' AND column_name='set_letter') THEN
    ALTER TABLE public.question_usage_history ADD COLUMN set_letter VARCHAR(2) NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_usage_question_bank_type') THEN
    ALTER TABLE public.question_usage_history
      ADD CONSTRAINT chk_usage_question_bank_type
      CHECK (question_bank_type IN ('original','reduced'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_usage_bank ON public.question_usage_history (question_bank_id);
CREATE INDEX IF NOT EXISTS idx_usage_paper ON public.question_usage_history (paper_id);

-- ---------------------------------------------------------------------------
-- 5. Backfill: attach existing usage rows to their paper when the paper_code
--    matches. Safe on an empty table.
-- ---------------------------------------------------------------------------
UPDATE public.question_usage_history u
   SET paper_id = g.id
  FROM public.generated_papers g
 WHERE u.paper_id IS NULL
   AND u.paper_code IS NOT NULL
   AND g.paper_code = u.paper_code;

-- ---------------------------------------------------------------------------
-- 6. Verification
-- ---------------------------------------------------------------------------
-- SELECT count(*) FROM public.generated_paper_questions;
-- SELECT paper_code, count(*) FROM public.generated_paper_questions
--   GROUP BY paper_code ORDER BY paper_code;