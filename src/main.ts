import "./styles.css";
import { DEFAULT_CENTER, DEFAULT_RADIUS, MAX_RADIUS, MIN_RADIUS } from "./config";
import { clearWorldSeedCache } from "./data/cache";
import { createDemoWorld } from "./data/demo";
import { buildCity, type BuiltCity } from "./generation/city-builder";
import { formatCoordinate, parseCoordinateInput } from "./geo/coordinates";
import { ExploreControls } from "./interaction/explore-controls";
import {
  createAppOnlyUrl,
  createSeedShareUrl,
  hasPreciseSeedInUrl,
  requestIsCoolingDown,
} from "./privacy";
import { WorldRenderer } from "./render/world-renderer";
import type { ExploreMode, LonLat, WorldData, WorldStats, WorldStyle } from "./types";

type ExportKind = "glb" | "kit";

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
let lastLiveRequestAt = Number.NEGATIVE_INFINITY;
let pendingExportKind: ExportKind | null = null;
let clearingPrivateData = false;
let locationRequestGeneration = 0;

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

  const requestedAt = performance.now();
  if (requestIsCoolingDown(lastLiveRequestAt, requestedAt)) {
    toast("Please wait a moment before another live request");
    return;
  }
  lastLiveRequestAt = requestedAt;

  if (hasPreciseSeedInUrl(location.href)) {
    history.replaceState(null, "", createAppOnlyUrl(location.href));
    updatePrivacyUrlStatus();
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
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode as ExploreMode));
  });
  required("#locate-button").addEventListener("click", () => openDialog("location-dialog"));
  required("#confirm-location").addEventListener("click", () => {
    closeDialog("location-dialog");
    requestDeviceLocation();
  });
  required("#dismiss-hint").addEventListener("click", () => required("#control-hint").classList.add("is-hidden"));
  required("#error-dismiss").addEventListener("click", hideError);
  required("#snapshot-button").addEventListener("click", () => renderer.snapshot());
  required("#share-button").addEventListener("click", openShareDialog);
  required("#copy-app-link").addEventListener("click", () => void copyLink(createAppOnlyUrl(location.href), "App-only link copied"));
  required("#copy-seed-link").addEventListener("click", () => {
    const worldCenter = data?.center ?? center;
    const worldRadius = data?.radius ?? radius;
    void copyLink(createSeedShareUrl(location.href, worldCenter, worldRadius, style), "Exact seed link copied");
  });
  required("#export-glb").addEventListener("click", () => openExportDialog("glb"));
  required("#export-kit").addEventListener("click", () => openExportDialog("kit"));
  required("#include-export-origin").addEventListener("change", updateExportButtonLabel);
  required("#confirm-export").addEventListener("click", () => {
    if (!pendingExportKind) return;
    const kind = pendingExportKind;
    const includeExactOrigin = required<HTMLInputElement>("#include-export-origin").checked;
    closeDialog("export-dialog");
    void runExport(kind, includeExactOrigin);
  });
  document.querySelectorAll<HTMLElement>("[data-open-dialog]").forEach((button) => {
    button.addEventListener("click", () => openDialog(button.dataset.openDialog ?? ""));
  });
  document.querySelectorAll<HTMLElement>("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = button.closest<HTMLDialogElement>("dialog");
      if (dialog) closeDialog(dialog);
    });
  });
  document.querySelectorAll<HTMLDialogElement>("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });
  required("#clear-local-data").addEventListener("click", () => void clearPrivateData());
  required("#clear-private-data").addEventListener("click", () => void clearPrivateData());
  updatePrivacyUrlStatus();
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

async function runExport(kind: ExportKind, includeExactOrigin: boolean): Promise<void> {
  if (!data || !city) return;
  setStatus("Packaging world…", "busy");
  try {
    const { exportGlb, exportStarterKit } = await import("./export/world-kit");
    if (kind === "glb") await exportGlb(city.group, includeExactOrigin);
    else await exportStarterKit(city.group, data, city.stats, style, includeExactOrigin);
    const privacyLabel = includeExactOrigin ? "with exact origin" : "without exact origin";
    toast(`${kind === "glb" ? "GLB" : "Three.js kit"} downloaded ${privacyLabel}`);
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
  updateAttributionLinks(links, world, false);
  updateAttributionLinks(required("#viewport-attribution"), world, true);
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
  document.querySelectorAll<HTMLButtonElement>("#seed-button, #demo-button, #locate-button, [data-coordinate], [data-style], #export-glb, #export-kit").forEach((button) => {
    button.disabled = active;
  });
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

function requestDeviceLocation(): void {
  if (!navigator.geolocation) {
    showError("Geolocation is not available in this browser.");
    return;
  }
  const request = ++locationRequestGeneration;
  setBusy(true, "Waiting for location", "Your browser controls the permission prompt…", 8);
  setStatus("Finding your position…", "busy");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (request !== locationRequestGeneration) return;
      required<HTMLInputElement>("#coordinate-input").value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
      setBusy(false);
      void generateRealWorld();
    },
    () => {
      if (request !== locationRequestGeneration) return;
      showError("Location permission was not granted. You can still paste a coordinate.");
      setStatus(data?.isDemo ? "Demo world ready" : data ? "Live world ready" : "Ready", "error");
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

function openShareDialog(): void {
  const worldCenter = data?.center ?? center;
  required("#share-coordinate").textContent = formatCoordinate(worldCenter);
  openDialog("share-dialog");
}

async function copyLink(url: string, message: string): Promise<void> {
  try {
    await copyText(url);
    closeDialog("share-dialog");
    toast(message);
  } catch {
    closeDialog("share-dialog");
    showError("The link could not be copied. Check this browser’s clipboard permission and try again.");
  }
}

function openExportDialog(kind: ExportKind): void {
  if (!data || !city) return;
  pendingExportKind = kind;
  const label = kind === "glb" ? "GLB scene" : "Three.js starter kit";
  required("#export-dialog-title").textContent = `Export ${label}`;
  required("#export-dialog-copy").textContent = `The privacy-safe default removes ${formatCoordinate(data.center)} from file metadata.`;
  required<HTMLInputElement>("#include-export-origin").checked = false;
  updateExportButtonLabel();
  openDialog("export-dialog");
}

function updateExportButtonLabel(): void {
  const includeExactOrigin = required<HTMLInputElement>("#include-export-origin").checked;
  required("#confirm-export").textContent = includeExactOrigin ? "Export with exact origin" : "Export without origin";
}

function openDialog(id: string): void {
  if (!id) return;
  const next = required<HTMLDialogElement>(`#${id}`);
  document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((dialog) => {
    if (dialog !== next) closeDialog(dialog);
  });
  if (!next.open) next.showModal();
}

function closeDialog(dialogOrId: HTMLDialogElement | string): void {
  const dialog = typeof dialogOrId === "string"
    ? required<HTMLDialogElement>(`#${dialogOrId}`)
    : dialogOrId;
  if (dialog.open) dialog.close();
}

async function clearPrivateData(): Promise<void> {
  if (clearingPrivateData) return;
  clearingPrivateData = true;
  const clearButtons = [
    required<HTMLButtonElement>("#clear-local-data"),
    required<HTMLButtonElement>("#clear-private-data"),
  ];
  clearButtons.forEach((button) => { button.disabled = true; });
  setStatus("Clearing local data…", "busy");
  abortController?.abort();
  locationRequestGeneration += 1;

  try {
    const [worldEntries, shellCaches] = await Promise.all([
      clearWorldSeedCache(),
      clearWorldSeedShellCaches(),
    ]);
    history.replaceState(null, "", createAppOnlyUrl(location.href));
    center = DEFAULT_CENTER;
    radius = DEFAULT_RADIUS;
    style = "low-poly";
    lastLiveRequestAt = Number.NEGATIVE_INFINITY;
    required<HTMLInputElement>("#coordinate-input").value = formatCoordinate(center);
    required<HTMLInputElement>("#radius-input").value = String(radius);
    required<HTMLOutputElement>("#radius-output").value = `${radius} m`;
    document.querySelectorAll<HTMLButtonElement>("[data-style]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.style === style);
    });
    updateRadiusTrack();
    hideError();
    document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((dialog) => closeDialog(dialog));
    await showDemo();
    updatePrivacyUrlStatus();
    toast(`Cleared ${worldEntries} cached world entries and ${shellCaches} app caches`);
  } finally {
    clearingPrivateData = false;
    clearButtons.forEach((button) => { button.disabled = false; });
  }
}

async function clearWorldSeedShellCaches(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  try {
    const cacheNames = await caches.keys();
    const worldSeedCaches = cacheNames.filter(
      (name) => name.startsWith("worldseed-shell-") || name.startsWith("worldseed-sites-"),
    );
    await Promise.all(worldSeedCaches.map((name) => caches.delete(name)));
    return worldSeedCaches.length;
  } catch {
    return 0;
  }
}

function updatePrivacyUrlStatus(): void {
  const status = required("#privacy-url-status");
  const hasPreciseSeed = hasPreciseSeedInUrl(location.href);
  status.classList.toggle("has-seed", hasPreciseSeed);
  status.textContent = hasPreciseSeed
    ? "This tab’s current URL contains exact seed coordinates. Use the clear action below to remove them."
    : "This tab’s current URL contains no seed coordinates.";
}

function updateAttributionLinks(element: Element, world: WorldData, compactView: boolean): void {
  if (world.attributions.length === 0) {
    element.textContent = compactView ? "Synthetic demo · no map data" : "Synthetic demonstration data";
    return;
  }
  const nodes: Node[] = compactView ? [document.createTextNode("Data: ")] : [];
  world.attributions.forEach((source, index) => {
    if (index > 0) nodes.push(document.createTextNode(" · "));
    const anchor = document.createElement("a");
    anchor.href = source.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = source.label;
    nodes.push(anchor);
  });
  element.replaceChildren(...nodes);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  fallback.select();
  const copied = document.execCommand("copy");
  fallback.remove();
  if (!copied) throw new Error("Clipboard unavailable");
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
