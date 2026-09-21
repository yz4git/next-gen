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
  try {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const metadata = readJson(archive, "worldseed.json");
    const objects = readJson(archive, "worldseed-objects.json");
    const graph = readJson(archive, "road-graph.json");
    const spawns = readJson(archive, "spawn-points.json");
    const route = readJson(archive, "drive-route.json", true);
    checkContract(metadata, objects, graph, spawns, route);

    const glb = archive["city.glb"];
    if (!glb) throw new Error("city.glb is missing");
    clearImported();
    const gltf = await new GLTFLoader().parseAsync(exactArrayBuffer(glb), "");
    imported.add(gltf.scene);
    imported.add(createRoadGraphOverlay(graph));
    imported.add(createSpawnOverlay(spawns));
    if (route) imported.add(createRouteOverlay(route));

    fitCamera(metadata.radiusMeters ?? 500);
    writeDetails(metadata, objects, graph, spawns, route);
    drop.classList.add("is-hidden");
    status.textContent = `Loaded ${file.name} · schema ${metadata.schemaVersion}`;
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
  while (imported.children.length) {
    const child = imported.children.pop();
    child?.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose?.());
      else object.material?.dispose?.();
    });
  }
}

function fitCamera(radius) {
  const distance = Math.max(180, radius * 0.92);
  camera.position.set(distance * 0.72, Math.max(150, distance * 0.5), distance * 0.72);
  controls.target.set(0, 20, 0);
  controls.update();
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
  renderer.render(scene, camera);
});
