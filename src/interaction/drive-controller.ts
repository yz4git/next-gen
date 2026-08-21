import * as THREE from "three";
import type { CollisionIndex } from "../generation/collision";
import { driveSpawnForRoute, findNearestRoadPoint } from "../generation/road-graph";
import type { DriveRoute, DriveSpawn, RoadGraph, RoadGraphEdge } from "../types";
import { resolveDriveCameraPose, safeDriveCameraHeight } from "./drive-camera";
import { stepDrivePhysics, type DrivePhysicsState } from "./drive-physics";
import { blendRoadAssist, resolveRoadGuidance, type RoadGuidance } from "./road-guidance";
import { DriveVisualAudit } from "./drive-visual-audit";
import { resolveVehicleGroundPose, smoothVehicleTilt } from "./vehicle-pose";

export type DriveButton = "left" | "right" | "throttle" | "brake";

export interface DriveTelemetry {
  speedKph: number;
  roadName: string;
  offRoad: boolean;
  distanceFromRoad: number;
}

export interface DriveChallengeTelemetry {
  status: "ready" | "running" | "finished";
  elapsedSeconds: number;
  bestSeconds: number | null;
  checkpoint: number;
  checkpointCount: number;
  routeLengthMeters: number;
}

/**
 * Map the driver's left/right intent to the vehicle's visual turn direction.
 * The vehicle's forward axis is +Z and the requested control direction is
 * right-minus-left, so dragging the pad left turns the car left on screen.
 */
export function getDriveSteeringInput(keys: ReadonlySet<string>, touchButtons: ReadonlySet<DriveButton>): number {
  const left = keys.has("KeyA") || keys.has("ArrowLeft") || touchButtons.has("left");
  const right = keys.has("KeyD") || keys.has("ArrowRight") || touchButtons.has("right");
  return Number(right) - Number(left);
}

export function clearDriveBestTimes(): number {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith("worldseed-drive-best:")));
    keys.forEach((key) => localStorage.removeItem(key));
    return keys.length;
  } catch {
    return 0;
  }
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
  private readonly routeGroup = new THREE.Group();
  private readonly keys = new Set<string>();
  private readonly touchButtons = new Set<DriveButton>();
  private readonly visualAudit: DriveVisualAudit;
  private steeringInput = 0;
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
  private challengeListener?: (telemetry: DriveChallengeTelemetry) => void;
  private telemetryElapsed = 0;
  private route: DriveRoute | null = null;
  private challengeStatus: DriveChallengeTelemetry["status"] = "ready";
  private challengeElapsed = 0;
  private nextCheckpoint = 1;
  private bestSeconds: number | null = null;
  private visualPitch = 0;
  private visualRoll = 0;
  private lastGuidance: RoadGuidance | null = null;
  private lastAssistSteering = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.vehicle.visible = false;
    this.routeGroup.name = "WorldSeed Drive Route";
    this.routeGroup.visible = false;
    this.scene.add(this.vehicle, this.routeGroup);
    this.visualAudit = new DriveVisualAudit(scene);
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
    this.setRoute(null);
    this.reset();
  }

  setRoute(route: DriveRoute | null): void {
    disposeGroup(this.routeGroup);
    this.route = route;
    if (route) {
      this.routeGroup.add(createRouteVisual(route));
      this.spawn = driveSpawnForRoute(route) ?? this.spawn;
      this.bestSeconds = readBestTime(route.id);
    } else {
      this.bestSeconds = null;
    }
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
    this.routeGroup.visible = this.active && Boolean(this.route);
    this.visualAudit.setDriveActive(this.active);
    this.touchButtons.clear();
    this.steeringInput = 0;
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

  setSteering(value: number): void {
    this.steeringInput = Math.max(-1, Math.min(1, value));
  }

  onTelemetry(listener: (telemetry: DriveTelemetry) => void): void {
    this.telemetryListener = listener;
  }

  onChallenge(listener: (telemetry: DriveChallengeTelemetry) => void): void {
    this.challengeListener = listener;
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
    this.visualPitch = 0;
    this.visualRoll = 0;
    this.lastGuidance = null;
    this.lastAssistSteering = 0;
    this.challengeStatus = "ready";
    this.challengeElapsed = 0;
    this.nextCheckpoint = Math.min(1, Math.max(0, (this.route?.checkpoints.length ?? 1) - 1));
    this.updateChallengeVisuals();
    this.publishChallenge();
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
      if (this.challengeStatus === "running") this.publishChallenge();
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.scene.remove(this.vehicle);
    this.scene.remove(this.routeGroup);
    this.visualAudit.dispose();
    disposeGroup(this.routeGroup);
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
    const manualSteering = Math.max(-1, Math.min(1, getDriveSteeringInput(this.keys, this.touchButtons) + this.steeringInput));
    const brake = this.keys.has("Space") || this.touchButtons.has("brake");
    const previous = this.state;
    const roadBefore = this.roadIndex?.nearest(previous.x, previous.z) ?? null;
    let steering = manualSteering;
    this.lastGuidance = null;
    this.lastAssistSteering = 0;
    if (roadBefore && this.graph) {
      const guidance = resolveRoadGuidance(this.graph, roadBefore, previous);
      const shoulder = roadBefore.edge.widthMeters * 0.62 + 1.4;
      const offRoadAmount = Math.max(0, Math.min(1, (roadBefore.distance - roadBefore.edge.widthMeters * 0.38) / Math.max(2, shoulder)));
      steering = blendRoadAssist(manualSteering, guidance, offRoadAmount);
      this.lastGuidance = guidance;
      this.lastAssistSteering = steering - manualSteering;
    }

    const candidate = stepDrivePhysics(previous, { throttle, steering, brake }, delta);
    const road = this.roadIndex?.nearest(candidate.x, candidate.z) ?? null;

    if (this.lastGuidance && !brake) {
      const speedKph = Math.abs(candidate.speed) * 3.6;
      const target = this.lastGuidance.recommendedSpeedKph;
      if (speedKph > target * 1.12) {
        const overspeed = Math.min(1, (speedKph - target) / Math.max(12, target));
        candidate.speed *= Math.max(0.965, 1 - delta * (0.4 + this.lastGuidance.cornerSeverity * 1.15) * overspeed);
      }
    }

    if (road) {
      const shoulder = road.edge.widthMeters * 0.62 + 1.4;
      const excess = Math.max(0, road.distance - shoulder);
      if (excess > 0) {
        candidate.speed *= Math.max(0.86, 1 - delta * (2.2 + excess * 0.08));
        const assist = Math.min(0.065, delta * (0.28 + excess * 0.045));
        candidate.x += (road.x - candidate.x) * assist;
        candidate.z += (road.z - candidate.z) * assist;
      }
    }

    if (this.collision?.canOccupy({ x: candidate.x, z: candidate.z }, 1.45) ?? true) {
      this.state = candidate;
    } else {
      this.state = { ...previous, speed: Math.min(0, -Math.abs(previous.speed) * 0.14), steering: candidate.steering };
    }
    this.updateChallenge(delta);
  }

  private updateVisuals(delta: number): void {
    const groundPose = resolveVehicleGroundPose(this.state, this.groundHeightAt);
    this.visualPitch = smoothVehicleTilt(this.visualPitch, groundPose.pitch, delta, 7.2);
    this.visualRoll = smoothVehicleTilt(this.visualRoll, groundPose.roll, delta, 8.4);
    this.vehicle.position.set(this.state.x, groundPose.groundY + 0.62, this.state.z);
    this.vehicle.rotation.set(-this.visualPitch, this.state.heading, this.visualRoll, "YXZ");
    const wheels = this.vehicle.userData["wheels"] as THREE.Mesh[] | undefined;
    for (const wheel of wheels ?? []) wheel.rotation.x -= this.state.speed * delta * 1.7;

    if (!this.active) return;
    const pose = resolveDriveCameraPose(this.state, this.groundHeightAt);
    const desired = new THREE.Vector3(pose.desired.x, pose.desired.y, pose.desired.z);
    const target = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z);
    const cameraAmount = 1 - Math.exp(-Math.max(delta, 1 / 120) * 6.4);
    const targetAmount = 1 - Math.exp(-Math.max(delta, 1 / 120) * 8.5);
    this.camera.position.lerp(desired, cameraAmount);
    this.cameraTarget.lerp(target, targetAmount);
    this.camera.position.y = safeDriveCameraHeight(
      this.camera.position.x,
      this.camera.position.z,
      this.camera.position.y,
      this.groundHeightAt,
      2.2,
    );
    this.cameraTarget.y = safeDriveCameraHeight(
      this.cameraTarget.x,
      this.cameraTarget.z,
      this.cameraTarget.y,
      this.groundHeightAt,
      1.1,
    );
    this.camera.lookAt(this.cameraTarget);

    const road = this.roadIndex?.nearest(this.state.x, this.state.z) ?? null;
    const terrain = this.scene.getObjectByName("Terrain");
    const nearTerrain = this.scene.getObjectByName("WorldSeed Drive Terrain Detail");
    const guidance = this.lastGuidance;
    this.visualAudit.update({
      vehicle: { x: this.state.x, y: groundPose.groundY, z: this.state.z },
      road: road ? { x: road.x, y: road.y, z: road.z, distance: road.distance, width: road.edge.widthMeters } : undefined,
      guidance: guidance ? {
        targetX: guidance.targetX,
        targetZ: guidance.targetZ,
        targetY: this.groundHeightAt(guidance.targetX, guidance.targetZ),
        headingError: guidance.headingError,
        lateralError: guidance.lateralError,
        assist: this.lastAssistSteering,
      } : undefined,
      pose: {
        pitch: this.visualPitch,
        roll: this.visualRoll,
        frontY: groundPose.frontY,
        rearY: groundPose.rearY,
        leftY: groundPose.leftY,
        rightY: groundPose.rightY,
      },
      camera: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
        clearance: this.camera.position.y - this.groundHeightAt(this.camera.position.x, this.camera.position.z),
      },
      terrainLod: terrain ? String(terrain.userData["terrainLod"] ?? "—") : undefined,
      driveDetailTriangles: nearTerrain ? Number(nearTerrain.userData["driveDetailTriangles"] ?? 0) : undefined,
    });
  }

  private updateChallenge(delta: number): void {
    if (!this.route || this.route.checkpoints.length < 2) return;
    if (this.challengeStatus === "ready" && Math.abs(this.state.speed) > 1.2) {
      this.challengeStatus = "running";
      this.publishChallenge();
    }
    if (this.challengeStatus !== "running") return;
    this.challengeElapsed += delta;
    const target = this.route.checkpoints[this.nextCheckpoint];
    if (target && Math.hypot(this.state.x - target.x, this.state.z - target.z) <= 9) {
      this.nextCheckpoint += 1;
      if (this.nextCheckpoint >= this.route.checkpoints.length) {
        this.challengeStatus = "finished";
        if (this.bestSeconds === null || this.challengeElapsed < this.bestSeconds) {
          this.bestSeconds = this.challengeElapsed;
          writeBestTime(this.route.id, this.bestSeconds);
        }
      }
      this.updateChallengeVisuals();
      this.publishChallenge();
    }
  }

  private updateChallengeVisuals(): void {
    this.routeGroup.traverse((object) => {
      const index = object.userData["checkpointIndex"] as number | undefined;
      if (index === undefined || !(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshBasicMaterial;
      if (this.challengeStatus === "finished" || index < this.nextCheckpoint) material.color.setHex(0x56625b);
      else if (index === this.nextCheckpoint) material.color.setHex(0xffd05c);
      else material.color.setHex(0xb8f34b);
      material.opacity = index === this.nextCheckpoint ? 0.94 : 0.58;
    });
  }

  private publishChallenge(): void {
    if (!this.challengeListener || !this.route) return;
    this.challengeListener({
      status: this.challengeStatus,
      elapsedSeconds: this.challengeElapsed,
      bestSeconds: this.bestSeconds,
      checkpoint: Math.min(this.nextCheckpoint, this.route.checkpoints.length - 1),
      checkpointCount: Math.max(1, this.route.checkpoints.length - 1),
      routeLengthMeters: this.route.lengthMeters,
    });
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
    this.steeringInput = 0;
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

function createRouteVisual(route: DriveRoute): THREE.Group {
  const root = new THREE.Group();
  const linePoints = route.points.map((point) => new THREE.Vector3(point.x, point.y + 0.32, point.z));
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xb8f34b, transparent: true, opacity: 0.48 });
  const line = new THREE.Line(lineGeometry, lineMaterial);
  line.name = "Drive route line";
  root.add(line);
  route.checkpoints.forEach((checkpoint, index) => {
    if (index === 0) return;
    const material = new THREE.MeshBasicMaterial({ color: index === 1 ? 0xffd05c : 0xb8f34b, transparent: true, opacity: index === 1 ? 0.94 : 0.58, depthWrite: false });
    const marker = new THREE.Mesh(new THREE.TorusGeometry(5.1, 0.38, 6, 24), material);
    marker.rotation.x = Math.PI / 2;
    marker.position.set(checkpoint.x, checkpoint.y + 0.46, checkpoint.z);
    marker.userData["checkpointIndex"] = index;
    marker.name = `Checkpoint ${index}`;
    root.add(marker);
  });
  return root;
}

function disposeGroup(root: THREE.Group): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
  root.clear();
}

function readBestTime(routeId: string): number | null {
  try {
    const value = Number(localStorage.getItem(`worldseed-drive-best:${routeId}`));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeBestTime(routeId: string, seconds: number): void {
  try {
    localStorage.setItem(`worldseed-drive-best:${routeId}`, seconds.toFixed(3));
  } catch {
    // Time-attack progress remains playable when storage is unavailable.
  }
}
