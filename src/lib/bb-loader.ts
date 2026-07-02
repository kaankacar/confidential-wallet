/**
 * Browser bb.js loader for Vite.
 *
 * bb.js's `dest/browser/` is copied verbatim into `public/vendor/bb/` by
 * scripts/vendor-bb.mjs (run via predev/prebuild). We load it as a NATIVE ES
 * module from that stable path instead of letting Vite bundle it, because bb.js
 * resolves its wasm Web Worker relative to `import.meta.url`
 * (`new Worker(new URL('./main.worker.js', import.meta.url))`). Bundling moves
 * `index.js` into a hashed chunk whose sibling `main.worker.js` no longer
 * exists, so the worker never loads and proving hangs. Served from
 * `/vendor/bb/index.js`, `import.meta.url` points at a real directory where the
 * worker + wasm files are present.
 *
 * The `/* @vite-ignore *​/` comment stops Vite from analyzing/transforming the
 * dynamic import, so the runtime browser `import()` fetches the public URL as-is.
 */
import { setUltraHonkBackendLoader } from "@ctd/sdk";

const BB_URL = "/vendor/bb/index.js";

let registered = false;

/** Point the SDK prover at the native-ESM bb.js. Idempotent; browser-only. */
export function ensureBrowserBackend(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  setUltraHonkBackendLoader(async () => {
    const mod = await import(/* @vite-ignore */ BB_URL);
    return (mod as Record<string, unknown>).UltraHonkBackend as never;
  });
}
