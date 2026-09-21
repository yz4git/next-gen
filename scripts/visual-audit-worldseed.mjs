import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve("visual-audit/latest");
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const chromeCandidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
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

const report = {
  generatedAt: new Date().toISOString(),
  executablePath,
  scenarios: [],
};

async function waitReady(page) {
  await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector("#top-status")?.textContent?.includes("Demo world ready"), null, { timeout: 60_000 });
  await page.waitForTimeout(900);
}

async function collectState(page, name) {
  return await page.evaluate((scenarioName) => {
    const visible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLElement) || !visible(el)) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const canvas = document.querySelector("#world-canvas");
    let webgl = { ok: false };
    if (canvas instanceof HTMLCanvasElement) {
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (gl) {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        webgl = {
          ok: true,
          version: gl.getParameter(gl.VERSION),
          vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
          renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          drawingBufferWidth: gl.drawingBufferWidth,
          drawingBufferHeight: gl.drawingBufferHeight,
        };
      }
    }
    const overflow = [...document.querySelectorAll("body *")]
      .filter((el) => visible(el) && el instanceof HTMLElement && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2))
      .slice(0, 40)
      .map((el) => ({
        tag: el.tagName,
        id: el.id || null,
        cls: typeof el.className === "string" ? el.className.slice(0, 120) : "",
        cw: el.clientWidth, sw: el.scrollWidth, ch: el.clientHeight, sh: el.scrollHeight,
      }));
    const outsideViewport = [...document.querySelectorAll("button, input, [role=slider]")]
      .filter((el) => {
        if (!(el instanceof HTMLElement) || !visible(el)) return false;
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
      })
      .slice(0, 40)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.id || null, text: (el.textContent || "").trim().slice(0, 80), x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      });
    return {
      name: scenarioName,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      status: document.querySelector("#top-status")?.textContent || "",
      mode: [...document.querySelectorAll("[data-mode]")].find((el) => el.classList.contains("is-active"))?.getAttribute("data-mode") || "",
      webgl,
      bodyClasses: document.body.className,
      rects: {
        canvas: rect("#world-canvas"),
        seedPanel: rect("#seed-panel"),
        topbar: rect(".topbar"),
        modeRail: rect(".mode-rail"),
        driveHud: rect("#drive-hud"),
        driveControls: rect("#drive-controls"),
        panelToggle: rect("#drive-panel-toggle"),
      },
      overflow,
      outsideViewport,
      stats: {
        buildings: document.querySelector("#stat-buildings")?.textContent || "",
        roads: document.querySelector("#stat-roads")?.textContent || "",
        triangles: document.querySelector("#stat-triangles")?.textContent || "",
        fps: document.querySelector("#metric-fps")?.textContent || "",
        tiles: document.querySelector("#metric-tiles")?.textContent || "",
        speed: document.querySelector("#drive-speed")?.textContent || "",
        driveRoad: document.querySelector("#drive-road-name")?.textContent || "",
      },
    };
  }, name);
}

async function screenshot(page, scenario, file) {
  await page.screenshot({ path: path.join(outDir, file), fullPage: false });
  scenario.states.push(await collectState(page, file));
}

async function auditScenario(config) {
  const context = await browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: config.dpr,
    isMobile: config.isMobile,
    hasTouch: config.hasTouch,
    userAgent: config.userAgent,
  });
  const page = await context.newPage();
  const scenario = {
    name: config.name,
    errors: [],
    states: [],
  };
  page.on("console", (msg) => {
    if (msg.type() === "error") scenario.errors.push({ type: "console", text: msg.text() });
  });
  page.on("pageerror", (err) => scenario.errors.push({ type: "pageerror", text: String(err) }));
  page.on("requestfailed", (req) => scenario.errors.push({ type: "requestfailed", text: `${req.method()} ${req.url()} :: ${req.failure()?.errorText || ""}` }));
  page.on("response", (res) => {
    if (res.status() >= 400) scenario.errors.push({ type: "http", text: `${res.status()} ${res.url()}` });
  });

  await waitReady(page);
  await screenshot(page, scenario, `${config.prefix}-01-orbit.png`);

  const canvas = page.locator("#world-canvas");
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.52);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.42, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await screenshot(page, scenario, `${config.prefix}-02-orbit-drag.png`);
  }

  const driveButton = page.locator('[data-mode="drive"]');
  const driveDisabled = await driveButton.isDisabled().catch(() => true);
  scenario.driveAvailable = !driveDisabled;
  if (!driveDisabled) {
    await driveButton.click();
    await page.waitForTimeout(500);
    await screenshot(page, scenario, `${config.prefix}-03-drive-idle.png`);

    await page.keyboard.down("w");
    await page.waitForTimeout(1200);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(1100);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(400);
    await screenshot(page, scenario, `${config.prefix}-04-drive-turn.png`);
    await page.keyboard.up("w");

    await page.keyboard.down(" ");
    await page.waitForTimeout(650);
    await page.keyboard.up(" ");
    await page.waitForTimeout(250);
    await screenshot(page, scenario, `${config.prefix}-05-drive-brake.png`);
  }

  await page.locator('[data-mode="drone"]').click();
  await page.waitForTimeout(1800);
  await screenshot(page, scenario, `${config.prefix}-06-drone.png`);

  const toggle = page.locator("#drive-panel-toggle");
  if (await toggle.isVisible()) {
    const expanded = await toggle.getAttribute("aria-expanded");
    if (expanded !== "true") {
      await toggle.click();
      await page.waitForTimeout(250);
    }
    await screenshot(page, scenario, `${config.prefix}-07-world-panel.png`);
  }

  const quality = page.locator('[data-style="quality"]');
  if (await quality.isVisible()) {
    await quality.click();
    await page.waitForFunction(() => document.querySelector("#loading-card")?.hasAttribute("hidden"), null, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(700);
    await screenshot(page, scenario, `${config.prefix}-08-quality.png`);
  }

  report.scenarios.push(scenario);
  await context.close();
}

await auditScenario({
  name: "desktop-1280x720",
  prefix: "desktop",
  viewport: { width: 1280, height: 720 },
  dpr: 1,
  isMobile: false,
  hasTouch: false,
});

await auditScenario({
  name: "iphone-landscape-844x390",
  prefix: "iphone-landscape",
  viewport: { width: 844, height: 390 },
  dpr: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
});

await auditScenario({
  name: "iphone-portrait-390x844",
  prefix: "iphone-portrait",
  viewport: { width: 390, height: 844 },
  dpr: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
});

await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
await browser.close();

const summary = report.scenarios.map((s) => ({
  name: s.name,
  driveAvailable: s.driveAvailable,
  errors: s.errors,
  webgl: s.states[0]?.webgl,
  lastMode: s.states.at(-1)?.mode,
}));
console.log(JSON.stringify(summary, null, 2));

if (report.scenarios.some((s) => s.errors.some((e) => e.type === "pageerror" || e.type === "console"))) {
  process.exitCode = 2;
}
