/**
 * Post-build step: inject the full hashed-asset manifest into the deployed
 * service worker so `install` can precache every route chunk for offline use.
 *
 * Runs automatically as part of `npm run build` (see package.json).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, ".output", "public");
const assetsDir = path.join(publicDir, "assets");
const swPath = path.join(publicDir, "sw.js");

if (!fs.existsSync(swPath)) {
  console.warn("[build-sw] .output/public/sw.js not found — skipping");
  process.exit(0);
}

const assets = fs
  .readdirSync(assetsDir)
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => `/assets/${f}`);

let sw = fs.readFileSync(swPath, "utf8");
if (sw.includes("__PRECACHE_MANIFEST__")) {
  sw = sw.replace(
    '["__PRECACHE_MANIFEST__"]',
    JSON.stringify(assets),
  );
  fs.writeFileSync(swPath, sw);
  console.log(`[build-sw] injected ${assets.length} assets into sw.js precache manifest`);
} else {
  console.log("[build-sw] precache placeholder already replaced — skipping");
}
