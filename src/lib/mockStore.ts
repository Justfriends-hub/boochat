// Central in-memory + localStorage-backed mock store.
// All *Api modules read/write here. Swap for Supabase later without changing consumers.
import { publish } from "./eventBus";

export type Role = "user" | "member" | "owner";

export function normalizeRole(role?: string | null): Role {
  const normalized = (role ?? "user").toLowerCase();
  switch (normalized) {
    case "owner":
    case "superadmin":
      return "owner";
    case "member":
    case "admin":
      return "member";
    default:
      return "user";
  }
}

export function canAccessAdminPanel(role?: string | null): boolean {
  return normalizeRole(role) === "owner";
}

export function hasModeratorAccess(role?: string | null): boolean {
  const normalized = normalizeRole(role);
  return normalized === "owner" || normalized === "member";
}

export type User = {
  id: string;
  email: string;
  displayName: string;
  avatar: string;
  role: Role;
  isUpgraded?: boolean;
  banned?: boolean;
  online?: boolean;
  bio?: string;
  forcedLogout?: boolean;
};

export type MessageKind = "text" | "image" | "voice";
export type Message = {
  id: string;
  chatId: string;
  senderId: string;
  kind: MessageKind;
  body: string; // text content, voice URL, or display URL for images
  caption?: string; // optional user-provided caption for media messages
  imagePath?: string; // Supabase Storage path for image messages (private bucket)
  duration?: number; // voice seconds
  createdAt: number;
  editedAt?: number;
  deletedAt?: number;
  replyTo?: string;
  forwardedFrom?: string;
  status: "pending" | "sent" | "delivered" | "read";
  /** Transient — raw media awaiting upload while queued in the outbox.
   * Persisted by IndexedDB (structured clone), never rendered directly. */
  mediaFile?: File;
};


export type Visibility = "public" | "private";

export type Chat = {
  id: string;
  type: "dm" | "group";
  memberIds: string[];
  name?: string; // group only
  avatar?: string; // group only
  createdAt: number;
  lastMessageId?: string;
  muted?: boolean;
  ownerId?: string;
  admins?: string[];
  permissions?: { onlyAdminsPost: boolean; onlyAdminsAdd: boolean };
  visibility?: Visibility;
  joinRequests?: JoinRequest[];
};

export type Status = {
  id: string;
  userId: string;
  kind: "image" | "video";
  media: string;
  caption?: string;
  createdAt: number;
  viewedBy: string[];
  reactions: { userId: string; emoji: string }[];
  storagePath?: string;
  privacyMode?: string; // e.g. 'public' | 'contacts' | 'contacts_except' | 'only'
  privacyList?: string[]; // explicit allow/exclude list of userIds
};

export type Channel = {
  id: string;
  name: string;
  description: string;
  avatar: string;
  wallpaper?: string;
  ownerId: string;
  adminIds: string[];
  memberIds: string[];
  onlyAdminsPost: boolean;
  createdAt: number;
  visibility?: Visibility;
  discussionChatId?: string | null;
  autoTranslateEnabled?: boolean;
  allowDirectMessages?: boolean;
  inviteLink?: string | null;
  communityId?: string | null;
  appearanceColor?: string;
  allowedReactionEmojis?: string[];
  joinRequests?: JoinRequest[];
  /**
   * Admin subscriber-boost add-on, computed at fetch time from the
   * `channel_settings` boost row (see channelsApi.displaySubscriberCount).
   * Organic truth stays in `memberIds`; this is display-only.
   */
  boostedSubscribers?: number;
};
export type ChannelPost = {
  id: string;
  channelId: string;
  authorId: string;
  kind: "text" | "image";
  body: string;
  image?: string;
  likes: string[]; // userIds
  views: string[]; // unique session/user ids
  createdAt: number;
  boostedLikes?: number;
  boostedViews?: number;
  /** Server-side aggregate view counter (channel_posts.view_count). */
  realViewCount?: number;
  pinned?: boolean;
};
export type Comment = {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: number;
};

export type Boost = {
  id: string;
  adminId: string;
  postId: string;
  kind: "likes" | "views";
  amount: number;
  createdAt: number;
};

export type Report = {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  createdAt: number;
  status: "open" | "resolved";
};

export type AuditLog = {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta?: any;
  createdAt: number;
};

export type QuickReply = {
  id: string;
  userId: string;
  shortcut: string;
  title: string;
  body: string;
  position: number;
  createdAt: number;
  updatedAt?: number;
};

export type Draft = { chatId: string; text: string };

export type JoinRequestStatus = "pending" | "approved" | "rejected";
export type JoinRequest = {
  userId: string;
  requestedAt: number;
  status: JoinRequestStatus;
};

export type Store = {
  users: User[];
  chats: Chat[];
  messages: Message[];
  statuses: Status[];
  channels: Channel[];
  channelPosts: ChannelPost[];
  comments: Comment[];
  boosts: Boost[];
  reports: Report[];
  auditLogs: AuditLog[];
  quickReplies: QuickReply[];
  session: { userId: string } | null;
};

const STORAGE_KEY = "chatapp.store.v1"; // legacy key — cleaned up below

const empty: Store = {
  users: [], chats: [], messages: [], statuses: [],
  channels: [], channelPosts: [], comments: [],
  boosts: [], reports: [], auditLogs: [], session: null,
  quickReplies: [],
};

// Persistence is Dexie/IndexedDB ONLY (see lib/offlineStore.ts + lib/db.ts).
// This module is the fast in-memory layer the UI reads synchronously;
// routes/__root.tsx hydrates it from IndexedDB during boot via
// initOfflineStore() + hydrateLists(). Nothing here writes localStorage.
//
// One-time cleanup: drop snapshots written by older versions of this module
// so they can't consume quota forever.
if (typeof window !== "undefined") {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {
    // storage unavailable (private mode etc.) — nothing to clean up
  }
}

let state: Store = empty;

export function getState(): Store { return state; }
function cloneStore(value: Store): Store {
  if (typeof structuredClone === "function") {
    return structuredClone(value) as Store;
  }
  return JSON.parse(JSON.stringify(value));
}

export function setState(mutator: (s: Store) => void) {
  const nextState = cloneStore(state);
  mutator(nextState);
  state = nextState;
}


export function initStore() {
  // Demo auto-seed is permanently disabled: every new / partner user must
  // start with EMPTY chats + channels. The only exceptions are real server
  // memberships (1:1 DM created via getOrCreateDM / partner support flow, or
  // a channel joined via invite link / partner flow) — those arrive through
  // the Supabase-backed APIs below, never through local placeholders.
  // This also purges any legacy demo rows still lingering in memory so admin
  // deletes of "Startup Stories / Tech Weekly / Design Inspiration" stick.
  if (typeof window === "undefined") return;
  setState((s) => {
    purgeDemoSeed(s);
  });
}

// Ensure seed is always available on demand (used as fallback when APIs fail)
export function ensureSeed() {
  // No-op by design — see initStore(). New users must see empty lists, never
  // resurrected placeholders. Kept as a function so existing call sites don't
  // need to change; it only purges stragglers.
  if (typeof window === "undefined") return;
  setState((s) => {
    purgeDemoSeed(s);
  });
}

export function resetStore() {
  state = empty;
}

/**
 * Merge saved lists into the in-memory store — only fills sections that are
 * currently empty, so fresher live data always wins.
 */
export function hydrateLists(lists: {
  users?: User[];
  chats?: Chat[];
  channels?: Channel[];
  channelPosts?: ChannelPost[];
  statuses?: Status[];
}) {
  if (typeof window === "undefined") return;
  // Drop demo placeholders from anything rehydrated out of IndexedDB before
  // it can touch memory — otherwise a stale mirror resurrects deleted
  // channels on every cold start.
  const clean = <T extends { id?: string; channelId?: string }>(items?: T[]): T[] | undefined => {
    if (!items?.length) return items;
    return items.filter((it: any) => {
      const id = String(it?.id ?? "");
      const channelId = String(it?.channelId ?? "");
      return !isDemoChannelId(id) && !isDemoChatId(id) && !isDemoUserId(id) && !isDemoChannelId(channelId);
    });
  };
  const users = clean(lists.users);
  const chats = clean(lists.chats);
  const channels = clean(lists.channels);
  const channelPosts = clean(lists.channelPosts);
  const hasAny =
    (users?.length ?? 0) > 0 ||
    (chats?.length ?? 0) > 0 ||
    (channels?.length ?? 0) > 0 ||
    (channelPosts?.length ?? 0) > 0 ||
    (lists.statuses?.length ?? 0) > 0;
  if (!hasAny) {
    // Still purge memory in case it already holds demo rows.
    setState((s) => {
      purgeDemoSeed(s);
    });
    return;
  }
  setState((s) => {
    if (!s.users.length && users?.length) s.users = users as User[];
    if (!s.chats.length && chats?.length) s.chats = chats as Chat[];
    if (!s.channels.length && channels?.length) s.channels = channels as Channel[];
    if (!s.channelPosts.length && channelPosts?.length) s.channelPosts = channelPosts as ChannelPost[];
    if (!s.statuses.length && lists.statuses?.length) {
      s.statuses = lists.statuses.filter((st) => Date.now() - st.createdAt < 24 * 60 * 60 * 1000);
    }
    purgeDemoSeed(s);
  });
}

// Function declaration (hoisted) so the circular import from ./seed is safe.
export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
// Demo placeholder IDs shipped by the old local seed (seed.ts). These are
// NOT real Supabase rows — they resurrect in the UI + IndexedDB mirror every
// time the store is empty, which is why admin deletes never stuck and every
// new/partner user saw "Startup Stories / Tech Weekly / Design Inspiration"
// plus demo DMs. They are banished on sight (see purgeDemoSeed below).
const DEMO_CHANNEL_IDS = new Set(["channel-1", "channel-2", "channel-3"]);
const DEMO_CHAT_IDS = new Set(["chat-1", "chat-2", "chat-3", "chat-4", "group-1"]);
const DEMO_USER_IDS = new Set([
  "admin-1",
  "user-1",
  "user-2",
  "user-3",
  "user-4",
  "user-5",
  "user-6",
]);

function isDemoChannelId(id: string) {
  return DEMO_CHANNEL_IDS.has(id);
}

function isDemoChatId(id: string) {
  return DEMO_CHAT_IDS.has(id);
}

function isDemoUserId(id: string) {
  return DEMO_USER_IDS.has(id);
}

/**
 * One-time durable purge: strip demo placeholders out of the IndexedDB mirror
 * itself (list:channels / list:chats / list:channelPosts / list:users) and
 * force-save — even when the result is empty. Without the force-save, the
 * stale mirror resurrects "Startup Stories / Tech Weekly / Design
 * Inspiration" on every cold start and admin deletes never stick.
 */
export async function purgeDemoMirror(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { getAppState, setAppState } = await import("./offlineStore");
    const demoChannelIds = ["channel-1", "channel-2", "channel-3"];
    const demoChatIds = ["chat-1", "chat-2", "chat-3", "chat-4", "group-1"];
    const demoUserIds = ["admin-1", "user-1", "user-2", "user-3", "user-4", "user-5", "user-6"];
    const demoNames = ["tech weekly", "design inspiration", "startup stories"];

    const cleanChannels = (items: any[]) =>
      items.filter((c) => {
        const id = String(c?.id ?? "");
        if (demoChannelIds.includes(id)) return false;
        if (demoNames.includes(String(c?.name ?? "").trim().toLowerCase()) && !/^[0-9a-f-]{36}$/i.test(id)) return false;
        return true;
      });
    const cleanChats = (items: any[]) => items.filter((c) => !demoChatIds.includes(String(c?.id ?? "")));
    const cleanPosts = (items: any[]) => items.filter((p) => !demoChannelIds.includes(String(p?.channelId ?? "")));
    const cleanUsers = (items: any[]) => items.filter((u) => !demoUserIds.includes(String(u?.id ?? "")));

    const jobs: Array<{ key: string; clean: (items: any[]) => any[] }> = [
      { key: "list:channels", clean: cleanChannels },
      { key: "list:chats", clean: cleanChats },
      { key: "list:channelPosts", clean: cleanPosts },
      { key: "list:users", clean: cleanUsers },
    ];
    for (const { key, clean } of jobs) {
      try {
        const saved = await getAppState<any[]>(key);
        if (!Array.isArray(saved) || !saved.length) continue;
        const next = clean(saved);
        if (next.length !== saved.length) {
          await setAppState(key, next);
        }
      } catch {}
    }
  } catch {}
}
export function purgeDemoSeed(s: Store): boolean {
  let removed = false;
  const keepChannels = s.channels.filter((c) => !isDemoChannelId(c.id));
  if (keepChannels.length !== s.channels.length) {
    s.channels = keepChannels;
    removed = true;
  }
  const demoChannelIds = DEMO_CHANNEL_IDS;
  const keepPosts = s.channelPosts.filter((p) => !demoChannelIds.has(p.channelId));
  if (keepPosts.length !== s.channelPosts.length) {
    s.channelPosts = keepPosts;
    removed = true;
  }
  const keepChats = s.chats.filter((c) => !isDemoChatId(c.id));
  if (keepChats.length !== s.chats.length) {
    s.chats = keepChats;
    removed = true;
  }
  const demoChatIds = DEMO_CHAT_IDS;
  const keepMessages = s.messages.filter((m) => !demoChatIds.has(m.chatId));
  if (keepMessages.length !== s.messages.length) {
    s.messages = keepMessages;
    removed = true;
  }
  const keepUsers = s.users.filter((u) => !isDemoUserId(u.id));
  if (keepUsers.length !== s.users.length) {
    s.users = keepUsers;
    removed = true;
  }
  return removed;
}
