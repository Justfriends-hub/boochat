# New Update — Video Changes Plan (IMG_9894.MP4)

> Source: `C:\Users\ADMIN\Downloads\Telegram Desktop\IMG_9894.MP4` (23:30, iPhone screen recording, BooChat app, tester as FlashGain Support / MoneyMate News owner).
> Status: **PLAN ONLY — no code changed yet.** Work through sections in order. Check off each acceptance test before moving on.
>
> If you want this file itself git-ignored, add one line `newupdate.md` to `.gitignore`. I did NOT modify `.gitignore` — say the word and I will.

## 0. How to use this file (repeat for every change)

1. Inspect the listed files, reproduce the bug on a local build.
2. Add/adjust DB migration under `db/migrations/` or `migrations/` only if listed. Apply to local Supabase, never hand-edit prod.
3. Implement UI + API change, keeping existing `Role`/admin gating untouched.
4. Run `npm run build` (or `bun run build`) + manual tap-through on mobile width (576px column).
5. Commit only when acceptance test passes. Keep Lovable history linear (no force-push / rebase of pushed commits).

## 1. What the video shows (audio + frame match)

| Time | Audio (cleaned) | Frame seen |
|------|-----------------|------------|
| 0:00 | Back button long-standing complaint | Settings > Statistics: stacked `Back to channel` + `Back` |
| 0:30 | Purple header wrong (Settings gear, info, Subscribed) | Channel header bar |
| 1:00–1:30 | Boost insights: Total Likes 2, Total Views 0, Boosted 0/0 | Channel Details drawer |
| 2:00 | "Everybody is forcefully subscribed — remove that button" | `Subscribed` pill circled blue |
| 3:00 | Tap avatar/name does nothing | Channel feed |
| 3:30–4:00 | Auto-translate / Direct messages do nothing | Core settings toggles |
| 4:30–6:30 | Auto-boost spec: followers daily (24h), views/likes per-post (~5h), popup amount entry | Boost panel |
| 6:30–8:00 | Remove Discussion + Reactions, keep Channel type + Appearance, add Auto-boost (5 rows total) | Settings list |
| 8:00–9:30 | Rename Views→Subscribers; split Total vs Organic vs Boosted | Statistics cards |
| 10:00–11:00 | Tap pfp/name should open media/links/files | Channel info (currently dead) |
| 12:00 | Support first-run asks full name + email | Support app |
| 15:00–16:30 | Post `...` needs Delete/Forward; show original vs boosted separately (e.g. 36 + 10, not just 46) | Post cards, counts 36/49 |
| 18:00 | Fix double-back; show channel name, move Settings | Header |
| 18:30 | Verification tick, not 🥇/🇳🇬 emoji | `MoneyMate News` name |
| 19:00–20:30 | Unverified → Contact Support → support chat with payment details | Verification flow |
| 21:00 | Double-message bug (12:08×2, 00:24×2, 21:59×2) | `Just friends` DM |
| 21:30 | New posts land at top, should land at bottom | Feed order |
| 22:30 | Only ~15 comments visible; per-post counts (30/20/16/17) must differ | Comments sheet |
| 23:00 | Add Auto-boost for Comments | Boost panel |

## 2. Changes + exact steps

### A. Header / navigation
**A1. Single back button.** Files: `src/routes/_app.channels.$channelId.settings.tsx`, `*.settings.statistics.tsx`, `*.settings.*.tsx`. Steps: (1) find both `Back to channel` and inner `Back` links, (2) keep one context-aware back, (3) tap through Settings → Statistics → back. Accept: exactly one back at every depth.
**A2. Header rework.** Files: `src/routes/_app.channels.$channelId.tsx`. Steps: (1) show avatar + channel name, (2) hide `Subscribed` pill when viewer is owner/member (everyone is force-subscribed), (3) move Settings gear out of top bar into overflow/menu. Accept: owner sees name, no dead Subscribed button.
**A3. Tappable identity.** Files: same route + channel info component. Steps: (1) wire avatar/name onClick → open info drawer, (2) drawer lists media/links/files from channel posts query. Accept: tap opens drawer with real post attachments.

### B. Settings list reorg
Files: `_app.channels.$channelId.settings.tsx`, `channel-type.tsx`, `discussion.tsx`, `appearance.tsx`, plus new `auto-boost` section. Steps: (1) delete `Discussion` and `Reactions` rows, (2) order: Channel type → Auto-boost (Followers/Views/Likes/Comments) → Appearance → (others), (3) remove dead toggles or wire them: `Auto-translate messages`, `Direct messages`. Accept: 5 rows, no dead switches; Appearance persists or is labelled future-only.

### C. Auto-boost system
Files: `src/components/BoostDialog.tsx`, `src/components/admin/BoostControlPanel.tsx` (if present), `src/api/channelsApi.ts`, new migration for `channel_settings` / `post_boosts` (columns: kind, target, mode, start/end, per-post vs daily). Steps: (1) three buttons Followers/Views/Likes + new Comments, (2) each opens amount popup, (3) followers = daily drip every 24h, views/likes/comments = per-post ~5h delivery, (4) persist + show scheduled amount. Accept: set 100 followers → +100/day; set 100 views → each new post targets 100 views.

### D. Stats / metrics split
Files: `*.settings.statistics.tsx`, Channel Details drawer, `mycurrentschema.sql` counters. Steps: (1) rename `Views` card → `Subscribers` where requested, (2) every metric shows `Total / Organic / Boosted` (e.g. Total 100 = 50 organic + 50 boosted), (3) compute boosted from `post_boosts` + `channel_settings`, never merge into one number. Accept: 36 + 10 boost displays as `36 (10 boosted)`, not just 46.

### E. Posts: actions + counts
Files: channel feed component, `src/api/channelsApi.ts`. Steps: (1) add `...` menu per post: Delete (owner), Forward/share, (2) delete removes row + attachments with confirm, (3) like/view eye counts use split display from D. Accept: owner can delete a mistaken post; counts show boosted portion.

### F. Verification badge (not emoji)
Files: channel identity form (`Channel name` input, `Save identity`), avatar/title renderers. Steps: (1) stop appending 🥇/🇳🇬 to name, (2) add boolean `is_verified` display: real tick component next to name, (3) migrate existing names stripping badge-emoji. Accept: `MoneyMate News ✓`, no emoji in name field.

### G. Verification → support flow
Files: verification banner, support chat route, `_app.chats.$chatId.tsx`. Steps: (1) unverified channel shows "Not verified — Contact support", (2) click opens support chat (pinned MoneyMate News context intact), (3) support thread shows payment details + full history; first-run support signup asks full name + email. Accept: tap-through from banner lands in support thread with details visible.

### H. DM double-message bug
Files: `src/routes/_app.chats.$chatId.tsx`, `src/components/ChatView.tsx`, `MessageBubble.tsx`, `src/api/chatsApi.ts` / messages outbox. Steps: (1) repro: send `Xup`/emoji, observe duplicate (clock + check), (2) dedupe by client temp-id + server id, fix optimistic insert vs realtime echo, (3) add unique constraint or `get_or_create` guard. Accept: one bubble per send, single 12:08 / 00:24 / 21:59 row.

### I. Feed ordering
Files: channel posts query (`order by created_at`). Steps: (1) confirm expected: newest at bottom (chat-style) per tester at 21:30, (2) fix insert/scroll to bottom on new post, keep pinned post pinned. Accept: new post appears at bottom, old `Hi 30/07/2026` stays up.

### J. Comments
Files: Comments & Discussion sheet, `dev.comments.tsx`, comments API. Steps: (1) paginate/full list (remove 15-item cap), (2) per-post counts accurate (30 vs 20 vs 16 vs 17), (3) add Auto-boost for Comments (see C). Accept: 30-comment post scrolls all 30.

## 3. Suggested build order
1. Phase 1 (bugs): A1, H, I, J-counts.
2. Phase 2 (settings/boost/stats): B, C, D.
3. Phase 3 (posts/identity/flow): E, F, G, A2–A3.

## 4. Test checklist (run at end)
- [ ] One back button everywhere; header shows name, no dead Subscribed.
- [ ] Avatar/name tap opens media/links/files.
- [ ] Settings = Channel type → Auto-boost → Appearance; no dead toggles.
- [ ] Auto-boost followers/views/likes/comments with popup amounts works.
- [ ] Stats show Total/Organic/Boosted; post counts show split.
- [ ] Post `...` deletes/forwards; verification is a tick, not emoji.
- [ ] Unverified → support chat with payment details works.
- [ ] No double DMs; new channel posts land at bottom; all comments load.
- [ ] `npm run build` passes.
