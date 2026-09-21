import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "../types";

export interface JunctionArm {
  edgeId: string;
  roadId: string;
  directionX: number;
  directionZ: number;
  halfWidth: number;
  angle: number;
  halfAngle: number;
}

export interface RoadJunctionLayout {
  nodeId: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  arms: JunctionArm[];
}

export interface LocalRoadPoint {
  x: number;
  z: number;
}

export interface SidewalkCornerStrip {
  inner: LocalRoadPoint[];
  outer: LocalRoadPoint[];
}

const MIN_JUNCTION_RADIUS = 4.2;
const MAX_JUNCTION_RADIUS = 13.5;
const JUNCTION_MARGIN = 2.2;
const STRAIGHT_DOT_THRESHOLD = -0.985;

export function buildRoadJunctionLayouts(graph: RoadGraph): Map<string, RoadJunctionLayout> {
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const layouts = new Map<string, RoadJunctionLayout>();

  for (const node of graph.nodes) {
    const arms = node.edgeIds
      .map((edgeId) => edgeById.get(edgeId))
      .filter((edge): edge is RoadGraphEdge => Boolean(edge))
      .map((edge) => armForNode(node, edge))
      .filter((arm): arm is JunctionArm => Boolean(arm));

    if (!needsDedicatedJunction(arms)) continue;

    const radius = clamp(
      Math.max(...arms.map((arm) => arm.halfWidth), 2) + JUNCTION_MARGIN,
      MIN_JUNCTION_RADIUS,
      MAX_JUNCTION_RADIUS,
    );
    const withAngles = arms
      .map((arm) => ({
        ...arm,
        halfAngle: Math.atan2(arm.halfWidth + 0.12, radius),
      }))
      .sort((first, second) => first.angle - second.angle);

    layouts.set(node.id, {
      nodeId: node.id,
      x: node.x,
      y: node.y,
      z: node.z,
      radius,
      arms: withAngles,
    });
  }

  return layouts;
}

export function trimRoadEdge(
  edge: RoadGraphEdge,
  layouts: Map<string, RoadJunctionLayout>,
  extraTrim = 0,
): { start: LocalRoadPoint; end: LocalRoadPoint } | null {
  const first = edge.path[0];
  const last = edge.path.at(-1);
  if (!first || !last) return null;

  const dx = last.x - first.x;
  const dz = last.z - first.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.05) return null;

  let startTrim = layouts.has(edge.from) ? layouts.get(edge.from)!.radius + extraTrim : 0;
  let endTrim = layouts.has(edge.to) ? layouts.get(edge.to)!.radius + extraTrim : 0;
  const trimTotal = startTrim + endTrim;
  const maximumTrimTotal = length * 0.78;
  if (trimTotal > maximumTrimTotal && trimTotal > 0) {
    const scale = maximumTrimTotal / trimTotal;
    startTrim *= scale;
    endTrim *= scale;
  }

  const ux = dx / length;
  const uz = dz / length;
  return {
    start: { x: first.x + ux * startTrim, z: first.z + uz * startTrim },
    end: { x: last.x - ux * endTrim, z: last.z - uz * endTrim },
  };
}

export function roadJunctionPolygon(layout: RoadJunctionLayout): LocalRoadPoint[] {
  const candidates = layout.arms.flatMap((arm) => {
    const perpendicularX = -arm.directionZ;
    const perpendicularZ = arm.directionX;
    const centerX = layout.x + arm.directionX * layout.radius;
    const centerZ = layout.z + arm.directionZ * layout.radius;
    return [
      {
        x: centerX + perpendicularX * arm.halfWidth,
        z: centerZ + perpendicularZ * arm.halfWidth,
      },
      {
        x: centerX - perpendicularX * arm.halfWidth,
        z: centerZ - perpendicularZ * arm.halfWidth,
      },
    ];
  });
  return convexHull(candidates);
}

export function sidewalkCornerStrips(
  layout: RoadJunctionLayout,
  sidewalkWidth = 1.24,
): SidewalkCornerStrip[] {
  if (layout.arms.length < 2) return [];
  const result: SidewalkCornerStrip[] = [];
  const innerRadius = layout.radius + 0.18;
  const outerRadius = innerRadius + sidewalkWidth;

  for (let index = 0; index < layout.arms.length; index += 1) {
    const current = layout.arms[index]!;
    const next = layout.arms[(index + 1) % layout.arms.length]!;
    let startAngle = current.angle + current.halfAngle;
    let endAngle = next.angle - next.halfAngle;
    while (endAngle <= startAngle) endAngle += Math.PI * 2;
    const gap = endAngle - startAngle;
    if (gap < 0.16) continue;

    const segmentCount = Math.max(1, Math.ceil(gap / (Math.PI / 12)));
    const inner: LocalRoadPoint[] = [];
    const outer: LocalRoadPoint[] = [];
    for (let segment = 0; segment <= segmentCount; segment += 1) {
      const amount = segment / segmentCount;
      const angle = startAngle + gap * amount;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      inner.push({
        x: layout.x + cosine * innerRadius,
        z: layout.z + sine * innerRadius,
      });
      outer.push({
        x: layout.x + cosine * outerRadius,
        z: layout.z + sine * outerRadius,
      });
    }
    result.push({ inner, outer });
  }

  return result;
}

export function junctionCrosswalks(
  layout: RoadJunctionLayout,
): Array<{ start: LocalRoadPoint; end: LocalRoadPoint; directionX: number; directionZ: number; roadId: string }> {
  return layout.arms.map((arm) => {
    const acrossX = -arm.directionZ;
    const acrossZ = arm.directionX;
    const distance = layout.radius + 0.72;
    const centerX = layout.x + arm.directionX * distance;
    const centerZ = layout.z + arm.directionZ * distance;
    const half = Math.max(1.8, arm.halfWidth * 0.82);
    return {
      start: { x: centerX - acrossX * half, z: centerZ - acrossZ * half },
      end: { x: centerX + acrossX * half, z: centerZ + acrossZ * half },
      directionX: arm.directionX,
      directionZ: arm.directionZ,
      roadId: arm.roadId,
    };
  });
}

function armForNode(node: RoadGraphNode, edge: RoadGraphEdge): JunctionArm | null {
  const first = edge.path[0];
  const last = edge.path.at(-1);
  if (!first || !last) return null;
  const other = edge.from === node.id ? last : first;
  const dx = other.x - node.x;
  const dz = other.z - node.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.05) return null;
  const directionX = dx / length;
  const directionZ = dz / length;
  return {
    edgeId: edge.id,
    roadId: edge.roadId,
    directionX,
    directionZ,
    halfWidth: Math.max(1.2, edge.widthMeters / 2),
    angle: normalizedAngle(Math.atan2(directionZ, directionX)),
    halfAngle: 0,
  };
}

function needsDedicatedJunction(arms: JunctionArm[]): boolean {
  if (arms.length >= 3) return true;
  if (arms.length !== 2) return false;
  const dot = arms[0]!.directionX * arms[1]!.directionX + arms[0]!.directionZ * arms[1]!.directionZ;
  return dot > STRAIGHT_DOT_THRESHOLD;
}

function convexHull(points: LocalRoadPoint[]): LocalRoadPoint[] {
  if (points.length <= 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x === b.x ? a.z - b.z : a.x - b.x);
  const cross = (origin: LocalRoadPoint, a: LocalRoadPoint, b: LocalRoadPoint): number =>
    (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
  const lower: LocalRoadPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: LocalRoadPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function normalizedAngle(angle: number): number {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
