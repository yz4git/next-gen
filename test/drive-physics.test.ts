import { describe, expect, it } from "vitest";
import { stepDrivePhysics, type DrivePhysicsState } from "../src/interaction/drive-physics";

const initial = (): DrivePhysicsState => ({ x: 0, z: 0, heading: 0, speed: 0, steering: 0 });

describe("arcade drive physics", () => {
  it("accelerates, steers, brakes, and supports a bounded reverse", () => {
    let state = initial();
    for (let frame = 0; frame < 120; frame += 1) {
      state = stepDrivePhysics(state, { throttle: 1, steering: 0.65, brake: false }, 1 / 60);
    }
    expect(state.speed).toBeGreaterThan(20);
    expect(Math.abs(state.heading)).toBeGreaterThan(0.5);
    for (let frame = 0; frame < 90; frame += 1) {
      state = stepDrivePhysics(state, { throttle: 0, steering: 0, brake: true }, 1 / 60);
    }
    expect(state.speed).toBe(0);
    for (let frame = 0; frame < 180; frame += 1) {
      state = stepDrivePhysics(state, { throttle: -1, steering: 0, brake: false }, 1 / 60);
    }
    expect(state.speed).toBeGreaterThanOrEqual(-10);
    expect(state.speed).toBeLessThan(-7);
  });

  it("remains deterministic at the fixed simulation step", () => {
    const run = (): DrivePhysicsState => {
      let state = initial();
      for (let frame = 0; frame < 600; frame += 1) {
        state = stepDrivePhysics(state, { throttle: frame < 420 ? 0.8 : 0, steering: Math.sin(frame / 45) * 0.45, brake: false }, 1 / 60);
      }
      return state;
    };
    expect(run()).toEqual(run());
  });
});
