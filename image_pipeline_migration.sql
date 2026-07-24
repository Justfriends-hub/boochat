-- ═══════════════════════════════════════════════════════════════════════════════
-- Image Upload Pipeline — Database Migration
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New Query)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. messages: add image_path column ───────────────────────────────────────
-- Stores the Supabase Storage path for chat image messages.
-- Kept separate from `body` so listMessages() can batch-resolve only non-null rows.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS image_path text;

-- ─── 2. Supabase Storage Buckets ──────────────────────────────────────────────
-- Create these in Supabase Dashboard → Storage → New Bucket (if not using CLI):
--
--   Bucket name  │ Public?
--   ─────────────┼────────
--   avatars      │  YES  ← user profile pictures served via public URL
--   channel-media│  NO   ← channel post images / channel avatars (signed URLs)
--   chat-media   │  NO   ← DM / group chat image messages (signed URLs)
--
-- Or run via Supabase CLI:
--   supabase storage create avatars --public
--   supabase storage create channel-media
--   supabase storage create chat-media

-- ─── 3. Storage RLS Policies ──────────────────────────────────────────────────
-- avatars bucket (PUBLIC — anyone can read, authenticated user can write own folder)

-- Allow public read on avatars
CREATE POLICY IF NOT EXISTS "avatars: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Allow authenticated users to upload/update their own avatar
CREATE POLICY IF NOT EXISTS "avatars: owner write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = split_part(name, '/', 1)
  );

CREATE POLICY IF NOT EXISTS "avatars: owner update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = split_part(name, '/', 1)
  );

CREATE POLICY IF NOT EXISTS "avatars: owner delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = split_part(name, '/', 1)
  );

-- channel-media bucket (PRIVATE — authenticated members can read, channel owner can write)

-- Allow authenticated users to read channel media
CREATE POLICY IF NOT EXISTS "channel-media: authenticated read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'channel-media' AND auth.role() = 'authenticated');

-- Allow authenticated users to upload channel media
CREATE POLICY IF NOT EXISTS "channel-media: authenticated write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'channel-media' AND auth.role() = 'authenticated');

-- Allow uploader to delete their channel media
CREATE POLICY IF NOT EXISTS "channel-media: owner delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'channel-media' AND auth.uid()::text = split_part(name, '/', 1));

-- chat-media bucket (PRIVATE — authenticated users can read/write their own chat files)

CREATE POLICY IF NOT EXISTS "chat-media: authenticated read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-media' AND auth.role() = 'authenticated');

CREATE POLICY IF NOT EXISTS "chat-media: authenticated write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'chat-media' AND auth.role() = 'authenticated');

CREATE POLICY IF NOT EXISTS "chat-media: owner delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'chat-media' AND auth.uid()::text = split_part(name, '/', 1));

-- ─── 4. Verification ──────────────────────────────────────────────────────────
-- After running, verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'messages' AND column_name = 'image_path';
-- Should return 1 row.
