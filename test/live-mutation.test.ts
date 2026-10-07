import { describe, expect, it } from "vitest";
import { createDemoWorld } from "../src/data/demo";
import { resolveBuildingHeight } from "../src/generation/height";
import { planLiveBuildingGrowth } from "../src/generation/live-mutation";
import type { WorldManifest } from "../src/types";

const manifest: WorldManifest = {
  schemaVersion: "1.0", generator: "test", coordinateSystem: "local",
  radiusMeters: 500,
  layers: { terrain: 0, areas: 0, roads: 0, buildings: 2, roofs: 0 },
  objects: [
    { id: "building:b", sourceId: "b", source: "demo", layer: "buildings",
      center: [10, 0, 10], bounds: { minimum: [8, 0, 8], maximum: [12, 10, 12] },
      properties: {}, tile: "0:0" },
    { id: "building:a", sourceId: "a", source: "demo", layer: "buildings",
      center: [3, 0, 3], bounds: { minimum: [1, 0, 1], maximum: [5, 10, 5] },
      properties: {}, tile: "0:0" },
  ],
};
function fixture() {
  const original = createDemoWorld([139.767125, 35.681236], 400);
  return {
    ...original,
    buildings: [
      { ...original.buildings[0]!, id: "a", height: 10 },
      { ...original.buildings[1]!, id: "b", height: 20 },
      { ...original.buildings[2]!, id: "c", height: 30 },
    ],
  };
}
describe("Live Evolution planner", () => {
  it("changes only nearby semantic buildings without mutating source", () => {
    const before = fixture();
    const heights = before.buildings.map((b) => b.height);
    const patch = planLiveBuildingGrowth(before, manifest, { x: 0, z: 0 }, 1, 1);
    expect(patch.changedIds).toEqual(["a"]);
    expect(patch.tileIds).toEqual(["0:0"]);
    expect(resolveBuildingHeight(patch.world.buildings[0]!).resolvedHeight).toBeGreaterThan(10);
    expect(patch.world.buildings[1]).toBe(before.buildings[1]);
    expect(patch.world.buildings[2]).toBe(before.buildings[2]);
    expect(before.buildings.map((b) => b.height)).toEqual(heights);
  });
  it("is deterministic and cycles through nearby buildings", () => {
    const world = fixture();
    const first = planLiveBuildingGrowth(world, manifest, { x: 0, z: 0 }, 1, 1);
    const repeat = planLiveBuildingGrowth(world, manifest, { x: 0, z: 0 }, 1, 1);
    const second = planLiveBuildingGrowth(world, manifest, { x: 0, z: 0 }, 2, 1);
    expect(first.world.buildings.map((b) => b.height)).toEqual(repeat.world.buildings.map((b) => b.height));
    expect(first.changedIds).not.toEqual(second.changedIds);
  });
  it("rejects PLATEAU and missing candidates", () => {
    const world = fixture();
    expect(() => planLiveBuildingGrowth(
      { ...world, plateau: { buildings: [], baseElevation: 0 } } as unknown as typeof world,
      manifest, { x: 0, z: 0 }, 1,
    )).toThrow(/read-only/);
    expect(() => planLiveBuildingGrowth(world, { ...manifest, objects: [] }, { x: 0, z: 0 }, 1)).toThrow(/No mutable/);
  });
});
