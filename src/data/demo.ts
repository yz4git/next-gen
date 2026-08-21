import { fromLocalMeters } from "../geo/coordinates";
import type { AreaFeature, BuildingFeature, LonLat, RoadFeature, WorldData } from "../types";
import { seededUnit } from "../generation/height";
import { createDemoElevationGrid } from "../terrain/elevation";

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
        roofShape: buildingIndex % 7 === 0 ? "gabled" : buildingIndex % 11 === 0 ? "hipped" : "flat",
        roofHeight: buildingIndex % 7 === 0 ? 3.5 : undefined,
        roofColor: buildingIndex % 5 === 0 ? "#8d5f56" : undefined,
        source: "demo",
      });
    }
  }

  const roadOffsets: number[] = [];
  for (let offset = -radius; offset <= radius; offset += spacing) roadOffsets.push(Math.round(offset * 100) / 100);
  if ((roadOffsets.at(-1) ?? -radius) < radius) roadOffsets.push(radius);
  const central = [...roadOffsets].sort((first, second) => Math.abs(first) - Math.abs(second))[0] ?? 0;
  for (const offset of roadOffsets) {
    const kind = offset === central ? "primary" : "residential";
    roads.push(makeGridRoad(`demo-road-x-${offset}`, center, roadOffsets.map((x) => [x, offset]), kind));
    roads.push(makeGridRoad(`demo-road-z-${offset}`, center, roadOffsets.map((z) => [offset, z]), kind));
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
    terrain: createDemoElevationGrid(radius),
    isDemo: true,
    attributions: [],
  };
}

function makeGridRoad(
  id: string,
  center: LonLat,
  points: Array<[number, number]>,
  kind: string,
): RoadFeature {
  return {
    id,
    path: points.map(([x, z]) => fromLocalMeters({ x, z }, center)),
    kind,
    width: kind === "primary" ? 12 : 6,
    name: kind === "primary" ? "WorldSeed Avenue" : undefined,
    surface: "paved",
    oneWay: "both",
    speedLimitKph: kind === "primary" ? 50 : 30,
    connectors: points.map(([x, z], index) => ({
      id: `demo-junction:${x.toFixed(2)}:${z.toFixed(2)}`,
      at: points.length <= 1 ? 0 : index / (points.length - 1),
      position: fromLocalMeters({ x, z }, center),
    })),
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
