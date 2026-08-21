import { describe, expect, it } from "vitest";
import { fromLocalMeters } from "../src/geo/coordinates";
import {
  buildRoadGraph,
  createDriveRoute,
  driveSpawnForRoute,
  findNearestRoadPoint,
} from "../src/generation/road-graph";
import type { LonLat, RoadFeature } from "../src/types";

const center: LonLat = [139.767125, 35.681236];
const coordinate = (x: number, z: number): LonLat => fromLocalMeters({ x, z }, center);

const roads: RoadFeature[] = [
  {
    id: "east-west",
    path: [coordinate(-100, 0), coordinate(0, 0), coordinate(100, 0)],
    kind: "residential",
    width: 6,
    connectors: [{ id: "crossing", at: 0.5, position: coordinate(0, 0) }],
    source: "overture",
  },
  {
    id: "north-south",
    path: [coordinate(0, -100), coordinate(0, 0), coordinate(0, 100)],
    kind: "secondary",
    width: 8,
    oneWay: "forward",
    connectors: [{ id: "crossing", at: 0.5, position: coordinate(0, 0) }],
    source: "overture",
  },
];

describe("drive road graph", () => {
  it("joins Overture segments through connector IDs and preserves direction metadata", () => {
    const graph = buildRoadGraph(roads, center, 150);
    const crossing = graph.nodes.find((node) => node.id === "connector:crossing");
    expect(crossing?.edgeIds).toHaveLength(4);
    expect(graph.edges).toHaveLength(4);
    expect(graph.edges.filter((edge) => edge.roadId === "north-south").every((edge) => edge.oneWay === "forward")).toBe(true);
  });

  it("snaps a vehicle to the nearest road and builds a deterministic checkpoint route", () => {
    const graph = buildRoadGraph(roads, center, 150);
    const nearest = findNearestRoadPoint(graph, { x: 12, z: 9 });
    expect(nearest?.position.z).toBeCloseTo(0, 1);
    const first = createDriveRoute(graph, 42);
    const second = createDriveRoute(graph, 42);
    expect(first).toEqual(second);
    expect(first?.checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(driveSpawnForRoute(first!)?.headingRadians).toBeTypeOf("number");
  });

  it("excludes walking-only paths from the vehicle network", () => {
    const graph = buildRoadGraph([{ id: "foot", path: [coordinate(0, 0), coordinate(10, 0)], kind: "footway", width: 2, source: "openstreetmap" }], center, 100);
    expect(graph.edges).toHaveLength(0);
  });
});
