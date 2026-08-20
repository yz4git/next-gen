import { describe, expect, it } from "vitest";
import {
  createAppOnlyUrl,
  createSeedShareUrl,
  hasPreciseSeedInUrl,
  requestIsCoolingDown,
} from "../src/privacy";

describe("privacy-safe URLs", () => {
  it("creates exact seed links only when explicitly requested", () => {
    const shared = new URL(createSeedShareUrl(
      "https://worldseed.example/app?old=value#private-fragment",
      [139.7671254, 35.6812364],
      549.6,
      "anime",
    ));

    expect(shared.origin + shared.pathname).toBe("https://worldseed.example/app");
    expect(Object.fromEntries(shared.searchParams)).toEqual({
      lat: "35.681236",
      lng: "139.767125",
      r: "550",
      style: "anime",
    });
    expect(shared.hash).toBe("");
  });

  it("strips all seed data from an app-only link", () => {
    expect(createAppOnlyUrl("https://worldseed.example/app?lat=35&lng=139#view"))
      .toBe("https://worldseed.example/app");
    expect(hasPreciseSeedInUrl("https://worldseed.example/?lat=35")).toBe(true);
    expect(hasPreciseSeedInUrl("https://worldseed.example/?style=anime")).toBe(false);
  });

  it("adds drive mode and a deterministic route only to an explicit exact-seed link", () => {
    const shared = new URL(createSeedShareUrl(
      "https://worldseed.example/app",
      [139.7, 35.6],
      500,
      "cyber",
      { mode: "drive", routeSeed: 8472 },
    ));
    expect(shared.searchParams.get("mode")).toBe("drive");
    expect(shared.searchParams.get("route")).toBe("8472");
    expect(createAppOnlyUrl(shared.toString())).toBe("https://worldseed.example/app");
  });
});

describe("live request cooldown", () => {
  it("allows the first request and rate-limits immediate repeats", () => {
    expect(requestIsCoolingDown(Number.NEGATIVE_INFINITY, 1_000)).toBe(false);
    expect(requestIsCoolingDown(1_000, 3_499)).toBe(true);
    expect(requestIsCoolingDown(1_000, 3_500)).toBe(false);
  });
});
