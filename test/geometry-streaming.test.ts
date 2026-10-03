import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stableGeometrySubBatchSlot } from "../src/generation/city-builder";
import { createWorldSeedIrDependencyGraph } from "../src/ir/world-ir";
import {
  createCurrentWorldSeedBuildState,
  createGeometryIncrementalPlan,
  createGeometryTileGroups,
  createWorldSeedBuildState,
  createWorldSeedPatchPreview,
  parseWorldSeedBuildState,
  selectGeometryPrefetchTiles,
  selectGeometryTiles,
  type WorldSeedGeometryIndex,
} from "../src/export/world-kit";
import type { RoadGraph, WorldData, WorldManifest, WorldStats } from "../src/types";

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

function previewFixture() {
  const root = new THREE.Group();
  root.add(tiledMesh(
    { id: "0:0", x: 0, z: 0, centerX: 0, centerZ: 0, size: 300 },
    "buildings",
  ));
  const manifest: WorldManifest = {
    schemaVersion: "1.0",
    generator: "WorldSeed 0.9.1",
    coordinateSystem: "local meters; X east, Y up, Z south",
    radiusMeters: 300,
    layers: { terrain: 0, areas: 0, roads: 0, buildings: 1, roofs: 0 },
    objects: [{
      id: "building:test",
      sourceId: "test",
      layer: "buildings",
      source: "demo",
      center: [0, 1, 0],
      bounds: { minimum: [-2, 0, -2], maximum: [2, 2, 2] },
      properties: { heightMeters: 2 },
      tile: "0:0",
    }],
  };
  const roadGraph: RoadGraph = {
    schemaVersion: "1.0",
    generator: "WorldSeed 0.9.1",
    coordinateSystem: "local meters; X east, Y up, Z south",
    nodes: [],
    edges: [],
  };
  const data: WorldData = {
    center: [0, 0],
    radius: 300,
    buildings: [],
    roads: [],
    areas: [],
    attributions: [],
    providerLabel: "Synthetic test",
    generatedAt: "2026-10-03T00:00:00.000Z",
    warnings: [],
    isDemo: true,
  };
  const stats: WorldStats = {
    buildings: 1,
    roads: 0,
    areas: 0,
    providedHeights: 1,
    levelHeights: 0,
    inferredHeights: 0,
    triangles: 12,
    drawCalls: 1,
    truncatedBuildings: 0,
    terrainRelief: 0,
    roofs: 0,
    shapedRoofs: 0,
    semanticObjects: 1,
    tiles: 1,
    plateauBuildings: 0,
    plateauLod2Buildings: 0,
    roadNodes: 0,
    roadEdges: 0,
    drivableRoadMeters: 0,
  };
  return { root, manifest, roadGraph, data, stats };
}

describe("stable geometry sub-batches", () => {
  it("keeps feature slot assignment deterministic and insertion-independent", () => {
    const first = stableGeometrySubBatchSlot("building:alpha");
    const second = stableGeometrySubBatchSlot("building:alpha");
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(4);

    const assignments = new Map([
      ["building:alpha", stableGeometrySubBatchSlot("building:alpha")],
      ["building:beta", stableGeometrySubBatchSlot("building:beta")],
      ["building:gamma", stableGeometrySubBatchSlot("building:gamma")],
    ]);
    stableGeometrySubBatchSlot("building:newly-added");
    expect(stableGeometrySubBatchSlot("building:alpha")).toBe(assignments.get("building:alpha"));
    expect(stableGeometrySubBatchSlot("building:beta")).toBe(assignments.get("building:beta"));
    expect(stableGeometrySubBatchSlot("building:gamma")).toBe(assignments.get("building:gamma"));
  });

  it("indexes batch feature IDs against stable semantic dependency IDs", () => {
    const root = new THREE.Group();
    const mesh = tiledMesh(
      { id: "0:0", x: 0, z: 0, centerX: 0, centerZ: 0, size: 300 },
      "buildings",
    );
    mesh.userData.featureIds = ["test"];
    mesh.userData.worldseedBatchId = "buildings:0:0:0:sb1";
    root.add(mesh);

    const document = {
      format: "worldseed-ir" as const,
      version: "1" as const,
      metadata: { schemaVersion: "1.0", exactOriginIncluded: false, origin: null, style: "low-poly" },
      semantic: {
        schemaVersion: "1.0" as const,
        generator: "WorldSeed 0.9.1",
        coordinateSystem: "local meters; X east, Y up, Z south",
        radiusMeters: 300,
        layers: { terrain: 0, areas: 0, roads: 0, buildings: 1, roofs: 0 },
        objects: [{
          id: "building:test",
          sourceId: "test",
          layer: "buildings" as const,
          source: "demo",
          center: [0, 1, 0] as [number, number, number],
          bounds: {
            minimum: [-1, 0, -1] as [number, number, number],
            maximum: [1, 2, 1] as [number, number, number],
          },
          properties: {},
        }],
      },
      navigation: {
        roadGraph: {
          schemaVersion: "1.0" as const,
          generator: "WorldSeed 0.9.1",
          coordinateSystem: "local meters; X east, Y up, Z south",
          nodes: [],
          edges: [],
        },
        spawnPoints: { vehicles: [], pedestrians: [] },
        driveRoute: null,
      },
    };
    const graph = createWorldSeedIrDependencyGraph(document, 300);
    const { index } = createGeometryTileGroups(root, graph);

    expect(index.tiles[0]?.batches).toEqual([
      expect.objectContaining({
        id: "buildings:0:0:0:sb1",
        layer: "buildings",
        detail: false,
        featureIds: ["test"],
        dependencyIds: ["semantic:demo:buildings:test"],
      }),
    ]);
  });
});

describe("geometry tile export", () => {
  it("previews spawn-only changes without rebuilding geometry", () => {
    const fixture = previewFixture();
    const beforeSpawn = { x: 0, y: 0, z: 0 };
    const afterSpawn = { x: 12, y: 0, z: 0 };
    const baseline = createCurrentWorldSeedBuildState(
      fixture.root,
      fixture.data,
      fixture.stats,
      "low-poly",
      fixture.manifest,
      fixture.roadGraph,
      null,
      beforeSpawn,
      false,
    );

    const preview = createWorldSeedPatchPreview(
      fixture.root,
      fixture.data,
      fixture.stats,
      "low-poly",
      fixture.manifest,
      fixture.roadGraph,
      null,
      afterSpawn,
      baseline,
      false,
    );

    expect(preview.objectChanges).toEqual({ added: 0, changed: 1, removed: 0 });
    expect(preview.regeneratedTileIds).toEqual([]);
    expect(preview.regeneratedBatchCount).toBe(0);
    expect(preview.reusedTileCount).toBe(1);
    expect(preview.updates.spawnPoints).toBe(true);
    expect(preview.updates.colliders).toBe(false);
    expect(preview.estimatedUncompressedBytes).toBeGreaterThan(0);
  });

  it("previews building edits as sub-batch and collider invalidation", () => {
    const fixture = previewFixture();
    const spawn = { x: 0, y: 0, z: 0 };
    const baseline = createCurrentWorldSeedBuildState(
      fixture.root,
      fixture.data,
      fixture.stats,
      "low-poly",
      fixture.manifest,
      fixture.roadGraph,
      null,
      spawn,
      false,
    );
    const changedManifest = structuredClone(fixture.manifest);
    changedManifest.objects[0]!.properties = { heightMeters: 5 };

    const preview = createWorldSeedPatchPreview(
      fixture.root,
      fixture.data,
      fixture.stats,
      "low-poly",
      changedManifest,
      fixture.roadGraph,
      null,
      spawn,
      baseline,
      false,
    );

    expect(preview.regeneratedTileIds).toEqual([]);
    expect(preview.regeneratedBatchCount).toBe(1);
    expect(preview.reusedTileCount).toBe(1);
    expect(preview.updates.colliders).toBe(true);
    expect(preview.updates.semanticManifest).toBe(true);
    expect(preview.updates.roadGraph).toBe(false);
    expect(preview.noChanges).toBe(false);
  });

  it("round-trips the lightweight incremental build state", () => {
    const root = new THREE.Group();
    root.add(tiledMesh(
      { id: "0:0", x: 0, z: 0, centerX: 0, centerZ: 0, size: 300 },
      "buildings",
    ));
    const geometryIndex = createGeometryTileGroups(root).index;
    const document = {
      format: "worldseed-ir" as const,
      version: "1" as const,
      metadata: {
        schemaVersion: "1.0",
        exactOriginIncluded: false,
        origin: null,
        style: "low-poly",
      },
      semantic: {
        schemaVersion: "1.0" as const,
        generator: "WorldSeed 0.9.1",
        coordinateSystem: "local meters; X east, Y up, Z south",
        radiusMeters: 300,
        layers: { terrain: 0, areas: 0, roads: 0, buildings: 1, roofs: 0 },
        objects: [{
          id: "building:test",
          sourceId: "test",
          layer: "buildings" as const,
          source: "demo",
          center: [0, 0, 0] as [number, number, number],
          bounds: {
            minimum: [-1, 0, -1] as [number, number, number],
            maximum: [1, 2, 1] as [number, number, number],
          },
          properties: {},
        }],
      },
      navigation: {
        roadGraph: {
          schemaVersion: "1.0" as const,
          generator: "WorldSeed 0.9.1",
          coordinateSystem: "local meters; X east, Y up, Z south",
          nodes: [],
          edges: [],
        },
        spawnPoints: { vehicles: [], pedestrians: [] },
        driveRoute: null,
      },
    };

    const state = createWorldSeedBuildState(document, geometryIndex);
    const parsed = parseWorldSeedBuildState(JSON.stringify(state));

    expect(parsed).toEqual(state);
    expect(parsed.format).toBe("worldseed-build-state");
    expect(parsed.irIndex.revisionHash).toMatch(/^ws1-/);
    expect(parsed.dependencyGraph.graphHash).toMatch(/^ws1-/);
    expect(parsed.geometryIndex.tiles.map((tile) => tile.id)).toEqual(["0:0"]);
    expect(JSON.stringify(parsed)).not.toContain("longitude");
    expect(JSON.stringify(parsed)).not.toContain("latitude");
  });

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

  it("regenerates only the impacted stable sub-batch inside a reused tile", () => {
    const makeBatch = (id: string, dependencyId: string) => ({
      id,
      layer: "buildings",
      detail: false,
      featureIds: [id],
      dependencyIds: [dependencyId],
      objectCount: 1,
      vertexCount: 24,
      geometryByteLength: 512,
      materialCount: 1,
    });
    const tile = (batches: ReturnType<typeof makeBatch>[]): WorldSeedGeometryIndex["tiles"][number] => ({
      id: "0:0",
      path: "worldseed-tiles/0_0.glb",
      x: 0,
      z: 0,
      centerX: 0,
      centerZ: 0,
      size: 300,
      objectCount: 2,
      detailObjectCount: 0,
      layers: ["buildings"],
      batches,
    });
    const previous: WorldSeedGeometryIndex = {
      format: "worldseed-geometry-index",
      version: "1",
      recipeVersion: "1",
      coordinateSystem: "local meters; X east, Y up, Z south",
      tiles: [tile([
        makeBatch("buildings:0:0:0:sb0", "semantic:demo:buildings:a"),
        makeBatch("buildings:0:0:0:sb1", "semantic:demo:buildings:b"),
      ])],
    };
    const next: WorldSeedGeometryIndex = structuredClone(previous);

    const plan = createGeometryIncrementalPlan(previous, next, {
      format: "worldseed-ir-patch",
      version: "1",
      fromRevisionHash: "before",
      toRevisionHash: "after",
      globalChanged: false,
      geometryGlobalChanged: false,
      added: [],
      changed: [{ id: "0:0", path: "worldseed-ir/chunks/0_0.json", contentHash: "new" }],
      removed: [],
      unchangedCount: 0,
      dependencyGraphHash: "deps",
      dependencyDiff: {
        added: [],
        changed: ["semantic:demo:buildings:a"],
        removed: [],
        impacted: [
          "semantic:demo:buildings:a",
          "artifact:geometry:0:0",
          "artifact:colliders",
          "artifact:semantic-manifest",
        ],
        impactedArtifacts: [
          "artifact:colliders",
          "artifact:geometry:0:0",
          "artifact:semantic-manifest",
        ],
      },
    });

    expect([...plan.regenerateTileIds]).toEqual([]);
    expect([...plan.reusedTileIds]).toEqual(["0:0"]);
    expect(plan.manifest.regeneratedBatches).toEqual([
      expect.objectContaining({
        id: "buildings:0:0:0:sb0",
        tileId: "0:0",
        detail: false,
      }),
    ]);
    expect(plan.manifest.reusedBatchCount).toBe(1);
  });

  it("emits a sub-batch removal without rebuilding the containing tile", () => {
    const batch = (id: string, dependencyId: string) => ({
      id,
      layer: "buildings",
      detail: false,
      featureIds: [id],
      dependencyIds: [dependencyId],
      objectCount: 1,
      vertexCount: 24,
      geometryByteLength: 512,
      materialCount: 1,
    });
    const tile = (batches: ReturnType<typeof batch>[]): WorldSeedGeometryIndex["tiles"][number] => ({
      id: "0:0",
      path: "worldseed-tiles/0_0.glb",
      x: 0,
      z: 0,
      centerX: 0,
      centerZ: 0,
      size: 300,
      objectCount: batches.length,
      detailObjectCount: 0,
      layers: ["buildings"],
      batches,
    });
    const previous: WorldSeedGeometryIndex = {
      format: "worldseed-geometry-index",
      version: "1",
      recipeVersion: "2",
      coordinateSystem: "local meters; X east, Y up, Z south",
      tiles: [tile([
        batch("buildings:0:0:0:sb0", "semantic:demo:buildings:a"),
        batch("buildings:0:0:0:sb1", "semantic:demo:buildings:b"),
      ])],
    };
    const next: WorldSeedGeometryIndex = {
      ...previous,
      tiles: [tile([
        batch("buildings:0:0:0:sb1", "semantic:demo:buildings:b"),
      ])],
    };

    const plan = createGeometryIncrementalPlan(previous, next, {
      format: "worldseed-ir-patch",
      version: "1",
      fromRevisionHash: "before",
      toRevisionHash: "after",
      globalChanged: false,
      geometryGlobalChanged: false,
      added: [],
      changed: [{ id: "0:0", path: "worldseed-ir/chunks/0_0.json", contentHash: "new" }],
      removed: [],
      unchangedCount: 0,
      dependencyGraphHash: "deps",
      dependencyDiff: {
        added: [],
        changed: [],
        removed: ["semantic:demo:buildings:a"],
        impacted: [
          "semantic:demo:buildings:a",
          "artifact:geometry:0:0",
          "artifact:colliders",
          "artifact:semantic-manifest",
        ],
        impactedArtifacts: [
          "artifact:colliders",
          "artifact:geometry:0:0",
          "artifact:semantic-manifest",
        ],
      },
    });

    expect([...plan.regenerateTileIds]).toEqual([]);
    expect([...plan.reusedTileIds]).toEqual(["0:0"]);
    expect(plan.manifest.regeneratedBatches).toEqual([]);
    expect(plan.manifest.removedBatches).toEqual([
      {
        id: "buildings:0:0:0:sb0",
        tileId: "0:0",
        detail: false,
      },
    ]);
    expect(plan.manifest.reusedBatchCount).toBe(1);
  });

  it("forces one full rebuild when upgrading a recipe-v1 baseline to sub-batch recipe v2", () => {
    const previous: WorldSeedGeometryIndex = {
      format: "worldseed-geometry-index",
      version: "1",
      recipeVersion: "1",
      coordinateSystem: "local meters; X east, Y up, Z south",
      tiles: [{
        id: "0:0",
        path: "worldseed-tiles/0_0.glb",
        x: 0,
        z: 0,
        centerX: 0,
        centerZ: 0,
        size: 300,
        objectCount: 1,
        detailObjectCount: 0,
        layers: ["buildings"],
      }],
    };
    const next: WorldSeedGeometryIndex = {
      ...previous,
      recipeVersion: "2",
      tiles: [{
        ...previous.tiles[0]!,
        batches: [{
          id: "buildings:0:0:0:sb0",
          layer: "buildings",
          detail: false,
          featureIds: ["a"],
          dependencyIds: ["semantic:demo:buildings:a"],
          objectCount: 1,
          vertexCount: 24,
          geometryByteLength: 512,
          materialCount: 1,
        }],
      }],
    };

    const plan = createGeometryIncrementalPlan(previous, next, {
      format: "worldseed-ir-patch",
      version: "1",
      fromRevisionHash: "before",
      toRevisionHash: "after",
      globalChanged: false,
      geometryGlobalChanged: false,
      added: [],
      changed: [],
      removed: [],
      unchangedCount: 1,
      dependencyGraphHash: "deps",
      dependencyDiff: {
        added: [],
        changed: [],
        removed: [],
        impacted: [],
        impactedArtifacts: [],
      },
    });

    expect([...plan.regenerateTileIds]).toEqual(["0:0"]);
    expect(plan.manifest.regeneratedBatches).toEqual([]);
    expect(plan.manifest.reusedCount).toBe(0);
  });

  it("does not rebuild geometry for spawn-only dependency changes", () => {
    const index: WorldSeedGeometryIndex = {
      format: "worldseed-geometry-index",
      version: "1",
      recipeVersion: "1",
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
      ],
    };

    const plan = createGeometryIncrementalPlan(index, index, {
      format: "worldseed-ir-patch",
      version: "1",
      fromRevisionHash: "before",
      toRevisionHash: "after",
      globalChanged: false,
      geometryGlobalChanged: false,
      added: [],
      changed: [{ id: "0:0", path: "worldseed-ir/chunks/0_0.json", contentHash: "new" }],
      removed: [],
      unchangedCount: 0,
      dependencyGraphHash: "deps",
      dependencyDiff: {
        added: [],
        changed: ["spawn:vehicles:vehicle%3Atest"],
        removed: [],
        impacted: ["artifact:spawn-points", "spawn:vehicles:vehicle%3Atest"],
        impactedArtifacts: ["artifact:spawn-points"],
      },
    });

    expect([...plan.regenerateTileIds]).toEqual([]);
    expect([...plan.reusedTileIds]).toEqual(["0:0"]);
    expect(plan.manifest.reusedCount).toBe(1);
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
