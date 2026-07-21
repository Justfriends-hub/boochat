import { supabase } from "@/lib/supabaseClient";
import { publish } from "@/lib/eventBus";
import type { User } from "@/lib/mockStore";

function mapProfile(profile: any): User {
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name || profile.email.split("@")[0],
    avatar: profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.email)}`,
    role: "user",
    online: profile.online ?? false,
    banned: profile.banned ?? false,
    bio: profile.bio ?? undefined,
  };
}

export async function listUsers(): Promise<User[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name,avatar_url,bio,online,banned")
    .order("display_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapProfile);
}

export async function getUser(id: string): Promise<User | undefined> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name,avatar_url,bio,online,banned")
    .eq("id", id)
    .single();

  if (error || !data) {
    return undefined;
  }
  return mapProfile(data);
}

export async function updateUser(id: string, patch: Partial<User>) {
  const update: Record<string, any> = {};
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.avatar !== undefined) update.avatar_url = patch.avatar;
  if (patch.bio !== undefined) update.bio = patch.bio;
  if (patch.online !== undefined) update.online = patch.online;
  if (patch.banned !== undefined) update.banned = patch.banned;

  const { error } = await supabase.from("profiles").update(update).eq("id", id);
  if (error) throw new Error(error.message);
  publish("users:changed");
}
