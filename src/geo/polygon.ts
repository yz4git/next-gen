import type { LocalPoint } from "./coordinates";

export function signedArea(points: readonly LocalPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) continue;
    area += current.x * next.z - next.x * current.z;
  }
  return area / 2;
}

export function pointInPolygon(point: LocalPoint, polygon: readonly LocalPoint[]): boolean {
  let inside = false;
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (!current || !previous) continue;
    const intersects =
      current.z > point.z !== previous.z > point.z &&
      point.x <
        ((previous.x - current.x) * (point.z - current.z)) /
          (previous.z - current.z || Number.EPSILON) +
          current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(points: readonly LocalPoint[]): LocalPoint {
  if (points.length === 0) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  for (const point of points) {
    x += point.x;
    z += point.z;
  }
  return { x: x / points.length, z: z / points.length };
}

export function clipSegmentToCircle(
  start: LocalPoint,
  end: LocalPoint,
  radius: number,
): [LocalPoint, LocalPoint] | null {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const a = deltaX * deltaX + deltaZ * deltaZ;
  if (a === 0) return start.x * start.x + start.z * start.z <= radius * radius
    ? [start, end]
    : null;

  const b = 2 * (start.x * deltaX + start.z * deltaZ);
  const c = start.x * start.x + start.z * start.z - radius * radius;
  const discriminant = b * b - 4 * a * c;
  const startInside = c <= 0;
  const endInside = end.x * end.x + end.z * end.z <= radius * radius;

  if (startInside && endInside) return [start, end];
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const intersections = [t1, t2].filter((value) => value >= 0 && value <= 1).sort();

  if (startInside && intersections[0] !== undefined) {
    return [start, interpolate(start, end, intersections[0])];
  }
  if (endInside && intersections.at(-1) !== undefined) {
    return [interpolate(start, end, intersections.at(-1)!), end];
  }
  if (intersections.length === 2 && intersections[0] !== undefined && intersections[1] !== undefined) {
    return [interpolate(start, end, intersections[0]), interpolate(start, end, intersections[1])];
  }
  return null;
}

function interpolate(start: LocalPoint, end: LocalPoint, amount: number): LocalPoint {
  return {
    x: start.x + (end.x - start.x) * amount,
    z: start.z + (end.z - start.z) * amount,
  };
}
