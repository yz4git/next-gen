import * as THREE from "three";

interface TriangleRef {
  a: number;
  b: number;
  c: number;
}

export interface RoadTerrainConformStats {
  meshes: number;
  vertices: number;
  missedVertices: number;
}

/** Spatially indexed XZ sampler for an already-built terrain mesh. */
export class TerrainMeshSampler {
  private readonly position: THREE.BufferAttribute;
  private readonly cells = new Map<string, TriangleRef[]>();
  private readonly cellSize: number;

  constructor(geometry: THREE.BufferGeometry, cellSize = 28) {
    const position = geometry.getAttribute("position");
    if (!(position instanceof THREE.BufferAttribute)) throw new Error("Terrain mesh has no position buffer");
    this.position = position;
    this.cellSize = Math.max(8, cellSize);
    const index = geometry.getIndex();
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const a = index ? index.getX(triangle * 3) : triangle * 3;
      const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      this.insert({ a, b, c });
    }
  }

  sample(x: number, z: number): number | undefined {
    const cellX = this.cell(x);
    const cellZ = this.cell(z);
    let nearestY: number | undefined;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (let radius = 0; radius <= 1; radius += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        for (let offsetZ = -radius; offsetZ <= radius; offsetZ += 1) {
          const triangles = this.cells.get(`${cellX + offsetX}:${cellZ + offsetZ}`) ?? [];
          for (const triangle of triangles) {
            const hit = this.sampleTriangle(triangle, x, z);
            if (hit !== undefined) return hit;
            for (const vertex of [triangle.a, triangle.b, triangle.c]) {
              const dx = this.position.getX(vertex) - x;
              const dz = this.position.getZ(vertex) - z;
              const distanceSquared = dx * dx + dz * dz;
              if (distanceSquared < nearestDistanceSquared) {
                nearestDistanceSquared = distanceSquared;
                nearestY = this.position.getY(vertex);
              }
            }
          }
        }
      }
      if (nearestY !== undefined) break;
    }
    return nearestY;
  }

  private insert(triangle: TriangleRef): void {
    const ax = this.position.getX(triangle.a);
    const az = this.position.getZ(triangle.a);
    const bx = this.position.getX(triangle.b);
    const bz = this.position.getZ(triangle.b);
    const cx = this.position.getX(triangle.c);
    const cz = this.position.getZ(triangle.c);
    const minimumX = this.cell(Math.min(ax, bx, cx));
    const maximumX = this.cell(Math.max(ax, bx, cx));
    const minimumZ = this.cell(Math.min(az, bz, cz));
    const maximumZ = this.cell(Math.max(az, bz, cz));
    for (let x = minimumX; x <= maximumX; x += 1) {
      for (let z = minimumZ; z <= maximumZ; z += 1) {
        const key = `${x}:${z}`;
        const bucket = this.cells.get(key) ?? [];
        bucket.push(triangle);
        this.cells.set(key, bucket);
      }
    }
  }

  private sampleTriangle(triangle: TriangleRef, x: number, z: number): number | undefined {
    const ax = this.position.getX(triangle.a);
    const ay = this.position.getY(triangle.a);
    const az = this.position.getZ(triangle.a);
    const bx = this.position.getX(triangle.b);
    const by = this.position.getY(triangle.b);
    const bz = this.position.getZ(triangle.b);
    const cx = this.position.getX(triangle.c);
    const cy = this.position.getY(triangle.c);
    const cz = this.position.getZ(triangle.c);
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(denominator) < 1e-8) return undefined;
    const first = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
    const second = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
    const third = 1 - first - second;
    const epsilon = -0.0008;
    if (first < epsilon || second < epsilon || third < epsilon) return undefined;
    return first * ay + second * by + third * cy;
  }

  private cell(value: number): number {
    return Math.floor(value / this.cellSize);
  }
}

/**
 * Re-sample every road-surface vertex against the actual terrain mesh. This
 * fixes cross-slope gaps because left/right vertices no longer share the
 * centerline elevation that was used by the fast city builder.
 */
export function conformRoadSurfacesToTerrain(
  group: THREE.Group,
  terrain: THREE.Mesh,
): RoadTerrainConformStats {
  if (!(terrain.geometry instanceof THREE.BufferGeometry)) return { meshes: 0, vertices: 0, missedVertices: 0 };
  const sampler = new TerrainMeshSampler(terrain.geometry);
  let meshes = 0;
  let vertices = 0;
  let missedVertices = 0;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    if (String(object.userData["worldseedLayer"] ?? "") !== "roads") return;
    const offset = roadSurfaceOffset(object.name);
    if (offset === undefined || !(object.geometry instanceof THREE.BufferGeometry)) return;
    const position = object.geometry.getAttribute("position");
    if (!(position instanceof THREE.BufferAttribute)) return;
    let changed = false;
    for (let index = 0; index < position.count; index += 1) {
      const terrainY = sampler.sample(position.getX(index), position.getZ(index));
      if (terrainY === undefined) {
        missedVertices += 1;
        continue;
      }
      position.setY(index, terrainY + offset);
      vertices += 1;
      changed = true;
    }
    if (!changed) return;
    meshes += 1;
    position.needsUpdate = true;
    object.geometry.computeVertexNormals();
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    object.userData["terrainConformed"] = true;
  });
  return { meshes, vertices, missedVertices };
}

function roadSurfaceOffset(name: string): number | undefined {
  if (name.startsWith("Road markings ")) return 0.22;
  if (name.startsWith("Sidewalks ")) return 0.18;
  if (name.startsWith("Roads ")) return 0.14;
  return undefined;
}
