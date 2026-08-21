import * as THREE from "three";
import { toLocalMeters } from "../geo/coordinates";
import type { LonLat, PlateauSurface } from "../types";

export function createPlateauSurfaceGeometry(
  surface: PlateauSurface,
  center: LonLat,
  baseElevation: number,
): THREE.BufferGeometry | null {
  if (surface.vertices.length < 3) return null;
  const vertices = surface.vertices.map((vertex) => {
    const local = toLocalMeters([vertex[0], vertex[1]], center);
    return new THREE.Vector3(local.x, vertex[2] - baseElevation, local.z);
  });
  const projected = projectSurface(vertices);
  const triangles = THREE.ShapeUtils.triangulateShape(projected, []);
  const indices = triangles.length > 0
    ? triangles.flatMap((triangle) => triangle)
    : fanIndices(vertices.length);
  if (indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]), 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function projectSurface(vertices: THREE.Vector3[]): THREE.Vector2[] {
  const normal = new THREE.Vector3();
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    if (!current || !next) continue;
    normal.x += (current.y - next.y) * (current.z + next.z);
    normal.y += (current.z - next.z) * (current.x + next.x);
    normal.z += (current.x - next.x) * (current.y + next.y);
  }
  const absolute = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
  const dominant = absolute.indexOf(Math.max(...absolute));
  if (dominant === 0) return vertices.map((vertex) => new THREE.Vector2(vertex.z, vertex.y));
  if (dominant === 2) return vertices.map((vertex) => new THREE.Vector2(vertex.x, vertex.y));
  return vertices.map((vertex) => new THREE.Vector2(vertex.x, vertex.z));
}

function fanIndices(vertexCount: number): number[] {
  const indices: number[] = [];
  for (let index = 1; index < vertexCount - 1; index += 1) indices.push(0, index, index + 1);
  return indices;
}
