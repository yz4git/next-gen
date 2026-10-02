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
