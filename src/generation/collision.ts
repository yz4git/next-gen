import type { LocalPoint } from "../geo/coordinates";
import { pointInPolygon } from "../geo/polygon";

interface Obstacle {
  points: LocalPoint[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class CollisionIndex {
  private readonly cells = new Map<string, Set<Obstacle>>();

  constructor(
    private readonly worldRadius: number,
    private readonly cellSize = 40,
  ) {}

  add(points: LocalPoint[]): void {
    if (points.length < 3) return;
    const xs = points.map((point) => point.x);
    const zs = points.map((point) => point.z);
    const obstacle: Obstacle = {
      points,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    };

    for (let x = this.cell(obstacle.minX); x <= this.cell(obstacle.maxX); x += 1) {
      for (let z = this.cell(obstacle.minZ); z <= this.cell(obstacle.maxZ); z += 1) {
        const key = `${x}:${z}`;
        const bucket = this.cells.get(key) ?? new Set<Obstacle>();
        bucket.add(obstacle);
        this.cells.set(key, bucket);
      }
    }
  }

  canOccupy(point: LocalPoint, padding = 1.1): boolean {
    if (Math.hypot(point.x, point.z) > this.worldRadius - padding) return false;
    const nearby = this.nearby(point, padding);
    for (const obstacle of nearby) {
      if (
        point.x < obstacle.minX - padding ||
        point.x > obstacle.maxX + padding ||
        point.z < obstacle.minZ - padding ||
        point.z > obstacle.maxZ + padding
      ) {
        continue;
      }
      if (pointInPolygon(point, obstacle.points) || distanceToEdges(point, obstacle.points) < padding) {
        return false;
      }
    }
    return true;
  }

  findOpenSpawn(): LocalPoint {
    const candidates: LocalPoint[] = [
      { x: 0, z: 0 },
      { x: 0, z: 16 },
      { x: 16, z: 0 },
      { x: -16, z: 0 },
      { x: 0, z: -16 },
    ];
    for (let radius = 24; radius < this.worldRadius * 0.7; radius += 18) {
      for (let step = 0; step < 12; step += 1) {
        const angle = (step / 12) * Math.PI * 2;
        candidates.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
      }
    }
    return candidates.find((point) => this.canOccupy(point, 2)) ?? { x: 0, z: 0 };
  }

  private nearby(point: LocalPoint, padding: number): Set<Obstacle> {
    const found = new Set<Obstacle>();
    for (let x = this.cell(point.x - padding); x <= this.cell(point.x + padding); x += 1) {
      for (let z = this.cell(point.z - padding); z <= this.cell(point.z + padding); z += 1) {
        for (const obstacle of this.cells.get(`${x}:${z}`) ?? []) found.add(obstacle);
      }
    }
    return found;
  }

  private cell(value: number): number {
    return Math.floor(value / this.cellSize);
  }
}

function distanceToEdges(point: LocalPoint, polygon: LocalPoint[]): number {
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (!start || !end) continue;
    closest = Math.min(closest, distanceToSegment(point, start, end));
  }
  return closest;
}

function distanceToSegment(point: LocalPoint, start: LocalPoint, end: LocalPoint): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t));
}

