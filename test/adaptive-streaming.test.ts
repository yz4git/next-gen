import { describe, expect, it } from "vitest";
import {
  initialAdaptiveStreamingState,
  initialFrameTimeSchedulerState,
  optionalStreamingWorkAllowed,
  updateAdaptiveStreamingState,
  updateFrameTimeSchedulerState,
} from "../src/render/adaptive-streaming";

describe("adaptive streaming budget", () => {
  it("starts mobile and constrained devices conservatively", () => {
    expect(initialAdaptiveStreamingState({ mobile: true, hardwareConcurrency: 6 }).budget.tier).toBe("balanced");
    expect(initialAdaptiveStreamingState({ mobile: false, hardwareConcurrency: 4 }).budget.tier).toBe("balanced");
    expect(initialAdaptiveStreamingState({ mobile: false, hardwareConcurrency: 8, deviceMemoryGb: 8 }).budget.tier).toBe("quality");
  });

  it("drops a tier after sustained low FPS and immediately on severe FPS", () => {
    let state = initialAdaptiveStreamingState({ mobile: false, hardwareConcurrency: 8, deviceMemoryGb: 8 });
    state = updateAdaptiveStreamingState(state, 45);
    expect(state.budget.tier).toBe("quality");
    state = updateAdaptiveStreamingState(state, 44);
    expect(state.budget.tier).toBe("balanced");

    state = updateAdaptiveStreamingState(state, 30);
    expect(state.budget.tier).toBe("economy");
  });

  it("recovers one tier only after sustained high FPS", () => {
    let state = initialAdaptiveStreamingState({ mobile: true, hardwareConcurrency: 6 });
    state = updateAdaptiveStreamingState(state, 30);
    expect(state.budget.tier).toBe("economy");

    for (let i = 0; i < 5; i += 1) state = updateAdaptiveStreamingState(state, 60);
    expect(state.budget.tier).toBe("economy");
    state = updateAdaptiveStreamingState(state, 60);
    expect(state.budget.tier).toBe("balanced");
  });

  it("uses lower detail, DPR, and concurrency under economy pressure", () => {
    let state = initialAdaptiveStreamingState({ mobile: true, hardwareConcurrency: 6 });
    state = updateAdaptiveStreamingState(state, 30);
    expect(state.budget).toMatchObject({
      tier: "economy",
      maxConcurrentLoads: 1,
      maxConcurrentPrefetches: 0,
      maxCacheRecords: 20,
      maxCacheBytes: 32 * 1024 * 1024,
      dprCap: 1.35,
    });
    expect(state.budget.detailScale).toBeLessThan(state.budget.baseScale);
  });
});


describe("frame-time streaming scheduler", () => {
  it("defers optional work after a medium frame spike and recovers gradually", () => {
    let state = initialFrameTimeSchedulerState();
    state = updateFrameTimeSchedulerState(state, 30);
    expect(state.deferOptionalFrames).toBe(10);
    expect(optionalStreamingWorkAllowed(state)).toBe(false);

    for (let i = 0; i < 4; i += 1) state = updateFrameTimeSchedulerState(state, 16);
    expect(state.deferOptionalFrames).toBe(2);
    expect(optionalStreamingWorkAllowed(state)).toBe(false);

    state = updateFrameTimeSchedulerState(state, 16);
    expect(state.deferOptionalFrames).toBe(0);
    expect(optionalStreamingWorkAllowed(state)).toBe(true);
  });

  it("uses a longer cooldown for a severe frame spike", () => {
    const state = updateFrameTimeSchedulerState(initialFrameTimeSchedulerState(), 50);
    expect(state.deferOptionalFrames).toBe(24);
    expect(state.lastFrameTimeMs).toBe(50);
  });
});
