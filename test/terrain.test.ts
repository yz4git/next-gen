import { describe, expect, it } from "vitest";
import { createDemoElevationGrid, decodeTerrariumPixel, elevationAt } from "../src/terrain/elevation";
import type { ElevationGrid } from "../src/types";

describe("terrain elevation", () => {
  it("decodes the documented Terrarium RGB format", () => {
    expect(decodeTerrariumPixel(137, 219, 68)).toBeCloseTo(2523.265625);
    expect(decodeTerrariumPixel(128, 0, 0)).toBe(0);
  });

  it("bilinearly samples local-meter elevation grids", () => {
    const grid: ElevationGrid = {
      columns: 2,
      rows: 2,
      minX: -10,
      maxX: 10,
      minZ: -10,
      maxZ: 10,
      heights: [0, 10, 20, 30],
      originElevation: 100,
      minimumElevation: 0,
      maximumElevation: 30,
      source: "mapzen",
    };
    expect(elevationAt(grid, 0, 0)).toBe(15);
    expect(elevationAt(grid, -10, -10)).toBe(0);
    expect(elevationAt(grid, 20, 20)).toBe(30);
  });

  it("ships deterministic terrain for the offline demo", () => {
    const first = createDemoElevationGrid(500);
    const second = createDemoElevationGrid(500);
    expect(first.heights).toEqual(second.heights);
    expect(first.maximumElevation - first.minimumElevation).toBeGreaterThan(5);
  });
});
