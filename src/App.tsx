import { useCallback, useEffect, useState } from "react";
import { pointCoords, type OnChainAccount } from "@ctd/sdk";
import { ConfidentialWallet, type WalletView, type TxPhase } from "./lib/wallet";
import { useAccounts, type Account } from "./store/accounts";
import { DEPLOYMENT, EXPLORER } from "./lib/deployment";

type ActionTab = "deposit" | "withdraw" | "transfer" | "merge";

const ACTIONS: Record<ActionTab, { icon: string; title: string; hint: string }> = {
  deposit: { icon: "↓", title: "Deposit", hint: "Public XLM (stroops) → your private receiving balance." },
  withdraw: { icon: "↑", title: "Withdraw", hint: "Private spendable balance → public XLM (to yourself)." },
  transfer: { icon: "→", title: "Transfer", hint: "Send to another account — the amount stays hidden on-chain." },
  merge: { icon: "⊕", title: "Merge", hint: "Fold your receiving balance into spendable so you can use it." },
};

export default function App() {
  const { accounts, activeId, ensureSeed, addAccount, switchTo } = useAccounts();
  const active = accounts.find((a) => a.id === activeId) ?? null;

  const [wallet, setWallet] = useState<ConfidentialWallet | null>(null);
  const [view, setView] = useState<WalletView | null>(null);
  const [onchain, setOnchain] = useState<OnChainAccount | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<TxPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ActionTab>("deposit");
  const [adding, setAdding] = useState(false);

  const [depositAmt, setDepositAmt] = useState("1000");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmt, setTransferAmt] = useState("400");
  const [withdrawAmt, setWithdrawAmt] = useState("400");

  const log = useCallback((msg: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...prev].slice(0, 80));
  }, []);

  const refreshWith = useCallback(async (w: ConfidentialWallet) => {
    const v = await w.refresh();
    setView(v);
    setOnchain(await w.onChainCiphertext());
  }, []);

  useEffect(() => {
    void ensureSeed();
  }, [ensureSeed]);

  // Rebuild the confidential wallet whenever the active account changes.
  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setWallet(null);
      setView(null);
      setOnchain(null);
      return;
    }
    setError(null);
    setBusy("loading");
    setView(null);
    setOnchain(null);
    setTab("deposit");
    ConfidentialWallet.fromSecret(active.secret, log)
      .then(async (w) => {
        if (cancelled) return;
        setWallet(w);
        log(`active account ${active.name} (${short(w.address)})`);
        await refreshWith(w);
      })
      .catch((e) => !cancelled && setError(errMsg(e)))
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.secret]);

  const run = useCallback(
    (label: string, fn: (w: ConfidentialWallet) => Promise<void>) => async () => {
      if (!wallet) return;
      setError(null);
      setBusy(label);
      setPhase(null);
      try {
        await fn(wallet);
        await refreshWith(wallet);
      } catch (e) {
        setError(errMsg(e));
        log(`error: ${errMsg(e)}`);
      } finally {
        setBusy(null);
        setPhase(null);
      }
    },
    [wallet, refreshWith, log],
  );

  const onAdd = async () => {
    setAdding(true);
    try {
      await addAccount();
    } finally {
      setAdding(false);
    }
  };

  const showMerge = (view?.receiving ?? 0n) > 0n;
  const activeTab: ActionTab = tab === "merge" && !showMerge ? "deposit" : tab;
  const tabs: ActionTab[] = showMerge ? ["deposit", "withdraw", "transfer", "merge"] : ["deposit", "withdraw", "transfer"];
  const others = accounts.filter((a) => a.id !== active?.id);

  return (
    <div className="wrap">
      <header className="appbar">
        <div className="brand">
          <span style={{ fontSize: 22 }}>🛡️</span>
          <div>
            <h1>Confidential Wallet</h1>
            <div className="sub">Hidden-amount transfers on Stellar · no auditor</div>
          </div>
        </div>
        <span className="badge net">● testnet</span>
      </header>

      <IntroCard />

      <AccountSwitcher
        accounts={accounts}
        activeId={activeId}
        onSwitch={switchTo}
        onAdd={onAdd}
        adding={adding}
      />

      {error && <div className="note err" style={{ marginTop: 16 }}>{error}</div>}

      {!active ? (
        <div className="card" style={{ marginTop: 16 }}>Seeding demo accounts…</div>
      ) : (
        <>
          <Balances view={view} loading={busy === "loading"} />

          {view?.registered && showMerge && (
            <div className="note warn" style={{ marginTop: 16 }}>
              <span>Received {view.receiving.toString()} into your receiving balance — merge it to spend or transfer.</span>
              <button className="btn merge" onClick={() => setTab("merge")}>Go to merge</button>
            </div>
          )}

          {view && !view.registered ? (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>Register this account</h3>
              <p className="hint">
                One-time: binds {active.name}&apos;s confidential keys to the token contract. A ZK proof is
                generated in your browser (~a few seconds). Everything unlocks after this.
              </p>
              <button className="btn primary" disabled={busy !== null} onClick={run("register", (w) => w.register(setPhase))}>
                {busy === "register" ? phaseLabel(phase) : "Register"}
              </button>
            </div>
          ) : view ? (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="tabs">
                {tabs.map((t) => (
                  <button key={t} className={`tab ${t} ${activeTab === t ? "on" : ""}`} onClick={() => setTab(t)}>
                    <span className="ic">{ACTIONS[t].icon}</span>
                    {ACTIONS[t].title}
                    {t === "merge" && <span className="pill">{view.receiving.toString()}</span>}
                  </button>
                ))}
              </div>

              <div className="panel">
                <p className="hint">{ACTIONS[activeTab].hint}</p>
                <div className="controls">
                  {activeTab === "deposit" && (
                    <>
                      <input className="amt" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} />
                      <button className="btn deposit" disabled={busy !== null} onClick={run("deposit", (w) => w.deposit(BigInt(depositAmt || "0")))}>
                        {busy === "deposit" ? "Submitting…" : "Deposit"}
                      </button>
                    </>
                  )}
                  {activeTab === "withdraw" && (
                    <>
                      <input className="amt" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} />
                      <button className="btn withdraw" disabled={busy !== null} onClick={run("withdraw", (w) => w.withdraw(BigInt(withdrawAmt || "0"), setPhase))}>
                        {busy === "withdraw" ? phaseLabel(phase) : "Withdraw"}
                      </button>
                    </>
                  )}
                  {activeTab === "transfer" && (
                    <>
                      <select className="rcpt" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                        <option value="">Select recipient…</option>
                        {others.map((a) => (
                          <option key={a.id} value={a.publicKey}>
                            {a.name} · {short(a.publicKey)}
                          </option>
                        ))}
                      </select>
                      <input className="amt" value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)} />
                      <button className="btn transfer" disabled={busy !== null || !transferTo} onClick={run("transfer", (w) => w.transfer(transferTo, BigInt(transferAmt || "0"), setPhase))}>
                        {busy === "transfer" ? phaseLabel(phase) : "Send"}
                      </button>
                    </>
                  )}
                  {activeTab === "merge" && (
                    <button className="btn merge" disabled={busy !== null} onClick={run("merge", (w) => w.merge())}>
                      {busy === "merge" ? "Submitting…" : `Merge ${view.receiving.toString()}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <ObserverPanel onchain={onchain} address={active.publicKey} />
        </>
      )}

      {logs.length > 0 && <pre className="log">{logs.join("\n")}</pre>}

      <footer className="foot">
        token <a href={`${EXPLORER}/contract/${DEPLOYMENT.contracts.token}`} target="_blank" rel="noreferrer">{short(DEPLOYMENT.contracts.token)}</a>
        {" · "}reuses the OpenZeppelin confidential-token rails · proofs generated locally in your browser
      </footer>
    </div>
  );
}

const LIFECYCLE: { step: string; text: string }[] = [
  { step: "Register", text: "publish your confidential public key (a one-time ZK proof)." },
  { step: "Deposit", text: "move public XLM into an encrypted balance — the amount entering is public, but from here on it's hidden." },
  { step: "Merge", text: "apply an incoming (pending) balance so you can spend it." },
  { step: "Transfer", text: "send to another account. The amount is proven valid in zero-knowledge and never revealed." },
  { step: "Withdraw", text: "cash an encrypted balance back out to public XLM." },
];

function IntroCard() {
  const [open, setOpen] = useState(() => localStorage.getItem("ctd-intro-dismissed") !== "1");
  if (!open) {
    return (
      <button className="intro-reopen" onClick={() => setOpen(true)}>
        ⓘ How confidential tokens work
      </button>
    );
  }
  return (
    <div className="card intro">
      <div className="rowhead">
        <h3 style={{ margin: 0 }}>How confidential tokens work</h3>
        <button
          className="btn ghost"
          onClick={() => {
            localStorage.setItem("ctd-intro-dismissed", "1");
            setOpen(false);
          }}
        >
          Got it
        </button>
      </div>
      <p className="hint" style={{ marginBottom: 12 }}>
        A normal token transfer writes the <strong>amount</strong> onto the public ledger forever.
        A <strong>confidential token</strong> stores every balance as an <strong>encrypted commitment</strong> — a
        point on an elliptic curve, not a number. Each transfer carries a{" "}
        <strong>zero-knowledge proof</strong> that it&apos;s valid (you had enough; nothing was minted)
        <em> without revealing the amount</em>. Only the holder can decrypt their own balance. Here that proof is
        generated <strong>in your browser</strong> and checked on-chain by a Soroban verifier.
      </p>
      <ol className="steps">
        {LIFECYCLE.map((l) => (
          <li key={l.step}>
            <span className="k">{l.step}</span> — {l.text}
          </li>
        ))}
      </ol>
      <p className="hint" style={{ margin: "12px 0 0" }}>
        💡 Two things to try: watch the <strong>“What everyone else sees”</strong> panel below — your balance is a
        number to you but ciphertext to the world. And <strong>switch accounts</strong> (Alice ↔ Bob) to play both
        the sender and the recipient of a hidden transfer.
      </p>
    </div>
  );
}

function AccountSwitcher(props: {
  accounts: Account[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  adding: boolean;
}) {
  const { accounts, activeId, onSwitch, onAdd, adding } = props;
  return (
    <div className="card">
      <div className="rowhead">
        <h3 style={{ margin: 0 }}>Accounts</h3>
        <span className="sub" style={{ fontSize: 12, color: "var(--muted)" }}>switch to act as anyone — each sees only its own balance</span>
      </div>
      <div className="accts">
        {accounts.map((a) => (
          <button key={a.id} className={`acct ${a.id === activeId ? "active" : ""}`} onClick={() => onSwitch(a.id)}>
            <span className="nm">
              <span className={`dot ${a.funded ? "on" : "off"}`} title={a.funded ? "funded" : "funding…"} />
              {a.name}
            </span>
            <span className="pk">{short(a.publicKey)}</span>
          </button>
        ))}
        <button className="acct add" onClick={onAdd} disabled={adding}>
          {adding ? "funding…" : "+ Add account"}
        </button>
      </div>
    </div>
  );
}

function Balances({ view, loading }: { view: WalletView | null; loading: boolean }) {
  return (
    <div className="card">
      <div className="rowhead">
        <span className="mono sub" style={{ fontSize: 12, color: "var(--muted)" }}>{view ? short(view.address, 8) : loading ? "loading…" : ""}</span>
        {view?.matchesChain !== null && view?.matchesChain !== undefined && (
          <span className={`chk ${view.matchesChain ? "ok" : "bad"}`} title="Local reconstruction re-committed and compared to on-chain commitments">
            {view.matchesChain ? "state matches chain ✓" : "state mismatch ✗"}
          </span>
        )}
      </div>
      <div className="balgrid">
        <div className="stat">
          <div className="lbl">Spendable</div>
          <div className="val">{view ? view.spendable.toString() : "—"}</div>
        </div>
        <div className="stat">
          <div className="lbl">Receiving</div>
          <div className="val">{view ? view.receiving.toString() : "—"}</div>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
        {view ? (view.registered ? `Only you can decrypt these numbers. Synced through ledger ${view.syncedLedger}.` : "Not registered yet.") : loading ? "Reconstructing balance from the chain…" : ""}
      </p>
    </div>
  );
}

function ObserverPanel({ onchain, address }: { onchain: OnChainAccount | null; address: string }) {
  return (
    <div className="card obs">
      <h3>What everyone else sees 👁️</h3>
      <p className="hint">
        This is the raw on-chain record for {short(address)}. Balances are stored as elliptic-curve
        commitments — ciphertext, not numbers. No observer can read the amounts above.
      </p>
      {!onchain ? (
        <div className="cipher">account not registered on-chain yet</div>
      ) : (
        <>
          <div className="lbl">spendable_balance (commitment)</div>
          <div className="cipher">{ptHex(onchain.spendableBalance)}</div>
          <div className="lbl">receiving_balance (commitment)</div>
          <div className="cipher">{ptHex(onchain.receivingBalance)}</div>
        </>
      )}
    </div>
  );
}

function ptHex(p: unknown): string {
  try {
    const { x, y } = pointCoords(p as never) as { x: bigint; y: bigint };
    return `0x${x.toString(16).padStart(64, "0")}${y.toString(16).padStart(64, "0")}`;
  } catch {
    return "(unreadable point)";
  }
}

function phaseLabel(phase: TxPhase | null): string {
  if (phase === "submitting") return "Submitting tx…";
  if (phase === "proving") return "Proving in browser…";
  return "Preparing…";
}

function short(id: string, n = 6): string {
  return id.length > 2 * n ? `${id.slice(0, n)}…${id.slice(-n)}` : id;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string };
    return o.message ?? JSON.stringify(e);
  }
  return String(e);
}
