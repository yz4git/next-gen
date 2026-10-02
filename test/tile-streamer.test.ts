import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TileStreamer } from "../src/render/tile-streamer";

function makeRoot() {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = {
    worldseedTile: {
      id: "0:0",
      x: 0,
      z: 0,
      centerX: 0,
      centerZ: 0,
      size: 300,
    },
  };
  root.add(mesh);
  return { root, mesh, geometry, material };
}

describe("TileStreamer GPU release", () => {
  it("releases distant tile GPU resources once and keeps the object reusable", () => {
    const { root, mesh, geometry, material } = makeRoot();
    let geometryDisposals = 0;
    let materialDisposals = 0;
    geometry.addEventListener("dispose", () => { geometryDisposals += 1; });
    material.addEventListener("dispose", () => { materialDisposals += 1; });

    const streamer = new TileStreamer(root, 500);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1_500, 0, 0);

    streamer.update(camera, "drive");
    expect(mesh.visible).toBe(false);
    expect(geometryDisposals).toBe(1);
    expect(materialDisposals).toBe(1);

    streamer.update(camera, "drive");
    expect(geometryDisposals).toBe(1);
    expect(materialDisposals).toBe(1);

    camera.position.set(0, 0, 0);
    streamer.update(camera, "drive");
    expect(mesh.visible).toBe(true);

    camera.position.set(1_500, 0, 0);
    streamer.update(camera, "drive");
    expect(geometryDisposals).toBe(2);
    expect(materialDisposals).toBe(2);
  });

  it("keeps just-hidden tiles warm inside the release margin", () => {
    const { root, mesh, geometry } = makeRoot();
    let geometryDisposals = 0;
    geometry.addEventListener("dispose", () => { geometryDisposals += 1; });

    const streamer = new TileStreamer(root, 500);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(750, 0, 0);

    streamer.update(camera, "drive");
    expect(mesh.visible).toBe(false);
    expect(geometryDisposals).toBe(0);
  });
});
