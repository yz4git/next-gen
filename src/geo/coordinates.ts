import { EARTH_RADIUS_METERS } from "../config";
import type { LonLat } from "../types";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface LocalPoint {
  x: number;
  z: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function toLocalMeters(point: LonLat, origin: LonLat): LocalPoint {
  const originLatRadians = origin[1] * DEG_TO_RAD;
  return {
    x:
      (point[0] - origin[0]) *
      DEG_TO_RAD *
      EARTH_RADIUS_METERS *
      Math.cos(originLatRadians),
    z: -(point[1] - origin[1]) * DEG_TO_RAD * EARTH_RADIUS_METERS,
  };
}

export function fromLocalMeters(point: LocalPoint, origin: LonLat): LonLat {
  const originLatRadians = origin[1] * DEG_TO_RAD;
  return [
    origin[0] +
      (point.x / (EARTH_RADIUS_METERS * Math.cos(originLatRadians))) * RAD_TO_DEG,
    origin[1] - (point.z / EARTH_RADIUS_METERS) * RAD_TO_DEG,
  ];
}

export function boundsAround(center: LonLat, radiusMeters: number): Bounds {
  const latitudeDelta = (radiusMeters / EARTH_RADIUS_METERS) * RAD_TO_DEG;
  const longitudeDelta =
    (radiusMeters /
      (EARTH_RADIUS_METERS * Math.cos(center[1] * DEG_TO_RAD))) *
    RAD_TO_DEG;

  return {
    west: center[0] - longitudeDelta,
    south: center[1] - latitudeDelta,
    east: center[0] + longitudeDelta,
    north: center[1] + latitudeDelta,
  };
}

export function distanceMeters(a: LonLat, b: LonLat): number {
  const latitude1 = a[1] * DEG_TO_RAD;
  const latitude2 = b[1] * DEG_TO_RAD;
  const latitudeDelta = (b[1] - a[1]) * DEG_TO_RAD;
  const longitudeDelta = (b[0] - a[0]) * DEG_TO_RAD;
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const haversine =
    sinLatitude * sinLatitude +
    Math.cos(latitude1) * Math.cos(latitude2) * sinLongitude * sinLongitude;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function parseCoordinate(value: string): LonLat | null {
  const cleaned = value.trim().replace(/[()]/g, "");
  const pieces = cleaned.split(/[\s,]+/).filter(Boolean).map(Number);
  if (pieces.length !== 2 || pieces.some((piece) => !Number.isFinite(piece))) {
    return null;
  }

  const first = pieces[0];
  const second = pieces[1];
  if (first === undefined || second === undefined) return null;

  // Human-facing coordinate inputs conventionally use latitude, longitude.
  const latitude = first;
  const longitude = second;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return [longitude, latitude];
}

export function parseCoordinateInput(value: string): LonLat | null {
  const plain = parseCoordinate(value);
  if (plain) return plain;

  let decoded = value.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the original value when a pasted URL contains malformed escapes.
  }

  const patterns = [
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /(?:query|q|ll)=(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    /[?&]center=(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match?.[1] || !match[2]) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return [longitude, latitude];
  }
  return null;
}

export function formatCoordinate(center: LonLat): string {
  return `${center[1].toFixed(6)}, ${center[0].toFixed(6)}`;
}
