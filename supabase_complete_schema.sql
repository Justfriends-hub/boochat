-- ============================================================================
-- BOOCHAT COMPLETE SCHEMA FOR SUPABASE
-- Production-ready SQL. Paste directly into Supabase SQL Editor in order.
-- ============================================================================

-- 1. EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pg_net";

-- 2. ENUMS
-- ============================================================================
CREATE TYPE public.app_role AS ENUM ('user', 'admin');
CREATE TYPE public.chat_type AS ENUM ('dm', 'group');
CREATE TYPE public.message_kind AS ENUM ('text', 'image', 'voice');
CREATE TYPE public.post_kind AS ENUM ('text', 'image');
CREATE TYPE public.boost_kind AS ENUM ('likes', 'views');

-- 3. TABLES
-- ============================================================================

-- Profiles: 1:1 with auth.users
CREATE TABLE public.profiles (
  id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  avatar_url text,
  bio text,
  online boolean NOT NULL DEFAULT false,
  banned boolean NOT NULL DEFAULT false,
  is_upgraded boolean NOT NULL DEFAULT false,
  upgraded_at timestamp with time zone,
  upgraded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT profiles_upgraded_by_fkey FOREIGN KEY (upgraded_by) REFERENCES auth.users(id)
);

-- User Roles: Many-to-many with users (for privilege escalation prevention)
CREATE TABLE public.user_roles (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role)
);

-- Chats: Direct messages and group base
CREATE TABLE public.chats (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  type public.chat_type NOT NULL,
  name text,
  avatar_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Chat Members: Membership in chats (DMs and groups)
CREATE TABLE public.chat_members (
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chat_members_pkey PRIMARY KEY (chat_id, user_id)
);

-- Messages: Text/image/voice messages in chats
CREATE TABLE public.messages (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.message_kind NOT NULL DEFAULT 'text'::public.message_kind,
  body text NOT NULL DEFAULT ''::text,
  media_url text,
  duration integer,
  reply_to uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  forwarded_from uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  image_path text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Message Reactions: Emoji reactions on messages
CREATE TABLE public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT message_reactions_pkey PRIMARY KEY (message_id, user_id, emoji)
);

-- Message Views: Track who viewed messages
CREATE TABLE public.message_views (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT message_views_pkey PRIMARY KEY (message_id, viewer_id)
);

-- Groups: Community groups
CREATE TABLE public.groups (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL UNIQUE REFERENCES public.chats(id) ON DELETE CASCADE,
  name text NOT NULL,
  avatar_url text,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  only_admins_post boolean NOT NULL DEFAULT false,
  only_admins_add boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Group Members: Membership in groups
CREATE TABLE public.group_members (
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_admin boolean NOT NULL DEFAULT false,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT group_members_pkey PRIMARY KEY (group_id, user_id)
);

-- Group Posts: Posts in groups
CREATE TABLE public.group_posts (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.post_kind NOT NULL DEFAULT 'text'::public.post_kind,
  body text NOT NULL DEFAULT ''::text,
  image_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Group Post Reactions: Emoji reactions on group posts
CREATE TABLE public.group_post_reactions (
  post_id uuid NOT NULL REFERENCES public.group_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL DEFAULT '❤️'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT group_post_reactions_pkey PRIMARY KEY (post_id, user_id, emoji)
);

-- Channels: Public or private content channels
CREATE TABLE public.channel_communities (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  avatar_url text,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.channels (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  avatar_url text,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  visibility text NOT NULL DEFAULT 'public'::text CHECK (visibility = ANY (ARRAY['public'::text, 'private'::text])),
  discussion_chat_id uuid REFERENCES public.chats(id),
  auto_translate_enabled boolean NOT NULL DEFAULT false,
  allow_direct_messages boolean NOT NULL DEFAULT false,
  invite_link text,
  community_id uuid REFERENCES public.channel_communities(id),
  wallpaper_url text,
  appearance_color text NOT NULL DEFAULT '#7c3aed'::text CHECK (appearance_color ~ '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'::text),
  allowed_reaction_emojis text[] NOT NULL DEFAULT ARRAY['❤️'::text, '👍'::text, '🎉'::text, '😮'::text, '💲'::text]::text[]
);

-- Channel Members: Membership in channels
CREATE TABLE public.channel_members (
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_admin boolean NOT NULL DEFAULT false,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT channel_members_pkey PRIMARY KEY (channel_id, user_id)
);

-- Removed Channel Members: Audit trail for removed members
CREATE TABLE public.removed_channel_members (
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  removed_by uuid NOT NULL REFERENCES auth.users(id),
  reason text,
  removed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT removed_channel_members_pkey PRIMARY KEY (channel_id, user_id)
);

-- Channel Posts: Posts in channels
CREATE TABLE public.channel_posts (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.post_kind NOT NULL DEFAULT 'text'::public.post_kind,
  body text NOT NULL DEFAULT ''::text,
  image_url text,
  boosted_likes integer NOT NULL DEFAULT 0,
  boosted_views integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0,
  like_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Channel Post Reactions: Emoji reactions on channel posts
CREATE TABLE public.channel_post_reactions (
  post_id uuid NOT NULL REFERENCES public.channel_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL DEFAULT '❤️'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT channel_post_reactions_pkey PRIMARY KEY (post_id, user_id, emoji)
);

-- Comments: Comments (note: FK references channel_posts for now)
CREATE TABLE public.comments (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.channel_posts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Statuses: Stories/status updates (24hr expiry)
CREATE TABLE public.statuses (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind = ANY (ARRAY['image'::text, 'video'::text])),
  media_url text NOT NULL,
  caption text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '24:00:00'::interval),
  privacy_mode text NOT NULL DEFAULT 'public'::text,
  privacy_list uuid[]
);

-- Status Views: Track who viewed statuses
CREATE TABLE public.status_views (
  status_id uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT status_views_pkey PRIMARY KEY (status_id, viewer_id)
);

-- Status Reactions: Emoji reactions on statuses
CREATE TABLE public.status_reactions (
  status_id uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT status_reactions_pkey PRIMARY KEY (status_id, user_id, emoji)
);

-- Quick Replies: User-defined message shortcuts
CREATE TABLE public.quick_replies (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shortcut text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Notifications: In-app/push notifications
CREATE TABLE public.notifications (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Admin Boosts: Admin-initiated content boosts
CREATE TABLE public.admin_boosts (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id),
  post_type text NOT NULL CHECK (post_type = ANY (ARRAY['channel'::text, 'group'::text])),
  post_id uuid NOT NULL,
  kind public.boost_kind NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Post Boosts: Explicit boost campaigns on posts
CREATE TABLE public.post_boosts (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  boost_kind text NOT NULL,
  boost_target integer NOT NULL,
  boost_mode text NOT NULL DEFAULT 'gradual'::text,
  boost_start_time timestamp with time zone,
  boost_end_time timestamp with time zone,
  reaction text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Channel Settings: Per-channel boost configuration
CREATE TABLE public.channel_settings (
  chat_id uuid NOT NULL PRIMARY KEY REFERENCES public.chats(id) ON DELETE CASCADE,
  boost_target integer DEFAULT 0,
  boost_kind text DEFAULT 'subscribers'::text,
  boost_mode text DEFAULT 'gradual'::text,
  boost_start_time timestamp with time zone,
  boost_end_time timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Reports: User reports on content/users
CREATE TABLE public.reports (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Audit Logs: Admin action audit trail
CREATE TABLE public.audit_logs (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Join Requests: Requests to join private channels
CREATE TABLE public.join_requests (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  requested_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 4. INDEXES (Performance optimization)
-- ============================================================================
CREATE INDEX ON public.user_roles (user_id);
CREATE INDEX ON public.chat_members (user_id);
CREATE INDEX ON public.messages (chat_id, created_at DESC);
CREATE INDEX ON public.messages (sender_id);
CREATE INDEX ON public.messages (reply_to);
CREATE INDEX ON public.message_reactions (message_id);
CREATE INDEX ON public.message_views (viewer_id);
CREATE INDEX ON public.groups (chat_id);
CREATE INDEX ON public.group_members (user_id);
CREATE INDEX ON public.group_posts (group_id, created_at DESC);
CREATE INDEX ON public.group_posts (author_id);
CREATE INDEX ON public.group_post_reactions (post_id);
CREATE INDEX ON public.channel_members (user_id);
CREATE INDEX ON public.channel_posts (channel_id, created_at DESC);
CREATE INDEX ON public.channel_posts (author_id);
CREATE INDEX ON public.channel_post_reactions (post_id);
CREATE INDEX ON public.statuses (user_id, created_at DESC);
CREATE INDEX ON public.statuses (expires_at);
CREATE INDEX ON public.status_views (viewer_id);
CREATE INDEX ON public.status_reactions (user_id);
CREATE INDEX ON public.notifications (user_id, created_at DESC);
CREATE INDEX ON public.admin_boosts (post_id);
CREATE INDEX ON public.admin_boosts (admin_id, created_at DESC);
CREATE INDEX ON public.reports (target_type, target_id);
CREATE INDEX ON public.audit_logs (admin_id, created_at DESC);

-- 5. HELPER FUNCTIONS
-- ============================================================================

-- has_role(): Check if a user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- set_updated_at(): Trigger function to auto-update timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Auto-attach updated_at triggers to relevant tables
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(array[
      'profiles','chats','messages','groups','group_posts',
      'channels','channel_posts','quick_replies'
    ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at
         BEFORE UPDATE ON public.%1$s
         FOR EACH ROW
         EXECUTE FUNCTION public.set_updated_at()',
      t
    );
  END LOOP;
END $$;

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
-- All tables, indexes, and helper functions are now ready!
-- Next steps: Add Row-Level Security (RLS) policies as needed for your app.
