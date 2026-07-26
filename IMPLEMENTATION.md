Feature: Upgraded / Premium users + Quick Replies

Overview
-- Add per-user "upgraded" flag to profiles and a new `quick_replies` table.
-- RLS enforces that quick replies are only accessible to their owner.
-- Max 50 quick replies per user is enforced in the API layer (not hard-coded in SQL).

Files added/changed
- db/migrations/20260726_add_quick_replies_and_upgraded.sql: adds `is_upgraded`, `upgraded_at`, `upgraded_by` to `profiles`, creates `quick_replies`, RLS policies.
- src/lib/mockStore.ts: add `QuickReply` type and sample mock data shape.
- src/api/quickRepliesApi.ts: new API layer for CRUD/reorder/search; enforces 50-item limit and upgrade gating.
- src/api/adminApi.ts: add `setUserUpgraded` and `listUpgradedUsers` with audit() calls.
- src/components/QuickReplyPicker.tsx: popover picker using existing command UI primitives and `searchQuickReplies`.
- src/components/Composer.tsx: integrate picker when typing "/" at start of line for upgraded users.
- src/routes/_app.settings.tsx: Quick Replies management UI (gated by FeatureBoundary).
- src/routes/_app.admin.tsx: add upgraded toggle/badge in admin user table (owner-only).

Notes / Decisions
- Do NOT change existing `Role` type or admin gating logic; `is_upgraded` is independent and does not grant admin access.
- RLS policy naming follows existing conventions in RLS_SETUP.md.
- The per-user 50-item limit is enforced in the API layer and client; SQL has a comment noting this.
- Use shared helper `isUpgraded(user)` in code to make future feature checks easier (add when wiring components).

Next steps performed by this branch
1. Migration file added (apply to Supabase SQL Editor).
2. Add API, components, and UI changes in subsequent commits.
# Admin Panel Implementation — boochat

This document provides the admin UI components and the DB wiring notes required to implement the requested admin panel features: Boost control, Channel overview/analytics, and Comment approval queue.

---

## Provided React components

Below are the three components to drop into `src/components/admin/` (or another admin folder). They assume you have a working `supabase` client at `src/integrations/supabase/client` and the UI primitives used throughout the project.

1) `BoostControlPanel` — live channel boost UI

```tsx
// BoostControlPanel (paste into src/components/admin/BoostControlPanel.tsx)
import React, { useState, useEffect } from 'react';
import { TrendingUp, Zap, Clock, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Calendar } from '@/components/ui/calendar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface ChannelSetting {
  boost_target: number;
  boost_kind: 'subscribers' | 'posts' | 'likes' | 'views';
  boost_mode: 'instant' | 'gradual';
  boost_start_time: string | null;
  boost_end_time: string | null;
}

export function BoostControlPanel() {
  // component code (same as provided by the user) — keep as-is
}
```

2) `ChannelOverview` — channel analytics and visible totals

```tsx
// ChannelOverview (paste into src/components/admin/ChannelOverview.tsx)
import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Megaphone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { supabase } from '@/integrations/supabase/client';

export function ChannelOverview({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  // component code (same as provided by the user) — keep as-is
}
```

3) `CommentApprovalQueue` — approve/reject queued comments

```tsx
// CommentApprovalQueue (paste into src/components/admin/CommentApprovalQueue.tsx)
import React, { useState, useEffect } from 'react';
import { Check, X, Clock, MessageSquare, Eye, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Toggle } from '@/components/ui/toggle';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function CommentApprovalQueue() {
  // component code (same as provided by the user) — keep as-is
}
```

---

## Required DB tables / functions (from your schema)

The provided components rely on the following tables and a helper RPC. Your `mycurrentschema.sql` contains compatible tables; ensure these columns exist and RLS policies permit admin access (or run queries server-side):

- `chats` (id, name, type) — channels are rows where `type = 'channel'` or use `public.channels` depending on your setup.
- `messages` / `channel_posts` (id, content/body, chat_id/channel_id, created_at) — used to list recent posts for boost-by-post.
- `channel_settings` — table to persist channel-level boost settings; expected columns:
  - `chat_id` (uuid, PK/FK)
  - `boost_target` (integer)
  - `boost_kind` (text)
  - `boost_mode` (text)
  - `boost_start_time` (timestamp)
  - `boost_end_time` (timestamp)

- `post_boosts` — create per-post boosts when boosting posts/likes/views:
  - `chat_id`, `message_id`, `boost_kind`, `boost_target`, `boost_mode`, `boost_start_time`, `boost_end_time`, `reaction`

- `chat_members` — counts for real members

- `comments` — (id, content, user_id, message_id, created_at, status) for the approval queue

- RPC `get_visible_boost(chat_id uuid, kind text)` — optional, used in `ChannelOverview` to compute visible boosted totals. If not present you can compute boost totals from `post_boosts` + `channel_settings`.

Notes from your `mycurrentschema.sql`: it already includes `chat_members`, `messages`, `channel_posts`, `admin_boosts`, `audit_logs`, and `reports`. Add `channel_settings` and `post_boosts` if you want per-channel and per-post persisted boosts.

---

## Wiring & integration notes

- Place the three components under `src/components/admin/` and export them from an `index.ts` if desired.
- Add an admin route/view at `src/routes/_app.admin.tsx` that imports these components and displays them in the admin layout. Example layout sections:
  - `BoostControlPanel`
  - `ChannelOverview` (pass `isSuperAdmin={true}` if you want the toggle visible)
  - `CommentApprovalQueue`

- Supabase client: ensure `src/integrations/supabase/client.ts` exports a configured `supabase` instance that can run the queries (service role key or server-side endpoints are recommended for write operations that bypass RLS).

- RPC / aggregate functions: for performance, implement `get_visible_boost(chat_id uuid, kind text)` as a Postgres function to aggregate `channel_settings.boost_target` and `post_boosts` values. Alternatively, query and sum client-side.

- RLS / Policies: admin operations that modify `channel_settings`, `post_boosts`, or `comments` should either be proxied via server endpoints (recommended) or require the service role key. Avoid exposing elevation actions directly in the browser.

- Background processing: if you implement gradual boosts (time-windowed), you may want a server-side worker to materialize incremental boosted counts, or compute estimated visible totals using the function `get_visible_boost`.

---

## Quick checklist

- [ ] Add `src/components/admin/BoostControlPanel.tsx`
- [ ] Add `src/components/admin/ChannelOverview.tsx`
- [ ] Add `src/components/admin/CommentApprovalQueue.tsx`
- [ ] Ensure `channel_settings` and `post_boosts` tables exist
- [ ] Add or verify `get_visible_boost` RPC
- [ ] Wire components into `src/routes/_app.admin.tsx`
- [ ] Verify RLS/policies or proxy writes server-side

---

If you want, I can:
- Create the three component files in `src/components/admin/` now.
- Add a sample route section in `src/routes/_app.admin.tsx` to render them.
- Generate the `channel_settings` / `post_boosts` SQL migration based on your schema.

Tell me which of those next steps you want me to do and I will proceed.