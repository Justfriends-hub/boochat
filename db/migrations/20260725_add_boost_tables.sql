-- Idempotent migration: add channel_settings and post_boosts if they do not exist

CREATE TABLE IF NOT EXISTS public.channel_settings (
  chat_id uuid PRIMARY KEY,
  boost_target integer DEFAULT 0,
  boost_kind text DEFAULT 'subscribers',
  boost_mode text DEFAULT 'gradual',
  boost_start_time timestamp with time zone,
  boost_end_time timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT channel_settings_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id)
);

CREATE TABLE IF NOT EXISTS public.post_boosts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id uuid,
  chat_id uuid NOT NULL,
  message_id uuid NOT NULL,
  boost_kind text NOT NULL,
  boost_target integer NOT NULL,
  boost_mode text NOT NULL DEFAULT 'gradual',
  boost_start_time timestamp with time zone,
  boost_end_time timestamp with time zone,
  reaction text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT post_boosts_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id),
  CONSTRAINT post_boosts_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id),
  CONSTRAINT post_boosts_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id)
);

CREATE TABLE IF NOT EXISTS public.comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content text NOT NULL,
  user_id uuid NOT NULL,
  message_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT comments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.channel_posts(id)
);

-- Optional: lightweight function to compute visible boost for a chat (sums channel_settings + active post_boosts)
CREATE OR REPLACE FUNCTION public.get_visible_boost(_chat_id uuid, _kind text DEFAULT 'any')
RETURNS integer LANGUAGE sql STABLE AS $$
SELECT COALESCE(
  (
    SELECT COALESCE(boost_target,0) FROM public.channel_settings WHERE chat_id = _chat_id
  ), 0
) + COALESCE(
  (
    SELECT COALESCE(SUM(boost_target),0) FROM public.post_boosts WHERE chat_id = _chat_id
      AND (_kind = 'any' OR boost_kind = _kind)
      AND (boost_end_time IS NULL OR boost_end_time > now())
      AND (boost_start_time IS NULL OR boost_start_time <= now())
  ), 0
);
$$;

CREATE OR REPLACE FUNCTION public.visible_status_ids(viewer_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE AS $$
SELECT ARRAY(
  SELECT id FROM public.statuses
  WHERE expires_at IS NULL OR expires_at > now()
);
$$;
