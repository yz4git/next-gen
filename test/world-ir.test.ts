import { describe, expect, it } from "vitest";
import {
  createWorldSeedIr,
  encodeWorldSeedIrFiles,
  migrateWorldSeedIr,
  parseWorldSeedIr,
  serializeCanonicalJson,
  serializeWorldSeedIr,
} from "../src/ir/world-ir";
import type { RoadGraph, WorldManifest } from "../src/types";

const manifest: WorldManifest = {
  schemaVersion: "1.0",
  generator: "WorldSeed 0.9.1",
  coordinateSystem: "local meters; X east, Y up, Z south",
  radiusMeters: 500,
  layers: { terrain: 1, areas: 0, roads: 0, buildings: 0, roofs: 0 },
  objects: [],
};

const roadGraph: RoadGraph = {
  schemaVersion: "1.0",
  generator: "WorldSeed 0.9.1",
  coordinateSystem: "local meters; X east, Y up, Z south",
  nodes: [],
  edges: [],
};

describe("WorldSeed IR", () => {
  it("round-trips the shared intermediate representation", () => {
    const document = createWorldSeedIr({
      metadata: { schemaVersion: "1.0", generator: "WorldSeed 0.9.1" },
      manifest,
      roadGraph,
      spawnPoints: { schemaVersion: "1.0", vehicles: [], pedestrians: [] },
      driveRoute: null,
    });

    const parsed = parseWorldSeedIr(serializeWorldSeedIr(document));
    expect(parsed).toEqual(document);

    const files = encodeWorldSeedIrFiles(document);
    expect(JSON.parse(files["worldseed.json"] ?? "{}")).toEqual(document.metadata);
    expect(JSON.parse(files["worldseed-ir.json"] ?? "{}")).toEqual(document);
  });

  it("normalizes the legacy internal 1.0 version marker to IR version 1", () => {
    const migrated = migrateWorldSeedIr({
      format: "worldseed-ir",
      version: "1.0",
      metadata: {},
      semantic: manifest,
      navigation: { roadGraph, spawnPoints: {}, driveRoute: null },
    });
    expect(migrated.version).toBe("1");
  });

  it("serializes object keys deterministically while preserving array order", () => {
    expect(serializeCanonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [3, 2, 1] }, false))
      .toBe('{"a":{"b":3,"y":2},"list":[3,2,1],"z":1}');
  });

  it("rejects unknown formats and versions at the migration boundary", () => {
    expect(() => migrateWorldSeedIr({ format: "other", version: "1" })).toThrow(/format/);
    expect(() => migrateWorldSeedIr({
      format: "worldseed-ir",
      version: "99",
      metadata: {},
      semantic: {},
      navigation: {},
    })).toThrow(/version/);
  });
});
