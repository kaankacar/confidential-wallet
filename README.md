# Confidential Wallet — Stellar testnet

**▶ Live demo: https://confidential-wallet-kaans-projects-f531fbcb.vercel.app**

A minimal, self-contained **confidential-token wallet** on Stellar/Soroban with
**in-browser multi-account switching**. Send and receive tokens where the
**amounts are hidden on-chain** — balances are stored as elliptic-curve
commitments, and every transfer carries a zero-knowledge proof generated locally
in your browser. No auditor, no disclosure UI — just private money.

> Testnet only. Balances have no real value. This is a demo.

## What it does

- **Switch between accounts** (Alice, Bob, and any you add) — each is a real
  Stellar keypair generated in the browser and funded via friendbot. Act as
  anyone to watch a confidential transfer from both ends.
- **Register / Deposit / Merge / Transfer / Withdraw** against a confidential
  token:
  - *Deposit* moves public XLM into your (hidden) receiving balance.
  - *Merge* folds the receiving balance into spendable.
  - *Transfer* sends a **hidden amount** to another account.
  - *Withdraw* moves a hidden balance back out to public XLM.
- **Observer panel** — shows the raw on-chain record for your account: the
  balances are ciphertext (curve points), so no one watching the chain can read
  the amounts.

Each account's confidential spending key is derived deterministically from an
Ed25519 signature over a deployment-bound message, so it is stable across
sessions and never leaves the browser.

## How it's built

- **Vite + React + TypeScript** frontend.
- Reuses the OpenZeppelin-style confidential-token rails via the **`@ctd/sdk`**
  package (Pedersen commitments on Grumpkin, UltraHonk proofs via `bb.js` with a
  keccak transcript, verified on-chain by a native-BN254 Soroban verifier). The
  SDK is consumed in place through a local `link:` dependency.
- **bb.js** is vendored into `public/vendor/bb` and loaded as native ESM so its
  wasm Web Worker resolves correctly; the page is served cross-origin isolated
  (COOP/COEP) so proving runs multithreaded.
- No backend. Everything — key derivation, proving, state reconstruction — runs
  client-side against public Soroban RPC + friendbot.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

`pnpm dev` vendors bb.js automatically. Two accounts (Alice, Bob) are seeded and
friendbot-funded on first load. Register both, deposit to one, then send a
hidden-amount transfer and switch accounts to see it arrive.

## Verify end-to-end

A headless-browser script drives the real UI against live testnet — render +
cross-origin-isolation check, then register → deposit → merge → transfer →
recipient-receives, asserting balances at each step:

```bash
pnpm dev &                        # serve first
node scripts/browser-e2e.mjs      # requires system Chrome
```

## Layout

```
src/
  lib/
    deployment.ts   reused testnet contract ids (token/verifier/auditor/XLM SAC)
    derive-key.ts   sk = SHA-512(Ed25519 signature) mod r  (deterministic, local)
    wallet.ts       ConfidentialWallet — orchestration over @ctd/sdk
    bb-loader.ts    load vendored bb.js as native ESM (Vite)
  store/accounts.ts multi-account dev wallet (generate / friendbot-fund / switch)
  App.tsx           switcher + balances + action tabs + observer panel
scripts/
  vendor-bb.mjs     copy bb.js browser build into public/vendor/bb
  browser-e2e.mjs   headless testnet end-to-end test
```

## Caveats

- **Testnet, unaudited demo.** Secrets live in browser localStorage.
- The underlying confidential token has an auditor key at the protocol level;
  this wallet simply never uses or surfaces it. Amounts are hidden from the
  public chain regardless.
- Balance reconstruction reads Soroban RPC events, which are retained ~7 days —
  so this wallet is scoped to accounts that transact recently (as demo accounts
  do). A production wallet would use an indexer.
