export type LonLat = readonly [longitude: number, latitude: number];
export type PolygonRings = LonLat[][];
export type MultiPolygon = PolygonRings[];
export type PlateauVertex = readonly [longitude: number, latitude: number, elevation: number];

export type HeightQuality = "provided" | "levels" | "inferred";
export type WorldStyle = "low-poly" | "anime" | "cyber" | "blueprint" | "quality";
export type ExploreMode = "orbit" | "walk" | "fly" | "drive" | "drone";
export type SemanticLayer = "terrain" | "areas" | "roads" | "buildings" | "roofs";

export interface ElevationGrid {
  columns: number;
  rows: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  heights: number[];
  originElevation: number;
  minimumElevation: number;
  maximumElevation: number;
  source: "mapzen" | "demo";
}

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
  roofHeight?: number;
  geometrySource?: string;
  heightSource?: string;
  source: "overture" | "openstreetmap" | "demo" | "plateau";
}

export interface RoadFeature {
  id: string;
  path: LonLat[];
  kind: string;
  width: number;
  name?: string;
  surface?: string;
  subclass?: string;
  oneWay?: "forward" | "backward" | "both";
  speedLimitKph?: number;
  connectors?: RoadConnectorReference[];
  source: "overture" | "openstreetmap" | "demo";
}

export interface RoadConnectorReference {
  id: string;
  at: number;
  position?: LonLat;
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
  terrain?: ElevationGrid;
  plateau?: PlateauModel;
  isDemo?: boolean;
}

export type PlateauSurfaceKind = "roof" | "wall" | "ground" | "closure" | "other";

export interface PlateauSurface {
  kind: PlateauSurfaceKind;
  vertices: PlateauVertex[];
}

export interface PlateauBuilding {
  id: string;
  name?: string;
  lod: 1 | 2;
  surfaces: PlateauSurface[];
  minimumElevation: number;
  maximumElevation: number;
}

export interface PlateauModel {
  sourceName: string;
  baseElevation: number;
  buildings: PlateauBuilding[];
  lod1Buildings: number;
  lod2Buildings: number;
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
  terrainRelief: number;
  roofs: number;
  shapedRoofs: number;
  semanticObjects: number;
  tiles: number;
  plateauBuildings: number;
  plateauLod2Buildings: number;
  roadNodes: number;
  roadEdges: number;
  drivableRoadMeters: number;
}

export interface RoadGraphPoint {
  x: number;
  y: number;
  z: number;
}

export interface RoadGraphNode extends RoadGraphPoint {
  id: string;
  edgeIds: string[];
}

export interface RoadGraphEdge {
  id: string;
  roadId: string;
  from: string;
  to: string;
  path: RoadGraphPoint[];
  lengthMeters: number;
  class: string;
  subclass?: string;
  name?: string;
  widthMeters: number;
  surface: string;
  oneWay: "forward" | "backward" | "both";
  speedLimitKph: number;
}

export interface RoadGraph {
  schemaVersion: "1.0";
  generator: string;
  coordinateSystem: string;
  nodes: RoadGraphNode[];
  edges: RoadGraphEdge[];
}

export interface DriveSpawn {
  edgeId: string;
  position: RoadGraphPoint;
  headingRadians: number;
}

export interface DriveRoute {
  id: string;
  seed: number;
  edgeIds: string[];
  points: RoadGraphPoint[];
  checkpoints: RoadGraphPoint[];
  lengthMeters: number;
}

export interface SemanticBounds {
  minimum: [x: number, y: number, z: number];
  maximum: [x: number, y: number, z: number];
}

export interface SemanticObject {
  id: string;
  sourceId: string;
  layer: SemanticLayer;
  source: string;
  kind?: string;
  name?: string;
  center: [x: number, y: number, z: number];
  bounds: SemanticBounds;
  properties: Record<string, string | number | boolean | null>;
  tile?: string;
}

export interface WorldManifest {
  schemaVersion: "1.0";
  generator: string;
  coordinateSystem: string;
  radiusMeters: number;
  layers: Record<SemanticLayer, number>;
  objects: SemanticObject[];
}

export interface GenerationParams {
  center: LonLat;
  radius: number;
  style: WorldStyle;
}
