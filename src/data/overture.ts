import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { PMTiles } from "pmtiles";
import {
  OVERTURE_BUILDINGS_URL,
  OVERTURE_RELEASE,
  OVERTURE_TILE_ZOOM,
} from "../config";
import { boundsAround, distanceMeters } from "../geo/coordinates";
import { tilesForBounds } from "../geo/tiles";
import type { BuildingFeature, LonLat, MultiPolygon } from "../types";
import { coordinateCacheKey, getCached, setCached } from "./cache";

type GeoJsonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: string; coordinates: unknown };

type PrimitiveProperties = Record<string, string | number | boolean | undefined>;

const archive = new PMTiles(OVERTURE_BUILDINGS_URL);

export class OvertureBuildingsProvider {
  async load(center: LonLat, radius: number, signal?: AbortSignal): Promise<BuildingFeature[]> {
    const cacheKey = coordinateCacheKey("overture", center[0], center[1], radius);
    const cached = await getCached<BuildingFeature[]>(cacheKey);
    if (cached) return cached;

    const bounds = boundsAround(center, radius + 80);
    const tiles = tilesForBounds(bounds, OVERTURE_TILE_ZOOM);
    const tileResults = await Promise.all(
      tiles.map(async ({ x, y, z }) => {
        const response = await archive.getZxy(z, x, y, signal);
        if (!response) return [];
        return decodeBuildingTile(new Uint8Array(response.data), x, y, z, center, radius);
      }),
    );

    const buildings = mergeTileFragments(tileResults.flat());
    if (buildings.length > 0) await setCached(cacheKey, buildings);
    return buildings;
  }
}

export function decodeBuildingTile(
  data: Uint8Array,
  tileX: number,
  tileY: number,
  zoom: number,
  center: LonLat,
  radius: number,
): BuildingFeature[] {
  const vectorTile = new VectorTile(new Pbf(data));
  const buildings: BuildingFeature[] = [];

  for (const [layerName, layer] of Object.entries(vectorTile.layers)) {
    if (layerName !== "building" && layerName !== "buildings") continue;
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      const geoJson = feature.toGeoJSON(tileX, tileY, zoom);
      const geometry = geoJson.geometry as GeoJsonGeometry;
      const polygons = geometryToPolygons(geometry);
      if (polygons.length === 0 || !touchesRadius(polygons, center, radius + 80)) continue;

      const properties = feature.properties as PrimitiveProperties;
      const id = String(properties.id ?? properties["@id"] ?? feature.id ?? `${tileX}:${tileY}:${index}`);
      buildings.push({
        id,
        polygons,
        height: toNumber(properties.height),
        minHeight: toNumber(properties.min_height),
        levels: toNumber(properties.num_floors),
        name: toText(properties["names.primary"] ?? properties.name ?? properties["@name"]),
        kind: toText(properties.class ?? properties.subtype),
        facadeColor: normalizeColor(properties.facade_color),
        roofColor: normalizeColor(properties.roof_color),
        roofShape: toText(properties.roof_shape),
        geometrySource: toText(properties["@geometry_source"]),
        heightSource: toText(properties["@height_source"]),
        source: "overture",
      });
    }
  }

  return buildings;
}

function geometryToPolygons(geometry: GeoJsonGeometry): MultiPolygon {
  if (geometry.type === "Polygon") {
    return [(geometry.coordinates as number[][][]).map(toRing)];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][]).map((polygon) => polygon.map(toRing));
  }
  return [];
}

function toRing(ring: number[][]): LonLat[] {
  return ring
    .filter((point) => point.length >= 2)
    .map((point) => [point[0]!, point[1]!] as const);
}

function touchesRadius(polygons: MultiPolygon, center: LonLat, radius: number): boolean {
  return polygons.some((polygon) =>
    polygon[0]?.some((coordinate) => distanceMeters(center, coordinate) <= radius),
  );
}

function mergeTileFragments(buildings: BuildingFeature[]): BuildingFeature[] {
  const merged = new Map<string, BuildingFeature>();
  for (const building of buildings) {
    const existing = merged.get(building.id);
    if (!existing) {
      merged.set(building.id, building);
      continue;
    }

    const known = new Set(existing.polygons.map(polygonSignature));
    for (const polygon of building.polygons) {
      const signature = polygonSignature(polygon);
      if (!known.has(signature)) {
        existing.polygons.push(polygon);
        known.add(signature);
      }
    }
  }
  return [...merged.values()];
}

function polygonSignature(polygon: MultiPolygon[number]): string {
  const first = polygon[0]?.[0];
  const last = polygon[0]?.at(-1);
  return `${first?.[0].toFixed(6)}:${first?.[1].toFixed(6)}:${last?.[0].toFixed(6)}:${last?.[1].toFixed(6)}:${polygon[0]?.length ?? 0}`;
}

function toNumber(value: string | number | boolean | undefined): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toText(value: string | number | boolean | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function normalizeColor(value: string | number | boolean | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const color = value.trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined;
}

export const OVERTURE_SOURCE_LABEL = `Overture Maps ${OVERTURE_RELEASE}`;
