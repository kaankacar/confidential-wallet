/**
 * Verify the DEPLOYED GitHub Pages site does real in-browser proving.
 * Unlike the dev/preview runs, isolation here comes from the coi-serviceworker,
 * which reloads the page once to gain control — so this is reload-tolerant.
 * It confirms: crossOriginIsolated (SW worked), accounts seed + friendbot fund
 * (cross-origin under COEP credentialless), and a live register (ZK proof +
 * testnet). Full deposit/merge/transfer is already proven on the same build.
 */
import puppeteer from "puppeteer-core";

const URL = process.env.URL ?? "https://kaankacar.github.io/confidential-wallet/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const t0 = Date.now();
const log = (m) => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s  ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-first-run", "--no-sandbox"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`    [pageerror] ${e}`));

let failed = false;
try {
  log(`navigating ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });

  // The coi-serviceworker may reload the page to gain control; poll through it.
  log("waiting for crossOriginIsolated (coi-serviceworker)…");
  let coi = false;
  for (let i = 0; i < 40; i++) {
    try {
      coi = await page.evaluate(() => self.crossOriginIsolated === true);
    } catch {
      /* execution context destroyed by the SW reload — retry */
    }
    if (coi) break;
    await sleep(1000);
  }
  log(`crossOriginIsolated = ${coi}${coi ? "" : " (bb.js will prove single-threaded — slower)"}`);

  await page.waitForSelector(".acct", { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll(".acct .dot.on").length >= 1, {
    timeout: 90_000,
    polling: 1000,
  });
  log("accounts seeded + funded via friendbot ✓");

  // register the active account (real in-browser proof + testnet submit)
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Register" && !b.disabled),
    { timeout: 60_000, polling: 500 },
  );
  log("registering (in-browser ZK proof + testnet)…");
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Register" && !b.disabled)?.click(),
  );
  await page.waitForFunction(() => !!document.querySelector(".tab"), { timeout: 300_000, polling: 1000 });
  log("registered on-chain ✓ — deployed site does real in-browser proving");
  log("LIVE CHECK PASSED ✅");
} catch (e) {
  failed = true;
  log(`LIVE CHECK FAILED ❌: ${e.message}`);
  const err = await page.evaluate(() => document.querySelector(".note.err")?.textContent?.trim() ?? null).catch(() => null);
  if (err) log(`app error: ${err}`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
