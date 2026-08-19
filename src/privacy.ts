import type { LonLat, WorldStyle } from "./types";

export const LIVE_REQUEST_COOLDOWN_MS = 2_500;

export function createSeedShareUrl(
  currentHref: string,
  center: LonLat,
  radius: number,
  style: WorldStyle,
): string {
  const url = new URL(currentHref);
  url.search = "";
  url.hash = "";
  url.searchParams.set("lat", center[1].toFixed(6));
  url.searchParams.set("lng", center[0].toFixed(6));
  url.searchParams.set("r", String(Math.round(radius)));
  url.searchParams.set("style", style);
  return url.toString();
}

export function createAppOnlyUrl(currentHref: string): string {
  const url = new URL(currentHref);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function hasPreciseSeedInUrl(currentHref: string): boolean {
  const params = new URL(currentHref).searchParams;
  return params.has("lat") || params.has("lng");
}

export function requestIsCoolingDown(
  lastRequestAt: number,
  now: number,
  cooldownMs = LIVE_REQUEST_COOLDOWN_MS,
): boolean {
  return Number.isFinite(lastRequestAt) && now - lastRequestAt < cooldownMs;
}
