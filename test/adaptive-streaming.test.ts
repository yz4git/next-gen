import { describe, expect, it } from "vitest";
import {
  costAwareStreamingConcurrency,
  estimateStreamingParseCostMs,
  initialAdaptiveStreamingState,
  initialFrameTimeSchedulerState,
  initialStreamingParseCostState,
  optionalStreamingWorkAllowed,
  recordStreamingParseCost,
  streamingFetchBufferSlots,
  streamingGpuUploadAttachmentsPerFrame,
  streamingGpuUploadDelayFrames,
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


describe("parse-cost aware streaming scheduler", () => {
  it("estimates parse cost from tile bytes before samples exist", () => {
    const state = initialStreamingParseCostState();
    expect(estimateStreamingParseCostMs(state, "base", 1024 * 1024)).toBeCloseTo(14);
    expect(estimateStreamingParseCostMs(state, "detail", 2 * 1024 * 1024)).toBeCloseTo(32);
  });

  it("learns base and detail parse cost independently", () => {
    let state = initialStreamingParseCostState();
    state = recordStreamingParseCost(state, "base", 2 * 1024 * 1024, 50);
    expect(state.baseMsPerMb).toBeCloseTo(25);
    expect(state.baseSamples).toBe(1);
    expect(state.detailMsPerMb).toBe(16);

    state = recordStreamingParseCost(state, "detail", 1024 * 1024, 40);
    expect(state.detailMsPerMb).toBeCloseTo(40);
    expect(state.detailSamples).toBe(1);
  });

  it("serializes heavy parse work but allows two light jobs", () => {
    expect(costAwareStreamingConcurrency(2, 0, 8)).toBe(2);
    expect(costAwareStreamingConcurrency(2, 0, 24)).toBe(1);
    expect(costAwareStreamingConcurrency(2, 20, 7)).toBe(1);
    expect(costAwareStreamingConcurrency(2, 13, 12)).toBe(1);
    expect(costAwareStreamingConcurrency(1, 0, 4)).toBe(1);
  });
});


describe("visible fetch-ahead buffer", () => {
  it("keeps at most two fetched-or-fetching jobs ahead of parsing", () => {
    expect(streamingFetchBufferSlots(2, 0, 0)).toBe(2);
    expect(streamingFetchBufferSlots(2, 1, 0)).toBe(1);
    expect(streamingFetchBufferSlots(2, 0, 1)).toBe(1);
    expect(streamingFetchBufferSlots(2, 1, 1)).toBe(0);
    expect(streamingFetchBufferSlots(2, 0, 2)).toBe(0);
  });

  it("is independent of parse concurrency", () => {
    expect(streamingFetchBufferSlots(2, 0, 0)).toBe(2);
  });
});


describe("GPU upload pressure model", () => {
  it("keeps light tiles immediate", () => {
    expect(streamingGpuUploadDelayFrames({
      vertexCount: 80_000,
      geometryByteLength: 2 * 1024 * 1024,
      materialCount: 6,
    })).toBe(0);
    expect(streamingGpuUploadAttachmentsPerFrame(0)).toBe(2);
  });

  it("delays medium upload pressure by one frame", () => {
    expect(streamingGpuUploadDelayFrames({
      vertexCount: 190_000,
      geometryByteLength: 3 * 1024 * 1024,
      materialCount: 8,
    })).toBe(1);
    expect(streamingGpuUploadAttachmentsPerFrame(1)).toBe(1);
  });

  it("delays very heavy upload pressure by two frames", () => {
    expect(streamingGpuUploadDelayFrames({
      vertexCount: 100_000,
      geometryByteLength: 13 * 1024 * 1024,
      materialCount: 10,
    })).toBe(2);
    expect(streamingGpuUploadAttachmentsPerFrame(2)).toBe(1);
  });
});
