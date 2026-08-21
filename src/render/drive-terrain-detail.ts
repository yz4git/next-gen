import * as THREE from "three";

interface TriangleBucket {
  indices: number[];
}

/**
 * Runtime-only high-detail terrain overlay around the Drive camera. The base
 * terrain can stay at medium LOD while this patch draws the original high LOD
 * only within the near-field where road/ground contact is visible.
 */
export class DriveTerrainDetailPatch {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly buckets = new Map<string, TriangleBucket>();
  private readonly cellSize = 36;
  private readonly radius = 96;
  private lastCell = "";

  constructor(source: THREE.Mesh) {
    if (!(source.geometry instanceof THREE.BufferGeometry)) throw new Error("Drive terrain detail requires BufferGeometry");
    const position = source.geometry.getAttribute("position");
    if (!(position instanceof THREE.BufferAttribute)) throw new Error("Drive terrain detail requires positions");
    this.geometry.setAttribute("position", position.clone());
    const normal = source.geometry.getAttribute("normal");
    if (normal instanceof THREE.BufferAttribute) this.geometry.setAttribute("normal", normal.clone());
    const color = source.geometry.getAttribute("color");
    if (color instanceof THREE.BufferAttribute) this.geometry.setAttribute("color", color.clone());
    this.geometry.setIndex([]);
    this.indexSource(source.geometry);

    const material = cloneTerrainMaterial(source.material);
    material.polygonOffset = true;
    material.polygonOffsetFactor = -0.35;
    material.polygonOffsetUnits = -1;
    material.side = THREE.DoubleSide;
    material.needsUpdate = true;
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = "WorldSeed Drive Terrain Detail";
    this.mesh.visible = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 0;
    this.mesh.userData = { worldseedRuntimeOnly: true, worldseedLayer: "terrain", driveNearField: true };
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
    if (!visible) this.lastCell = "";
  }

  update(x: number, z: number): void {
    if (!this.mesh.visible) return;
    const cellX = this.cell(x);
    const cellZ = this.cell(z);
    const key = `${cellX}:${cellZ}`;
    if (key === this.lastCell) return;
    this.lastCell = key;
    const reach = Math.ceil(this.radius / this.cellSize) + 1;
    const selected: number[] = [];
    const seen = new Set<string>();
    const position = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
      for (let offsetZ = -reach; offsetZ <= reach; offsetZ += 1) {
        const bucket = this.buckets.get(`${cellX + offsetX}:${cellZ + offsetZ}`);
        if (!bucket) continue;
        for (let index = 0; index < bucket.indices.length; index += 3) {
          const a = bucket.indices[index]!;
          const b = bucket.indices[index + 1]!;
          const c = bucket.indices[index + 2]!;
          const triangleKey = `${a}:${b}:${c}`;
          if (seen.has(triangleKey)) continue;
          const centerX = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
          const centerZ = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
          if (Math.hypot(centerX - x, centerZ - z) > this.radius + this.cellSize * 0.8) continue;
          seen.add(triangleKey);
          selected.push(a, b, c);
        }
      }
    }
    this.geometry.setIndex(selected);
    this.geometry.computeBoundingSphere();
    this.mesh.userData["driveDetailTriangles"] = Math.floor(selected.length / 3);
  }

  dispose(): void {
    this.geometry.dispose();
    const materials = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
    materials.forEach((material) => material.dispose());
  }

  private indexSource(source: THREE.BufferGeometry): void {
    const position = source.getAttribute("position") as THREE.BufferAttribute;
    const index = source.getIndex();
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const a = index ? index.getX(triangle * 3) : triangle * 3;
      const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      const centerX = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
      const centerZ = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
      const key = `${this.cell(centerX)}:${this.cell(centerZ)}`;
      const bucket = this.buckets.get(key) ?? { indices: [] };
      bucket.indices.push(a, b, c);
      this.buckets.set(key, bucket);
    }
  }

  private cell(value: number): number {
    return Math.floor(value / this.cellSize);
  }
}

function cloneTerrainMaterial(material: THREE.Material | THREE.Material[]): THREE.Material {
  const source = Array.isArray(material) ? material[0] : material;
  return source ? source.clone() : new THREE.MeshStandardMaterial({ color: 0x71845d, roughness: 0.9 });
}
