import { WORLD_TILE_SIZE } from "../config";
import { tileForPoint } from "../generation/tiling";
import type {
  DriveRoute,
  RoadGraph,
  RoadGraphEdge,
  SemanticObject,
  WorldManifest,
} from "../types";

export const WORLDSEED_IR_FORMAT = "worldseed-ir" as const;
export const WORLDSEED_IR_INDEX_FORMAT = "worldseed-ir-index" as const;
export const WORLDSEED_IR_CHUNK_FORMAT = "worldseed-ir-chunk" as const;
export const WORLDSEED_IR_PATCH_FORMAT = "worldseed-ir-patch" as const;
export const WORLDSEED_IR_DEPENDENCY_FORMAT = "worldseed-ir-dependencies" as const;
export const WORLDSEED_IR_VERSION = "1" as const;

export interface WorldSeedIrDocument {
  format: typeof WORLDSEED_IR_FORMAT;
  version: typeof WORLDSEED_IR_VERSION;
  metadata: Record<string, unknown>;
  semantic: WorldManifest;
  navigation: {
    roadGraph: RoadGraph;
    spawnPoints: Record<string, unknown>;
    driveRoute: DriveRoute | null;
  };
}

export interface CreateWorldSeedIrInput {
  metadata: Record<string, unknown>;
  manifest: WorldManifest;
  roadGraph: RoadGraph;
  spawnPoints: Record<string, unknown>;
  driveRoute: DriveRoute | null;
}

export interface WorldSeedIrChunkDescriptor {
  id: string;
  path: string;
  x: number;
  z: number;
  centerX: number;
  centerZ: number;
  size: number;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  counts: {
    semanticObjects: number;
    roadNodes: number;
    roadEdges: number;
    spawnPoints: number;
  };
  contentHash?: string;
}

export interface WorldSeedIrIndex {
  format: typeof WORLDSEED_IR_INDEX_FORMAT;
  version: typeof WORLDSEED_IR_VERSION;
  tileSizeMeters: number;
  coordinateSystem: string;
  globalHash?: string;
  geometryGlobalHash?: string;
  revisionHash?: string;
  global: {
    metadataPath: "worldseed.json";
    fullDocumentPath: "worldseed-ir.json";
    driveRoutePath: "drive-route.json";
    geometryIndexPath: "worldseed-tiles.index.json";
    dependencyGraphPath?: "worldseed-ir.dependencies.json";
    semanticObjects: SemanticObject[];
  };
  chunks: WorldSeedIrChunkDescriptor[];
}

export interface WorldSeedIrPatchChunk {
  id: string;
  path: string;
  contentHash?: string;
}

export interface WorldSeedIrPatchManifest {
  format: typeof WORLDSEED_IR_PATCH_FORMAT;
  version: typeof WORLDSEED_IR_VERSION;
  fromRevisionHash: string | null;
  toRevisionHash: string | null;
  globalChanged: boolean;
  geometryGlobalChanged: boolean;
  added: WorldSeedIrPatchChunk[];
  changed: WorldSeedIrPatchChunk[];
  removed: WorldSeedIrPatchChunk[];
  unchangedCount: number;
}

export interface WorldSeedIrIncrementalPlan {
  patch: WorldSeedIrPatchManifest;
  changedChunkIds: Set<string>;
  changedChunkPaths: Set<string>;
}

export type WorldSeedIrDependencyKind =
  | "semantic"
  | "road-node"
  | "road-edge"
  | "spawn"
  | "drive-route"
  | "artifact";

export interface WorldSeedIrDependencyNode {
  id: string;
  kind: WorldSeedIrDependencyKind;
  chunkId?: string;
  contentHash: string;
  dependsOn: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface WorldSeedIrDependencyGraph {
  format: typeof WORLDSEED_IR_DEPENDENCY_FORMAT;
  version: typeof WORLDSEED_IR_VERSION;
  graphHash: string;
  nodes: WorldSeedIrDependencyNode[];
}

export interface WorldSeedIrDependencyDiff {
  added: string[];
  changed: string[];
  removed: string[];
  impacted: string[];
  impactedArtifacts: string[];
}

export interface WorldSeedIrChunk {
  format: typeof WORLDSEED_IR_CHUNK_FORMAT;
  version: typeof WORLDSEED_IR_VERSION;
  tile: {
    id: string;
    x: number;
    z: number;
    centerX: number;
    centerZ: number;
    size: number;
  };
  semantic: {
    objects: SemanticObject[];
  };
  navigation: {
    roadGraph: RoadGraph;
    spawnPoints: {
      vehicles: Record<string, unknown>[];
      pedestrians: Record<string, unknown>[];
    };
  };
}

interface MutableChunk {
  tile: WorldSeedIrChunk["tile"];
  semanticObjects: SemanticObject[];
  roadEdges: RoadGraphEdge[];
  roadNodeIds: Set<string>;
  vehicles: Record<string, unknown>[];
  pedestrians: Record<string, unknown>[];
}

export function createWorldSeedIr(input: CreateWorldSeedIrInput): WorldSeedIrDocument {
  return {
    format: WORLDSEED_IR_FORMAT,
    version: WORLDSEED_IR_VERSION,
    metadata: input.metadata,
    semantic: input.manifest,
    navigation: {
      roadGraph: input.roadGraph,
      spawnPoints: input.spawnPoints,
      driveRoute: input.driveRoute,
    },
  };
}

export function parseWorldSeedIr(input: string | unknown): WorldSeedIrDocument {
  const document = typeof input === "string" ? JSON.parse(input) as unknown : input;
  return migrateWorldSeedIr(document);
}

export function parseWorldSeedIrIndex(input: string | unknown): WorldSeedIrIndex {
  const value = typeof input === "string" ? JSON.parse(input) as unknown : input;
  const document = requireRecord(value, "WorldSeed IR index");
  if (document["format"] !== WORLDSEED_IR_INDEX_FORMAT) {
    throw new Error(`Unsupported WorldSeed IR index format: ${String(document["format"])}`);
  }
  if (document["version"] !== WORLDSEED_IR_VERSION) {
    throw new Error(`Unsupported WorldSeed IR index version: ${String(document["version"])}`);
  }
  if (!Array.isArray(document["chunks"])) throw new Error("WorldSeed IR index chunks must be an array");
  requireRecord(document["global"], "WorldSeed IR index global");
  return document as unknown as WorldSeedIrIndex;
}

export function parseWorldSeedIrChunk(input: string | unknown): WorldSeedIrChunk {
  const value = typeof input === "string" ? JSON.parse(input) as unknown : input;
  const document = requireRecord(value, "WorldSeed IR chunk");
  if (document["format"] !== WORLDSEED_IR_CHUNK_FORMAT) {
    throw new Error(`Unsupported WorldSeed IR chunk format: ${String(document["format"])}`);
  }
  if (document["version"] !== WORLDSEED_IR_VERSION) {
    throw new Error(`Unsupported WorldSeed IR chunk version: ${String(document["version"])}`);
  }
  requireRecord(document["tile"], "WorldSeed IR chunk tile");
  requireRecord(document["semantic"], "WorldSeed IR chunk semantic");
  requireRecord(document["navigation"], "WorldSeed IR chunk navigation");
  return document as unknown as WorldSeedIrChunk;
}

export function migrateWorldSeedIr(input: unknown): WorldSeedIrDocument {
  const document = requireRecord(input, "WorldSeed IR root");
  if (document["format"] !== WORLDSEED_IR_FORMAT) {
    throw new Error(`Unsupported WorldSeed IR format: ${String(document["format"])}`);
  }

  const version = document["version"];
  if (version !== WORLDSEED_IR_VERSION && version !== "1.0") {
    throw new Error(`Unsupported WorldSeed IR version: ${String(version)}`);
  }

  const metadata = requireRecord(document["metadata"], "WorldSeed IR metadata");
  const semantic = requireRecord(document["semantic"], "WorldSeed IR semantic manifest");
  const navigation = requireRecord(document["navigation"], "WorldSeed IR navigation");
  requireRecord(navigation["roadGraph"], "WorldSeed IR road graph");
  requireRecord(navigation["spawnPoints"], "WorldSeed IR spawn points");

  return {
    ...document,
    format: WORLDSEED_IR_FORMAT,
    version: WORLDSEED_IR_VERSION,
    metadata,
    semantic: semantic as unknown as WorldManifest,
    navigation: {
      ...navigation,
      roadGraph: navigation["roadGraph"] as RoadGraph,
      spawnPoints: navigation["spawnPoints"] as Record<string, unknown>,
      driveRoute: (navigation["driveRoute"] ?? null) as DriveRoute | null,
    },
  } as WorldSeedIrDocument;
}

export function serializeWorldSeedIr(document: WorldSeedIrDocument, pretty = true): string {
  return serializeCanonicalJson(document, pretty);
}

export function createWorldSeedIrChunkSet(
  document: WorldSeedIrDocument,
  tileSizeMeters = WORLD_TILE_SIZE,
): { index: WorldSeedIrIndex; chunks: WorldSeedIrChunk[] } {
  if (!(tileSizeMeters > 0) || !Number.isFinite(tileSizeMeters)) {
    throw new Error("WorldSeed IR tile size must be a positive finite number");
  }

  const chunks = new Map<string, MutableChunk>();
  const ensureChunk = (x: number, z: number): MutableChunk => {
    const tile = tileForPoint(x, z, tileSizeMeters);
    const existing = chunks.get(tile.id);
    if (existing) return existing;
    const chunk: MutableChunk = {
      tile,
      semanticObjects: [],
      roadEdges: [],
      roadNodeIds: new Set<string>(),
      vehicles: [],
      pedestrians: [],
    };
    chunks.set(tile.id, chunk);
    return chunk;
  };

  const globalSemanticObjects: SemanticObject[] = [];
  for (const object of document.semantic.objects) {
    if (object.layer === "terrain") {
      globalSemanticObjects.push(object);
      continue;
    }
    ensureChunk(object.center[0], object.center[2]).semanticObjects.push(object);
  }

  for (const edge of document.navigation.roadGraph.edges) {
    const anchor = edgeAnchor(edge);
    const chunk = ensureChunk(anchor.x, anchor.z);
    chunk.roadEdges.push(edge);
    chunk.roadNodeIds.add(edge.from);
    chunk.roadNodeIds.add(edge.to);
  }

  distributeSpawnPoints(document.navigation.spawnPoints["vehicles"], "vehicles", ensureChunk);
  distributeSpawnPoints(document.navigation.spawnPoints["pedestrians"], "pedestrians", ensureChunk);

  const nodeById = new Map(document.navigation.roadGraph.nodes.map((node) => [node.id, node]));
  const sorted = [...chunks.values()].sort((first, second) =>
    first.tile.z - second.tile.z || first.tile.x - second.tile.x);

  const chunkDocuments = sorted.map((chunk): WorldSeedIrChunk => ({
    format: WORLDSEED_IR_CHUNK_FORMAT,
    version: WORLDSEED_IR_VERSION,
    tile: chunk.tile,
    semantic: {
      objects: chunk.semanticObjects,
    },
    navigation: {
      roadGraph: {
        schemaVersion: document.navigation.roadGraph.schemaVersion,
        generator: document.navigation.roadGraph.generator,
        coordinateSystem: document.navigation.roadGraph.coordinateSystem,
        nodes: document.navigation.roadGraph.nodes.filter((node) => chunk.roadNodeIds.has(node.id)),
        edges: chunk.roadEdges,
      },
      spawnPoints: {
        vehicles: chunk.vehicles,
        pedestrians: chunk.pedestrians,
      },
    },
  }));

  const chunkDescriptors = chunkDocuments.map((chunk) => descriptorForChunk(chunk));
  const globalHash = hashCanonicalJson({
    metadata: document.metadata,
    semanticObjects: globalSemanticObjects,
    driveRoute: document.navigation.driveRoute,
  });
  const geometryGlobalHash = hashCanonicalJson({
    style: document.metadata["style"] ?? null,
    semanticObjects: globalSemanticObjects,
  });
  const revisionHash = hashCanonicalJson({
    version: WORLDSEED_IR_VERSION,
    tileSizeMeters,
    coordinateSystem: document.navigation.roadGraph.coordinateSystem,
    globalHash,
    geometryGlobalHash,
    chunks: chunkDescriptors.map((chunk) => ({
      id: chunk.id,
      contentHash: chunk.contentHash,
    })),
  });

  const index: WorldSeedIrIndex = {
    format: WORLDSEED_IR_INDEX_FORMAT,
    version: WORLDSEED_IR_VERSION,
    tileSizeMeters,
    coordinateSystem: document.navigation.roadGraph.coordinateSystem,
    globalHash,
    geometryGlobalHash,
    revisionHash,
    global: {
      metadataPath: "worldseed.json",
      fullDocumentPath: "worldseed-ir.json",
      driveRoutePath: "drive-route.json",
      geometryIndexPath: "worldseed-tiles.index.json",
      dependencyGraphPath: "worldseed-ir.dependencies.json",
      semanticObjects: globalSemanticObjects,
    },
    chunks: chunkDescriptors,
  };

  for (const chunk of chunkDocuments) {
    for (const node of chunk.navigation.roadGraph.nodes) {
      if (!nodeById.has(node.id)) throw new Error(`WorldSeed IR chunk references missing road node: ${node.id}`);
    }
  }

  return { index, chunks: chunkDocuments };
}

export function stableSemanticObjectId(object: SemanticObject): string {
  return [
    "semantic",
    stableIdPart(object.source),
    stableIdPart(object.layer),
    stableIdPart(object.sourceId || object.id),
  ].join(":");
}

export function createWorldSeedIrDependencyGraph(
  document: WorldSeedIrDocument,
  tileSizeMeters = WORLD_TILE_SIZE,
): WorldSeedIrDependencyGraph {
  const nodes = new Map<string, WorldSeedIrDependencyNode>();
  const semanticByLayerAndSource = new Map<string, string>();
  const roadEdgeIdsByRoadId = new Map<string, string[]>();

  for (const edge of document.navigation.roadGraph.edges) {
    const id = "road-edge:" + edge.id;
    const list = roadEdgeIdsByRoadId.get(edge.roadId) ?? [];
    list.push(id);
    roadEdgeIdsByRoadId.set(edge.roadId, list);
  }

  for (const object of document.semantic.objects) {
    const id = stableSemanticObjectId(object);
    const tile = object.layer === "terrain"
      ? undefined
      : tileForPoint(object.center[0], object.center[2], tileSizeMeters).id;
    const dependsOn: string[] = [];
    if (object.layer === "roofs") {
      const building = semanticByLayerAndSource.get("buildings|" + object.source + "|" + object.sourceId);
      if (building) dependsOn.push(building);
    }
    if (object.layer === "roads") {
      dependsOn.push(...(roadEdgeIdsByRoadId.get(object.sourceId) ?? []));
    }
    nodes.set(id, dependencyNode(id, "semantic", object, dependsOn, tile, {
      layer: object.layer,
      source: object.source,
      sourceId: object.sourceId,
    }));
    semanticByLayerAndSource.set(object.layer + "|" + object.source + "|" + object.sourceId, id);
  }

  // Resolve roofs after every semantic object has been indexed so source order
  // does not affect dependency edges.
  for (const object of document.semantic.objects) {
    if (object.layer !== "roofs") continue;
    const id = stableSemanticObjectId(object);
    const node = nodes.get(id);
    const building = semanticByLayerAndSource.get("buildings|" + object.source + "|" + object.sourceId);
    if (node && building && !node.dependsOn.includes(building)) node.dependsOn.push(building);
  }

  for (const node of document.navigation.roadGraph.nodes) {
    const id = "road-node:" + node.id;
    nodes.set(id, dependencyNode(id, "road-node", node, [], undefined));
  }

  for (const edge of document.navigation.roadGraph.edges) {
    const id = "road-edge:" + edge.id;
    const tile = tileForPoint(edgeAnchor(edge).x, edgeAnchor(edge).z, tileSizeMeters).id;
    nodes.set(id, dependencyNode(
      id,
      "road-edge",
      edge,
      ["road-node:" + edge.from, "road-node:" + edge.to],
      tile,
      { roadId: edge.roadId },
    ));
  }

  for (const category of ["vehicles", "pedestrians"] as const) {
    const values = document.navigation.spawnPoints[category];
    if (!Array.isArray(values)) continue;
    values.forEach((value, index) => {
      const record = asRecord(value);
      if (!record) return;
      const rawId = typeof record["id"] === "string" ? record["id"] : category + ":" + index;
      const id = "spawn:" + category + ":" + stableIdPart(rawId);
      const position = asRecord(record["position"]);
      const x = finiteNumber(position?.["x"]);
      const z = finiteNumber(position?.["z"]);
      const chunkId = x !== undefined && z !== undefined
        ? tileForPoint(x, z, tileSizeMeters).id
        : undefined;
      const edgeId = typeof record["edgeId"] === "string" ? record["edgeId"] : undefined;
      nodes.set(id, dependencyNode(
        id,
        "spawn",
        record,
        edgeId ? ["road-edge:" + edgeId] : [],
        chunkId,
        { category },
      ));
    });
  }

  const route = document.navigation.driveRoute;
  if (route) {
    const id = "drive-route:" + stableIdPart(route.id);
    nodes.set(id, dependencyNode(
      id,
      "drive-route",
      route,
      route.edgeIds.map((edgeId) => "road-edge:" + edgeId),
      undefined,
    ));
  }

  const dependencyNodes = [...nodes.values()];
  const chunkIds = new Set(dependencyNodes.map((node) => node.chunkId).filter((id): id is string => Boolean(id)));
  for (const chunkId of chunkIds) {
    const dependencies = dependencyNodes
      .filter((node) => node.chunkId === chunkId && node.kind !== "artifact")
      .map((node) => node.id)
      .sort();
    const id = "artifact:geometry:" + chunkId;
    nodes.set(id, dependencyNode(
      id,
      "artifact",
      { chunkId, dependencies },
      dependencies,
      chunkId,
      { artifact: "geometry" },
    ));
  }

  const buildingDependencies = document.semantic.objects
    .filter((object) => object.layer === "buildings")
    .map((object) => stableSemanticObjectId(object))
    .sort();
  nodes.set("artifact:colliders", dependencyNode(
    "artifact:colliders",
    "artifact",
    { dependencies: buildingDependencies },
    buildingDependencies,
    undefined,
    { artifact: "colliders" },
  ));

  const roadDependencies = [
    ...document.navigation.roadGraph.nodes.map((node) => "road-node:" + node.id),
    ...document.navigation.roadGraph.edges.map((edge) => "road-edge:" + edge.id),
  ].sort();
  nodes.set("artifact:road-graph", dependencyNode(
    "artifact:road-graph",
    "artifact",
    { dependencies: roadDependencies },
    roadDependencies,
    undefined,
    { artifact: "road-graph" },
  ));

  const spawnDependencies = [...nodes.values()]
    .filter((node) => node.kind === "spawn")
    .map((node) => node.id)
    .sort();
  nodes.set("artifact:spawn-points", dependencyNode(
    "artifact:spawn-points",
    "artifact",
    { dependencies: spawnDependencies },
    spawnDependencies,
    undefined,
    { artifact: "spawn-points" },
  ));

  const routeDependencies = route ? ["drive-route:" + stableIdPart(route.id)] : [];
  nodes.set("artifact:drive-route", dependencyNode(
    "artifact:drive-route",
    "artifact",
    { dependencies: routeDependencies },
    routeDependencies,
    undefined,
    { artifact: "drive-route" },
  ));

  const sorted = [...nodes.values()]
    .map((node) => ({ ...node, dependsOn: [...new Set(node.dependsOn)].sort() }))
    .sort((first, second) => first.id.localeCompare(second.id));
  return {
    format: WORLDSEED_IR_DEPENDENCY_FORMAT,
    version: WORLDSEED_IR_VERSION,
    graphHash: hashCanonicalJson(sorted),
    nodes: sorted,
  };
}

export function parseWorldSeedIrDependencyGraph(input: string | unknown): WorldSeedIrDependencyGraph {
  const value = typeof input === "string" ? JSON.parse(input) as unknown : input;
  const document = requireRecord(value, "WorldSeed IR dependency graph");
  if (document["format"] !== WORLDSEED_IR_DEPENDENCY_FORMAT) {
    throw new Error(`Unsupported WorldSeed IR dependency format: ${String(document["format"])}`);
  }
  if (document["version"] !== WORLDSEED_IR_VERSION) {
    throw new Error(`Unsupported WorldSeed IR dependency version: ${String(document["version"])}`);
  }
  if (!Array.isArray(document["nodes"])) throw new Error("WorldSeed IR dependency nodes must be an array");
  return document as unknown as WorldSeedIrDependencyGraph;
}

export function diffWorldSeedIrDependencyGraphs(
  previous: WorldSeedIrDependencyGraph,
  next: WorldSeedIrDependencyGraph,
): WorldSeedIrDependencyDiff {
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
  const nextById = new Map(next.nodes.map((node) => [node.id, node]));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const node of next.nodes) {
    const before = previousById.get(node.id);
    if (!before) added.push(node.id);
    else if (before.contentHash !== node.contentHash) changed.push(node.id);
  }
  for (const node of previous.nodes) {
    if (!nextById.has(node.id)) removed.push(node.id);
  }

  const reverse = new Map<string, Set<string>>();
  const addReverse = (graph: WorldSeedIrDependencyGraph): void => {
    for (const node of graph.nodes) {
      for (const dependency of node.dependsOn) {
        const dependents = reverse.get(dependency) ?? new Set<string>();
        dependents.add(node.id);
        reverse.set(dependency, dependents);
      }
    }
  };
  addReverse(previous);
  addReverse(next);

  const impacted = new Set([...added, ...changed, ...removed]);
  const queue = [...impacted];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of reverse.get(current) ?? []) {
      if (impacted.has(dependent)) continue;
      impacted.add(dependent);
      queue.push(dependent);
    }
  }

  const impactedList = [...impacted].sort();
  const artifactIds = new Set([
    ...previous.nodes.filter((node) => node.kind === "artifact").map((node) => node.id),
    ...next.nodes.filter((node) => node.kind === "artifact").map((node) => node.id),
  ]);
  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
    impacted: impactedList,
    impactedArtifacts: impactedList.filter((id) => artifactIds.has(id)),
  };
}

export function createWorldSeedIrPatchManifest(
  previous: WorldSeedIrIndex,
  next: WorldSeedIrIndex,
): WorldSeedIrPatchManifest {
  const previousById = new Map(previous.chunks.map((chunk) => [chunk.id, chunk]));
  const nextById = new Map(next.chunks.map((chunk) => [chunk.id, chunk]));
  const added: WorldSeedIrPatchChunk[] = [];
  const changed: WorldSeedIrPatchChunk[] = [];
  const removed: WorldSeedIrPatchChunk[] = [];
  let unchangedCount = 0;

  for (const chunk of next.chunks) {
    const before = previousById.get(chunk.id);
    if (!before) {
      added.push(patchChunk(chunk));
      continue;
    }
    if (
      !before.contentHash
      || !chunk.contentHash
      || before.contentHash !== chunk.contentHash
    ) {
      changed.push(patchChunk(chunk));
    } else {
      unchangedCount += 1;
    }
  }

  for (const chunk of previous.chunks) {
    if (!nextById.has(chunk.id)) removed.push(patchChunk(chunk));
  }

  return {
    format: WORLDSEED_IR_PATCH_FORMAT,
    version: WORLDSEED_IR_VERSION,
    fromRevisionHash: previous.revisionHash ?? null,
    toRevisionHash: next.revisionHash ?? null,
    globalChanged:
      !previous.globalHash
      || !next.globalHash
      || previous.globalHash !== next.globalHash,
    geometryGlobalChanged:
      !previous.geometryGlobalHash
      || !next.geometryGlobalHash
      || previous.geometryGlobalHash !== next.geometryGlobalHash,
    added: sortPatchChunks(added),
    changed: sortPatchChunks(changed),
    removed: sortPatchChunks(removed),
    unchangedCount,
  };
}

export function createWorldSeedIrIncrementalPlan(
  previous: WorldSeedIrIndex,
  next: WorldSeedIrIndex,
): WorldSeedIrIncrementalPlan {
  const patch = createWorldSeedIrPatchManifest(previous, next);
  const touched = [...patch.added, ...patch.changed, ...patch.removed];
  return {
    patch,
    changedChunkIds: new Set(touched.map((chunk) => chunk.id)),
    changedChunkPaths: new Set(touched.map((chunk) => chunk.path)),
  };
}

export function parseWorldSeedIrPatchManifest(input: string | unknown): WorldSeedIrPatchManifest {
  const value = typeof input === "string" ? JSON.parse(input) as unknown : input;
  const document = requireRecord(value, "WorldSeed IR patch");
  if (document["format"] !== WORLDSEED_IR_PATCH_FORMAT) {
    throw new Error(`Unsupported WorldSeed IR patch format: ${String(document["format"])}`);
  }
  if (document["version"] !== WORLDSEED_IR_VERSION) {
    throw new Error(`Unsupported WorldSeed IR patch version: ${String(document["version"])}`);
  }
  for (const key of ["added", "changed", "removed"] as const) {
    if (!Array.isArray(document[key])) throw new Error(`WorldSeed IR patch ${key} must be an array`);
  }
  return document as unknown as WorldSeedIrPatchManifest;
}

export function hashCanonicalJson(value: unknown): string {
  const text = serializeCanonicalJson(value, false);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x27d4eb2d);
    h3 = Math.imul(h3 ^ code, 0x165667b1);
    h4 = Math.imul(h4 ^ code, 0x9e3779b1);
  }
  return "ws1-" + [h1, h2, h3, h4]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

export function selectWorldSeedIrChunks(
  index: WorldSeedIrIndex,
  x: number,
  z: number,
  distanceMeters: number,
): WorldSeedIrChunkDescriptor[] {
  if (!(distanceMeters >= 0) || !Number.isFinite(distanceMeters)) {
    throw new Error("WorldSeed IR streaming distance must be a non-negative finite number");
  }
  return index.chunks.filter((chunk) => {
    const padding = chunk.size * Math.SQRT2 / 2;
    return Math.hypot(chunk.centerX - x, chunk.centerZ - z) <= distanceMeters + padding;
  });
}

export async function loadWorldSeedIrChunks(
  index: WorldSeedIrIndex,
  x: number,
  z: number,
  distanceMeters: number,
  read: (path: string) => Promise<string | unknown>,
): Promise<WorldSeedIrChunk[]> {
  const descriptors = selectWorldSeedIrChunks(index, x, z, distanceMeters);
  return await Promise.all(descriptors.map(async (descriptor) => {
    const chunk = parseWorldSeedIrChunk(await read(descriptor.path));
    if (chunk.tile.id !== descriptor.id) {
      throw new Error(`WorldSeed IR chunk id mismatch: expected ${descriptor.id}, received ${chunk.tile.id}`);
    }
    return chunk;
  }));
}

export function encodeWorldSeedIrPatchFiles(
  document: WorldSeedIrDocument,
  previousIndex: WorldSeedIrIndex,
  tileSizeMeters = WORLD_TILE_SIZE,
): {
  index: WorldSeedIrIndex;
  patch: WorldSeedIrPatchManifest;
  files: Record<string, string>;
} {
  const chunkSet = createWorldSeedIrChunkSet(document, tileSizeMeters);
  const patch = createWorldSeedIrPatchManifest(previousIndex, chunkSet.index);
  const chunkById = new Map(chunkSet.chunks.map((chunk) => [chunk.tile.id, chunk]));
  const files: Record<string, string> = {
    "worldseed-ir.index.json": serializeCanonicalJson(chunkSet.index),
    "worldseed-ir.patch.json": serializeCanonicalJson(patch),
  };

  for (const entry of [...patch.added, ...patch.changed]) {
    const chunk = chunkById.get(entry.id);
    if (!chunk) continue;
    files[entry.path] = serializeCanonicalJson(chunk);
  }

  const touchedChunkCount = patch.added.length + patch.changed.length + patch.removed.length;
  if (touchedChunkCount > 0) {
    files["worldseed-objects.json"] = serializeCanonicalJson(document.semantic);
    files["road-graph.json"] = serializeCanonicalJson(document.navigation.roadGraph);
    files["spawn-points.json"] = serializeCanonicalJson(document.navigation.spawnPoints);
  }

  if (patch.globalChanged) {
    files["worldseed.json"] = serializeCanonicalJson(document.metadata);
    files["drive-route.json"] = serializeCanonicalJson(document.navigation.driveRoute);
  }

  return {
    index: chunkSet.index,
    patch,
    files,
  };
}

export function encodeWorldSeedIrFiles(
  document: WorldSeedIrDocument,
  tileSizeMeters = WORLD_TILE_SIZE,
): Record<string, string> {
  const chunkSet = createWorldSeedIrChunkSet(document, tileSizeMeters);
  const files: Record<string, string> = {
    "worldseed.json": serializeCanonicalJson(document.metadata),
    "worldseed-objects.json": serializeCanonicalJson(document.semantic),
    "road-graph.json": serializeCanonicalJson(document.navigation.roadGraph),
    "spawn-points.json": serializeCanonicalJson(document.navigation.spawnPoints),
    "drive-route.json": serializeCanonicalJson(document.navigation.driveRoute),
    "worldseed-ir.json": serializeWorldSeedIr(document),
    "worldseed-ir.index.json": serializeCanonicalJson(chunkSet.index),
    "worldseed-ir.dependencies.json": serializeCanonicalJson(createWorldSeedIrDependencyGraph(document, tileSizeMeters)),
  };
  for (const chunk of chunkSet.chunks) {
    files[chunkPath(chunk.tile.x, chunk.tile.z)] = serializeCanonicalJson(chunk);
  }
  return files;
}

export function serializeCanonicalJson(value: unknown, pretty = true): string {
  return JSON.stringify(canonicalize(value), null, pretty ? 2 : undefined);
}

function distributeSpawnPoints(
  value: unknown,
  target: "vehicles" | "pedestrians",
  ensureChunk: (x: number, z: number) => MutableChunk,
): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const position = asRecord(record["position"]);
    const x = finiteNumber(position?.["x"]);
    const z = finiteNumber(position?.["z"]);
    if (x === undefined || z === undefined) continue;
    ensureChunk(x, z)[target].push(record);
  }
}

function edgeAnchor(edge: RoadGraphEdge): { x: number; z: number } {
  if (edge.path.length === 0) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  for (const point of edge.path) {
    x += point.x;
    z += point.z;
  }
  return { x: x / edge.path.length, z: z / edge.path.length };
}

function descriptorForChunk(chunk: WorldSeedIrChunk): WorldSeedIrChunkDescriptor {
  const half = chunk.tile.size / 2;
  return {
    id: chunk.tile.id,
    path: chunkPath(chunk.tile.x, chunk.tile.z),
    x: chunk.tile.x,
    z: chunk.tile.z,
    centerX: chunk.tile.centerX,
    centerZ: chunk.tile.centerZ,
    size: chunk.tile.size,
    bounds: {
      minX: chunk.tile.centerX - half,
      maxX: chunk.tile.centerX + half,
      minZ: chunk.tile.centerZ - half,
      maxZ: chunk.tile.centerZ + half,
    },
    counts: {
      semanticObjects: chunk.semantic.objects.length,
      roadNodes: chunk.navigation.roadGraph.nodes.length,
      roadEdges: chunk.navigation.roadGraph.edges.length,
      spawnPoints: chunk.navigation.spawnPoints.vehicles.length + chunk.navigation.spawnPoints.pedestrians.length,
    },
    contentHash: hashCanonicalJson(chunk),
  };
}

function dependencyNode(
  id: string,
  kind: WorldSeedIrDependencyKind,
  content: unknown,
  dependsOn: string[],
  chunkId?: string,
  metadata?: Record<string, string | number | boolean | null>,
): WorldSeedIrDependencyNode {
  return {
    id,
    kind,
    ...(chunkId ? { chunkId } : {}),
    contentHash: hashCanonicalJson(content),
    dependsOn: [...new Set(dependsOn)].sort(),
    ...(metadata ? { metadata } : {}),
  };
}

function stableIdPart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function patchChunk(chunk: WorldSeedIrChunkDescriptor): WorldSeedIrPatchChunk {
  return {
    id: chunk.id,
    path: chunk.path,
    contentHash: chunk.contentHash,
  };
}

function sortPatchChunks(chunks: WorldSeedIrPatchChunk[]): WorldSeedIrPatchChunk[] {
  return chunks.sort((first, second) => first.id.localeCompare(second.id));
}

function chunkPath(x: number, z: number): string {
  return `worldseed-ir/chunks/${x}_${z}.json`;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("WorldSeed IR cannot encode non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => entry === undefined ? null : canonicalize(entry));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      output[key] = canonicalize(entry);
    }
    return output;
  }
  if (value === undefined) return null;
  throw new Error(`WorldSeed IR cannot encode ${typeof value} values`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw new Error(`${label} must be an object`);
  return record;
}
