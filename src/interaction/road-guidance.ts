import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "../types";
import { DRIVE_STEERING_POLARITY } from "./drive-physics";

export interface RoadGuidanceMatch {
  edge: RoadGraphEdge;
  x: number;
  z: number;
  distance: number;
}

export interface RoadGuidance {
  targetX: number;
  targetZ: number;
  targetHeading: number;
  headingError: number;
  lateralError: number;
  suggestedSteering: number;
  cornerSeverity: number;
  recommendedSpeedKph: number;
}

interface DirectedEdge {
  edge: RoadGraphEdge;
  from: RoadGraphNode;
  to: RoadGraphNode;
  reversed: boolean;
  heading: number;
}

/**
 * Cached road-graph guidance index. Maps are built once per loaded world, not
 * once per 60 Hz physics step, which keeps the predictive assist cheap on iPhone.
 */
export class RoadGuidanceIndex {
  private readonly nodeById: Map<string, RoadGraphNode>;
  private readonly edgeById: Map<string, RoadGraphEdge>;

  constructor(graph: RoadGraph) {
    this.nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    this.edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  }

  resolve(
    match: RoadGuidanceMatch,
    state: { x: number; z: number; heading: number; speed: number },
  ): RoadGuidance {
    const current = this.directedCurrentEdge(match.edge, state.heading);
    const lookAhead = clamp(16 + Math.abs(state.speed) * 0.85, 16, 42);
    const target = this.walkAhead(current, match.x, match.z, lookAhead);
    const targetHeading = Math.atan2(target.x - state.x, target.z - state.z);
    const headingError = angleDelta(targetHeading, state.heading);

    const directionX = Math.sin(current.heading);
    const directionZ = Math.cos(current.heading);
    const lateralError = (state.x - match.x) * directionZ - (state.z - match.z) * directionX;
    const width = Math.max(3.2, match.edge.widthMeters);
    const lateralCorrection = clamp(-lateralError / (width * 0.72), -0.9, 0.9);
    const headingCorrection = clamp(headingError * 0.95, -0.9, 0.9);
    const physicalSteering = clamp(headingCorrection + lateralCorrection * 0.52, -1, 1);
    const suggestedSteering = physicalSteering * DRIVE_STEERING_POLARITY;
    const cornerSeverity = clamp(Math.abs(headingError) / 1.15, 0, 1);
    const roadLimit = clamp(match.edge.speedLimitKph || 35, 15, 110);
    const recommendedSpeedKph = Math.max(15, roadLimit * (1 - cornerSeverity * 0.52));

    return {
      targetX: target.x,
      targetZ: target.z,
      targetHeading,
      headingError,
      lateralError,
      suggestedSteering,
      cornerSeverity,
      recommendedSpeedKph,
    };
  }

  private directedCurrentEdge(edge: RoadGraphEdge, heading: number): DirectedEdge {
    const from = this.nodeById.get(edge.from) ?? fallbackNode(edge.path[0], edge.from);
    const to = this.nodeById.get(edge.to) ?? fallbackNode(edge.path.at(-1), edge.to);
    const forwardHeading = Math.atan2(to.x - from.x, to.z - from.z);
    const reverseHeading = normalizeAngle(forwardHeading + Math.PI);
    const forwardAllowed = edge.oneWay !== "backward";
    const reverseAllowed = edge.oneWay !== "forward";
    let reversed = Math.abs(angleDelta(reverseHeading, heading)) < Math.abs(angleDelta(forwardHeading, heading));
    if (reversed && !reverseAllowed) reversed = false;
    if (!reversed && !forwardAllowed && reverseAllowed) reversed = true;
    return reversed
      ? { edge, from: to, to: from, reversed: true, heading: reverseHeading }
      : { edge, from, to, reversed: false, heading: forwardHeading };
  }

  private walkAhead(
    current: DirectedEdge,
    startX: number,
    startZ: number,
    distance: number,
  ): { x: number; z: number } {
    let x = startX;
    let z = startZ;
    let remaining = distance;
    let active = current;
    let activeHeading = current.heading;
    const visited = new Set<string>();

    for (let hop = 0; hop < 6 && remaining > 0.1; hop += 1) {
      const dx = active.to.x - x;
      const dz = active.to.z - z;
      const segment = Math.hypot(dx, dz);
      if (segment >= remaining && segment > 0.001) {
        return { x: x + (dx / segment) * remaining, z: z + (dz / segment) * remaining };
      }
      if (segment > 0.001) {
        x = active.to.x;
        z = active.to.z;
        remaining -= segment;
        activeHeading = Math.atan2(dx, dz);
      }
      visited.add(active.edge.id);
      const next = this.chooseContinuation(active.to, active.edge.id, activeHeading, visited);
      if (!next) break;
      active = next;
      x = active.from.x;
      z = active.from.z;
      activeHeading = active.heading;
    }
    return { x, z };
  }

  private chooseContinuation(
    node: RoadGraphNode,
    previousEdgeId: string,
    heading: number,
    visited: Set<string>,
  ): DirectedEdge | null {
    const candidates: Array<DirectedEdge & { score: number }> = [];
    for (const edgeId of node.edgeIds) {
      if (edgeId === previousEdgeId) continue;
      const edge = this.edgeById.get(edgeId);
      if (!edge) continue;
      const from = this.nodeById.get(edge.from);
      const to = this.nodeById.get(edge.to);
      if (!from || !to) continue;
      if (edge.from === node.id && edge.oneWay !== "backward") {
        const candidateHeading = Math.atan2(to.x - from.x, to.z - from.z);
        candidates.push({
          edge,
          from,
          to,
          reversed: false,
          heading: candidateHeading,
          score: continuationScore(candidateHeading, heading, edge, visited),
        });
      }
      if (edge.to === node.id && edge.oneWay !== "forward") {
        const candidateHeading = Math.atan2(from.x - to.x, from.z - to.z);
        candidates.push({
          edge,
          from: to,
          to: from,
          reversed: true,
          heading: candidateHeading,
          score: continuationScore(candidateHeading, heading, edge, visited),
        });
      }
    }
    return candidates.sort((first, second) => first.score - second.score)[0] ?? null;
  }
}

function continuationScore(heading: number, currentHeading: number, edge: RoadGraphEdge, visited: Set<string>): number {
  const turn = Math.abs(angleDelta(heading, currentHeading));
  const classPenalty = ["service", "track"].includes(edge.class) ? 0.22 : 0;
  const revisitPenalty = visited.has(edge.id) ? 1.1 : 0;
  return turn + classPenalty + revisitPenalty;
}

function fallbackNode(point: { x: number; y?: number; z: number } | undefined, id: string): RoadGraphNode {
  return { id, x: point?.x ?? 0, y: point?.y ?? 0, z: point?.z ?? 0, edgeIds: [] };
}

export function blendRoadAssist(manualSteering: number, guidance: RoadGuidance, offRoadAmount: number): number {
  const manual = clamp(manualSteering, -1, 1);
  const playerAuthority = Math.abs(manual);
  const baseStrength = 0.24 + clamp(offRoadAmount, 0, 1) * 0.46;
  const speedStrength = 0.88 + guidance.cornerSeverity * 0.18;
  const assist = guidance.suggestedSteering * baseStrength * speedStrength * (1 - playerAuthority * 0.82);
  return clamp(manual + assist, -1, 1);
}

function angleDelta(target: number, current: number): number {
  return normalizeAngle(target - current);
}

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
