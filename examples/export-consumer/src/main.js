import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { unzipSync, strFromU8 } from "fflate";

const canvas = document.querySelector("#world");
const drop = document.querySelector("#drop");
const fileInput = document.querySelector("#file");
const status = document.querySelector("#status");

const STREAMING_BUDGETS = {
  economy: { tier: "economy", baseScale: 0.72, detailScale: 0.55, maxConcurrentLoads: 1, dprCap: 1.35 },
  balanced: { tier: "balanced", baseScale: 0.9, detailScale: 0.78, maxConcurrentLoads: 2, dprCap: 1.65 },
  quality: { tier: "quality", baseScale: 1.08, detailScale: 1, maxConcurrentLoads: 2, dprCap: 1.8 },
};
let streamingState = createInitialStreamingState();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfdde5);
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 8000);
camera.position.set(280, 210, 280);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, streamingState.budget.dprCap));
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 18, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x33404a, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(-250, 420, 190);
scene.add(sun);

const imported = new THREE.Group();
imported.name = "Imported WorldSeed";
scene.add(imported);

const loader = new GLTFLoader();
const streamedTiles = new THREE.Group();
streamedTiles.name = "Streamed WorldSeed tiles";
const loadedBaseTiles = new Map();
const loadedDetailTiles = new Map();
const pendingJobs = new Set();
const queuedJobs = new Map();
const uploadJobs = new Map();
const desiredJobs = new Set();
let activeTileLoads = 0;
let activeArchive = null;
let activeGeometryIndex = null;
let lastStreamUpdate = 0;
let importGeneration = 0;
let fpsFrames = 0;
let fpsStartedAt = performance.now();
let lastFrameAt = performance.now();
let deferOptionalFrames = 0;
let activeEstimatedParseMs = 0;
let renderFrameIndex = 0;
let parseCostState = {
  baseMsPerMb: 14,
  detailMsPerMb: 16,
  baseSamples: 0,
  detailSamples: 0,
};

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void importZip(file);
});
for (const event of ["dragenter", "dragover"]) {
  addEventListener(event, (e) => {
    e.preventDefault();
    drop.style.borderColor = "#b7ff59";
  });
}
for (const event of ["dragleave", "drop"]) {
  addEventListener(event, (e) => {
    e.preventDefault();
    drop.style.borderColor = "";
  });
}
addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) void importZip(file);
});

async function importZip(file) {
  status.textContent = "Reading export contract…";
  const generation = ++importGeneration;
  try {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const metadata = readJson(archive, "worldseed.json");
    const objects = readJson(archive, "worldseed-objects.json");
    const graph = readJson(archive, "road-graph.json");
    const spawns = readJson(archive, "spawn-points.json");
    const route = readJson(archive, "drive-route.json", true);
    const geometryIndex = readJson(archive, "worldseed-tiles.index.json", true);
    checkContract(metadata, objects, graph, spawns, route);

    clearImported();
    importGeneration = generation;
    activeArchive = archive;
    activeGeometryIndex = geometryIndex?.tiles?.length ? geometryIndex : null;

    if (activeGeometryIndex) {
      const terrain = archive["terrain.glb"];
      if (terrain) {
        const terrainGltf = await loader.parseAsync(exactArrayBuffer(terrain), "");
        imported.add(terrainGltf.scene);
      }
      imported.add(streamedTiles);
      updateStreamedGeometry(true);
    } else {
      const glb = archive["city.glb"];
      if (!glb) throw new Error("city.glb is missing");
      const gltf = await loader.parseAsync(exactArrayBuffer(glb), "");
      imported.add(gltf.scene);
    }

    imported.add(createRoadGraphOverlay(graph));
    imported.add(createSpawnOverlay(spawns));
    if (route) imported.add(createRouteOverlay(route));

    fitCamera(metadata.radiusMeters ?? 500);
    writeDetails(metadata, objects, graph, spawns, route);
    drop.classList.add("is-hidden");
    const detailTileCount = activeGeometryIndex?.tiles?.filter((tile) => tile.detailPath).length ?? 0;
    const geometryMode = activeGeometryIndex ? ` · streamed ${activeGeometryIndex.tiles.length} base / ${detailTileCount} detail tiles` : "";
    status.textContent = `Loaded ${file.name} · schema ${metadata.schemaVersion}${geometryMode}`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function readJson(archive, path, nullable = false) {
  const bytes = archive[path];
  if (!bytes) {
    if (nullable) return null;
    throw new Error(`${path} is missing`);
  }
  return JSON.parse(strFromU8(bytes));
}

function checkContract(metadata, objects, graph, spawns, route) {
  for (const [name, value] of [
    ["worldseed.json", metadata],
    ["worldseed-objects.json", objects],
    ["road-graph.json", graph],
    ["spawn-points.json", spawns],
  ]) {
    if (value?.schemaVersion !== "1.0") throw new Error(`${name}: unsupported schemaVersion ${value?.schemaVersion ?? "missing"}`);
  }
  if (!Array.isArray(objects.objects)) throw new Error("worldseed-objects.json: objects must be an array");
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("road-graph.json: nodes/edges must be arrays");
  if (!Array.isArray(spawns.vehicles) || !Array.isArray(spawns.pedestrians)) throw new Error("spawn-points.json: invalid spawn arrays");
  if (route && (!Array.isArray(route.points) || !Array.isArray(route.checkpoints))) throw new Error("drive-route.json: invalid route");
  const schemaPaths = metadata.schemas ?? {};
  for (const path of Object.values(schemaPaths)) {
    if (typeof path !== "string") throw new Error("worldseed.json: invalid schema path");
  }
}

function updateStreamedGeometry(force = false) {
  if (!activeArchive || !activeGeometryIndex) return;
  const now = performance.now();
  if (!force && now - lastStreamUpdate < 180) return;
  lastStreamUpdate = now;

  const focus = controls.target;
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

  for (const tile of activeGeometryIndex.tiles) {
    const padding = tile.size * Math.SQRT2 / 2;
    const distance = Math.hypot(tile.centerX - focus.x, tile.centerZ - focus.z);
    const baseKey = "base:" + tile.id;
    const detailKey = "detail:" + tile.id;

    if (distance <= baseDistance + padding) {
      desiredJobs.add(baseKey);
      if (!loadedBaseTiles.has(tile.id) && !jobIsPending(baseKey)) {
        candidates.push({ key: baseKey, tile, kind: "base", distance, priority: distance });
      }
    } else if (distance > baseUnloadDistance + padding) {
      unloadGeometryTile(tile.id, "base");
      unloadGeometryTile(tile.id, "detail");
    }

    if (tile.detailPath && distance <= detailDistance + padding) {
      desiredJobs.add(detailKey);
      if (!loadedDetailTiles.has(tile.id) && !jobIsPending(detailKey)) {
        candidates.push({ key: detailKey, tile, kind: "detail", distance, priority: distance + 90 });
      }
    } else if (distance > detailUnloadDistance + padding) {
      unloadGeometryTile(tile.id, "detail");
    }
  }

  candidates.sort((first, second) =>
    first.priority - second.priority
    || first.tile.z - second.tile.z
    || first.tile.x - second.tile.x);
  for (const candidate of candidates) queuedJobs.set(candidate.key, candidate);
  pumpGeometryQueue();
}

function jobIsPending(key) {
  return pendingJobs.has(key) || uploadJobs.has(key);
}

function pumpGeometryQueue() {
  while (queuedJobs.size > 0) {
    const next = queuedJobs.entries().next().value;
    if (!next) return;
    const [key, job] = next;

    if (!desiredJobs.has(key) || jobIsPending(key)) {
      queuedJobs.delete(key);
      continue;
    }
    if (job.kind === "detail" && !optionalWorkAllowed()) {
      queuedJobs.delete(key);
      continue;
    }

    const loaded = job.kind === "detail" ? loadedDetailTiles : loadedBaseTiles;
    if (loaded.has(job.tile.id)) {
      queuedJobs.delete(key);
      continue;
    }

    const estimatedParseMs = estimateJobParseCostMs(job);
    const costLimit = activeEstimatedParseMs >= 18
      || estimatedParseMs >= 18
      || activeEstimatedParseMs + estimatedParseMs >= 24
      ? 1
      : streamingState.budget.maxConcurrentLoads;
    if (activeTileLoads >= costLimit) break;

    queuedJobs.delete(key);
    void runGeometryTileLoad(job, importGeneration, estimatedParseMs);
  }
}

async function runGeometryTileLoad(job, generation, estimatedParseMs) {
  if (!activeArchive) return;
  const key = job.kind + ":" + job.tile.id;
  const path = job.kind === "detail" ? job.tile.detailPath : job.tile.path;
  if (!path) return;
  const bytes = activeArchive[path];
  if (!bytes) return;

  activeTileLoads += 1;
  activeEstimatedParseMs += estimatedParseMs;
  pendingJobs.add(key);
  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const parseStartedAt = performance.now();
    const gltf = await loader.parseAsync(exactArrayBuffer(bytes), "");
    recordParseCost(job.kind, bytes.byteLength, performance.now() - parseStartedAt);
    if (generation !== importGeneration || !activeArchive || !desiredJobs.has(key)) {
      disposeObject(gltf.scene);
      return;
    }
    gltf.scene.userData.worldseedTileId = job.tile.id;
    gltf.scene.userData.worldseedLod = job.kind;
    const uploadHints = collectGpuUploadHints(gltf.scene);
    const delayFrames = gpuUploadDelayFrames(uploadHints);
    uploadJobs.set(key, {
      job,
      scene: gltf.scene,
      generation,
      delayFrames,
      availableAtFrame: renderFrameIndex + delayFrames,
    });
  } finally {
    pendingJobs.delete(key);
    activeTileLoads = Math.max(0, activeTileLoads - 1);
    activeEstimatedParseMs = Math.max(0, activeEstimatedParseMs - estimatedParseMs);
    pumpGeometryQueue();
  }
}

function unloadGeometryTile(id, kind) {
  const key = kind + ":" + id;
  queuedJobs.delete(key);
  const upload = uploadJobs.get(key);
  if (upload) {
    disposeObject(upload.scene);
    uploadJobs.delete(key);
  }
  const loaded = kind === "detail" ? loadedDetailTiles : loadedBaseTiles;
  const tile = loaded.get(id);
  if (!tile) return;
  streamedTiles.remove(tile);
  disposeObject(tile);
  loaded.delete(id);
}

function createRoadGraphOverlay(graph) {
  const positions = [];
  for (const edge of graph.edges) {
    for (let i = 1; i < edge.path.length; i += 1) {
      const a = edge.path[i - 1];
      const b = edge.path[i];
      positions.push(a.x, a.y + 0.35, a.z, b.x, b.y + 0.35, b.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x6fe8ff, transparent: true, opacity: 0.42 }));
}

function createSpawnOverlay(spawns) {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(1.5, 10, 8);
  for (const spawn of spawns.vehicles ?? []) {
    const marker = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xb7ff59 }));
    marker.position.set(spawn.position.x, spawn.position.y + 2, spawn.position.z);
    group.add(marker);
  }
  for (const spawn of spawns.pedestrians ?? []) {
    const marker = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffd85f }));
    marker.scale.setScalar(0.65);
    marker.position.set(spawn.position.x, spawn.position.y + 1.2, spawn.position.z);
    group.add(marker);
  }
  return group;
}

function createRouteOverlay(route) {
  const points = route.points.map((p) => new THREE.Vector3(p.x, p.y + 0.65, p.z));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xff635e }));
}

function pumpGpuUploadQueue() {
  if (uploadJobs.size === 0) return;

  for (const [key, upload] of uploadJobs) {
    const loaded = upload.job.kind === "detail" ? loadedDetailTiles : loadedBaseTiles;
    if (
      upload.generation !== importGeneration
      || !activeArchive
      || !desiredJobs.has(key)
      || loaded.has(upload.job.tile.id)
    ) {
      disposeObject(upload.scene);
      uploadJobs.delete(key);
    }
  }

  const candidates = [...uploadJobs.entries()]
    .filter(([, upload]) =>
      renderFrameIndex >= upload.availableAtFrame
      && (upload.job.kind !== "detail" || optionalWorkAllowed()))
    .sort((first, second) =>
      first[1].job.priority - second[1].job.priority
      || first[1].job.tile.z - second[1].job.tile.z
      || first[1].job.tile.x - second[1].job.tile.x);

  let attachments = 0;
  for (const [key, upload] of candidates) {
    const heavy = upload.delayFrames > 0;
    if (heavy && attachments > 0) continue;
    if (!heavy && attachments >= 2) break;

    uploadJobs.delete(key);
    streamedTiles.add(upload.scene);
    if (upload.job.kind === "detail") loadedDetailTiles.set(upload.job.tile.id, upload.scene);
    else loadedBaseTiles.set(upload.job.tile.id, upload.scene);
    attachments += 1;

    if (heavy) break;
  }
}

function collectGpuUploadHints(root) {
  const geometries = new Set();
  const materials = new Set();
  let vertexCount = 0;
  let geometryByteLength = 0;

  root.traverse((object) => {
    const geometry = object.geometry;
    if (geometry?.isBufferGeometry && !geometries.has(geometry.uuid)) {
      geometries.add(geometry.uuid);
      const position = geometry.getAttribute("position");
      if (position) vertexCount += position.count;
      for (const attribute of Object.values(geometry.attributes)) {
        if (attribute?.array?.byteLength) geometryByteLength += attribute.array.byteLength;
      }
      const index = geometry.getIndex();
      if (index?.array?.byteLength) geometryByteLength += index.array.byteLength;
    }

    const material = object.material;
    if (Array.isArray(material)) {
      for (const item of material) if (item?.uuid) materials.add(item.uuid);
    } else if (material?.uuid) {
      materials.add(material.uuid);
    }
  });

  return { vertexCount, geometryByteLength, materialCount: materials.size };
}

function gpuUploadDelayFrames(hints) {
  if (
    hints.vertexCount >= 350_000
    || hints.geometryByteLength >= 12 * 1024 * 1024
    || hints.materialCount >= 32
  ) return 2;
  if (
    hints.vertexCount >= 180_000
    || hints.geometryByteLength >= 6 * 1024 * 1024
    || hints.materialCount >= 16
  ) return 1;
  return 0;
}

function jobByteLength(job) {
  const path = job.kind === "detail" ? job.tile.detailPath : job.tile.path;
  const archiveBytes = path && activeArchive ? activeArchive[path] : null;
  if (archiveBytes?.byteLength > 0) return archiveBytes.byteLength;
  const value = job.kind === "detail" ? job.tile.detailByteLength : job.tile.byteLength;
  return Number.isFinite(value) && value > 0 ? value : 1_500_000;
}

function estimateJobParseCostMs(job) {
  const bytes = jobByteLength(job);
  const megabytes = Math.max(0.15, bytes / (1024 * 1024));
  const rate = job.kind === "detail" ? parseCostState.detailMsPerMb : parseCostState.baseMsPerMb;
  return Math.max(1, megabytes * rate);
}

function recordParseCost(kind, byteLength, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
  const megabytes = Math.max(0.15, byteLength / (1024 * 1024));
  const sampleRate = Math.min(180, Math.max(2, elapsedMs / megabytes));
  const alpha = 0.35;
  if (kind === "detail") {
    parseCostState.detailMsPerMb = parseCostState.detailSamples === 0
      ? sampleRate
      : parseCostState.detailMsPerMb * (1 - alpha) + sampleRate * alpha;
    parseCostState.detailSamples += 1;
  } else {
    parseCostState.baseMsPerMb = parseCostState.baseSamples === 0
      ? sampleRate
      : parseCostState.baseMsPerMb * (1 - alpha) + sampleRate * alpha;
    parseCostState.baseSamples += 1;
  }
}

function sampleFrameTime(frameTimeMs) {
  if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0) return;
  if (frameTimeMs >= 45) deferOptionalFrames = Math.max(deferOptionalFrames, 24);
  else if (frameTimeMs >= 28) deferOptionalFrames = Math.max(deferOptionalFrames, 10);
  else if (frameTimeMs <= 20) deferOptionalFrames = Math.max(0, deferOptionalFrames - 2);
  else deferOptionalFrames = Math.max(0, deferOptionalFrames - 1);
}

function optionalWorkAllowed() {
  return deferOptionalFrames <= 0;
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
    updateStreamedGeometry(true);
  }
}

function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function clearImported() {
  importGeneration += 1;
  activeArchive = null;
  activeGeometryIndex = null;
  desiredJobs.clear();
  queuedJobs.clear();
  pendingJobs.clear();
  for (const upload of uploadJobs.values()) disposeObject(upload.scene);
  uploadJobs.clear();
  for (const tile of loadedBaseTiles.values()) disposeObject(tile);
  for (const tile of loadedDetailTiles.values()) disposeObject(tile);
  loadedBaseTiles.clear();
  loadedDetailTiles.clear();
  streamedTiles.clear();
  while (imported.children.length) {
    const child = imported.children.pop();
    if (child) disposeObject(child);
  }
}

function disposeObject(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });
}

function fitCamera(radius) {
  const distance = Math.max(180, radius * 0.92);
  camera.position.set(distance * 0.72, Math.max(150, distance * 0.5), distance * 0.72);
  controls.target.set(0, 20, 0);
  controls.update();
  updateStreamedGeometry(true);
}

function writeDetails(metadata, objects, graph, spawns, route) {
  setText("schema", metadata.schemaVersion);
  setText("generator", metadata.generator);
  setText("buildings", metadata.stats?.buildings ?? "—");
  setText("roads", graph.edges.length);
  setText("objects", objects.objects.length);
  setText("spawns", spawns.vehicles.length);
  setText("route", route ? `${Math.round(route.lengthMeters)} m` : "none");
}

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = String(value);
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  if (canvas.width !== clientWidth || canvas.height !== clientHeight) {
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = Math.max(0.01, clientWidth / Math.max(1, clientHeight));
    camera.updateProjectionMatrix();
  }
}
renderer.setAnimationLoop(() => {
  renderFrameIndex += 1;
  const frameNow = performance.now();
  sampleFrameTime(frameNow - lastFrameAt);
  lastFrameAt = frameNow;

  resize();
  controls.update();
  updateStreamedGeometry();
  pumpGpuUploadQueue();
  renderer.render(scene, camera);

  fpsFrames += 1;
  const now = performance.now();
  if (now - fpsStartedAt >= 800) {
    sampleStreamingFps((fpsFrames * 1000) / (now - fpsStartedAt));
    fpsFrames = 0;
    fpsStartedAt = now;
  }
});
