import type { Bounds } from "./coordinates";

export interface TileCoordinate {
  x: number;
  y: number;
  z: number;
}

export function longitudeToTileX(longitude: number, zoom: number): number {
  const scale = 2 ** zoom;
  return Math.floor(((longitude + 180) / 360) * scale);
}

export function latitudeToTileY(latitude: number, zoom: number): number {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const latitudeRadians = (boundedLatitude * Math.PI) / 180;
  const scale = 2 ** zoom;
  return Math.floor(
    ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * scale,
  );
}

export function tilesForBounds(bounds: Bounds, zoom: number): TileCoordinate[] {
  const minX = longitudeToTileX(bounds.west, zoom);
  const maxX = longitudeToTileX(bounds.east, zoom);
  const minY = latitudeToTileY(bounds.north, zoom);
  const maxY = latitudeToTileY(bounds.south, zoom);
  const maxTile = 2 ** zoom - 1;
  const tiles: TileCoordinate[] = [];

  for (let x = Math.max(0, minX); x <= Math.min(maxTile, maxX); x += 1) {
    for (let y = Math.max(0, minY); y <= Math.min(maxTile, maxY); y += 1) {
      tiles.push({ x, y, z: zoom });
    }
  }

  return tiles;
}
