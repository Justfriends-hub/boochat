import { useEffect, useSyncExternalStore } from "react";
import { getAuthReady, getCurrentUser, initializeAuth, subscribeAuth } from "@/api/authApi";
import type { User } from "@/lib/mockStore";

export function useAuth(): User | null {
  useEffect(() => {
    initializeAuth();
  }, []);

  return useSyncExternalStore(
    subscribeAuth,
    () => getCurrentUser(),
    () => null,
  );
}

export function useAuthReady(): boolean {
  useEffect(() => {
    initializeAuth();
  }, []);

  return useSyncExternalStore(
    subscribeAuth,
    () => getAuthReady(),
    () => false,
  );
}
