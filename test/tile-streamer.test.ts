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

  it("shows at most the next two base tiles ahead of drive motion", () => {
    const root = new THREE.Group();
    const makeTile = (id: string, centerX: number, detail = false) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      mesh.userData = {
        worldseedTile: { id, x: centerX / 300, z: 0, centerX, centerZ: 0, size: 300 },
        worldseedDetail: detail,
      };
      root.add(mesh);
      return mesh;
    };

    const first = makeTile("1:0", 300);
    const second = makeTile("2:0", 600);
    const third = makeTile("3:0", 900);
    const detail = makeTile("2:0-detail", 600, true);
    const streamer = new TileStreamer(root, 500);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(-600, 0, 0);
    streamer.setMotionHint({
      x: 0,
      z: 0,
      directionX: 1,
      directionZ: 0,
      speedMetersPerSecond: 34,
    });

    streamer.update(camera, "drive");

    expect(first.visible).toBe(true);
    expect(second.visible).toBe(true);
    expect(third.visible).toBe(false);
    expect(detail.visible).toBe(false);
  });

  it("shrinks base visibility under the economy adaptive budget", () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.userData = {
      worldseedTile: { id: "2:0", x: 2, z: 0, centerX: 600, centerZ: 0, size: 300 },
    };
    root.add(mesh);

    const streamer = new TileStreamer(root, 500);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);

    streamer.setAdaptiveBudget({
      tier: "quality",
      baseScale: 1.08,
      detailScale: 1,
      prefetchScale: 1,
      maxConcurrentLoads: 2,
      maxConcurrentPrefetches: 1,
      maxCacheRecords: 72,
      dprCap: 1.8,
    });
    streamer.update(camera, "drive");
    expect(mesh.visible).toBe(true);

    streamer.setAdaptiveBudget({
      tier: "economy",
      baseScale: 0.72,
      detailScale: 0.55,
      prefetchScale: 0.62,
      maxConcurrentLoads: 1,
      maxConcurrentPrefetches: 0,
      maxCacheRecords: 20,
      dprCap: 1.35,
    });
    streamer.update(camera, "drive");
    expect(mesh.visible).toBe(false);
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
