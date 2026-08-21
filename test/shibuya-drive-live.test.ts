import { describe, expect, it } from "vitest";
import { OvertureTransportationProvider } from "../src/data/transportation";
import { buildRoadGraph } from "../src/generation/road-graph";
import { blendRoadAssist, RoadGuidanceIndex } from "../src/interaction/road-guidance";
import { stepDrivePhysics, type DrivePhysicsState } from "../src/interaction/drive-physics";
import type { LonLat, RoadGraph, RoadGraphEdge, RoadGraphNode } from "../src/types";

const CENTER: LonLat = [139.700544, 35.659503];
const RADIUS = 500;

describe("Shibuya Scramble Drive live audit", () => {
  it("crosses the dense central junction without losing the drivable network", async () => {
    const roads = await new OvertureTransportationProvider().load(CENTER, RADIUS, AbortSignal.timeout(35_000));
    const graph = buildRoadGraph(roads, CENTER, RADIUS);
    expect(roads.length).toBeGreaterThan(100);
    expect(graph.edges.length).toBeGreaterThan(100);

    const junction = selectCentralJunction(graph);
    expect(junction).not.toBeNull();
    if (!junction) return;

    const approach = selectApproach(graph, junction);
    expect(approach).not.toBeNull();
    if (!approach) return;

    const outer = approach.outer;
    const dx = junction.x - outer.x;
    const dz = junction.z - outer.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const startDistance = Math.min(32, Math.max(12, length * 0.68));
    const t = Math.max(0, 1 - startDistance / length);
    const baseX = outer.x + dx * t;
    const baseZ = outer.z + dz * t;
    const heading = Math.atan2(dx, dz);
    const rightX = dz / length;
    const rightZ = -dx / length;

    let state: DrivePhysicsState = {
      x: baseX + rightX * 3.2,
      z: baseZ + rightZ * 3.2,
      heading,
      speed: 6.5,
      steering: 0,
    };

    const guidance = new RoadGuidanceIndex(graph);
    let maxRoadError = 0;
    let minJunctionDistance = Number.POSITIVE_INFINITY;
    let maxJunctionDistanceAfterPass = 0;
    let assistPeak = 0;
    let previousEdge = "";
    let edgeTransitions = 0;
    let passedJunction = false;
    let minimumRoadError = Number.POSITIVE_INFINITY;

    for (let step = 0; step < 600; step += 1) {
      const match = nearestRoad(graph, state.x, state.z)!;
      if (previousEdge && match.edge.id !== previousEdge) edgeTransitions += 1;
      previousEdge = match.edge.id;
      const hint = guidance.resolve(match, state);
      const shoulder = match.edge.widthMeters * 0.62 + 1.4;
      const offRoadAmount = clamp((match.distance - match.edge.widthMeters * 0.38) / Math.max(2, shoulder), 0, 1);
      const steering = blendRoadAssist(0, hint, offRoadAmount);
      assistPeak = Math.max(assistPeak, Math.abs(steering));
      const speedKph = Math.abs(state.speed) * 3.6;
      const throttle = speedKph > Math.max(35, hint.recommendedSpeedKph * 1.08) ? 0.04 : 0.22;
      state = stepDrivePhysics(state, { throttle, steering, brake: false }, 1 / 60);

      const roadError = nearestRoad(graph, state.x, state.z)!.distance;
      maxRoadError = Math.max(maxRoadError, roadError);
      minimumRoadError = Math.min(minimumRoadError, roadError);
      const junctionDistance = Math.hypot(state.x - junction.x, state.z - junction.z);
      minJunctionDistance = Math.min(minJunctionDistance, junctionDistance);
      if (junctionDistance < 9) passedJunction = true;
      if (passedJunction) maxJunctionDistanceAfterPass = Math.max(maxJunctionDistanceAfterPass, junctionDistance);
    }

    const finalMatch = nearestRoad(graph, state.x, state.z)!;
    const oneWayEdges = graph.edges.filter((edge) => edge.oneWay !== "both").length;
    const nearbyHighDegree = graph.nodes.filter((node) => Math.hypot(node.x, node.z) < 120 && node.edgeIds.length >= 3).length;

    console.log("SHIBUYA_SCRAMBLE_DRIVE_AUDIT", JSON.stringify({
      center: CENTER,
      radius: RADIUS,
      overtureRoads: roads.length,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      oneWayEdges,
      nearbyHighDegreeJunctions: nearbyHighDegree,
      junctionDistanceFromCenterMeters: Number(Math.hypot(junction.x, junction.z).toFixed(2)),
      junctionDegree: junction.edgeIds.length,
      approachLengthMeters: Number(approach.edge.lengthMeters.toFixed(1)),
      minimumJunctionDistanceMeters: Number(minJunctionDistance.toFixed(2)),
      maximumDistanceAfterPassMeters: Number(maxJunctionDistanceAfterPass.toFixed(2)),
      minimumRoadErrorMeters: Number(minimumRoadError.toFixed(2)),
      maximumRoadErrorMeters: Number(maxRoadError.toFixed(2)),
      finalRoadErrorMeters: Number(finalMatch.distance.toFixed(2)),
      edgeTransitions,
      assistPeak: Number(assistPeak.toFixed(3)),
      finalSpeedKph: Number((Math.abs(state.speed) * 3.6).toFixed(1)),
    }));

    expect(junction.edgeIds.length).toBeGreaterThanOrEqual(3);
    expect(minJunctionDistance).toBeLessThan(10);
    expect(maxJunctionDistanceAfterPass).toBeGreaterThan(20);
    expect(maxRoadError).toBeLessThan(14);
    expect(finalMatch.distance).toBeLessThan(8);
    expect(edgeTransitions).toBeGreaterThan(0);
    expect(assistPeak).toBeLessThanOrEqual(1);
  }, 50_000);
});

function selectCentralJunction(graph: RoadGraph): RoadGraphNode | null {
  const candidates = graph.nodes
    .filter((node) => node.edgeIds.length >= 3 && Math.hypot(node.x, node.z) < 140)
    .sort((a, b) => {
      const scoreA = Math.hypot(a.x, a.z) - a.edgeIds.length * 8;
      const scoreB = Math.hypot(b.x, b.z) - b.edgeIds.length * 8;
      return scoreA - scoreB;
    });
  return candidates[0] ?? null;
}

function selectApproach(graph: RoadGraph, junction: RoadGraphNode): { edge: RoadGraphEdge; outer: RoadGraphNode } | null {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const candidates: Array<{ edge: RoadGraphEdge; outer: RoadGraphNode }> = [];
  for (const edgeId of junction.edgeIds) {
    const edge = graph.edges.find((candidate) => candidate.id === edgeId);
    if (!edge || edge.lengthMeters < 16) continue;
    if (edge.to === junction.id && edge.oneWay !== "backward") {
      const outer = nodeById.get(edge.from);
      if (outer) candidates.push({ edge, outer });
    }
    if (edge.from === junction.id && edge.oneWay !== "forward") {
      const outer = nodeById.get(edge.to);
      if (outer) candidates.push({ edge, outer });
    }
  }
  return candidates.sort((a, b) => b.edge.lengthMeters - a.edge.lengthMeters)[0] ?? null;
}

function nearestRoad(graph: RoadGraph, x: number, z: number): { edge: RoadGraphEdge; x: number; z: number; distance: number } | null {
  let nearest: { edge: RoadGraphEdge; x: number; z: number; distance: number } | null = null;
  for (const edge of graph.edges) {
    for (let index = 1; index < edge.path.length; index += 1) {
      const start = edge.path[index - 1]!;
      const end = edge.path[index]!;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      const amount = lengthSquared === 0 ? 0 : clamp(((x - start.x) * dx + (z - start.z) * dz) / lengthSquared, 0, 1);
      const projectedX = start.x + dx * amount;
      const projectedZ = start.z + dz * amount;
      const distance = Math.hypot(x - projectedX, z - projectedZ);
      if (!nearest || distance < nearest.distance) nearest = { edge, x: projectedX, z: projectedZ, distance };
    }
  }
  return nearest;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
