import { describe, expect, it } from "vitest";
import { DRONE_TOUR_SPEED, droneCameraPose } from "../src/interaction/drone-camera";

describe("automatic drone camera", () => {
  it("keeps a safe aerial distance and changes its orbit over time", () => {
    const first = droneCameraPose(0, 500);
    const later = droneCameraPose(12, 500);
    expect(first.y).toBeGreaterThan(90);
    expect(Math.hypot(first.x, first.z)).toBeGreaterThan(170);
    expect(Math.hypot(later.x - first.x, later.z - first.z)).toBeGreaterThan(1);
    expect(Math.abs(later.targetX - first.targetX) + Math.abs(later.targetZ - first.targetZ)).toBeGreaterThan(1);
    expect(later.fov).not.toBe(first.fov);
    expect(first.targetY).toBeGreaterThan(0);
  });

  it("runs the cinematic tour substantially faster", () => {
    expect(DRONE_TOUR_SPEED).toBeGreaterThanOrEqual(1.7);
    const start = droneCameraPose(0, 500);
    const afterOneSecond = droneCameraPose(1, 500);
    expect(Math.hypot(afterOneSecond.x - start.x, afterOneSecond.z - start.z)).toBeGreaterThan(45);
  });

  it("clamps tiny worlds to a readable tour distance", () => {
    const pose = droneCameraPose(0, 20);
    expect(Math.hypot(pose.x, pose.z)).toBeGreaterThanOrEqual(170);
    expect(pose.y).toBeGreaterThanOrEqual(90);
  });
});
