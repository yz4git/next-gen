import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { normalizeMergeGeometry } from "../src/generation/city-builder";
import { CollisionIndex } from "../src/generation/collision";
import { resolveBuildingHeight } from "../src/generation/height";
import { clipSegmentToCircle, pointInPolygon } from "../src/geo/polygon";
import type { BuildingFeature } from "../src/types";

const footprint = [[[[139, 35], [139.001, 35], [139.001, 35.001], [139, 35.001], [139, 35]]]] as BuildingFeature["polygons"];

describe("height inference", () => {
  it("prefers measured height over level count", () => {
    const result = resolveBuildingHeight({ id: "a", polygons: footprint, height: 22, levels: 3, source: "overture" });
    expect(result.resolvedHeight).toBe(22);
    expect(result.heightQuality).toBe("provided");
  });

  it("uses level count before deterministic inference", () => {
    const levels = resolveBuildingHeight({ id: "b", polygons: footprint, levels: 5, source: "openstreetmap" });
    const inferredA = resolveBuildingHeight({ id: "same", polygons: footprint, kind: "office", source: "overture" });
    const inferredB = resolveBuildingHeight({ id: "same", polygons: footprint, kind: "office", source: "overture" });
    expect(levels.resolvedHeight).toBe(16);
    expect(levels.heightQuality).toBe("levels");
    expect(inferredA.resolvedHeight).toBe(inferredB.resolvedHeight);
    expect(inferredA.heightQuality).toBe("inferred");
  });
});

describe("spatial safeguards", () => {
  const square = [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 5 }, { x: -5, z: 5 }];

  it("checks polygons and circle clipping", () => {
    expect(pointInPolygon({ x: 0, z: 0 }, square)).toBe(true);
    expect(pointInPolygon({ x: 9, z: 0 }, square)).toBe(false);
    expect(clipSegmentToCircle({ x: -20, z: 0 }, { x: 20, z: 0 }, 10)).toEqual([{ x: -10, z: 0 }, { x: 10, z: 0 }]);
  });

  it("prevents walk mode entering building footprints or leaving the seed", () => {
    const collision = new CollisionIndex(50, 10);
    collision.add(square);
    expect(collision.canOccupy({ x: 0, z: 0 })).toBe(false);
    expect(collision.canOccupy({ x: 10, z: 0 })).toBe(true);
    expect(collision.canOccupy({ x: 51, z: 0 })).toBe(false);
  });
});



describe("geometry batching", () => {
  it("normalizes merge attributes so generated roof variants can share a bucket", () => {
    const textured = new THREE.BoxGeometry(2, 2, 2);
    const procedural = new THREE.BufferGeometry();
    procedural.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    procedural.setIndex([0, 1, 2]);

    normalizeMergeGeometry(textured);
    normalizeMergeGeometry(procedural);

    expect(Object.keys(textured.attributes).sort()).toEqual(["normal", "position"]);
    expect(Object.keys(procedural.attributes).sort()).toEqual(["normal", "position"]);
  });
});
