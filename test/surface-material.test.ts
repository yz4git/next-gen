import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { materialForStyle, WORLD_PALETTES } from "../src/generation/styles";

describe("surface material culling", () => {
  it("keeps terrain and primary roads visible from steep chase-camera angles", () => {
    const palette = WORLD_PALETTES["low-poly"];
    const ground = materialForStyle("low-poly", palette.ground);
    const road = materialForStyle("low-poly", palette.road);
    const building = materialForStyle("low-poly", palette.buildings[0]!);

    expect(ground.side).toBe(THREE.DoubleSide);
    expect(road.side).toBe(THREE.DoubleSide);
    expect(building.side).toBe(THREE.FrontSide);

    ground.dispose();
    road.dispose();
    building.dispose();
  });
});
