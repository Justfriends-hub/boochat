/**
 * Deterministic avatar fallback URLs.
 *
 * The seed is sent to a third-party service (api.dicebear.com), so it must
 * never contain PII — historically full user emails were embedded in these
 * URLs. We hash the identifier instead: avatars stay stable per user/channel
 * across sessions, but the outgoing URL reveals nothing about identity.
 */

/** Small deterministic string hash → base36 (stable across sessions). */
function stableSeed(input: string | undefined | null): string {
  const s = input || "user";
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h + s.charCodeAt(i)) | 0) >>> 0;
  }
  return h.toString(36);
}

/** Fallback avatar for a person. Prefers the non-PII user id. */
export function userAvatarFallback(idOrEmail: string | undefined | null): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=u${stableSeed(idOrEmail)}`;
}

/** Fallback avatar for a channel/group. */
export function channelAvatarFallback(nameOrId: string | undefined | null): string {
  return `https://api.dicebear.com/7.x/shapes/svg?seed=c${stableSeed(nameOrId)}`;
}
