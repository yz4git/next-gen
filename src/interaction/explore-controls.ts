import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ExploreMode } from "../types";
import { CollisionIndex } from "../generation/collision";

export class ExploreControls {
  private mode: ExploreMode = "orbit";
  private collision: CollisionIndex | null = null;
  private groundHeightAt: (x: number, z: number) => number = () => 0;
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private mobileMove = new THREE.Vector2();
  private mobileLook = new THREE.Vector2();
  private spawn = new THREE.Vector3(0, 1.72, 0);

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly orbit: OrbitControls,
    private readonly canvas: HTMLCanvasElement,
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("click", this.onCanvasClick);
  }

  setCollision(
    collision: CollisionIndex,
    groundHeightAt: (x: number, z: number) => number = () => 0,
  ): void {
    this.collision = collision;
    this.groundHeightAt = groundHeightAt;
    const spawn = collision.findOpenSpawn();
    this.spawn.set(spawn.x, this.groundHeightAt(spawn.x, spawn.z) + 1.72, spawn.z);
  }

  setMode(mode: ExploreMode): void {
    this.mode = mode;
    this.orbit.enabled = mode === "orbit";
    if (mode === "orbit") {
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      return;
    }
    if (mode === "walk") {
      this.camera.position.copy(this.spawn);
      this.pitch = 0;
      this.yaw = 0;
    } else if (this.camera.position.y < 10) {
      this.camera.position.set(this.spawn.x, 55, this.spawn.z + 50);
      const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
      this.pitch = euler.x;
      this.yaw = euler.y;
    } else {
      const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
      this.pitch = euler.x;
      this.yaw = euler.y;
    }
    this.applyLook();
  }

  getMode(): ExploreMode {
    return this.mode;
  }

  setMobileMove(x: number, y: number): void {
    this.mobileMove.set(x, y);
  }

  setMobileLook(x: number, y: number): void {
    this.mobileLook.set(x, y);
  }

  reset(): void {
    if (this.mode === "orbit") return;
    this.camera.position.copy(this.spawn);
    this.pitch = 0;
    this.yaw = 0;
    this.applyLook();
  }

  update(delta: number): void {
    if (this.mode === "orbit") return;
    const lookSpeed = 1.65;
    this.yaw -= this.mobileLook.x * delta * lookSpeed;
    this.pitch -= this.mobileLook.y * delta * lookSpeed;
    this.mobileLook.multiplyScalar(0.86);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI * 0.47, Math.PI * 0.47);
    this.applyLook();

    const inputX = axis(this.keys, "KeyD", "KeyA") + this.mobileMove.x;
    const inputZ = axis(this.keys, "KeyS", "KeyW") + this.mobileMove.y;
    const inputY = this.mode === "fly"
      ? axis(this.keys, "KeyE", "KeyQ") + axis(this.keys, "Space", "ControlLeft")
      : 0;
    const movement = new THREE.Vector3(inputX, inputY, inputZ);
    if (movement.lengthSq() === 0) return;
    movement.normalize();

    const sprinting = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const speed = (this.mode === "fly" ? 48 : 8.5) * (sprinting ? 2.35 : 1);
    movement.applyQuaternion(this.camera.quaternion);
    if (this.mode === "walk") {
      movement.y = 0;
      movement.normalize();
    }
    movement.multiplyScalar(speed * delta);
    const candidate = this.camera.position.clone().add(movement);

    if (this.mode === "walk") {
      candidate.y = this.groundHeightAt(candidate.x, candidate.z) + 1.72;
      if (this.collision?.canOccupy({ x: candidate.x, z: candidate.z }, 0.72) ?? true) {
        this.camera.position.copy(candidate);
      } else {
        const slideX = { x: candidate.x, z: this.camera.position.z };
        const slideZ = { x: this.camera.position.x, z: candidate.z };
        if (this.collision?.canOccupy(slideX, 0.72)) this.camera.position.x = candidate.x;
        if (this.collision?.canOccupy(slideZ, 0.72)) this.camera.position.z = candidate.z;
      }
    } else {
      const minimumHeight = this.groundHeightAt(candidate.x, candidate.z) + 1.5;
      candidate.y = THREE.MathUtils.clamp(candidate.y, minimumHeight, 900);
      this.camera.position.copy(candidate);
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("click", this.onCanvasClick);
  }

  private applyLook(): void {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    this.keys.add(event.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas || this.mode === "orbit") return;
    this.yaw -= event.movementX * 0.0022;
    this.pitch -= event.movementY * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI * 0.47, Math.PI * 0.47);
    this.applyLook();
  };

  private onCanvasClick = (): void => {
    if (this.mode !== "orbit" && document.pointerLockElement !== this.canvas) {
      void this.canvas.requestPointerLock();
    }
  };
}

function axis(keys: Set<string>, positive: string, negative: string): number {
  return Number(keys.has(positive)) - Number(keys.has(negative));
}
