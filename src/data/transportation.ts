import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { PMTiles } from "pmtiles";
import {
  OVERTURE_RELEASE,
  OVERTURE_TRANSPORTATION_TILE_ZOOM,
  OVERTURE_TRANSPORTATION_URL,
} from "../config";
import { boundsAround, distanceMeters } from "../geo/coordinates";
import { tilesForBounds } from "../geo/tiles";
import type { LonLat, RoadConnectorReference, RoadFeature } from "../types";
import { coordinateCacheKey, getCached, setCached } from "./cache";

type PrimitiveProperties = Record<string, string | number | boolean | undefined>;

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

interface DecodedTransportationTile {
  roads: RoadFeature[];
  connectors: Map<string, LonLat>;
}

const archive = new PMTiles(OVERTURE_TRANSPORTATION_URL);

export class OvertureTransportationProvider {
  async load(center: LonLat, radius: number, signal?: AbortSignal): Promise<RoadFeature[]> {
    const cacheKey = coordinateCacheKey(`overture-transport-${OVERTURE_RELEASE}`, center[0], center[1], radius);
    const cached = await getCached<RoadFeature[]>(cacheKey);
    if (cached) return cached;

    const bounds = boundsAround(center, radius + 180);
    const tiles = tilesForBounds(bounds, OVERTURE_TRANSPORTATION_TILE_ZOOM);
    const decoded = await Promise.all(tiles.map(async ({ x, y, z }) => {
      const response = await archive.getZxy(z, x, y, signal);
      if (!response) return { roads: [], connectors: new Map<string, LonLat>() };
      return decodeTransportationTile(new Uint8Array(response.data), x, y, z, center, radius + 140);
    }));

    const connectors = new Map<string, LonLat>();
    const fragments = new Map<string, RoadFeature[]>();
    for (const tile of decoded) {
      for (const [id, position] of tile.connectors) connectors.set(id, position);
      for (const road of tile.roads) {
        const list = fragments.get(road.id) ?? [];
        list.push(road);
        fragments.set(road.id, list);
      }
    }

    const roads = [...fragments.values()].map((items) => {
      const base = items[0]!;
      const path = stitchPaths(items.map((item) => item.path));
      const connectorRefs = new Map<string, RoadConnectorReference>();
      for (const item of items) {
        for (const connector of item.connectors ?? []) connectorRefs.set(connector.id, connector);
      }
      const roadConnectors = [...connectorRefs.values()]
        .map((connector) => ({
          ...connector,
          position: connectors.get(connector.id) ?? interpolatePath(path, connector.at),
        }))
        .sort((first, second) => first.at - second.at);
      return { ...base, path, connectors: roadConnectors };
    }).filter((road) => road.path.length >= 2 && pathTouchesRadius(road.path, center, radius + 100));

    if (roads.length > 0) await setCached(cacheKey, roads);
    return roads;
  }
}

export function decodeTransportationTile(
  data: Uint8Array,
  tileX: number,
  tileY: number,
  zoom: number,
  center: LonLat,
  radius: number,
): DecodedTransportationTile {
  const vectorTile = new VectorTile(new Pbf(data));
  const connectors = new Map<string, LonLat>();
  const roads: RoadFeature[] = [];

  for (const [layerName, layer] of Object.entries(vectorTile.layers)) {
    if (layerName !== "connector" && layerName !== "connectors") continue;
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      const geoJson = feature.toGeoJSON(tileX, tileY, zoom);
      const geometry = geoJson.geometry as GeoJsonGeometry;
      const position = pointFromGeometry(geometry);
      if (!position || distanceMeters(center, position) > radius + 120) continue;
      const properties = feature.properties as PrimitiveProperties;
      const id = toText(properties.id ?? properties["@id"] ?? feature.id);
      if (id) connectors.set(id, position);
    }
  }

  for (const [layerName, layer] of Object.entries(vectorTile.layers)) {
    if (layerName !== "segment" && layerName !== "segments") continue;
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      const properties = feature.properties as PrimitiveProperties;
      if (properties.subtype !== "road") continue;
      const geoJson = feature.toGeoJSON(tileX, tileY, zoom);
      const path = lineFromGeometry(geoJson.geometry as GeoJsonGeometry);
      if (path.length < 2 || !pathTouchesRadius(path, center, radius)) continue;
      const id = toText(properties.id ?? properties["@id"] ?? feature.id) ?? `${tileX}:${tileY}:${index}`;
      const kind = toText(properties.class) ?? "unknown";
      roads.push({
        id,
        path,
        kind,
        subclass: toText(properties.subclass),
        width: roadWidth(properties, kind),
        name: transportationName(properties),
        surface: firstRuleValue(properties.road_surface) ?? defaultSurface(kind),
        oneWay: parseOneWay(properties.access_restrictions),
        speedLimitKph: parseSpeedLimit(properties.speed_limits) ?? defaultSpeedLimit(kind),
        connectors: parseConnectorReferences(properties.connectors),
        source: "overture",
      });
    }
  }

  return { roads, connectors };
}

export function parseConnectorReferences(value: string | number | boolean | undefined): RoadConnectorReference[] {
  const rules = parseJsonArray(value);
  return rules.flatMap((rule) => {
    const id = typeof rule.connector_id === "string" ? rule.connector_id : undefined;
    const at = typeof rule.at === "number" ? rule.at : Number.parseFloat(String(rule.at ?? ""));
    return id && Number.isFinite(at) ? [{ id, at: Math.max(0, Math.min(1, at)) }] : [];
  });
}

export function parseOneWay(value: string | number | boolean | undefined): RoadFeature["oneWay"] {
  const restrictions = parseJsonArray(value);
  const deniesForward = restrictions.some((rule) =>
    rule.access_type === "denied" && objectValue(rule.when, "heading") === "forward",
  );
  const deniesBackward = restrictions.some((rule) =>
    rule.access_type === "denied" && objectValue(rule.when, "heading") === "backward",
  );
  if (deniesBackward && !deniesForward) return "forward";
  if (deniesForward && !deniesBackward) return "backward";
  return "both";
}

export function parseSpeedLimit(value: string | number | boolean | undefined): number | undefined {
  for (const rule of parseJsonArray(value)) {
    if (!rule.max_speed || typeof rule.max_speed !== "object") continue;
    const speed = rule.max_speed as Record<string, unknown>;
    const numeric = typeof speed.value === "number" ? speed.value : Number.parseFloat(String(speed.value ?? ""));
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    return speed.unit === "mph" ? numeric * 1.609344 : numeric;
  }
  return undefined;
}

function parseJsonArray(value: string | number | boolean | undefined): Array<Record<string, unknown>> {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      : [];
  } catch {
    return [];
  }
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function pointFromGeometry(geometry: GeoJsonGeometry): LonLat | undefined {
  if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return undefined;
  const [longitude, latitude] = geometry.coordinates as number[];
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude!, latitude!] : undefined;
}

function lineFromGeometry(geometry: GeoJsonGeometry): LonLat[] {
  if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    return toPath(geometry.coordinates as number[][]);
  }
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    const paths = (geometry.coordinates as number[][][]).map(toPath);
    return paths.sort((first, second) => pathLength(second) - pathLength(first))[0] ?? [];
  }
  return [];
}

function toPath(points: number[][]): LonLat[] {
  return points.flatMap((point) =>
    point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
      ? [[point[0]!, point[1]!] as LonLat]
      : [],
  );
}

function transportationName(properties: PrimitiveProperties): string | undefined {
  const direct = toText(properties["@name"] ?? properties.name);
  if (direct) return direct;
  if (typeof properties.names !== "string") return undefined;
  try {
    const names = JSON.parse(properties.names) as Record<string, unknown>;
    return typeof names.primary === "string" ? names.primary : undefined;
  } catch {
    return undefined;
  }
}

function firstRuleValue(value: string | number | boolean | undefined): string | undefined {
  const first = parseJsonArray(value)[0];
  return typeof first?.value === "string" ? first.value : undefined;
}

function roadWidth(properties: PrimitiveProperties, kind: string): number {
  const supplied = Number.parseFloat(String(properties.width ?? ""));
  if (Number.isFinite(supplied) && supplied > 0) return Math.max(2.4, Math.min(32, supplied));
  const widths: Record<string, number> = {
    motorway: 13,
    trunk: 11,
    primary: 9,
    secondary: 8,
    tertiary: 7,
    residential: 5.8,
    living_street: 5,
    unclassified: 5,
    service: 4,
    track: 3.5,
    pedestrian: 4,
    cycleway: 2,
    footway: 1.8,
    path: 1.5,
    steps: 1.6,
  };
  return widths[kind] ?? 4.5;
}

function defaultSpeedLimit(kind: string): number {
  const speeds: Record<string, number> = {
    motorway: 100,
    trunk: 80,
    primary: 60,
    secondary: 50,
    tertiary: 45,
    residential: 30,
    living_street: 20,
    service: 20,
    track: 15,
  };
  return speeds[kind] ?? 30;
}

function defaultSurface(kind: string): string {
  return kind === "track" || kind === "path" ? "unpaved" : "paved";
}

function pathTouchesRadius(path: LonLat[], center: LonLat, radius: number): boolean {
  return path.some((coordinate) => distanceMeters(center, coordinate) <= radius);
}

function pathLength(path: LonLat[]): number {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    length += distanceMeters(path[index - 1]!, path[index]!);
  }
  return length;
}

function stitchPaths(paths: LonLat[][]): LonLat[] {
  const remaining = paths.filter((path) => path.length >= 2).sort((a, b) => pathLength(b) - pathLength(a));
  const result = [...(remaining.shift() ?? [])];
  while (remaining.length > 0) {
    let bestIndex = -1;
    let bestMode = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      const distances = [
        distanceMeters(result.at(-1)!, candidate[0]!),
        distanceMeters(result.at(-1)!, candidate.at(-1)!),
        distanceMeters(result[0]!, candidate.at(-1)!),
        distanceMeters(result[0]!, candidate[0]!),
      ];
      for (let mode = 0; mode < distances.length; mode += 1) {
        if (distances[mode]! < bestDistance) {
          bestDistance = distances[mode]!;
          bestIndex = index;
          bestMode = mode;
        }
      }
    }
    const candidate = remaining.splice(bestIndex, 1)[0]!;
    if (bestDistance > 12) continue;
    if (bestMode === 0) result.push(...candidate.slice(1));
    if (bestMode === 1) result.push(...[...candidate].reverse().slice(1));
    if (bestMode === 2) result.unshift(...candidate.slice(0, -1));
    if (bestMode === 3) result.unshift(...[...candidate].reverse().slice(0, -1));
  }
  return result;
}

function interpolatePath(path: LonLat[], amount: number): LonLat | undefined {
  if (path.length === 0) return undefined;
  if (path.length === 1) return path[0];
  const lengths: number[] = [0];
  for (let index = 1; index < path.length; index += 1) {
    lengths.push(lengths[index - 1]! + distanceMeters(path[index - 1]!, path[index]!));
  }
  const total = lengths.at(-1) ?? 0;
  const target = total * Math.max(0, Math.min(1, amount));
  for (let index = 1; index < lengths.length; index += 1) {
    if (lengths[index]! < target) continue;
    const start = path[index - 1]!;
    const end = path[index]!;
    const segmentLength = Math.max(0.001, lengths[index]! - lengths[index - 1]!);
    const ratio = (target - lengths[index - 1]!) / segmentLength;
    return [
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio,
    ];
  }
  return path.at(-1);
}

function toText(value: string | number | boolean | undefined): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : String(value);
}
