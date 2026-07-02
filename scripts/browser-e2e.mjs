/**
 * Headless-browser end-to-end test of the confidential wallet against Stellar
 * testnet, driving the real UI with system Chrome via puppeteer-core.
 *
 * Flow: load → assert render + cross-origin isolation → wait for Alice/Bob
 * friendbot funding → register Alice → deposit → merge → register Bob →
 * transfer (hidden amount) Alice→Bob → switch to Bob → assert Bob received.
 */
import puppeteer from "puppeteer-core";

const URL = process.env.URL ?? "http://localhost:5173/";
const CHROME =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROOF_TIMEOUT = 240_000; // register/transfer: bb.js proof + testnet poll
const TX_TIMEOUT = 150_000; // deposit/merge/load: tx + poll or initial RPC sync

const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (m) => console.log(`${stamp()}  ${m}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-first-run", "--no-default-browser-check", "--no-sandbox"],
});

const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  const txt = msg.text();
  if (msg.type() === "error") consoleErrors.push(txt);
  console.log(`    [console.${msg.type()}] ${txt}`);
});
page.on("pageerror", (err) => {
  consoleErrors.push(String(err));
  console.log(`    [pageerror] ${err}`);
});

// ---- helpers (run in page) ----
const balances = () =>
  page.evaluate(() => {
    const vals = [...document.querySelectorAll(".stat .val")].map((e) => e.textContent?.trim());
    return { spendable: vals[0] ?? null, receiving: vals[1] ?? null };
  });

/** Wait for an enabled button (optionally scoped) whose text includes `text`, then click it. */
const clickWhenEnabled = async (text, scope = "", timeout = TX_TIMEOUT) => {
  await page.waitForFunction(
    (t, s) => {
      const root = s ? document.querySelector(s) : document;
      if (!root) return false;
      return [...root.querySelectorAll("button")].some((b) => b.textContent?.includes(t) && !b.disabled);
    },
    { timeout, polling: 500 },
    text,
    scope,
  );
  return page.evaluate(
    (t, s) => {
      const root = s ? document.querySelector(s) : document;
      const b = [...root.querySelectorAll("button")].find((x) => x.textContent?.includes(t) && !x.disabled);
      b.click();
      return b.textContent?.trim();
    },
    text,
    scope,
  );
};

const clickTab = (text) => clickWhenEnabled(text, ".tabs");
const clickAction = (text) => clickWhenEnabled(text, ".panel");

const switchAccount = (name) =>
  page.evaluate((n) => {
    const pill = [...document.querySelectorAll(".acct")].find((a) =>
      a.querySelector(".nm")?.textContent?.includes(n),
    );
    if (pill) {
      pill.click();
      return true;
    }
    return false;
  }, name);

/** Wallet for the active account is ready when the register card or the tabs render. */
const waitWalletReady = (timeout = TX_TIMEOUT) =>
  page.waitForFunction(
    () => {
      const reg = [...document.querySelectorAll("button")].some(
        (b) => b.textContent?.trim() === "Register" && !b.disabled,
      );
      return reg || !!document.querySelector(".tab");
    },
    { timeout, polling: 500 },
  );

const waitFor = (fn, timeout, label) => {
  log(`waiting: ${label}`);
  return page.waitForFunction(fn, { timeout, polling: 1000 });
};

const isRegistered = () => page.evaluate(() => !!document.querySelector(".tab"));

async function dumpDiagnostics() {
  const info = await page.evaluate(() => ({
    err: document.querySelector(".note.err")?.textContent?.trim() ?? null,
    buttons: [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean),
    logs: document.querySelector(".log")?.textContent?.split("\n").slice(0, 8) ?? [],
  }));
  console.log(`    diag.error   = ${info.err}`);
  console.log(`    diag.buttons = ${JSON.stringify(info.buttons)}`);
  console.log(`    diag.applog  = ${JSON.stringify(info.logs)}`);
}

let failed = false;
try {
  log(`navigating to ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });

  // Stage A: render + isolation
  await page.waitForSelector(".acct", { timeout: 30_000 });
  const coi = await page.evaluate(() => self.crossOriginIsolated === true);
  log(`crossOriginIsolated = ${coi} (SharedArrayBuffer ${coi ? "available" : "OFF → bb.js single-thread"})`);
  const acctCount = await page.$$eval(".acct", (els) => els.filter((e) => e.querySelector(".nm")).length);
  log(`accounts seeded: ${acctCount}`);

  await waitFor(() => document.querySelectorAll(".acct .dot.on").length >= 2, 120_000, "Alice+Bob funded");
  log("both accounts funded ✓");

  // Alice active by default; wait for her wallet to finish its initial RPC sync.
  await switchAccount("Alice");
  await waitWalletReady();
  log("Alice wallet ready");

  // Stage B1: register Alice
  if (!(await isRegistered())) {
    log("registering Alice (in-browser ZK proof + testnet)…");
    await clickWhenEnabled("Register");
    await waitFor(() => !!document.querySelector(".tab"), PROOF_TIMEOUT, "Alice registered (tabs appear)");
    log("Alice registered ✓");
  } else {
    log("Alice already registered ✓");
  }

  // Stage B2: deposit 1000
  log("depositing 1000…");
  await clickTab("Deposit");
  await clickAction("Deposit");
  await waitFor(
    () => {
      const v = document.querySelectorAll(".stat .val")[1]?.textContent?.trim();
      return v && v !== "0" && v !== "—";
    },
    TX_TIMEOUT,
    "receiving balance > 0",
  );
  log(`deposited ✓ balances=${JSON.stringify(await balances())}`);

  // Stage B3: merge receiving → spendable
  log("merging…");
  await clickTab("Merge");
  await clickAction("Merge");
  await waitFor(
    () => {
      const v = document.querySelectorAll(".stat .val")[0]?.textContent?.trim();
      return v && v !== "0" && v !== "—";
    },
    TX_TIMEOUT,
    "spendable balance > 0",
  );
  log(`merged ✓ balances=${JSON.stringify(await balances())}`);

  // Stage B4: register Bob so he can receive
  log("switching to Bob…");
  await switchAccount("Bob");
  await waitWalletReady();
  if (!(await isRegistered())) {
    log("registering Bob…");
    await clickWhenEnabled("Register");
    await waitFor(() => !!document.querySelector(".tab"), PROOF_TIMEOUT, "Bob registered");
    log("Bob registered ✓");
  } else {
    log("Bob already registered ✓");
  }

  // Stage B5: back to Alice, transfer hidden amount to Bob
  log("switching to Alice for transfer…");
  await switchAccount("Alice");
  await waitWalletReady();
  await clickTab("Transfer");
  await page.waitForSelector("select.rcpt", { timeout: 10_000 });
  await page.evaluate(() => {
    const sel = document.querySelector("select.rcpt");
    const opt = [...sel.options].find((o) => o.textContent.includes("Bob"));
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  log(`Alice before transfer: ${JSON.stringify(await balances())} — sending 400 to Bob (in-browser proof)…`);
  await clickAction("Send");
  await waitFor(
    () => document.querySelectorAll(".stat .val")[0]?.textContent?.trim() === "600",
    PROOF_TIMEOUT,
    "Alice spendable == 600 after transfer",
  );
  log(`transfer sent ✓ Alice balances=${JSON.stringify(await balances())}`);

  // Stage B6: Bob received
  log("switching to Bob to confirm receipt…");
  await switchAccount("Bob");
  await waitFor(
    () => document.querySelectorAll(".stat .val")[1]?.textContent?.trim() === "400",
    90_000,
    "Bob receiving == 400",
  );
  log(`Bob received ✓ balances=${JSON.stringify(await balances())}`);

  log("ALL STAGES PASSED ✅");
} catch (e) {
  failed = true;
  log(`FAILED ❌: ${e.message}`);
  await dumpDiagnostics().catch(() => {});
} finally {
  if (consoleErrors.length) {
    console.log(`\n${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors.slice(0, 10)) console.log(`  - ${e}`);
  }
  await browser.close();
}
process.exit(failed ? 1 : 0);
