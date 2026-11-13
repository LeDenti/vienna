// Real screenshots for the video: the dashboard and one EscrowFinish on the public explorer.
// Uses the Playwright already installed for an earlier project (set PW_MODULES), driving the installed Google Chrome.
import { createRequire } from "node:module";
const require = createRequire(process.env.PW_MODULES + "/");
const { chromium } = require("playwright");
const out = new URL("./build/", import.meta.url).pathname;
const hash = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1, locale: "en-GB" });
const p = await ctx.newPage();
await p.goto("http://localhost:8790/"); await p.waitForSelector(".card"); await p.waitForTimeout(800);
await p.screenshot({ path: out + "dashboard.png" }); console.log("dashboard.png");
await p.goto(`https://testnet.xrpl.org/transactions/${hash}`, { waitUntil: "networkidle" });
for (const t of ["Tout rejeter", "Reject All", "Reject all", "Deny"]) { const b = p.getByRole("button", { name: t }); if (await b.count()) { await b.first().click(); break; } }
await p.waitForTimeout(2500);
await p.screenshot({ path: out + "explorer_finish.png" }); console.log("explorer_finish.png");
await browser.close();
