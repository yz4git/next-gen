import "./styles.css";
import { DEFAULT_CENTER, DEFAULT_RADIUS, MAX_RADIUS, MIN_RADIUS } from "./config";
import { createDemoWorld } from "./data/demo";
import { buildCity, type BuiltCity } from "./generation/city-builder";
import { formatCoordinate, parseCoordinateInput } from "./geo/coordinates";
import { ExploreControls } from "./interaction/explore-controls";
import { WorldRenderer } from "./render/world-renderer";
import type { ExploreMode, LonLat, WorldData, WorldStats, WorldStyle } from "./types";

const canvas = required<HTMLCanvasElement>("#world-canvas");
const renderer = new WorldRenderer(canvas);
const explore = new ExploreControls(renderer.camera, renderer.orbit, canvas);
renderer.setUpdate((delta) => explore.update(delta));
renderer.onFps((fps) => { required("#metric-fps").textContent = String(fps); });

let center: LonLat = DEFAULT_CENTER;
let radius = DEFAULT_RADIUS;
let style: WorldStyle = "low-poly";
let data: WorldData | null = null;
let city: BuiltCity | null = null;
let generation = 0;
let abortController: AbortController | null = null;

hydrateFromUrl();
bindUi();
void showDemo();

async function showDemo(): Promise<void> {
  abortController?.abort();
  center = parseCoordinateInput(required<HTMLInputElement>("#coordinate-input").value) ?? center;
  radius = readRadius();
  const demo = createDemoWorld(center, radius);
  await renderData(demo, false);
  setStatus("Demo world ready", "ready");
}

async function generateRealWorld(): Promise<void> {
  const input = required<HTMLInputElement>("#coordinate-input");
  const parsed = parseCoordinateInput(input.value);
  if (!parsed) {
    showError("Enter latitude, longitude — or paste a full Google Maps URL containing coordinates.");
    input.focus();
    return;
  }

  center = parsed;
  radius = readRadius();
  input.value = formatCoordinate(center);
  abortController?.abort();
  abortController = new AbortController();
  const run = ++generation;
  setBusy(true, "Finding buildings", "Reading Overture building tiles…", 8);
  setStatus("Growing world…", "busy");

  try {
    const { WorldDataService } = await import("./data/world-data");
    const service = new WorldDataService();
    const loaded = await service.load(center, radius, abortController.signal, ({ stage, message }) => {
      const progress = stage === "buildings" ? 10 : stage === "map" ? 24 : 38;
      setBusy(true, stage === "assemble" ? "Preparing geometry" : "Gathering open data", message, progress);
    });
    if (run !== generation) return;
    await renderData(loaded, true);
    updateUrl();
    setStatus("Live world ready", "ready");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    showError(error instanceof Error ? error.message : "The open map services did not respond.");
    setStatus("Demo world retained", "error");
  } finally {
    if (run === generation) setBusy(false);
  }
}

async function renderData(nextData: WorldData, live: boolean): Promise<void> {
  const run = ++generation;
  setBusy(true, "Building the city", "Extruding footprints into local-meter geometry…", live ? 42 : 12);
  renderer.setStyle(style, nextData.radius);
  const built = await buildCity(nextData, style, (ratio, message) => {
    setBusy(true, "Building the city", message, 42 + ratio * 52);
  });
  if (run !== generation) {
    built.group.clear();
    return;
  }
  data = nextData;
  city = built;
  renderer.setCity(built.group, nextData.radius);
  renderer.frameCity(nextData.radius);
  explore.setCollision(built.collision);
  if (explore.getMode() !== "orbit") explore.reset();
  updateWorldUi(nextData, built.stats);
  setBusy(false);
}

function bindUi(): void {
  required<HTMLFormElement>("#seed-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void generateRealWorld();
  });
  required("#demo-button").addEventListener("click", () => void showDemo());
  required("#radius-input").addEventListener("input", () => {
    radius = readRadius();
    required<HTMLOutputElement>("#radius-output").value = radius >= 1_000 ? "1 km" : `${radius} m`;
    required("#metric-radius").textContent = String(radius);
    updateRadiusTrack();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-coordinate]").forEach((button) => {
    button.addEventListener("click", () => {
      required<HTMLInputElement>("#coordinate-input").value = button.dataset.coordinate ?? "";
      void generateRealWorld();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-style]").forEach((button) => {
    button.addEventListener("click", async () => {
      const selected = button.dataset.style as WorldStyle;
      if (selected === style) return;
      style = selected;
      document.querySelectorAll("[data-style]").forEach((item) => item.classList.toggle("is-active", item === button));
      if (data) await renderData(data, !data.isDemo);
      updateUrl();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode as ExploreMode));
  });
  required("#locate-button").addEventListener("click", useLocation);
  required("#dismiss-hint").addEventListener("click", () => required("#control-hint").classList.add("is-hidden"));
  required("#error-dismiss").addEventListener("click", hideError);
  required("#snapshot-button").addEventListener("click", () => renderer.snapshot());
  required("#share-button").addEventListener("click", copyShareLink);
  required("#export-glb").addEventListener("click", () => void runExport("glb"));
  required("#export-kit").addEventListener("click", () => void runExport("kit"));
  setupStick(required("#move-stick"), (x, y) => explore.setMobileMove(x, y));
  setupStick(required("#look-stick"), (x, y) => explore.setMobileLook(x, y));
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.code === "Digit1") setMode("orbit");
    if (event.code === "Digit2") setMode("walk");
    if (event.code === "Digit3") setMode("fly");
    if (event.code === "KeyR") explore.reset();
  });
  if ("serviceWorker" in navigator) window.addEventListener("load", () => void navigator.serviceWorker.register("./sw.js"));
}

function setMode(mode: ExploreMode): void {
  explore.setMode(mode);
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  const hint = required("#control-hint");
  const title = hint.querySelector("strong");
  const detail = hint.querySelector("small");
  if (title && detail) {
    title.textContent = mode === "orbit" ? "DRAG TO ORBIT" : mode === "walk" ? "CLICK WORLD · WASD TO WALK" : "CLICK WORLD · WASD + Q/E TO FLY";
    detail.textContent = mode === "orbit" ? "Scroll to zoom · Right-drag to pan" : "Mouse to look · Shift to boost · R to reset";
  }
  hint.classList.remove("is-hidden");
  required("#mobile-sticks").classList.toggle("is-visible", mode !== "orbit");
}

async function runExport(kind: "glb" | "kit"): Promise<void> {
  if (!data || !city) return;
  setStatus("Packaging world…", "busy");
  try {
    const { exportGlb, exportStarterKit } = await import("./export/world-kit");
    if (kind === "glb") await exportGlb(city.group);
    else await exportStarterKit(city.group, data, city.stats, style);
    toast(kind === "glb" ? "GLB downloaded" : "Three.js starter kit downloaded");
  } catch (error) {
    showError(error instanceof Error ? error.message : "The export could not be created.");
  } finally {
    setStatus(data.isDemo ? "Demo world ready" : "Live world ready", "ready");
  }
}

function updateWorldUi(world: WorldData, stats: WorldStats): void {
  required("#stat-buildings").textContent = compact(stats.buildings);
  required("#stat-roads").textContent = compact(stats.roads);
  required("#stat-triangles").textContent = compact(stats.triangles);
  required("#metric-draws").textContent = String(stats.drawCalls);
  required("#metric-radius").textContent = String(world.radius);
  required("#world-coordinate").textContent = cardinalCoordinate(world.center);

  const total = Math.max(1, stats.buildings);
  const known = stats.providedHeights + stats.levelHeights;
  required("#stat-height").textContent = `${Math.round((known / total) * 100)}%`;
  required<HTMLElement>("#height-provided").style.width = `${(stats.providedHeights / total) * 100}%`;
  required<HTMLElement>("#height-levels").style.width = `${(stats.levelHeights / total) * 100}%`;
  required<HTMLElement>("#height-inferred").style.width = `${(stats.inferredHeights / total) * 100}%`;
  const grade = required("#quality-grade");
  grade.textContent = world.isDemo ? "DEMO" : known / total > 0.65 ? "STRONG" : known / total > 0.25 ? "MIXED" : "INFERRED";
  grade.className = `quality-grade ${known / total > 0.65 ? "strong" : known / total > 0.25 ? "mixed" : "inferred"}`;

  const badge = required("#data-badge");
  badge.classList.toggle("demo", Boolean(world.isDemo));
  badge.classList.toggle("live", !world.isDemo);
  const badgeLabel = badge.querySelector("span");
  if (badgeLabel) badgeLabel.textContent = world.isDemo ? "DEMO DATA" : "LIVE OPEN DATA";

  const links = required("#attribution-links");
  if (world.attributions.length === 0) {
    links.textContent = "Synthetic demonstration data";
  } else {
    links.replaceChildren(...world.attributions.flatMap((source, index) => {
      const anchor = document.createElement("a");
      anchor.href = source.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = source.label;
      return index === 0 ? [anchor] : [document.createTextNode(" + "), anchor];
    }));
  }
  const sourceDetails = required("#source-details");
  sourceDetails.textContent = world.sourceDetails && world.sourceDetails.length > 0
    ? `Footprint sources: ${world.sourceDetails.join(", ")}`
    : "";
  required("#warning-text").textContent = world.warnings.join(" ");
}

function setBusy(active: boolean, title = "Planting your seed", detail = "", progress = 0): void {
  const card = required<HTMLDivElement>("#loading-card");
  card.hidden = !active;
  document.body.classList.toggle("is-busy", active);
  if (!active) return;
  required("#loading-title").textContent = title;
  required("#loading-stage").textContent = detail;
  required<HTMLElement>("#progress-bar").style.width = `${Math.min(100, Math.max(3, progress))}%`;
}

function setStatus(message: string, state: "ready" | "busy" | "error"): void {
  required("#top-status").textContent = message;
  required("#status-pulse").className = `pulse ${state}`;
}

function showError(message: string): void {
  required("#error-message").textContent = message;
  required<HTMLDivElement>("#error-card").hidden = false;
  setBusy(false);
}

function hideError(): void {
  required<HTMLDivElement>("#error-card").hidden = true;
}

function useLocation(): void {
  if (!navigator.geolocation) {
    showError("Geolocation is not available in this browser.");
    return;
  }
  setStatus("Finding your position…", "busy");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      required<HTMLInputElement>("#coordinate-input").value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
      void generateRealWorld();
    },
    () => {
      showError("Location permission was not granted. You can still paste a coordinate.");
      setStatus(data?.isDemo ? "Demo world ready" : "Ready", "error");
    },
    { enableHighAccuracy: true, timeout: 10_000 },
  );
}

function hydrateFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const latitudeParam = params.get("lat");
  const longitudeParam = params.get("lng");
  const radiusParam = params.get("r");
  const latitude = latitudeParam === null ? Number.NaN : Number(latitudeParam);
  const longitude = longitudeParam === null ? Number.NaN : Number(longitudeParam);
  const requestedRadius = radiusParam === null ? Number.NaN : Number(radiusParam);
  const requestedStyle = params.get("style") as WorldStyle | null;
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    center = [longitude, latitude];
    required<HTMLInputElement>("#coordinate-input").value = formatCoordinate(center);
  }
  if (Number.isFinite(requestedRadius) && requestedRadius >= MIN_RADIUS && requestedRadius <= MAX_RADIUS) {
    radius = requestedRadius;
    required<HTMLInputElement>("#radius-input").value = String(radius);
    required<HTMLOutputElement>("#radius-output").value = radius >= 1_000 ? "1 km" : `${radius} m`;
  }
  updateRadiusTrack();
  if (["low-poly", "anime", "cyber", "blueprint", "quality"].includes(requestedStyle ?? "")) {
    style = requestedStyle!;
    document.querySelectorAll<HTMLButtonElement>("[data-style]").forEach((button) => button.classList.toggle("is-active", button.dataset.style === style));
  }
}

function updateUrl(): void {
  const url = new URL(location.href);
  url.searchParams.set("lat", center[1].toFixed(6));
  url.searchParams.set("lng", center[0].toFixed(6));
  url.searchParams.set("r", String(radius));
  url.searchParams.set("style", style);
  history.replaceState(null, "", url);
}

async function copyShareLink(): Promise<void> {
  updateUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Seed link copied");
  } catch {
    showError("The share link could not be copied. Copy it from the address bar instead.");
  }
}

function setupStick(element: HTMLElement, listener: (x: number, y: number) => void): void {
  let pointer: number | null = null;
  const update = (event: PointerEvent): void => {
    const bounds = element.getBoundingClientRect();
    const limit = bounds.width * 0.28;
    const x = Math.max(-limit, Math.min(limit, event.clientX - (bounds.left + bounds.width / 2)));
    const y = Math.max(-limit, Math.min(limit, event.clientY - (bounds.top + bounds.height / 2)));
    element.style.setProperty("--stick-x", `${x}px`);
    element.style.setProperty("--stick-y", `${y}px`);
    listener(x / limit, y / limit);
  };
  element.addEventListener("pointerdown", (event) => {
    pointer = event.pointerId;
    element.setPointerCapture(pointer);
    update(event);
  });
  element.addEventListener("pointermove", (event) => { if (event.pointerId === pointer) update(event); });
  const end = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    element.style.setProperty("--stick-x", "0px");
    element.style.setProperty("--stick-y", "0px");
    listener(0, 0);
  };
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
}

function readRadius(): number {
  const value = Number(required<HTMLInputElement>("#radius-input").value);
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Number.isFinite(value) ? value : DEFAULT_RADIUS));
}

function updateRadiusTrack(): void {
  const input = required<HTMLInputElement>("#radius-input");
  const value = Number(input.value);
  const percentage = ((value - MIN_RADIUS) / (MAX_RADIUS - MIN_RADIUS)) * 100;
  input.style.setProperty("--radius-progress", `${Math.max(0, Math.min(100, percentage))}%`);
}

function cardinalCoordinate(value: LonLat): string {
  const latitude = `${Math.abs(value[1]).toFixed(6)}°${value[1] >= 0 ? "N" : "S"}`;
  const longitude = `${Math.abs(value[0]).toFixed(6)}°${value[0] >= 0 ? "E" : "W"}`;
  return `${latitude} · ${longitude}`;
}

function compact(value: number): string {
  return new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function toast(message: string): void {
  const element = required("#toast");
  element.textContent = message;
  element.classList.add("is-visible");
  setTimeout(() => element.classList.remove("is-visible"), 2_200);
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
