import { del, get, set } from "idb-keyval";

interface CacheRecord<T> {
  expiresAt: number;
  value: T;
}

const PREFIX = "worldseed:v1:";

export async function getCached<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const record = await get<CacheRecord<T>>(`${PREFIX}${key}`);
    if (!record) return null;
    if (record.expiresAt < Date.now()) {
      await del(`${PREFIX}${key}`);
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
  maximumAgeMs = 7 * 24 * 60 * 60 * 1_000,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await set(`${PREFIX}${key}`, {
      expiresAt: Date.now() + maximumAgeMs,
      value,
    } satisfies CacheRecord<T>);
  } catch {
    // Private browsing and strict storage policies can reject IndexedDB.
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
