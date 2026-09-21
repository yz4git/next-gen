import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve("visual-audit/readme-preview-fast");
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const candidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
].filter(Boolean);
let executablePath = null;
for (const p of candidates) {
  try { await fs.access(p); executablePath = p; break; } catch {}
}
if (!executablePath) throw new Error("Chrome not found");

const browser = await chromium.launch({
  executablePath,
  headless: false,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=swiftshader",
  ],
});

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();

await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForFunction(
  () => document.querySelector("#top-status")?.textContent?.includes("Demo world ready"),
  null,
  { timeout: 60_000 },
);

await page.locator("#radius-input").evaluate((el) => {
  el.value = "350";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
});

await page.locator('button[data-coordinate="35.659500, 139.700500"]').click();
await page.waitForFunction(() => {
  const status = document.querySelector("#top-status")?.textContent || "";
  const errorCard = document.querySelector("#error-card");
  return status.includes("Live world ready") ||
    (errorCard instanceof HTMLElement && !errorCard.hidden);
}, null, { timeout: 120_000 });
await page.waitForTimeout(1400);

async function shot(name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
}
async function panel(open) {
  const toggle = page.locator("#drive-panel-toggle");
  if (!(await toggle.isVisible().catch(() => false))) return;
  const expanded = (await toggle.getAttribute("aria-expanded")) === "true";
  if (expanded !== open) {
    await toggle.click();
    await page.waitForTimeout(300);
  }
}

await page.locator('[data-style="low-poly"]').click();
await page.locator('[data-mode="orbit"]').click();
await page.waitForTimeout(600);
await panel(true);
await shot("shibuya-350-01-orbit-panel.png");

const canvas = page.locator("#world-canvas");
const box = await canvas.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.62);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.42, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}
await shot("shibuya-350-02-orbit-panel-angled.png");

await panel(false);
await shot("shibuya-350-03-orbit-clean.png");

await page.locator('[data-mode="drone"]').click();
await page.waitForTimeout(900);
await shot("shibuya-350-04-drone-a.png");
await page.waitForTimeout(1300);
await shot("shibuya-350-05-drone-b.png");
await page.waitForTimeout(1300);
await shot("shibuya-350-06-drone-c.png");

await panel(true);
await shot("shibuya-350-07-drone-panel.png");

await page.locator('[data-style="cyber"]').click();
await page.locator('[data-mode="orbit"]').click();
await page.waitForTimeout(700);
await panel(true);
await shot("shibuya-350-08-cyber-panel.png");

const report = await page.evaluate(() => ({
  status: document.querySelector("#top-status")?.textContent || "",
  buildings: document.querySelector("#stat-buildings")?.textContent || "",
  roads: document.querySelector("#stat-roads")?.textContent || "",
  triangles: document.querySelector("#stat-triangles")?.textContent || "",
  relief: document.querySelector("#stat-relief")?.textContent || "",
  objects: document.querySelector("#stat-objects")?.textContent || "",
}));
await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
