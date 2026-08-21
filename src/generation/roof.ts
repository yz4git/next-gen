import type { BuildingFeature } from "../types";

export type RoofProfile = "flat" | "gabled" | "hipped" | "skillion";

export interface ResolvedRoof {
  profile: RoofProfile;
  height: number;
  source: "provided" | "inferred";
}

export function resolveRoof(building: BuildingFeature, totalHeight: number): ResolvedRoof {
  const profile = normalizeRoofProfile(building.roofShape);
  if (profile === "flat") return { profile, height: 0, source: "inferred" };
  const maximum = Math.max(0.8, Math.min(12, totalHeight * 0.38));
  const supplied = building.roofHeight;
  if (supplied !== undefined && Number.isFinite(supplied) && supplied > 0) {
    return {
      profile,
      height: Math.min(maximum, Math.max(0.5, supplied)),
      source: "provided",
    };
  }
  const ratio = profile === "skillion" ? 0.1 : profile === "gabled" ? 0.16 : 0.19;
  return {
    profile,
    height: Math.min(maximum, Math.max(1.2, totalHeight * ratio)),
    source: "inferred",
  };
}

export function normalizeRoofProfile(value: string | undefined): RoofProfile {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  if (["gabled", "gable", "saltbox", "half-hipped"].includes(normalized ?? "")) return "gabled";
  if (["hipped", "hip", "pyramidal", "pyramid", "dome", "onion", "cone"].includes(normalized ?? "")) return "hipped";
  if (["skillion", "shed", "lean-to"].includes(normalized ?? "")) return "skillion";
  return "flat";
}
