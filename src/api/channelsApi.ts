import { getState, setState, uid, type Channel, type ChannelPost, type Comment } from "@/lib/mockStore";
import { publish, subscribe } from "@/lib/eventBus";

export async function listChannels(): Promise<Channel[]> {
  return [...getState().channels].sort((a, b) => b.createdAt - a.createdAt);
}
export async function getChannel(id: string) {
  return getState().channels.find((c) => c.id === id);
}
export async function createChannel(input: { name: string; description: string; ownerId: string }) {
  const ch: Channel = {
    id: uid(), name: input.name, description: input.description,
    avatar: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(input.name)}`,
    ownerId: input.ownerId, memberIds: [input.ownerId], createdAt: Date.now(),
  };
  setState((s) => { s.channels.push(ch); });
  publish("channels:changed");
  return ch;
}

export async function listPosts(channelId?: string): Promise<ChannelPost[]> {
  const posts = channelId
    ? getState().channelPosts.filter((p) => p.channelId === channelId)
    : [...getState().channelPosts];
  return posts.sort((a, b) => b.createdAt - a.createdAt);
}
export async function getPost(id: string) {
  return getState().channelPosts.find((p) => p.id === id);
}
export async function createPost(input: {
  channelId: string; authorId: string; kind: "text" | "image"; body: string; image?: string;
}) {
  const p: ChannelPost = {
    id: uid(), channelId: input.channelId, authorId: input.authorId,
    kind: input.kind, body: input.body, image: input.image,
    likes: [], views: [], createdAt: Date.now(),
  };
  setState((s) => { s.channelPosts.push(p); });
  publish("channels:changed");
  publish(`channel:${input.channelId}`);
  return p;
}

export async function togglePostLike(postId: string, userId: string) {
  setState((s) => {
    const p = s.channelPosts.find((x) => x.id === postId);
    if (!p) return;
    if (p.likes.includes(userId)) p.likes = p.likes.filter((u) => u !== userId);
    else p.likes.push(userId);
  });
  publish("channels:changed");
  const p = getState().channelPosts.find((x) => x.id === postId);
  if (p) publish(`channel:${p.channelId}`);
}

export async function markPostViewed(postId: string, sessionId: string) {
  setState((s) => {
    const p = s.channelPosts.find((x) => x.id === postId);
    if (p && !p.views.includes(sessionId)) p.views.push(sessionId);
  });
  publish("channels:changed");
}

export async function deletePost(postId: string) {
  setState((s) => { s.channelPosts = s.channelPosts.filter((p) => p.id !== postId); });
  publish("channels:changed");
}
export async function editPost(postId: string, body: string) {
  setState((s) => {
    const p = s.channelPosts.find((x) => x.id === postId);
    if (p) p.body = body;
  });
  publish("channels:changed");
}

export async function listComments(postId: string): Promise<Comment[]> {
  return getState().comments.filter((c) => c.postId === postId).sort((a, b) => a.createdAt - b.createdAt);
}
export async function addComment(input: { postId: string; authorId: string; body: string }) {
  const c: Comment = { id: uid(), ...input, createdAt: Date.now() };
  setState((s) => { s.comments.push(c); });
  publish(`comments:${input.postId}`);
  return c;
}

export function subscribeToChannels(cb: () => void) { return subscribe("channels:changed", cb); }
export function subscribeToComments(postId: string, cb: () => void) {
  return subscribe(`comments:${postId}`, cb);
}

export function likeCount(p: ChannelPost) {
  return p.likes.length + (p.boostedLikes || 0);
}
export function viewCount(p: ChannelPost) {
  return p.views.length + (p.boostedViews || 0);
}
