import { OVERPASS_ENDPOINTS } from "../config";
import { distanceMeters } from "../geo/coordinates";
import type {
  AreaFeature,
  BuildingFeature,
  LonLat,
  MultiPolygon,
  RoadFeature,
} from "../types";
import { coordinateCacheKey, getCached, setCached } from "./cache";

interface OsmCoordinate {
  lat: number;
  lon: number;
}

interface OsmTags {
  [key: string]: string | undefined;
}

interface OsmMember {
  type: string;
  role: string;
  ref: number;
  geometry?: OsmCoordinate[];
}

interface OsmElement {
  type: "way" | "relation" | "node";
  id: number;
  tags?: OsmTags;
  geometry?: OsmCoordinate[];
  members?: OsmMember[];
}

interface OverpassResponse {
  elements: OsmElement[];
}

export interface OsmResult {
  buildings: BuildingFeature[];
  roads: RoadFeature[];
  areas: AreaFeature[];
}

export class OpenStreetMapProvider {
  async load(center: LonLat, radius: number, signal?: AbortSignal): Promise<OsmResult> {
    const cacheKey = coordinateCacheKey("osm", center[0], center[1], radius);
    const cached = await getCached<OsmResult>(cacheKey);
    if (cached) return cached;

    const query = createOverpassQuery(center, radius);
    let lastError: unknown;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: `data=${encodeURIComponent(query)}`,
          signal,
        });
        if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
        const payload = (await response.json()) as OverpassResponse;
        const parsed = parseOverpassResponse(payload, center, radius);
        await setCached(cacheKey, parsed);
        return parsed;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("OpenStreetMap request failed");
  }
}

export function createOverpassQuery(center: LonLat, radius: number): string {
  const safeRadius = Math.round(Math.max(100, Math.min(1_100, radius + 60)));
  const around = `(around:${safeRadius},${center[1].toFixed(6)},${center[0].toFixed(6)})`;
  return `[out:json][timeout:35];
(
  way${around}["highway"];
  way${around}["railway"];
  way${around}["building"];
  relation${around}["building"];
  way${around}["natural"="water"];
  relation${around}["natural"="water"];
  way${around}["waterway"];
  way${around}["leisure"="park"];
  relation${around}["leisure"="park"];
  way${around}["landuse"~"forest|grass|meadow|recreation_ground|village_green"];
  way${around}["highway"="pedestrian"]["area"="yes"];
);
out tags geom;`;
}

export function parseOverpassResponse(
  payload: OverpassResponse,
  center: LonLat,
  radius: number,
): OsmResult {
  const buildings: BuildingFeature[] = [];
  const roads: RoadFeature[] = [];
  const areas: AreaFeature[] = [];

  for (const element of payload.elements) {
    const tags = element.tags ?? {};
    if (tags.building) {
      const polygons = polygonsFromElement(element);
      if (polygons.length > 0 && touchesRadius(polygons, center, radius + 70)) {
        buildings.push({
          id: `osm:${element.type}:${element.id}`,
          polygons,
          height: parseLengthMeters(tags.height),
          minHeight: parseLengthMeters(tags.min_height),
          levels: parsePositive(tags["building:levels"]),
          name: tags.name,
          kind: tags["building:use"] ?? tags.building,
          facadeColor: normalizeColor(tags["building:colour"]),
          roofColor: normalizeColor(tags["roof:colour"]),
          roofShape: tags["roof:shape"],
          geometrySource: "OpenStreetMap",
          heightSource: tags.height ? "OpenStreetMap height" : undefined,
          source: "openstreetmap",
        });
      }
      continue;
    }

    const areaKind = classifyArea(tags);
    if (areaKind) {
      const polygons = polygonsFromElement(element);
      if (polygons.length > 0) {
        areas.push({
          id: `osm:${element.type}:${element.id}`,
          polygons,
          kind: areaKind,
          source: "openstreetmap",
        });
      }
      continue;
    }

    if (tags.highway || tags.railway || tags.waterway) {
      const path = geometryToPath(element.geometry);
      if (path.length >= 2) {
        const kind = tags.railway ? `railway:${tags.railway}` : tags.waterway ? "waterway" : tags.highway!;
        roads.push({
          id: `osm:${element.type}:${element.id}`,
          path,
          kind,
          width: resolveRoadWidth(tags, kind),
          source: "openstreetmap",
        });
      }
    }
  }

  return { buildings, roads, areas };
}

function polygonsFromElement(element: OsmElement): MultiPolygon {
  if (element.type === "way") {
    const ring = geometryToPath(element.geometry);
    return ring.length >= 3 ? [[closeRing(ring)]] : [];
  }

  const outer = element.members
    ?.filter((member) => member.type === "way" && member.role !== "inner")
    .map((member) => geometryToPath(member.geometry))
    .filter((ring) => ring.length >= 3)
    .map(closeRing);
  return outer?.map((ring) => [ring]) ?? [];
}

function geometryToPath(geometry: OsmCoordinate[] | undefined): LonLat[] {
  return (geometry ?? [])
    .filter((coordinate) => Number.isFinite(coordinate.lon) && Number.isFinite(coordinate.lat))
    .map((coordinate) => [coordinate.lon, coordinate.lat] as const);
}

function closeRing(ring: LonLat[]): LonLat[] {
  const first = ring[0];
  const last = ring.at(-1);
  if (!first || !last) return ring;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function touchesRadius(polygons: MultiPolygon, center: LonLat, radius: number): boolean {
  return polygons.some((polygon) =>
    polygon[0]?.some((coordinate) => distanceMeters(center, coordinate) <= radius),
  );
}

function classifyArea(tags: OsmTags): AreaFeature["kind"] | null {
  if (tags.natural === "water") return "water";
  if (tags.leisure === "park") return "park";
  if (tags.landuse === "forest") return "forest";
  if (["grass", "meadow", "recreation_ground", "village_green"].includes(tags.landuse ?? "")) {
    return "park";
  }
  if (tags.highway === "pedestrian" && tags.area === "yes") return "pedestrian";
  return null;
}

function resolveRoadWidth(tags: OsmTags, kind: string): number {
  const explicit = parseLengthMeters(tags.width);
  if (explicit) return Math.max(1, Math.min(explicit, 32));
  const lanes = parsePositive(tags.lanes);
  if (lanes) return Math.max(2.5, Math.min(lanes * 3.15, 28));
  if (kind.startsWith("railway:")) return 2.2;
  if (kind === "waterway") return 3;
  const widths: Record<string, number> = {
    motorway: 13,
    trunk: 11,
    primary: 9,
    secondary: 8,
    tertiary: 7,
    residential: 5.5,
    service: 4,
    pedestrian: 4,
    footway: 1.8,
    path: 1.4,
    cycleway: 2,
  };
  return widths[kind] ?? 4.5;
}

export function parseLengthMeters(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const feetMatch = normalized.match(/^(-?\d+(?:\.\d+)?)\s*(?:ft|feet|')$/);
  if (feetMatch?.[1]) return Number.parseFloat(feetMatch[1]) * 0.3048;
  const numeric = Number.parseFloat(normalized.replace(",", "."));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function parsePositive(value: string | undefined): number | undefined {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const aliases: Record<string, string> = {
    grey: "#8f9599",
    gray: "#8f9599",
    red: "#ad5b55",
    brown: "#8d725c",
    beige: "#cbbd9d",
    white: "#deded8",
    black: "#34383c",
    blue: "#708aa5",
    green: "#738c70",
    yellow: "#c7ad65",
  };
  return aliases[value.toLowerCase()] ?? (/^#[0-9a-f]{3,8}$/i.test(value) ? value : undefined);
}
