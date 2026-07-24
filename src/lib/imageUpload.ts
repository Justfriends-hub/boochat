/**
 * imageUpload.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared image pipeline:
 *   File → compress (Canvas API) → upload to Supabase Storage → return path
 *   Path → signed URL (private buckets) or public URL (avatars bucket)
 *
 * Bucket conventions used in this app:
 *   "avatars"       — public bucket, user profile pictures
 *   "channel-media" — private bucket, channel post images & channel avatars
 *   "chat-media"    — private bucket, DM / group chat image messages
 *   "status-media"  — private bucket (existing, managed by statusApi.ts)
 */

import { ensureSupabase } from "@/lib/supabaseClient";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Buckets that serve images via public URLs (no signing). */
const PUBLIC_BUCKETS = new Set(["avatars"]);

/** Default max dimension (px) for general images. */
const DEFAULT_MAX_DIM = 1080;

/** Default JPEG/WebP quality (0–1). */
const DEFAULT_QUALITY = 0.82;

/** Maximum raw file size accepted before compression (bytes). */
const MAX_RAW_BYTES = 25 * 1024 * 1024; // 25 MB

/** Signed URL validity window (seconds). */
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 60 min

/** Cache expiry margin — cache for 50 min to handle clock drift / network lag. */
const SIGNED_URL_CACHE_MS = 50 * 60 * 1000;

// ─── Signed-URL cache (sessionStorage) ────────────────────────────────────────
// Mirrors the same pattern used in statusApi.ts for consistency.

type CacheEntry = { url: string; expiresAt: number };
const CACHE_KEY = "chatapp.imageUrls";

function readCache(): Record<string, CacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CacheEntry>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function getCached(key: string): string | null {
  const cache = readCache();
  const entry = cache[key];
  if (entry && entry.expiresAt > Date.now()) return entry.url;
  if (entry) {
    delete cache[key];
    writeCache(cache);
  }
  return null;
}

function setCached(key: string, url: string) {
  const cache = readCache();
  cache[key] = { url, expiresAt: Date.now() + SIGNED_URL_CACHE_MS };
  writeCache(cache);
}

// ─── Compression ──────────────────────────────────────────────────────────────

/** Returns true if the browser supports encoding to image/webp. */
function supportsWebp(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL("image/webp").startsWith("data:image/webp");
}

/**
 * Compresses an image File using the Canvas API.
 *
 * - Decodes via `createImageBitmap` with `imageOrientation: 'from-image'` so
 *   portrait JPEG from phones renders upright.
 * - Rescales to fit within `maxDim × maxDim` while preserving aspect ratio.
 * - Re-encodes as WebP (if supported) or JPEG — stripping EXIF as a side effect.
 * - Rejects files that aren't images or exceed MAX_RAW_BYTES.
 */
export async function compressImage(
  file: File,
  maxDim: number = DEFAULT_MAX_DIM,
  quality: number = DEFAULT_QUALITY,
): Promise<Blob> {
  // Pre-flight validation
  if (!file.type.startsWith("image/")) {
    throw new Error(`Invalid file type "${file.type}". Only images are accepted.`);
  }
  if (file.size > MAX_RAW_BYTES) {
    throw new Error(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 25 MB.`,
    );
  }

  // Decode with orientation correction
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  // Scale to fit within maxDim × maxDim
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const mimeType = supportsWebp() ? "image/webp" : "image/jpeg";
  const ext = mimeType === "image/webp" ? "webp" : "jpg";

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas compression failed — toBlob returned null."));
      },
      mimeType,
      quality,
    );
  });
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Compresses and uploads an image to a Supabase Storage bucket.
 *
 * @param file        The raw File selected by the user.
 * @param bucket      Supabase Storage bucket name (e.g. "avatars", "chat-media").
 * @param pathPrefix  Folder prefix inside the bucket (e.g. "userId/posts").
 *                    A timestamp-based filename is appended automatically.
 * @param options     Optional overrides for maxDim and quality.
 * @returns           The storage path (e.g. "userId/posts/1720000000000.jpg").
 *                    Save this path to the database; resolve to a URL via getImageUrl().
 */
export async function uploadImage(
  file: File,
  bucket: string,
  pathPrefix: string,
  options?: { maxDim?: number; quality?: number },
): Promise<string> {
  const maxDim = options?.maxDim ?? DEFAULT_MAX_DIM;
  const quality = options?.quality ?? DEFAULT_QUALITY;

  const compressed = await compressImage(file, maxDim, quality);

  // Derive extension from the output blob type
  const ext = compressed.type === "image/webp" ? "webp" : "jpg";
  const filename = `${Date.now()}.${ext}`;
  const prefix = pathPrefix.replace(/\/$/, ""); // strip trailing slash
  const path = `${prefix}/${filename}`;

  const supabase = ensureSupabase();
  const { error } = await supabase.storage.from(bucket).upload(path, compressed, {
    contentType: compressed.type,
    upsert: false,
  });

  if (error) {
    throw new Error(`Storage upload failed (${bucket}/${path}): ${error.message}`);
  }

  return path;
}

export async function uploadFile(
  file: File,
  bucket: string,
  pathPrefix: string,
): Promise<string> {
  const extension = file.name.split(".").pop() || file.type.split("/").pop() || "bin";
  const filename = `${Date.now()}.${extension}`;
  const prefix = pathPrefix.replace(/\/$/, "");
  const path = `${prefix}/${filename}`;

  const supabase = ensureSupabase();
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw new Error(`Storage upload failed (${bucket}/${path}): ${error.message}`);
  }

  return path;
}

// ─── URL Resolution ───────────────────────────────────────────────────────────

/**
 * Returns a usable image URL for a given storage path.
 *
 * - Public buckets (e.g. "avatars"): returns the public URL immediately.
 * - Private buckets: generates a signed URL (60 min) and caches it for 50 min
 *   in sessionStorage to avoid redundant round-trips.
 * - Passthrough: if `path` already starts with "http" it is returned as-is,
 *   so legacy DiceBear avatar URLs continue to work without branching at call sites.
 */
export async function getImageUrl(bucket: string, path: string): Promise<string> {
  if (!path) return path;

  // Pass through existing full URLs (DiceBear, data:, blob:, etc.)
  if (/^(https?:\/\/|data:|blob:)/i.test(path)) return path;

  // Public bucket — no signing needed
  if (PUBLIC_BUCKETS.has(bucket)) {
    const supabase = ensureSupabase();
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  // Private bucket — check cache first
  const cacheKey = `${bucket}::${path}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Generate signed URL
  const supabase = ensureSupabase();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.warn(`Failed to sign URL for ${bucket}/${path}:`, error?.message);
    return path; // fall back to raw path rather than throwing
  }

  setCached(cacheKey, data.signedUrl);
  return data.signedUrl;
}

/**
 * Batch-resolves an array of storage paths to signed URLs using Supabase batch API.
 * Significantly more efficient than calling createSignedUrl per file.
 */
export async function batchGetImageUrls(
  bucket: string,
  paths: (string | undefined | null)[],
): Promise<(string | undefined)[]> {
  // Filter out nulls/undefined, track original indices
  const validPaths: Array<{ idx: number; path: string }> = [];
  const result: (string | undefined)[] = new Array(paths.length);

  paths.forEach((p, idx) => {
    if (p) {
      validPaths.push({ idx, path: p });
      result[idx] = undefined;
    }
  });

  if (!validPaths.length) return result;

  try {
    const supabase = ensureSupabase();
    
    // Use Supabase batch API for all signed URLs in one request
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(validPaths.map((vp) => vp.path), SIGNED_URL_TTL_SECONDS);

    if (!error && data) {
      // Map results back to original indices
      data.forEach((item, idx) => {
        const originalIdx = validPaths[idx].idx;
        const path = validPaths[idx].path;
        
        if (item.error) {
          result[originalIdx] = path; // Fallback to raw path on error
        } else {
          const cacheKey = `${bucket}::${path}`;
          setCached(cacheKey, item.signedUrl ?? path);
          result[originalIdx] = item.signedUrl ?? path;
        }
      });
    } else {
      // If batch fails, fall back to individual requests
      const fallback = await Promise.all(
        validPaths.map(async (vp) => {
          try {
            return await getImageUrl(bucket, vp.path);
          } catch {
            return vp.path;
          }
        }),
      );
      
      validPaths.forEach((vp, idx) => {
        result[vp.idx] = fallback[idx];
      });
    }
  } catch {
    // Fallback: return raw paths
    validPaths.forEach((vp) => {
      result[vp.idx] = vp.path;
    });
  }

  return result;
}

/**
 * Deletes a file from Supabase Storage.
 * Silently no-ops if `path` is empty or a full URL (not a storage path).
 */
export async function deleteStorageFile(bucket: string, path: string): Promise<void> {
  if (!path || /^(https?:\/\/|data:|blob:)/i.test(path)) return;
  try {
    const supabase = ensureSupabase();
    await supabase.storage.from(bucket).remove([path]);
  } catch (err) {
    console.warn(`Failed to delete storage file ${bucket}/${path}:`, err);
  }
}
