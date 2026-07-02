import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

/**
 * The confidential wallet generates UltraHonk proofs in the browser via bb.js,
 * which wants multithreading → SharedArrayBuffer → cross-origin isolation.
 * COOP=same-origin + COEP=credentialless keeps the page isolated while still
 * letting fetch() reach the Soroban RPC without CORP headers on that endpoint.
 */
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
// @ctd/sdk is a `link:` into the sibling oz-demo repo, so its noir_js wasm
// (acvm_js / noirc_abi) resolves from oz-demo/node_modules. Vite's dev server
// 403s /@fs paths outside the project root, so allow the oz-demo tree too.
const ozDemoRoot = fileURLToPath(new URL("../confidential/oz-demo", import.meta.url));

/**
 * bb.js must load as a NATIVE ES module from a stable path so its wasm Web
 * Worker (`new Worker(new URL('./main.worker.js', import.meta.url))`) resolves.
 * But Vite's dev server routes `import()` of a /public .js through its transform
 * pipeline and 500s ("file is in /public … can only be referenced via HTML").
 * This middleware serves /vendor/bb/* raw, before Vite's transform, so the
 * native import + worker resolution work in dev. (In build/preview, /public is
 * already served as-is.)
 */
function serveBbRaw(): PluginOption {
  return {
    name: "serve-bb-raw",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith("/vendor/bb/")) return next();
        const filePath = path.join(projectRoot, "public", url);
        if (!filePath.startsWith(path.join(projectRoot, "public")) || !fs.existsSync(filePath)) {
          return next();
        }
        res.setHeader("Content-Type", url.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [serveBbRaw(), react()],
  server: { headers: crossOriginIsolation, fs: { allow: [projectRoot, ozDemoRoot] } },
  preview: { headers: crossOriginIsolation },
  resolve: {
    // The SDK's Node-only default prover loader does `import("@aztec/bb.js")`.
    // We never call it in the browser (bb.js is loaded as native ESM from
    // /vendor/bb — see src/lib/bb-loader.ts), so alias the bare specifier to an
    // inert stub to keep bb.js's bundler-hostile browser build out of the graph.
    alias: {
      "@aztec/bb.js": fileURLToPath(new URL("./src/lib/bb-stub.ts", import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ["@ctd/sdk", "@aztec/bb.js", "@noir-lang/noir_js", "@noir-lang/acvm_js"],
    esbuildOptions: { target: "esnext" },
  },
  build: { target: "esnext" },
});
