/**
 * Inert stand-in for @aztec/bb.js in the browser build.
 *
 * The SDK's default prover loader references `@aztec/bb.js` via a dynamic
 * import that we never execute in the browser — we override the loader to pull
 * bb.js as native ESM from /vendor/bb (see bb-loader.ts). Vite aliases the bare
 * specifier here (vite.config.ts) so bb.js's bundler-hostile browser build is
 * kept out of the module graph. If anything ever actually imports from this, it
 * throws loudly rather than silently misbehaving.
 */
export class UltraHonkBackend {
  constructor() {
    throw new Error(
      "@aztec/bb.js was imported through the bundler — it must load as native ESM from /vendor/bb (see bb-loader.ts)",
    );
  }
}
