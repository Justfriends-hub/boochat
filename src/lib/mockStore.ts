// Central in-memory + localStorage-backed mock store.
// All *Api modules read/write here. Swap for Supabase later without changing consumers.
import { publish } from "./eventBus";

export type Role = "user" | "admin" | "superadmin";
export type User = {
  id: string;
  email: string;
  password: string;
  displayName: string;
  avatar: string;
  role: Role;
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
  body: string; // text, image url, or voice url
  duration?: number; // voice seconds
  createdAt: number;
  editedAt?: number;
  deletedAt?: number;
  replyTo?: string;
  forwardedFrom?: string;
  status: "pending" | "sent" | "delivered" | "read";
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
  ownerId: string;
  adminIds: string[];
  memberIds: string[];
  onlyAdminsPost: boolean;
  createdAt: number;
  visibility?: Visibility;
  joinRequests?: JoinRequest[];
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
  session: { userId: string } | null;
};

const STORAGE_KEY = "chatapp.store.v1";

const empty: Store = {
  users: [], chats: [], messages: [], statuses: [],
  channels: [], channelPosts: [], comments: [],
  boosts: [], reports: [], auditLogs: [], session: null,
};

// Initialize state from localStorage immediately so the UI can render a cached
// snapshot synchronously on first paint while the app bootstraps.
let state: Store = (typeof window !== "undefined") ? load() : empty;

function load(): Store {
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...empty, ...JSON.parse(raw) };
  } catch {}
  return empty;
}
let saveTimer: any;
function save() {
  if (typeof window === "undefined") return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, 50);
}

export function getState(): Store { return state; }
export function setState(mutator: (s: Store) => void) {
  mutator(state);
  save();
}

export function initStore() {
  if (typeof window === "undefined") return;
  // Seed if empty
  if (state.users.length === 0) {
    import("./seed").then(({ seed }) => {
      seed(state);
      save();
      publish("store:seeded");
    });
  }
}

export function resetStore() {
  state = empty;
  save();
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
