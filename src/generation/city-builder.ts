import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BUILDING_BATCH_SIZE, MAX_BUILDINGS } from "../config";
import { toLocalMeters, type LocalPoint } from "../geo/coordinates";
import { clipSegmentToCircle, polygonCentroid, signedArea } from "../geo/polygon";
import type {
  AreaFeature,
  PolygonRings,
  ResolvedBuilding,
  RoadFeature,
  WorldData,
  WorldStats,
  WorldStyle,
} from "../types";
import { CollisionIndex } from "./collision";
import { resolveBuildingHeight, seededUnit } from "./height";
import { materialForStyle, WORLD_PALETTES } from "./styles";

export interface BuiltCity {
  group: THREE.Group;
  collision: CollisionIndex;
  stats: WorldStats;
  resolvedBuildings: ResolvedBuilding[];
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
  };

  const collision = new CollisionIndex(data.radius);
  group.add(createGround(data.radius, style));
  group.add(...createAreas(data.areas, data, style));
  const roads = createRoads(data.roads, data, style);
  if (roads) group.add(roads);

  const allResolved = data.buildings.map(resolveBuildingHeight);
  const ranked = allResolved
    .map((building) => ({ building, score: buildingDistanceScore(building, data) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_BUILDINGS)
    .map(({ building }) => building);

  const buckets: THREE.BufferGeometry[][] = palette.buildings.map(() => []);
  let processed = 0;
  for (const building of ranked) {
    for (const polygon of building.polygons) {
      const localOuter = ringToLocal(polygon[0], data);
      if (localOuter.length < 3) continue;
      if (Math.hypot(polygonCentroid(localOuter).x, polygonCentroid(localOuter).z) > data.radius + 60) continue;
      const shape = polygonToShape(polygon, data);
      if (!shape) continue;
      const height = Math.max(1, building.resolvedHeight - building.resolvedMinHeight);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
        curveSegments: 1,
        steps: 1,
      });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, building.resolvedMinHeight, 0);
      geometry.computeVertexNormals();
      const bucketIndex = style === "quality"
        ? building.heightQuality === "provided" ? 0 : building.heightQuality === "levels" ? 1 : 2
        : Math.floor(seededUnit(`${building.id}:color`) * buckets.length) % buckets.length;
      buckets[bucketIndex]?.push(geometry);
      collision.add(localOuter);
    }
    processed += 1;
    if (processed % BUILDING_BATCH_SIZE === 0) {
      onProgress?.(processed / Math.max(1, ranked.length), `Building city… ${processed.toLocaleString()} structures`);
      await nextFrame();
    }
  }

  for (let index = 0; index < buckets.length; index += 1) {
    const geometries = buckets[index];
    const color = palette.buildings[index];
    if (!geometries || geometries.length === 0 || color === undefined) continue;
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materialForStyle(style, color));
    mesh.name = `Buildings ${index + 1}`;
    mesh.castShadow = style !== "cyber";
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const stats = collectStats(group, ranked, data, allResolved.length - ranked.length);
  onProgress?.(1, "City ready");
  return { group, collision, stats, resolvedBuildings: ranked };
}

function createGround(radius: number, style: WorldStyle): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(radius, 128);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, materialForStyle(style, WORLD_PALETTES[style].ground));
  mesh.name = "Ground";
  mesh.receiveShadow = true;
  return mesh;
}

function createAreas(areas: AreaFeature[], data: WorldData, style: WorldStyle): THREE.Mesh[] {
  const byKind = new Map<AreaFeature["kind"], THREE.BufferGeometry[]>();
  for (const area of areas) {
    for (const polygon of area.polygons) {
      const shape = polygonToShape(polygon, data);
      if (!shape) continue;
      const geometry = new THREE.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, area.kind === "water" ? 0.08 : 0.04, 0);
      const bucket = byKind.get(area.kind) ?? [];
      bucket.push(geometry);
      byKind.set(area.kind, bucket);
    }
  }

  return [...byKind.entries()].flatMap(([kind, geometries]) => {
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) return [];
    const mesh = new THREE.Mesh(merged, materialForStyle(style, WORLD_PALETTES[style][kind]));
    mesh.name = `${kind[0]?.toUpperCase() ?? ""}${kind.slice(1)}`;
    mesh.receiveShadow = true;
    return [mesh];
  });
}

function createRoads(roads: RoadFeature[], data: WorldData, style: WorldStyle): THREE.Mesh | null {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertex = 0;
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
      positions.push(
        start.x + nx, 0.1, start.z + nz,
        start.x - nx, 0.1, start.z - nz,
        end.x + nx, 0.1, end.z + nz,
        end.x - nx, 0.1, end.z - nz,
      );
      indices.push(vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3);
      vertex += 4;
    }
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, materialForStyle(style, WORLD_PALETTES[style].road));
  mesh.name = "Roads";
  mesh.receiveShadow = true;
  return mesh;
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
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

