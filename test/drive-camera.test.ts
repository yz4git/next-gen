import { describe, expect, it } from "vitest";
import { resolveDriveCameraPose, safeDriveCameraHeight } from "../src/interaction/drive-camera";

describe("drive camera terrain clearance", () => {
  it("keeps the uphill look-ahead target above the slope", () => {
    const ground = (_x: number, z: number): number => z * 0.7;
    const pose = resolveDriveCameraPose({ x: 0, z: 0, heading: 0, speed: 12 }, ground);

    expect(pose.target.z).toBeGreaterThan(0);
    expect(pose.target.y).toBeGreaterThanOrEqual(ground(pose.target.x, pose.target.z) + 1.35);
    expect(pose.desired.y).toBeGreaterThanOrEqual(ground(pose.desired.x, pose.desired.z) + 3.2);
  });

  it("clamps a smoothed chase camera above sudden terrain rises", () => {
    const ground = (x: number, z: number): number => x + z + 10;
    expect(safeDriveCameraHeight(2, 3, 5, ground, 2.2)).toBeCloseTo(17.2);
    expect(safeDriveCameraHeight(2, 3, 22, ground, 2.2)).toBe(22);
  });
});
