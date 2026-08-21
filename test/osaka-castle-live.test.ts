import { describe, expect, it } from "vitest";
import { OVERTURE_TRANSPORTATION_URL, TERRAIN_TILES_URL, TERRAIN_TILE_ZOOM } from "../src/config";
import { OvertureTransportationProvider } from "../src/data/transportation";
import { buildRoadGraph, createDriveRoute } from "../src/generation/road-graph";
import { resolveDriveCameraPose } from "../src/interaction/drive-camera";
import { stepDrivePhysics, type DrivePhysicsState } from "../src/interaction/drive-physics";
import type { LonLat } from "../src/types";

const CENTER: LonLat = [135.52586, 34.68737];
const RADIUS = 650;

describe("Osaka Castle live Drive audit", () => {
  it("loads the real Overture road network and runs a 120-second drive simulation", async () => {
    const roads = await new OvertureTransportationProvider().load(
      CENTER,
      RADIUS,
      AbortSignal.timeout(30_000),
    );
    const graph = buildRoadGraph(roads, CENTER, RADIUS);
    const route = createDriveRoute(graph, 20_260_821);

    expect(OVERTURE_TRANSPORTATION_URL).toContain("transportation.pmtiles");
    expect(roads.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(route).not.toBeNull();
    if (!route) return;

    const terrainUrl = terrainTileUrl(CENTER);
    const terrainResponse = await fetch(terrainUrl, { signal: AbortSignal.timeout(12_000) });
    expect(terrainResponse.ok).toBe(true);
    const terrainBytes = (await terrainResponse.arrayBuffer()).byteLength;
    expect(terrainBytes).toBeGreaterThan(100);

    const first = route.points[0]!;
    const second = route.points[1]!;
    let state: DrivePhysicsState = {
      x: first.x,
      z: first.z,
      heading: Math.atan2(second.x - first.x, second.z - first.z),
      speed: 0,
      steering: 0,
    };
    let waypoint = 1;
    let distanceTravelled = 0;
    let maximumSpeed = 0;
    let maximumRouteError = 0;

    for (let step = 0; step < 7_200 && waypoint < route.points.length; step += 1) {
      let target = route.points[waypoint]!;
      if (Math.hypot(target.x - state.x, target.z - state.z) < 9 && waypoint < route.points.length - 1) {
        waypoint += 1;
        target = route.points[waypoint]!;
      }
      const desiredHeading = Math.atan2(target.x - state.x, target.z - state.z);
      const headingError = angleDelta(desiredHeading, state.heading);
      const previous = state;
      state = stepDrivePhysics(
        state,
        {
          throttle: Math.abs(headingError) > 1 ? 0.24 : 0.82,
          steering: clamp(headingError * 1.55, -1, 1),
          brake: false,
        },
        1 / 60,
      );
      distanceTravelled += Math.hypot(state.x - previous.x, state.z - previous.z);
      maximumSpeed = Math.max(maximumSpeed, Math.abs(state.speed));
      if (step % 12 === 0) {
        maximumRouteError = Math.max(maximumRouteError, distanceToPolyline(state.x, state.z, route.points));
      }
    }

    const uphill = cameraStress(first.x, first.z, state.heading, 0.35);
    const downhill = cameraStress(first.x, first.z, state.heading, -0.35);

    console.log("OSAKA_CASTLE_DRIVE_AUDIT", JSON.stringify({
      center: CENTER,
      radius: RADIUS,
      overtureRoads: roads.length,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      routePoints: route.points.length,
      routeLengthMeters: Math.round(route.lengthMeters),
      terrainTileBytes: terrainBytes,
      simulatedSeconds: 120,
      simulatedDistanceMeters: Math.round(distanceTravelled),
      simulatedMaxSpeedKph: Math.round(maximumSpeed * 3.6),
      simulatedWaypoint: `${waypoint}/${route.points.length - 1}`,
      simulatedMaxRouteErrorMeters: Number(maximumRouteError.toFixed(2)),
      uphill35CameraClearanceMeters: Number(uphill.camera.toFixed(2)),
      uphill35TargetClearanceMeters: Number(uphill.target.toFixed(2)),
      downhill35CameraClearanceMeters: Number(downhill.camera.toFixed(2)),
      downhill35TargetClearanceMeters: Number(downhill.target.toFixed(2)),
    }));

    expect(route.lengthMeters).toBeGreaterThan(200);
    expect(distanceTravelled).toBeGreaterThan(200);
    expect(maximumSpeed).toBeGreaterThan(5);
    expect(uphill.camera).toBeGreaterThanOrEqual(3.19);
    expect(uphill.target).toBeGreaterThanOrEqual(1.34);
    expect(downhill.camera).toBeGreaterThanOrEqual(3.19);
    expect(downhill.target).toBeGreaterThanOrEqual(1.34);
  }, 55_000);
});

function cameraStress(x: number, z: number, heading: number, grade: number): { camera: number; target: number } {
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const ground = (sampleX: number, sampleZ: number): number =>
    ((sampleX - x) * forwardX + (sampleZ - z) * forwardZ) * grade;
  const pose = resolveDriveCameraPose({ x, z, heading, speed: 18 }, ground);
  return {
    camera: pose.desired.y - ground(pose.desired.x, pose.desired.z),
    target: pose.target.y - ground(pose.target.x, pose.target.z),
  };
}

function terrainTileUrl([longitude, latitude]: LonLat): string {
  const scale = 2 ** TERRAIN_TILE_ZOOM;
  const lat = clamp(latitude, -85.05112878, 85.05112878) * Math.PI / 180;
  const x = Math.floor(((longitude + 180) / 360) * scale);
  const y = Math.floor(((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * scale);
  return TERRAIN_TILES_URL
    .replace("{z}", String(TERRAIN_TILE_ZOOM))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

function distanceToPolyline(x: number, z: number, points: Array<{ x: number; z: number }>): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount = lengthSquared === 0
      ? 0
      : clamp(((x - start.x) * dx + (z - start.z) * dz) / lengthSquared, 0, 1);
    nearest = Math.min(nearest, Math.hypot(x - (start.x + dx * amount), z - (start.z + dz * amount)));
  }
  return nearest;
}

function angleDelta(target: number, current: number): number {
  let value = target - current;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
