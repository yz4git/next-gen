import type { ElevationGrid } from "../types";

export function decodeTerrariumPixel(red: number, green: number, blue: number): number {
  return red * 256 + green + blue / 256 - 32_768;
}

export function elevationAt(grid: ElevationGrid | undefined, x: number, z: number): number {
  if (!grid || grid.columns < 2 || grid.rows < 2 || grid.heights.length === 0) return 0;
  const width = Math.max(Number.EPSILON, grid.maxX - grid.minX);
  const depth = Math.max(Number.EPSILON, grid.maxZ - grid.minZ);
  const column = clamp(((x - grid.minX) / width) * (grid.columns - 1), 0, grid.columns - 1);
  const row = clamp(((z - grid.minZ) / depth) * (grid.rows - 1), 0, grid.rows - 1);
  const left = Math.floor(column);
  const right = Math.min(grid.columns - 1, left + 1);
  const top = Math.floor(row);
  const bottom = Math.min(grid.rows - 1, top + 1);
  const horizontal = column - left;
  const vertical = row - top;
  const topLeft = grid.heights[top * grid.columns + left] ?? 0;
  const topRight = grid.heights[top * grid.columns + right] ?? topLeft;
  const bottomLeft = grid.heights[bottom * grid.columns + left] ?? topLeft;
  const bottomRight = grid.heights[bottom * grid.columns + right] ?? bottomLeft;
  return lerp(lerp(topLeft, topRight, horizontal), lerp(bottomLeft, bottomRight, horizontal), vertical);
}

export function createDemoElevationGrid(radius: number): ElevationGrid {
  const columns = 33;
  const rows = 33;
  const heights: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    const z = -radius + (row / (rows - 1)) * radius * 2;
    for (let column = 0; column < columns; column += 1) {
      const x = -radius + (column / (columns - 1)) * radius * 2;
      const broad = Math.sin(x / 230) * 3.2 + Math.cos(z / 280) * 2.4;
      const detail = Math.sin((x + z) / 95) * 0.8;
      heights.push(broad + detail - 2.4);
    }
  }
  const minimumElevation = Math.min(...heights);
  const maximumElevation = Math.max(...heights);
  return {
    columns,
    rows,
    minX: -radius,
    maxX: radius,
    minZ: -radius,
    maxZ: radius,
    heights,
    originElevation: 0,
    minimumElevation,
    maximumElevation,
    source: "demo",
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
