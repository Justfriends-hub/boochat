import { useEffect, useState, useSyncExternalStore } from "react";
import { getCurrentUser } from "@/api/authApi";
import { subscribe } from "@/lib/eventBus";
import type { User } from "@/lib/mockStore";

function subscribeAuth(cb: () => void) {
  const u1 = subscribe("auth:changed", cb);
  const u2 = subscribe("users:changed", cb);
  const u3 = subscribe("store:seeded", cb);
  return () => { u1(); u2(); u3(); };
}

export function useAuth(): User | null {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const user = useSyncExternalStore(
    subscribeAuth,
    () => getCurrentUser(),
    () => null,
  );
  return hydrated ? user : null;
}
