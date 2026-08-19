import { fromLocalMeters } from "../geo/coordinates";
import type { AreaFeature, BuildingFeature, LonLat, RoadFeature, WorldData } from "../types";
import { seededUnit } from "../generation/height";

export function createDemoWorld(center: LonLat, radius: number): WorldData {
  const buildings: BuildingFeature[] = [];
  const roads: RoadFeature[] = [];
  const areas: AreaFeature[] = [];
  const spacing = 54;
  let buildingIndex = 0;

  for (let x = -radius + 45; x < radius - 45; x += spacing) {
    for (let z = -radius + 45; z < radius - 45; z += spacing) {
      if (Math.hypot(x, z) > radius - 38 || Math.abs(x) < 13 || Math.abs(z) < 13) continue;
      if (x > 50 && x < 180 && z > -180 && z < -50) continue;
      const id = `demo-building-${buildingIndex++}`;
      const width = 20 + seededUnit(`${id}:w`) * 18;
      const depth = 18 + seededUnit(`${id}:d`) * 20;
      const centerX = x + (seededUnit(`${id}:x`) - 0.5) * 9;
      const centerZ = z + (seededUnit(`${id}:z`) - 0.5) * 9;
      const ring = [
        fromLocalMeters({ x: centerX - width / 2, z: centerZ - depth / 2 }, center),
        fromLocalMeters({ x: centerX + width / 2, z: centerZ - depth / 2 }, center),
        fromLocalMeters({ x: centerX + width / 2, z: centerZ + depth / 2 }, center),
        fromLocalMeters({ x: centerX - width / 2, z: centerZ + depth / 2 }, center),
      ];
      buildings.push({
        id,
        polygons: [[[...ring, ring[0]!]]],
        height: buildingIndex % 5 === 0 ? 18 + seededUnit(`${id}:h`) * 54 : undefined,
        levels: buildingIndex % 3 === 0 ? 3 + Math.floor(seededUnit(`${id}:l`) * 8) : undefined,
        kind: buildingIndex % 4 === 0 ? "commercial" : "residential",
        source: "demo",
      });
    }
  }

  for (let offset = -radius; offset <= radius; offset += spacing) {
    roads.push(makeRoad(`demo-road-x-${offset}`, center, [-radius, offset], [radius, offset], offset === 0 ? "primary" : "residential"));
    roads.push(makeRoad(`demo-road-z-${offset}`, center, [offset, -radius], [offset, radius], offset === 0 ? "primary" : "residential"));
  }

  const parkRing = rectangle(center, 60, -170, 160, 120);
  areas.push({ id: "demo-park", polygons: [[parkRing]], kind: "park", source: "demo" });
  const waterRing = rectangle(center, -radius + 35, 0, 42, radius * 1.6);
  areas.push({ id: "demo-water", polygons: [[waterRing]], kind: "water", source: "demo" });

  return {
    center,
    radius,
    buildings,
    roads,
    areas,
    providerLabel: "Bundled synthetic demo",
    generatedAt: new Date().toISOString(),
    warnings: ["This preview is synthetic demo data, not a model of the selected location."],
    isDemo: true,
    attributions: [],
  };
}

function makeRoad(
  id: string,
  center: LonLat,
  start: [number, number],
  end: [number, number],
  kind: string,
): RoadFeature {
  return {
    id,
    path: [
      fromLocalMeters({ x: start[0], z: start[1] }, center),
      fromLocalMeters({ x: end[0], z: end[1] }, center),
    ],
    kind,
    width: kind === "primary" ? 12 : 6,
    source: "demo",
  };
}

function rectangle(
  center: LonLat,
  x: number,
  z: number,
  width: number,
  depth: number,
): LonLat[] {
  const ring = [
    fromLocalMeters({ x: x - width / 2, z: z - depth / 2 }, center),
    fromLocalMeters({ x: x + width / 2, z: z - depth / 2 }, center),
    fromLocalMeters({ x: x + width / 2, z: z + depth / 2 }, center),
    fromLocalMeters({ x: x - width / 2, z: z + depth / 2 }, center),
  ];
  return [...ring, ring[0]!];
}
