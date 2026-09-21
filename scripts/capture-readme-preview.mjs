import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve("visual-audit/readme-preview");
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const chromeCandidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

let executablePath = null;
for (const candidate of chromeCandidates) {
  try {
    await fs.access(candidate);
    executablePath = candidate;
    break;
  } catch {}
}
if (!executablePath) throw new Error("Chrome/Chromium executable not found");

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

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push({ type: "console", text: msg.text() });
});
page.on("pageerror", (err) => errors.push({ type: "pageerror", text: String(err) }));

async function waitForDemo() {
  await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForFunction(
    () => document.querySelector("#top-status")?.textContent?.includes("Demo world ready"),
    null,
    { timeout: 60_000 },
  );
}

async function loadPreset(coordinate) {
  await page.locator(`button[data-coordinate="${coordinate}"]`).click();
  await page.waitForFunction(() => {
    const status = document.querySelector("#top-status")?.textContent || "";
    const errorCard = document.querySelector("#error-card");
    return status.includes("Live world ready") ||
      (errorCard instanceof HTMLElement && !errorCard.hidden);
  }, null, { timeout: 150_000 });
  await page.waitForTimeout(1800);
}

async function ensurePanel(open) {
  const toggle = page.locator("#drive-panel-toggle");
  if (!(await toggle.isVisible().catch(() => false))) return;
  const expanded = (await toggle.getAttribute("aria-expanded")) === "true";
  if (expanded !== open) {
    await toggle.click();
    await page.waitForTimeout(350);
  }
}

async function capture(file) {
  await page.screenshot({
    path: path.join(outDir, file),
    fullPage: false,
  });
}

async function captureLocation({ name, coordinate, prefix }) {
  await waitForDemo();
  await loadPreset(coordinate);

  await page.locator('[data-style="low-poly"]').click();
  await page.waitForTimeout(800);

  await page.locator('[data-mode="orbit"]').click();
  await page.waitForTimeout(700);
  await ensurePanel(true);
  await capture(`${prefix}-01-orbit-panel.png`);

  await ensurePanel(false);
  const canvas = page.locator("#world-canvas");
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.43, box.y + box.height * 0.36, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(450);
  }
  await capture(`${prefix}-02-orbit-clean.png`);

  await page.locator('[data-mode="drone"]').click();
  await page.waitForTimeout(1100);
  await capture(`${prefix}-03-drone-a.png`);
  await page.waitForTimeout(1700);
  await capture(`${prefix}-04-drone-b.png`);
  await page.waitForTimeout(1700);
  await capture(`${prefix}-05-drone-c.png`);

  await ensurePanel(true);
  await page.waitForTimeout(300);
  await capture(`${prefix}-06-drone-panel.png`);

  await page.locator('[data-style="cyber"]').click();
  await page.waitForTimeout(900);
  await ensurePanel(false);
  await page.locator('[data-mode="orbit"]').click();
  await page.waitForTimeout(600);
  await capture(`${prefix}-07-cyber-orbit.png`);

  await page.locator('[data-style="anime"]').click();
  await page.waitForTimeout(900);
  await capture(`${prefix}-08-anime-orbit.png`);

  const stats = await page.evaluate(() => ({
    status: document.querySelector("#top-status")?.textContent || "",
    buildings: document.querySelector("#stat-buildings")?.textContent || "",
    roads: document.querySelector("#stat-roads")?.textContent || "",
    triangles: document.querySelector("#stat-triangles")?.textContent || "",
    relief: document.querySelector("#stat-relief")?.textContent || "",
    objects: document.querySelector("#stat-objects")?.textContent || "",
  }));
  return { name, coordinate, stats };
}

const locations = [];
locations.push(await captureLocation({
  name: "Tokyo Tower",
  coordinate: "35.658581, 139.745433",
  prefix: "tokyo-tower",
}));
locations.push(await captureLocation({
  name: "Shibuya Crossing",
  coordinate: "35.659500, 139.700500",
  prefix: "shibuya",
}));

await fs.writeFile(
  path.join(outDir, "report.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), locations, errors }, null, 2),
);
console.log(JSON.stringify({ locations, errorCount: errors.length }, null, 2));

await browser.close();
