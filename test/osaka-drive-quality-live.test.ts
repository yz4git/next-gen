import { describe, expect, it } from "vitest";
import { OvertureTransportationProvider } from "../src/data/transportation";
import { buildRoadGraph } from "../src/generation/road-graph";
import { blendRoadAssist, RoadGuidanceIndex } from "../src/interaction/road-guidance";
import { stepDrivePhysics, type DrivePhysicsState } from "../src/interaction/drive-physics";
import type { LonLat, RoadGraph, RoadGraphEdge } from "../src/types";

const CENTER: LonLat = [135.52586, 34.68737];
const RADIUS = 650;

describe("Osaka Castle Drive Quality v1 live audit", () => {
  it("recovers a displaced car toward a real Overture road with hands-off steering", async () => {
    const roads = await new OvertureTransportationProvider().load(CENTER, RADIUS, AbortSignal.timeout(35_000));
    const graph = buildRoadGraph(roads, CENTER, RADIUS);
    expect(roads.length).toBeGreaterThan(100);
    expect(graph.edges.length).toBeGreaterThan(100);

    const edge = [...graph.edges]
      .filter((candidate) => candidate.lengthMeters > 28 && candidate.widthMeters >= 4)
      .sort((a, b) => b.lengthMeters - a.lengthMeters)[0] ?? [...graph.edges].sort((a, b) => b.lengthMeters - a.lengthMeters)[0]!;
    const start = edge.path[0]!;
    const end = edge.path.at(-1)!;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const heading = Math.atan2(dx, dz);
    const rightX = dz / length;
    const rightZ = -dx / length;
    const displacement = Math.max(7.5, edge.widthMeters * 0.72 + 2.5);
    const midX = (start.x + end.x) / 2;
    const midZ = (start.z + end.z) / 2;

    let state: DrivePhysicsState = {
      x: midX + rightX * displacement,
      z: midZ + rightZ * displacement,
      heading,
      speed: 4,
      steering: 0,
    };
    const guidance = new RoadGuidanceIndex(graph);
    const initialMatch = nearestRoad(graph, state.x, state.z)!;
    const initialError = initialMatch.distance;
    let minimumError = initialError;
    let maximumError = initialError;
    let assistPeak = 0;

    for (let step = 0; step < 360; step += 1) {
      const match = nearestRoad(graph, state.x, state.z)!;
      const hint = guidance.resolve(match, state);
      const shoulder = match.edge.widthMeters * 0.62 + 1.4;
      const offRoadAmount = Math.max(0, Math.min(1, (match.distance - match.edge.widthMeters * 0.38) / Math.max(2, shoulder)));
      const steering = blendRoadAssist(0, hint, offRoadAmount);
      assistPeak = Math.max(assistPeak, Math.abs(steering));
      state = stepDrivePhysics(state, { throttle: 0.35, steering, brake: false }, 1 / 60);
      const distance = nearestRoad(graph, state.x, state.z)!.distance;
      minimumError = Math.min(minimumError, distance);
      maximumError = Math.max(maximumError, distance);
    }

    const finalError = nearestRoad(graph, state.x, state.z)!.distance;
    console.log("OSAKA_DRIVE_QUALITY_V1", JSON.stringify({
      overtureRoads: roads.length,
      graphEdges: graph.edges.length,
      selectedEdgeMeters: Number(edge.lengthMeters.toFixed(1)),
      selectedRoadWidthMeters: Number(edge.widthMeters.toFixed(1)),
      initialErrorMeters: Number(initialError.toFixed(2)),
      minimumErrorMeters: Number(minimumError.toFixed(2)),
      finalErrorMeters: Number(finalError.toFixed(2)),
      maximumErrorMeters: Number(maximumError.toFixed(2)),
      assistPeak: Number(assistPeak.toFixed(3)),
      finalSpeedKph: Number((Math.abs(state.speed) * 3.6).toFixed(1)),
    }));

    expect(assistPeak).toBeGreaterThan(0.05);
    expect(minimumError).toBeLessThan(initialError * 0.72);
    expect(finalError).toBeLessThan(initialError);
  }, 50_000);
});

function nearestRoad(graph: RoadGraph, x: number, z: number): { edge: RoadGraphEdge; x: number; z: number; distance: number } | null {
  let nearest: { edge: RoadGraphEdge; x: number; z: number; distance: number } | null = null;
  for (const edge of graph.edges) {
    for (let index = 1; index < edge.path.length; index += 1) {
      const start = edge.path[index - 1]!;
      const end = edge.path[index]!;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared));
      const projectedX = start.x + dx * amount;
      const projectedZ = start.z + dz * amount;
      const distance = Math.hypot(x - projectedX, z - projectedZ);
      if (!nearest || distance < nearest.distance) nearest = { edge, x: projectedX, z: projectedZ, distance };
    }
  }
  return nearest;
}
