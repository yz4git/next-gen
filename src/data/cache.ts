import { del, get, keys, set } from "idb-keyval";

interface CacheRecord<T> {
  expiresAt: number;
  value: T;
}

export const WORLDSEED_CACHE_PREFIX = "worldseed:v1:";
export const WORLDSEED_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export async function getCached<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const record = await get<CacheRecord<T>>(`${WORLDSEED_CACHE_PREFIX}${key}`);
    if (!record) return null;
    if (record.expiresAt < Date.now()) {
      await del(`${WORLDSEED_CACHE_PREFIX}${key}`);
      return null;
    }
    return record.value;
  } catch {
    return null;
  }
}

export async function setCached<T>(
  key: string,
  value: T,
  maximumAgeMs = WORLDSEED_CACHE_MAX_AGE_MS,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await set(`${WORLDSEED_CACHE_PREFIX}${key}`, {
      expiresAt: Date.now() + maximumAgeMs,
      value,
    } satisfies CacheRecord<T>);
  } catch {
    // Private browsing and strict storage policies can reject IndexedDB.
  }
}

export async function clearWorldSeedCache(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  try {
    const storedKeys = await keys();
    const worldSeedKeys = storedKeys.filter(
      (key): key is string => typeof key === "string" && key.startsWith(WORLDSEED_CACHE_PREFIX),
    );
    await Promise.all(worldSeedKeys.map((key) => del(key)));
    return worldSeedKeys.length;
  } catch {
    return 0;
  }
}

export function coordinateCacheKey(
  provider: string,
  longitude: number,
  latitude: number,
  radius: number,
): string {
  return `${provider}:${longitude.toFixed(5)}:${latitude.toFixed(5)}:${Math.round(radius)}`;
}
