import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BUILDING_BATCH_SIZE, MAX_BUILDINGS, WORLD_TILE_SIZE } from "../config";
import { toLocalMeters, type LocalPoint } from "../geo/coordinates";
import { clipSegmentToCircle, polygonCentroid, signedArea } from "../geo/polygon";
import { elevationAt } from "../terrain/elevation";
import { createWorldManifest } from "../semantic/manifest";
import type {
  AreaFeature,
  PolygonRings,
  ResolvedBuilding,
  RoadFeature,
  RoadGraph,
  WorldData,
  WorldManifest,
  WorldStats,
  WorldStyle,
} from "../types";
import { CollisionIndex } from "./collision";
import { resolveBuildingHeight, seededUnit } from "./height";
import { createPlateauSurfaceGeometry } from "./plateau";
import { resolveRoof, type RoofProfile } from "./roof";
import { buildRoadGraph, isDrivableRoad } from "./road-graph";
import { materialForStyle, WORLD_PALETTES } from "./styles";
import { tileForPoint, type WorldTile } from "./tiling";

interface TiledGeometryBucket {
  geometries: THREE.BufferGeometry[];
  featureIds: string[];
  tile: WorldTile;
  color: number;
}

interface RoadTileBucket {
  positions: number[];
  indices: number[];
  featureIds: string[];
  tile: WorldTile;
  vertex: number;
}

interface FurnitureBucket {
  tile: WorldTile;
  trees: THREE.Matrix4[];
  lights: THREE.Matrix4[];
  signs: THREE.Matrix4[];
}

export interface BuiltCity {
  group: THREE.Group;
  collision: CollisionIndex;
  stats: WorldStats;
  resolvedBuildings: ResolvedBuilding[];
  groundHeightAt: (x: number, z: number) => number;
  manifest: WorldManifest;
  roadGraph: RoadGraph;
}

export async function buildCity(
  data: WorldData,
  style: WorldStyle,
  onProgress?: (ratio: number, message: string) => void,
): Promise<BuiltCity> {
  const palette = WORLD_PALETTES[style];
  const group = new THREE.Group();
  group.name = "WorldSeed City";
  group.userData = {
    center: data.center,
    radius: data.radius,
    provider: data.providerLabel,
    generatedAt: data.generatedAt,
    semanticSchemaVersion: "1.0",
  };

  const collision = new CollisionIndex(data.radius);
  const layers = createSemanticLayers();
  group.add(layers.terrain, layers.areas, layers.roads, layers.buildings, layers.roofs);
  layers.terrain.add(createGround(data, style));
  const areas = createAreas(data.areas, data, style);
  if (areas.length > 0) layers.areas.add(...areas);
  const roads = createRoads(data.roads, data, style);
  if (roads.length > 0) layers.roads.add(...roads);
  const roadGraph = buildRoadGraph(data.roads, data.center, data.radius, data.terrain);
  const roadDecorations = createRoadDecorations(data.roads, roadGraph, data, style);
  if (roadDecorations.length > 0) layers.roads.add(...roadDecorations);

  const allResolved = data.buildings.map(resolveBuildingHeight);
  const ranked = allResolved
    .map((building) => ({ building, score: buildingDistanceScore(building, data) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_BUILDINGS)
    .map(({ building }) => building);
  const plateauBuildings = new Map(
    (data.plateau?.buildings ?? []).map((building) => [building.id, building]),
  );

  const buildingBuckets = new Map<string, TiledGeometryBucket>();
  const roofBuckets = new Map<string, TiledGeometryBucket>();
  let roofCount = 0;
  let shapedRoofCount = 0;
  let processed = 0;
  for (const building of ranked) {
    const plateauBuilding = plateauBuildings.get(building.id);
    if (plateauBuilding && data.plateau) {
      const footprintPoints = building.polygons
        .flatMap((polygon) => ringToLocal(polygon[0], data))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z));
      const centroid = polygonCentroid(footprintPoints);
      const tile = tileForPoint(centroid.x, centroid.z, WORLD_TILE_SIZE);
      const bodyIndex = style === "quality"
        ? 0
        : Math.floor(seededUnit(`${building.id}:plateau-color`) * palette.buildings.length) % palette.buildings.length;
      const bodyColor = palette.buildings[bodyIndex] ?? palette.buildings[0] ?? 0x999999;
      const roofIndex = style === "quality"
        ? 0
        : Math.floor(seededUnit(`${building.id}:plateau-roof`) * palette.roofs.length) % palette.roofs.length;
      const roofColor = palette.roofs[roofIndex] ?? palette.roofs[0] ?? bodyColor;
      let hasRoofSurface = false;
      for (const surface of plateauBuilding.surfaces) {
        const geometry = createPlateauSurfaceGeometry(surface, data.center, data.plateau.baseElevation);
        if (!geometry) continue;
        const isRoof = surface.kind === "roof";
        hasRoofSurface ||= isRoof;
        addToBucket(
          isRoof ? roofBuckets : buildingBuckets,
          `${tile.id}:plateau:${surface.kind}:${isRoof ? roofColor : bodyColor}`,
          tile,
          isRoof ? roofColor : bodyColor,
          geometry,
          building.id,
        );
      }
      for (const polygon of building.polygons) {
        const localOuter = ringToLocal(polygon[0], data);
        if (localOuter.length >= 3) collision.add(localOuter);
      }
      if (hasRoofSurface) {
        roofCount += 1;
        shapedRoofCount += plateauBuilding.lod === 2 ? 1 : 0;
      }
      processed += 1;
      if (processed % BUILDING_BATCH_SIZE === 0) {
        onProgress?.(processed / Math.max(1, ranked.length), `Building PLATEAU city… ${processed.toLocaleString()} structures`);
        await nextFrame();
      }
      continue;
    }
    let builtRoof = false;
    let builtShapedRoof = false;
    for (const polygon of building.polygons) {
      const localOuter = ringToLocal(polygon[0], data);
      if (localOuter.length < 3) continue;
      if (Math.hypot(polygonCentroid(localOuter).x, polygonCentroid(localOuter).z) > data.radius + 60) continue;
      const shape = polygonToShape(polygon, data);
      if (!shape) continue;
      const centroid = polygonCentroid(localOuter);
      const tile = tileForPoint(centroid.x, centroid.z, WORLD_TILE_SIZE);
      const groundHeight = elevationAt(data.terrain, centroid.x, centroid.z);
      const roof = resolveRoof(building, building.resolvedHeight);
      const roofBase = Math.max(
        building.resolvedMinHeight + 0.8,
        building.resolvedHeight - roof.height,
      );
      const height = Math.max(0.8, roofBase - building.resolvedMinHeight);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
        curveSegments: 1,
        steps: 1,
      });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, building.resolvedMinHeight + groundHeight, 0);
      geometry.computeVertexNormals();
      const bucketIndex = style === "quality"
        ? building.heightQuality === "provided" ? 0 : building.heightQuality === "levels" ? 1 : 2
        : Math.floor(seededUnit(`${building.id}:color`) * palette.buildings.length) % palette.buildings.length;
      const buildingColor = palette.buildings[bucketIndex] ?? palette.buildings[0] ?? 0x999999;
      addToBucket(
        buildingBuckets,
        `${tile.id}:${bucketIndex}`,
        tile,
        buildingColor,
        geometry,
        building.id,
      );
      const roofGeometry = createRoofGeometry(
        shape,
        localOuter,
        groundHeight + roofBase,
        groundHeight + building.resolvedHeight,
        roof.profile,
      );
      if (roofGeometry) {
        const roofColor = resolveRoofColor(building, style, palette.roofs);
        addToBucket(
          roofBuckets,
          `${tile.id}:${roofColor}`,
          tile,
          roofColor,
          roofGeometry,
          building.id,
        );
        builtRoof = true;
        builtShapedRoof ||= roof.profile !== "flat";
      }
      collision.add(localOuter);
    }
    if (builtRoof) roofCount += 1;
    if (builtShapedRoof) shapedRoofCount += 1;
    processed += 1;
    if (processed % BUILDING_BATCH_SIZE === 0) {
      onProgress?.(processed / Math.max(1, ranked.length), `Building city… ${processed.toLocaleString()} structures`);
      await nextFrame();
    }
  }

  for (const bucket of buildingBuckets.values()) {
    const { geometries, color, tile, featureIds } = bucket;
    if (geometries.length === 0) continue;
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    const material = materialForStyle(style, color);
    if (data.plateau) material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `Buildings ${tile.id} ${color.toString(16).padStart(6, "0")}`;
    mesh.castShadow = style !== "cyber";
    mesh.receiveShadow = true;
    mesh.userData = {
      worldseedLayer: "buildings",
      featureIds: [...new Set(featureIds)],
      worldseedTile: tile,
    };
    layers.buildings.add(mesh);
  }

  for (const bucket of roofBuckets.values()) {
    const { geometries, featureIds, color, tile } = bucket;
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    const material = materialForStyle(style, color);
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `Roofs ${tile.id} ${color.toString(16).padStart(6, "0")}`;
    mesh.castShadow = style !== "cyber";
    mesh.receiveShadow = true;
    mesh.userData = {
      worldseedLayer: "roofs",
      featureIds: [...new Set(featureIds)],
      worldseedTile: tile,
      worldseedDetail: true,
    };
    layers.roofs.add(mesh);
  }

  const manifest = createWorldManifest(data, ranked);
  const stats = collectStats(
    group,
    ranked,
    data,
    allResolved.length - ranked.length,
    roofCount,
    shapedRoofCount,
    manifest.objects.length,
    new Set(manifest.objects.flatMap((object) => object.tile ? [object.tile] : [])).size,
    ranked.filter((building) => plateauBuildings.has(building.id)).length,
    ranked.filter((building) => plateauBuildings.get(building.id)?.lod === 2).length,
    roadGraph,
  );
  onProgress?.(1, "City ready");
  return {
    group,
    collision,
    stats,
    resolvedBuildings: ranked,
    groundHeightAt: (x, z) => elevationAt(data.terrain, x, z),
    manifest,
    roadGraph,
  };
}

function addToBucket(
  buckets: Map<string, TiledGeometryBucket>,
  key: string,
  tile: WorldTile,
  color: number,
  geometry: THREE.BufferGeometry,
  featureId: string,
): void {
  const bucket = buckets.get(key) ?? { geometries: [], featureIds: [], tile, color };
  bucket.geometries.push(geometry);
  bucket.featureIds.push(featureId);
  buckets.set(key, bucket);
}

function createSemanticLayers(): Record<"terrain" | "areas" | "roads" | "buildings" | "roofs", THREE.Group> {
  const createLayer = (name: string): THREE.Group => {
    const layer = new THREE.Group();
    layer.name = name[0]?.toUpperCase() + name.slice(1);
    layer.userData = { worldseedLayer: name };
    return layer;
  };
  return {
    terrain: createLayer("terrain"),
    areas: createLayer("areas"),
    roads: createLayer("roads"),
    buildings: createLayer("buildings"),
    roofs: createLayer("roofs"),
  };
}

function createRoofGeometry(
  shape: THREE.Shape,
  outer: LocalPoint[],
  baseHeight: number,
  topHeight: number,
  profile: RoofProfile,
): THREE.BufferGeometry | null {
  if (outer.length < 3) return null;
  if (profile === "flat" || topHeight - baseHeight < 0.1) {
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, topHeight + 0.025, 0);
    geometry.computeVertexNormals();
    return geometry;
  }
  if (profile === "skillion") return createSkillionRoof(shape, outer, baseHeight, topHeight);
  if (profile === "gabled") return createGabledRoof(outer, baseHeight, topHeight);
  return createHippedRoof(outer, baseHeight, topHeight);
}

function createHippedRoof(
  outer: LocalPoint[],
  baseHeight: number,
  topHeight: number,
): THREE.BufferGeometry {
  const centroid = polygonCentroid(outer);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < outer.length; index += 1) {
    const first = outer[index];
    const second = outer[(index + 1) % outer.length];
    if (!first || !second) continue;
    const offset = positions.length / 3;
    positions.push(
      first.x, baseHeight, first.z,
      second.x, baseHeight, second.z,
      centroid.x, topHeight, centroid.z,
    );
    indices.push(offset, offset + 1, offset + 2);
  }
  return surfaceGeometry(positions, indices);
}

function createGabledRoof(
  outer: LocalPoint[],
  baseHeight: number,
  topHeight: number,
): THREE.BufferGeometry {
  const bounds = localBounds(outer);
  const alongX = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ;
  const center = polygonCentroid(outer);
  const minimum = alongX ? bounds.minX : bounds.minZ;
  const maximum = alongX ? bounds.maxX : bounds.maxZ;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < outer.length; index += 1) {
    const first = outer[index];
    const second = outer[(index + 1) % outer.length];
    if (!first || !second) continue;
    const firstLong = clamp(alongX ? first.x : first.z, minimum, maximum);
    const secondLong = clamp(alongX ? second.x : second.z, minimum, maximum);
    const firstRidge = alongX
      ? { x: firstLong, z: center.z }
      : { x: center.x, z: firstLong };
    const secondRidge = alongX
      ? { x: secondLong, z: center.z }
      : { x: center.x, z: secondLong };
    const offset = positions.length / 3;
    positions.push(
      first.x, baseHeight, first.z,
      second.x, baseHeight, second.z,
      secondRidge.x, topHeight, secondRidge.z,
      firstRidge.x, topHeight, firstRidge.z,
    );
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return surfaceGeometry(positions, indices);
}

function createSkillionRoof(
  shape: THREE.Shape,
  outer: LocalPoint[],
  baseHeight: number,
  topHeight: number,
): THREE.BufferGeometry {
  const bounds = localBounds(outer);
  const alongX = bounds.maxX - bounds.minX < bounds.maxZ - bounds.minZ;
  const minimum = alongX ? bounds.minX : bounds.minZ;
  const maximum = alongX ? bounds.maxX : bounds.maxZ;
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const value = alongX ? positions.getX(index) : positions.getZ(index);
    const ratio = (value - minimum) / Math.max(0.001, maximum - minimum);
    positions.setY(index, baseHeight + ratio * (topHeight - baseHeight));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function surfaceGeometry(positions: number[], indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function localBounds(points: LocalPoint[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minZ: Math.min(bounds.minZ, point.z),
    maxZ: Math.max(bounds.maxZ, point.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function resolveRoofColor(
  building: ResolvedBuilding,
  style: WorldStyle,
  colors: number[],
): number {
  if (style !== "quality" && building.roofColor && /^#[0-9a-f]{6}$/i.test(building.roofColor)) {
    const color = new THREE.Color(building.roofColor);
    const red = Math.round(color.r * 3) / 3;
    const green = Math.round(color.g * 3) / 3;
    const blue = Math.round(color.b * 3) / 3;
    return new THREE.Color(red, green, blue).getHex();
  }
  const index = style === "quality"
    ? building.heightQuality === "provided" ? 0 : building.heightQuality === "levels" ? 1 : 2
    : Math.floor(seededUnit(`${building.id}:roof-color`) * colors.length) % colors.length;
  return colors[index] ?? colors[0] ?? 0x777777;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function createGround(data: WorldData, style: WorldStyle): THREE.Mesh {
  const geometry = createTerrainGeometry(data);
  const mesh = new THREE.Mesh(geometry, materialForStyle(style, WORLD_PALETTES[style].ground));
  mesh.name = data.terrain ? "Terrain" : "Ground";
  mesh.userData = { worldseedLayer: "terrain", featureIds: ["ground"] };
  mesh.receiveShadow = true;
  return mesh;
}

function createTerrainGeometry(data: WorldData): THREE.BufferGeometry {
  const sectors = 128;
  const rings = data.terrain ? 48 : 1;
  const positions: number[] = [0, elevationAt(data.terrain, 0, 0), 0];
  const indices: number[] = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    const distance = (ring / rings) * data.radius;
    for (let sector = 0; sector < sectors; sector += 1) {
      const angle = (sector / sectors) * Math.PI * 2;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      positions.push(x, elevationAt(data.terrain, x, z), z);
    }
  }
  for (let sector = 0; sector < sectors; sector += 1) {
    indices.push(0, 1 + sector, 1 + ((sector + 1) % sectors));
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const inner = 1 + (ring - 1) * sectors;
    const outer = 1 + ring * sectors;
    for (let sector = 0; sector < sectors; sector += 1) {
      const next = (sector + 1) % sectors;
      indices.push(
        inner + sector, outer + sector, inner + next,
        inner + next, outer + sector, outer + next,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createAreas(areas: AreaFeature[], data: WorldData, style: WorldStyle): THREE.Mesh[] {
  const buckets = new Map<string, TiledGeometryBucket>();
  for (const area of areas) {
    for (const polygon of area.polygons) {
      const localOuter = ringToLocal(polygon[0], data);
      if (localOuter.length < 3) continue;
      const shape = polygonToShape(polygon, data);
      if (!shape) continue;
      const geometry = new THREE.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      applyTerrainToGeometry(geometry, data, area.kind === "water" ? 0.12 : 0.06);
      const centroid = polygonCentroid(localOuter);
      const tile = tileForPoint(centroid.x, centroid.z, WORLD_TILE_SIZE);
      addToBucket(
        buckets,
        `${tile.id}:${area.kind}`,
        tile,
        WORLD_PALETTES[style][area.kind],
        geometry,
        area.id,
      );
    }
  }

  return [...buckets.values()].flatMap((bucket) => {
    const { geometries, featureIds, tile, color } = bucket;
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) return [];
    const mesh = new THREE.Mesh(merged, materialForStyle(style, color));
    mesh.name = `Areas ${tile.id}`;
    mesh.receiveShadow = true;
    mesh.userData = {
      worldseedLayer: "areas",
      featureIds: [...new Set(featureIds)],
      worldseedTile: tile,
    };
    return [mesh];
  });
}

function createRoads(roads: RoadFeature[], data: WorldData, style: WorldStyle): THREE.Mesh[] {
  const buckets = new Map<string, RoadTileBucket>();
  for (const road of roads) {
    for (let index = 0; index < road.path.length - 1; index += 1) {
      const first = road.path[index];
      const second = road.path[index + 1];
      if (!first || !second) continue;
      const clipped = clipSegmentToCircle(toLocalMeters(first, data.center), toLocalMeters(second, data.center), data.radius);
      if (!clipped) continue;
      const [start, end] = clipped;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.05) continue;
      const halfWidth = Math.min(road.width, 30) / 2;
      const nx = (-dz / length) * halfWidth;
      const nz = (dx / length) * halfWidth;
      const startHeight = elevationAt(data.terrain, start.x, start.z) + 0.14;
      const endHeight = elevationAt(data.terrain, end.x, end.z) + 0.14;
      const tile = tileForPoint((start.x + end.x) / 2, (start.z + end.z) / 2, WORLD_TILE_SIZE);
      const bucket = buckets.get(tile.id) ?? {
        positions: [],
        indices: [],
        featureIds: [],
        tile,
        vertex: 0,
      };
      bucket.positions.push(
        start.x + nx, startHeight, start.z + nz,
        start.x - nx, startHeight, start.z - nz,
        end.x + nx, endHeight, end.z + nz,
        end.x - nx, endHeight, end.z - nz,
      );
      bucket.indices.push(
        bucket.vertex,
        bucket.vertex + 1,
        bucket.vertex + 2,
        bucket.vertex + 2,
        bucket.vertex + 1,
        bucket.vertex + 3,
      );
      bucket.vertex += 4;
      bucket.featureIds.push(road.id);
      buckets.set(tile.id, bucket);
    }
  }
  return [...buckets.values()].map((bucket) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setIndex(bucket.indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materialForStyle(style, WORLD_PALETTES[style].road));
    mesh.name = `Roads ${bucket.tile.id}`;
    mesh.receiveShadow = true;
    mesh.userData = {
      worldseedLayer: "roads",
      featureIds: [...new Set(bucket.featureIds)],
      worldseedTile: bucket.tile,
    };
    return mesh;
  });
}

function createRoadDecorations(
  roads: RoadFeature[],
  roadGraph: RoadGraph,
  data: WorldData,
  style: WorldStyle,
): THREE.Object3D[] {
  const markingBuckets = new Map<string, RoadTileBucket>();
  const sidewalkBuckets = new Map<string, RoadTileBucket>();
  let detailSegments = 0;
  const maximumDetailSegments = 16_000;

  for (const road of roads) {
    if (!isDrivableRoad(road)) continue;
    for (let index = 1; index < road.path.length && detailSegments < maximumDetailSegments; index += 1) {
      const first = road.path[index - 1];
      const second = road.path[index];
      if (!first || !second) continue;
      const clipped = clipSegmentToCircle(toLocalMeters(first, data.center), toLocalMeters(second, data.center), data.radius);
      if (!clipped) continue;
      const [start, end] = clipped;
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      if (length < 2) continue;
      const tile = tileForPoint((start.x + end.x) / 2, (start.z + end.z) / 2, WORLD_TILE_SIZE);
      if (road.kind !== "motorway" && road.kind !== "trunk" && road.width >= 4) {
        appendRoadStrip(sidewalkBuckets, tile, start, end, road.width / 2 + 0.72, 0.62, data, 0.18, road.id);
        appendRoadStrip(sidewalkBuckets, tile, start, end, -(road.width / 2 + 0.72), 0.62, data, 0.18, road.id);
        detailSegments += 2;
      }
      if (road.width >= 6.5 && !["living_street", "service", "track"].includes(road.kind)) {
        for (let distance = 2.5; distance < length - 1 && detailSegments < maximumDetailSegments; distance += 9) {
          const dashEnd = Math.min(length - 0.5, distance + 3.5);
          const dashStartPoint = interpolateSegment(start, end, distance / length);
          const dashEndPoint = interpolateSegment(start, end, dashEnd / length);
          appendRoadStrip(markingBuckets, tile, dashStartPoint, dashEndPoint, 0, 0.09, data, 0.22, road.id);
          detailSegments += 1;
        }
      }
    }
  }

  const edgeById = new Map(roadGraph.edges.map((edge) => [edge.id, edge]));
  for (const node of roadGraph.nodes) {
    if (node.edgeIds.length < 3 || detailSegments >= maximumDetailSegments) continue;
    const edge = edgeById.get(node.edgeIds[0] ?? "");
    const next = edge?.path.find((point) => Math.hypot(point.x - node.x, point.z - node.z) > 0.5);
    if (!edge || !next) continue;
    const dx = next.x - node.x;
    const dz = next.z - node.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const acrossX = -dz / length;
    const acrossZ = dx / length;
    const tile = tileForPoint(node.x, node.z, WORLD_TILE_SIZE);
    for (let stripe = -2; stripe <= 2; stripe += 1) {
      const alongX = (dx / length) * stripe * 0.85;
      const alongZ = (dz / length) * stripe * 0.85;
      const half = edge.widthMeters * 0.48;
      appendRoadStrip(
        markingBuckets,
        tile,
        { x: node.x + alongX - acrossX * half, z: node.z + alongZ - acrossZ * half },
        { x: node.x + alongX + acrossX * half, z: node.z + alongZ + acrossZ * half },
        0,
        0.2,
        data,
        0.23,
        `crosswalk:${node.id}`,
      );
      detailSegments += 1;
    }
  }

  const markingColor = style === "cyber" ? 0x5cecff : style === "blueprint" ? 0x8fdbff : 0xf4edcf;
  const sidewalkColor = style === "cyber" ? 0x282d43 : style === "blueprint" ? 0x18486b : 0x9da49d;
  const objects: THREE.Object3D[] = [
    ...roadBucketMeshes(markingBuckets, markingColor, "Road markings", style, true),
    ...roadBucketMeshes(sidewalkBuckets, sidewalkColor, "Sidewalks", style, false),
    ...createRoadFurniture(roadGraph, data, style),
  ];
  return objects;
}

function appendRoadStrip(
  buckets: Map<string, RoadTileBucket>,
  tile: WorldTile,
  start: LocalPoint,
  end: LocalPoint,
  offset: number,
  halfWidth: number,
  data: WorldData,
  heightOffset: number,
  featureId: string,
): void {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.05) return;
  const nx = -dz / length;
  const nz = dx / length;
  const startX = start.x + nx * offset;
  const startZ = start.z + nz * offset;
  const endX = end.x + nx * offset;
  const endZ = end.z + nz * offset;
  const startHeight = elevationAt(data.terrain, startX, startZ) + heightOffset;
  const endHeight = elevationAt(data.terrain, endX, endZ) + heightOffset;
  const bucket = buckets.get(tile.id) ?? { positions: [], indices: [], featureIds: [], tile, vertex: 0 };
  bucket.positions.push(
    startX + nx * halfWidth, startHeight, startZ + nz * halfWidth,
    startX - nx * halfWidth, startHeight, startZ - nz * halfWidth,
    endX + nx * halfWidth, endHeight, endZ + nz * halfWidth,
    endX - nx * halfWidth, endHeight, endZ - nz * halfWidth,
  );
  bucket.indices.push(
    bucket.vertex, bucket.vertex + 1, bucket.vertex + 2,
    bucket.vertex + 2, bucket.vertex + 1, bucket.vertex + 3,
  );
  bucket.vertex += 4;
  bucket.featureIds.push(featureId);
  buckets.set(tile.id, bucket);
}

function roadBucketMeshes(
  buckets: Map<string, RoadTileBucket>,
  color: number,
  name: string,
  style: WorldStyle,
  unlit: boolean,
): THREE.Mesh[] {
  return [...buckets.values()].map((bucket) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setIndex(bucket.indices);
    geometry.computeVertexNormals();
    const material = unlit
      ? new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
      : materialForStyle(style, color);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${name} ${bucket.tile.id}`;
    mesh.receiveShadow = !unlit;
    mesh.userData = {
      worldseedLayer: "roads",
      featureIds: [...new Set(bucket.featureIds)],
      worldseedTile: bucket.tile,
      worldseedDetail: true,
    };
    return mesh;
  });
}

function createRoadFurniture(roadGraph: RoadGraph, data: WorldData, style: WorldStyle): THREE.InstancedMesh[] {
  const buckets = new Map<string, FurnitureBucket>();
  const edgeById = new Map(roadGraph.edges.map((edge) => [edge.id, edge]));
  let treeCount = 0;
  let junctionCount = 0;
  for (const edge of roadGraph.edges) {
    if (treeCount >= 420 || edge.lengthMeters < 30 || ["motorway", "trunk"].includes(edge.class)) continue;
    const first = edge.path[0];
    const last = edge.path.at(-1);
    if (!first || !last) continue;
    const dx = last.x - first.x;
    const dz = last.z - first.z;
    const length = Math.hypot(dx, dz);
    if (length < 1) continue;
    const side = seededUnit(`${edge.id}:tree-side`) > 0.5 ? 1 : -1;
    for (let distance = 22; distance < length - 8 && treeCount < 420; distance += 42) {
      const amount = distance / length;
      const offset = edge.widthMeters / 2 + 3.2;
      const x = first.x + dx * amount + (-dz / length) * offset * side;
      const z = first.z + dz * amount + (dx / length) * offset * side;
      if (Math.hypot(x, z) > data.radius - 4) continue;
      const bucket = furnitureBucket(buckets, x, z);
      bucket.trees.push(instanceMatrix(x, elevationAt(data.terrain, x, z), z, seededUnit(`${edge.id}:${distance}`) * Math.PI * 2, 0.82 + seededUnit(`${edge.id}:${distance}:scale`) * 0.45));
      treeCount += 1;
    }
  }
  for (const node of roadGraph.nodes) {
    if (junctionCount >= 180 || node.edgeIds.length < 3 || Math.hypot(node.x, node.z) > data.radius - 5) continue;
    const edge = edgeById.get(node.edgeIds[0] ?? "");
    const next = edge?.path.find((point) => Math.hypot(point.x - node.x, point.z - node.z) > 0.5);
    if (!edge || !next) continue;
    const dx = next.x - node.x;
    const dz = next.z - node.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const offset = edge.widthMeters / 2 + 2.1;
    const x = node.x + (-dz / length) * offset;
    const z = node.z + (dx / length) * offset;
    const bucket = furnitureBucket(buckets, x, z);
    const ground = elevationAt(data.terrain, x, z);
    bucket.lights.push(instanceMatrix(x, ground, z, Math.atan2(dx, dz), 1));
    if (junctionCount % 2 === 0) bucket.signs.push(instanceMatrix(x + dx / length, ground, z + dz / length, Math.atan2(dx, dz), 1));
    junctionCount += 1;
  }

  const treeGeometry = mergedPrimitive([
    translated(new THREE.CylinderGeometry(0.2, 0.26, 2.5, 7), 0, 1.25, 0),
    translated(new THREE.ConeGeometry(1.35, 3.1, 7), 0, 3.45, 0),
  ]);
  const lightGeometry = mergedPrimitive([
    translated(new THREE.CylinderGeometry(0.09, 0.13, 4.8, 7), 0, 2.4, 0),
    translated(new THREE.BoxGeometry(0.75, 0.18, 0.24), 0.28, 4.72, 0),
  ]);
  const signGeometry = mergedPrimitive([
    translated(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 7), 0, 1.2, 0),
    translated(new THREE.BoxGeometry(0.9, 0.62, 0.12), 0, 2.35, 0),
  ]);
  const treeColor = style === "cyber" ? 0x25aeb0 : style === "blueprint" ? 0x4c9bc5 : 0x4f7f55;
  const metalColor = style === "cyber" ? 0x6ae5ef : style === "blueprint" ? 0x8bd8ff : 0x3d4741;
  const signColor = style === "cyber" ? 0xff55ca : style === "blueprint" ? 0x79c8f2 : 0xd9c96b;
  const objects: THREE.InstancedMesh[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.trees.length > 0) objects.push(instancedDetail(treeGeometry, bucket.trees, treeColor, `Street trees ${bucket.tile.id}`, bucket.tile));
    if (bucket.lights.length > 0) objects.push(instancedDetail(lightGeometry, bucket.lights, metalColor, `Street lights ${bucket.tile.id}`, bucket.tile));
    if (bucket.signs.length > 0) objects.push(instancedDetail(signGeometry, bucket.signs, signColor, `Road signs ${bucket.tile.id}`, bucket.tile));
  }
  treeGeometry.dispose();
  lightGeometry.dispose();
  signGeometry.dispose();
  return objects;
}

function furnitureBucket(buckets: Map<string, FurnitureBucket>, x: number, z: number): FurnitureBucket {
  const tile = tileForPoint(x, z, WORLD_TILE_SIZE);
  const bucket = buckets.get(tile.id) ?? { tile, trees: [], lights: [], signs: [] };
  buckets.set(tile.id, bucket);
  return bucket;
}

function instanceMatrix(x: number, y: number, z: number, yaw: number, scale: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(scale, scale, scale),
  );
}

function instancedDetail(
  baseGeometry: THREE.BufferGeometry,
  matrices: THREE.Matrix4[],
  color: number,
  name: string,
  tile: WorldTile,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    baseGeometry.clone(),
    new THREE.MeshStandardMaterial({ color, roughness: 0.76, metalness: 0.04, flatShading: true }),
    matrices.length,
  );
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { worldseedLayer: "roads", worldseedTile: tile, worldseedDetail: true };
  return mesh;
}

function mergedPrimitive(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(geometries, false) ?? new THREE.BufferGeometry();
  geometries.forEach((geometry) => geometry.dispose());
  return merged;
}

function translated(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geometry.translate(x, y, z);
  return geometry;
}

function interpolateSegment(start: LocalPoint, end: LocalPoint, amount: number): LocalPoint {
  return { x: start.x + (end.x - start.x) * amount, z: start.z + (end.z - start.z) * amount };
}

function applyTerrainToGeometry(
  geometry: THREE.BufferGeometry,
  data: WorldData,
  offset: number,
): void {
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, elevationAt(data.terrain, positions.getX(index), positions.getZ(index)) + offset);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}

function polygonToShape(polygon: PolygonRings, data: WorldData): THREE.Shape | null {
  const outer = ringToVectors(polygon[0], data);
  if (outer.length < 3) return null;
  if (!THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
  const shape = new THREE.Shape(outer);
  for (const ring of polygon.slice(1)) {
    const hole = ringToVectors(ring, data);
    if (hole.length < 3) continue;
    if (THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
    shape.holes.push(new THREE.Path(hole));
  }
  return shape;
}

function ringToVectors(ring: PolygonRings[number] | undefined, data: WorldData): THREE.Vector2[] {
  const points = ringToLocal(ring, data);
  return points.map((point) => new THREE.Vector2(point.x, -point.z));
}

function ringToLocal(ring: PolygonRings[number] | undefined, data: WorldData): LocalPoint[] {
  const points = (ring ?? []).map((coordinate) => toLocalMeters(coordinate, data.center));
  if (points.length > 1) {
    const first = points[0];
    const last = points.at(-1);
    if (first && last && Math.abs(first.x - last.x) < 0.001 && Math.abs(first.z - last.z) < 0.001) points.pop();
  }
  return Math.abs(signedArea(points)) > 0.05 ? points : [];
}

function buildingDistanceScore(building: ResolvedBuilding, data: WorldData): number {
  const ring = ringToLocal(building.polygons[0]?.[0], data);
  const centroid = polygonCentroid(ring);
  return Math.hypot(centroid.x, centroid.z) - Math.min(building.resolvedHeight, 100) * 0.2;
}

function collectStats(
  group: THREE.Group,
  buildings: ResolvedBuilding[],
  data: WorldData,
  truncatedBuildings: number,
  roofs: number,
  shapedRoofs: number,
  semanticObjects: number,
  tiles: number,
  plateauBuildings: number,
  plateauLod2Buildings: number,
  roadGraph: RoadGraph,
): WorldStats {
  let triangles = 0;
  let drawCalls = 0;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    drawCalls += 1;
    const index = object.geometry.index;
    triangles += index ? index.count / 3 : object.geometry.getAttribute("position").count / 3;
  });
  return {
    buildings: buildings.length,
    roads: data.roads.length,
    areas: data.areas.length,
    providedHeights: buildings.filter((building) => building.heightQuality === "provided").length,
    levelHeights: buildings.filter((building) => building.heightQuality === "levels").length,
    inferredHeights: buildings.filter((building) => building.heightQuality === "inferred").length,
    triangles: Math.round(triangles),
    drawCalls,
    truncatedBuildings,
    terrainRelief: data.terrain
      ? data.terrain.maximumElevation - data.terrain.minimumElevation
      : 0,
    roofs,
    shapedRoofs,
    semanticObjects,
    tiles,
    plateauBuildings,
    plateauLod2Buildings,
    roadNodes: roadGraph.nodes.length,
    roadEdges: roadGraph.edges.length,
    drivableRoadMeters: Math.round(roadGraph.edges.reduce((total, edge) => total + edge.lengthMeters, 0)),
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
