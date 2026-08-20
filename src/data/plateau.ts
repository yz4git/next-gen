import { MAX_RADIUS, MIN_RADIUS } from "../config";
import { distanceMeters } from "../geo/coordinates";
import type {
  Attribution,
  BuildingFeature,
  LonLat,
  PlateauBuilding,
  PlateauModel,
  PlateauSurface,
  PlateauSurfaceKind,
  PlateauVertex,
  WorldData,
} from "../types";

const PLATEAU_ATTRIBUTION: Attribution = {
  label: "Project PLATEAU",
  url: "https://www.mlit.go.jp/plateau/",
  license: "Dataset-specific open-data terms",
  licenseUrl: "https://www.mlit.go.jp/plateau/open-data/",
};

export interface PlateauParseResult {
  center: LonLat;
  radius: number;
  model: PlateauModel;
  buildings: BuildingFeature[];
  skippedBuildings: number;
}

export function createPlateauWorld(xml: string, sourceName: string): WorldData {
  const parsed = parsePlateauCityGml(xml, sourceName);
  const lodLabel = parsed.model.lod2Buildings > 0
    ? `LOD1 + LOD2 (${parsed.model.lod2Buildings.toLocaleString()} LOD2)`
    : "LOD1";
  const warnings = [
    "This CityGML file was parsed locally in your browser and was not uploaded by WorldSeed.",
  ];
  if (parsed.skippedBuildings > 0) {
    warnings.push(`${parsed.skippedBuildings.toLocaleString()} buildings outside the 1 km world cap or without usable surfaces were skipped.`);
  }
  return {
    center: parsed.center,
    radius: parsed.radius,
    buildings: parsed.buildings,
    roads: [],
    areas: [],
    attributions: [PLATEAU_ATTRIBUTION],
    providerLabel: "Project PLATEAU CityGML · local import",
    sourceDetails: [`PLATEAU CityGML ${lodLabel}`],
    generatedAt: new Date().toISOString(),
    warnings,
    plateau: parsed.model,
  };
}

export function parsePlateauCityGml(xml: string, sourceName = "local.gml"): PlateauParseResult {
  if (!/<(?:[\w.-]+:)?CityModel\b/i.test(xml)) {
    throw new Error("The selected file is not a CityGML CityModel.");
  }

  const parsedBuildings: PlateauBuilding[] = [];
  const buildingPattern = /<(?:[\w.-]+:)?Building\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?Building\s*>/gi;
  for (const match of xml.matchAll(buildingPattern)) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const id = readId(attributes) ?? `plateau-building-${parsedBuildings.length + 1}`;
    const lod: 1 | 2 = /<(?:[\w.-]+:)?lod2(?:Solid|MultiSurface)\b|<(?:[\w.-]+:)?(?:Roof|Wall|Ground|Closure)Surface\b/i.test(body)
      ? 2
      : 1;
    const surfaces = extractSurfaces(body, lod);
    const elevations = surfaces.flatMap((surface) => surface.vertices.map((vertex) => vertex[2]));
    if (surfaces.length === 0 || elevations.length === 0) continue;
    parsedBuildings.push({
      id,
      name: readTextElement(body, "name"),
      lod,
      surfaces,
      minimumElevation: Math.min(...elevations),
      maximumElevation: Math.max(...elevations),
    });
  }
  if (parsedBuildings.length === 0) {
    throw new Error("No usable bldg:Building LOD1/LOD2 surfaces were found in this CityGML file.");
  }

  const allVertices = parsedBuildings.flatMap((building) => building.surfaces.flatMap((surface) => surface.vertices));
  const center = readEnvelopeCenter(xml) ?? centerFromVertices(allVertices);
  const requestedRadius = Math.max(...allVertices.map((vertex) => distanceMeters(center, [vertex[0], vertex[1]])));
  const radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Math.ceil(requestedRadius / 50) * 50));
  const selected = parsedBuildings.filter((building) => {
    const vertices = building.surfaces.flatMap((surface) => surface.vertices);
    const buildingCenter = centerFromVertices(vertices);
    return distanceMeters(center, buildingCenter) <= radius + 100;
  });

  const buildings: BuildingFeature[] = [];
  const detailed: PlateauBuilding[] = [];
  for (const building of selected) {
    const footprintSurfaces = selectFootprintSurfaces(building.surfaces);
    const polygons = footprintSurfaces
      .map((surface) => closeRing(surface.vertices.map((vertex) => [vertex[0], vertex[1]] as LonLat)))
      .filter((ring) => ring.length >= 4)
      .map((ring) => [ring]);
    if (polygons.length === 0) continue;
    buildings.push({
      id: building.id,
      name: building.name,
      polygons,
      height: Math.max(1, building.maximumElevation - building.minimumElevation),
      minHeight: 0,
      roofShape: building.lod === 2 ? "plateau-lod2" : "flat",
      geometrySource: `Project PLATEAU CityGML LOD${building.lod}`,
      heightSource: "Project PLATEAU measured geometry",
      source: "plateau",
    });
    detailed.push(building);
  }
  if (buildings.length === 0) {
    throw new Error("The CityGML buildings did not contain usable ground or horizontal footprint surfaces.");
  }

  const baseElevation = Math.min(...detailed.map((building) => building.minimumElevation));
  const model: PlateauModel = {
    sourceName,
    baseElevation,
    buildings: detailed,
    lod1Buildings: detailed.filter((building) => building.lod === 1).length,
    lod2Buildings: detailed.filter((building) => building.lod === 2).length,
  };
  return {
    center,
    radius,
    model,
    buildings,
    skippedBuildings: parsedBuildings.length - detailed.length,
  };
}

function extractSurfaces(body: string, lod: 1 | 2): PlateauSurface[] {
  const surfaces: PlateauSurface[] = [];
  if (lod === 2) {
    const boundaryPattern = /<(?:[\w.-]+:)?(RoofSurface|WallSurface|GroundSurface|ClosureSurface)\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?\1\s*>/gi;
    for (const match of body.matchAll(boundaryPattern)) {
      const kind = surfaceKind(match[1]);
      surfaces.push(...extractPositionLists(match[2] ?? "", kind));
    }
    if (surfaces.length > 0) return deduplicateSurfaces(surfaces);
  }
  const preferred = readElement(body, lod === 2 ? "lod2MultiSurface" : "lod1Solid") ?? body;
  return deduplicateSurfaces(extractPositionLists(preferred, "other"));
}

function extractPositionLists(xml: string, kind: PlateauSurfaceKind): PlateauSurface[] {
  const surfaces: PlateauSurface[] = [];
  const positionPattern = /<(?:[\w.-]+:)?posList\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?posList\s*>/gi;
  for (const match of xml.matchAll(positionPattern)) {
    const dimensionMatch = (match[1] ?? "").match(/srsDimension\s*=\s*["'](\d+)["']/i);
    const vertices = parsePositionList(match[2] ?? "", Number(dimensionMatch?.[1] ?? 0));
    if (vertices.length >= 3) surfaces.push({ kind, vertices });
  }
  return surfaces;
}

export function parsePositionList(value: string, declaredDimension = 0): PlateauVertex[] {
  const values = value.trim().split(/\s+/).map(Number).filter(Number.isFinite);
  const dimension = declaredDimension === 2 || declaredDimension === 3
    ? declaredDimension
    : values.length % 3 === 0 ? 3 : 2;
  const vertices: PlateauVertex[] = [];
  for (let index = 0; index + dimension - 1 < values.length; index += dimension) {
    const first = values[index];
    const second = values[index + 1];
    const elevation = dimension === 3 ? values[index + 2] : 0;
    if (first === undefined || second === undefined || elevation === undefined) continue;
    const latitudeFirst = Math.abs(first) <= 90 && Math.abs(second) <= 180;
    const latitude = latitudeFirst ? first : second;
    const longitude = latitudeFirst ? second : first;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    vertices.push([longitude, latitude, elevation]);
  }
  const first = vertices[0];
  const last = vertices.at(-1);
  if (first && last && vertices.length > 3 && sameVertex(first, last)) vertices.pop();
  return vertices;
}

function selectFootprintSurfaces(surfaces: PlateauSurface[]): PlateauSurface[] {
  const ground = surfaces.filter((surface) => surface.kind === "ground");
  if (ground.length > 0) return ground;
  const horizontal = surfaces.filter((surface) => elevationRange(surface) <= 0.75);
  if (horizontal.length === 0) return [];
  const minimumAverage = Math.min(...horizontal.map(averageElevation));
  return horizontal.filter((surface) => averageElevation(surface) <= minimumAverage + 0.4);
}

function readEnvelopeCenter(xml: string): LonLat | null {
  const lower = readTextElement(xml, "lowerCorner");
  const upper = readTextElement(xml, "upperCorner");
  if (!lower || !upper) return null;
  const lowerVertex = parsePositionList(lower, 3)[0];
  const upperVertex = parsePositionList(upper, 3)[0];
  if (!lowerVertex || !upperVertex) return null;
  return [(lowerVertex[0] + upperVertex[0]) / 2, (lowerVertex[1] + upperVertex[1]) / 2];
}

function centerFromVertices(vertices: PlateauVertex[]): LonLat {
  const longitude = vertices.reduce((sum, vertex) => sum + vertex[0], 0) / vertices.length;
  const latitude = vertices.reduce((sum, vertex) => sum + vertex[1], 0) / vertices.length;
  return [longitude, latitude];
}

function readId(attributes: string): string | undefined {
  return attributes.match(/(?:^|\s)(?:[\w.-]+:)?id\s*=\s*["']([^"']+)["']/i)?.[1];
}

function readTextElement(xml: string, localName: string): string | undefined {
  const content = readElement(xml, localName)?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return content || undefined;
}

function readElement(xml: string, localName: string): string | undefined {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}\\s*>`, "i");
  return xml.match(pattern)?.[1];
}

function surfaceKind(value: string | undefined): PlateauSurfaceKind {
  if (value === "RoofSurface") return "roof";
  if (value === "WallSurface") return "wall";
  if (value === "GroundSurface") return "ground";
  if (value === "ClosureSurface") return "closure";
  return "other";
}

function elevationRange(surface: PlateauSurface): number {
  const elevations = surface.vertices.map((vertex) => vertex[2]);
  return Math.max(...elevations) - Math.min(...elevations);
}

function averageElevation(surface: PlateauSurface): number {
  return surface.vertices.reduce((sum, vertex) => sum + vertex[2], 0) / surface.vertices.length;
}

function deduplicateSurfaces(surfaces: PlateauSurface[]): PlateauSurface[] {
  const seen = new Set<string>();
  return surfaces.filter((surface) => {
    const signature = `${surface.kind}:${surface.vertices
      .map((vertex) => `${vertex[0].toFixed(7)},${vertex[1].toFixed(7)},${vertex[2].toFixed(2)}`)
      .join("|")}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function closeRing(ring: LonLat[]): LonLat[] {
  const first = ring[0];
  const last = ring.at(-1);
  if (!first || !last) return ring;
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

function sameVertex(first: PlateauVertex, second: PlateauVertex): boolean {
  return Math.abs(first[0] - second[0]) < 1e-10
    && Math.abs(first[1] - second[1]) < 1e-10
    && Math.abs(first[2] - second[2]) < 1e-4;
}
