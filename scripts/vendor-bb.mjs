/**
 * Vendor @aztec/bb.js's browser build into public/vendor/bb, repoint its CRS
 * downloads at a same-origin path, and vendor the CRS itself into public/crs.
 *
 * Two problems this solves:
 *  1. bb.js spawns its wasm Web Worker with
 *       new Worker(new URL('./main.worker.js', import.meta.url), { type: 'module' })
 *     so its worker/wasm siblings must sit next to index.js at a stable served
 *     path. We load it as native ESM from /vendor/bb (see src/lib/bb-loader.ts).
 *  2. bb.js fetches its structured reference string (CRS) from
 *     https://crs.aztec.network/*.dat. In the browser those ranged cross-origin
 *     requests fail the CORS preflight (403). We rewrite the CRS origin to a
 *     same-origin /crs path and vendor the files, so the fetch (which happens
 *     inside the proving worker) stays same-origin and just works.
 */
import { cp, mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CRS_ORIGIN = "https://crs.aztec.network";
// Same-origin CRS path, base-aware for a GitHub Pages subpath deploy.
// PUBLIC_BASE mirrors Vite's `base` (e.g. "/confidential-wallet/"); default "/".
const CRS_PATH = `${(process.env.PUBLIC_BASE ?? "/").replace(/\/+$/, "")}/crs`;

function findBrowserDir() {
  const candidates = [];
  const pnpmDir = join(projectRoot, "node_modules", ".pnpm");
  if (existsSync(pnpmDir)) {
    for (const name of readdirSync(pnpmDir)) {
      if (name.startsWith("@aztec+bb.js@")) {
        candidates.push(join(pnpmDir, name, "node_modules", "@aztec", "bb.js", "dest", "browser"));
      }
    }
  }
  candidates.push(join(projectRoot, "node_modules", "@aztec", "bb.js", "dest", "browser"));
  return candidates.find((d) => existsSync(join(d, "index.js")));
}

// 1. copy bb.js browser build
const srcDir = findBrowserDir();
if (!srcDir) throw new Error("could not locate @aztec/bb.js dest/browser — run `pnpm install` first");
const destDir = join(projectRoot, "public", "vendor", "bb");
await mkdir(destDir, { recursive: true });
await cp(srcDir, destDir, { recursive: true });

// 2. repoint the CRS origin at a same-origin path in every vendored JS file
let patched = 0;
for (const f of await readdir(destDir)) {
  if (!f.endsWith(".js")) continue;
  const p = join(destDir, f);
  const before = await readFile(p, "utf8");
  if (before.includes(CRS_ORIGIN)) {
    await writeFile(p, before.split(CRS_ORIGIN).join(CRS_PATH));
    patched++;
  }
}
console.log(`vendored @aztec/bb.js → ${destDir} (${(await readdir(destDir)).length} files, CRS → ${CRS_PATH} in ${patched})`);

// 3. vendor the CRS (prefixes are enough for these small circuits; skip if present)
const crsDir = join(projectRoot, "public", "crs");
await mkdir(crsDir, { recursive: true });
async function grab(name, maxBytes) {
  const out = join(crsDir, name);
  if (existsSync(out) && (await stat(out)).size > 0) return `${name} (cached)`;
  const headers = maxBytes ? { Range: `bytes=0-${maxBytes - 1}` } : {};
  const res = await fetch(`${CRS_ORIGIN}/${name}`, { headers });
  if (!res.ok && res.status !== 206) throw new Error(`CRS ${name} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(out, buf);
  return `${name} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`;
}
const eightMB = 8 * 1024 * 1024;
const g1 = await grab("g1.dat", eightMB);
const gg1 = await grab("grumpkin_g1.dat", eightMB);
const g2 = await grab("g2.dat"); // small; fetch full
console.log(`vendored CRS → ${crsDir}: ${g1}, ${gg1}, ${g2}`);
