import * as THREE from "three";

export interface DroneCameraPose {
  x: number;
  y: number;
  z: number;
  targetY: number;
}

export function droneCameraPose(elapsedSeconds: number, radius: number): DroneCameraPose {
  const safeRadius = Math.max(100, radius);
  const angle = elapsedSeconds * 0.16;
  const distance = Math.max(170, safeRadius * (1.02 + Math.sin(elapsedSeconds * 0.11) * 0.1));
  return {
    x: Math.cos(angle) * distance,
    y: Math.max(90, safeRadius * (0.56 + Math.sin(elapsedSeconds * 0.13) * 0.08)),
    z: Math.sin(angle) * distance,
    targetY: Math.min(35, safeRadius * 0.08),
  };
}

export class DroneCameraController {
  private active = false;
  private elapsedSeconds = 0;
  private radius = 500;
  private readonly target = new THREE.Vector3(0, 28, 0);

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  setWorld(radius: number): void {
    this.radius = radius;
    this.target.y = droneCameraPose(0, radius).targetY;
    if (this.active) this.applyPose();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) return;
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
    this.target.y = pose.targetY;
    this.camera.lookAt(this.target);
  }
}
