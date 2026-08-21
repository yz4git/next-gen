import { describe, expect, it } from "vitest";
import { resolveVehicleGroundPose, smoothVehicleTilt } from "../src/interaction/vehicle-pose";

describe("Drive vehicle terrain pose", () => {
  it("leans the chassis into uphill and cross-slope terrain", () => {
    const ground = (x: number, z: number): number => z * 0.2 + x * 0.1;
    const pose = resolveVehicleGroundPose({ x: 0, z: 0, heading: 0 }, ground, 4, 2);
    expect(pose.pitch).toBeCloseTo(Math.atan2(0.8, 4), 4);
    expect(pose.roll).toBeCloseTo(Math.atan2(0.2, 2), 4);
    expect(pose.frontY).toBeGreaterThan(pose.rearY);
    expect(pose.rightY).toBeGreaterThan(pose.leftY);
  });

  it("smooths tilt without overshooting", () => {
    const next = smoothVehicleTilt(0, 0.4, 1 / 60, 8);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(0.4);
  });
});
