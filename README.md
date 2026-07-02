# Confidential Wallet — Stellar testnet

**▶ Live demo: https://confidential-wallet-kaans-projects-f531fbcb.vercel.app**

A minimal, self-contained **confidential-token wallet** on Stellar/Soroban. Send
and receive tokens where the **amounts are hidden on-chain** — balances are
stored as encrypted commitments, and every transfer carries a zero-knowledge
proof generated locally in your browser. It's also a **teaching demo**: it
explains the confidential-token model as you use it, and includes an "observer"
panel that shows exactly what the public chain can (and can't) see.

> Testnet only. Balances have no real value. Unaudited demo.

## What are confidential tokens?

A normal token transfer writes the **amount** onto the public ledger forever —
anyone can read who paid whom, and how much. A **confidential token** hides the
amount:

- Each balance is stored as an **encrypted commitment** — a point on an elliptic
  curve, not a number. Only the holder can decrypt their own balance.
- Every transfer carries a **zero-knowledge proof** that it's valid (you had
  enough; nothing was minted) **without revealing the amount**.
- Here that proof is generated **in your browser** and verified **on-chain** by a
  Soroban verifier — no trusted server sees your amounts.

The lifecycle:

| Step | What it does | Amount visible? |
|---|---|---|
| **Register** | publish your confidential public key (one-time ZK proof) | — |
| **Deposit** | move public XLM into an encrypted balance | public entering, hidden after |
| **Merge** | apply an incoming (pending) balance so you can spend it | — |
| **Transfer** | send to another account, amount proven valid in ZK | **hidden** |
| **Withdraw** | cash an encrypted balance back out to public XLM | public leaving |

The **observer panel** in the app shows the raw on-chain record for your
account: the balances are ciphertext (curve points), so no observer can read the
amounts you see decrypted in your own wallet.

## What this demo does

- **Switch between accounts** (Alice, Bob, and any you add) — each is a real
  Stellar keypair generated in the browser and friendbot-funded. Act as anyone
  to watch a confidential transfer from both ends: sender and recipient each see
  only their own balance; the chain shows only ciphertext.
- **Register / Deposit / Merge / Transfer / Withdraw** with hidden amounts.
- Each account's confidential spending key is derived deterministically from an
  Ed25519 signature over a deployment-bound message — stable across sessions,
  never leaves the browser. No auditor or disclosure UI; just private money.

## How it's built

- **Vite + React + TypeScript**, no backend. Key derivation, proving, and state
  reconstruction all run client-side against public Soroban RPC + friendbot.
- Reuses OpenZeppelin-style confidential-token rails via **`@ctd/sdk`** (Pedersen
  commitments on Grumpkin, UltraHonk proofs via `bb.js` with a keccak transcript,
  verified on-chain by a native-BN254 Soroban verifier). The SDK is consumed in
  place through a local `link:` dependency.
- **bb.js** is vendored into `public/vendor/bb` and loaded as native ESM so its
  wasm Web Worker resolves correctly; its CRS is vendored same-origin into
  `public/crs`. The page is served **cross-origin isolated** (COOP/COEP) so
  proving runs multithreaded.

## Run it locally

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

`pnpm dev` vendors bb.js + the CRS automatically. Two accounts (Alice, Bob) are
seeded and friendbot-funded on first load. Register both, deposit to one, then
send a hidden-amount transfer and switch accounts to see it arrive.

## Deploy

Built as a **prebuilt static site** (the local `@ctd/sdk` link means CI can't
`pnpm install` a clean checkout — so we build locally and ship the output).

- **Vercel (primary).** `vercel.json` sets the `COOP`/`COEP` headers, so
  cross-origin isolation is native — no service worker needed. Build with the
  default (root) base and deploy the `dist/` folder.
- **GitHub Pages (alternative).** `scripts/deploy-ghpages.sh` builds for the
  `/confidential-wallet/` subpath and force-pushes `dist/` to the `gh-pages`
  branch. GitHub Pages can't send `COOP`/`COEP`, so a bundled
  `coi-serviceworker` grants cross-origin isolation client-side (credentialless,
  so cross-origin RPC/friendbot still work).

## Verify end-to-end

Headless-browser scripts drive the **real UI** against live testnet, asserting
balances at each step (require system Chrome via `puppeteer-core`):

```bash
# full flow: register → deposit → merge → transfer → recipient receives
node scripts/browser-e2e.mjs                 # defaults to localhost:5173
URL=<any-deployed-url> node scripts/browser-e2e.mjs   # e.g. the live Vercel URL

# deployed-site smoke check (isolation → funding → on-chain register)
URL=<deployed-url> node scripts/live-check.mjs
```

## Layout

```
index.html          registers the coi-serviceworker (no-op where COOP/COEP exist)
vercel.json         COOP/COEP headers for the Vercel deploy
src/
  lib/
    deployment.ts   reused testnet contract ids (token/verifier/auditor/XLM SAC)
    derive-key.ts   sk = SHA-512(Ed25519 signature) mod r  (deterministic, local)
    wallet.ts       ConfidentialWallet — orchestration over @ctd/sdk
    bb-loader.ts    load vendored bb.js as native ESM (base-aware)
    bb-stub.ts      keeps bb.js's bundler-hostile build out of the Vite graph
  store/accounts.ts multi-account dev wallet (generate / friendbot-fund / switch)
  App.tsx           intro explainer + switcher + balances + actions + observer
public/
  coi-serviceworker.js   cross-origin isolation shim for header-less hosts
scripts/
  vendor-bb.mjs     vendor bb.js browser build + CRS, patch CRS to same-origin
  browser-e2e.mjs   full headless testnet end-to-end test
  live-check.mjs    deployed-site verification
  deploy-ghpages.sh build for the subpath + publish dist/ to gh-pages
```

## Caveats

- **Testnet, unaudited demo.** Secrets live in browser localStorage.
- **Not clone-and-run elsewhere as-is:** `@ctd/sdk` is a local `link:` to a
  sibling repo, so `pnpm install` needs that SDK present. The *deployed* site is
  self-contained (the build inlines it).
- The underlying confidential token has an auditor key at the protocol level;
  this wallet never uses or surfaces it. Amounts are hidden from the public chain
  regardless.
- Balance reconstruction reads Soroban RPC events, retained ~7 days — so this
  wallet is scoped to accounts that transact recently (as demo accounts do). A
  production wallet would use an indexer.
