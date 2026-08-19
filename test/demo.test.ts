import { describe, expect, it } from "vitest";
import { createDemoWorld } from "../src/data/demo";

describe("bundled demo", () => {
  it("provides a complete offline first-run experience", () => {
    const world = createDemoWorld([139.767125, 35.681236], 500);
    expect(world.isDemo).toBe(true);
    expect(world.buildings.length).toBeGreaterThan(100);
    expect(world.roads.length).toBeGreaterThan(20);
    expect(world.areas.map((area) => area.kind)).toEqual(["park", "water"]);
  });
});

