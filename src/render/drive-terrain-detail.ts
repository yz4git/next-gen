import * as THREE from "three";

/**
 * Drive used to draw a second high-detail terrain mesh on top of the medium
 * base terrain. On mobile GPUs the two surfaces can cross on slopes and cause
 * depth-buffer flicker. Keep this compatibility wrapper, but render Drive's
 * high LOD through the original terrain mesh itself so there is only one
 * ground surface in the depth buffer.
 */
export class DriveTerrainDetailPatch {
  readonly mesh: THREE.Mesh;
  private active = false;
  private readonly highIndex: THREE.BufferAttribute | null;
  private readonly restoreCallbacks: () => void;

  constructor(private readonly source: THREE.Mesh) {
    if (!(source.geometry instanceof THREE.BufferGeometry)) throw new Error("Drive terrain detail requires BufferGeometry");
    const position = source.geometry.getAttribute("position");
    if (!(position instanceof THREE.BufferAttribute)) throw new Error("Drive terrain detail requires positions");

    this.highIndex = source.geometry.getIndex()?.clone() ?? null;

    // WorldRenderer still owns this object for lifecycle/audit compatibility,
    // but the placeholder never draws. The source Terrain mesh is the only
    // surface rendered in Drive mode.
    this.mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.mesh.name = "WorldSeed Drive Terrain Detail";
    this.mesh.visible = false;
    this.mesh.userData = {
      worldseedRuntimeOnly: true,
      worldseedLayer: "terrain",
      driveNearField: false,
      driveSingleSurfaceHigh: true,
      driveDetailTriangles: 0,
    };

    const originalBeforeRender = source.onBeforeRender;
    const originalAfterRender = source.onAfterRender;

    const wrappedBeforeRender: typeof source.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      originalBeforeRender.call(source, renderer, scene, camera, geometry, material, group);
      if (this.active && source.geometry instanceof THREE.BufferGeometry) {
        source.geometry.setIndex(this.highIndex);
      }
    };
    const wrappedAfterRender: typeof source.onAfterRender = (renderer, scene, camera, geometry, material, group) => {
      originalAfterRender.call(source, renderer, scene, camera, geometry, material, group);
    };

    source.onBeforeRender = wrappedBeforeRender;
    source.onAfterRender = wrappedAfterRender;
    this.restoreCallbacks = () => {
      // Terrain upgrades replace these callbacks before rebuilding the wrapper.
      // Do not restore stale callbacks over a newer terrain configuration.
      if (source.onBeforeRender === wrappedBeforeRender) source.onBeforeRender = originalBeforeRender;
      if (source.onAfterRender === wrappedAfterRender) source.onAfterRender = originalAfterRender;
    };
  }

  setVisible(visible: boolean): void {
    this.active = visible;
    this.mesh.visible = false;
    this.source.userData["driveSingleSurfaceHigh"] = visible;
  }

  update(_x: number, _z: number): void {
    // No moving overlay is required. The original terrain mesh switches to its
    // high index immediately before rendering while Drive mode is active.
    this.mesh.userData["driveDetailTriangles"] = 0;
  }

  dispose(): void {
    this.active = false;
    this.restoreCallbacks();
    delete this.source.userData["driveSingleSurfaceHigh"];
    this.mesh.geometry.dispose();
    const materials = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
    materials.forEach((material) => material.dispose());
  }
}
