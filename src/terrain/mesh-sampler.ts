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

const MAX_ROAD_TERRAIN_SPAN_METERS = 5.5;
const MAX_SUBDIVISIONS_PER_QUAD = 64;

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
 * Rebuild road strips against the rendered terrain instead of only moving the
 * four original quad corners. Long planar road quads can otherwise bridge over
 * concave terrain, making the vehicle appear to sink below the road. Each strip
 * is subdivided to roughly five-metre spans and both sides are sampled
 * independently, fixing longitudinal valleys and cross-slope gaps together.
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

    const previous = object.geometry;
    const result = rebuildRoadStripGeometry(previous, sampler, offset);
    missedVertices += result.missedVertices;
    if (!result.geometry) {
      const fallback = conformVerticesInPlace(previous, sampler, offset);
      missedVertices += fallback.missedVertices;
      vertices += fallback.vertices;
      if (fallback.vertices > 0) {
        meshes += 1;
        object.userData["terrainConformed"] = true;
      }
      return;
    }

    object.geometry = result.geometry;
    previous.dispose();
    meshes += 1;
    vertices += result.vertices;
    object.userData["terrainConformed"] = true;
    object.userData["terrainConformMaxSpanMeters"] = MAX_ROAD_TERRAIN_SPAN_METERS;
  });

  return { meshes, vertices, missedVertices };
}

function rebuildRoadStripGeometry(
  geometry: THREE.BufferGeometry,
  sampler: TerrainMeshSampler,
  heightOffset: number,
): { geometry: THREE.BufferGeometry | null; vertices: number; missedVertices: number } {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!(position instanceof THREE.BufferAttribute) || !index) {
    return { geometry: null, vertices: 0, missedVertices: 0 };
  }
  const quadCount = position.count / 4;
  if (!Number.isInteger(quadCount) || index.count !== quadCount * 6) {
    return { geometry: null, vertices: 0, missedVertices: 0 };
  }

  const positions: number[] = [];
  const indices: number[] = [];
  let missedVertices = 0;

  for (let quad = 0; quad < quadCount; quad += 1) {
    const base = quad * 4;
    const startLeft = pointAt(position, base);
    const startRight = pointAt(position, base + 1);
    const endLeft = pointAt(position, base + 2);
    const endRight = pointAt(position, base + 3);
    const spanLength = Math.max(
      distanceXZ(startLeft, endLeft),
      distanceXZ(startRight, endRight),
    );
    const spans = Math.max(1, Math.min(MAX_SUBDIVISIONS_PER_QUAD, Math.ceil(spanLength / MAX_ROAD_TERRAIN_SPAN_METERS)));
    const rowStart = positions.length / 3;

    for (let step = 0; step <= spans; step += 1) {
      const amount = step / spans;
      const left = lerpPoint(startLeft, endLeft, amount);
      const right = lerpPoint(startRight, endRight, amount);
      missedVertices += pushTerrainPoint(positions, left, sampler, heightOffset);
      missedVertices += pushTerrainPoint(positions, right, sampler, heightOffset);
    }

    for (let step = 0; step < spans; step += 1) {
      const left0 = rowStart + step * 2;
      const right0 = left0 + 1;
      const left1 = left0 + 2;
      const right1 = left0 + 3;
      indices.push(
        left0, left1, right0,
        left1, right1, right0,
      );
    }
  }

  const rebuilt = new THREE.BufferGeometry();
  rebuilt.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  rebuilt.setIndex(indices);
  rebuilt.userData = { ...geometry.userData };
  rebuilt.computeVertexNormals();
  rebuilt.computeBoundingBox();
  rebuilt.computeBoundingSphere();
  return { geometry: rebuilt, vertices: positions.length / 3, missedVertices };
}

function conformVerticesInPlace(
  geometry: THREE.BufferGeometry,
  sampler: TerrainMeshSampler,
  heightOffset: number,
): { vertices: number; missedVertices: number } {
  const position = geometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute)) return { vertices: 0, missedVertices: 0 };
  let vertices = 0;
  let missedVertices = 0;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const terrainY = sampler.sample(position.getX(vertex), position.getZ(vertex));
    if (terrainY === undefined) {
      missedVertices += 1;
      continue;
    }
    position.setY(vertex, terrainY + heightOffset);
    vertices += 1;
  }
  if (vertices > 0) {
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return { vertices, missedVertices };
}

interface StripPoint {
  x: number;
  y: number;
  z: number;
}

function pointAt(position: THREE.BufferAttribute, index: number): StripPoint {
  return { x: position.getX(index), y: position.getY(index), z: position.getZ(index) };
}

function lerpPoint(first: StripPoint, second: StripPoint, amount: number): StripPoint {
  return {
    x: first.x + (second.x - first.x) * amount,
    y: first.y + (second.y - first.y) * amount,
    z: first.z + (second.z - first.z) * amount,
  };
}

function distanceXZ(first: StripPoint, second: StripPoint): number {
  return Math.hypot(second.x - first.x, second.z - first.z);
}

function pushTerrainPoint(
  output: number[],
  point: StripPoint,
  sampler: TerrainMeshSampler,
  heightOffset: number,
): number {
  const terrainY = sampler.sample(point.x, point.z);
  output.push(point.x, (terrainY ?? point.y - heightOffset) + heightOffset, point.z);
  return terrainY === undefined ? 1 : 0;
}

function roadSurfaceOffset(name: string): number | undefined {
  if (name.startsWith("Road markings ")) return 0.22;
  if (name.startsWith("Sidewalks ")) return 0.18;
  if (name.startsWith("Roads ")) return 0.14;
  return undefined;
}
