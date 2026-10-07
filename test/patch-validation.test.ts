import { describe, expect, it } from "vitest";
import { prepareWorldSeedPatch } from "../examples/export-consumer/src/patch-validation.js";

const bytes = new Uint8Array([1, 2, 3]);
function fixture(): any {
  const batch = {
    id: "buildings:0:0:0:sb0", detail: false,
    layer: "buildings", featureIds: ["a"], dependencyIds: [],
    objectCount: 1, vertexCount: 4, geometryByteLength: 48, materialCount: 1,
  };
  const tile = {
    id: "0:0", path: "tile.glb", x: 0, z: 0,
    centerX: 0, centerZ: 0, size: 300, objectCount: 1,
    detailObjectCount: 0, layers: ["buildings"], batches: [batch],
  };
  const nextTile = {
    ...tile, batches: [{ ...batch, path: "batch.glb" }],
  };
  const activeIr = { format: "worldseed-ir-index", version: "1", revisionHash: "before" };
  const newIr = { ...activeIr, revisionHash: "after" };
  const geometry = {
    format: "worldseed-geometry-index", version: "1", recipeVersion: "2",
    coordinateSystem: "local meters; X east, Y up, Z south",
    tiles: [tile],
  };
  const geometryPatch = {
    format: "worldseed-geometry-patch", version: "1",
    fromIrRevisionHash: "before", toIrRevisionHash: "after",
    regenerated: [], removed: [],
    regeneratedBatches: [{ id: batch.id, tileId: "0:0", detail: false, path: "batch.glb" }],
    removedBatches: [],
  };
  return {
    currentArchive: { "tile.glb": bytes },
    currentIrIndex: activeIr,
    currentGeometryIndex: geometry,
    archive: { "batch.glb": bytes },
    patchManifest: {
      format: "worldseed-incremental-patch", version: "2",
      fromRevisionHash: "before", toRevisionHash: "after",
    },
    irPatch: {
      format: "worldseed-ir-patch", version: "1",
      fromRevisionHash: "before", toRevisionHash: "after",
    },
    geometryPatch,
    nextIrIndex: newIr,
    nextGeometryIndex: { ...geometry, tiles: [nextTile] },
  };
}

describe("standalone incremental patch preflight", () => {
  it("prepares a valid sub-batch patch without modifying the loaded archive", () => {
    const input = fixture();
    const result = prepareWorldSeedPatch(input);
    expect([...result.batchRefreshIds]).toEqual(["0:0"]);
    expect([...result.batchTargets.get("0:0")]).toEqual(["buildings:0:0:0:sb0"]);
    expect(result.mergedArchive["batch.glb"]).toBe(bytes);
    expect(input.currentArchive["batch.glb"]).toBeUndefined();
  });

  it("rejects missing GLBs before touching the existing world", () => {
    const input = fixture();
    input.archive = {};
    expect(() => prepareWorldSeedPatch(input)).toThrow(/missing override|missing/);
    expect(input.currentArchive["tile.glb"]).toBe(bytes);
  });

  it("rejects wrong base revision even when patch internals agree", () => {
    const input = fixture();
    input.patchManifest.fromRevisionHash = "unrelated";
    expect(() => prepareWorldSeedPatch(input)).toThrow(/base revision mismatch/);
  });

  it("rejects mismatched target revisions from the geometry patch", () => {
    const input = fixture();
    input.geometryPatch.toIrRevisionHash = "wrong";
    expect(() => prepareWorldSeedPatch(input)).toThrow(/geometry patch target revision mismatch/);
  });

  it("rejects a duplicate geometry tile ID", () => {
    const input = fixture();
    input.nextGeometryIndex.tiles.push({ ...input.nextGeometryIndex.tiles[0] });
    expect(() => prepareWorldSeedPatch(input)).toThrow(/duplicate tile ID/);
  });

  it("supports reverting from an override to the original baked geometry", () => {
    const input = fixture();
    input.currentArchive["batch.glb"] = bytes;
    input.currentGeometryIndex.tiles[0].batches[0].path = "batch.glb";
    delete input.nextGeometryIndex.tiles[0].batches[0].path;
    input.geometryPatch.regeneratedBatches = [];
    input.geometryPatch.removedBatches = [];
    const result = prepareWorldSeedPatch(input);
    expect(result.mergedArchive["tile.glb"]).toBe(bytes);
  });
});
