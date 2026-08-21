import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DriveTerrainDetailPatch } from "../src/render/drive-terrain-detail";

describe("Drive near-field terrain detail", () => {
  it("keeps a local high-detail index around the camera and hides cleanly", () => {
    const geometry = new THREE.PlaneGeometry(240, 240, 24, 24);
    geometry.rotateX(-Math.PI / 2);
    const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    const patch = new DriveTerrainDetailPatch(terrain);
    patch.setVisible(true);
    patch.update(0, 0);
    const centerCount = patch.mesh.geometry.getIndex()?.count ?? 0;
    expect(centerCount).toBeGreaterThan(0);
    expect(centerCount).toBeLessThan(geometry.getIndex()!.count);
    expect(patch.mesh.userData["driveDetailTriangles"]).toBeGreaterThan(0);
    patch.setVisible(false);
    expect(patch.mesh.visible).toBe(false);
    patch.dispose();
    geometry.dispose();
  });
});
