import { resolveRoof } from "../generation/roof";
import { tileForPoint } from "../generation/tiling";
import { WORLD_TILE_SIZE } from "../config";
import { toLocalMeters } from "../geo/coordinates";
import { elevationAt } from "../terrain/elevation";
import type {
  ResolvedBuilding,
  SemanticBounds,
  SemanticLayer,
  SemanticObject,
  WorldData,
  WorldManifest,
} from "../types";

export function createWorldManifest(
  data: WorldData,
  buildings: ResolvedBuilding[],
): WorldManifest {
  const objects: SemanticObject[] = [];
  const plateauBuildings = new Map(
    (data.plateau?.buildings ?? []).map((building) => [building.id, building]),
  );
  const terrainMinimum = data.terrain?.minimumElevation ?? 0;
  const terrainMaximum = data.terrain?.maximumElevation ?? 0;
  objects.push({
    id: "terrain:ground",
    sourceId: "ground",
    layer: "terrain",
    source: data.terrain?.source ?? "flat-fallback",
    kind: data.terrain ? "elevation-mesh" : "flat-plane",
    center: [0, (terrainMinimum + terrainMaximum) / 2, 0],
    bounds: {
      minimum: [-data.radius, terrainMinimum, -data.radius],
      maximum: [data.radius, terrainMaximum, data.radius],
    },
    properties: {
      reliefMeters: terrainMaximum - terrainMinimum,
      originElevationMeters: data.terrain?.originElevation ?? 0,
    },
  });

  for (const area of data.areas) {
    const points = area.polygons.flatMap((polygon) => polygon[0] ?? []).map((point) => toLocalMeters(point, data.center));
    if (points.length === 0) continue;
    const bounds = boundsFromPoints(points.map((point) => [point.x, elevationAt(data.terrain, point.x, point.z), point.z]));
    objects.push({
      id: `area:${area.id}`,
      sourceId: area.id,
      layer: "areas",
      source: area.source,
      kind: area.kind,
      center: centerOf(bounds),
      bounds,
      properties: {},
    });
  }

  for (const road of data.roads) {
    const points = road.path.map((point) => toLocalMeters(point, data.center));
    if (points.length === 0) continue;
    const halfWidth = road.width / 2;
    const raw = boundsFromPoints(points.map((point) => [point.x, elevationAt(data.terrain, point.x, point.z), point.z]));
    const bounds: SemanticBounds = {
      minimum: [raw.minimum[0] - halfWidth, raw.minimum[1], raw.minimum[2] - halfWidth],
      maximum: [raw.maximum[0] + halfWidth, raw.maximum[1] + 0.25, raw.maximum[2] + halfWidth],
    };
    objects.push({
      id: `road:${road.id}`,
      sourceId: road.id,
      layer: "roads",
      source: road.source,
      kind: road.kind,
      center: centerOf(bounds),
      bounds,
      properties: { widthMeters: road.width },
    });
  }

  for (const building of buildings) {
    const plateauBuilding = plateauBuildings.get(building.id);
    if (plateauBuilding && data.plateau) {
      const points = plateauBuilding.surfaces.flatMap((surface) => surface.vertices.map((vertex) => {
        const local = toLocalMeters([vertex[0], vertex[1]], data.center);
        return [local.x, vertex[2] - data.plateau!.baseElevation, local.z] as [number, number, number];
      }));
      const buildingBounds = boundsFromPoints(points);
      objects.push({
        id: `building:${building.id}`,
        sourceId: building.id,
        layer: "buildings",
        source: "plateau",
        kind: `lod${plateauBuilding.lod}`,
        name: building.name,
        center: centerOf(buildingBounds),
        bounds: buildingBounds,
        properties: {
          lod: plateauBuilding.lod,
          surfaceCount: plateauBuilding.surfaces.length,
          heightMeters: plateauBuilding.maximumElevation - plateauBuilding.minimumElevation,
          geometrySource: building.geometrySource ?? "Project PLATEAU CityGML",
        },
      });
      const roofPoints = plateauBuilding.surfaces
        .filter((surface) => surface.kind === "roof")
        .flatMap((surface) => surface.vertices.map((vertex) => {
          const local = toLocalMeters([vertex[0], vertex[1]], data.center);
          return [local.x, vertex[2] - data.plateau!.baseElevation, local.z] as [number, number, number];
        }));
      if (roofPoints.length > 0) {
        const roofBounds = boundsFromPoints(roofPoints);
        objects.push({
          id: `roof:${building.id}`,
          sourceId: building.id,
          layer: "roofs",
          source: "plateau",
          kind: `lod${plateauBuilding.lod}-surface`,
          name: building.name,
          center: centerOf(roofBounds),
          bounds: roofBounds,
          properties: { lod: plateauBuilding.lod, surfaceCount: roofPoints.length },
        });
      }
      continue;
    }
    const points = building.polygons
      .flatMap((polygon) => polygon[0] ?? [])
      .map((point) => toLocalMeters(point, data.center));
    if (points.length === 0) continue;
    const horizontal = boundsFromPoints(points.map((point) => [point.x, 0, point.z]));
    const x = (horizontal.minimum[0] + horizontal.maximum[0]) / 2;
    const z = (horizontal.minimum[2] + horizontal.maximum[2]) / 2;
    const ground = elevationAt(data.terrain, x, z);
    const roof = resolveRoof(building, building.resolvedHeight);
    const buildingBounds: SemanticBounds = {
      minimum: [horizontal.minimum[0], ground + building.resolvedMinHeight, horizontal.minimum[2]],
      maximum: [horizontal.maximum[0], ground + building.resolvedHeight, horizontal.maximum[2]],
    };
    objects.push({
      id: `building:${building.id}`,
      sourceId: building.id,
      layer: "buildings",
      source: building.source,
      kind: building.kind,
      name: building.name,
      center: centerOf(buildingBounds),
      bounds: buildingBounds,
      properties: compactProperties({
        heightMeters: building.resolvedHeight,
        minimumHeightMeters: building.resolvedMinHeight,
        heightQuality: building.heightQuality,
        levels: building.levels,
        geometrySource: building.geometrySource,
      }),
    });
    const roofBounds: SemanticBounds = {
      minimum: [horizontal.minimum[0], ground + building.resolvedHeight - roof.height, horizontal.minimum[2]],
      maximum: [horizontal.maximum[0], ground + building.resolvedHeight + 0.03, horizontal.maximum[2]],
    };
    objects.push({
      id: `roof:${building.id}`,
      sourceId: building.id,
      layer: "roofs",
      source: building.source,
      kind: roof.profile,
      name: building.name,
      center: centerOf(roofBounds),
      bounds: roofBounds,
      properties: compactProperties({
        heightMeters: roof.height,
        heightSource: roof.source,
        color: building.roofColor,
      }),
    });
  }

  for (const object of objects) {
    if (object.layer !== "terrain") {
      object.tile = tileForPoint(object.center[0], object.center[2], WORLD_TILE_SIZE).id;
    }
  }

  return {
    schemaVersion: "1.0",
    generator: "WorldSeed 0.6.0",
    coordinateSystem: "local meters; X east, Y up, Z south",
    radiusMeters: data.radius,
    layers: countLayers(objects),
    objects,
  };
}

function boundsFromPoints(points: Array<[number, number, number]>): SemanticBounds {
  return points.reduce<SemanticBounds>((bounds, point) => ({
    minimum: [
      Math.min(bounds.minimum[0], point[0]),
      Math.min(bounds.minimum[1], point[1]),
      Math.min(bounds.minimum[2], point[2]),
    ],
    maximum: [
      Math.max(bounds.maximum[0], point[0]),
      Math.max(bounds.maximum[1], point[1]),
      Math.max(bounds.maximum[2], point[2]),
    ],
  }), {
    minimum: [Infinity, Infinity, Infinity],
    maximum: [-Infinity, -Infinity, -Infinity],
  });
}

function centerOf(bounds: SemanticBounds): [number, number, number] {
  return [
    (bounds.minimum[0] + bounds.maximum[0]) / 2,
    (bounds.minimum[1] + bounds.maximum[1]) / 2,
    (bounds.minimum[2] + bounds.maximum[2]) / 2,
  ];
}

function compactProperties(
  properties: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(properties).filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined),
  );
}

function countLayers(objects: SemanticObject[]): Record<SemanticLayer, number> {
  const counts: Record<SemanticLayer, number> = {
    terrain: 0,
    areas: 0,
    roads: 0,
    buildings: 0,
    roofs: 0,
  };
  for (const object of objects) counts[object.layer] += 1;
  return counts;
}
