import { describe, expect, it } from "vitest";
import { createOverpassQuery, parseLengthMeters, parseOverpassResponse } from "../src/data/openstreetmap";

describe("OpenStreetMap adapter", () => {
  it("requests geometry needed by the playable world", () => {
    const query = createOverpassQuery([139.7, 35.6], 500);
    expect(query).toContain('["highway"]');
    expect(query).toContain('["building"]');
    expect(query).toContain('["natural"="water"]');
    expect(query).toContain("around:560,35.600000,139.700000");
  });

  it("normalizes metric and imperial measurements", () => {
    expect(parseLengthMeters("12.5 m")).toBe(12.5);
    expect(parseLengthMeters("30 ft")).toBeCloseTo(9.144);
    expect(parseLengthMeters(undefined)).toBeUndefined();
  });

  it("separates buildings, roads and land areas", () => {
    const response = parseOverpassResponse({ elements: [
      {
        type: "way", id: 1, tags: { building: "office", "building:levels": "6" },
        geometry: [{ lat: 35.6, lon: 139.7 }, { lat: 35.6, lon: 139.7001 }, { lat: 35.6001, lon: 139.7001 }],
      },
      {
        type: "way", id: 2, tags: { highway: "residential", lanes: "2" },
        geometry: [{ lat: 35.6, lon: 139.7 }, { lat: 35.601, lon: 139.7 }],
      },
      {
        type: "way", id: 3, tags: { leisure: "park" },
        geometry: [{ lat: 35.6, lon: 139.7 }, { lat: 35.6, lon: 139.7002 }, { lat: 35.6002, lon: 139.7002 }],
      },
    ] }, [139.7, 35.6], 500);
    expect(response.buildings).toHaveLength(1);
    expect(response.buildings[0]?.levels).toBe(6);
    expect(response.roads[0]?.width).toBe(6.3);
    expect(response.areas[0]?.kind).toBe("park");
  });
});

