import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve("visual-audit/latest");
await fs.mkdir(outDir, { recursive: true });

const chromeCandidates = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].filter(Boolean);
let executablePath = null;
for (const p of chromeCandidates) { try { await fs.access(p); executablePath = p; break; } catch {} }
if (!executablePath) throw new Error("Chrome/Chromium executable not found");

const browser = await chromium.launch({
  executablePath,
  headless: false,
  args: ["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"],
});

const report = { generatedAt: new Date().toISOString(), scenarios: [] };

async function inspectPreset(name, coordinate, prefix) {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  const result = { name, coordinate, errors: [], status: "", liveReady: false, speedSamples: [], driveAvailable: false, webgl: null };
  page.on("console", (msg) => { if (msg.type() === "error") result.errors.push({ type: "console", text: msg.text() }); });
  page.on("pageerror", (err) => result.errors.push({ type: "pageerror", text: String(err) }));
  page.on("requestfailed", (req) => result.errors.push({ type: "requestfailed", text: `${req.method()} ${req.url()} :: ${req.failure()?.errorText || ""}` }));
  page.on("response", (res) => { if (res.status() >= 400) result.errors.push({ type: "http", text: `${res.status()} ${res.url()}` }); });

  await page.goto("http://127.0.0.1:4173", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector("#top-status")?.textContent?.includes("Demo world ready"), null, { timeout: 60_000 });
  await page.locator(`button[data-coordinate="${coordinate}"]`).click();

  await page.waitForFunction(() => {
    const status = document.querySelector("#top-status")?.textContent || "";
    const err = document.querySelector("#error-card");
    return status.includes("Live world ready") || (err instanceof HTMLElement && !err.hidden);
  }, null, { timeout: 150_000 }).catch(() => {});
  await page.waitForTimeout(900);

  result.status = await page.locator("#top-status").textContent().catch(() => "");
  result.liveReady = Boolean(result.status?.includes("Live world ready"));
  result.webgl = await page.evaluate(() => {
    const canvas = document.querySelector("#world-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return { ok: false };
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { ok: false };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      ok: true,
      version: gl.getParameter(gl.VERSION),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
    };
  });
  await page.screenshot({ path: path.join(outDir, `${prefix}-01-live-panel.png`) });

  const toggle = page.locator("#drive-panel-toggle");
  if (await toggle.isVisible().catch(() => false)) {
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(outDir, `${prefix}-02-live-orbit.png`) });

  const drive = page.locator('[data-mode="drive"]');
  result.driveAvailable = !(await drive.isDisabled().catch(() => true));
  if (result.driveAvailable) {
    await drive.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, `${prefix}-03-drive-idle.png`) });

    await page.keyboard.down("w");
    for (let i = 0; i < 8; i += 1) {
      await page.waitForTimeout(400);
      result.speedSamples.push(Number((await page.locator("#drive-speed").textContent().catch(() => "0")) || 0));
    }
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(700);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(300);
    result.speedSamples.push(Number((await page.locator("#drive-speed").textContent().catch(() => "0")) || 0));
    await page.screenshot({ path: path.join(outDir, `${prefix}-04-drive-moving.png`) });
    await page.keyboard.up("w");
  }

  await page.locator('[data-mode="drone"]').click();
  await page.waitForTimeout(1700);
  await page.screenshot({ path: path.join(outDir, `${prefix}-05-drone.png`) });

  result.stats = await page.evaluate(() => ({
    buildings: document.querySelector("#stat-buildings")?.textContent || "",
    roads: document.querySelector("#stat-roads")?.textContent || "",
    triangles: document.querySelector("#stat-triangles")?.textContent || "",
    fps: document.querySelector("#metric-fps")?.textContent || "",
    tiles: document.querySelector("#metric-tiles")?.textContent || "",
    warning: document.querySelector("#warning-text")?.textContent || "",
    quality: document.querySelector("#quality-grade")?.textContent || "",
  }));

  report.scenarios.push(result);
  await context.close();
}

await inspectPreset("Osaka Castle", "34.687300, 135.526200", "live-osaka");
await inspectPreset("Shibuya Crossing", "35.659500, 139.700500", "live-shibuya");

await fs.writeFile(path.join(outDir, "report-live.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
