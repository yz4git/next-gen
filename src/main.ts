import "./styles.css";
import { DEFAULT_CENTER, DEFAULT_RADIUS, MAX_PLATEAU_FILE_BYTES, MAX_RADIUS, MIN_RADIUS } from "./config";
import { clearWorldSeedCache } from "./data/cache";
import { createDemoWorld } from "./data/demo";
import { buildCity, type BuiltCity } from "./generation/city-builder";
import { createDriveRoute } from "./generation/road-graph";
import { formatCoordinate, parseCoordinateInput } from "./geo/coordinates";
import { clearDriveBestTimes, DriveController, type DriveButton } from "./interaction/drive-controller";
import { ExploreControls } from "./interaction/explore-controls";
import {
  createAppOnlyUrl,
  createSeedShareUrl,
  hasPreciseSeedInUrl,
  requestIsCoolingDown,
} from "./privacy";
import { WorldRenderer } from "./render/world-renderer";
import type { DriveRoute, ExploreMode, LonLat, WorldData, WorldStats, WorldStyle } from "./types";

type ExportKind = "glb" | "kit";

const canvas = required<HTMLCanvasElement>("#world-canvas");
const renderer = new WorldRenderer(canvas);
const explore = new ExploreControls(renderer.camera, renderer.orbit, canvas);
const drive = new DriveController(renderer.scene, renderer.camera);
renderer.setUpdate((delta) => {
  explore.update(delta);
  drive.update(delta);
});
renderer.onFps((fps) => { required("#metric-fps").textContent = String(fps); });
renderer.onStreaming(({ activeTiles, totalTiles }) => {
  required("#metric-tiles").textContent = `${activeTiles}/${totalTiles}`;
});
drive.onTelemetry(({ speedKph, roadName, offRoad }) => {
  required("#drive-speed").textContent = String(speedKph);
  required("#drive-road-name").textContent = roadName;
  const state = required("#drive-road-state");
  state.textContent = offRoad ? "OFF ROAD · AUTO ASSIST" : "ON ROAD";
  state.classList.toggle("off-road", offRoad);
});
drive.onChallenge(({ status, elapsedSeconds, bestSeconds, checkpoint, checkpointCount, routeLengthMeters }) => {
  required("#drive-time").textContent = formatTime(elapsedSeconds);
  required("#drive-best").textContent = bestSeconds === null ? "—" : formatTime(bestSeconds);
  required("#drive-checkpoint").textContent = `${checkpoint}/${checkpointCount}`;
  required("#drive-route-length").textContent = `${Math.round(routeLengthMeters)} m`;
  required("#drive-challenge-state").textContent = status === "ready" ? "PRESS DRIVE" : status === "running" ? "TIME ATTACK" : "FINISH";
  required("#drive-challenge").classList.toggle("is-finished", status === "finished");
});

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
let requestedMode: ExploreMode = "orbit";
let requestedRouteSeed: number | null = null;
let currentRouteSeed = 1;
let currentRoute: DriveRoute | null = null;
let initialModeApplied = false;

hydrateFromUrl();
bindUi();
void showDemo();

async function showDemo(): Promise<void> {
  abortController?.abort();
  center = parseCoordinateInput(required<HTMLInputElement>("#coordinate-input").value) ?? center;
  radius = readRadius();
  const demo = createDemoWorld(center, radius);
  await renderData(demo, false);
  if (!initialModeApplied) {
    initialModeApplied = true;
    setMode(requestedMode);
  }
  setStatus("Demo world ready", "ready");
}

async function importPlateauFile(file: File): Promise<void> {
  const input = required<HTMLInputElement>("#plateau-file");
  if (file.size > MAX_PLATEAU_FILE_BYTES) {
    input.value = "";
    showError("That CityGML file is larger than the 150 MB browser import limit. Split it by standard mesh before importing.");
    return;
  }
  abortController?.abort();
  generation += 1;
  setBusy(true, "Reading PLATEAU CityGML", "Parsing LOD1/LOD2 surfaces locally in this browser…", 18);
  setStatus("Importing local CityGML…", "busy");
  try {
    const xml = await file.text();
    setBusy(true, "Reading PLATEAU CityGML", "Building semantic surfaces and local-meter geometry…", 34);
    const { createPlateauWorld } = await import("./data/plateau");
    const world = createPlateauWorld(xml, file.name);
    center = world.center;
    radius = world.radius;
    required<HTMLInputElement>("#coordinate-input").value = formatCoordinate(center);
    required<HTMLInputElement>("#radius-input").value = String(radius);
    required<HTMLOutputElement>("#radius-output").value = radius >= 1_000 ? "1 km" : `${radius} m`;
    updateRadiusTrack();
    await renderData(world, false);
    setStatus("PLATEAU world ready", "ready");
  } catch (error) {
    showError(error instanceof Error ? error.message : "The CityGML file could not be imported.");
    setStatus(data ? readyStatus(data) : "Ready", "error");
  } finally {
    input.value = "";
    setBusy(false);
  }
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
      const progress = stage === "buildings" ? 8 : stage === "transportation" ? 18 : stage === "map" ? 27 : stage === "terrain" ? 36 : 40;
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
  explore.setCollision(built.collision, built.groundHeightAt);
  drive.setWorld(built.roadGraph, built.collision, built.groundHeightAt);
  currentRouteSeed = requestedRouteSeed ?? routeSeedForWorld(nextData);
  currentRoute = createDriveRoute(built.roadGraph, currentRouteSeed);
  drive.setRoute(currentRoute);
  const driveButton = required<HTMLButtonElement>('[data-mode="drive"]');
  driveButton.disabled = !drive.isAvailable();
  driveButton.title = drive.isAvailable() ? "Drive this city" : "No drivable road network is available";
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
  required("#plateau-import-button").addEventListener("click", () => required<HTMLInputElement>("#plateau-file").click());
  required<HTMLInputElement>("#plateau-file").addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void importPlateauFile(file);
  });
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
  required<HTMLButtonElement>("#drive-panel-toggle").addEventListener("click", () => {
    setDrivePanelOpen(!document.body.classList.contains("drive-panel-open"));
  });
  required("#drive-reset").addEventListener("click", () => drive.reset());
  required("#drive-restart").addEventListener("click", () => drive.reset());
  required("#drive-new-route").addEventListener("click", () => {
    if (!city) return;
    currentRouteSeed = nextRouteSeed(currentRouteSeed);
    requestedRouteSeed = currentRouteSeed;
    currentRoute = createDriveRoute(city.roadGraph, currentRouteSeed);
    drive.setRoute(currentRoute);
    toast("New time-attack route ready");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-drive-button]").forEach((button) => {
    const control = button.dataset.driveButton as DriveButton;
    const release = (): void => {
      button.classList.remove("is-pressed");
      drive.setButton(control, false);
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      button.classList.add("is-pressed");
      drive.setButton(control, true);
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
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
    void copyLink(createSeedShareUrl(location.href, worldCenter, worldRadius, style, {
      mode: explore.getMode(),
      routeSeed: currentRouteSeed,
    }), "Exact seed link copied");
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
    if (event.code === "Digit4") setMode("drive");
    if (event.code === "KeyR") explore.reset();
  });
  if ("serviceWorker" in navigator) window.addEventListener("load", () => void navigator.serviceWorker.register("./sw.js"));
}

function setMode(mode: ExploreMode): void {
  if (mode === "drive" && !drive.isAvailable()) {
    toast("No connected vehicle road is available in this world");
    return;
  }
  explore.setMode(mode);
  drive.setActive(mode === "drive");
  renderer.setExploreMode(mode);
  document.body.classList.toggle("is-driving", mode === "drive");
  if (mode !== "drive") setDrivePanelOpen(false);
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  const hint = required("#control-hint");
  const title = hint.querySelector("strong");
  const detail = hint.querySelector("small");
  if (title && detail) {
    title.textContent = mode === "orbit"
      ? "DRAG TO ORBIT"
      : mode === "walk"
        ? "CLICK WORLD · WASD TO WALK"
        : mode === "fly"
          ? "CLICK WORLD · WASD + Q/E TO FLY"
          : "WASD / ARROWS TO DRIVE";
    detail.textContent = mode === "orbit"
      ? "Scroll to zoom · Right-drag to pan"
      : mode === "drive"
        ? "Space to brake · R to return to the road"
        : "Mouse to look · Shift to boost · R to reset";
  }
  hint.classList.remove("is-hidden");
  required("#mobile-sticks").classList.toggle("is-visible", mode === "walk" || mode === "fly");
}

function setDrivePanelOpen(open: boolean): void {
  const toggle = required<HTMLButtonElement>("#drive-panel-toggle");
  const isOpen = open && document.body.classList.contains("is-driving");
  document.body.classList.toggle("drive-panel-open", isOpen);
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.setAttribute("aria-label", isOpen ? "Close world settings" : "Open world settings");
  const label = toggle.querySelector("strong");
  if (label) label.textContent = isOpen ? "CLOSE" : "WORLD";
}

async function runExport(kind: ExportKind, includeExactOrigin: boolean): Promise<void> {
  if (!data || !city) return;
  setStatus("Packaging world…", "busy");
  try {
    const { exportGlb, exportStarterKit } = await import("./export/world-kit");
    if (kind === "glb") await exportGlb(city.group, includeExactOrigin);
    else {
      const walkSpawn = city.collision.findOpenSpawn();
      await exportStarterKit(
        city.group,
        data,
        city.stats,
        style,
        city.manifest,
        city.roadGraph,
        currentRoute,
        { x: walkSpawn.x, y: city.groundHeightAt(walkSpawn.x, walkSpawn.z), z: walkSpawn.z },
        includeExactOrigin,
      );
    }
    const privacyLabel = includeExactOrigin ? "with exact origin" : "without exact origin";
    toast(`${kind === "glb" ? "GLB" : "Three.js kit"} downloaded ${privacyLabel}`);
  } catch (error) {
    showError(error instanceof Error ? error.message : "The export could not be created.");
  } finally {
    setStatus(readyStatus(data), "ready");
  }
}

function updateWorldUi(world: WorldData, stats: WorldStats): void {
  required("#stat-buildings").textContent = compact(stats.buildings);
  required("#stat-roads").textContent = compact(stats.roads);
  required("#stat-triangles").textContent = compact(stats.triangles);
  required("#stat-relief").textContent = `${stats.terrainRelief.toFixed(stats.terrainRelief < 10 ? 1 : 0)} m`;
  required("#stat-roofs").textContent = compact(stats.shapedRoofs);
  required("#stat-objects").textContent = compact(stats.semanticObjects);
  required("#stat-tiles").textContent = compact(stats.tiles);
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
  grade.textContent = world.isDemo
    ? "DEMO"
    : world.plateau
      ? world.plateau.lod2Buildings > 0 ? "PLATEAU LOD2" : "PLATEAU LOD1"
      : known / total > 0.65 ? "STRONG" : known / total > 0.25 ? "MIXED" : "INFERRED";
  grade.className = `quality-grade ${world.plateau || known / total > 0.65 ? "strong" : known / total > 0.25 ? "mixed" : "inferred"}`;

  const badge = required("#data-badge");
  badge.classList.toggle("demo", Boolean(world.isDemo));
  badge.classList.toggle("live", !world.isDemo && !world.plateau);
  badge.classList.toggle("plateau", Boolean(world.plateau));
  const badgeLabel = badge.querySelector("span");
  if (badgeLabel) badgeLabel.textContent = world.isDemo ? "DEMO DATA" : world.plateau ? "LOCAL PLATEAU" : "LIVE OPEN DATA";

  const links = required("#attribution-links");
  updateAttributionLinks(links, world, false);
  updateAttributionLinks(required("#viewport-attribution"), world, true);
  const sourceDetails = required("#source-details");
  sourceDetails.textContent = world.sourceDetails && world.sourceDetails.length > 0
    ? `Sources: ${world.sourceDetails.join(", ")}`
    : "";
  required("#warning-text").textContent = world.warnings.join(" ");
}

function setBusy(active: boolean, title = "Planting your seed", detail = "", progress = 0): void {
  const card = required<HTMLDivElement>("#loading-card");
  card.hidden = !active;
  document.body.classList.toggle("is-busy", active);
  document.querySelectorAll<HTMLButtonElement>("#seed-button, #demo-button, #plateau-import-button, #locate-button, [data-coordinate], [data-style], #export-glb, #export-kit").forEach((button) => {
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
  const modeParam = params.get("mode") as ExploreMode | null;
  const routeParam = Number(params.get("route"));
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
  if (["orbit", "walk", "fly", "drive"].includes(modeParam ?? "")) requestedMode = modeParam!;
  if (Number.isSafeInteger(routeParam) && routeParam > 0) requestedRouteSeed = routeParam;
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
    const driveTimes = clearDriveBestTimes();
    history.replaceState(null, "", createAppOnlyUrl(location.href));
    center = DEFAULT_CENTER;
    radius = DEFAULT_RADIUS;
    style = "low-poly";
    requestedMode = "orbit";
    requestedRouteSeed = null;
    setMode("orbit");
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
    toast(`Cleared ${worldEntries} worlds, ${driveTimes} drive times, and ${shellCaches} app caches`);
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

function readyStatus(world: WorldData): string {
  return world.isDemo ? "Demo world ready" : world.plateau ? "PLATEAU world ready" : "Live world ready";
}

function toast(message: string): void {
  const element = required("#toast");
  element.textContent = message;
  element.classList.add("is-visible");
  setTimeout(() => element.classList.remove("is-visible"), 2_200);
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function routeSeedForWorld(world: WorldData): number {
  const key = `${world.center[0].toFixed(5)}:${world.center[1].toFixed(5)}:${world.radius}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) || 1;
}

function nextRouteSeed(seed: number): number {
  return ((Math.imul(seed >>> 0, 1_664_525) + 1_013_904_223) >>> 0) || 1;
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
