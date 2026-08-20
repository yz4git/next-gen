import { describe, expect, it } from "vitest";
import { normalizeRoofProfile, resolveRoof } from "../src/generation/roof";
import type { BuildingFeature } from "../src/types";

const building = (roofShape?: string, roofHeight?: number): BuildingFeature => ({
  id: "roof-test",
  polygons: [],
  roofShape,
  roofHeight,
  source: "openstreetmap",
});

describe("roof resolution", () => {
  it("normalizes common OSM roof shapes into supported meshes", () => {
    expect(normalizeRoofProfile("gabled")).toBe("gabled");
    expect(normalizeRoofProfile("half_hipped")).toBe("gabled");
    expect(normalizeRoofProfile("pyramidal")).toBe("hipped");
    expect(normalizeRoofProfile("shed")).toBe("skillion");
    expect(normalizeRoofProfile(undefined)).toBe("flat");
  });

  it("uses supplied roof height while keeping a usable wall body", () => {
    expect(resolveRoof(building("gabled", 4.5), 20)).toEqual({
      profile: "gabled",
      height: 4.5,
      source: "provided",
    });
    expect(resolveRoof(building("hipped", 99), 10).height).toBeLessThan(4);
  });

  it("infers deterministic pitched height and keeps flat roofs flat", () => {
    expect(resolveRoof(building("gabled"), 20).height).toBeCloseTo(3.2);
    expect(resolveRoof(building("flat", 5), 20).height).toBe(0);
  });
});
