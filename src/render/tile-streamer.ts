import * as THREE from "three";
import type { ExploreMode } from "../types";
import { streamingRange, tileIsVisible, type WorldTile } from "../generation/tiling";

const GPU_RELEASE_MARGIN_METERS = 220;

interface StreamedObject {
  object: THREE.Object3D;
  tile: WorldTile;
  detail: boolean;
}

export interface StreamingStats {
  activeTiles: number;
  totalTiles: number;
}

export class TileStreamer {
  private readonly objects: StreamedObject[] = [];
  private readonly tiles = new Map<string, WorldTile>();
  private readonly gpuReleased = new WeakSet<THREE.Object3D>();
  private lastSignature = "";
  private listener?: (stats: StreamingStats) => void;

  constructor(root: THREE.Object3D, private readonly radius: number) {
    root.traverse((object) => {
      const tile = object.userData["worldseedTile"] as WorldTile | undefined;
      if (!tile) return;
      this.objects.push({
        object,
        tile,
        detail: object.userData["worldseedDetail"] === true,
      });
      this.tiles.set(tile.id, tile);
    });
  }

  onChange(listener: (stats: StreamingStats) => void): void {
    this.listener = listener;
    listener({ activeTiles: this.tiles.size, totalTiles: this.tiles.size });
  }

  update(camera: THREE.Camera, mode: ExploreMode): void {
    const range = streamingRange(mode, this.radius);
    const active = new Set<string>();
    for (const entry of this.objects) {
      const distance = entry.detail ? range.detail : range.base;
      const visible = tileIsVisible(
        entry.tile,
        camera.position.x,
        camera.position.z,
        distance,
      );
      entry.object.visible = visible;
      if (visible) {
        active.add(entry.tile.id);
        this.gpuReleased.delete(entry.object);
        continue;
      }

      const safelyDistant = !tileIsVisible(
        entry.tile,
        camera.position.x,
        camera.position.z,
        distance + GPU_RELEASE_MARGIN_METERS,
      );
      if (safelyDistant && !this.gpuReleased.has(entry.object)) {
        releaseObjectGpuResources(entry.object);
        this.gpuReleased.add(entry.object);
      }
    }
    const signature = [...active].sort().join("|");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.listener?.({ activeTiles: active.size, totalTiles: this.tiles.size });
  }
}

export function releaseObjectGpuResources(root: THREE.Object3D): void {
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    renderable.geometry?.dispose();
    if (Array.isArray(renderable.material)) {
      for (const material of renderable.material) material.dispose();
    } else {
      renderable.material?.dispose();
    }
  });
}
