import { TERRAIN_GRID_SIZE, TERRAIN_TILES_URL, TERRAIN_TILE_ZOOM } from "../config";
import { boundsAround, fromLocalMeters } from "../geo/coordinates";
import { tilesForBounds } from "../geo/tiles";
import { decodeTerrariumPixel } from "../terrain/elevation";
import type { ElevationGrid, LonLat } from "../types";
import { coordinateCacheKey, getCached, setCached } from "./cache";

interface DecodedTile {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export class TerrainProvider {
  async load(center: LonLat, radius: number, signal?: AbortSignal): Promise<ElevationGrid> {
    const cacheKey = coordinateCacheKey("terrain-v1", center[0], center[1], radius);
    const cached = await getCached<ElevationGrid>(cacheKey);
    if (cached) return cached;

    const bounds = boundsAround(center, radius + 25);
    const coordinates = tilesForBounds(bounds, TERRAIN_TILE_ZOOM);
    const decoded = new Map<string, DecodedTile>();
    await Promise.all(coordinates.map(async ({ x, y, z }) => {
      const url = TERRAIN_TILES_URL
        .replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      const response = await fetch(url, { signal, referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`Terrain tiles returned ${response.status}`);
      decoded.set(`${x}:${y}`, await decodePng(await response.blob()));
    }));

    const columns = TERRAIN_GRID_SIZE;
    const rows = TERRAIN_GRID_SIZE;
    const absoluteHeights: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      const z = -radius + (row / (rows - 1)) * radius * 2;
      for (let column = 0; column < columns; column += 1) {
        const x = -radius + (column / (columns - 1)) * radius * 2;
        absoluteHeights.push(sampleTiles(decoded, fromLocalMeters({ x, z }, center), TERRAIN_TILE_ZOOM));
      }
    }

    const middle = Math.floor(rows / 2) * columns + Math.floor(columns / 2);
    const originElevation = absoluteHeights[middle] ?? 0;
    const heights = absoluteHeights.map((height) => height - originElevation);
    const grid: ElevationGrid = {
      columns,
      rows,
      minX: -radius,
      maxX: radius,
      minZ: -radius,
      maxZ: radius,
      heights,
      originElevation,
      minimumElevation: Math.min(...heights),
      maximumElevation: Math.max(...heights),
      source: "mapzen",
    };
    await setCached(cacheKey, grid);
    return grid;
  }
}

function sampleTiles(tiles: Map<string, DecodedTile>, coordinate: LonLat, zoom: number): number {
  const scale = 2 ** zoom;
  const tileX = ((coordinate[0] + 180) / 360) * scale;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, coordinate[1])) * Math.PI / 180;
  const tileY = ((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2) * scale;
  const x = Math.floor(tileX);
  const y = Math.floor(tileY);
  const tile = tiles.get(`${x}:${y}`);
  if (!tile) throw new Error("A terrain tile needed for this seed was unavailable");
  const pixelX = clamp((tileX - x) * tile.width, 0, tile.width - 1);
  const pixelY = clamp((tileY - y) * tile.height, 0, tile.height - 1);
  return samplePixel(tile, pixelX, pixelY);
}

function samplePixel(tile: DecodedTile, x: number, y: number): number {
  const left = Math.floor(x);
  const right = Math.min(tile.width - 1, left + 1);
  const top = Math.floor(y);
  const bottom = Math.min(tile.height - 1, top + 1);
  const horizontal = x - left;
  const vertical = y - top;
  const first = lerp(pixelHeight(tile, left, top), pixelHeight(tile, right, top), horizontal);
  const second = lerp(pixelHeight(tile, left, bottom), pixelHeight(tile, right, bottom), horizontal);
  return lerp(first, second, vertical);
}

function pixelHeight(tile: DecodedTile, x: number, y: number): number {
  const offset = (y * tile.width + x) * 4;
  return decodeTerrariumPixel(
    tile.pixels[offset] ?? 0,
    tile.pixels[offset + 1] ?? 0,
    tile.pixels[offset + 2] ?? 0,
  );
}

async function decodePng(blob: Blob): Promise<DecodedTile> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser cannot decode terrain tiles");
    context.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
    };
  } finally {
    bitmap.close();
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
