import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DriveTerrainDetailPatch } from "../src/render/drive-terrain-detail";

describe("Drive terrain detail", () => {
  it("forces high LOD on the original terrain without drawing an overlapping mesh", () => {
    const geometry = new THREE.PlaneGeometry(240, 240, 24, 24);
    geometry.rotateX(-Math.PI / 2);
    const highIndex = geometry.getIndex()!.clone();
    const mediumIndex = new THREE.Uint16BufferAttribute(Array.from({ length: 60 }, (_, index) => highIndex.getX(index)), 1);
    const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    terrain.onBeforeRender = () => geometry.setIndex(mediumIndex);

    const patch = new DriveTerrainDetailPatch(terrain);
    patch.setVisible(true);
    patch.update(0, 0);
    terrain.onBeforeRender(
      {} as THREE.WebGLRenderer,
      {} as THREE.Scene,
      {} as THREE.Camera,
      geometry,
      terrain.material,
      null,
    );

    expect(patch.mesh.visible).toBe(false);
    expect(patch.mesh.geometry.getIndex()).toBeNull();
    expect(geometry.getIndex()?.count).toBe(highIndex.count);
    expect(terrain.userData["driveSingleSurfaceHigh"]).toBe(true);

    patch.setVisible(false);
    terrain.onBeforeRender(
      {} as THREE.WebGLRenderer,
      {} as THREE.Scene,
      {} as THREE.Camera,
      geometry,
      terrain.material,
      null,
    );
    expect(geometry.getIndex()?.count).toBe(mediumIndex.count);

    patch.dispose();
    terrain.material.dispose();
    geometry.dispose();
  });
});
