import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createGeometryIncrementalPlan,
  createGeometryTileGroups,
  selectGeometryPrefetchTiles,
  selectGeometryTiles,
  type WorldSeedGeometryIndex,
} from "../src/export/world-kit";

function tiledMesh(
  tile: { id: string; x: number; z: number; centerX: number; centerZ: number; size: number },
  layer: string,
  detail = false,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  mesh.userData = {
    worldseedTile: tile,
    worldseedLayer: layer,
    worldseedDetail: detail,
  };
  return mesh;
}

describe("geometry tile export", () => {
  it("groups render objects by runtime tile and records layers/detail counts", () => {
    const root = new THREE.Group();
    const center = { id: "0:0", x: 0, z: 0, centerX: 0, centerZ: 0, size: 300 };
    const east = { id: "1:0", x: 1, z: 0, centerX: 300, centerZ: 0, size: 300 };
    root.add(tiledMesh(center, "roads"));
    root.add(tiledMesh(center, "roads", true));
    root.add(tiledMesh(east, "buildings"));

    const { index, tiles } = createGeometryTileGroups(root);

    expect(index.tiles.map((tile) => tile.id)).toEqual(["0:0", "1:0"]);
    expect(index.tiles[0]).toMatchObject({
      path: "worldseed-tiles/0_0.glb",
      detailPath: "worldseed-tiles/detail/0_0.glb",
      objectCount: 2,
      detailObjectCount: 1,
      vertexCount: 24,
      detailVertexCount: 24,
      geometryByteLength: expect.any(Number),
      detailGeometryByteLength: expect.any(Number),
      materialCount: 1,
      detailMaterialCount: 1,
      layers: ["roads"],
    });
    expect(tiles[0]?.group.children).toHaveLength(1);
    expect(tiles[0]?.detailGroup?.children).toHaveLength(1);
    expect(tiles[1]?.group.children).toHaveLength(1);
    expect(tiles[1]?.detailGroup).toBeUndefined();
  });

  it("preserves parent transforms relative to the exported world root", () => {
    const root = new THREE.Group();
    root.position.set(100, 0, 0);
    const parent = new THREE.Group();
    parent.position.set(12, 0, -7);
    const mesh = tiledMesh(
      { id: "0:0", x: 0, z: 0, centerX: 0, centerZ: 0, size: 300 },
      "buildings",
    );
    mesh.position.set(3, 4, 5);
    parent.add(mesh);
    root.add(parent);

    const { tiles } = createGeometryTileGroups(root);
    const clone = tiles[0]?.group.children[0];
    expect(clone).toBeDefined();
    const position = new THREE.Vector3().setFromMatrixPosition(clone!.matrix);
    expect(position.x).toBeCloseTo(15);
    expect(position.y).toBeCloseTo(4);
    expect(position.z).toBeCloseTo(-2);
  });

  it("plans incremental geometry rebuilds from IR patch changes", () => {
    const tile = (
      id: string,
      x: number,
      options: { detail?: boolean; layer?: string } = {},
    ) => ({
      id,
      path: `worldseed-tiles/${x}_0.glb`,
      ...(options.detail ? { detailPath: `worldseed-tiles/detail/${x}_0.glb` } : {}),
      x,
      z: 0,
      centerX: x * 300,
      centerZ: 0,
      size: 300,
      objectCount: options.detail ? 2 : 1,
      detailObjectCount: options.detail ? 1 : 0,
      layers: [options.layer ?? "buildings"],
    });

    const previous: WorldSeedGeometryIndex = {
      format: "worldseed-geometry-index",
      version: "1",
      recipeVersion: "1",
      coordinateSystem: "local meters; X east, Y up, Z south",
      tiles: [
        tile("-1:0", -1),
        tile("0:0", 0, { detail: true, layer: "roads" }),
        tile("1:0", 1),
      ],
    };
    const next: WorldSeedGeometryIndex = {
      format: "worldseed-geometry-index",
      version: "1",
      recipeVersion: "1",
      coordinateSystem: "local meters; X east, Y up, Z south",
      tiles: [
        tile("0:0", 0, { layer: "roads" }),
        tile("1:0", 1),
        tile("2:0", 2),
      ],
    };

    const plan = createGeometryIncrementalPlan(previous, next, {
      format: "worldseed-ir-patch",
      version: "1",
      fromRevisionHash: "old",
      toRevisionHash: "new",
      globalChanged: false,
      geometryGlobalChanged: false,
      added: [{ id: "2:0", path: "worldseed-ir/chunks/2_0.json", contentHash: "new-2" }],
      changed: [{ id: "0:0", path: "worldseed-ir/chunks/0_0.json", contentHash: "new-0" }],
      removed: [{ id: "-1:0", path: "worldseed-ir/chunks/-1_0.json", contentHash: "old--1" }],
      unchangedCount: 1,
    });

    expect([...plan.regenerateTileIds].sort()).toEqual(["0:0", "2:0"]);
    expect([...plan.reusedTileIds]).toEqual(["1:0"]);
    expect(plan.manifest.regenerated.map((entry) => entry.id)).toEqual(["0:0", "2:0"]);
    expect(plan.manifest.removed).toEqual([
      { id: "-1:0", paths: ["worldseed-tiles/-1_0.glb"] },
      { id: "0:0", paths: ["worldseed-tiles/detail/0_0.glb"] },
    ]);
    expect(plan.manifest.reusedCount).toBe(1);
    expect(plan.manifest.fromIrRevisionHash).toBe("old");
    expect(plan.manifest.toIrRevisionHash).toBe("new");
  });

  it("invalidates all geometry tiles when the geometry recipe changes", () => {
    const makeIndex = (recipeVersion: string): WorldSeedGeometryIndex => ({
      format: "worldseed-geometry-index",
      version: "1",
      recipeVersion,
      coordinateSystem: "local meters; X east, Y up, Z south",
      tiles: [
        {
          id: "0:0",
          path: "worldseed-tiles/0_0.glb",
          x: 0,
          z: 0,
          centerX: 0,
          centerZ: 0,
          size: 300,
          objectCount: 1,
          detailObjectCount: 0,
          layers: ["roads"],
        },
        {
          id: "1:0",
          path: "worldseed-tiles/1_0.glb",
          x: 1,
          z: 0,
          centerX: 300,
          centerZ: 0,
          size: 300,
          objectCount: 1,
          detailObjectCount: 0,
          layers: ["buildings"],
        },
      ],
    });

    const plan = createGeometryIncrementalPlan(
      makeIndex("1"),
      makeIndex("2"),
      {
        format: "worldseed-ir-patch",
        version: "1",
        fromRevisionHash: "same-a",
        toRevisionHash: "same-b",
        globalChanged: false,
        geometryGlobalChanged: false,
        added: [],
        changed: [],
        removed: [],
        unchangedCount: 2,
      },
    );

    expect([...plan.regenerateTileIds].sort()).toEqual(["0:0", "1:0"]);
    expect(plan.manifest.reusedCount).toBe(0);
  });

  it("prefetches only tiles ahead of movement and prefers the nearest corridor", () => {
    const index: WorldSeedGeometryIndex = {
      format: "worldseed-geometry-index",
      version: "1",
      coordinateSystem: "local meters; X east, Y up, Z south",
      tiles: [
        {
          id: "0:0",
          path: "worldseed-tiles/0_0.glb",
          x: 0,
          z: 0,
          centerX: 0,
          centerZ: 0,
          size: 300,
          objectCount: 1,
          detailObjectCount: 0,
          layers: ["roads"],
        },
        {
          id: "1:0",
          path: "worldseed-tiles/1_0.glb",
          x: 1,
          z: 0,
          centerX: 300,
          centerZ: 0,
          size: 300,
          objectCount: 1,
          detailObjectCount: 0,
          layers: ["roads"],
        },
        {
          id: "2:0",
          path: "worldseed-tiles/2_0.glb",
          x: 2,
          z: 0,
          centerX: 600,
          centerZ: 0,
          size: 300,
          objectCount: 1,
          detailObjectCount: 0,
          layers: ["roads"],
        },
        {
          id: "1:1",
          path: "worldseed-tiles/1_1.glb",
          x: 1,
          z: 1,
          centerX: 300,
          centerZ: 300,
          size: 300,
          objectCount: 1,
          detailObjectCount: 0,
          layers: ["roads"],
        },
        {
          id: "-1:0",
          path: "worldseed-tiles/-1_0.glb",
          x: -1,
          z: 0,
          centerX: -300,
          centerZ: 0,
          size: 300,
          objectCount: 1,
          detailObjectCount: 0,
          layers: ["roads"],
        },
      ],
    };

    expect(selectGeometryPrefetchTiles(index, 0, 0, 1, 0, 700, 2).map((tile) => tile.id))
      .toEqual(["1:0", "2:0"]);
    expect(selectGeometryPrefetchTiles(index, 0, 0, 0, 0, 700, 2)).toEqual([]);
  });

  it("selects geometry tiles with the same padded boundary policy as runtime streaming", () => {
    const index: WorldSeedGeometryIndex = {
      format: "worldseed-geometry-index",
      version: "1",
      coordinateSystem: "local meters; X east, Y up, Z south",
      tiles: [
        {
          id: "0:0",
          path: "worldseed-tiles/0_0.glb",
          x: 0,
          z: 0,
          centerX: 0,
          centerZ: 0,
          size: 300,
          objectCount: 1,
          detailObjectCount: 0,
          layers: ["roads"],
        },
        {
          id: "1:0",
          path: "worldseed-tiles/1_0.glb",
          x: 1,
          z: 0,
          centerX: 300,
          centerZ: 0,
          size: 300,
          objectCount: 1,
          detailObjectCount: 0,
          layers: ["buildings"],
        },
      ],
    };

    expect(selectGeometryTiles(index, 0, 0, 40).map((tile) => tile.id)).toEqual(["0:0"]);
    expect(selectGeometryTiles(index, 200, 0, 40).map((tile) => tile.id)).toEqual(["1:0", "0:0"]);
  });
});
