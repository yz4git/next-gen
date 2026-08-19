export const EARTH_RADIUS_METERS = 6_378_137;
export const DEFAULT_CENTER = [139.767125, 35.681236] as const;
export const DEFAULT_RADIUS = 500;
export const MIN_RADIUS = 100;
export const MAX_RADIUS = 1_000;
export const MAX_BUILDINGS = 2_500;
export const BUILDING_BATCH_SIZE = 350;
export const OVERTURE_TILE_ZOOM = 14;
export const OVERTURE_RELEASE =
  import.meta.env.VITE_OVERTURE_RELEASE ?? "2026-07-22.0";
export const OVERTURE_BUILDINGS_URL =
  import.meta.env.VITE_OVERTURE_BUILDINGS_URL ??
  `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/${OVERTURE_RELEASE}/buildings.pmtiles`;

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;
