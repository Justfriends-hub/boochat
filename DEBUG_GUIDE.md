# 🔍 Channel Posts Debug Guide

## What Was Added

I've added comprehensive debug logging to trace exactly where posts are disappearing. Here's what to look for:

### 1. **Visual Debug Panel (On-Screen)**
- Navigate to any channel
- You'll see a **red debug panel** at the top of the post list
- Shows:
  - `📍 Channel ID` - The current channel you're viewing
  - `📊 Posts in state` - How many posts are loaded
  - `⏳ Loading` - Whether data is still loading
  - `📈 Status` - Query status (success/pending/error)
  - `❌ Error` - Any errors that occurred
  - `Raw Posts Data` - Full JSON dump of posts

### 2. **Console Logs (Browser DevTools)**

Open **DevTools Console** (F12 → Console tab) and look for these patterns:

#### When fetching posts:
```
🔍 [listPosts] ENTRY - fetching posts for channel: channel-1
✅ [listPosts] Seed ensured. Current mock state: {...}
🌐 [listPosts] Supabase client ready, constructing query for channel: channel-1
⏳ [listPosts] Executing Supabase query...
📦 [listPosts] Supabase response: {postsCount: 0, hasError: true, error: {...}}
```

#### Successful Supabase fetch:
```
✨ [listPosts] SUCCESS - got posts from Supabase: 3 [...]
🗺️  [listPosts] Mapped posts: 3
🎯 [listPosts] RETURNING SUPABASE POSTS: 3
```

#### Fallback to seeded/cached data:
```
❌ [listPosts] Supabase error - falling back to mock store: {...}
🔎 [listPosts] Mock store search - total posts available: 9
📋 [listPosts] All posts in store: (9) [{id, channelId}, ...]
🔽 [listPosts] Filtered posts for channel channel-1: 3 [...]
⚠️  [FALLBACK] Returning 3 cached/seeded posts for channel all
```

#### Channel debug state:
```
🔍 [ChannelPage] DEBUG STATE
Channel ID: channel-1
Channel data: {...}
Posts count: 3
Posts data: [...]
Posts loading: false
Posts status: success
Posts error: null
Query cache (posts): (3) [...]
```

## What to Check

### Scenario 1: Posts showing ✅
- `Posts count: 3` on debug panel
- Look for one of these in console:
  - `✨ [listPosts] SUCCESS` (from Supabase)
  - `⚠️  [FALLBACK]` (from seeded data)

### Scenario 2: Posts NOT showing ❌
**Check these in order:**

1. **Is Channel ID correct?**
   - Debug panel shows: `📍 Channel ID: channel-1`?
   - Console shows: `channel: {name: "Tech Weekly"}`?
   - If no, something is wrong with channel routing

2. **Are posts in the mock store?**
   - Look for: `🔎 [listPosts] Mock store search - total posts available: 9`
   - If shows `0`, seed data was never initialized

3. **Is filtering by channel ID working?**
   - Look for: `🔽 [listPosts] Filtered posts for channel channel-1: 3`
   - If shows `0`, but total is `9`, there's an ID mismatch

4. **What's the Supabase error?**
   - Look for: `📦 [listPosts] Supabase response: {error: {...}}`
   - Shows exact error from Supabase (network, auth, schema, etc.)

## Common Issues & Fixes

### Issue: "Posts in state: 0" but "total posts available: 9"
**Problem:** Channel ID mismatch
**Fix:** Check both values match:
- `Channel ID: channel-1`
- `channelId` in the filter query: `channel-1`

### Issue: "total posts available: 0"
**Problem:** Seed data not initialized
**Fix:** The `ensureSeed()` function failed silently
**Solution:** Page refresh should trigger seeding

### Issue: Posts load then disappear
**Problem:** Query invalidation or component re-render issue
**Look for:** Multiple `🔄 [ChannelPage] Invalidating queries` logs
**Check:** Are you navigating between channels? If yes, posts are being re-fetched.

## Next Steps

1. **Navigate to a channel with the test data**
2. **Open DevTools (F12)**
3. **Look at the red debug panel**
4. **Scroll through console logs matching patterns above**
5. **Share the console output starting with the FIRST 🔍 [listPosts] ENTRY**

This will tell us exactly where posts stop flowing through the pipeline.
