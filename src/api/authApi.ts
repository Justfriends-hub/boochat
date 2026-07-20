import { getState, setState, uid, type User } from "@/lib/mockStore";
import { publish } from "@/lib/eventBus";

export async function signIn(email: string, password: string): Promise<User> {
  const u = getState().users.find((x) => x.email.toLowerCase() === email.toLowerCase());
  if (!u) throw new Error("No account found for that email.");
  if (u.password !== password) throw new Error("Incorrect password.");
  if (u.banned) throw new Error("This account has been suspended.");
  setState((s) => { s.session = { userId: u.id }; });
  publish("auth:changed");
  return u;
}

export async function signUp(input: {
  email: string; password: string; displayName: string;
}): Promise<User> {
  const exists = getState().users.some((u) => u.email.toLowerCase() === input.email.toLowerCase());
  if (exists) throw new Error("An account with that email already exists.");
  const user: User = {
    id: uid(),
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(input.email)}`,
    role: "user",
    online: true,
  };
  setState((s) => {
    s.users.push(user);
    s.session = { userId: user.id };
  });
  publish("auth:changed");
  return user;
}

export async function signOut() {
  setState((s) => { s.session = null; });
  publish("auth:changed");
}

export function getCurrentUser(): User | null {
  const s = getState();
  if (!s.session) return null;
  const u = s.users.find((x) => x.id === s.session!.userId) || null;
  if (u?.banned) return null;
  return u;
}
