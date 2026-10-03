import * as THREE from "three";
import type { ExploreMode } from "../types";
import { streamingRange, tileIsVisible, type WorldTile } from "../generation/tiling";
import {
  combineStreamingGpuUploadHints,
  estimateStreamingGpuUploadExcessMs,
  initialStreamingFrameBaselineState,
  initialStreamingGpuCostModelState,
  initialStreamingGpuUploadLearningState,
  recordStreamingGpuUploadCost,
  streamingGpuPredictedDelayFrames,
  streamingGpuUploadDelayFrames,
  streamingGpuUploadExcessMs,
  updateStreamingFrameBaselineState,
  updateStreamingGpuUploadLearningState,
  type AdaptiveStreamingBudget,
  type StreamingGpuUploadHints,
} from "./adaptive-streaming";

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
  private readonly baseUploadHints = new Map<string, StreamingGpuUploadHints>();
  private readonly baseActivationFrame = new Map<string, number>();
  private readonly activatedBaseTiles = new Set<string>();
  private frameIndex = 0;
  private uploadFeedbackPending = false;
  private uploadFeedbackHints: StreamingGpuUploadHints = {};
  private frameBaseline = initialStreamingFrameBaselineState();
  private gpuCostModel = initialStreamingGpuCostModelState();
  private gpuUploadLearning = initialStreamingGpuUploadLearningState();
  private motionHint: StreamingMotionHint | null = null;
  private optionalWorkAllowed = true;
  private readonly activatedDetail = new WeakSet<THREE.Object3D>();
  private budget: AdaptiveStreamingBudget = {
    tier: "quality",
    baseScale: 1,
    detailScale: 1,
    prefetchScale: 1,
    maxConcurrentLoads: 2,
    maxConcurrentPrefetches: 1,
    maxCacheRecords: 72,
    maxCacheBytes: 128 * 1024 * 1024,
    dprCap: 1.8,
  };
  private lastSignature = "";
  private listener?: (stats: StreamingStats) => void;

  constructor(root: THREE.Object3D, private readonly radius: number) {
    const uploadStats = new Map<string, {
      geometries: Set<string>;
      materials: Set<string>;
      vertexCount: number;
      geometryByteLength: number;
    }>();

    root.traverse((object) => {
      const tile = object.userData["worldseedTile"] as WorldTile | undefined;
      if (!tile) return;
      const detail = object.userData["worldseedDetail"] === true;
      this.objects.push({ object, tile, detail });
      this.tiles.set(tile.id, tile);

      if (detail) return;
      const stats = uploadStats.get(tile.id) ?? {
        geometries: new Set<string>(),
        materials: new Set<string>(),
        vertexCount: 0,
        geometryByteLength: 0,
      };
      const renderable = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      const geometry = renderable.geometry;
      if (geometry?.isBufferGeometry && !stats.geometries.has(geometry.uuid)) {
        stats.geometries.add(geometry.uuid);
        const position = geometry.getAttribute("position");
        if (position) stats.vertexCount += position.count;
        for (const attribute of Object.values(geometry.attributes)) {
          if (attribute?.array?.byteLength) stats.geometryByteLength += attribute.array.byteLength;
        }
        const index = geometry.getIndex();
        if (index?.array?.byteLength) stats.geometryByteLength += index.array.byteLength;
      }
      const material = renderable.material;
      if (Array.isArray(material)) {
        for (const item of material) if (item?.uuid) stats.materials.add(item.uuid);
      } else if (material?.uuid) {
        stats.materials.add(material.uuid);
      }
      uploadStats.set(tile.id, stats);
    });

    for (const [tileId, stats] of uploadStats) {
      this.baseUploadHints.set(tileId, {
        vertexCount: stats.vertexCount,
        geometryByteLength: stats.geometryByteLength,
        materialCount: stats.materials.size,
      });
    }
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

  setOptionalWorkAllowed(allowed: boolean): void {
    this.optionalWorkAllowed = allowed;
  }

  observeFrameTime(frameTimeMs: number): void {
    if (!this.uploadFeedbackPending) {
      this.frameBaseline = updateStreamingFrameBaselineState(this.frameBaseline, frameTimeMs);
      return;
    }
    const uploadExcessMs = streamingGpuUploadExcessMs(this.frameBaseline, frameTimeMs);
    this.gpuCostModel = recordStreamingGpuUploadCost(
      this.gpuCostModel,
      this.uploadFeedbackHints,
      uploadExcessMs,
    );
    this.gpuUploadLearning = updateStreamingGpuUploadLearningState(
      this.gpuUploadLearning,
      uploadExcessMs,
    );
    this.uploadFeedbackPending = false;
    this.uploadFeedbackHints = {};
  }


  update(camera: THREE.Camera, mode: ExploreMode): void {
    this.frameIndex += 1;
    let heavyBaseActivatedThisFrame = false;
    const range = streamingRange(mode, this.radius);
    const baseDistance = range.base * this.budget.baseScale;
    const detailDistance = range.detail * this.budget.detailScale;
    const prefetchedTiles = mode === "drive" && this.optionalWorkAllowed
      ? this.selectDrivePrefetchTiles()
      : new Set<string>();
    const active = new Set<string>();
    for (const entry of this.objects) {
      const distance = entry.detail ? detailDistance : baseDistance;
      const normalVisible = tileIsVisible(
        entry.tile,
        camera.position.x,
        camera.position.z,
        distance,
      );
      const requestedBaseVisible = !entry.detail
        && (normalVisible || prefetchedTiles.has(entry.tile.id));
      const detailVisible = entry.detail
        ? normalVisible && (this.optionalWorkAllowed || this.activatedDetail.has(entry.object))
        : false;

      let baseVisible = false;
      if (requestedBaseVisible) {
        if (this.activatedBaseTiles.has(entry.tile.id)) {
          baseVisible = true;
        } else {
          const uploadHints = this.baseUploadHints.get(entry.tile.id) ?? {};
          const thresholdDelay = streamingGpuUploadDelayFrames(
            uploadHints,
            this.gpuUploadLearning.thresholdScale,
          );
          const predictedDelay = this.gpuCostModel.samples >= 2
            ? streamingGpuPredictedDelayFrames(
              estimateStreamingGpuUploadExcessMs(this.gpuCostModel, uploadHints),
            )
            : 0;
          const delayFrames = Math.max(thresholdDelay, predictedDelay);
          if (delayFrames <= 0) {
            this.activatedBaseTiles.add(entry.tile.id);
            this.queueUploadFeedback(uploadHints);
            baseVisible = true;
          } else {
            const activationFrame = this.baseActivationFrame.get(entry.tile.id)
              ?? this.frameIndex + delayFrames;
            this.baseActivationFrame.set(entry.tile.id, activationFrame);
            if (this.frameIndex >= activationFrame && !heavyBaseActivatedThisFrame) {
              this.activatedBaseTiles.add(entry.tile.id);
              this.baseActivationFrame.delete(entry.tile.id);
              heavyBaseActivatedThisFrame = true;
              this.queueUploadFeedback(uploadHints);
              baseVisible = true;
            }
          }
        }
      } else if (!entry.detail && !this.activatedBaseTiles.has(entry.tile.id)) {
        this.baseActivationFrame.delete(entry.tile.id);
      }

      const visible = entry.detail ? detailVisible : baseVisible;
      entry.object.visible = visible;
      if (visible) {
        active.add(entry.tile.id);
        if (entry.detail) this.activatedDetail.add(entry.object);
        this.gpuReleased.delete(entry.object);
        continue;
      }
      if (entry.detail && !normalVisible) this.activatedDetail.delete(entry.object);

      const safelyDistant = !tileIsVisible(
        entry.tile,
        camera.position.x,
        camera.position.z,
        distance + GPU_RELEASE_MARGIN_METERS,
      );
      if (safelyDistant && !this.gpuReleased.has(entry.object)) {
        releaseObjectGpuResources(entry.object);
        this.gpuReleased.add(entry.object);
        if (!entry.detail) {
          this.activatedBaseTiles.delete(entry.tile.id);
          this.baseActivationFrame.delete(entry.tile.id);
        }
      }
    }
    const signature = [...active].sort().join("|");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.listener?.({ activeTiles: active.size, totalTiles: this.tiles.size });
  }

  private queueUploadFeedback(hints: StreamingGpuUploadHints): void {
    this.uploadFeedbackHints = this.uploadFeedbackPending
      ? combineStreamingGpuUploadHints(this.uploadFeedbackHints, hints)
      : hints;
    this.uploadFeedbackPending = true;
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
