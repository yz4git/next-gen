import { describe, expect, it } from "vitest";
import { createWorldManifest } from "../src/semantic/manifest";
import type { ResolvedBuilding, WorldData } from "../src/types";

const world: WorldData = {
  center: [139.767125, 35.681236],
  radius: 500,
  buildings: [],
  roads: [{
    id: "osm:road:1",
    path: [[139.767, 35.681], [139.768, 35.682]],
    kind: "residential",
    width: 5.5,
    source: "openstreetmap",
  }],
  areas: [{
    id: "osm:park:1",
    polygons: [[[[139.767, 35.681], [139.7671, 35.681], [139.7671, 35.6811], [139.767, 35.681]]]],
    kind: "park",
    source: "openstreetmap",
  }],
  attributions: [],
  providerLabel: "test",
  generatedAt: "2026-08-20T00:00:00.000Z",
  warnings: [],
};

const building: ResolvedBuilding = {
  id: "osm:building:1",
  polygons: [[[[139.767, 35.681], [139.7671, 35.681], [139.7671, 35.6811], [139.767, 35.681]]]],
  name: "Test Hall",
  kind: "civic",
  roofShape: "gabled",
  source: "openstreetmap",
  resolvedHeight: 18,
  resolvedMinHeight: 0,
  heightQuality: "provided",
};

describe("semantic game-object manifest", () => {
  it("creates stable objects and layer counts without embedding the WGS84 origin", () => {
    const manifest = createWorldManifest(world, [building]);
    expect(manifest.layers).toEqual({ terrain: 1, areas: 1, roads: 1, buildings: 1, roofs: 1 });
    expect(manifest.objects.map((object) => object.id)).toEqual([
      "terrain:ground",
      "area:osm:park:1",
      "road:osm:road:1",
      "building:osm:building:1",
      "roof:osm:building:1",
    ]);
    expect(manifest.objects.find((object) => object.layer === "buildings")).toMatchObject({
      name: "Test Hall",
      kind: "civic",
      properties: { heightMeters: 18, heightQuality: "provided" },
    });
    expect(manifest.objects.filter((object) => object.layer !== "terrain").every((object) => object.tile)).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("139.767125");
    expect(JSON.stringify(manifest)).not.toContain("35.681236");
    expect(manifest.generator).toBe("WorldSeed 0.7.0 Drive Any City");
  });
});
