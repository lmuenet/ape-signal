// Standalone reconnaissance probe for the ZenBot scanner (Blazor Server app).
//
// Why this exists: ZenBot's scan data only renders behind a live SignalR circuit
// and plain headless Chromium gets bot-detected (circuit shows "0 Online" and the
// grid stays "Loading scanner"). Run this with a stealth/headful browser to see
// whether a real circuit connects from the VPS and what the grid renders.
//
// Run it where Playwright is installed, e.g.:
//   cp /opt/ape-signal/scripts/zenbot-probe.mjs /tmp/zbprobe/
//   cd /tmp/zbprobe && xvfb-run -a node zenbot-probe.mjs /longs
//
// Optional env:
//   ZB_CDP=http://127.0.0.1:9222   connect to an already-running stealth Chrome
//                                  (connectOverCDP) instead of launching one
//   ZB_HEADLESS=1                  launch headless (default: headful → use xvfb)
//   ZB_SHOT=/tmp/zb.png            also save a screenshot for inspection
import { chromium } from "playwright";

const path = process.argv[2] || "/longs";
const url = `https://www.zenbotscanner.com${path}`;
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const log = (...a) => console.log(...a);

let browser;
let ctx;
if (process.env.ZB_CDP) {
  log(`[probe] connecting over CDP: ${process.env.ZB_CDP}`);
  browser = await chromium.connectOverCDP(process.env.ZB_CDP);
  ctx = browser.contexts()[0] || (await browser.newContext());
} else {
  browser = await chromium.launch({
    headless: process.env.ZB_HEADLESS === "1",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 }, locale: "en-US" });
}

const page = await ctx.newPage();
const jsonCalls = [];
page.on("response", (r) => {
  const u = r.url();
  const ct = r.headers()["content-type"] || "";
  if (ct.includes("json") && !u.includes("_blazor")) jsonCalls.push(`${r.status()} ${u}`);
});

log(`[probe] navigating ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

// 1) wait for the SignalR circuit to actually connect (presence > 0)
await page
  .waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes("Online") && !t.includes("0 Online");
    },
    { timeout: 45000 },
  )
  .then(() => log("[probe] circuit connected (Online > 0)"))
  .catch(() => log("[probe] circuit NOT connected (still 0 Online) — likely bot-detected"));

// 2) dismiss the welcome/disclaimer modal if present
await page.waitForTimeout(1500);
try {
  await page.click("button.btn-primary:has-text('OK')", { timeout: 4000 });
  log("[probe] dismissed OK modal");
} catch {
  /* no modal */
}

// 3) wait for the grid to stop loading
await page
  .waitForFunction(() => !document.body.innerText.includes("Loading scanner"), { timeout: 40000 })
  .then(() => log("[probe] grid finished loading"))
  .catch(() => log("[probe] grid still 'Loading scanner' after 40s"));
await page.waitForTimeout(4000);

if (process.env.ZB_SHOT) {
  await page.screenshot({ path: process.env.ZB_SHOT, fullPage: true }).catch(() => {});
  log(`[probe] screenshot saved: ${process.env.ZB_SHOT}`);
}

const text = await page.evaluate(() => document.body.innerText);
log(`\n=== BODY TEXT LENGTH ${text.length} (first 8000) ===`);
log(text.slice(0, 8000));
log(`\n=== NON-BLAZOR JSON CALLS ===`);
log(jsonCalls.join("\n") || "(none — data only via the _blazor websocket)");

await ctx.close().catch(() => {});
await browser.close().catch(() => {});
