export type LonLat = readonly [longitude: number, latitude: number];
export type PolygonRings = LonLat[][];
export type MultiPolygon = PolygonRings[];

export type HeightQuality = "provided" | "levels" | "inferred";
export type WorldStyle = "low-poly" | "anime" | "cyber" | "blueprint" | "quality";
export type ExploreMode = "orbit" | "walk" | "fly";

export interface Attribution {
  label: string;
  url: string;
  license: string;
  licenseUrl: string;
}

export interface BuildingFeature {
  id: string;
  polygons: MultiPolygon;
  height?: number;
  minHeight?: number;
  levels?: number;
  name?: string;
  kind?: string;
  facadeColor?: string;
  roofColor?: string;
  roofShape?: string;
  geometrySource?: string;
  heightSource?: string;
  source: "overture" | "openstreetmap" | "demo";
}

export interface RoadFeature {
  id: string;
  path: LonLat[];
  kind: string;
  width: number;
  source: "openstreetmap" | "demo";
}

export interface AreaFeature {
  id: string;
  polygons: MultiPolygon;
  kind: "water" | "park" | "forest" | "pedestrian";
  source: "openstreetmap" | "demo";
}

export interface WorldData {
  center: LonLat;
  radius: number;
  buildings: BuildingFeature[];
  roads: RoadFeature[];
  areas: AreaFeature[];
  attributions: Attribution[];
  providerLabel: string;
  sourceDetails?: string[];
  generatedAt: string;
  warnings: string[];
  isDemo?: boolean;
}

export interface ResolvedBuilding extends BuildingFeature {
  resolvedHeight: number;
  resolvedMinHeight: number;
  heightQuality: HeightQuality;
}

export interface WorldStats {
  buildings: number;
  roads: number;
  areas: number;
  providedHeights: number;
  levelHeights: number;
  inferredHeights: number;
  triangles: number;
  drawCalls: number;
  truncatedBuildings: number;
}

export interface GenerationParams {
  center: LonLat;
  radius: number;
  style: WorldStyle;
}
