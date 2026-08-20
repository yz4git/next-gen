import { toLocalMeters } from "../geo/coordinates";
import { elevationAt } from "../terrain/elevation";
import type {
  DriveRoute,
  DriveSpawn,
  ElevationGrid,
  LonLat,
  RoadFeature,
  RoadGraph,
  RoadGraphEdge,
  RoadGraphNode,
  RoadGraphPoint,
} from "../types";

const DRIVABLE_CLASSES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "living_street",
  "unclassified",
  "service",
  "track",
  "road",
  "unknown",
]);

interface PathEntry {
  offset: number;
  point: { x: number; z: number };
  nodeKey?: string;
}

interface DirectedTraversal {
  edge: RoadGraphEdge;
  next: string;
  reversed: boolean;
}

export function buildRoadGraph(
  roads: RoadFeature[],
  center: LonLat,
  radius: number,
  terrain?: ElevationGrid,
): RoadGraph {
  const nodes = new Map<string, RoadGraphNode>();
  const edges: RoadGraphEdge[] = [];

  for (const road of roads) {
    if (!isDrivableRoad(road)) continue;
    const localPath = road.path.map((coordinate) => toLocalMeters(coordinate, center));
    const clipped = localPath.filter((point) => Math.hypot(point.x, point.z) <= radius + 120);
    if (clipped.length < 2) continue;
    const entries = pathEntries(road, clipped, center);
    for (let index = 1; index < entries.length; index += 1) {
      const first = entries[index - 1]!;
      const second = entries[index]!;
      const lengthMeters = Math.hypot(second.point.x - first.point.x, second.point.z - first.point.z);
      if (lengthMeters < 0.75) continue;
      const from = ensureNode(nodes, first, terrain);
      const to = ensureNode(nodes, second, terrain);
      if (from.id === to.id) continue;
      const edge: RoadGraphEdge = {
        id: `edge:${road.id}:${index - 1}`,
        roadId: road.id,
        from: from.id,
        to: to.id,
        path: [pointFromNode(from), pointFromNode(to)],
        lengthMeters,
        class: road.kind,
        subclass: road.subclass,
        name: road.name,
        widthMeters: road.width,
        surface: road.surface ?? defaultSurface(road.kind),
        oneWay: road.oneWay ?? "both",
        speedLimitKph: road.speedLimitKph ?? defaultSpeedLimit(road.kind),
      };
      edges.push(edge);
      from.edgeIds.push(edge.id);
      to.edgeIds.push(edge.id);
    }
  }

  const connectedNodeIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  return {
    schemaVersion: "1.0",
    generator: "WorldSeed Drive Any City",
    coordinateSystem: "local meters; X east, Y up, Z south",
    nodes: [...nodes.values()].filter((node) => connectedNodeIds.has(node.id)),
    edges,
  };
}

export function isDrivableRoad(road: RoadFeature): boolean {
  return DRIVABLE_CLASSES.has(road.kind) && !road.kind.startsWith("railway:") && road.kind !== "waterway";
}

export function findNearestRoadPoint(
  graph: RoadGraph,
  position: { x: number; z: number } = { x: 0, z: 0 },
): DriveSpawn | null {
  let nearest: DriveSpawn | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const edge of graph.edges) {
    for (let index = 1; index < edge.path.length; index += 1) {
      const start = edge.path[index - 1]!;
      const end = edge.path[index]!;
      const projection = projectPoint(position, start, end);
      if (projection.distance >= nearestDistance) continue;
      nearestDistance = projection.distance;
      nearest = {
        edgeId: edge.id,
        position: {
          x: projection.x,
          y: start.y + (end.y - start.y) * projection.t,
          z: projection.z,
        },
        headingRadians: Math.atan2(end.x - start.x, end.z - start.z),
      };
    }
  }
  return nearest;
}

export function createDriveRoute(graph: RoadGraph, seed = 1): DriveRoute | null {
  if (graph.edges.length === 0 || graph.nodes.length < 2) return null;
  const adjacency = buildAdjacency(graph);
  const start = [...graph.nodes]
    .filter((node) => (adjacency.get(node.id)?.length ?? 0) >= 2)
    .sort((first, second) => Math.hypot(first.x, first.z) - Math.hypot(second.x, second.z))[0]
    ?? [...graph.nodes].sort((first, second) => Math.hypot(first.x, first.z) - Math.hypot(second.x, second.z))[0]!;
  const worldRadius = Math.max(100, ...graph.nodes.map((node) => Math.hypot(node.x, node.z)));
  const targetLength = Math.max(420, Math.min(2_200, worldRadius * 3.1));
  const random = seededRandom(seed);
  const traversals: DirectedTraversal[] = [];
  const visited = new Map<string, number>();
  let current = start.id;
  let previous = "";
  let lengthMeters = 0;

  for (let step = 0; step < 240 && lengthMeters < targetLength; step += 1) {
    const options = adjacency.get(current) ?? [];
    if (options.length === 0) break;
    const candidates = options.filter((option) => option.next !== previous || options.length === 1);
    const ranked = candidates
      .map((option) => ({ option, score: (visited.get(option.edge.id) ?? 0) * 4 + random() }))
      .sort((first, second) => first.score - second.score);
    const selected = ranked[0]?.option;
    if (!selected) break;
    traversals.push(selected);
    visited.set(selected.edge.id, (visited.get(selected.edge.id) ?? 0) + 1);
    lengthMeters += selected.edge.lengthMeters;
    previous = current;
    current = selected.next;
  }

  if (traversals.length === 0) return null;
  const points: RoadGraphPoint[] = [];
  for (const traversal of traversals) {
    const oriented = traversal.reversed ? [...traversal.edge.path].reverse() : traversal.edge.path;
    if (points.length === 0) points.push(...oriented);
    else points.push(...oriented.slice(1));
  }
  const compacted = compactPath(points);
  const checkpoints = checkpointsAlong(compacted, Math.max(65, Math.min(125, lengthMeters / 9)));
  const actualLength = polylineLength(compacted);
  const routeId = `drive-${Math.abs(seed).toString(36)}-${hashIds(traversals.map((item) => item.edge.id)).toString(36)}`;
  return {
    id: routeId,
    seed,
    edgeIds: traversals.map((item) => item.edge.id),
    points: compacted,
    checkpoints,
    lengthMeters: actualLength,
  };
}

export function driveSpawnForRoute(route: DriveRoute): DriveSpawn | null {
  const start = route.points[0];
  const next = route.points[1];
  if (!start || !next) return null;
  return {
    edgeId: route.edgeIds[0] ?? "",
    position: { ...start },
    headingRadians: Math.atan2(next.x - start.x, next.z - start.z),
  };
}

function pathEntries(road: RoadFeature, path: Array<{ x: number; z: number }>, center: LonLat): PathEntry[] {
  const offsets: number[] = [0];
  for (let index = 1; index < path.length; index += 1) {
    offsets.push(offsets[index - 1]! + Math.hypot(path[index]!.x - path[index - 1]!.x, path[index]!.z - path[index - 1]!.z));
  }
  const entries: PathEntry[] = path.map((point, index) => ({ point, offset: offsets[index]! }));
  const total = offsets.at(-1) ?? 0;
  for (const connector of road.connectors ?? []) {
    const supplied = connector.position ? toLocalMeters(connector.position, center) : undefined;
    const projected = supplied ? projectToPolyline(supplied, path, offsets) : undefined;
    const targetOffset = projected && projected.distance < 24 ? projected.offset : connector.at * total;
    const point = projected && projected.distance < 24
      ? { x: projected.x, z: projected.z }
      : interpolateLocal(path, offsets, targetOffset);
    entries.push({ offset: targetOffset, point, nodeKey: `connector:${connector.id}` });
  }
  entries.sort((first, second) => first.offset - second.offset);
  const deduped: PathEntry[] = [];
  for (const entry of entries) {
    const previous = deduped.at(-1);
    if (previous && Math.abs(previous.offset - entry.offset) < 0.55) {
      if (entry.nodeKey) deduped[deduped.length - 1] = entry;
      continue;
    }
    deduped.push(entry);
  }
  return deduped;
}

function ensureNode(
  nodes: Map<string, RoadGraphNode>,
  entry: PathEntry,
  terrain?: ElevationGrid,
): RoadGraphNode {
  const key = entry.nodeKey ?? quantizedKey(entry.point.x, entry.point.z);
  const existing = nodes.get(key);
  if (existing) return existing;
  const node: RoadGraphNode = {
    id: key,
    x: entry.point.x,
    y: elevationAt(terrain, entry.point.x, entry.point.z) + 0.09,
    z: entry.point.z,
    edgeIds: [],
  };
  nodes.set(key, node);
  return node;
}

function quantizedKey(x: number, z: number): string {
  const grid = 1.25;
  return `node:${Math.round(x / grid)}:${Math.round(z / grid)}`;
}

function pointFromNode(node: RoadGraphNode): RoadGraphPoint {
  return { x: node.x, y: node.y, z: node.z };
}

function projectToPolyline(
  point: { x: number; z: number },
  path: Array<{ x: number; z: number }>,
  offsets: number[],
): { x: number; z: number; offset: number; distance: number } | undefined {
  let nearest: { x: number; z: number; offset: number; distance: number } | undefined;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1]!;
    const end = path[index]!;
    const projection = projectPoint(point, start, end);
    if (nearest && projection.distance >= nearest.distance) continue;
    nearest = {
      x: projection.x,
      z: projection.z,
      distance: projection.distance,
      offset: offsets[index - 1]! + Math.hypot(end.x - start.x, end.z - start.z) * projection.t,
    };
  }
  return nearest;
}

function projectPoint(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number },
): { x: number; z: number; t: number; distance: number } {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  const x = start.x + dx * t;
  const z = start.z + dz * t;
  return { x, z, t, distance: Math.hypot(point.x - x, point.z - z) };
}

function interpolateLocal(
  path: Array<{ x: number; z: number }>,
  offsets: number[],
  target: number,
): { x: number; z: number } {
  for (let index = 1; index < offsets.length; index += 1) {
    if (offsets[index]! < target) continue;
    const start = path[index - 1]!;
    const end = path[index]!;
    const length = Math.max(0.001, offsets[index]! - offsets[index - 1]!);
    const amount = (target - offsets[index - 1]!) / length;
    return { x: start.x + (end.x - start.x) * amount, z: start.z + (end.z - start.z) * amount };
  }
  return { ...(path.at(-1) ?? { x: 0, z: 0 }) };
}

function buildAdjacency(graph: RoadGraph): Map<string, DirectedTraversal[]> {
  const adjacency = new Map<string, DirectedTraversal[]>();
  const add = (node: string, traversal: DirectedTraversal): void => {
    const options = adjacency.get(node) ?? [];
    options.push(traversal);
    adjacency.set(node, options);
  };
  for (const edge of graph.edges) {
    if (edge.oneWay !== "backward") add(edge.from, { edge, next: edge.to, reversed: false });
    if (edge.oneWay !== "forward") add(edge.to, { edge, next: edge.from, reversed: true });
  }
  return adjacency;
}

function compactPath(points: RoadGraphPoint[]): RoadGraphPoint[] {
  const compacted: RoadGraphPoint[] = [];
  for (const point of points) {
    const previous = compacted.at(-1);
    if (previous && Math.hypot(point.x - previous.x, point.z - previous.z) < 0.3) continue;
    compacted.push({ ...point });
  }
  return compacted;
}

function checkpointsAlong(points: RoadGraphPoint[], spacing: number): RoadGraphPoint[] {
  if (points.length < 2) return [...points];
  const checkpoints: RoadGraphPoint[] = [{ ...points[0]! }];
  let carried = 0;
  for (let index = 1; index < points.length; index += 1) {
    let start = { ...points[index - 1]! };
    const end = points[index]!;
    let segment = distance3(start, end);
    while (carried + segment >= spacing) {
      const amount = (spacing - carried) / Math.max(0.001, segment);
      const checkpoint = lerpPoint(start, end, amount);
      checkpoints.push(checkpoint);
      start = checkpoint;
      segment = distance3(start, end);
      carried = 0;
    }
    carried += segment;
  }
  const finish = points.at(-1)!;
  if (distance3(checkpoints.at(-1)!, finish) > spacing * 0.35) checkpoints.push({ ...finish });
  else checkpoints[checkpoints.length - 1] = { ...finish };
  return checkpoints;
}

function polylineLength(points: RoadGraphPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance3(points[index - 1]!, points[index]!);
  return length;
}

function distance3(first: RoadGraphPoint, second: RoadGraphPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y, second.z - first.z);
}

function lerpPoint(first: RoadGraphPoint, second: RoadGraphPoint, amount: number): RoadGraphPoint {
  return {
    x: first.x + (second.x - first.x) * amount,
    y: first.y + (second.y - first.y) * amount,
    z: first.z + (second.z - first.z) * amount,
  };
}

function seededRandom(seed: number): () => number {
  let state = (Math.trunc(seed) || 1) >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function hashIds(ids: string[]): number {
  let hash = 2_166_136_261;
  for (const id of ids) {
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return hash >>> 0;
}

function defaultSurface(kind: string): string {
  return kind === "track" ? "unpaved" : "paved";
}

function defaultSpeedLimit(kind: string): number {
  if (kind === "motorway") return 100;
  if (kind === "trunk") return 80;
  if (kind === "primary") return 60;
  if (kind === "secondary") return 50;
  if (kind === "tertiary") return 45;
  if (kind === "living_street" || kind === "service") return 20;
  return 30;
}
