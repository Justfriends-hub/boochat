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
-- Allow users to view chat members for chats they're in
DROP POLICY IF EXISTS "Users can view chat members" ON chat_members;
CREATE POLICY "Users can view chat members" ON chat_members
  FOR SELECT
  USING (
    chat_id IN (
      SELECT chat_id FROM public.chat_members
      WHERE user_id = auth.uid()
    )
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
