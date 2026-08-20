import * as THREE from "three";
import type { ExploreMode } from "../types";
import { streamingRange, tileIsVisible, type WorldTile } from "../generation/tiling";

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
      const visible = tileIsVisible(
        entry.tile,
        camera.position.x,
        camera.position.z,
        entry.detail ? range.detail : range.base,
      );
      entry.object.visible = visible;
      if (visible) active.add(entry.tile.id);
    }
    const signature = [...active].sort().join("|");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.listener?.({ activeTiles: active.size, totalTiles: this.tiles.size });
  }
}
