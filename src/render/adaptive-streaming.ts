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
  return activeCost >= 18 || nextCost >= 18 ? 1 : maximum;
}
