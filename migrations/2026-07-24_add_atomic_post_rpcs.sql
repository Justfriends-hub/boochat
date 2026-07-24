-- Migration: add atomic increment/decrement RPCs for posts

ALTER TABLE IF EXISTS public.channel_posts
  ADD COLUMN IF NOT EXISTS like_count integer NOT NULL DEFAULT 0;

-- atomic increment views
CREATE OR REPLACE FUNCTION public.atomic_increment_post_views(p_post_id uuid, p_amount integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE channel_posts
  SET view_count = COALESCE(view_count, 0) + p_amount
  WHERE id = p_post_id;
$$;

-- atomic increment likes
CREATE OR REPLACE FUNCTION public.atomic_increment_post_likes(p_post_id uuid, p_amount integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE channel_posts
  SET like_count = COALESCE(like_count, 0) + p_amount
  WHERE id = p_post_id;
$$;

-- atomic decrement likes (can be same as increment with negative amount)
CREATE OR REPLACE FUNCTION public.atomic_decrement_post_likes(p_post_id uuid, p_amount integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE channel_posts
  SET like_count = GREATEST(COALESCE(like_count, 0) - p_amount, 0)
  WHERE id = p_post_id;
$$;

-- atomic toggle like and cached count in one transaction
CREATE OR REPLACE FUNCTION public.toggle_channel_post_like(p_post_id uuid, p_user_id uuid)
RETURNS void LANGUAGE sql AS $$
  WITH deleted AS (
    DELETE FROM channel_post_reactions
    WHERE post_id = p_post_id
      AND user_id = p_user_id
      AND emoji = '❤️'
    RETURNING 1
  ), inserted AS (
    INSERT INTO channel_post_reactions(post_id, user_id, emoji)
    SELECT p_post_id, p_user_id, '❤️'
    WHERE NOT EXISTS (SELECT 1 FROM deleted)
    ON CONFLICT DO NOTHING
    RETURNING 1
  ), delta AS (
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM deleted) THEN -1
        WHEN EXISTS (SELECT 1 FROM inserted) THEN 1
        ELSE 0
      END AS value
  )
  UPDATE channel_posts
  SET like_count = GREATEST(COALESCE(like_count, 0) + (SELECT value FROM delta), 0)
  WHERE id = p_post_id;
$$;
