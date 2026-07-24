-- ═══════════════════════════════════════════════════════════════════════════════
-- Image Upload Pipeline — Database Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. messages: add image_path column ──────────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS image_path text;

-- ─── 2. Create Storage Buckets ───────────────────────────────────────────────
-- This actually creates the buckets (many migrations forget this step).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars',       'avatars',       true,  26214400, ARRAY['image/jpeg','image/png','image/webp','image/gif']),
  ('channel-media', 'channel-media', false, 26214400, ARRAY['image/jpeg','image/png','image/webp','image/gif']),
  ('chat-media',    'chat-media',    false, 26214400, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;   -- safe to run multiple times

-- ─── 3. RLS Policies — avatars (PUBLIC bucket) ───────────────────────────────

-- Public read: anyone (even unauthenticated) can see avatars via public URL
CREATE POLICY "avatars: public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

-- Authenticated user can upload into their own folder (path starts with their userId)
CREATE POLICY "avatars: owner insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated user can overwrite / update their own avatar
CREATE POLICY "avatars: owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated user can delete their own avatar
CREATE POLICY "avatars: owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── 4. RLS Policies — channel-media (PRIVATE bucket) ───────────────────────

-- Any authenticated user can read channel media (signed URLs are required)
CREATE POLICY "channel-media: authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'channel-media');

-- Any authenticated user can upload channel media
CREATE POLICY "channel-media: authenticated insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'channel-media');

-- Uploader can delete their own channel media
CREATE POLICY "channel-media: owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'channel-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── 5. RLS Policies — chat-media (PRIVATE bucket) ──────────────────────────

-- Any authenticated user can read chat media (signed URLs required)
CREATE POLICY "chat-media: authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'chat-media');

-- Any authenticated user can upload chat media
CREATE POLICY "chat-media: authenticated insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'chat-media');

-- Uploader can delete their own chat media
CREATE POLICY "chat-media: owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── 6. Verification queries ─────────────────────────────────────────────────
-- Run these separately to confirm everything was created:

-- Check buckets exist:
-- SELECT id, name, public FROM storage.buckets WHERE id IN ('avatars', 'channel-media', 'chat-media', 'status-media');

-- Check image_path column:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'messages' AND column_name = 'image_path';

-- ─── 7. Status tables (if not already created) ───────────────────────────────
-- These fix the 400 errors on /rest/v1/statuses and /rest/v1/status_views

CREATE TABLE IF NOT EXISTS statuses (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('image','video','text')),
  media_url    text,
  caption      text,
  privacy_mode text        DEFAULT 'all',   -- 'all' | 'contacts' | 'custom'
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS status_views (
  status_id  text  NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  viewer_id  uuid  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS status_reactions (
  status_id  text  NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  user_id    uuid  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji      text  NOT NULL,
  PRIMARY KEY (status_id, user_id)
);

-- Enable RLS on status tables
ALTER TABLE statuses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_views      ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_reactions  ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users can read all statuses
CREATE POLICY IF NOT EXISTS "statuses: authenticated read"
  ON statuses FOR SELECT TO authenticated USING (true);

CREATE POLICY IF NOT EXISTS "statuses: owner insert"
  ON statuses FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "statuses: owner delete"
  ON statuses FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "status_views: authenticated insert"
  ON status_views FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = viewer_id);

CREATE POLICY IF NOT EXISTS "status_views: authenticated read"
  ON status_views FOR SELECT TO authenticated USING (true);

CREATE POLICY IF NOT EXISTS "status_reactions: authenticated all"
  ON status_reactions FOR ALL TO authenticated USING (true)
  WITH CHECK (auth.uid() = user_id);

-- ─── 8. status-media bucket ──────────────────────────────────────────────────
-- Used by statusApi.ts for storing status photos/videos

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'status-media', 'status-media', false, 52428800,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "status-media: authenticated read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'status-media');

CREATE POLICY "status-media: owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'status-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "status-media: owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'status-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
