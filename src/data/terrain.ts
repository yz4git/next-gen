import { TERRAIN_TILES_URL, TERRAIN_TILE_ZOOM } from "../config";
import { boundsAround, fromLocalMeters } from "../geo/coordinates";
import { tilesForBounds } from "../geo/tiles";
import { decodeTerrariumPixel } from "../terrain/elevation";
import { terrainGridSizeForRadius } from "../terrain/quality";
import type { ElevationGrid, LonLat } from "../types";
import { coordinateCacheKey, getCached, setCached } from "./cache";

interface DecodedTile {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface TerrainLoadProgress {
  phase: "tiles" | "sampling" | "cache";
  completed: number;
  total: number;
}

const TERRAIN_FETCH_CONCURRENCY = 4;
const TERRAIN_TILE_TIMEOUT_MS = 8_000;
const TERRAIN_DECODE_TIMEOUT_MS = 5_000;
const TERRAIN_CACHE_READ_TIMEOUT_MS = 1_200;
const TERRAIN_CACHE_WRITE_TIMEOUT_MS = 1_500;

export class TerrainProvider {
  async load(
    center: LonLat,
    radius: number,
    signal?: AbortSignal,
    onProgress?: (progress: TerrainLoadProgress) => void,
  ): Promise<ElevationGrid> {
    const gridSize = terrainGridSizeForRadius(radius);
    const cacheKey = coordinateCacheKey(`terrain-v2-${gridSize}`, center[0], center[1], radius);
    const cached = await softTimeout(getCached<ElevationGrid>(cacheKey), TERRAIN_CACHE_READ_TIMEOUT_MS, null);
    if (cached) {
      onProgress?.({ phase: "cache", completed: 1, total: 1 });
      return cached;
    }

    throwIfAborted(signal);
    const bounds = boundsAround(center, radius + 25);
    const coordinates = tilesForBounds(bounds, TERRAIN_TILE_ZOOM);
    const decoded = new Map<string, DecodedTile>();
    let completedTiles = 0;

    await runWithConcurrency(coordinates, TERRAIN_FETCH_CONCURRENCY, async ({ x, y, z }) => {
      throwIfAborted(signal);
      const url = TERRAIN_TILES_URL
        .replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      const response = await fetchTerrainTile(url, signal);
      const blob = await response.blob();
      const tile = await hardTimeout(
        decodePng(blob),
        TERRAIN_DECODE_TIMEOUT_MS,
        "Terrain PNG decode timed out",
        signal,
      );
      decoded.set(`${x}:${y}`, tile);
      completedTiles += 1;
      onProgress?.({ phase: "tiles", completed: completedTiles, total: coordinates.length });
    });

    const columns = gridSize;
    const rows = gridSize;
    const absoluteHeights = new Array<number>(columns * rows);
    for (let row = 0; row < rows; row += 1) {
      throwIfAborted(signal);
      const z = -radius + (row / (rows - 1)) * radius * 2;
      for (let column = 0; column < columns; column += 1) {
        const x = -radius + (column / (columns - 1)) * radius * 2;
        absoluteHeights[row * columns + column] = sampleTiles(
          decoded,
          fromLocalMeters({ x, z }, center),
          TERRAIN_TILE_ZOOM,
        );
      }
      if (row % 16 === 15 || row === rows - 1) {
        onProgress?.({ phase: "sampling", completed: row + 1, total: rows });
        await yieldToBrowser(signal);
      }
    }

    const middle = Math.floor(rows / 2) * columns + Math.floor(columns / 2);
    const originElevation = absoluteHeights[middle] ?? 0;
    const heights = new Array<number>(absoluteHeights.length);
    let minimumElevation = Number.POSITIVE_INFINITY;
    let maximumElevation = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < absoluteHeights.length; index += 1) {
      const height = (absoluteHeights[index] ?? originElevation) - originElevation;
      heights[index] = height;
      minimumElevation = Math.min(minimumElevation, height);
      maximumElevation = Math.max(maximumElevation, height);
    }

    const grid: ElevationGrid = {
      columns,
      rows,
      minX: -radius,
      maxX: radius,
      minZ: -radius,
      maxZ: radius,
      heights,
      originElevation,
      minimumElevation: Number.isFinite(minimumElevation) ? minimumElevation : 0,
      maximumElevation: Number.isFinite(maximumElevation) ? maximumElevation : 0,
      source: "mapzen",
    };
    await softTimeout(setCached(cacheKey, grid), TERRAIN_CACHE_WRITE_TIMEOUT_MS, undefined);
    onProgress?.({ phase: "cache", completed: 1, total: 1 });
    return grid;
  }
}

async function fetchTerrainTile(url: string, signal?: AbortSignal): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, signal, TERRAIN_TILE_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Terrain tiles returned ${response.status}`);
      return response;
    } catch (error) {
      if (signal?.aborted) throw cancellationError();
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Terrain tile request failed");
}

async function fetchWithTimeout(url: string, parentSignal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = (): void => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    if (parentSignal?.aborted) throw cancellationError();
    if (timedOut) throw new Error("Terrain tile request timed out");
    throw error;
  } finally {
    window.clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

async function runWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      const value = values[index];
      if (value !== undefined) await worker(value);
    }
  });
  await Promise.all(workers);
}

async function hardTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(cancellationError()));
    const timer = window.setTimeout(() => finish(() => reject(new Error(message))), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

async function softTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

async function yieldToBrowser(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  throwIfAborted(signal);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError();
}

function cancellationError(): DOMException {
  return new DOMException("Generation cancelled", "AbortError");
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
