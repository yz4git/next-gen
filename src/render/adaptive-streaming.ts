export type AdaptiveStreamingTier = "economy" | "balanced" | "quality";

export interface AdaptiveStreamingCapabilities {
  mobile: boolean;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
}

export interface AdaptiveStreamingBudget {
  tier: AdaptiveStreamingTier;
  baseScale: number;
  detailScale: number;
  prefetchScale: number;
  maxConcurrentLoads: number;
  maxConcurrentPrefetches: number;
  maxCacheRecords: number;
  maxCacheBytes: number;
  dprCap: number;
}

export interface AdaptiveStreamingState {
  budget: AdaptiveStreamingBudget;
  lowFpsSamples: number;
  highFpsSamples: number;
}

const BUDGETS: Record<AdaptiveStreamingTier, AdaptiveStreamingBudget> = {
  economy: {
    tier: "economy",
    baseScale: 0.72,
    detailScale: 0.55,
    prefetchScale: 0.62,
    maxConcurrentLoads: 1,
    maxConcurrentPrefetches: 0,
    maxCacheRecords: 20,
    maxCacheBytes: 32 * 1024 * 1024,
    dprCap: 1.35,
  },
  balanced: {
    tier: "balanced",
    baseScale: 0.9,
    detailScale: 0.78,
    prefetchScale: 0.82,
    maxConcurrentLoads: 2,
    maxConcurrentPrefetches: 1,
    maxCacheRecords: 40,
    maxCacheBytes: 64 * 1024 * 1024,
    dprCap: 1.65,
  },
  quality: {
    tier: "quality",
    baseScale: 1.08,
    detailScale: 1,
    prefetchScale: 1,
    maxConcurrentLoads: 2,
    maxConcurrentPrefetches: 1,
    maxCacheRecords: 72,
    maxCacheBytes: 128 * 1024 * 1024,
    dprCap: 1.8,
  },
};

export function initialAdaptiveStreamingState(
  capabilities: AdaptiveStreamingCapabilities,
): AdaptiveStreamingState {
  const memory = capabilities.deviceMemoryGb;
  const cores = capabilities.hardwareConcurrency ?? 4;
  const constrainedMemory = memory !== undefined && memory <= 4;
  const constrainedCpu = cores <= 4;
  const tier: AdaptiveStreamingTier = capabilities.mobile || constrainedMemory || constrainedCpu
    ? "balanced"
    : "quality";
  return {
    budget: BUDGETS[tier],
    lowFpsSamples: 0,
    highFpsSamples: 0,
  };
}

export function updateAdaptiveStreamingState(
  state: AdaptiveStreamingState,
  fps: number,
): AdaptiveStreamingState {
  if (!Number.isFinite(fps) || fps <= 0) return state;

  const severe = fps < 36;
  const low = fps < 48;
  const high = fps >= 57;

  const lowFpsSamples = low ? state.lowFpsSamples + 1 : Math.max(0, state.lowFpsSamples - 1);
  const highFpsSamples = high ? state.highFpsSamples + 1 : 0;

  if (severe || lowFpsSamples >= 2) {
    const nextTier = lowerTier(state.budget.tier);
    return {
      budget: BUDGETS[nextTier],
      lowFpsSamples: 0,
      highFpsSamples: 0,
    };
  }

  if (highFpsSamples >= 6) {
    const nextTier = higherTier(state.budget.tier);
    return {
      budget: BUDGETS[nextTier],
      lowFpsSamples: 0,
      highFpsSamples: 0,
    };
  }

  return {
    budget: state.budget,
    lowFpsSamples,
    highFpsSamples,
  };
}

export function detectStreamingCapabilities(): AdaptiveStreamingCapabilities {
  if (typeof navigator === "undefined") {
    return { mobile: false, hardwareConcurrency: 4 };
  }
  const userAgent = navigator.userAgent ?? "";
  const mobile = /iPhone|iPad|iPod|Android/i.test(userAgent)
    || (navigator.maxTouchPoints ?? 0) > 1 && /Macintosh/i.test(userAgent);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    mobile,
    hardwareConcurrency: navigator.hardwareConcurrency || undefined,
    deviceMemoryGb: typeof memory === "number" && Number.isFinite(memory) ? memory : undefined,
  };
}

function lowerTier(tier: AdaptiveStreamingTier): AdaptiveStreamingTier {
  if (tier === "quality") return "balanced";
  return "economy";
}

function higherTier(tier: AdaptiveStreamingTier): AdaptiveStreamingTier {
  if (tier === "economy") return "balanced";
  return "quality";
}


export interface FrameTimeSchedulerState {
  deferOptionalFrames: number;
  lastFrameTimeMs: number;
}

export function initialFrameTimeSchedulerState(): FrameTimeSchedulerState {
  return {
    deferOptionalFrames: 0,
    lastFrameTimeMs: 0,
  };
}

export function updateFrameTimeSchedulerState(
  state: FrameTimeSchedulerState,
  frameTimeMs: number,
): FrameTimeSchedulerState {
  if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0) return state;

  let deferOptionalFrames = state.deferOptionalFrames;
  if (frameTimeMs >= 45) {
    deferOptionalFrames = Math.max(deferOptionalFrames, 24);
  } else if (frameTimeMs >= 28) {
    deferOptionalFrames = Math.max(deferOptionalFrames, 10);
  } else if (frameTimeMs <= 20) {
    deferOptionalFrames = Math.max(0, deferOptionalFrames - 2);
  } else {
    deferOptionalFrames = Math.max(0, deferOptionalFrames - 1);
  }

  return {
    deferOptionalFrames,
    lastFrameTimeMs: frameTimeMs,
  };
}

export function optionalStreamingWorkAllowed(state: FrameTimeSchedulerState): boolean {
  return state.deferOptionalFrames <= 0;
}


export type StreamingParseKind = "base" | "detail";

export interface StreamingParseCostState {
  baseMsPerMb: number;
  detailMsPerMb: number;
  baseSamples: number;
  detailSamples: number;
}

export function initialStreamingParseCostState(): StreamingParseCostState {
  return {
    baseMsPerMb: 14,
    detailMsPerMb: 16,
    baseSamples: 0,
    detailSamples: 0,
  };
}

export function estimateStreamingParseCostMs(
  state: StreamingParseCostState,
  kind: StreamingParseKind,
  byteLength: number,
): number {
  const bytes = Number.isFinite(byteLength) && byteLength > 0 ? byteLength : 1_500_000;
  const megabytes = Math.max(0.15, bytes / (1024 * 1024));
  const rate = kind === "detail" ? state.detailMsPerMb : state.baseMsPerMb;
  return Math.max(1, megabytes * rate);
}

export function recordStreamingParseCost(
  state: StreamingParseCostState,
  kind: StreamingParseKind,
  byteLength: number,
  elapsedMs: number,
): StreamingParseCostState {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return state;
  const bytes = Number.isFinite(byteLength) && byteLength > 0 ? byteLength : 1_500_000;
  const megabytes = Math.max(0.15, bytes / (1024 * 1024));
  const sampleRate = Math.min(180, Math.max(2, elapsedMs / megabytes));
  const alpha = 0.35;

  if (kind === "detail") {
    return {
      ...state,
      detailMsPerMb: state.detailSamples === 0
        ? sampleRate
        : state.detailMsPerMb * (1 - alpha) + sampleRate * alpha,
      detailSamples: state.detailSamples + 1,
    };
  }

  return {
    ...state,
    baseMsPerMb: state.baseSamples === 0
      ? sampleRate
      : state.baseMsPerMb * (1 - alpha) + sampleRate * alpha,
    baseSamples: state.baseSamples + 1,
  };
}

export function costAwareStreamingConcurrency(
  maximumConcurrency: number,
  activeEstimatedParseMs: number,
  nextEstimatedParseMs: number,
): number {
  const maximum = Math.max(1, Math.floor(maximumConcurrency));
  if (maximum <= 1) return 1;
  const activeCost = Number.isFinite(activeEstimatedParseMs) ? Math.max(0, activeEstimatedParseMs) : 0;
  const nextCost = Number.isFinite(nextEstimatedParseMs) ? Math.max(0, nextEstimatedParseMs) : 0;
  return activeCost >= 18 || nextCost >= 18 || activeCost + nextCost >= 24 ? 1 : maximum;
}


export function streamingFetchBufferSlots(
  maximumBufferedJobs: number,
  activeFetches: number,
  readyJobs: number,
): number {
  const maximum = Math.max(0, Math.floor(maximumBufferedJobs));
  const active = Number.isFinite(activeFetches) ? Math.max(0, Math.floor(activeFetches)) : 0;
  const ready = Number.isFinite(readyJobs) ? Math.max(0, Math.floor(readyJobs)) : 0;
  return Math.max(0, maximum - active - ready);
}


export interface StreamingGpuUploadHints {
  vertexCount?: number;
  geometryByteLength?: number;
  materialCount?: number;
}

export function streamingGpuUploadDelayFrames(
  hints: StreamingGpuUploadHints,
  thresholdScale = 1,
): number {
  const vertices = Number.isFinite(hints.vertexCount) ? Math.max(0, hints.vertexCount ?? 0) : 0;
  const bytes = Number.isFinite(hints.geometryByteLength)
    ? Math.max(0, hints.geometryByteLength ?? 0)
    : 0;
  const materials = Number.isFinite(hints.materialCount) ? Math.max(0, hints.materialCount ?? 0) : 0;

  const scale = Number.isFinite(thresholdScale)
    ? Math.min(1.5, Math.max(0.5, thresholdScale))
    : 1;
  if (
    vertices >= 350_000 * scale
    || bytes >= 12 * 1024 * 1024 * scale
    || materials >= 32 * scale
  ) return 2;
  if (
    vertices >= 180_000 * scale
    || bytes >= 6 * 1024 * 1024 * scale
    || materials >= 16 * scale
  ) return 1;
  return 0;
}

export function streamingGpuUploadAttachmentsPerFrame(
  delayFrames: number,
): number {
  return delayFrames > 0 ? 1 : 2;
}


export interface StreamingUploadCandidate {
  kind: StreamingParseKind;
  priority: number;
  delayFrames: number;
}

export function compareStreamingUploadCandidates(
  first: StreamingUploadCandidate,
  second: StreamingUploadCandidate,
): number {
  const firstKind = first.kind === "base" ? 0 : 1;
  const secondKind = second.kind === "base" ? 0 : 1;
  return firstKind - secondKind
    || first.priority - second.priority
    || second.delayFrames - first.delayFrames;
}


export interface StreamingFrameBaselineState {
  baselineMs: number;
  samples: number;
}

export function initialStreamingFrameBaselineState(): StreamingFrameBaselineState {
  return {
    baselineMs: 16.7,
    samples: 0,
  };
}

export function updateStreamingFrameBaselineState(
  state: StreamingFrameBaselineState,
  frameTimeMs: number,
): StreamingFrameBaselineState {
  if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0 || frameTimeMs > 28) return state;

  const sample = Math.min(28, Math.max(8, frameTimeMs));
  const alpha = state.samples < 10 ? 0.2 : 0.06;
  return {
    baselineMs: state.samples === 0
      ? sample
      : state.baselineMs * (1 - alpha) + sample * alpha,
    samples: state.samples + 1,
  };
}

export function streamingGpuUploadExcessMs(
  baseline: StreamingFrameBaselineState,
  postUploadFrameTimeMs: number,
): number {
  if (!Number.isFinite(postUploadFrameTimeMs) || postUploadFrameTimeMs <= 0) return 0;
  return Math.max(0, postUploadFrameTimeMs - baseline.baselineMs);
}


export interface StreamingGpuCostModelState {
  msPerEquivalentMb: number;
  samples: number;
  confidence: number;
  outlierStreak: number;
  outlierDirection: -1 | 0 | 1;
}

export function initialStreamingGpuCostModelState(): StreamingGpuCostModelState {
  return {
    msPerEquivalentMb: 1.6,
    samples: 0,
    confidence: 0,
    outlierStreak: 0,
    outlierDirection: 0,
  };
}

export function streamingGpuEquivalentMb(hints: StreamingGpuUploadHints): number {
  const geometryMb = Number.isFinite(hints.geometryByteLength)
    ? Math.max(0, hints.geometryByteLength ?? 0) / (1024 * 1024)
    : 0;
  const vertexEquivalentMb = Number.isFinite(hints.vertexCount)
    ? Math.max(0, hints.vertexCount ?? 0) / 250_000
    : 0;
  const materialEquivalentMb = Number.isFinite(hints.materialCount)
    ? Math.max(0, hints.materialCount ?? 0) / 32
    : 0;
  return Math.max(0.25, geometryMb + vertexEquivalentMb + materialEquivalentMb);
}

export function estimateStreamingGpuUploadExcessMs(
  state: StreamingGpuCostModelState,
  hints: StreamingGpuUploadHints,
): number {
  const learnedWeight = Math.min(1, Math.max(0, state.confidence));
  const effectiveRate = 1.6 * (1 - learnedWeight) + state.msPerEquivalentMb * learnedWeight;
  return streamingGpuEquivalentMb(hints) * effectiveRate;
}

export function recordStreamingGpuUploadCost(
  state: StreamingGpuCostModelState,
  hints: StreamingGpuUploadHints,
  uploadExcessMs: number,
): StreamingGpuCostModelState {
  if (!Number.isFinite(uploadExcessMs) || uploadExcessMs < 0) return state;
  const equivalentMb = streamingGpuEquivalentMb(hints);
  const sampleRate = Math.min(40, Math.max(0.25, uploadExcessMs / equivalentMb));

  if (state.samples >= 2) {
    const ratio = sampleRate / Math.max(0.25, state.msPerEquivalentMb);
    const direction: -1 | 0 | 1 = ratio > 3 ? 1 : ratio < 1 / 3 ? -1 : 0;
    if (direction !== 0) {
      const repeatedSameDirection = state.outlierStreak >= 1
        && state.outlierDirection === direction;
      if (!repeatedSameDirection) {
        return {
          ...state,
          confidence: Math.max(0.15, state.confidence * 0.9),
          outlierStreak: 1,
          outlierDirection: direction,
        };
      }
    }
  }

  const lower = state.samples >= 2 ? state.msPerEquivalentMb * 0.5 : 0.25;
  const upper = state.samples >= 2 ? state.msPerEquivalentMb * 2 : 40;
  const robustSample = Math.min(upper, Math.max(lower, sampleRate));
  const alpha = state.outlierStreak > 0 ? 0.18 : 0.3;
  const samples = state.samples + 1;
  return {
    msPerEquivalentMb: state.samples === 0
      ? robustSample
      : state.msPerEquivalentMb * (1 - alpha) + robustSample * alpha,
    samples,
    confidence: Math.min(1, samples / 6),
    outlierStreak: 0,
    outlierDirection: 0,
  };
}

export function streamingGpuPredictedDelayFrames(predictedExcessMs: number): number {
  if (!Number.isFinite(predictedExcessMs) || predictedExcessMs <= 0) return 0;
  if (predictedExcessMs >= 24) return 2;
  if (predictedExcessMs >= 10) return 1;
  return 0;
}

export function combineStreamingGpuUploadHints(
  first: StreamingGpuUploadHints,
  second: StreamingGpuUploadHints,
): StreamingGpuUploadHints {
  return {
    vertexCount: Math.max(0, first.vertexCount ?? 0) + Math.max(0, second.vertexCount ?? 0),
    geometryByteLength:
      Math.max(0, first.geometryByteLength ?? 0) + Math.max(0, second.geometryByteLength ?? 0),
    materialCount: Math.max(0, first.materialCount ?? 0) + Math.max(0, second.materialCount ?? 0),
  };
}


export interface StreamingGpuUploadLearningState {
  thresholdScale: number;
  goodSamples: number;
  badSamples: number;
  samples: number;
}

export function initialStreamingGpuUploadLearningState(): StreamingGpuUploadLearningState {
  return {
    thresholdScale: 1,
    goodSamples: 0,
    badSamples: 0,
    samples: 0,
  };
}

export function updateStreamingGpuUploadLearningState(
  state: StreamingGpuUploadLearningState,
  uploadExcessMs: number,
): StreamingGpuUploadLearningState {
  if (!Number.isFinite(uploadExcessMs) || uploadExcessMs < 0) return state;

  let thresholdScale = state.thresholdScale;
  let goodSamples = uploadExcessMs <= 4 ? state.goodSamples + 1 : 0;
  let badSamples = uploadExcessMs >= 10 ? state.badSamples + 1 : 0;

  if (uploadExcessMs >= 24) {
    thresholdScale = Math.max(0.55, thresholdScale * 0.82);
    goodSamples = 0;
    badSamples = 0;
  } else if (badSamples >= 2) {
    thresholdScale = Math.max(0.55, thresholdScale * 0.9);
    goodSamples = 0;
    badSamples = 0;
  } else if (goodSamples >= 5) {
    thresholdScale = Math.min(1.35, thresholdScale * 1.06);
    goodSamples = 0;
    badSamples = 0;
  }

  return {
    thresholdScale,
    goodSamples,
    badSamples,
    samples: state.samples + 1,
  };
}
