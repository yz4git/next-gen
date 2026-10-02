import * as THREE from "three";
import type { ExploreMode } from "../types";
import { streamingRange, tileIsVisible, type WorldTile } from "../generation/tiling";
import type { AdaptiveStreamingBudget } from "./adaptive-streaming";

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

export interface StreamingMotionHint {
  x: number;
  z: number;
  directionX: number;
  directionZ: number;
  speedMetersPerSecond: number;
}

export class TileStreamer {
  private readonly objects: StreamedObject[] = [];
  private readonly tiles = new Map<string, WorldTile>();
  private readonly gpuReleased = new WeakSet<THREE.Object3D>();
  private motionHint: StreamingMotionHint | null = null;
  private budget: AdaptiveStreamingBudget = {
    tier: "quality",
    baseScale: 1,
    detailScale: 1,
    prefetchScale: 1,
    maxConcurrentLoads: 2,
    maxConcurrentPrefetches: 1,
    dprCap: 1.8,
  };
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

  setMotionHint(hint: StreamingMotionHint | null): void {
    this.motionHint = hint;
  }

  setAdaptiveBudget(budget: AdaptiveStreamingBudget): void {
    this.budget = budget;
  }


  update(camera: THREE.Camera, mode: ExploreMode): void {
    const range = streamingRange(mode, this.radius);
    const baseDistance = range.base * this.budget.baseScale;
    const detailDistance = range.detail * this.budget.detailScale;
    const prefetchedTiles = mode === "drive" ? this.selectDrivePrefetchTiles() : new Set<string>();
    const active = new Set<string>();
    for (const entry of this.objects) {
      const distance = entry.detail ? detailDistance : baseDistance;
      const normalVisible = tileIsVisible(
        entry.tile,
        camera.position.x,
        camera.position.z,
        distance,
      );
      const visible = normalVisible || (!entry.detail && prefetchedTiles.has(entry.tile.id));
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

  private selectDrivePrefetchTiles(): Set<string> {
    const hint = this.motionHint;
    if (!hint || hint.speedMetersPerSecond < 1.5) return new Set<string>();

    const directionLength = Math.hypot(hint.directionX, hint.directionZ);
    if (directionLength < 0.001) return new Set<string>();
    const nx = hint.directionX / directionLength;
    const nz = hint.directionZ / directionLength;
    const lookAhead = Math.min(720, 320 + hint.speedMetersPerSecond * 10) * this.budget.prefetchScale;
    if (lookAhead < 220) return new Set<string>();

    return new Set(
      [...this.tiles.values()]
        .map((tile) => {
          const offsetX = tile.centerX - hint.x;
          const offsetZ = tile.centerZ - hint.z;
          return {
            id: tile.id,
            tile,
            forward: offsetX * nx + offsetZ * nz,
            lateral: Math.abs(offsetX * nz - offsetZ * nx),
          };
        })
        .filter(({ tile, forward, lateral }) => {
          const padding = tile.size * Math.SQRT2 / 2;
          return forward > 80
            && forward <= lookAhead + padding
            && lateral <= tile.size * 0.75;
        })
        .sort((first, second) =>
          first.forward - second.forward
          || first.lateral - second.lateral
          || first.tile.z - second.tile.z
          || first.tile.x - second.tile.x)
        .slice(0, 2)
        .map(({ id }) => id),
    );
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
