import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { unzipSync, strFromU8 } from "fflate";

const canvas = document.querySelector("#world");
const drop = document.querySelector("#drop");
const fileInput = document.querySelector("#file");
const status = document.querySelector("#status");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfdde5);
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 8000);
camera.position.set(280, 210, 280);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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

const MAX_CONCURRENT_TILE_LOADS = 2;

const loader = new GLTFLoader();
const streamedTiles = new THREE.Group();
streamedTiles.name = "Streamed WorldSeed tiles";
const loadedTiles = new Map();
const pendingTiles = new Set();
const queuedTiles = new Map();
const desiredTiles = new Set();
let activeTileLoads = 0;
let activeArchive = null;
let activeGeometryIndex = null;
let lastStreamUpdate = 0;
let importGeneration = 0;

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
    const geometryMode = activeGeometryIndex ? ` · streamed ${activeGeometryIndex.tiles.length} geometry tiles` : "";
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
  const loadDistance = Math.max(360, Math.min(950, cameraDistance * 1.1));
  const unloadDistance = loadDistance + 240;
  const candidates = [];

  desiredTiles.clear();
  queuedTiles.clear();

  for (const tile of activeGeometryIndex.tiles) {
    const padding = tile.size * Math.SQRT2 / 2;
    const distance = Math.hypot(tile.centerX - focus.x, tile.centerZ - focus.z);
    if (distance <= loadDistance + padding) {
      desiredTiles.add(tile.id);
      if (!loadedTiles.has(tile.id) && !pendingTiles.has(tile.id)) {
        candidates.push({ tile, distance });
      }
    } else if (distance > unloadDistance + padding) {
      unloadGeometryTile(tile.id);
    }
  }

  candidates.sort((first, second) =>
    first.distance - second.distance
    || first.tile.z - second.tile.z
    || first.tile.x - second.tile.x);
  for (const candidate of candidates) queuedTiles.set(candidate.tile.id, candidate.tile);
  pumpGeometryQueue();
}

function pumpGeometryQueue() {
  while (activeTileLoads < MAX_CONCURRENT_TILE_LOADS && queuedTiles.size > 0) {
    const next = queuedTiles.entries().next().value;
    if (!next) return;
    const [id, tile] = next;
    queuedTiles.delete(id);
    if (!desiredTiles.has(id) || loadedTiles.has(id) || pendingTiles.has(id)) continue;
    void runGeometryTileLoad(tile, importGeneration);
  }
}

async function runGeometryTileLoad(tile, generation) {
  if (!activeArchive) return;
  const bytes = activeArchive[tile.path];
  if (!bytes) return;

  activeTileLoads += 1;
  pendingTiles.add(tile.id);
  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const gltf = await loader.parseAsync(exactArrayBuffer(bytes), "");
    if (generation !== importGeneration || !activeArchive || !desiredTiles.has(tile.id)) {
      disposeObject(gltf.scene);
      return;
    }
    gltf.scene.userData.worldseedTileId = tile.id;
    streamedTiles.add(gltf.scene);
    loadedTiles.set(tile.id, gltf.scene);
  } finally {
    pendingTiles.delete(tile.id);
    activeTileLoads = Math.max(0, activeTileLoads - 1);
    pumpGeometryQueue();
  }
}

function unloadGeometryTile(id) {
  queuedTiles.delete(id);
  const tile = loadedTiles.get(id);
  if (!tile) return;
  streamedTiles.remove(tile);
  disposeObject(tile);
  loadedTiles.delete(id);
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

function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function clearImported() {
  importGeneration += 1;
  activeArchive = null;
  activeGeometryIndex = null;
  desiredTiles.clear();
  queuedTiles.clear();
  pendingTiles.clear();
  for (const tile of loadedTiles.values()) disposeObject(tile);
  loadedTiles.clear();
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
  resize();
  controls.update();
  updateStreamedGeometry();
  renderer.render(scene, camera);
});
