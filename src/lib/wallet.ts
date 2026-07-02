/**
 * ConfidentialWallet — UI-facing orchestration over @ctd/sdk, driven by a
 * local Stellar keypair (no Freighter). All proving happens in the browser
 * (bb.js); the confidential `sk` never leaves the device. `sk` is derived
 * deterministically from an Ed25519 signature over a deployment-bound message
 * (see derive-key.ts) and cached in localStorage, keyed per account + token.
 *
 * Trimmed from the reference app: no selective-disclosure and no auditor UI —
 * just the five money operations (register, deposit, merge, transfer, withdraw)
 * plus balance/event reads.
 */
import { Buffer } from "buffer";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  ChainClient,
  type Signer,
  type OnChainAccount,
  deriveKeys,
  type KeyPair,
  addressToField,
  toHex32,
  fromHex,
  StateEngine,
  LocalStorageStore,
  type AccountState,
  type CircuitProver,
  proverFromArtifact,
  buildRegisterWitness,
  buildWithdrawWitness,
  buildTransferWitness,
  submitRegister,
  submitDeposit,
  submitMerge,
  submitWithdraw,
  submitTransfer,
  fetchEvents,
  type ConfidentialEvent,
} from "@ctd/sdk";
import registerCircuit from "@ctd/sdk/circuits/register.json";
import withdrawCircuit from "@ctd/sdk/circuits/withdraw.json";
import transferCircuit from "@ctd/sdk/circuits/transfer.json";

import { DEPLOYMENT } from "./deployment";
import { keyDerivationMessage, skFromSignature } from "./derive-key";
import { ensureBrowserBackend } from "./bb-loader";

type Log = (msg: string) => void;
type CircuitName = "register" | "withdraw" | "transfer";

const CIRCUITS: Record<CircuitName, { bytecode: string } & Record<string, unknown>> = {
  register: registerCircuit as never,
  withdraw: withdrawCircuit as never,
  transfer: transferCircuit as never,
};

/** Coarse progress of a proof-carrying operation, for UI button labels. */
export type TxPhase = "proving" | "submitting";

export interface WalletView {
  address: string;
  registered: boolean;
  spendable: bigint;
  receiving: bigint;
  syncedLedger: number;
  matchesChain: boolean | null;
}

export class ConfidentialWallet {
  private provers = new Map<CircuitName, CircuitProver>();

  private constructor(
    readonly address: string,
    private signer: Signer,
    private keys: KeyPair,
    private client: ChainClient,
    private engine: StateEngine,
    private log: Log,
  ) {}

  /** Build a wallet from a local testnet secret (S...). No Freighter prompt. */
  static async fromSecret(secret: string, log: Log): Promise<ConfidentialWallet> {
    ensureBrowserBackend();
    const kp = Keypair.fromSecret(secret);
    const address = kp.publicKey();

    const signer: Signer = {
      publicKey: address,
      async sign(txXdrBase64: string): Promise<string> {
        const tx = TransactionBuilder.fromXDR(txXdrBase64, DEPLOYMENT.networkPassphrase);
        tx.sign(kp);
        return tx.toXDR();
      },
    };

    const client = new ChainClient({
      rpcUrl: DEPLOYMENT.rpcUrl,
      networkPassphrase: DEPLOYMENT.networkPassphrase,
      contracts: DEPLOYMENT.contracts,
    });

    const addrF = addressToField(DEPLOYMENT.contracts.token);
    const skKey = `ctd:sk:${DEPLOYMENT.contracts.token}:${address}`;
    let sk: bigint;
    const stored = localStorage.getItem(skKey);
    if (stored) {
      sk = fromHex(stored);
    } else {
      const msg = keyDerivationMessage(DEPLOYMENT.networkPassphrase, DEPLOYMENT.contracts.token);
      const signature = new Uint8Array(kp.sign(Buffer.from(msg, "utf8")));
      sk = await skFromSignature(signature);
      localStorage.setItem(skKey, toHex32(sk));
      log("derived confidential key from account signature (cached locally)");
    }
    const keys = deriveKeys(sk, addrF);

    // The RPC only retains events for ~7 days, so scanning from the (older)
    // deploy ledger makes getEvents reject the range. Clamp to the oldest
    // retained ledger — safe here because demo accounts only ever transact now.
    let fromLedger: number = DEPLOYMENT.deployedAtLedger;
    try {
      const health = await client.server.getHealth();
      const oldest = (health as { oldestLedger?: number }).oldestLedger;
      if (oldest) fromLedger = Math.max(fromLedger, oldest + 1);
    } catch {
      // health-endpoint variations are non-fatal; fall back to the deploy ledger
    }

    const engine = new StateEngine({
      client,
      store: new LocalStorageStore(),
      keys,
      address,
      fromLedger,
    });

    return new ConfidentialWallet(address, signer, keys, client, engine, log);
  }

  private prover(name: CircuitName): CircuitProver {
    let p = this.provers.get(name);
    if (!p) {
      p = proverFromArtifact(CIRCUITS[name]);
      this.provers.set(name, p);
    }
    return p;
  }

  /** Read on-chain account (null if not registered). */
  async account(): Promise<OnChainAccount | null> {
    return this.client.confidentialBalance(this.address);
  }

  async register(onPhase?: (p: TxPhase) => void): Promise<void> {
    const w = buildRegisterWitness(this.keys);
    onPhase?.("proving");
    this.log("proving register…");
    const { proof } = await this.prover("register").prove(w.inputs);
    onPhase?.("submitting");
    this.log("submitting register…");
    const r = await submitRegister(this.client, this.signer, this.address, DEPLOYMENT.auditorId, w, proof);
    this.log(`registered (tx ${r.hash.slice(0, 10)}…)`);
  }

  async deposit(amount: bigint): Promise<void> {
    this.log(`depositing ${amount}…`);
    const r = await submitDeposit(this.client, this.signer, this.address, this.address, amount);
    this.log(`deposited (tx ${r.hash.slice(0, 10)}…) → receiving balance`);
  }

  async merge(): Promise<void> {
    this.log("merging receiving → spendable…");
    const r = await submitMerge(this.client, this.signer, this.address);
    this.log(`merged (tx ${r.hash.slice(0, 10)}…)`);
  }

  async transfer(to: string, amount: bigint, onPhase?: (p: TxPhase) => void): Promise<void> {
    const recipient = await this.client.confidentialBalance(to);
    if (!recipient) throw new Error("recipient is not registered");
    const kAudR = await this.client.auditorKey(recipient.auditorId);
    const kAudS = await this.client.auditorKey(DEPLOYMENT.auditorId);

    const s = await this.engine.sync();
    if (s.spendable.v < amount) throw new Error(`insufficient spendable balance (${s.spendable.v})`);

    const w = buildTransferWitness({
      keys: this.keys,
      v: s.spendable.v,
      r: s.spendable.r,
      amount,
      pvkB: recipient.viewingPublicKey,
      kAudR,
      kAudS,
    });
    onPhase?.("proving");
    this.log("proving transfer…");
    const { proof } = await this.prover("transfer").prove(w.inputs);
    onPhase?.("submitting");
    this.log("submitting transfer…");
    const r = await submitTransfer(this.client, this.signer, this.address, to, w, proof);
    await this.engine.setSpendable(w.next);
    this.log(`transferred ${amount} → ${to.slice(0, 6)}… (tx ${r.hash.slice(0, 10)}…)`);
  }

  async withdraw(amount: bigint, onPhase?: (p: TxPhase) => void): Promise<void> {
    const kAudS = await this.client.auditorKey(DEPLOYMENT.auditorId);
    const s = await this.engine.sync();
    if (s.spendable.v < amount) throw new Error(`insufficient spendable balance (${s.spendable.v})`);

    const w = buildWithdrawWitness({ keys: this.keys, v: s.spendable.v, r: s.spendable.r, amount, kAudS });
    onPhase?.("proving");
    this.log("proving withdraw…");
    const { proof } = await this.prover("withdraw").prove(w.inputs);
    onPhase?.("submitting");
    this.log("submitting withdraw…");
    const r = await submitWithdraw(this.client, this.signer, this.address, this.address, amount, w, proof);
    await this.engine.setSpendable(w.next);
    this.log(`withdrew ${amount} → public (tx ${r.hash.slice(0, 10)}…)`);
  }

  /** This account's token-contract events, newest first (RPC ~7-day window). */
  async listEvents(): Promise<ConfidentialEvent[]> {
    const events = await this.fetchAllEvents();
    return events.filter((ev) => this.concernsMe(ev)).reverse();
  }

  /** Other accounts that have a `register` event still in the RPC window. */
  async registeredRecipients(): Promise<string[]> {
    const seen = new Set<string>();
    for (const ev of await this.fetchAllEvents()) {
      if (ev.type === "register" && ev.account !== this.address) seen.add(ev.account);
    }
    return [...seen];
  }

  private async fetchAllEvents(): Promise<ConfidentialEvent[]> {
    let start: number = DEPLOYMENT.deployedAtLedger;
    try {
      const health = await this.client.server.getHealth();
      if (health.oldestLedger) start = Math.max(start, health.oldestLedger + 1);
    } catch {
      // health endpoint variations are non-fatal; fall back to deploy ledger
    }
    const { events } = await fetchEvents(this.client, { startLedger: start });
    return events;
  }

  private concernsMe(ev: ConfidentialEvent): boolean {
    switch (ev.type) {
      case "register":
      case "merge":
        return ev.account === this.address;
      case "deposit":
      case "withdraw":
      case "transfer":
        return ev.from === this.address || ev.to === this.address;
    }
  }

  /** The raw on-chain record for this account — curve points, not amounts. */
  async onChainCiphertext(): Promise<OnChainAccount | null> {
    return this.account();
  }

  /** Sync from RPC events, verify against chain, and return a UI view. */
  async refresh(): Promise<WalletView> {
    const state: AccountState = await this.engine.sync();
    const onchain = await this.account();
    let matchesChain: boolean | null = null;
    if (onchain) {
      matchesChain = (await this.engine.verifyAgainstChain()).ok;
    }
    return {
      address: this.address,
      registered: onchain !== null,
      spendable: state.spendable.v,
      receiving: state.receiving.v,
      syncedLedger: state.syncedLedger,
      matchesChain,
    };
  }
}
