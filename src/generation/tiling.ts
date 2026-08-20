import type { ExploreMode } from "../types";

export interface WorldTile {
  id: string;
  x: number;
  z: number;
  centerX: number;
  centerZ: number;
  size: number;
}

export interface StreamingRange {
  base: number;
  detail: number;
}

export function tileForPoint(x: number, z: number, size: number): WorldTile {
  const tileX = Math.floor((x + size / 2) / size);
  const tileZ = Math.floor((z + size / 2) / size);
  return {
    id: `${tileX}:${tileZ}`,
    x: tileX,
    z: tileZ,
    centerX: tileX * size,
    centerZ: tileZ * size,
    size,
  };
}

export function streamingRange(mode: ExploreMode, radius: number): StreamingRange {
  if (mode === "orbit") {
    return {
      base: Math.max(600, radius * 2.25),
      detail: Math.max(450, radius * 1.25),
    };
  }
  if (mode === "fly") {
    return {
      base: Math.min(1_350, Math.max(720, radius * 1.15)),
      detail: Math.min(900, Math.max(480, radius * 0.8)),
    };
  }
  return {
    base: Math.min(900, Math.max(480, radius * 0.78)),
    detail: Math.min(620, Math.max(340, radius * 0.55)),
  };
}

export function tileIsVisible(
  tile: Pick<WorldTile, "centerX" | "centerZ" | "size">,
  cameraX: number,
  cameraZ: number,
  distance: number,
): boolean {
  const padding = tile.size * Math.SQRT2 / 2;
  return Math.hypot(tile.centerX - cameraX, tile.centerZ - cameraZ) <= distance + padding;
}
