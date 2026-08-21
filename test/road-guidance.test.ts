import { describe, expect, it } from "vitest";
import { buildRoadGraph } from "../src/generation/road-graph";
import { fromLocalMeters } from "../src/geo/coordinates";
import { blendRoadAssist, RoadGuidanceIndex } from "../src/interaction/road-guidance";
import type { LonLat, RoadFeature } from "../src/types";

const center: LonLat = [135.52586, 34.68737];
const coordinate = (x: number, z: number): LonLat => fromLocalMeters({ x, z }, center);

const roads: RoadFeature[] = [
  {
    id: "approach",
    path: [coordinate(0, -60), coordinate(0, 0)],
    kind: "residential",
    width: 6,
    connectors: [{ id: "bend", at: 1, position: coordinate(0, 0) }],
    source: "overture",
  },
  {
    id: "bend",
    path: [coordinate(0, 0), coordinate(45, 25)],
    kind: "residential",
    width: 6,
    connectors: [{ id: "bend", at: 0, position: coordinate(0, 0) }],
    source: "overture",
  },
];

describe("predictive Drive road guidance", () => {
  it("looks through the next connected road instead of only at the nearest projection", () => {
    const graph = buildRoadGraph(roads, center, 100);
    const edge = graph.edges.find((candidate) => candidate.roadId === "approach")!;
    const guidance = new RoadGuidanceIndex(graph).resolve(
      { edge, x: 0, z: -7, distance: 0.6 },
      { x: 0.6, z: -7, heading: 0, speed: 24 },
    );
    expect(guidance.targetZ).toBeGreaterThan(-7);
    expect(guidance.targetX).toBeGreaterThan(0);
    expect(guidance.cornerSeverity).toBeGreaterThan(0);
  });

  it("preserves strong manual steering authority while helping recovery", () => {
    const guidance = {
      targetX: 10,
      targetZ: 20,
      targetHeading: 0.4,
      headingError: 0.4,
      lateralError: 3,
      suggestedSteering: -0.7,
      cornerSeverity: 0.4,
      recommendedSpeedKph: 30,
    };
    const handsOff = blendRoadAssist(0, guidance, 1);
    const manual = blendRoadAssist(0.9, guidance, 1);
    expect(handsOff).toBeLessThan(0);
    expect(manual).toBeGreaterThan(0.7);
  });
});
