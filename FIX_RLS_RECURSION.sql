-- CRITICAL FIX: Apply this SQL to your Supabase database immediately
-- This fixes the 42P17 infinite recursion error on chat_members table

-- Step 1: Temporarily disable RLS to clean up old policies
ALTER TABLE public.chat_members DISABLE ROW LEVEL SECURITY;

-- Step 2: Drop ALL old conflicting policies
DROP POLICY IF EXISTS "chat_members delete" ON chat_members;
DROP POLICY IF EXISTS "chat_members insert" ON chat_members;
DROP POLICY IF EXISTS "chat_members select" ON chat_members;
DROP POLICY IF EXISTS "chat_members_insert_authenticated" ON chat_members;
DROP POLICY IF EXISTS "chat_members_select_members" ON chat_members;
DROP POLICY IF EXISTS "Users can view chat members" ON chat_members;
DROP POLICY IF EXISTS "Authenticated users can add members" ON chat_members;

-- Step 3: Re-enable RLS
ALTER TABLE public.chat_members ENABLE ROW LEVEL SECURITY;

-- Step 4: Create the non-recursive helper function
CREATE OR REPLACE FUNCTION public.is_chat_member(_chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_members
    WHERE chat_id = _chat_id
      AND user_id = auth.uid()
  )
$$;

-- Step 5: Create CLEAN, non-recursive policies
CREATE POLICY "Users can view chat members" ON chat_members
  FOR SELECT
  USING (
    user_id = auth.uid() OR public.is_chat_member(chat_id)
  );

CREATE POLICY "Authenticated users can add members" ON chat_members
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can delete their own membership" ON chat_members
  FOR DELETE
  USING (user_id = auth.uid());
