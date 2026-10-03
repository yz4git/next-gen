import { strToU8, zipSync } from "fflate";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import worldseedSchema from "../../schemas/v1/worldseed.schema.json";
import worldseedObjectsSchema from "../../schemas/v1/worldseed-objects.schema.json";
import roadGraphSchema from "../../schemas/v1/road-graph.schema.json";
import spawnPointsSchema from "../../schemas/v1/spawn-points.schema.json";
import driveRouteSchema from "../../schemas/v1/drive-route.schema.json";
import {
  createWorldSeedIr,
  createWorldSeedIrDependencyGraph,
  createWorldSeedIrChunkSet,
  encodeWorldSeedIrFiles,
  encodeWorldSeedIrPatchFiles,
  serializeCanonicalJson,
  type WorldSeedIrDependencyGraph,
  type WorldSeedIrIndex,
  type WorldSeedIrPatchManifest,
} from "../ir/world-ir";
import type { DriveRoute, RoadGraph, WorldData, WorldManifest, WorldStats, WorldStyle } from "../types";

export const WORLDSEED_GEOMETRY_INDEX_FORMAT = "worldseed-geometry-index" as const;
export const WORLDSEED_GEOMETRY_PATCH_FORMAT = "worldseed-geometry-patch" as const;
export const WORLDSEED_INCREMENTAL_PATCH_FORMAT = "worldseed-incremental-patch" as const;
export const WORLDSEED_BUILD_STATE_FORMAT = "worldseed-build-state" as const;
export const WORLDSEED_GEOMETRY_INDEX_VERSION = "1" as const;
export const WORLDSEED_GEOMETRY_RECIPE_VERSION = "1" as const;

export interface WorldSeedGeometryTileDescriptor {
  id: string;
  path: string;
  detailPath?: string;
  byteLength?: number;
  detailByteLength?: number;
  vertexCount?: number;
  detailVertexCount?: number;
  geometryByteLength?: number;
  detailGeometryByteLength?: number;
  materialCount?: number;
  detailMaterialCount?: number;
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
  recipeVersion?: string;
  coordinateSystem: "local meters; X east, Y up, Z south";
  tiles: WorldSeedGeometryTileDescriptor[];
}

export interface WorldSeedGeometryTileGroup {
  descriptor: WorldSeedGeometryTileDescriptor;
  group: THREE.Group;
  detailGroup?: THREE.Group;
}

export interface WorldSeedGeometryPatchTile {
  id: string;
  path: string;
  detailPath?: string;
}

export interface WorldSeedGeometryPatchRemoval {
  id: string;
  paths: string[];
}

export interface WorldSeedGeometryPatchManifest {
  format: typeof WORLDSEED_GEOMETRY_PATCH_FORMAT;
  version: typeof WORLDSEED_GEOMETRY_INDEX_VERSION;
  fromIrRevisionHash: string | null;
  toIrRevisionHash: string | null;
  regenerated: WorldSeedGeometryPatchTile[];
  removed: WorldSeedGeometryPatchRemoval[];
  reusedCount: number;
}

export interface WorldSeedGeometryIncrementalPlan {
  manifest: WorldSeedGeometryPatchManifest;
  regenerateTileIds: Set<string>;
  reusedTileIds: Set<string>;
}

export interface WorldSeedIncrementalBase {
  irIndex: WorldSeedIrIndex;
  geometryIndex: WorldSeedGeometryIndex;
  dependencyGraph?: WorldSeedIrDependencyGraph;
}

export interface WorldSeedBuildState extends WorldSeedIncrementalBase {
  format: typeof WORLDSEED_BUILD_STATE_FORMAT;
  version: typeof WORLDSEED_GEOMETRY_INDEX_VERSION;
  dependencyGraph: WorldSeedIrDependencyGraph;
}

export function createWorldSeedBuildState(
  document: ReturnType<typeof createWorldSeedIr>,
  geometryIndex: WorldSeedGeometryIndex,
): WorldSeedBuildState {
  const { index: irIndex } = createWorldSeedIrChunkSet(document);
  return {
    format: WORLDSEED_BUILD_STATE_FORMAT,
    version: WORLDSEED_GEOMETRY_INDEX_VERSION,
    irIndex,
    dependencyGraph: createWorldSeedIrDependencyGraph(document),
    geometryIndex,
  };
}

export function parseWorldSeedBuildState(input: string | unknown): WorldSeedBuildState {
  const value = typeof input === "string" ? JSON.parse(input) as unknown : input;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("WorldSeed build state must be an object");
  }
  const state = value as Partial<WorldSeedBuildState>;
  if (state.format !== WORLDSEED_BUILD_STATE_FORMAT || state.version !== WORLDSEED_GEOMETRY_INDEX_VERSION) {
    throw new Error("Unsupported WorldSeed build state");
  }
  if (state.irIndex?.format !== "worldseed-ir-index" || state.irIndex.version !== "1") {
    throw new Error("WorldSeed build state has an unsupported IR index");
  }
  if (state.geometryIndex?.format !== WORLDSEED_GEOMETRY_INDEX_FORMAT || state.geometryIndex.version !== "1") {
    throw new Error("WorldSeed build state has an unsupported geometry index");
  }
  if (state.dependencyGraph?.format !== "worldseed-ir-dependencies" || state.dependencyGraph.version !== "1") {
    throw new Error("WorldSeed build state has an unsupported dependency graph");
  }
  return state as WorldSeedBuildState;
}


export interface WorldSeedIncrementalPatchManifest {
  format: typeof WORLDSEED_INCREMENTAL_PATCH_FORMAT;
  version: typeof WORLDSEED_GEOMETRY_INDEX_VERSION;
  fromRevisionHash: string | null;
  toRevisionHash: string | null;
  irPatchPath: "worldseed-ir.patch.json";
  geometryPatchPath: "worldseed-tiles.patch.json";
  compatibilityFallbackNeedsRefresh: boolean;
  includedGlobalFiles: string[];
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
  const irDocument = createWorldSeedIr({
    metadata,
    manifest,
    roadGraph,
    spawnPoints,
    driveRoute: route,
  });
  const irFiles = encodeWorldSeedIrFiles(irDocument);
  const buildState = createWorldSeedBuildState(
    irDocument,
    createGeometryTileGroups(group).index,
  );
  const irArchiveFiles: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(irFiles)) irArchiveFiles[path] = strToU8(text);
  irArchiveFiles["worldseed-build-state.json"] = strToU8(serializeCanonicalJson(buildState));
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

export async function createWorldSeedIncrementalPatchArchive(
  group: THREE.Group,
  data: WorldData,
  stats: WorldStats,
  style: WorldStyle,
  manifest: WorldManifest,
  roadGraph: RoadGraph,
  route: DriveRoute | null,
  pedestrianSpawn: { x: number; y: number; z: number },
  previous: WorldSeedIncrementalBase,
  includeExactOrigin = true,
): Promise<Uint8Array> {
  const metadata = createWorldMetadata(data, stats, style, includeExactOrigin);
  const spawnPoints = createSpawnPoints(roadGraph, route, pedestrianSpawn);
  const document = createWorldSeedIr({
    metadata,
    manifest,
    roadGraph,
    spawnPoints,
    driveRoute: route,
  });
  const irPatch = encodeWorldSeedIrPatchFiles(
    document,
    previous.irIndex,
    undefined,
    previous.dependencyGraph,
  );
  const geometryPatch = await createGeometryTilePatchArchiveFiles(
    group,
    previous.geometryIndex,
    irPatch.patch,
  );

  const files: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(irPatch.files)) files[path] = strToU8(text);
  Object.assign(files, geometryPatch.files);
  const nextBuildState: WorldSeedBuildState = {
    format: WORLDSEED_BUILD_STATE_FORMAT,
    version: WORLDSEED_GEOMETRY_INDEX_VERSION,
    irIndex: irPatch.index,
    dependencyGraph: irPatch.dependencyGraph,
    geometryIndex: geometryPatch.index,
  };
  files["worldseed-build-state.json"] = strToU8(serializeCanonicalJson(nextBuildState));

  const touchedIrChunks = irPatch.patch.added.length
    + irPatch.patch.changed.length
    + irPatch.patch.removed.length;
  const impactedArtifacts = new Set(irPatch.dependencyDiff?.impactedArtifacts ?? []);
  const includedGlobalFiles: string[] = [];
  const collidersChanged = irPatch.dependencyDiff
    ? impactedArtifacts.has("artifact:colliders")
    : touchedIrChunks > 0;
  if (collidersChanged) {
    const colliderBinary = await createGlb(createColliderExport(manifest), false);
    files["colliders.glb"] = new Uint8Array(colliderBinary);
    includedGlobalFiles.push("colliders.glb");
  }
  if (irPatch.patch.geometryGlobalChanged) {
    const terrainBinary = await createGlb(createTerrainExport(group), false);
    files["terrain.glb"] = new Uint8Array(terrainBinary);
    includedGlobalFiles.push("terrain.glb");
  }

  const patchManifest: WorldSeedIncrementalPatchManifest = {
    format: WORLDSEED_INCREMENTAL_PATCH_FORMAT,
    version: WORLDSEED_GEOMETRY_INDEX_VERSION,
    fromRevisionHash: irPatch.patch.fromRevisionHash,
    toRevisionHash: irPatch.patch.toRevisionHash,
    irPatchPath: "worldseed-ir.patch.json",
    geometryPatchPath: "worldseed-tiles.patch.json",
    compatibilityFallbackNeedsRefresh:
      geometryPatch.patch.regenerated.length > 0
      || geometryPatch.patch.removed.length > 0,
    includedGlobalFiles,
  };
  files["worldseed.patch.json"] = strToU8(serializeCanonicalJson(patchManifest));

  return zipSync(files, { level: 6 });
}

export async function exportWorldSeedIncrementalPatch(
  group: THREE.Group,
  data: WorldData,
  stats: WorldStats,
  style: WorldStyle,
  manifest: WorldManifest,
  roadGraph: RoadGraph,
  route: DriveRoute | null,
  pedestrianSpawn: { x: number; y: number; z: number },
  previous: WorldSeedIncrementalBase,
  includeExactOrigin = true,
): Promise<void> {
  const archive = await createWorldSeedIncrementalPatchArchive(
    group,
    data,
    stats,
    style,
    manifest,
    roadGraph,
    route,
    pedestrianSpawn,
    previous,
    includeExactOrigin,
  );
  const archiveBytes = Uint8Array.from(archive);
  download(
    new Blob([archiveBytes.buffer], { type: "application/zip" }),
    includeExactOrigin ? "worldseed-patch.zip" : "worldseed-patch-private.zip",
  );
}

export function createCurrentWorldSeedBuildState(
  group: THREE.Object3D,
  data: WorldData,
  stats: WorldStats,
  style: WorldStyle,
  manifest: WorldManifest,
  roadGraph: RoadGraph,
  route: DriveRoute | null,
  pedestrianSpawn: { x: number; y: number; z: number },
  includeExactOrigin = false,
): WorldSeedBuildState {
  const metadata = createWorldMetadata(data, stats, style, includeExactOrigin);
  const spawnPoints = createSpawnPoints(roadGraph, route, pedestrianSpawn);
  const document = createWorldSeedIr({
    metadata,
    manifest,
    roadGraph,
    spawnPoints,
    driveRoute: route,
  });
  const { index: geometryIndex } = createGeometryTileGroups(group);
  return createWorldSeedBuildState(document, geometryIndex);
}

export function exportWorldSeedBuildState(
  group: THREE.Object3D,
  data: WorldData,
  stats: WorldStats,
  style: WorldStyle,
  manifest: WorldManifest,
  roadGraph: RoadGraph,
  route: DriveRoute | null,
  pedestrianSpawn: { x: number; y: number; z: number },
): void {
  const state = createCurrentWorldSeedBuildState(
    group,
    data,
    stats,
    style,
    manifest,
    roadGraph,
    route,
    pedestrianSpawn,
    false,
  );
  download(
    new Blob([serializeCanonicalJson(state)], { type: "application/json" }),
    "worldseed-build-state.json",
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
          ...geometryUploadStats(group),
          ...(detailGroup ? prefixDetailGeometryStats(geometryUploadStats(detailGroup)) : {}),
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
      recipeVersion: WORLDSEED_GEOMETRY_RECIPE_VERSION,
      coordinateSystem: "local meters; X east, Y up, Z south",
      tiles: tiles.map((tile) => tile.descriptor),
    },
    tiles,
  };
}

export function createGeometryIncrementalPlan(
  previous: WorldSeedGeometryIndex,
  next: WorldSeedGeometryIndex,
  irPatch: WorldSeedIrPatchManifest,
  forceTileIds: Iterable<string> = [],
): WorldSeedGeometryIncrementalPlan {
  const previousById = new Map(previous.tiles.map((tile) => [tile.id, tile]));
  const nextById = new Map(next.tiles.map((tile) => [tile.id, tile]));
  const dependencyGeometryIds = irPatch.dependencyDiff
    ? irPatch.dependencyDiff.impactedArtifacts
      .filter((id) => id.startsWith("artifact:geometry:"))
      .map((id) => id.slice("artifact:geometry:".length))
    : null;
  const touched = new Set([
    ...(dependencyGeometryIds ?? [
      ...irPatch.added.map((chunk) => chunk.id),
      ...irPatch.changed.map((chunk) => chunk.id),
    ]),
    ...forceTileIds,
  ]);
  if (irPatch.geometryGlobalChanged) {
    for (const tile of next.tiles) touched.add(tile.id);
  }
  const regenerateTileIds = new Set<string>();
  const reusedTileIds = new Set<string>();
  const recipeChanged =
    !previous.recipeVersion
    || !next.recipeVersion
    || previous.recipeVersion !== next.recipeVersion;

  for (const tile of next.tiles) {
    const before = previousById.get(tile.id);
    const structureChanged = before
      ? before.path !== tile.path
        || before.detailPath !== tile.detailPath
        || before.objectCount !== tile.objectCount
        || before.detailObjectCount !== tile.detailObjectCount
        || serializeCanonicalJson(before.layers, false) !== serializeCanonicalJson(tile.layers, false)
      : true;

    if (recipeChanged || touched.has(tile.id) || structureChanged) regenerateTileIds.add(tile.id);
    else reusedTileIds.add(tile.id);
  }

  const removed: WorldSeedGeometryPatchRemoval[] = [];
  for (const tile of previous.tiles) {
    const after = nextById.get(tile.id);
    if (!after) {
      removed.push({
        id: tile.id,
        paths: [tile.path, ...(tile.detailPath ? [tile.detailPath] : [])],
      });
      continue;
    }
    if (regenerateTileIds.has(tile.id) && tile.detailPath && !after.detailPath) {
      removed.push({ id: tile.id, paths: [tile.detailPath] });
    }
  }

  const regenerated = next.tiles
    .filter((tile) => regenerateTileIds.has(tile.id))
    .map((tile) => ({
      id: tile.id,
      path: tile.path,
      ...(tile.detailPath ? { detailPath: tile.detailPath } : {}),
    }))
    .sort((first, second) => first.id.localeCompare(second.id));

  removed.sort((first, second) => first.id.localeCompare(second.id));

  return {
    manifest: {
      format: WORLDSEED_GEOMETRY_PATCH_FORMAT,
      version: WORLDSEED_GEOMETRY_INDEX_VERSION,
      fromIrRevisionHash: irPatch.fromRevisionHash,
      toIrRevisionHash: irPatch.toRevisionHash,
      regenerated,
      removed,
      reusedCount: reusedTileIds.size,
    },
    regenerateTileIds,
    reusedTileIds,
  };
}

export async function createGeometryTilePatchArchiveFiles(
  root: THREE.Object3D,
  previous: WorldSeedGeometryIndex,
  irPatch: WorldSeedIrPatchManifest,
  forceTileIds: Iterable<string> = [],
): Promise<{
  index: WorldSeedGeometryIndex;
  patch: WorldSeedGeometryPatchManifest;
  files: Record<string, Uint8Array>;
}> {
  const { index, tiles } = createGeometryTileGroups(root);
  const plan = createGeometryIncrementalPlan(previous, index, irPatch, forceTileIds);
  const previousById = new Map(previous.tiles.map((tile) => [tile.id, tile]));
  const files: Record<string, Uint8Array> = {};

  for (const tile of tiles) {
    if (plan.reusedTileIds.has(tile.descriptor.id)) {
      const before = previousById.get(tile.descriptor.id);
      if (before) {
        tile.descriptor.byteLength = before.byteLength;
        tile.descriptor.detailByteLength = before.detailByteLength;
      }
      continue;
    }
    if (!plan.regenerateTileIds.has(tile.descriptor.id)) continue;

    const binary = await createGlb(tile.group, false);
    tile.descriptor.byteLength = binary.byteLength;
    files[tile.descriptor.path] = new Uint8Array(binary);
    if (tile.detailGroup && tile.descriptor.detailPath) {
      const detailBinary = await createGlb(tile.detailGroup, false);
      tile.descriptor.detailByteLength = detailBinary.byteLength;
      files[tile.descriptor.detailPath] = new Uint8Array(detailBinary);
    }
  }

  files["worldseed-tiles.index.json"] = strToU8(serializeCanonicalJson(index));
  files["worldseed-tiles.patch.json"] = strToU8(serializeCanonicalJson(plan.manifest));
  return { index, patch: plan.manifest, files };
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
  const files: Record<string, Uint8Array> = {};
  for (const tile of tiles) {
    const binary = await createGlb(tile.group, false);
    tile.descriptor.byteLength = binary.byteLength;
    files[tile.descriptor.path] = new Uint8Array(binary);
    if (tile.detailGroup && tile.descriptor.detailPath) {
      const detailBinary = await createGlb(tile.detailGroup, false);
      tile.descriptor.detailByteLength = detailBinary.byteLength;
      files[tile.descriptor.detailPath] = new Uint8Array(detailBinary);
    }
  }
  files["worldseed-tiles.index.json"] = strToU8(serializeCanonicalJson(index));
  return files;
}

function geometryUploadStats(root: THREE.Object3D): {
  vertexCount: number;
  geometryByteLength: number;
  materialCount: number;
} {
  const geometries = new Set<string>();
  const materials = new Set<string>();
  let vertexCount = 0;
  let geometryByteLength = 0;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry;
    if (geometry?.isBufferGeometry && !geometries.has(geometry.uuid)) {
      geometries.add(geometry.uuid);
      const position = geometry.getAttribute("position");
      if (position) vertexCount += position.count;
      for (const attribute of Object.values(geometry.attributes)) {
        const source = attribute as unknown as {
          array?: { byteLength: number };
          data?: { array?: { byteLength: number } };
        };
        const array = source.array ?? source.data?.array;
        if (array) geometryByteLength += array.byteLength;
      }
      const index = geometry.getIndex();
      if (index?.array && "byteLength" in index.array) geometryByteLength += index.array.byteLength;
    }

    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const item of material) if (item?.uuid) materials.add(item.uuid);
    } else if (material?.uuid) {
      materials.add(material.uuid);
    }
  });

  return {
    vertexCount,
    geometryByteLength,
    materialCount: materials.size,
  };
}

function prefixDetailGeometryStats(stats: {
  vertexCount: number;
  geometryByteLength: number;
  materialCount: number;
}): {
  detailVertexCount: number;
  detailGeometryByteLength: number;
  detailMaterialCount: number;
} {
  return {
    detailVertexCount: stats.vertexCount,
    detailGeometryByteLength: stats.geometryByteLength,
    detailMaterialCount: stats.materialCount,
  };
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
  return `# WorldSeed Drive Any City Starter\n\nA local-meter Three.js city and gameplay-data bundle exported by WorldSeed. The included viewer streams 300 m base geometry tiles around the current view, adds detail GLBs only at closer range, keeps up to two visible GLB fetches buffered ahead of cost-aware parsing, and loads matching IR chunks with base tiles.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n${originNote} X points east, Y points up, and Z points south.\n\n- city.glb — complete rendered city\n- terrain.glb — terrain-only mesh\n- colliders.glb — merged building collision boxes\n- road-graph.json — routable local-meter graph with road class, direction, surface, width, and speed\n- spawn-points.json — vehicle and pedestrian starts\n- drive-route.json — the active time-attack route, when available\n- worldseed-objects.json — stable semantic objects and bounds\n- worldseed-ir.json — unified, versioned WorldSeed intermediate representation\n- worldseed-ir.index.json — lightweight chunk index for selective loading\n- worldseed-ir/chunks/*.json — tile-local semantic, road-graph, and spawn data\n- worldseed-tiles.index.json — lightweight geometry tile index\n- worldseed-tiles/*.glb — 300 m tile-local base geometry for streaming\n- worldseed-tiles/detail/*.glb — optional close-range roofs, street furniture, markings, and other detail geometry\n- ATTRIBUTION.md — data-source obligations to preserve\n`;
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
  economy: { tier: "economy", baseScale: 0.72, detailScale: 0.55, prefetchScale: 0.62, maxConcurrentLoads: 1, maxConcurrentPrefetches: 0, maxCacheRecords: 20, maxCacheBytes: 32 * 1024 * 1024, dprCap: 1.35 },
  balanced: { tier: "balanced", baseScale: 0.9, detailScale: 0.78, prefetchScale: 0.82, maxConcurrentLoads: 2, maxConcurrentPrefetches: 1, maxCacheRecords: 40, maxCacheBytes: 64 * 1024 * 1024, dprCap: 1.65 },
  quality: { tier: "quality", baseScale: 1.08, detailScale: 1, prefetchScale: 1, maxConcurrentLoads: 2, maxConcurrentPrefetches: 1, maxCacheRecords: 72, maxCacheBytes: 128 * 1024 * 1024, dprCap: 1.8 },
};
const PREFETCH_LOOKAHEAD_METERS = 700;
const MAX_VISIBLE_FETCHES = 2;
const MAX_READY_VISIBLE_JOBS = 2;
const MAX_UPLOAD_READY_JOBS = 2;
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
const fetchingJobs = new Set();
const parsingJobs = new Set();
const queuedJobs = new Map();
const readyJobs = new Map();
const uploadJobs = new Map();
const desiredJobs = new Set();
const queuedPrefetches = new Map();
const prefetchedPaths = new Set();
const inflightBinaryFetches = new Map();
const inflightTextFetches = new Map();
let activeFetches = 0;
let activeParses = 0;
let activePrefetches = 0;
let geometryIndex = null;
let cacheNamespace = "uninitialized";
let cacheWritesSincePrune = 0;
let lastStreamUpdate = 0;
let previousFocusX = null;
let previousFocusZ = null;
let movementX = 0;
let movementZ = 0;
let fpsFrames = 0;
let fpsStartedAt = performance.now();
let lastFrameAt = performance.now();
let deferOptionalFrames = 0;
let activeEstimatedParseMs = 0;
let renderFrameIndex = 0;
let uploadFeedbackPending = false;
let uploadFeedbackHints = { vertexCount: 0, geometryByteLength: 0, materialCount: 0 };
let frameBaseline = {
  baselineMs: 16.7,
  samples: 0,
};
let gpuUploadLearning = {
  thresholdScale: 1,
  goodSamples: 0,
  badSamples: 0,
  samples: 0,
};
let gpuCostModel = {
  msPerEquivalentMb: 1.6,
  samples: 0,
  confidence: 0,
  outlierStreak: 0,
  outlierDirection: 0,
};
let parseCostState = {
  baseMsPerMb: 14,
  detailMsPerMb: 16,
  baseSamples: 0,
  detailSamples: 0,
};

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
  const existing = inflightTextFetches.get(normalized);
  if (existing) return await existing;

  const request = (async () => {
    const cached = await cacheGet(normalized);
    if (typeof cached === "string") {
      prefetchedPaths.add(normalized);
      return cached;
    }
    const text = await fetchText(normalized);
    prefetchedPaths.add(normalized);
    void cacheSet(normalized, text);
    return text;
  })();

  inflightTextFetches.set(normalized, request);
  try {
    return await request;
  } finally {
    inflightTextFetches.delete(normalized);
  }
}

async function fetchBinaryCached(path) {
  const normalized = normalizePath(path);
  const existing = inflightBinaryFetches.get(normalized);
  if (existing) return await existing;

  const request = (async () => {
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
  })();

  inflightBinaryFetches.set(normalized, request);
  try {
    return await request;
  } finally {
    inflightBinaryFetches.delete(normalized);
  }
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

function cacheValueByteLength(value) {
  if (typeof value === "string") return new TextEncoder().encode(value).byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

async function cacheGet(path) {
  try {
    const key = cacheKey(path);
    const record = await get(key);
    const now = Date.now();
    if (!record || record.expiresAt < now) {
      if (record) void del(key);
      return null;
    }
    if (now - (record.lastAccessedAt || 0) > 60_000) {
      void set(key, { ...record, lastAccessedAt: now });
    }
    return record.value;
  } catch {
    return null;
  }
}

async function cacheSet(path, value) {
  try {
    const now = Date.now();
    await set(cacheKey(path), {
      expiresAt: now + CACHE_MAX_AGE_MS,
      lastAccessedAt: now,
      byteLength: cacheValueByteLength(value),
      value,
    });
    cacheWritesSincePrune += 1;
    if (cacheWritesSincePrune >= 6) {
      cacheWritesSincePrune = 0;
      void pruneCurrentCacheNamespace();
    }
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
    await pruneCurrentCacheNamespace();
  } catch {
    // Cache cleanup is best-effort.
  }
}

async function pruneCurrentCacheNamespace() {
  try {
    const prefix = CACHE_PREFIX + cacheNamespace + ":";
    const currentKeys = (await keys()).filter((key) =>
      typeof key === "string" && key.startsWith(prefix));
    const maximum = streamingState.budget.maxCacheRecords;

    const records = await Promise.all(currentKeys.map(async (key) => ({
      key,
      record: await get(key),
    })));
    records.sort((first, second) =>
      Number(first.record?.lastAccessedAt || 0) - Number(second.record?.lastAccessedAt || 0));

    let totalBytes = records.reduce((sum, entry) => sum + Number(entry.record?.byteLength || 0), 0);
    const maximumBytes = streamingState.budget.maxCacheBytes;
    const removals = [];
    for (const entry of records) {
      if (records.length - removals.length <= maximum && totalBytes <= maximumBytes) break;
      removals.push(entry.key);
      totalBytes -= Number(entry.record?.byteLength || 0);
    }
    await Promise.all(removals.map((key) => del(key)));
  } catch {
    // Cache trimming is best-effort.
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
      if (!loadedBaseTiles.has(tile.id) && !jobIsPending(baseKey)) {
        candidates.push({ key: baseKey, tile, kind: "base", distance, priority: distance });
      }
    } else if (distance > baseUnloadDistance + padding) {
      unloadTileLod(tile.id, "base");
      unloadTileLod(tile.id, "detail");
    }

    if (tile.detailPath && distance <= detailDistance + padding) {
      desiredJobs.add(detailKey);
      if (!loadedDetailTiles.has(tile.id) && !jobIsPending(detailKey)) {
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
        && !jobIsPending("base:" + tile.id);
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

function jobIsPending(key) {
  return fetchingJobs.has(key)
    || parsingJobs.has(key)
    || readyJobs.has(key)
    || uploadJobs.has(key);
}

function pumpTileQueue() {
  pumpVisibleFetchQueue();
  pumpVisibleParseQueue();
  // Parsing removes a ready item immediately, so refill that buffer without
  // waiting for the next 180 ms visibility update.
  pumpVisibleFetchQueue();
  pumpPrefetchQueue();
}

function pumpVisibleFetchQueue() {
  while (
    activeFetches < MAX_VISIBLE_FETCHES
    && activeFetches + readyJobs.size < MAX_READY_VISIBLE_JOBS
    && queuedJobs.size > 0
  ) {
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

    queuedJobs.delete(key);
    void runTileFetch(job);
  }
}

function pumpVisibleParseQueue() {
  while (readyJobs.size > 0) {
    for (const [key, prepared] of readyJobs) {
      const loaded = prepared.job.kind === "detail" ? loadedDetailTiles : loadedBaseTiles;
      if (!desiredJobs.has(key) || loaded.has(prepared.job.tile.id)) readyJobs.delete(key);
    }

    const next = [...readyJobs.entries()]
      .filter(([, prepared]) => prepared.job.kind !== "detail" || optionalWorkAllowed())
      .sort((first, second) =>
        first[1].job.priority - second[1].job.priority
        || first[1].job.tile.z - second[1].job.tile.z
        || first[1].job.tile.x - second[1].job.tile.x)[0];
    if (!next) return;

    const [key, prepared] = next;
    if (!uploadBufferAllowsParse(prepared.job.kind)) return;
    const estimatedParseMs = estimatePreparedParseCostMs(prepared);
    const costLimit = activeEstimatedParseMs >= 18
      || estimatedParseMs >= 18
      || activeEstimatedParseMs + estimatedParseMs >= 24
      ? 1
      : streamingState.budget.maxConcurrentLoads;
    if (activeParses >= costLimit) return;

    readyJobs.delete(key);
    void runTileParse(prepared, estimatedParseMs);
  }
}

async function runTileFetch(job) {
  const key = job.kind + ":" + job.tile.id;
  const path = job.kind === "detail" ? job.tile.detailPath : job.tile.path;
  if (!path) return;

  activeFetches += 1;
  fetchingJobs.add(key);
  try {
    const binaryPromise = fetchBinaryCached(path);
    const chunkPromise = job.kind === "base"
      ? fetchJson("worldseed-ir/chunks/" + job.tile.x + "_" + job.tile.z + ".json", true, true)
      : Promise.resolve(null);
    const [binary, chunk] = await Promise.all([binaryPromise, chunkPromise]);

    if (!desiredJobs.has(key)) return;
    readyJobs.set(key, { job, binary, chunk });
  } catch (error) {
    console.warn("WorldSeed " + job.kind + " tile " + job.tile.id + " failed to fetch", error);
  } finally {
    fetchingJobs.delete(key);
    activeFetches = Math.max(0, activeFetches - 1);
    pumpTileQueue();
  }
}

async function runTileParse(prepared, estimatedParseMs) {
  const job = prepared.job;
  const key = job.kind + ":" + job.tile.id;

  activeParses += 1;
  activeEstimatedParseMs += estimatedParseMs;
  parsingJobs.add(key);
  try {
    const parseStartedAt = performance.now();
    const gltf = await loader.parseAsync(prepared.binary, "");
    recordParseCost(job.kind, prepared.binary.byteLength, performance.now() - parseStartedAt);

    if (!desiredJobs.has(key)) {
      disposeTileScene(gltf.scene);
      return;
    }

    gltf.scene.userData.worldseedTileId = job.tile.id;
    gltf.scene.userData.worldseedLod = job.kind;
    if (prepared.chunk) gltf.scene.userData.worldseedChunk = prepared.chunk;

    const uploadHints = collectGpuUploadHints(gltf.scene);
    const delayFrames = gpuUploadDelayFrames(uploadHints);
    uploadJobs.set(key, {
      job,
      scene: gltf.scene,
      uploadHints,
      delayFrames,
      availableAtFrame: renderFrameIndex + delayFrames,
    });
  } catch (error) {
    console.warn("WorldSeed " + job.kind + " tile " + job.tile.id + " failed to parse", error);
  } finally {
    parsingJobs.delete(key);
    activeParses = Math.max(0, activeParses - 1);
    activeEstimatedParseMs = Math.max(0, activeEstimatedParseMs - estimatedParseMs);
    pumpTileQueue();
  }
}

function pumpPrefetchQueue() {
  if (
    !optionalWorkAllowed()
    || streamingState.budget.maxConcurrentPrefetches <= 0
    || activePrefetches >= streamingState.budget.maxConcurrentPrefetches
    || activeFetches > 0
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


function unloadTileLod(id, kind) {
  const key = kind + ":" + id;
  queuedJobs.delete(key);
  readyJobs.delete(key);
  const upload = uploadJobs.get(key);
  if (upload) {
    disposeTileScene(upload.scene);
    uploadJobs.delete(key);
  }
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

function uploadBufferAllowsParse(kind) {
  if (uploadJobs.size < MAX_UPLOAD_READY_JOBS) return true;
  if (kind !== "base" || optionalWorkAllowed()) return false;
  const blockedDetails = [...uploadJobs.values()].filter((upload) => upload.job.kind === "detail").length;
  return blockedDetails === uploadJobs.size && uploadJobs.size < MAX_UPLOAD_READY_JOBS + 1;
}

function pumpGpuUploadQueue() {
  if (uploadJobs.size === 0) return;

  for (const [key, upload] of uploadJobs) {
    const loaded = upload.job.kind === "detail" ? loadedDetailTiles : loadedBaseTiles;
    if (!desiredJobs.has(key) || loaded.has(upload.job.tile.id)) {
      disposeTileScene(upload.scene);
      uploadJobs.delete(key);
    }
  }

  const candidates = [...uploadJobs.entries()]
    .filter(([, upload]) =>
      renderFrameIndex >= upload.availableAtFrame
      && (upload.job.kind !== "detail" || optionalWorkAllowed()))
    .sort((first, second) =>
      (first[1].job.kind === "base" ? 0 : 1) - (second[1].job.kind === "base" ? 0 : 1)
      || first[1].job.priority - second[1].job.priority
      || first[1].job.tile.z - second[1].job.tile.z
      || first[1].job.tile.x - second[1].job.tile.x);

  let attachments = 0;
  let attachedHints = { vertexCount: 0, geometryByteLength: 0, materialCount: 0 };
  for (const [key, upload] of candidates) {
    const heavy = upload.delayFrames > 0;
    if (heavy && attachments > 0) continue;
    if (!heavy && attachments >= 2) break;

    uploadJobs.delete(key);
    streamedRoot.add(upload.scene);
    if (upload.job.kind === "detail") loadedDetailTiles.set(upload.job.tile.id, upload.scene);
    else loadedBaseTiles.set(upload.job.tile.id, upload.scene);
    attachments += 1;
    attachedHints = combineGpuUploadHints(attachedHints, upload.uploadHints);

    if (heavy) break;
  }
  if (attachments > 0) {
    uploadFeedbackHints = uploadFeedbackPending
      ? combineGpuUploadHints(uploadFeedbackHints, attachedHints)
      : attachedHints;
    uploadFeedbackPending = true;
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
  const scale = Math.min(1.5, Math.max(0.5, gpuUploadLearning.thresholdScale));
  let thresholdDelay = 0;
  if (
    hints.vertexCount >= 350_000 * scale
    || hints.geometryByteLength >= 12 * 1024 * 1024 * scale
    || hints.materialCount >= 32 * scale
  ) thresholdDelay = 2;
  else if (
    hints.vertexCount >= 180_000 * scale
    || hints.geometryByteLength >= 6 * 1024 * 1024 * scale
    || hints.materialCount >= 16 * scale
  ) thresholdDelay = 1;

  if (gpuCostModel.samples < 2) return thresholdDelay;
  const learnedWeight = Math.min(1, Math.max(0, gpuCostModel.confidence));
  const effectiveRate = 1.6 * (1 - learnedWeight)
    + gpuCostModel.msPerEquivalentMb * learnedWeight;
  const predictedExcessMs = gpuEquivalentMb(hints) * effectiveRate;
  const predictedDelay = predictedExcessMs >= 24 ? 2 : predictedExcessMs >= 10 ? 1 : 0;
  return Math.max(thresholdDelay, predictedDelay);
}

function gpuEquivalentMb(hints) {
  const geometryMb = Math.max(0, hints.geometryByteLength || 0) / (1024 * 1024);
  const vertexEquivalentMb = Math.max(0, hints.vertexCount || 0) / 250_000;
  const materialEquivalentMb = Math.max(0, hints.materialCount || 0) / 32;
  return Math.max(0.25, geometryMb + vertexEquivalentMb + materialEquivalentMb);
}

function combineGpuUploadHints(first, second) {
  return {
    vertexCount: Math.max(0, first.vertexCount || 0) + Math.max(0, second.vertexCount || 0),
    geometryByteLength:
      Math.max(0, first.geometryByteLength || 0) + Math.max(0, second.geometryByteLength || 0),
    materialCount: Math.max(0, first.materialCount || 0) + Math.max(0, second.materialCount || 0),
  };
}

function sampleGpuUploadFeedback(frameTimeMs) {
  if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0) return;

  if (!uploadFeedbackPending) {
    if (frameTimeMs <= 28) {
      const sample = Math.min(28, Math.max(8, frameTimeMs));
      const alpha = frameBaseline.samples < 10 ? 0.2 : 0.06;
      frameBaseline.baselineMs = frameBaseline.samples === 0
        ? sample
        : frameBaseline.baselineMs * (1 - alpha) + sample * alpha;
      frameBaseline.samples += 1;
    }
    return;
  }

  uploadFeedbackPending = false;
  const uploadExcessMs = Math.max(0, frameTimeMs - frameBaseline.baselineMs);
  const equivalentMb = gpuEquivalentMb(uploadFeedbackHints);
  const sampleRate = Math.min(40, Math.max(0.25, uploadExcessMs / equivalentMb));
  let accepted = true;

  if (gpuCostModel.samples >= 2) {
    const ratio = sampleRate / Math.max(0.25, gpuCostModel.msPerEquivalentMb);
    const direction = ratio > 3 ? 1 : ratio < 1 / 3 ? -1 : 0;
    if (direction !== 0) {
      const repeatedSameDirection = gpuCostModel.outlierStreak >= 1
        && gpuCostModel.outlierDirection === direction;
      if (!repeatedSameDirection) {
        gpuCostModel.confidence = Math.max(0.15, gpuCostModel.confidence * 0.9);
        gpuCostModel.outlierStreak = 1;
        gpuCostModel.outlierDirection = direction;
        accepted = false;
      }
    }
  }

  if (accepted) {
    const lower = gpuCostModel.samples >= 2 ? gpuCostModel.msPerEquivalentMb * 0.5 : 0.25;
    const upper = gpuCostModel.samples >= 2 ? gpuCostModel.msPerEquivalentMb * 2 : 40;
    const robustSample = Math.min(upper, Math.max(lower, sampleRate));
    const costAlpha = gpuCostModel.outlierStreak > 0 ? 0.18 : 0.3;
    gpuCostModel.msPerEquivalentMb = gpuCostModel.samples === 0
      ? robustSample
      : gpuCostModel.msPerEquivalentMb * (1 - costAlpha) + robustSample * costAlpha;
    gpuCostModel.samples += 1;
    gpuCostModel.confidence = Math.min(1, gpuCostModel.samples / 6);
    gpuCostModel.outlierStreak = 0;
    gpuCostModel.outlierDirection = 0;
  }
  uploadFeedbackHints = { vertexCount: 0, geometryByteLength: 0, materialCount: 0 };

  if (accepted) {
    let thresholdScale = gpuUploadLearning.thresholdScale;
    let goodSamples = uploadExcessMs <= 4 ? gpuUploadLearning.goodSamples + 1 : 0;
    let badSamples = uploadExcessMs >= 10 ? gpuUploadLearning.badSamples + 1 : 0;

    if (uploadExcessMs >= 24) {
      thresholdScale = Math.max(0.55, thresholdScale * 0.82);
      goodSamples = 0;
      badSamples = 0;
    } else if (badSamples >= 2) {
      thresholdScale = Math.max(0.55, thresholdScale * 0.9);
      goodSamples = 0;
      badSamples = 0;
    } else if (goodSamples >= 5) {
      thresholdScale = Math.min(1.35, thresholdScale * 1.06);
      goodSamples = 0;
      badSamples = 0;
    }

    gpuUploadLearning = {
      thresholdScale,
      goodSamples,
      badSamples,
      samples: gpuUploadLearning.samples + 1,
    };
  }
}

function jobByteLength(job) {
  const value = job.kind === "detail" ? job.tile.detailByteLength : job.tile.byteLength;
  return Number.isFinite(value) && value > 0 ? value : 1_500_000;
}

function estimatePreparedParseCostMs(prepared) {
  const bytes = prepared.binary?.byteLength || jobByteLength(prepared.job);
  const job = prepared.job;
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
    void pruneCurrentCacheNamespace();
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
  renderFrameIndex += 1;
  const frameNow = performance.now();
  const frameTimeMs = frameNow - lastFrameAt;
  sampleGpuUploadFeedback(frameTimeMs);
  sampleFrameTime(frameTimeMs);
  lastFrameAt = frameNow;

  controls.update();
  updateStreamedTiles();
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
