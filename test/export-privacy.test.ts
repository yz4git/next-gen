import { describe, expect, it } from "vitest";
import { createExportUserData, createWorldMetadata } from "../src/export/world-kit";
import type { WorldData, WorldStats } from "../src/types";

const world: WorldData = {
  center: [139.767125, 35.681236],
  radius: 500,
  buildings: [],
  roads: [],
  areas: [],
  attributions: [],
  providerLabel: "Test provider",
  generatedAt: "2026-08-19T00:00:00.000Z",
  warnings: [],
};

const stats: WorldStats = {
  buildings: 0,
  roads: 0,
  areas: 0,
  providedHeights: 0,
  levelHeights: 0,
  inferredHeights: 0,
  triangles: 0,
  drawCalls: 0,
  truncatedBuildings: 0,
};

describe("privacy-safe exports", () => {
  it("omits the exact origin from metadata unless opted in", () => {
    expect(createWorldMetadata(world, stats, "low-poly", false)).toMatchObject({
      generator: "WorldSeed 0.1.1",
      origin: null,
      exactOriginIncluded: false,
    });
    expect(createWorldMetadata(world, stats, "low-poly", true)).toMatchObject({
      origin: { longitude: 139.767125, latitude: 35.681236 },
      exactOriginIncluded: true,
    });
  });

  it("removes the center from GLB user data without mutating the scene", () => {
    const sceneData = { center: world.center, radius: 500, provider: "Test" };
    const privateData = createExportUserData(sceneData, false);

    expect(privateData).toEqual({ radius: 500, provider: "Test", exactOriginIncluded: false });
    expect(sceneData.center).toEqual(world.center);
    expect(createExportUserData(sceneData, true)).toEqual({
      ...sceneData,
      exactOriginIncluded: true,
    });
  });
});
