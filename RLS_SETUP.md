# Supabase RLS (Row Level Security) Setup Guide

This guide explains how to set up the Row Level Security policies required for the Meshly chat app to work with Supabase.

## Required RLS Policies

### 1. **Profiles Table** (`public.profiles`)

**Enable RLS:**
- Go to Supabase Dashboard → Tables → `profiles`
- Click "Enable RLS"

**Policies needed:**

```sql
-- Allow users to view other profiles
DROP POLICY IF EXISTS "Users can view profiles" ON profiles;
CREATE POLICY "Users can view profiles" ON profiles
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow users to update their own profile
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
```

---

### 2. **Chats Table** (`public.chats`)

**Enable RLS:**
- Go to Supabase Dashboard → Tables → `chats`
- Click "Enable RLS"

**Policies needed:**

```sql
-- Allow authenticated users to create chats
DROP POLICY IF EXISTS "Authenticated users can create chats" ON chats;
CREATE POLICY "Authenticated users can create chats" ON chats
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Allow users to view chats they are members of
DROP POLICY IF EXISTS "Users can view their chats" ON chats;
CREATE POLICY "Users can view their chats" ON chats
  FOR SELECT
  USING (
    id IN (
      SELECT chat_id FROM public.chat_members
      WHERE user_id = auth.uid()
    )
  );

-- Allow chat members to update chat details
DROP POLICY IF EXISTS "Chat members can update chats" ON chats;
CREATE POLICY "Chat members can update chats" ON chats
  FOR UPDATE
  USING (
    id IN (
      SELECT chat_id FROM public.chat_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT chat_id FROM public.chat_members
      WHERE user_id = auth.uid()
    )
  );
```

---

### 3. **Chat Members Table** (`public.chat_members`)

**Enable RLS:**
- Go to Supabase Dashboard → Tables → `chat_members`
- Click "Enable RLS"

**Policies needed:**

```sql
-- Helper function used by chat_members RLS to avoid recursive policy evaluation
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

-- Allow users to view chat members for chats they're in
DROP POLICY IF EXISTS "Users can view chat members" ON chat_members;
CREATE POLICY "Users can view chat members" ON chat_members
  FOR SELECT
  USING (
    user_id = auth.uid() OR public.is_chat_member(chat_id)
  );

-- Allow authenticated users to add themselves to chats
DROP POLICY IF EXISTS "Authenticated users can add members" ON chat_members;
CREATE POLICY "Authenticated users can add members" ON chat_members
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
```

---

### 4. **Messages Table** (`public.messages`)

**Enable RLS:**
- Go to Supabase Dashboard → Tables → `messages`
- Click "Enable RLS"

**Policies needed:**

```sql
-- Allow users to view messages in chats they're in
DROP POLICY IF EXISTS "Users can view messages in their chats" ON messages;
CREATE POLICY "Users can view messages in their chats" ON messages
  FOR SELECT
  USING (
    chat_id IN (
      SELECT chat_id FROM public.chat_members
      WHERE user_id = auth.uid()
    )
  );

-- Allow users to send messages to chats they're in
DROP POLICY IF EXISTS "Users can send messages" ON messages;
CREATE POLICY "Users can send messages" ON messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    chat_id IN (
      SELECT chat_id FROM public.chat_members
      WHERE user_id = auth.uid()
    )
  );

-- Allow message authors to edit their messages
DROP POLICY IF EXISTS "Message authors can edit messages" ON messages;
CREATE POLICY "Message authors can edit messages" ON messages
  FOR UPDATE
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- Allow message authors to delete their messages
DROP POLICY IF EXISTS "Message authors can delete messages" ON messages;
CREATE POLICY "Message authors can delete messages" ON messages
  FOR DELETE
  USING (sender_id = auth.uid());
```

---

### 5. **Groups Table** (`public.groups`)

**Enable RLS:**
- Go to Supabase Dashboard → Tables → `groups`
- Click "Enable RLS"

**Policies needed:**

```sql
-- Allow users to view groups they're members of
DROP POLICY IF EXISTS "Users can view their groups" ON groups;
CREATE POLICY "Users can view their groups" ON groups
  FOR SELECT
  USING (
    chat_id IN (
      SELECT chat_id FROM public.chat_members
      WHERE user_id = auth.uid()
    )
  );

-- Allow authenticated users to create groups
DROP POLICY IF EXISTS "Authenticated users can create groups" ON groups;
CREATE POLICY "Authenticated users can create groups" ON groups
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Allow group owners/admins to update groups
DROP POLICY IF EXISTS "Group owners can update groups" ON groups;
CREATE POLICY "Group owners can update groups" ON groups
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
```

---

### 6. **Channels Table** (`public.channels`)

**Enable RLS:**
- Go to Supabase Dashboard → Tables → `channels`
- Click "Enable RLS"

**Policies needed:**

```sql
-- Allow authenticated users to view channels
DROP POLICY IF EXISTS "Authenticated users can view channels" ON channels;
CREATE POLICY "Authenticated users can view channels" ON channels
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow authenticated users to create channels
DROP POLICY IF EXISTS "Authenticated users can create channels" ON channels;
CREATE POLICY "Authenticated users can create channels" ON channels
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Allow channel owners to update channels
DROP POLICY IF EXISTS "Channel owners can update channels" ON channels;
CREATE POLICY "Channel owners can update channels" ON channels
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
```

---

### 7. **Channel Posts Table** (`public.channel_posts`)

**Enable RLS:**
- Go to Supabase Dashboard → Tables → `channel_posts`
- Click "Enable RLS"

**Policies needed:**

```sql
-- Allow authenticated users to view posts
DROP POLICY IF EXISTS "Authenticated users can view posts" ON channel_posts;
CREATE POLICY "Authenticated users can view posts" ON channel_posts
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow authenticated users to create posts (real check in app)
DROP POLICY IF EXISTS "Authenticated users can create posts" ON channel_posts;
CREATE POLICY "Authenticated users can create posts" ON channel_posts
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Allow post authors to update their posts
DROP POLICY IF EXISTS "Post authors can update posts" ON channel_posts;
CREATE POLICY "Post authors can update posts" ON channel_posts
  FOR UPDATE
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- Allow post authors to delete their posts
DROP POLICY IF EXISTS "Post authors can delete posts" ON channel_posts;
CREATE POLICY "Post authors can delete posts" ON channel_posts
  FOR DELETE
  USING (author_id = auth.uid());
```

---

## How to Apply Policies

### Via Supabase Dashboard:

1. Go to **Authentication** → **Policies**
2. Select the table
3. Click **New Policy**
4. Choose the policy type (SELECT, INSERT, UPDATE, DELETE)
5. Paste the SQL from above
6. Save

### Via SQL Editor:

Alternatively, go to **SQL Editor** in Supabase Dashboard and paste the SQL directly.

---

## Troubleshooting

If you get `"new row violates rls policy"` errors:

1. ✅ Make sure RLS is **enabled** on the table
2. ✅ Check the INSERT policy allows the operation
3. ✅ Verify the user is **authenticated** (has a valid JWT)
4. ✅ If using service role, ensure the policy includes `auth.role() = 'service_role'` OR disable RLS for service operations
5. ✅ Check that the policy conditions match your user's ID

---

## Testing

To test your RLS setup:

1. Sign up a new user through the app
2. Try creating a direct message
3. Try creating a group
4. Check the browser console for detailed error messages

If the app still shows errors, the error message will now include which table's RLS policy is causing the issue.

---

## Need Help?

- Supabase RLS Docs: https://supabase.com/docs/guides/auth/row-level-security
- Supabase SQL Examples: https://supabase.com/docs/guides/auth/row-level-security/examples

## Fastest fix for the current error

If you are seeing `new row violates rls policy` when creating a chat, run this SQL in the Supabase SQL Editor first. It enables RLS and creates the minimum policies needed for the app to create direct messages and groups.

```sql
-- Enable RLS on the tables used by the app
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_posts ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Chats
DROP POLICY IF EXISTS "chats_insert_authenticated" ON public.chats;
CREATE POLICY "chats_insert_authenticated" ON public.chats
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "chats_select_members" ON public.chats;
CREATE POLICY "chats_select_members" ON public.chats
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT chat_id FROM public.chat_members WHERE user_id = auth.uid()
    )
  );

-- Chat members
DROP POLICY IF EXISTS "chat_members_insert_authenticated" ON public.chat_members;
CREATE POLICY "chat_members_insert_authenticated" ON public.chat_members
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "chat_members_select_members" ON public.chat_members;
CREATE POLICY "chat_members_select_members" ON public.chat_members
  FOR SELECT TO authenticated
  USING (
    chat_id IN (
      SELECT chat_id FROM public.chat_members WHERE user_id = auth.uid()
    )
  );

-- Messages
DROP POLICY IF EXISTS "messages_insert_authenticated" ON public.messages;
CREATE POLICY "messages_insert_authenticated" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL AND
    chat_id IN (
      SELECT chat_id FROM public.chat_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "messages_select_members" ON public.messages;
CREATE POLICY "messages_select_members" ON public.messages
  FOR SELECT TO authenticated
  USING (
    chat_id IN (
      SELECT chat_id FROM public.chat_members WHERE user_id = auth.uid()
    )
  );

-- Groups
DROP POLICY IF EXISTS "groups_insert_authenticated" ON public.groups;
CREATE POLICY "groups_insert_authenticated" ON public.groups
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "groups_select_members" ON public.groups;
CREATE POLICY "groups_select_members" ON public.groups
  FOR SELECT TO authenticated
  USING (
    chat_id IN (
      SELECT chat_id FROM public.chat_members WHERE user_id = auth.uid()
    )
  );

-- Channels
DROP POLICY IF EXISTS "channels_select_authenticated" ON public.channels;
CREATE POLICY "channels_select_authenticated" ON public.channels
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "channels_insert_authenticated" ON public.channels;
CREATE POLICY "channels_insert_authenticated" ON public.channels
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Channel posts
DROP POLICY IF EXISTS "channel_posts_select_authenticated" ON public.channel_posts;
CREATE POLICY "channel_posts_select_authenticated" ON public.channel_posts
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "channel_posts_insert_authenticated" ON public.channel_posts;
CREATE POLICY "channel_posts_insert_authenticated" ON public.channel_posts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
```

After you run that, sign out and sign back in once, then try creating a chat again.

---
