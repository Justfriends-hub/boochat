-- ─────────────────────────────────────────────────────────────────────────────
-- Enforce banned users server-side
--
-- profiles.banned is currently only a display flag: the client never acts on
-- it, so banned users keep full access. This migration adds one RESTRICTIVE
-- policy per user-facing table. Restrictive policies are AND-ed with every
-- permissive policy, so a banned user is locked out of everything regardless
-- of what the permissive policies allow.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: true when the given user is banned. SECURITY DEFINER so it never
-- recurses through the profiles policies themselves.
CREATE OR REPLACE FUNCTION public.is_banned(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT TRUE FROM public.profiles WHERE id = _user_id AND banned IS TRUE
  ), FALSE);
$$;

-- Convenience check for the current request's user (false for anon).
CREATE OR REPLACE FUNCTION public.current_user_is_banned()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_banned(auth.uid());
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles',
    'chats',
    'chat_members',
    'messages',
    'message_views',
    'message_reactions',
    'groups',
    'group_members',
    'group_posts',
    'group_post_reactions',
    'channels',
    'channel_members',
    'channel_posts',
    'channel_post_reactions',
    'channel_settings',
    'channel_communities',
    'removed_channel_members',
    'join_requests',
    'comments',
    'statuses',
    'status_views',
    'status_reactions',
    'quick_replies',
    'notifications'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "banned_users_blocked" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "banned_users_blocked" ON public.%I AS RESTRICTIVE FOR ALL USING (NOT public.current_user_is_banned())',
      t
    );
  END LOOP;
END $$;
