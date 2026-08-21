import { describe, expect, it } from "vitest";
import { unzlibSync } from "fflate";
import { TERRAIN_TILES_URL, TERRAIN_TILE_ZOOM } from "../src/config";
import { OpenStreetMapProvider } from "../src/data/openstreetmap";
import { buildRoadGraph, createDriveRoute } from "../src/generation/road-graph";
import { fromLocalMeters } from "../src/geo/coordinates";
import { resolveDriveCameraPose } from "../src/interaction/drive-camera";
import { stepDrivePhysics, type DrivePhysicsState } from "../src/interaction/drive-physics";
import { decodeTerrariumPixel } from "../src/terrain/elevation";
import type { LonLat } from "../src/types";

interface PngTile {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const CENTER: LonLat = [135.52586, 34.68737];
const RADIUS = 650;

describe("Osaka Castle live Drive audit", () => {
  it("loads real roads, generates a drive route, and keeps the chase camera above terrain", async () => {
    const osm = await new OpenStreetMapProvider().load(CENTER, RADIUS, AbortSignal.timeout(45_000));
    const graph = buildRoadGraph(osm.roads, CENTER, RADIUS);
    const route = createDriveRoute(graph, 20_260_821);

    expect(osm.roads.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(route).not.toBeNull();
    if (!route) return;

    const terrain = await loadTerrariumSampler(CENTER, RADIUS + 80);
    const elevations = route.points.map((point) => terrain(point.x, point.z));
    expect(elevations.every(Number.isFinite)).toBe(true);

    let maximumUphillGrade = 0;
    let maximumDownhillGrade = 0;
    for (let index = 1; index < route.points.length; index += 1) {
      const start = route.points[index - 1]!;
      const end = route.points[index]!;
      const horizontal = Math.hypot(end.x - start.x, end.z - start.z);
      if (horizontal < 0.5) continue;
      const grade = (elevations[index]! - elevations[index - 1]!) / horizontal;
      maximumUphillGrade = Math.max(maximumUphillGrade, grade);
      maximumDownhillGrade = Math.min(maximumDownhillGrade, grade);
    }

    let minimumDesiredClearance = Number.POSITIVE_INFINITY;
    let minimumTargetClearance = Number.POSITIVE_INFINITY;
    for (let index = 1; index < route.points.length; index += 1) {
      const start = route.points[index - 1]!;
      const end = route.points[index]!;
      const heading = Math.atan2(end.x - start.x, end.z - start.z);
      const pose = resolveDriveCameraPose(
        { x: start.x, z: start.z, heading, speed: 18 },
        terrain,
      );
      minimumDesiredClearance = Math.min(
        minimumDesiredClearance,
        pose.desired.y - terrain(pose.desired.x, pose.desired.z),
      );
      minimumTargetClearance = Math.min(
        minimumTargetClearance,
        pose.target.y - terrain(pose.target.x, pose.target.z),
      );
    }

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
    let simulatedMinimumCameraClearance = Number.POSITIVE_INFINITY;
    let simulatedMinimumTargetClearance = Number.POSITIVE_INFINITY;

    for (let step = 0; step < 7_200 && waypoint < route.points.length; step += 1) {
      let target = route.points[waypoint]!;
      if (Math.hypot(target.x - state.x, target.z - state.z) < 9 && waypoint < route.points.length - 1) {
        waypoint += 1;
        target = route.points[waypoint]!;
      }
      const desiredHeading = Math.atan2(target.x - state.x, target.z - state.z);
      const headingError = angleDelta(desiredHeading, state.heading);
      const steering = clamp(headingError * 1.55, -1, 1);
      const throttle = Math.abs(headingError) > 1.0 ? 0.25 : 0.82;
      const previous = state;
      state = stepDrivePhysics(state, { throttle, steering, brake: false }, 1 / 60);
      distanceTravelled += Math.hypot(state.x - previous.x, state.z - previous.z);
      maximumSpeed = Math.max(maximumSpeed, Math.abs(state.speed));

      if (step % 12 === 0) {
        maximumRouteError = Math.max(maximumRouteError, distanceToPolyline(state.x, state.z, route.points));
        const pose = resolveDriveCameraPose(state, terrain);
        simulatedMinimumCameraClearance = Math.min(
          simulatedMinimumCameraClearance,
          pose.desired.y - terrain(pose.desired.x, pose.desired.z),
        );
        simulatedMinimumTargetClearance = Math.min(
          simulatedMinimumTargetClearance,
          pose.target.y - terrain(pose.target.x, pose.target.z),
        );
      }
    }

    console.log("OSAKA_CASTLE_DRIVE_AUDIT", JSON.stringify({
      center: CENTER,
      radius: RADIUS,
      osmRoads: osm.roads.length,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      routePoints: route.points.length,
      routeLengthMeters: Math.round(route.lengthMeters),
      terrainMinMeters: Number(Math.min(...elevations).toFixed(2)),
      terrainMaxMeters: Number(Math.max(...elevations).toFixed(2)),
      maximumUphillGradePercent: Number((maximumUphillGrade * 100).toFixed(2)),
      maximumDownhillGradePercent: Number((maximumDownhillGrade * 100).toFixed(2)),
      minimumDesiredClearanceMeters: Number(minimumDesiredClearance.toFixed(2)),
      minimumTargetClearanceMeters: Number(minimumTargetClearance.toFixed(2)),
      simulatedSeconds: 120,
      simulatedDistanceMeters: Math.round(distanceTravelled),
      simulatedMaxSpeedKph: Math.round(maximumSpeed * 3.6),
      simulatedWaypoint: `${waypoint}/${route.points.length - 1}`,
      simulatedMaxRouteErrorMeters: Number(maximumRouteError.toFixed(2)),
      simulatedMinimumCameraClearanceMeters: Number(simulatedMinimumCameraClearance.toFixed(2)),
      simulatedMinimumTargetClearanceMeters: Number(simulatedMinimumTargetClearance.toFixed(2)),
    }));

    expect(route.lengthMeters).toBeGreaterThan(200);
    expect(minimumDesiredClearance).toBeGreaterThanOrEqual(3.19);
    expect(minimumTargetClearance).toBeGreaterThanOrEqual(1.34);
    expect(simulatedMinimumCameraClearance).toBeGreaterThanOrEqual(3.19);
    expect(simulatedMinimumTargetClearance).toBeGreaterThanOrEqual(1.34);
    expect(distanceTravelled).toBeGreaterThan(200);
    expect(maximumSpeed).toBeGreaterThan(5);
  }, 70_000);
});

async function loadTerrariumSampler(center: LonLat, radius: number): Promise<(x: number, z: number) => number> {
  const corners = [
    fromLocalMeters({ x: -radius, z: -radius }, center),
    fromLocalMeters({ x: radius, z: -radius }, center),
    fromLocalMeters({ x: -radius, z: radius }, center),
    fromLocalMeters({ x: radius, z: radius }, center),
  ];
  const tiles = corners.map((coordinate) => tileCoordinate(coordinate, TERRAIN_TILE_ZOOM));
  const minimumX = Math.min(...tiles.map((tile) => tile.x));
  const maximumX = Math.max(...tiles.map((tile) => tile.x));
  const minimumY = Math.min(...tiles.map((tile) => tile.y));
  const maximumY = Math.max(...tiles.map((tile) => tile.y));
  const decoded = new Map<string, PngTile>();

  for (let x = minimumX; x <= maximumX; x += 1) {
    for (let y = minimumY; y <= maximumY; y += 1) {
      const url = TERRAIN_TILES_URL
        .replace("{z}", String(TERRAIN_TILE_ZOOM))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      expect(response.ok).toBe(true);
      decoded.set(`${x}:${y}`, decodePng(new Uint8Array(await response.arrayBuffer())));
    }
  }

  return (localX: number, localZ: number): number => {
    const coordinate = fromLocalMeters({ x: localX, z: localZ }, center);
    const exact = exactTileCoordinate(coordinate, TERRAIN_TILE_ZOOM);
    const tile = decoded.get(`${Math.floor(exact.x)}:${Math.floor(exact.y)}`);
    if (!tile) throw new Error(`Missing terrain tile for ${localX.toFixed(1)},${localZ.toFixed(1)}`);
    const pixelX = clamp((exact.x - Math.floor(exact.x)) * tile.width, 0, tile.width - 1);
    const pixelY = clamp((exact.y - Math.floor(exact.y)) * tile.height, 0, tile.height - 1);
    return bilinearHeight(tile, pixelX, pixelY);
  };
}

function exactTileCoordinate(coordinate: LonLat, zoom: number): { x: number; y: number } {
  const scale = 2 ** zoom;
  const latitude = clamp(coordinate[1], -85.05112878, 85.05112878) * Math.PI / 180;
  return {
    x: ((coordinate[0] + 180) / 360) * scale,
    y: ((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2) * scale,
  };
}

function tileCoordinate(coordinate: LonLat, zoom: number): { x: number; y: number } {
  const exact = exactTileCoordinate(coordinate, zoom);
  return { x: Math.floor(exact.x), y: Math.floor(exact.y) };
}

function bilinearHeight(tile: PngTile, x: number, y: number): number {
  const left = Math.floor(x);
  const right = Math.min(tile.width - 1, left + 1);
  const top = Math.floor(y);
  const bottom = Math.min(tile.height - 1, top + 1);
  const horizontal = x - left;
  const vertical = y - top;
  const first = lerp(pixelHeight(tile, left, top), pixelHeight(tile, right, top), horizontal);
  const second = lerp(pixelHeight(tile, left, bottom), pixelHeight(tile, right, bottom), horizontal);
  return lerp(first, second, vertical);
}

function pixelHeight(tile: PngTile, x: number, y: number): number {
  const offset = (y * tile.width + x) * 4;
  return decodeTerrariumPixel(tile.pixels[offset]!, tile.pixels[offset + 1]!, tile.pixels[offset + 2]!);
}

function decodePng(bytes: Uint8Array): PngTile {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  signature.forEach((value, index) => expect(bytes[index]).toBe(value));
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "IHDR") {
      width = readU32(bytes, dataStart);
      height = readU32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      expect(bytes[dataStart + 12]).toBe(0);
    } else if (type === "IDAT") {
      idat.push(bytes.slice(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  expect(bitDepth).toBe(8);
  expect([2, 6]).toContain(colorType);
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const inflated = unzlibSync(concat(idat));
  const raw = new Uint8Array(rowBytes * height);
  let source = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[source++]!;
    const rowOffset = row * rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const value = inflated[source++]!;
      const left = column >= bytesPerPixel ? raw[rowOffset + column - bytesPerPixel]! : 0;
      const up = row > 0 ? raw[rowOffset - rowBytes + column]! : 0;
      const upLeft = row > 0 && column >= bytesPerPixel ? raw[rowOffset - rowBytes + column - bytesPerPixel]! : 0;
      const reconstructed = filter === 0 ? value
        : filter === 1 ? value + left
        : filter === 2 ? value + up
        : filter === 3 ? value + Math.floor((left + up) / 2)
        : filter === 4 ? value + paeth(left, up, upLeft)
        : Number.NaN;
      if (!Number.isFinite(reconstructed)) throw new Error(`Unsupported PNG filter ${filter}`);
      raw[rowOffset + column] = reconstructed & 0xff;
    }
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0, target = 0; index < raw.length; index += bytesPerPixel, target += 4) {
    pixels[target] = raw[index]!;
    pixels[target + 1] = raw[index + 1]!;
    pixels[target + 2] = raw[index + 2]!;
    pixels[target + 3] = bytesPerPixel === 4 ? raw[index + 3]! : 255;
  }
  return { width, height, pixels };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function paeth(left: number, up: number, upLeft: number): number {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function distanceToPolyline(x: number, z: number, points: Array<{ x: number; z: number }>): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount = lengthSquared <= 0
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

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
