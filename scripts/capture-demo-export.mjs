import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

const outputDir = path.resolve("release-assets");
await fs.mkdir(outputDir, { recursive: true });

const candidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

let executablePath = null;
for (const candidate of candidates) {
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

const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForFunction(
  () => document.querySelector("#top-status")?.textContent?.includes("Demo world ready"),
  null,
  { timeout: 60_000 },
);

await page.locator("#export-kit").click();
await page.locator("#export-dialog").waitFor({ state: "visible" });
const includeOrigin = page.locator("#include-export-origin");
if (await includeOrigin.isChecked()) await includeOrigin.uncheck();

const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
await page.locator("#confirm-export").click();
const download = await downloadPromise;
const destination = path.join(outputDir, "worldseed-demo-export-v0.9.1.zip");
await download.saveAs(destination);

const stats = await fs.stat(destination);
if (stats.size < 1000) throw new Error(`Demo export is unexpectedly small: ${stats.size} bytes`);
console.log(`Saved ${destination} (${stats.size} bytes)`);

await browser.close();
