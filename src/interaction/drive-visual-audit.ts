import * as THREE from "three";

export interface DriveAuditFrame {
  vehicle: { x: number; y: number; z: number };
  road?: { x: number; y: number; z: number; distance: number; width: number };
  guidance?: { targetX: number; targetZ: number; targetY: number; headingError: number; lateralError: number; assist: number };
  pose: { pitch: number; roll: number; frontY: number; rearY: number; leftY: number; rightY: number };
  camera: { x: number; y: number; z: number; clearance: number };
  terrainLod?: string;
  driveDetailTriangles?: number;
}

/**
 * Opt-in visual inspection layer for mobile test passes. It intentionally uses
 * runtime-only scene objects and DOM, so exports and semantic world data stay
 * clean. Tap AUDIT in Drive mode (or open with ?audit=1) to inspect guidance,
 * ground samples and camera clearance without DevTools.
 */
export class DriveVisualAudit {
  private readonly group = new THREE.Group();
  private readonly roadMarker: THREE.Mesh;
  private readonly targetMarker: THREE.Mesh;
  private readonly groundCross: THREE.LineSegments;
  private readonly overlay: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private enabled = false;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = "WorldSeed Drive Visual Audit";
    this.group.userData = { worldseedRuntimeOnly: true };
    this.roadMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 2.2, 8),
      new THREE.MeshBasicMaterial({ color: 0x49d7ff, depthTest: false }),
    );
    this.targetMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd05c, depthTest: false }),
    );
    const crossGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.25, 0, 0), new THREE.Vector3(1.25, 0, 0),
      new THREE.Vector3(0, 0, -1.9), new THREE.Vector3(0, 0, 1.9),
    ]);
    this.groundCross = new THREE.LineSegments(
      crossGeometry,
      new THREE.LineBasicMaterial({ color: 0xff66dd, depthTest: false }),
    );
    this.roadMarker.renderOrder = 50;
    this.targetMarker.renderOrder = 50;
    this.groundCross.renderOrder = 50;
    this.group.add(this.roadMarker, this.targetMarker, this.groundCross);
    this.group.visible = false;
    scene.add(this.group);

    this.overlay = document.createElement("div");
    this.overlay.id = "drive-visual-audit";
    Object.assign(this.overlay.style, {
      position: "fixed",
      left: "max(10px, env(safe-area-inset-left))",
      top: "max(54px, env(safe-area-inset-top))",
      zIndex: "80",
      display: "none",
      maxWidth: "min(320px, 62vw)",
      padding: "8px 10px",
      border: "1px solid rgba(184,243,75,.45)",
      borderRadius: "8px",
      background: "rgba(10,16,13,.84)",
      color: "#eaf8e2",
      font: "600 10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
      pointerEvents: "none",
      whiteSpace: "pre-line",
      backdropFilter: "blur(6px)",
    });
    document.body.appendChild(this.overlay);

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.textContent = "AUDIT";
    this.button.setAttribute("aria-pressed", "false");
    Object.assign(this.button.style, {
      position: "fixed",
      right: "max(10px, env(safe-area-inset-right))",
      top: "max(54px, env(safe-area-inset-top))",
      zIndex: "81",
      display: "none",
      minWidth: "54px",
      minHeight: "34px",
      border: "1px solid rgba(184,243,75,.5)",
      borderRadius: "8px",
      background: "rgba(10,16,13,.78)",
      color: "#b8f34b",
      font: "700 10px/1 system-ui, sans-serif",
      letterSpacing: ".08em",
      touchAction: "manipulation",
    });
    this.button.addEventListener("click", () => this.setEnabled(!this.enabled));
    document.body.appendChild(this.button);

    if (new URL(location.href).searchParams.get("audit") === "1") this.setEnabled(true);
  }

  setDriveActive(active: boolean): void {
    this.button.style.display = active ? "block" : "none";
    if (!active) {
      this.group.visible = false;
      this.overlay.style.display = "none";
    } else if (this.enabled) {
      this.group.visible = true;
      this.overlay.style.display = "block";
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.button.setAttribute("aria-pressed", String(enabled));
    this.button.style.background = enabled ? "rgba(72,96,28,.9)" : "rgba(10,16,13,.78)";
    const driveVisible = this.button.style.display !== "none";
    this.group.visible = enabled && driveVisible;
    this.overlay.style.display = enabled && driveVisible ? "block" : "none";
  }

  update(frame: DriveAuditFrame): void {
    if (!this.enabled || !this.group.visible) return;
    this.groundCross.position.set(frame.vehicle.x, frame.vehicle.y + 0.08, frame.vehicle.z);
    if (frame.road) {
      this.roadMarker.visible = true;
      this.roadMarker.position.set(frame.road.x, frame.road.y + 1.1, frame.road.z);
    } else {
      this.roadMarker.visible = false;
    }
    if (frame.guidance) {
      this.targetMarker.visible = true;
      this.targetMarker.position.set(frame.guidance.targetX, frame.guidance.targetY + 0.7, frame.guidance.targetZ);
    } else {
      this.targetMarker.visible = false;
    }
    const degrees = 180 / Math.PI;
    this.overlay.textContent = [
      "DRIVE VISUAL AUDIT",
      `road error  ${format(frame.road?.distance)} m`,
      `lateral    ${format(frame.guidance?.lateralError)} m`,
      `heading    ${format(frame.guidance ? frame.guidance.headingError * degrees : undefined)}°`,
      `assist     ${format(frame.guidance?.assist)}`,
      `pitch/roll ${format(frame.pose.pitch * degrees)}° / ${format(frame.pose.roll * degrees)}°`,
      `ground F/R ${format(frame.pose.frontY)} / ${format(frame.pose.rearY)} m`,
      `ground L/R ${format(frame.pose.leftY)} / ${format(frame.pose.rightY)} m`,
      `cam clear  ${format(frame.camera.clearance)} m`,
      `terrain    ${frame.terrainLod ?? "—"} · near ${frame.driveDetailTriangles ?? 0} tris`,
    ].join("\n");
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.overlay.remove();
    this.button.remove();
  }
}

function format(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);
}
