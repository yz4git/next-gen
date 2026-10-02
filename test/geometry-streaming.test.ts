import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
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
