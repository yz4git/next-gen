import { describe, expect, it } from "vitest";
import { droneCameraPose } from "../src/interaction/drone-camera";

describe("automatic drone camera", () => {
  it("keeps a safe aerial distance and changes its orbit over time", () => {
    const first = droneCameraPose(0, 500);
    const later = droneCameraPose(12, 500);
    expect(first.y).toBeGreaterThan(90);
    expect(Math.hypot(first.x, first.z)).toBeGreaterThan(450);
    expect(Math.hypot(later.x - first.x, later.z - first.z)).toBeGreaterThan(1);
    expect(first.targetY).toBeGreaterThan(0);
  });

  it("clamps tiny worlds to a readable tour distance", () => {
    const pose = droneCameraPose(0, 20);
    expect(Math.hypot(pose.x, pose.z)).toBeGreaterThanOrEqual(170);
    expect(pose.y).toBeGreaterThanOrEqual(90);
  });
});
