import { strToU8, zipSync } from "fflate";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import worldseedSchema from "../../schemas/v1/worldseed.schema.json";
import worldseedObjectsSchema from "../../schemas/v1/worldseed-objects.schema.json";
import roadGraphSchema from "../../schemas/v1/road-graph.schema.json";
import spawnPointsSchema from "../../schemas/v1/spawn-points.schema.json";
import driveRouteSchema from "../../schemas/v1/drive-route.schema.json";
import { createWorldSeedIr, encodeWorldSeedIrFiles, serializeCanonicalJson } from "../ir/world-ir";
import type { DriveRoute, RoadGraph, WorldData, WorldManifest, WorldStats, WorldStyle } from "../types";

export const WORLDSEED_GEOMETRY_INDEX_FORMAT = "worldseed-geometry-index" as const;
export const WORLDSEED_GEOMETRY_INDEX_VERSION = "1" as const;

export interface WorldSeedGeometryTileDescriptor {
  id: string;
  path: string;
  detailPath?: string;
  x: number;
  z: number;
  centerX: number;
  centerZ: number;
  size: number;
  objectCount: number;
  detailObjectCount: number;
  layers: string[];
}

export interface WorldSeedGeometryIndex {
  format: typeof WORLDSEED_GEOMETRY_INDEX_FORMAT;
  version: typeof WORLDSEED_GEOMETRY_INDEX_VERSION;
  coordinateSystem: "local meters; X east, Y up, Z south";
  tiles: WorldSeedGeometryTileDescriptor[];
}

export interface WorldSeedGeometryTileGroup {
  descriptor: WorldSeedGeometryTileDescriptor;
  group: THREE.Group;
  detailGroup?: THREE.Group;
}


export async function exportGlb(
  group: THREE.Group,
  includeExactOrigin = true,
  name = includeExactOrigin ? "worldseed-city.glb" : "worldseed-city-private.glb",
): Promise<void> {
  const binary = await createGlb(group, includeExactOrigin);
  download(new Blob([binary], { type: "model/gltf-binary" }), name);
}

export async function exportStarterKit(
  group: THREE.Group,
  data: WorldData,
  stats: WorldStats,
  style: WorldStyle,
  manifest: WorldManifest,
  roadGraph: RoadGraph,
  route: DriveRoute | null,
  pedestrianSpawn: { x: number; y: number; z: number },
  includeExactOrigin = true,
): Promise<void> {
  const binary = await createGlb(group, includeExactOrigin);
  const terrainBinary = await createGlb(createTerrainExport(group), false);
  const colliderBinary = await createGlb(createColliderExport(manifest), false);
  const geometryTileFiles = await createGeometryTileArchiveFiles(group);
  const metadata = createWorldMetadata(data, stats, style, includeExactOrigin);
  const spawnPoints = createSpawnPoints(roadGraph, route, pedestrianSpawn);
  const irFiles = encodeWorldSeedIrFiles(createWorldSeedIr({
    metadata,
    manifest,
    roadGraph,
    spawnPoints,
    driveRoute: route,
  }));
  const irArchiveFiles: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(irFiles)) irArchiveFiles[path] = strToU8(text);
  const archive = zipSync(
    {
      "city.glb": new Uint8Array(binary),
      "terrain.glb": new Uint8Array(terrainBinary),
      "colliders.glb": new Uint8Array(colliderBinary),
      ...geometryTileFiles,
      ...irArchiveFiles,
      "schemas/v1/worldseed.schema.json": strToU8(JSON.stringify(worldseedSchema, null, 2)),
      "schemas/v1/worldseed-objects.schema.json": strToU8(JSON.stringify(worldseedObjectsSchema, null, 2)),
      "schemas/v1/road-graph.schema.json": strToU8(JSON.stringify(roadGraphSchema, null, 2)),
      "schemas/v1/spawn-points.schema.json": strToU8(JSON.stringify(spawnPointsSchema, null, 2)),
      "schemas/v1/drive-route.schema.json": strToU8(JSON.stringify(driveRouteSchema, null, 2)),
      "ATTRIBUTION.md": strToU8(attributionMarkdown(data)),
      "README.md": strToU8(starterReadme(includeExactOrigin)),
      "package.json": strToU8(starterPackage()),
      "index.html": strToU8(starterHtml()),
      "src/main.js": strToU8(starterMain()),
    },
    { level: 6 },
  );
  download(
    new Blob([archive], { type: "application/zip" }),
    includeExactOrigin ? "worldseed-threejs-kit.zip" : "worldseed-threejs-kit-private.zip",
  );
}

export function createWorldMetadata(
  data: WorldData,
  stats: WorldStats,
  style: WorldStyle,
  includeExactOrigin: boolean,
): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    generator: "WorldSeed 0.9.1",
    coordinateSystem: "local meters; X east, Y up, Z south",
    origin: includeExactOrigin
      ? { longitude: data.center[0], latitude: data.center[1] }
      : null,
    exactOriginIncluded: includeExactOrigin,
    radiusMeters: data.radius,
    style,
    source: data.providerLabel,
    sourceDetails: data.sourceDetails ?? [],
    generatedAt: data.generatedAt,
    stats,
    warnings: data.warnings,
    semanticManifest: "worldseed-objects.json",
    roadGraph: "road-graph.json",
    spawnPoints: "spawn-points.json",
    schemas: {
      metadata: "schemas/v1/worldseed.schema.json",
      objects: "schemas/v1/worldseed-objects.schema.json",
      roadGraph: "schemas/v1/road-graph.schema.json",
      spawnPoints: "schemas/v1/spawn-points.schema.json",
      driveRoute: "schemas/v1/drive-route.schema.json",
    },
  };
}

async function createGlb(group: THREE.Group, includeExactOrigin: boolean): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const originalUserData = group.userData;
  const streamedVisibility = new Map<THREE.Object3D, boolean>();
  group.traverse((object) => {
    if (!object.userData["worldseedTile"]) return;
    streamedVisibility.set(object, object.visible);
    object.visible = true;
  });
  group.userData = createExportUserData(originalUserData, includeExactOrigin);
  try {
    return await exporter.parseAsync(group, {
      binary: true,
      onlyVisible: true,
      trs: false,
    }) as ArrayBuffer;
  } finally {
    group.userData = originalUserData;
    for (const [object, visible] of streamedVisibility) object.visible = visible;
  }
}

export function createGeometryTileGroups(root: THREE.Object3D): {
  index: WorldSeedGeometryIndex;
  tiles: WorldSeedGeometryTileGroup[];
} {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const grouped = new Map<string, {
    tile: { id: string; x: number; z: number; centerX: number; centerZ: number; size: number };
    baseObjects: THREE.Object3D[];
    detailObjects: THREE.Object3D[];
    layers: Set<string>;
  }>();

  root.traverse((object) => {
    if (object === root) return;
    const tile = geometryTileFromUserData(object.userData["worldseedTile"]);
    if (!tile) return;
    const bucket = grouped.get(tile.id) ?? {
      tile,
      baseObjects: [],
      detailObjects: [],
      layers: new Set<string>(),
    };
    const clone = object.clone(false);
    clone.matrixAutoUpdate = false;
    clone.matrix.copy(rootInverse).multiply(object.matrixWorld);
    clone.matrixWorld.copy(clone.matrix);
    clone.visible = true;
    if (object.userData["worldseedDetail"] === true) bucket.detailObjects.push(clone);
    else bucket.baseObjects.push(clone);
    const layer = object.userData["worldseedLayer"];
    if (typeof layer === "string") bucket.layers.add(layer);
    grouped.set(tile.id, bucket);
  });

  const tiles = [...grouped.values()]
    .sort((first, second) => first.tile.z - second.tile.z || first.tile.x - second.tile.x)
    .map((bucket): WorldSeedGeometryTileGroup => {
      const group = new THREE.Group();
      group.name = `WorldSeed Tile Base ${bucket.tile.id}`;
      group.userData = {
        worldseedTile: bucket.tile,
        worldseedLod: "base",
        exactOriginIncluded: false,
      };
      for (const object of bucket.baseObjects) group.add(object);

      const detailGroup = bucket.detailObjects.length > 0 ? new THREE.Group() : undefined;
      if (detailGroup) {
        detailGroup.name = `WorldSeed Tile Detail ${bucket.tile.id}`;
        detailGroup.userData = {
          worldseedTile: bucket.tile,
          worldseedLod: "detail",
          exactOriginIncluded: false,
        };
        for (const object of bucket.detailObjects) detailGroup.add(object);
      }

      return {
        descriptor: {
          id: bucket.tile.id,
          path: geometryTilePath(bucket.tile.x, bucket.tile.z),
          ...(detailGroup ? { detailPath: geometryDetailTilePath(bucket.tile.x, bucket.tile.z) } : {}),
          x: bucket.tile.x,
          z: bucket.tile.z,
          centerX: bucket.tile.centerX,
          centerZ: bucket.tile.centerZ,
          size: bucket.tile.size,
          objectCount: bucket.baseObjects.length + bucket.detailObjects.length,
          detailObjectCount: bucket.detailObjects.length,
          layers: [...bucket.layers].sort(),
        },
        group,
        ...(detailGroup ? { detailGroup } : {}),
      };
    });

  return {
    index: {
      format: WORLDSEED_GEOMETRY_INDEX_FORMAT,
      version: WORLDSEED_GEOMETRY_INDEX_VERSION,
      coordinateSystem: "local meters; X east, Y up, Z south",
      tiles: tiles.map((tile) => tile.descriptor),
    },
    tiles,
  };
}

export function selectGeometryPrefetchTiles(
  index: WorldSeedGeometryIndex,
  x: number,
  z: number,
  directionX: number,
  directionZ: number,
  lookAheadMeters = 600,
  maximumTiles = 2,
): WorldSeedGeometryTileDescriptor[] {
  const directionLength = Math.hypot(directionX, directionZ);
  if (directionLength < 0.001 || maximumTiles <= 0) return [];
  const nx = directionX / directionLength;
  const nz = directionZ / directionLength;
  return index.tiles
    .map((tile) => {
      const offsetX = tile.centerX - x;
      const offsetZ = tile.centerZ - z;
      const forward = offsetX * nx + offsetZ * nz;
      const lateral = Math.abs(offsetX * nz - offsetZ * nx);
      return { tile, forward, lateral };
    })
    .filter(({ tile, forward, lateral }) => {
      const padding = tile.size * Math.SQRT2 / 2;
      return forward > 0 && forward <= lookAheadMeters + padding && lateral <= tile.size * 0.75;
    })
    .sort((first, second) =>
      first.forward - second.forward
      || first.lateral - second.lateral
      || first.tile.z - second.tile.z
      || first.tile.x - second.tile.x)
    .slice(0, maximumTiles)
    .map(({ tile }) => tile);
}

export function selectGeometryTiles(
  index: WorldSeedGeometryIndex,
  x: number,
  z: number,
  distanceMeters: number,
): WorldSeedGeometryTileDescriptor[] {
  if (!(distanceMeters >= 0) || !Number.isFinite(distanceMeters)) {
    throw new Error("WorldSeed geometry streaming distance must be a non-negative finite number");
  }
  return index.tiles
    .map((tile) => ({
      tile,
      distance: Math.hypot(tile.centerX - x, tile.centerZ - z),
    }))
    .filter(({ tile, distance }) => {
      const padding = tile.size * Math.SQRT2 / 2;
      return distance <= distanceMeters + padding;
    })
    .sort((first, second) =>
      first.distance - second.distance
      || first.tile.z - second.tile.z
      || first.tile.x - second.tile.x)
    .map(({ tile }) => tile);
}

async function createGeometryTileArchiveFiles(root: THREE.Object3D): Promise<Record<string, Uint8Array>> {
  const { index, tiles } = createGeometryTileGroups(root);
  const files: Record<string, Uint8Array> = {
    "worldseed-tiles.index.json": strToU8(serializeCanonicalJson(index)),
  };
  for (const tile of tiles) {
    const binary = await createGlb(tile.group, false);
    files[tile.descriptor.path] = new Uint8Array(binary);
    if (tile.detailGroup && tile.descriptor.detailPath) {
      const detailBinary = await createGlb(tile.detailGroup, false);
      files[tile.descriptor.detailPath] = new Uint8Array(detailBinary);
    }
  }
  return files;
}

function geometryTileFromUserData(value: unknown): {
  id: string;
  x: number;
  z: number;
  centerX: number;
  centerZ: number;
  size: number;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tile = value as Record<string, unknown>;
  const id = tile["id"];
  const x = tile["x"];
  const z = tile["z"];
  const centerX = tile["centerX"];
  const centerZ = tile["centerZ"];
  const size = tile["size"];
  if (
    typeof id !== "string"
    || typeof x !== "number"
    || typeof z !== "number"
    || typeof centerX !== "number"
    || typeof centerZ !== "number"
    || typeof size !== "number"
    || ![x, z, centerX, centerZ, size].every(Number.isFinite)
    || size <= 0
  ) return null;
  return { id, x, z, centerX, centerZ, size };
}

function geometryTilePath(x: number, z: number): string {
  return `worldseed-tiles/${x}_${z}.glb`;
}

function geometryDetailTilePath(x: number, z: number): string {
  return `worldseed-tiles/detail/${x}_${z}.glb`;
}

export function createExportUserData(
  userData: Record<string, unknown>,
  includeExactOrigin: boolean,
): Record<string, unknown> {
  const exportUserData: Record<string, unknown> = {
    ...userData,
    exactOriginIncluded: includeExactOrigin,
  };
  if (!includeExactOrigin) delete exportUserData["center"];
  return exportUserData;
}

function attributionMarkdown(data: WorldData): string {
  const sources = data.attributions.length === 0
    ? "- Synthetic demonstration data generated by WorldSeed."
    : data.attributions
        .map((source) => `- [${source.label}](${source.url}) — [${source.license}](${source.licenseUrl})`)
        .join("\n");
  const sourceDetails = data.sourceDetails && data.sourceDetails.length > 0
    ? `\n\nGeometry source details: ${data.sourceDetails.join(", ")}.`
    : "";
  return `# Data attribution\n\nGenerated by WorldSeed on ${data.generatedAt}.\n\n${sources}${sourceDetails}\n\nPreserve this file when redistributing the generated world. Verify source-specific obligations for your use case.\n`;
}

function starterReadme(includeExactOrigin: boolean): string {
  const originNote = includeExactOrigin
    ? "The model origin is the selected latitude/longitude."
    : "The exact latitude/longitude was intentionally omitted from this privacy-safe export.";
  return `# WorldSeed Drive Any City Starter\n\nA local-meter Three.js city and gameplay-data bundle exported by WorldSeed. The included viewer streams 300 m base geometry tiles around the current view, adds detail GLBs only at closer range, and loads matching IR chunks with base tiles.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n${originNote} X points east, Y points up, and Z points south.\n\n- city.glb — complete rendered city\n- terrain.glb — terrain-only mesh\n- colliders.glb — merged building collision boxes\n- road-graph.json — routable local-meter graph with road class, direction, surface, width, and speed\n- spawn-points.json — vehicle and pedestrian starts\n- drive-route.json — the active time-attack route, when available\n- worldseed-objects.json — stable semantic objects and bounds\n- worldseed-ir.json — unified, versioned WorldSeed intermediate representation\n- worldseed-ir.index.json — lightweight chunk index for selective loading\n- worldseed-ir/chunks/*.json — tile-local semantic, road-graph, and spawn data\n- worldseed-tiles.index.json — lightweight geometry tile index\n- worldseed-tiles/*.glb — 300 m tile-local base geometry for streaming\n- worldseed-tiles/detail/*.glb — optional close-range roofs, street furniture, markings, and other detail geometry\n- ATTRIBUTION.md — data-source obligations to preserve\n`;
}

function starterPackage(): string {
  return JSON.stringify({
    name: "worldseed-threejs-kit",
    private: true,
    type: "module",
    scripts: { dev: "vite", build: "vite build" },
    dependencies: { "idb-keyval": "^6.2.2", three: "^0.179.1" },
    devDependencies: { vite: "^7.1.3" },
  }, null, 2);
}

function starterHtml(): string {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorldSeed City</title><style>html,body,#app{height:100%;margin:0}canvas{display:block}</style></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>`;
}

function starterMain(): string {
  return `import * as THREE from "three";
import { del, get, keys, set } from "idb-keyval";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const STREAMING_BUDGETS = {
  economy: { tier: "economy", baseScale: 0.72, detailScale: 0.55, prefetchScale: 0.62, maxConcurrentLoads: 1, maxConcurrentPrefetches: 0, dprCap: 1.35 },
  balanced: { tier: "balanced", baseScale: 0.9, detailScale: 0.78, prefetchScale: 0.82, maxConcurrentLoads: 2, maxConcurrentPrefetches: 1, dprCap: 1.65 },
  quality: { tier: "quality", baseScale: 1.08, detailScale: 1, prefetchScale: 1, maxConcurrentLoads: 2, maxConcurrentPrefetches: 1, dprCap: 1.8 },
};
const PREFETCH_LOOKAHEAD_METERS = 700;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = "worldseed-kit:v1:";

let streamingState = createInitialStreamingState();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9e8ed);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, .1, 6000);
camera.position.set(300, 220, 300);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, streamingState.budget.dprCap));
document.querySelector("#app").append(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 20, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x52606d, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(-200, 400, 180);
scene.add(sun);

const loader = new GLTFLoader();
const streamedRoot = new THREE.Group();
streamedRoot.name = "WorldSeed streamed tiles";
scene.add(streamedRoot);

const loadedBaseTiles = new Map();
const loadedDetailTiles = new Map();
const pendingJobs = new Set();
const queuedJobs = new Map();
const desiredJobs = new Set();
const queuedPrefetches = new Map();
const prefetchedPaths = new Set();
let activeTileLoads = 0;
let activePrefetches = 0;
let geometryIndex = null;
let cacheNamespace = "uninitialized";
let lastStreamUpdate = 0;
let previousFocusX = null;
let previousFocusZ = null;
let movementX = 0;
let movementZ = 0;
let fpsFrames = 0;
let fpsStartedAt = performance.now();

void boot();

async function boot() {
  try {
    const metadata = await fetchJson("./worldseed.json");
    cacheNamespace = [
      metadata?.generator ?? "worldseed",
      metadata?.generatedAt ?? "unknown",
      metadata?.radiusMeters ?? "unknown",
    ].join("|");
    void pruneOldTileCaches();

    const [index, terrain] = await Promise.all([
      fetchJson("./worldseed-tiles.index.json", true),
      loadGlbCached("terrain.glb").catch(() => null),
    ]);

    if (terrain) scene.add(terrain.scene);
    if (index?.tiles?.length) {
      geometryIndex = index;
      updateStreamedTiles(true);
    } else {
      const fallback = await loadGlbCached("city.glb");
      scene.add(fallback.scene);
    }

    const radius = Number(metadata?.radiusMeters) || 500;
    const distance = Math.max(180, radius * 0.92);
    camera.position.set(distance * 0.72, Math.max(150, distance * 0.5), distance * 0.72);
    controls.target.set(0, 20, 0);
    controls.update();
    previousFocusX = controls.target.x;
    previousFocusZ = controls.target.z;
    updateStreamedTiles(true);
  } catch (error) {
    console.error("WorldSeed starter failed to load", error);
  }
}

async function fetchJson(path, nullable = false, cached = false) {
  const normalized = normalizePath(path);
  try {
    const text = cached ? await fetchTextCached(normalized) : await fetchText(normalized);
    return JSON.parse(text);
  } catch (error) {
    if (nullable) return null;
    throw error;
  }
}

async function fetchText(path) {
  const response = await fetch("./" + normalizePath(path));
  if (!response.ok) throw new Error(path + ": HTTP " + response.status);
  return await response.text();
}

async function fetchTextCached(path) {
  const normalized = normalizePath(path);
  const cached = await cacheGet(normalized);
  if (typeof cached === "string") {
    prefetchedPaths.add(normalized);
    return cached;
  }
  const text = await fetchText(normalized);
  prefetchedPaths.add(normalized);
  void cacheSet(normalized, text);
  return text;
}

async function fetchBinaryCached(path) {
  const normalized = normalizePath(path);
  const cached = await cacheGet(normalized);
  if (cached instanceof ArrayBuffer) {
    prefetchedPaths.add(normalized);
    return cached;
  }
  if (cached instanceof Uint8Array) {
    prefetchedPaths.add(normalized);
    return cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength);
  }

  const response = await fetch("./" + normalized);
  if (!response.ok) throw new Error(normalized + ": HTTP " + response.status);
  const binary = await response.arrayBuffer();
  prefetchedPaths.add(normalized);
  void cacheSet(normalized, binary);
  return binary;
}

async function loadGlbCached(path) {
  return await loader.parseAsync(await fetchBinaryCached(path), "");
}

function normalizePath(path) {
  return String(path).replace(/^\.\//, "");
}

function cacheKey(path) {
  return CACHE_PREFIX + cacheNamespace + ":" + normalizePath(path);
}

async function cacheGet(path) {
  try {
    const key = cacheKey(path);
    const record = await get(key);
    if (!record || record.expiresAt < Date.now()) {
      if (record) void del(key);
      return null;
    }
    return record.value;
  } catch {
    return null;
  }
}

async function cacheSet(path, value) {
  try {
    await set(cacheKey(path), {
      expiresAt: Date.now() + CACHE_MAX_AGE_MS,
      value,
    });
  } catch {
    // IndexedDB may be unavailable in private browsing or restrictive storage modes.
  }
}

async function pruneOldTileCaches() {
  try {
    const keepPrefix = CACHE_PREFIX + cacheNamespace + ":";
    const storedKeys = await keys();
    const stale = storedKeys.filter((key) =>
      typeof key === "string"
      && key.startsWith(CACHE_PREFIX)
      && !key.startsWith(keepPrefix));
    await Promise.all(stale.map((key) => del(key)));
  } catch {
    // Cache cleanup is best-effort.
  }
}

function updateStreamedTiles(force = false) {
  if (!geometryIndex) return;
  const now = performance.now();
  if (!force && now - lastStreamUpdate < 180) return;
  lastStreamUpdate = now;

  const focus = controls.target;
  updateMovementHint(focus.x, focus.z);

  const cameraDistance = camera.position.distanceTo(focus);
  const rawBaseDistance = Math.max(360, Math.min(950, cameraDistance * 1.1));
  const rawDetailDistance = Math.max(220, Math.min(520, rawBaseDistance * 0.62));
  const baseDistance = rawBaseDistance * streamingState.budget.baseScale;
  const detailDistance = rawDetailDistance * streamingState.budget.detailScale;
  const baseUnloadDistance = baseDistance + 240;
  const detailUnloadDistance = detailDistance + 140;
  const candidates = [];

  desiredJobs.clear();
  queuedJobs.clear();

  for (const tile of geometryIndex.tiles) {
    const padding = tile.size * Math.SQRT2 / 2;
    const distance = Math.hypot(tile.centerX - focus.x, tile.centerZ - focus.z);
    const baseKey = "base:" + tile.id;
    const detailKey = "detail:" + tile.id;

    if (distance <= baseDistance + padding) {
      desiredJobs.add(baseKey);
      if (!loadedBaseTiles.has(tile.id) && !pendingJobs.has(baseKey)) {
        candidates.push({ key: baseKey, tile, kind: "base", distance, priority: distance });
      }
    } else if (distance > baseUnloadDistance + padding) {
      unloadTileLod(tile.id, "base");
      unloadTileLod(tile.id, "detail");
    }

    if (tile.detailPath && distance <= detailDistance + padding) {
      desiredJobs.add(detailKey);
      if (!loadedDetailTiles.has(tile.id) && !pendingJobs.has(detailKey)) {
        candidates.push({ key: detailKey, tile, kind: "detail", distance, priority: distance + 90 });
      }
    } else if (distance > detailUnloadDistance + padding) {
      unloadTileLod(tile.id, "detail");
    }
  }

  candidates.sort((first, second) =>
    first.priority - second.priority
    || first.tile.z - second.tile.z
    || first.tile.x - second.tile.x);
  for (const candidate of candidates) queuedJobs.set(candidate.key, candidate);

  refreshPrefetchQueue(focus.x, focus.z, baseDistance);
  pumpTileQueue();
}

function updateMovementHint(x, z) {
  if (previousFocusX === null || previousFocusZ === null) {
    previousFocusX = x;
    previousFocusZ = z;
    return;
  }
  const dx = x - previousFocusX;
  const dz = z - previousFocusZ;
  previousFocusX = x;
  previousFocusZ = z;

  const length = Math.hypot(dx, dz);
  if (length < 1.5) return;
  const nx = dx / length;
  const nz = dz / length;
  movementX = movementX * 0.65 + nx * 0.35;
  movementZ = movementZ * 0.65 + nz * 0.35;
  const smoothedLength = Math.hypot(movementX, movementZ);
  if (smoothedLength > 0.001) {
    movementX /= smoothedLength;
    movementZ /= smoothedLength;
  }
}

function refreshPrefetchQueue(x, z, baseDistance) {
  queuedPrefetches.clear();
  const directionLength = Math.hypot(movementX, movementZ);
  if (directionLength < 0.5) return;

  const candidates = geometryIndex.tiles
    .map((tile) => {
      const offsetX = tile.centerX - x;
      const offsetZ = tile.centerZ - z;
      const forward = offsetX * movementX + offsetZ * movementZ;
      const lateral = Math.abs(offsetX * movementZ - offsetZ * movementX);
      const directDistance = Math.hypot(offsetX, offsetZ);
      return { tile, forward, lateral, directDistance };
    })
    .filter(({ tile, forward, lateral, directDistance }) => {
      const padding = tile.size * Math.SQRT2 / 2;
      return forward > Math.max(80, baseDistance * 0.55)
        && forward <= PREFETCH_LOOKAHEAD_METERS * streamingState.budget.prefetchScale + padding
        && lateral <= tile.size * 0.75
        && directDistance > baseDistance + padding
        && !loadedBaseTiles.has(tile.id)
        && !pendingJobs.has("base:" + tile.id);
    })
    .sort((first, second) =>
      first.forward - second.forward
      || first.lateral - second.lateral
      || first.tile.z - second.tile.z
      || first.tile.x - second.tile.x)
    .slice(0, 2);

  for (const candidate of candidates) {
    const glbPath = normalizePath(candidate.tile.path);
    const chunkPath = "worldseed-ir/chunks/" + candidate.tile.x + "_" + candidate.tile.z + ".json";
    if (prefetchedPaths.has(glbPath) && prefetchedPaths.has(chunkPath)) continue;
    queuedPrefetches.set(candidate.tile.id, candidate.tile);
  }
}

function pumpTileQueue() {
  while (activeTileLoads < streamingState.budget.maxConcurrentLoads && queuedJobs.size > 0) {
    const next = queuedJobs.entries().next().value;
    if (!next) return;
    const [key, job] = next;
    queuedJobs.delete(key);
    if (!desiredJobs.has(key) || pendingJobs.has(key)) continue;
    const loaded = job.kind === "detail" ? loadedDetailTiles : loadedBaseTiles;
    if (loaded.has(job.tile.id)) continue;
    void runTileLoad(job);
  }
  pumpPrefetchQueue();
}

function pumpPrefetchQueue() {
  if (
    streamingState.budget.maxConcurrentPrefetches <= 0
    || activePrefetches >= streamingState.budget.maxConcurrentPrefetches
    || activeTileLoads >= streamingState.budget.maxConcurrentLoads
    || queuedJobs.size > 0
    || queuedPrefetches.size === 0
  ) return;

  const next = queuedPrefetches.entries().next().value;
  if (!next) return;
  const [id, tile] = next;
  queuedPrefetches.delete(id);
  void runPrefetch(tile);
}

async function runPrefetch(tile) {
  activePrefetches += 1;
  const glbPath = normalizePath(tile.path);
  const chunkPath = "worldseed-ir/chunks/" + tile.x + "_" + tile.z + ".json";
  try {
    await Promise.all([
      prefetchedPaths.has(glbPath) ? Promise.resolve() : fetchBinaryCached(glbPath),
      prefetchedPaths.has(chunkPath) ? Promise.resolve() : fetchTextCached(chunkPath).catch(() => null),
    ]);
  } catch {
    // Prefetch failure is non-fatal; visible loading will retry normally.
  } finally {
    activePrefetches = Math.max(0, activePrefetches - 1);
    pumpPrefetchQueue();
  }
}

async function runTileLoad(job) {
  const key = job.kind + ":" + job.tile.id;
  const path = job.kind === "detail" ? job.tile.detailPath : job.tile.path;
  if (!path) return;

  activeTileLoads += 1;
  pendingJobs.add(key);
  try {
    const gltfPromise = loadGlbCached(path);
    const chunkPromise = job.kind === "base"
      ? fetchJson("worldseed-ir/chunks/" + job.tile.x + "_" + job.tile.z + ".json", true, true)
      : Promise.resolve(null);
    const [gltf, chunk] = await Promise.all([gltfPromise, chunkPromise]);

    if (!desiredJobs.has(key)) {
      disposeTileScene(gltf.scene);
      return;
    }

    gltf.scene.userData.worldseedTileId = job.tile.id;
    gltf.scene.userData.worldseedLod = job.kind;
    if (chunk) gltf.scene.userData.worldseedChunk = chunk;
    streamedRoot.add(gltf.scene);

    if (job.kind === "detail") loadedDetailTiles.set(job.tile.id, gltf.scene);
    else loadedBaseTiles.set(job.tile.id, gltf.scene);
  } catch (error) {
    console.warn("WorldSeed " + job.kind + " tile " + job.tile.id + " failed to load", error);
  } finally {
    pendingJobs.delete(key);
    activeTileLoads = Math.max(0, activeTileLoads - 1);
    pumpTileQueue();
  }
}

function unloadTileLod(id, kind) {
  const key = kind + ":" + id;
  queuedJobs.delete(key);
  const loaded = kind === "detail" ? loadedDetailTiles : loadedBaseTiles;
  const tile = loaded.get(id);
  if (!tile) return;
  streamedRoot.remove(tile);
  disposeTileScene(tile);
  loaded.delete(id);
}

function disposeTileScene(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });
}

function createInitialStreamingState() {
  const userAgent = navigator.userAgent || "";
  const mobile = /iPhone|iPad|iPod|Android/i.test(userAgent)
    || ((navigator.maxTouchPoints || 0) > 1 && /Macintosh/i.test(userAgent));
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory;
  const constrainedMemory = Number.isFinite(memory) && memory <= 4;
  const constrainedCpu = cores <= 4;
  const tier = mobile || constrainedMemory || constrainedCpu ? "balanced" : "quality";
  return { budget: STREAMING_BUDGETS[tier], lowFpsSamples: 0, highFpsSamples: 0 };
}

function sampleStreamingFps(fps) {
  if (!Number.isFinite(fps) || fps <= 0) return;
  const severe = fps < 36;
  const low = fps < 48;
  const high = fps >= 57;
  streamingState.lowFpsSamples = low ? streamingState.lowFpsSamples + 1 : Math.max(0, streamingState.lowFpsSamples - 1);
  streamingState.highFpsSamples = high ? streamingState.highFpsSamples + 1 : 0;

  let nextTier = streamingState.budget.tier;
  if (severe || streamingState.lowFpsSamples >= 2) {
    nextTier = nextTier === "quality" ? "balanced" : "economy";
    streamingState.lowFpsSamples = 0;
    streamingState.highFpsSamples = 0;
  } else if (streamingState.highFpsSamples >= 6) {
    nextTier = nextTier === "economy" ? "balanced" : "quality";
    streamingState.lowFpsSamples = 0;
    streamingState.highFpsSamples = 0;
  }

  if (nextTier !== streamingState.budget.tier) {
    streamingState.budget = STREAMING_BUDGETS[nextTier];
    renderer.setPixelRatio(Math.min(devicePixelRatio, streamingState.budget.dprCap));
    renderer.setSize(innerWidth, innerHeight, false);
    updateStreamedTiles(true);
  }
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  updateStreamedTiles();
  renderer.render(scene, camera);

  fpsFrames += 1;
  const now = performance.now();
  if (now - fpsStartedAt >= 800) {
    sampleStreamingFps((fpsFrames * 1000) / (now - fpsStartedAt));
    fpsFrames = 0;
    fpsStartedAt = now;
  }
});
`;
}

function createTerrainExport(group: THREE.Group): THREE.Group {
  const terrain = group.getObjectByName("Terrain") ?? group.getObjectByName("Ground");
  const exported = new THREE.Group();
  exported.name = "WorldSeed Terrain";
  exported.userData = { worldseedLayer: "terrain", exactOriginIncluded: false };
  if (terrain) exported.add(terrain.clone(true));
  return exported;
}

function createColliderExport(manifest: WorldManifest): THREE.Group {
  const geometries: THREE.BufferGeometry[] = [];
  for (const object of manifest.objects) {
    if (object.layer !== "buildings") continue;
    const [minX, minY, minZ] = object.bounds.minimum;
    const [maxX, maxY, maxZ] = object.bounds.maximum;
    const width = Math.max(0.25, maxX - minX);
    const height = Math.max(0.25, maxY - minY);
    const depth = Math.max(0.25, maxZ - minZ);
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    geometries.push(geometry);
  }
  if (geometries.length === 0) geometries.push(new THREE.BoxGeometry(0.1, 0.1, 0.1));
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());
  const root = new THREE.Group();
  root.name = "WorldSeed Colliders";
  root.userData = { schemaVersion: "1.0", colliderType: "building-aabb", exactOriginIncluded: false };
  if (merged) {
    const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: 0x7fd3ff, wireframe: true }));
    mesh.name = "Building Colliders";
    root.add(mesh);
  }
  return root;
}

function createSpawnPoints(
  roadGraph: RoadGraph,
  route: DriveRoute | null,
  pedestrianSpawn: { x: number; y: number; z: number },
): Record<string, unknown> {
  const edgeById = new Map(roadGraph.edges.map((edge) => [edge.id, edge]));
  const vehicles: Array<Record<string, unknown>> = [];
  const routeStart = route?.points[0];
  const routeNext = route?.points[1];
  if (routeStart && routeNext) {
    vehicles.push({
      id: "vehicle:time-attack",
      position: routeStart,
      headingRadians: Math.atan2(routeNext.x - routeStart.x, routeNext.z - routeStart.z),
      routeId: route?.id,
    });
  }
  for (const node of [...roadGraph.nodes].sort((first, second) => second.edgeIds.length - first.edgeIds.length)) {
    if (vehicles.length >= 8) break;
    const edge = edgeById.get(node.edgeIds[0] ?? "");
    if (!edge) continue;
    const other = edge.from === node.id ? edge.path[1] : edge.path.at(-2);
    if (!other) continue;
    vehicles.push({
      id: `vehicle:${vehicles.length + 1}`,
      position: { x: node.x, y: node.y, z: node.z },
      headingRadians: Math.atan2(other.x - node.x, other.z - node.z),
      edgeId: edge.id,
    });
  }
  return {
    schemaVersion: "1.0",
    generator: "WorldSeed 0.9.1",
    coordinateSystem: roadGraph.coordinateSystem,
    vehicles,
    pedestrians: [{ id: "pedestrian:primary", position: pedestrianSpawn }],
  };
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
