import type { BuildingFeature, ResolvedBuilding } from "../types";

const HEIGHT_BY_KIND: Record<string, number> = {
  apartments: 18,
  commercial: 16,
  office: 20,
  retail: 10,
  industrial: 9,
  warehouse: 8,
  house: 7.2,
  residential: 10,
  school: 11,
  hospital: 17,
  transportation: 13,
};

export function resolveBuildingHeight(building: BuildingFeature): ResolvedBuilding {
  const providedHeight = finitePositive(building.height);
  const providedMinHeight = finiteNonNegative(building.minHeight) ?? 0;
  if (providedHeight !== null) {
    return {
      ...building,
      resolvedHeight: clamp(providedHeight, 2.4, 360),
      resolvedMinHeight: Math.min(providedMinHeight, providedHeight - 1),
      heightQuality: "provided",
    };
  }

  const levels = finitePositive(building.levels);
  if (levels !== null) {
    return {
      ...building,
      resolvedHeight: clamp(levels * 3.2, 3.2, 240),
      resolvedMinHeight: providedMinHeight,
      heightQuality: "levels",
    };
  }

  const base = HEIGHT_BY_KIND[building.kind ?? ""] ?? 9.5;
  const variation = 0.78 + seededUnit(building.id) * 0.52;
  return {
    ...building,
    resolvedHeight: clamp(base * variation, 4.5, 60),
    resolvedMinHeight: providedMinHeight,
    heightQuality: "inferred",
  };
}

function finitePositive(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNonNegative(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function seededUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_295;
}
