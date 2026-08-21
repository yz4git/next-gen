import { describe, expect, it } from "vitest";
import { streamingRange, tileForPoint, tileIsVisible } from "../src/generation/tiling";

describe("runtime world tiling", () => {
  it("uses a center-aligned stable tile grid", () => {
    expect(tileForPoint(0, 0, 300)).toMatchObject({ id: "0:0", centerX: 0, centerZ: 0 });
    expect(tileForPoint(149.9, -149.9, 300).id).toBe("0:0");
    expect(tileForPoint(150, -150.1, 300).id).toBe("1:-1");
  });

  it("keeps orbit overview broad and streams more aggressively while walking", () => {
    const orbit = streamingRange("orbit", 1_000);
    const walk = streamingRange("walk", 1_000);
    expect(orbit.base).toBeGreaterThan(walk.base);
    expect(walk.detail).toBeLessThan(walk.base);
  });

  it("accounts for a tile's half diagonal at the visibility boundary", () => {
    const tile = tileForPoint(0, 0, 300);
    expect(tileIsVisible(tile, 500, 0, 300)).toBe(true);
    expect(tileIsVisible(tile, 600, 0, 300)).toBe(false);
  });
});
