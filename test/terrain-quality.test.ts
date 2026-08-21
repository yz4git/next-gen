import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ElevationGrid } from "../src/types";
import {
  applyTerrainQualityColors,
  buildRadialTerrainIndices,
  createAdaptiveTerrainGeometry,
  orientTerrainFacesUp,
  selectTerrainLod,
  terrainGridSizeForRadius,
  terrainMeshProfile,
  terrainResolutionMeters,
} from "../src/terrain/quality";

function grid(size: number, radius: number): ElevationGrid {
  const heights: number[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = -radius + (column / (size - 1)) * radius * 2;
      const z = -radius + (row / (size - 1)) * radius * 2;
      heights.push(Math.sin(x / 75) * 8 + Math.cos(z / 90) * 6);
    }
  }
  return {
    columns: size,
    rows: size,
    minX: -radius,
    maxX: radius,
    minZ: -radius,
    maxZ: radius,
    heights,
    originElevation: 0,
    minimumElevation: Math.min(...heights),
    maximumElevation: Math.max(...heights),
    source: "demo",
  };
}

describe("Terrain Quality v2", () => {
  it("scales DEM sampling with world radius", () => {
    expect(terrainGridSizeForRadius(100)).toBe(65);
    expect(terrainGridSizeForRadius(300)).toBe(65);
    expect(terrainGridSizeForRadius(301)).toBe(129);
    expect(terrainGridSizeForRadius(600)).toBe(129);
    expect(terrainGridSizeForRadius(601)).toBe(257);
    expect(terrainGridSizeForRadius(1_000)).toBe(257);
  });

  it("reports source resolution and builds a bounded adaptive mesh", () => {
    const terrain = grid(257, 1_000);
    expect(terrainResolutionMeters(terrain)).toBeCloseTo(7.8125, 4);
    const profile = terrainMeshProfile(terrain, 1_000);
    expect(profile.rings).toBeGreaterThanOrEqual(100);
    expect(profile.rings).toBeLessThanOrEqual(128);
    expect(profile.sectors).toBe(384);

    const geometry = createAdaptiveTerrainGeometry(terrain, 1_000);
    expect(geometry.getAttribute("position").count).toBe(1 + profile.rings * profile.sectors);
    expect(geometry.getIndex()?.count).toBeGreaterThan(200_000);
    const normal = geometry.getAttribute("normal");
    expect(normal.getY(0)).toBeGreaterThan(0);
    geometry.dispose();
  });

  it("decimates radial indices without changing terrain coverage", () => {
    const high = buildRadialTerrainIndices(128, 48, 1);
    const medium = buildRadialTerrainIndices(128, 48, 2);
    const low = buildRadialTerrainIndices(128, 48, 4);
    expect(high.length).toBeGreaterThan(medium.length);
    expect(medium.length).toBeGreaterThan(low.length);
    expect(Math.max(...low)).toBe(1 + (48 - 1) * 128 + 124);
  });

  it("repairs legacy downward terrain winding for chase-camera views", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0,
      10, 0, 0,
      0, 2, 10,
    ], 3));
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
    expect(geometry.getAttribute("normal").getY(0)).toBeLessThan(0);

    expect(orientTerrainFacesUp(geometry)).toBe(true);
    expect(geometry.getAttribute("normal").getY(0)).toBeGreaterThan(0);
    expect(orientTerrainFacesUp(geometry)).toBe(false);
    geometry.dispose();
  });

  it("keeps ground interaction high-res and reduces distant aerial terrain", () => {
    expect(selectTerrainLod("drive", 2_000, 20, 1_000)).toBe("high");
    expect(selectTerrainLod("walk", 2_000, 3, 1_000)).toBe("high");
    expect(selectTerrainLod("fly", 700, 160, 1_000)).toBe("high");
    expect(selectTerrainLod("fly", 700, 400, 1_000)).toBe("medium");
    expect(selectTerrainLod("orbit", 2_000, 700, 1_000)).toBe("low");
  });

  it("adds slope/elevation colors for the Data Quality view", () => {
    const terrain = grid(65, 250);
    const geometry = createAdaptiveTerrainGeometry(terrain, 250);
    applyTerrainQualityColors(geometry);
    expect(geometry.getAttribute("color")?.count).toBe(geometry.getAttribute("position").count);
    geometry.dispose();
  });
});
