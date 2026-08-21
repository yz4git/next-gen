import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { conformRoadSurfacesToTerrain, TerrainMeshSampler } from "../src/terrain/mesh-sampler";

describe("terrain mesh road conformance", () => {
  it("samples a sloped terrain triangle in XZ", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0,
      10, 2, 0,
      0, 4, 10,
      10, 6, 10,
    ], 3));
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    const sampler = new TerrainMeshSampler(geometry, 8);
    expect(sampler.sample(5, 5)).toBeCloseTo(3, 4);
  });

  it("moves each road edge vertex to its own terrain height", () => {
    const terrainGeometry = new THREE.BufferGeometry();
    terrainGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
      -10, -2, -10,
      10, 2, -10,
      -10, 2, 10,
      10, 6, 10,
    ], 3));
    terrainGeometry.setIndex([0, 2, 1, 1, 2, 3]);
    const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshBasicMaterial());
    terrain.name = "Terrain";

    const roadGeometry = new THREE.BufferGeometry();
    roadGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
      -3, 0, -4,
      3, 0, -4,
      -3, 0, 4,
      3, 0, 4,
    ], 3));
    roadGeometry.setIndex([0, 2, 1, 1, 2, 3]);
    const road = new THREE.Mesh(roadGeometry, new THREE.MeshBasicMaterial());
    road.name = "Roads 0:0";
    road.userData = { worldseedLayer: "roads" };
    const group = new THREE.Group();
    group.add(terrain, road);

    const stats = conformRoadSurfacesToTerrain(group, terrain);
    const positions = roadGeometry.getAttribute("position") as THREE.BufferAttribute;
    expect(stats.vertices).toBe(4);
    expect(positions.getY(0)).not.toBeCloseTo(positions.getY(1), 3);
    expect(positions.getY(2)).not.toBeCloseTo(positions.getY(3), 3);
    expect(Math.min(...Array.from({ length: positions.count }, (_, index) => positions.getY(index)))).toBeGreaterThan(-2);
  });
});
