import * as THREE from "three";
import type { CollisionIndex } from "../generation/collision";
import { findNearestRoadPoint } from "../generation/road-graph";
import type { DriveSpawn, RoadGraph, RoadGraphEdge } from "../types";
import { stepDrivePhysics, type DrivePhysicsState } from "./drive-physics";

export type DriveButton = "left" | "right" | "throttle" | "brake";

export interface DriveTelemetry {
  speedKph: number;
  roadName: string;
  offRoad: boolean;
  distanceFromRoad: number;
}

interface RoadMatch {
  edge: RoadGraphEdge;
  x: number;
  y: number;
  z: number;
  distance: number;
}

export class DriveController {
  private readonly vehicle = createVehicle();
  private readonly keys = new Set<string>();
  private readonly touchButtons = new Set<DriveButton>();
  private readonly cameraTarget = new THREE.Vector3();
  private graph: RoadGraph | null = null;
  private roadIndex: RoadSpatialIndex | null = null;
  private collision: CollisionIndex | null = null;
  private groundHeightAt: (x: number, z: number) => number = () => 0;
  private spawn: DriveSpawn | null = null;
  private active = false;
  private accumulator = 0;
  private state: DrivePhysicsState = { x: 0, z: 0, heading: 0, speed: 0, steering: 0 };
  private telemetryListener?: (telemetry: DriveTelemetry) => void;
  private telemetryElapsed = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.vehicle.visible = false;
    this.scene.add(this.vehicle);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  setWorld(
    graph: RoadGraph,
    collision: CollisionIndex,
    groundHeightAt: (x: number, z: number) => number,
    preferredSpawn?: DriveSpawn | null,
  ): void {
    this.graph = graph;
    this.roadIndex = new RoadSpatialIndex(graph);
    this.collision = collision;
    this.groundHeightAt = groundHeightAt;
    this.spawn = preferredSpawn ?? findNearestRoadPoint(graph);
    this.reset();
  }

  setSpawn(spawn: DriveSpawn | null): void {
    if (!spawn) return;
    this.spawn = spawn;
    this.reset();
  }

  setActive(active: boolean): void {
    this.active = active && Boolean(this.graph && this.spawn);
    this.vehicle.visible = this.active;
    this.touchButtons.clear();
    this.accumulator = 0;
    if (this.active) {
      this.reset();
      this.updateVisuals(1);
    }
  }

  isAvailable(): boolean {
    return Boolean(this.graph && this.graph.edges.length > 0 && this.spawn);
  }

  setButton(button: DriveButton, pressed: boolean): void {
    if (pressed) this.touchButtons.add(button);
    else this.touchButtons.delete(button);
  }

  onTelemetry(listener: (telemetry: DriveTelemetry) => void): void {
    this.telemetryListener = listener;
  }

  reset(): void {
    if (!this.spawn) return;
    this.state = {
      x: this.spawn.position.x,
      z: this.spawn.position.z,
      heading: this.spawn.headingRadians,
      speed: 0,
      steering: 0,
    };
    this.accumulator = 0;
    this.updateVisuals(1);
  }

  update(delta: number): void {
    if (!this.active) return;
    this.accumulator = Math.min(this.accumulator + delta, 0.1);
    while (this.accumulator >= 1 / 60) {
      this.fixedUpdate(1 / 60);
      this.accumulator -= 1 / 60;
    }
    this.updateVisuals(delta);
    this.telemetryElapsed += delta;
    if (this.telemetryElapsed >= 0.1) {
      this.telemetryElapsed = 0;
      this.publishTelemetry();
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.scene.remove(this.vehicle);
    this.vehicle.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }

  private fixedUpdate(delta: number): void {
    const throttle = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp") || this.touchButtons.has("throttle"))
      - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    const steering = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight") || this.touchButtons.has("right"))
      - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft") || this.touchButtons.has("left"));
    const brake = this.keys.has("Space") || this.touchButtons.has("brake");
    const previous = this.state;
    const candidate = stepDrivePhysics(previous, { throttle, steering, brake }, delta);
    const road = this.roadIndex?.nearest(candidate.x, candidate.z) ?? null;

    if (road) {
      const shoulder = road.edge.widthMeters * 0.62 + 1.4;
      const excess = Math.max(0, road.distance - shoulder);
      if (excess > 0) {
        candidate.speed *= Math.max(0.86, 1 - delta * (2.2 + excess * 0.08));
        const assist = Math.min(0.085, delta * (0.35 + excess * 0.055));
        candidate.x += (road.x - candidate.x) * assist;
        candidate.z += (road.z - candidate.z) * assist;
      }
    }

    if (this.collision?.canOccupy({ x: candidate.x, z: candidate.z }, 1.45) ?? true) {
      this.state = candidate;
    } else {
      this.state = { ...previous, speed: Math.min(0, -Math.abs(previous.speed) * 0.14), steering: candidate.steering };
    }
  }

  private updateVisuals(delta: number): void {
    const ground = this.groundHeightAt(this.state.x, this.state.z);
    this.vehicle.position.set(this.state.x, ground + 0.62, this.state.z);
    this.vehicle.rotation.y = this.state.heading;
    const wheels = this.vehicle.userData["wheels"] as THREE.Mesh[] | undefined;
    for (const wheel of wheels ?? []) wheel.rotation.x -= this.state.speed * delta * 1.7;

    if (!this.active) return;
    const forward = new THREE.Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
    const speedLift = Math.min(2.3, Math.abs(this.state.speed) * 0.065);
    const desired = new THREE.Vector3(this.state.x, ground + 6.1 + speedLift, this.state.z)
      .addScaledVector(forward, -11.5 - Math.abs(this.state.speed) * 0.075);
    const target = new THREE.Vector3(this.state.x, ground + 1.35, this.state.z).addScaledVector(forward, 5.5);
    const cameraAmount = 1 - Math.exp(-Math.max(delta, 1 / 120) * 6.4);
    const targetAmount = 1 - Math.exp(-Math.max(delta, 1 / 120) * 8.5);
    this.camera.position.lerp(desired, cameraAmount);
    this.cameraTarget.lerp(target, targetAmount);
    this.camera.lookAt(this.cameraTarget);
  }

  private publishTelemetry(): void {
    if (!this.telemetryListener) return;
    const road = this.roadIndex?.nearest(this.state.x, this.state.z) ?? null;
    const shoulder = road ? road.edge.widthMeters * 0.62 + 1.4 : 0;
    this.telemetryListener({
      speedKph: Math.round(Math.abs(this.state.speed) * 3.6),
      roadName: road?.edge.name ?? road?.edge.class.replaceAll("_", " ") ?? "No drivable road",
      offRoad: !road || road.distance > shoulder,
      distanceFromRoad: road?.distance ?? Number.POSITIVE_INFINITY,
    });
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
      this.keys.add(event.code);
      if (this.active) event.preventDefault();
    }
    if (this.active && event.code === "KeyR") {
      event.preventDefault();
      this.reset();
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.touchButtons.clear();
  };
}

class RoadSpatialIndex {
  private readonly cells = new Map<string, Set<RoadGraphEdge>>();
  private readonly cellSize = 72;

  constructor(private readonly graph: RoadGraph) {
    for (const edge of graph.edges) {
      for (let index = 1; index < edge.path.length; index += 1) {
        const first = edge.path[index - 1]!;
        const second = edge.path[index]!;
        const minX = Math.min(first.x, second.x);
        const maxX = Math.max(first.x, second.x);
        const minZ = Math.min(first.z, second.z);
        const maxZ = Math.max(first.z, second.z);
        for (let x = this.cell(minX); x <= this.cell(maxX); x += 1) {
          for (let z = this.cell(minZ); z <= this.cell(maxZ); z += 1) {
            const key = `${x}:${z}`;
            const bucket = this.cells.get(key) ?? new Set<RoadGraphEdge>();
            bucket.add(edge);
            this.cells.set(key, bucket);
          }
        }
      }
    }
  }

  nearest(x: number, z: number): RoadMatch | null {
    const candidates = new Set<RoadGraphEdge>();
    const cellX = this.cell(x);
    const cellZ = this.cell(z);
    for (let radius = 0; radius <= 2 && candidates.size === 0; radius += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        for (let offsetZ = -radius; offsetZ <= radius; offsetZ += 1) {
          for (const edge of this.cells.get(`${cellX + offsetX}:${cellZ + offsetZ}`) ?? []) candidates.add(edge);
        }
      }
    }
    const searchable = candidates.size > 0 ? candidates : new Set(this.graph.edges);
    let nearest: RoadMatch | null = null;
    for (const edge of searchable) {
      for (let index = 1; index < edge.path.length; index += 1) {
        const start = edge.path[index - 1]!;
        const end = edge.path[index]!;
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthSquared = dx * dx + dz * dz;
        const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared));
        const projectedX = start.x + dx * amount;
        const projectedZ = start.z + dz * amount;
        const distance = Math.hypot(x - projectedX, z - projectedZ);
        if (nearest && distance >= nearest.distance) continue;
        nearest = {
          edge,
          x: projectedX,
          y: start.y + (end.y - start.y) * amount,
          z: projectedZ,
          distance,
        };
      }
    }
    return nearest;
  }

  private cell(value: number): number {
    return Math.floor(value / this.cellSize);
  }
}

function createVehicle(): THREE.Group {
  const root = new THREE.Group();
  root.name = "WorldSeed Drive Vehicle";
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xb8f34b, roughness: 0.58, metalness: 0.08, flatShading: true });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x151b18, roughness: 0.46, metalness: 0.18, flatShading: true });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x9edbe4, roughness: 0.25, metalness: 0.2, flatShading: true });
  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xf4ffbd });
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.72, 5.5), bodyMaterial);
  body.position.y = 0.72;
  body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.9, 2.45), glassMaterial);
  cabin.position.set(0, 1.42, -0.25);
  cabin.castShadow = true;
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 0.35), darkMaterial);
  bumper.position.set(0, 0.58, -2.75);
  const lights = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.22, 0.08), lightMaterial);
  lights.position.set(0, 0.82, 2.78);
  root.add(body, cabin, bumper, lights);

  const wheels: THREE.Mesh[] = [];
  for (const x of [-1.62, 1.62]) {
    for (const z of [-1.78, 1.78]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.38, 12), darkMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.48, z);
      wheel.castShadow = true;
      wheels.push(wheel);
      root.add(wheel);
    }
  }
  root.userData["wheels"] = wheels;
  return root;
}
