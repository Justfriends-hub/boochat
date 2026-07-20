import { getState, setState, type User } from "@/lib/mockStore";
import { publish } from "@/lib/eventBus";

export async function listUsers(): Promise<User[]> {
  return [...getState().users];
}
export async function getUser(id: string): Promise<User | undefined> {
  return getState().users.find((u) => u.id === id);
}
export async function updateUser(id: string, patch: Partial<User>) {
  setState((s) => {
    const u = s.users.find((x) => x.id === id);
    if (u) Object.assign(u, patch);
  });
  publish("users:changed");
}
