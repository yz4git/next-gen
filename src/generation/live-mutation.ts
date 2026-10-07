import { resolveBuildingHeight, seededUnit } from "./height";
import type { BuildingFeature, WorldData, WorldManifest } from "../types";

export interface LiveBuildingMutationPlan {
  world: WorldData;
  changedIds: string[];
  tileIds: string[];
}

/** Deterministic camera-local mutation; authored data remains immutable. */
export function planLiveBuildingGrowth(
  world: WorldData,
  manifest: WorldManifest,
  focus: { x: number; z: number },
  serial: number,
  maxBuildings = 7,
): LiveBuildingMutationPlan {
  if (world.plateau) throw new Error("PLATEAU geometry is read-only in Live Evolution.");
  if (!Number.isFinite(focus.x) || !Number.isFinite(focus.z)) throw new Error("Invalid evolution focus");
  if (!Number.isSafeInteger(serial) || serial < 1) throw new Error("Invalid evolution revision");
  const features = new Map(world.buildings.map((feature) => [feature.id, feature]));
  const sorted = manifest.objects
    .filter((item) => item.layer === "buildings" && features.has(item.sourceId))
    .map((item) => ({
      id: item.sourceId,
      tile: item.tile,
      distance: Math.hypot(item.center[0] - focus.x, item.center[2] - focus.z),
    }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  if (sorted.length === 0) throw new Error("No mutable building is available in this world.");

  const near = sorted.filter((item) => item.distance <= 220);
  const pool = near.length ? near : sorted.slice(0, 24);
  const count = Math.min(Math.max(1, Math.floor(maxBuildings)), pool.length);
  const offset = ((serial - 1) * count) % pool.length;
  const selected = Array.from({ length: count }, (_, i) => pool[(offset + i) % pool.length]!);
  const ids = new Set(selected.map((entry) => entry.id));
  const buildings = world.buildings.map((feature): BuildingFeature => {
    if (!ids.has(feature.id)) return feature;
    const currentHeight = resolveBuildingHeight(feature).resolvedHeight;
    const scale = 1.35 + seededUnit(feature.id + ":evolve:" + serial) * 0.75;
    const newHeight = Math.min(300, Math.max(3, currentHeight * scale));
    return {
      ...feature,
      height: Math.round(newHeight * 10) / 10,
      heightSource: "WorldSeed live evolution",
    };
  });
  return {
    world: { ...world, buildings },
    changedIds: [...ids].sort(),
    tileIds: [...new Set(selected.map((entry) => entry.tile).filter(
      (tile): tile is string => typeof tile === "string",
    ))].sort(),
  };
}
