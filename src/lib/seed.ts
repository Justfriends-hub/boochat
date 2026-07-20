import type { Store } from "./mockStore";
import { uid } from "./mockStore";

const AVATARS = [
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Alex",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Sam",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Jordan",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Riley",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Casey",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Morgan",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Taylor",
];

export function seed(s: Store) {
  const now = Date.now();

  const admin = {
    id: "admin-1", email: "admin@demo.app", password: "admin1234",
    displayName: "Admin", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Admin",
    role: "admin" as const, online: true, bio: "Super admin",
  };
  const demoUsers = [
    { name: "Alex Rivera", email: "alex@demo.app" },
    { name: "Sam Chen", email: "sam@demo.app" },
    { name: "Jordan Blake", email: "jordan@demo.app" },
    { name: "Riley Park", email: "riley@demo.app" },
    { name: "Casey Wu", email: "casey@demo.app" },
    { name: "Morgan Lee", email: "morgan@demo.app" },
  ].map((u, i) => ({
    id: `user-${i + 1}`,
    email: u.email,
    password: "demo1234",
    displayName: u.name,
    avatar: AVATARS[i],
    role: "user" as const,
    online: i % 2 === 0,
    bio: "Hey there! I'm using this app.",
  }));

  s.users = [admin, ...demoUsers];

  // DM chats between admin and first 4 users
  demoUsers.slice(0, 4).forEach((u, i) => {
    const chatId = `chat-${i + 1}`;
    s.chats.push({
      id: chatId,
      type: "dm",
      memberIds: [admin.id, u.id],
      createdAt: now - (i + 1) * 3600_000,
    });
    const greetings = [
      "Hey! How's the new project going?",
      "Thanks for the update yesterday 🙌",
      "Are we still on for tomorrow?",
      "Just sent you the files.",
    ];
    const m1: any = {
      id: uid(), chatId, senderId: u.id, kind: "text",
      body: greetings[i], createdAt: now - (i + 1) * 3500_000, status: "read",
    };
    const m2: any = {
      id: uid(), chatId, senderId: admin.id, kind: "text",
      body: "Sounds good — let's do it.", createdAt: now - (i + 1) * 3400_000, status: "read",
    };
    s.messages.push(m1, m2);
    s.chats.find((c) => c.id === chatId)!.lastMessageId = m2.id;
  });

  // Group
  const groupId = "group-1";
  s.chats.push({
    id: groupId, type: "group",
    name: "Design Team",
    avatar: "https://api.dicebear.com/7.x/shapes/svg?seed=DesignTeam",
    memberIds: [admin.id, ...demoUsers.slice(0, 4).map((u) => u.id)],
    ownerId: admin.id,
    admins: [admin.id],
    permissions: { onlyAdminsPost: false, onlyAdminsAdd: false },
    createdAt: now - 86400_000,
  });
  const gm: any = {
    id: uid(), chatId: groupId, senderId: demoUsers[0].id, kind: "text",
    body: "Kickoff at 3pm today ✨", createdAt: now - 7200_000, status: "read",
  };
  s.messages.push(gm);
  s.chats.find((c) => c.id === groupId)!.lastMessageId = gm.id;

  // Channels
  const channels = [
    { name: "Tech Weekly", desc: "Curated tech news every week." },
    { name: "Design Inspiration", desc: "Beautiful UI/UX from around the web." },
    { name: "Startup Stories", desc: "Founder journeys and lessons learned." },
  ];
  channels.forEach((c, i) => {
    const id = `channel-${i + 1}`;
    s.channels.push({
      id, name: c.name, description: c.desc,
      avatar: `https://api.dicebear.com/7.x/shapes/svg?seed=${c.name}`,
      ownerId: admin.id,
      memberIds: s.users.map((u) => u.id),
      createdAt: now - (i + 1) * 86400_000,
    });
    for (let p = 0; p < 3; p++) {
      const postId = uid();
      s.channelPosts.push({
        id: postId, channelId: id, authorId: admin.id,
        kind: "text",
        body: `${c.name} — post ${p + 1}: sharing something interesting today. Read on for details and let us know your thoughts in the comments.`,
        likes: demoUsers.slice(0, p + 1).map((u) => u.id),
        views: demoUsers.map((u) => u.id),
        createdAt: now - (p + 1) * 3600_000 - i * 86400_000,
      });
    }
  });

  // Statuses
  demoUsers.slice(0, 3).forEach((u, i) => {
    s.statuses.push({
      id: uid(), userId: u.id, kind: "image",
      media: `https://picsum.photos/seed/${u.id}/720/1280`,
      caption: "Enjoying the day ☀️",
      createdAt: now - (i + 1) * 2 * 3600_000,
      viewedBy: [], reactions: [],
    });
  });

  // Audit log seed
  s.auditLogs.push({
    id: uid(), adminId: admin.id, action: "seed",
    targetType: "system", targetId: "init",
    createdAt: now, meta: { note: "Initial seed" },
  });
}
