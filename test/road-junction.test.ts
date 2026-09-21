import { describe, expect, it } from "vitest";
import {
  buildRoadJunctionLayouts,
  roadJunctionPolygon,
  sidewalkCornerStrips,
  trimRoadEdge,
} from "../src/generation/road-junction";
import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "../src/types";

function edge(
  id: string,
  from: string,
  to: string,
  start: [number, number],
  end: [number, number],
  widthMeters = 8,
): RoadGraphEdge {
  return {
    id,
    roadId: `road-${id}`,
    from,
    to,
    path: [
      { x: start[0], y: 0, z: start[1] },
      { x: end[0], y: 0, z: end[1] },
    ],
    lengthMeters: Math.hypot(end[0] - start[0], end[1] - start[1]),
    class: "primary",
    widthMeters,
    surface: "paved",
    oneWay: "both",
    speedLimitKph: 40,
  };
}

function node(id: string, x: number, z: number, edgeIds: string[]): RoadGraphNode {
  return { id, x, y: 0, z, edgeIds };
}

describe("dedicated road junction geometry", () => {
  it("creates a trimmed central patch and sidewalk corners for a four-way crossing", () => {
    const graph: RoadGraph = {
      schemaVersion: "1.0",
      generator: "test",
      coordinateSystem: "local meters",
      nodes: [
        node("center", 0, 0, ["west", "east", "north", "south"]),
        node("w", -40, 0, ["west"]),
        node("e", 40, 0, ["east"]),
        node("n", 0, -40, ["north"]),
        node("s", 0, 40, ["south"]),
      ],
      edges: [
        edge("west", "center", "w", [0, 0], [-40, 0]),
        edge("east", "center", "e", [0, 0], [40, 0]),
        edge("north", "center", "n", [0, 0], [0, -40]),
        edge("south", "center", "s", [0, 0], [0, 40]),
      ],
    };

    const layouts = buildRoadJunctionLayouts(graph);
    const junction = layouts.get("center");
    expect(junction).toBeDefined();
    expect(junction!.arms).toHaveLength(4);
    expect(roadJunctionPolygon(junction!).length).toBeGreaterThanOrEqual(4);
    expect(sidewalkCornerStrips(junction!)).toHaveLength(4);

    const trimmed = trimRoadEdge(graph.edges[0]!, layouts);
    expect(trimmed).not.toBeNull();
    expect(Math.hypot(trimmed!.start.x, trimmed!.start.z)).toBeGreaterThan(5);
  });

  it("does not create a special patch for a straight two-edge continuation", () => {
    const graph: RoadGraph = {
      schemaVersion: "1.0",
      generator: "test",
      coordinateSystem: "local meters",
      nodes: [
        node("center", 0, 0, ["left", "right"]),
        node("l", -30, 0, ["left"]),
        node("r", 30, 0, ["right"]),
      ],
      edges: [
        edge("left", "center", "l", [0, 0], [-30, 0], 6),
        edge("right", "center", "r", [0, 0], [30, 0], 6),
      ],
    };

    expect(buildRoadJunctionLayouts(graph).has("center")).toBe(false);
  });

  it("uses a dedicated connection patch for a sharp two-road turn", () => {
    const graph: RoadGraph = {
      schemaVersion: "1.0",
      generator: "test",
      coordinateSystem: "local meters",
      nodes: [
        node("corner", 0, 0, ["a", "b"]),
        node("a-end", -30, 0, ["a"]),
        node("b-end", 0, 30, ["b"]),
      ],
      edges: [
        edge("a", "corner", "a-end", [0, 0], [-30, 0], 6),
        edge("b", "corner", "b-end", [0, 0], [0, 30], 6),
      ],
    };

    const junction = buildRoadJunctionLayouts(graph).get("corner");
    expect(junction).toBeDefined();
    expect(roadJunctionPolygon(junction!).length).toBeGreaterThanOrEqual(3);
  });
});
