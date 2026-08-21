import * as THREE from "three";

export interface DroneCameraPose {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  roll: number;
  fov: number;
}

export function droneCameraPose(elapsedSeconds: number, radius: number): DroneCameraPose {
  const safeRadius = Math.max(100, radius);
  const swoop = 0.5 + 0.5 * Math.sin(elapsedSeconds * 0.17 - 0.8);
  const banking = 0.5 + 0.5 * Math.sin(elapsedSeconds * 0.29 + 1.1);
  const angle = elapsedSeconds * (0.2 + banking * 0.08) + Math.sin(elapsedSeconds * 0.115) * 0.72;
  const minDistance = Math.max(170, safeRadius * 0.34);
  const maxDistance = Math.max(260, safeRadius * 1.25);
  const distance = clamp(
    safeRadius * (0.5 + swoop * 0.6) + safeRadius * 0.05 * Math.sin(elapsedSeconds * 0.33),
    minDistance,
    maxDistance,
  );
  const minHeight = Math.max(90, safeRadius * 0.16);
  const maxHeight = Math.max(150, safeRadius * 0.9);
  const height = clamp(
    safeRadius * (0.18 + swoop * 0.64) + safeRadius * 0.04 * Math.sin(elapsedSeconds * 0.39 + 1.2),
    minHeight,
    maxHeight,
  );
  const targetX = safeRadius * (0.14 * Math.sin(elapsedSeconds * 0.12) + 0.05 * Math.sin(elapsedSeconds * 0.29 + 0.6));
  const targetZ = safeRadius * 0.1 * Math.cos(elapsedSeconds * 0.15 + 0.4);
  return {
    x: targetX + Math.cos(angle) * distance,
    y: height,
    z: targetZ + Math.sin(angle) * distance,
    targetX,
    targetY: clamp(safeRadius * (0.035 + (1 - swoop) * 0.06) + 9 * Math.sin(elapsedSeconds * 0.22), 8, 42),
    targetZ,
    roll: 0.035 * Math.sin(elapsedSeconds * 0.25) + 0.018 * Math.sin(elapsedSeconds * 0.47 + 0.4),
    fov: 52 + banking * 6 + (1 - swoop) * 3,
  };
}

export class DroneCameraController {
  private active = false;
  private elapsedSeconds = 0;
  private radius = 500;
  private readonly target = new THREE.Vector3(0, 28, 0);
  private readonly defaultFov: number;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.defaultFov = camera.fov;
  }

  setWorld(radius: number): void {
    this.radius = radius;
    this.target.y = droneCameraPose(0, radius).targetY;
    if (this.active) this.applyPose();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.elapsedSeconds = 0;
      this.camera.rotation.z = 0;
      this.camera.fov = this.defaultFov;
      this.camera.updateProjectionMatrix();
      return;
    }
    this.elapsedSeconds = 0;
    this.applyPose();
  }

  update(delta: number): void {
    if (!this.active) return;
    this.elapsedSeconds += Math.min(delta, 0.05);
    this.applyPose();
  }

  private applyPose(): void {
    const pose = droneCameraPose(this.elapsedSeconds, this.radius);
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.target.set(pose.targetX, pose.targetY, pose.targetZ);
    this.camera.lookAt(this.target);
    this.camera.rotateZ(pose.roll);
    if (Math.abs(this.camera.fov - pose.fov) > 0.01) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
