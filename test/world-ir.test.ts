import { describe, expect, it } from "vitest";
import {
  createWorldSeedIr,
  createWorldSeedIrChunkSet,
  encodeWorldSeedIrFiles,
  migrateWorldSeedIr,
  parseWorldSeedIr,
  parseWorldSeedIrChunk,
  parseWorldSeedIrIndex,
  selectWorldSeedIrChunks,
  serializeCanonicalJson,
  serializeWorldSeedIr,
} from "../src/ir/world-ir";
import type { RoadGraph, WorldManifest } from "../src/types";

const manifest: WorldManifest = {
  schemaVersion: "1.0",
  generator: "WorldSeed 0.9.1",
  coordinateSystem: "local meters; X east, Y up, Z south",
  radiusMeters: 500,
  layers: { terrain: 1, areas: 0, roads: 0, buildings: 1, roofs: 0 },
  objects: [
    {
      id: "terrain:ground",
      sourceId: "ground",
      layer: "terrain",
      source: "demo",
      center: [0, 0, 0],
      bounds: { minimum: [-500, 0, -500], maximum: [500, 0, 500] },
      properties: {},
    },
    {
      id: "building:test",
      sourceId: "test",
      layer: "buildings",
      source: "demo",
      center: [180, 10, 10],
      bounds: { minimum: [170, 0, 0], maximum: [190, 20, 20] },
      properties: { heightMeters: 20 },
      tile: "1:0",
    },
  ],
};

const roadGraph: RoadGraph = {
  schemaVersion: "1.0",
  generator: "WorldSeed 0.9.1",
  coordinateSystem: "local meters; X east, Y up, Z south",
  nodes: [
    { id: "node:a", x: -220, y: 0, z: 0, edgeIds: ["edge:test"] },
    { id: "node:b", x: -180, y: 0, z: 0, edgeIds: ["edge:test"] },
  ],
  edges: [
    {
      id: "edge:test",
      roadId: "road:test",
      from: "node:a",
      to: "node:b",
      path: [{ x: -220, y: 0, z: 0 }, { x: -180, y: 0, z: 0 }],
      lengthMeters: 40,
      class: "residential",
      widthMeters: 6,
      surface: "paved",
      oneWay: "both",
      speedLimitKph: 30,
    },
  ],
};

function createDocument() {
  return createWorldSeedIr({
    metadata: { schemaVersion: "1.0", generator: "WorldSeed 0.9.1" },
    manifest,
    roadGraph,
    spawnPoints: {
      schemaVersion: "1.0",
      vehicles: [{ id: "vehicle:test", position: { x: 10, y: 0, z: 10 } }],
      pedestrians: [{ id: "pedestrian:test", position: { x: 185, y: 0, z: 5 } }],
    },
    driveRoute: null,
  });
}

describe("WorldSeed IR", () => {
  it("round-trips the shared intermediate representation", () => {
    const document = createDocument();
    const parsed = parseWorldSeedIr(serializeWorldSeedIr(document));
    expect(parsed).toEqual(document);

    const files = encodeWorldSeedIrFiles(document);
    expect(JSON.parse(files["worldseed.json"] ?? "{}")).toEqual(document.metadata);
    expect(JSON.parse(files["worldseed-ir.json"] ?? "{}")).toEqual(document);
  });

  it("chunks semantic, navigation and spawn data using the runtime tile size", () => {
    const document = createDocument();
    const { index, chunks } = createWorldSeedIrChunkSet(document, 300);

    expect(index.tileSizeMeters).toBe(300);
    expect(index.global.semanticObjects.map((object) => object.id)).toEqual(["terrain:ground"]);
    expect(index.chunks.map((chunk) => chunk.id)).toEqual(["-1:0", "0:0", "1:0"]);

    const roadChunk = chunks.find((chunk) => chunk.tile.id === "-1:0");
    expect(roadChunk?.navigation.roadGraph.edges.map((edge) => edge.id)).toEqual(["edge:test"]);
    expect(roadChunk?.navigation.roadGraph.nodes.map((node) => node.id)).toEqual(["node:a", "node:b"]);

    const centerChunk = chunks.find((chunk) => chunk.tile.id === "0:0");
    expect(centerChunk?.navigation.spawnPoints.vehicles).toHaveLength(1);

    const buildingChunk = chunks.find((chunk) => chunk.tile.id === "1:0");
    expect(buildingChunk?.semantic.objects.map((object) => object.id)).toEqual(["building:test"]);
    expect(buildingChunk?.navigation.spawnPoints.pedestrians).toHaveLength(1);
  });

  it("emits an index and independently parseable chunk files", () => {
    const files = encodeWorldSeedIrFiles(createDocument(), 300);
    const index = parseWorldSeedIrIndex(files["worldseed-ir.index.json"] ?? "{}");
    expect(index.chunks).toHaveLength(3);

    const buildingDescriptor = index.chunks.find((chunk) => chunk.id === "1:0");
    expect(buildingDescriptor?.path).toBe("worldseed-ir/chunks/1_0.json");
    const chunk = parseWorldSeedIrChunk(files[buildingDescriptor?.path ?? ""] ?? "{}");
    expect(chunk.tile.id).toBe("1:0");
    expect(chunk.semantic.objects[0]?.id).toBe("building:test");
  });

  it("selects only chunks near a streaming position", () => {
    const { index } = createWorldSeedIrChunkSet(createDocument(), 300);
    expect(selectWorldSeedIrChunks(index, 200, 0, 40).map((chunk) => chunk.id)).toEqual(["1:0"]);
    expect(selectWorldSeedIrChunks(index, 0, 0, 40).map((chunk) => chunk.id)).toEqual(["0:0"]);
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
