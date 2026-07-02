/**
 * Multi-account dev wallet (SGS-style), testnet only.
 *
 * Generates in-browser Stellar keypairs, funds them via friendbot, and persists
 * them to localStorage so you can switch between accounts (e.g. Alice ↔ Bob) and
 * watch a confidential transfer from both ends. Secrets live in the browser —
 * this is a testnet demo, not a place for real keys.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Keypair } from "@stellar/stellar-sdk";

export interface Account {
  id: string;
  name: string;
  secret: string;
  publicKey: string;
  funded: boolean;
}

interface AccountsState {
  accounts: Account[];
  activeId: string | null;
  seeded: boolean;
  addAccount: (name?: string) => Promise<Account>;
  switchTo: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  markFunded: (id: string) => void;
  fund: (id: string) => Promise<boolean>;
  ensureSeed: () => Promise<void>;
}

/** Best-effort friendbot funding. Treats an already-funded account as success. */
export async function friendbotFund(publicKey: string): Promise<boolean> {
  try {
    const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`);
    if (res.ok) return true;
    const body = await res.text().catch(() => "");
    // Already-funded accounts return 400 with op_already_exists — that's fine.
    return res.status === 400 && /already|exists|op_already_exists/i.test(body);
  } catch {
    return false;
  }
}

function makeAccount(name: string): Account {
  const kp = Keypair.random();
  return { id: crypto.randomUUID(), name, secret: kp.secret(), publicKey: kp.publicKey(), funded: false };
}

export const useAccounts = create<AccountsState>()(
  persist(
    (set, get) => ({
      accounts: [],
      activeId: null,
      seeded: false,

      addAccount: async (name) => {
        const n = name ?? `Account ${get().accounts.length + 1}`;
        const acct = makeAccount(n);
        set((s) => ({ accounts: [...s.accounts, acct], activeId: acct.id }));
        const funded = await friendbotFund(acct.publicKey);
        if (funded) get().markFunded(acct.id);
        return acct;
      },

      switchTo: (id) => set({ activeId: id }),

      rename: (id, name) =>
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, name } : a)) })),

      remove: (id) =>
        set((s) => {
          const accounts = s.accounts.filter((a) => a.id !== id);
          const activeId = s.activeId === id ? (accounts[0]?.id ?? null) : s.activeId;
          return { accounts, activeId };
        }),

      markFunded: (id) =>
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, funded: true } : a)) })),

      fund: async (id) => {
        const a = get().accounts.find((x) => x.id === id);
        if (!a) return false;
        if (a.funded) return true;
        const ok = await friendbotFund(a.publicKey);
        if (ok) get().markFunded(id);
        return ok;
      },

      ensureSeed: async () => {
        if (get().accounts.length === 0) {
          const alice = makeAccount("Alice");
          const bob = makeAccount("Bob");
          set({ accounts: [alice, bob], activeId: alice.id });
        }
        set({ seeded: true });
        // Fund any unfunded accounts. Runs on every mount so funding recovers if
        // a prior load's friendbot request was interrupted (e.g. by the
        // coi-serviceworker reload that establishes cross-origin isolation).
        await Promise.all(get().accounts.filter((a) => !a.funded).map((a) => get().fund(a.id)));
      },
    }),
    { name: "ctd-wallet-accounts" },
  ),
);

export function activeAccount(s: AccountsState): Account | null {
  return s.accounts.find((a) => a.id === s.activeId) ?? null;
}
