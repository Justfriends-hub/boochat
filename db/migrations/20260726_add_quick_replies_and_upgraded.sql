-- Idempotent migration: add is_upgraded fields to profiles and quick_replies table
-- Enforces RLS for quick_replies; max 50-per-user limit is enforced in the API layer (see IMPLEMENTATION.md)

-- Add upgraded columns to profiles
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS is_upgraded boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS upgraded_at timestamp with time zone;

ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS upgraded_by uuid;

-- Add foreign key for upgraded_by if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_upgraded_by_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_upgraded_by_fkey FOREIGN KEY (upgraded_by) REFERENCES auth.users(id);
  END IF;
END$$;

-- Create quick_replies table
CREATE TABLE IF NOT EXISTS public.quick_replies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  shortcut text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT quick_replies_user_shortcut_unique UNIQUE (user_id, shortcut),
  CONSTRAINT quick_replies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS quick_replies_user_idx ON public.quick_replies (user_id);
CREATE INDEX IF NOT EXISTS quick_replies_user_position_idx ON public.quick_replies (user_id, position);

-- Row Level Security for quick_replies: users may only operate on their own rows
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Quick replies: select own" ON public.quick_replies;
CREATE POLICY "Quick replies: select own" ON public.quick_replies
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Quick replies: insert own" ON public.quick_replies;
CREATE POLICY "Quick replies: insert own" ON public.quick_replies
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Quick replies: update own" ON public.quick_replies;
CREATE POLICY "Quick replies: update own" ON public.quick_replies
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Quick replies: delete own" ON public.quick_replies;
CREATE POLICY "Quick replies: delete own" ON public.quick_replies
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Note: limit of 50 quick_replies per user is enforced in the API layer.
