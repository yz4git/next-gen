import * as THREE from "three";
import type { ElevationGrid, ExploreMode } from "../types";
import { elevationAt } from "./elevation";

export type TerrainLodLevel = "high" | "medium" | "low";

export interface TerrainMeshProfile {
  sectors: number;
  rings: number;
  sourceResolutionMeters: number;
}

/**
 * Keep live DEM sampling close to ~8 m between samples without paying the
 * 257x257 cost for small seeds. The world radius is bounded to 100-1,000 m.
 */
export function terrainGridSizeForRadius(radius: number): number {
  const bounded = Math.max(100, Math.min(1_000, radius));
  if (bounded <= 300) return 65;
  if (bounded <= 600) return 129;
  return 257;
}

export function terrainResolutionMeters(grid: ElevationGrid): number {
  const x = Math.abs(grid.maxX - grid.minX) / Math.max(1, grid.columns - 1);
  const z = Math.abs(grid.maxZ - grid.minZ) / Math.max(1, grid.rows - 1);
  return Math.max(x, z);
}

/**
 * Choose enough radial vertices to preserve the source DEM without making a
 * 100 m seed pay the same GPU cost as a 1 km seed.
 */
export function terrainMeshProfile(grid: ElevationGrid, radius: number): TerrainMeshProfile {
  const sourceResolutionMeters = Math.max(2, terrainResolutionMeters(grid));
  const ringSpacing = Math.max(6, sourceResolutionMeters * 1.15);
  const arcSpacing = Math.max(10, sourceResolutionMeters * 1.7);
  const rings = clampInteger(Math.ceil(radius / ringSpacing), 32, 128);
  const rawSectors = Math.ceil((Math.PI * 2 * radius) / arcSpacing);
  const sectors = clampInteger(roundUp(rawSectors, 32), 128, 384);
  return { sectors, rings, sourceResolutionMeters };
}

export function createAdaptiveTerrainGeometry(grid: ElevationGrid, radius: number): THREE.BufferGeometry {
  const profile = terrainMeshProfile(grid, radius);
  const positions: number[] = [0, elevationAt(grid, 0, 0), 0];
  for (let ring = 1; ring <= profile.rings; ring += 1) {
    const distance = (ring / profile.rings) * radius;
    for (let sector = 0; sector < profile.sectors; sector += 1) {
      const angle = (sector / profile.sectors) * Math.PI * 2;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      positions.push(x, elevationAt(grid, x, z), z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(buildRadialTerrainIndices(profile.sectors, profile.rings, 1));
  geometry.userData = {
    ...geometry.userData,
    terrainSectors: profile.sectors,
    terrainRings: profile.rings,
    terrainResolutionMeters: profile.sourceResolutionMeters,
  };
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Repair legacy terrain geometry whose triangle winding points below the
 * ground plane. Front-side culling otherwise makes slopes disappear from a
 * low chase camera even though the geometry is still present.
 */
export function orientTerrainFacesUp(geometry: THREE.BufferGeometry): boolean {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index || !position) return false;

  let changed = false;
  for (let offset = 0; offset + 2 < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    const ax = position.getX(a);
    const az = position.getZ(a);
    const bx = position.getX(b);
    const bz = position.getZ(b);
    const cx = position.getX(c);
    const cz = position.getZ(c);
    const ux = bx - ax;
    const uz = bz - az;
    const vx = cx - ax;
    const vz = cz - az;
    const normalY = uz * vx - ux * vz;
    if (normalY >= 0) continue;
    index.setX(offset + 1, c);
    index.setX(offset + 2, b);
    changed = true;
  }

  if (changed) {
    index.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  return changed;
}

/**
 * Re-index the same terrain vertices for cheap far-distance rendering. This
 * keeps the full-resolution vertex data available for Drive/Walk and exports.
 */
export function createTerrainLodIndex(
  geometry: THREE.BufferGeometry,
  stride: 2 | 4,
): THREE.BufferAttribute | null {
  const topology = terrainTopology(geometry);
  if (!topology) return null;
  const indices = buildRadialTerrainIndices(topology.sectors, topology.rings, stride);
  const maximum = geometry.getAttribute("position").count - 1;
  return maximum <= 65_535
    ? new THREE.Uint16BufferAttribute(indices, 1)
    : new THREE.Uint32BufferAttribute(indices, 1);
}

export function buildRadialTerrainIndices(sectors: number, rings: number, stride = 1): number[] {
  const sectorStep = Math.max(1, Math.floor(stride));
  const ringStep = Math.max(1, Math.floor(stride));
  const sampledRings: number[] = [];
  for (let ring = ringStep; ring <= rings; ring += ringStep) sampledRings.push(ring);
  if (sampledRings.at(-1) !== rings) sampledRings.push(rings);

  const indices: number[] = [];
  const firstRing = sampledRings[0];
  if (!firstRing) return indices;
  for (let sector = 0; sector < sectors; sector += sectorStep) {
    const next = (sector + sectorStep) % sectors;
    indices.push(0, vertexIndex(firstRing, next, sectors), vertexIndex(firstRing, sector, sectors));
  }

  for (let ringIndex = 1; ringIndex < sampledRings.length; ringIndex += 1) {
    const innerRing = sampledRings[ringIndex - 1]!;
    const outerRing = sampledRings[ringIndex]!;
    for (let sector = 0; sector < sectors; sector += sectorStep) {
      const next = (sector + sectorStep) % sectors;
      const inner = vertexIndex(innerRing, sector, sectors);
      const innerNext = vertexIndex(innerRing, next, sectors);
      const outer = vertexIndex(outerRing, sector, sectors);
      const outerNext = vertexIndex(outerRing, next, sectors);
      indices.push(inner, innerNext, outer, innerNext, outerNext, outer);
    }
  }
  return indices;
}

export function selectTerrainLod(
  mode: ExploreMode,
  cameraDistance: number,
  cameraHeight: number,
  radius: number,
): TerrainLodLevel {
  if (mode === "walk" || mode === "drive") return "high";
  if (mode === "fly") return cameraHeight < 220 ? "high" : "medium";
  if (cameraDistance < Math.max(180, radius * 0.62)) return "high";
  if (cameraDistance < Math.max(420, radius * 1.45)) return "medium";
  return "low";
}

/**
 * Data Quality terrain colors: hue communicates slope while lightness carries
 * elevation. Flat ground reads cool, steep ground warms toward amber/red.
 */
export function applyTerrainQualityColors(geometry: THREE.BufferGeometry): void {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!position || !normal) return;

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const relief = Math.max(1, maxY - minY);
  const cool = new THREE.Color(0x4bb3fd);
  const moderate = new THREE.Color(0x6fd08c);
  const steep = new THREE.Color(0xffc857);
  const cliff = new THREE.Color(0xff6b6b);
  const color = new THREE.Color();
  const colors: number[] = [];

  for (let index = 0; index < position.count; index += 1) {
    const normalY = Math.max(0, Math.min(1, normal.getY(index)));
    const slopeDegrees = Math.acos(normalY) * 180 / Math.PI;
    const slope = Math.max(0, Math.min(1, slopeDegrees / 48));
    if (slope < 0.34) color.lerpColors(cool, moderate, slope / 0.34);
    else if (slope < 0.7) color.lerpColors(moderate, steep, (slope - 0.34) / 0.36);
    else color.lerpColors(steep, cliff, (slope - 0.7) / 0.3);
    const elevation = (position.getY(index) - minY) / relief;
    color.offsetHSL(0, 0, (elevation - 0.5) * 0.12);
    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
}

function terrainTopology(geometry: THREE.BufferGeometry): { sectors: number; rings: number } | null {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 129) return null;
  const sectorsFromMetadata = Number(geometry.userData["terrainSectors"]);
  const ringsFromMetadata = Number(geometry.userData["terrainRings"]);
  if (
    Number.isSafeInteger(sectorsFromMetadata)
    && Number.isSafeInteger(ringsFromMetadata)
    && sectorsFromMetadata > 0
    && ringsFromMetadata > 0
    && 1 + sectorsFromMetadata * ringsFromMetadata === position.count
  ) {
    return { sectors: sectorsFromMetadata, rings: ringsFromMetadata };
  }
  if ((position.count - 1) % 128 === 0) {
    return { sectors: 128, rings: (position.count - 1) / 128 };
  }
  return null;
}

function vertexIndex(ring: number, sector: number, sectors: number): number {
  return 1 + (ring - 1) * sectors + (sector % sectors);
}

function roundUp(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
