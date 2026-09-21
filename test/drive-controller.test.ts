import { describe, expect, it } from "vitest";
import { CollisionIndex } from "../src/generation/collision";
import { getDriveSteeringInput, selectSafeDriveSpawn, type DriveButton } from "../src/interaction/drive-controller";
import type { RoadGraph } from "../src/types";

describe("drive steering input", () => {
  it("maps left intent to the reversed vehicle turn direction", () => {
    expect(getDriveSteeringInput(new Set(["KeyA"]), new Set<DriveButton>())).toBe(-1);
    expect(getDriveSteeringInput(new Set(["ArrowLeft"]), new Set<DriveButton>())).toBe(-1);
    expect(getDriveSteeringInput(new Set<string>(), new Set<DriveButton>(["left"]))).toBe(-1);
  });

  it("maps right intent in the opposite direction and cancels crossed input", () => {
    expect(getDriveSteeringInput(new Set(["KeyD"]), new Set<DriveButton>())).toBe(1);
    expect(getDriveSteeringInput(new Set(["ArrowRight"]), new Set<DriveButton>())).toBe(1);
    expect(getDriveSteeringInput(new Set(["KeyA"]), new Set<DriveButton>(["right"]))).toBe(0);
  });
});


describe("drive spawn safety", () => {
  it("moves an unsafe preferred spawn to a clear point on the road network", () => {
    const collision = new CollisionIndex(100);
    collision.add([
      { x: -4, z: -4 },
      { x: 4, z: -4 },
      { x: 4, z: 4 },
      { x: -4, z: 4 },
    ]);
    const graph: RoadGraph = {
      schemaVersion: "1.0",
      generator: "test",
      coordinateSystem: "local meters",
      nodes: [
        { id: "a", x: -30, y: 0, z: 0, edgeIds: ["edge"] },
        { id: "b", x: 30, y: 0, z: 0, edgeIds: ["edge"] },
      ],
      edges: [{
        id: "edge",
        roadId: "road",
        from: "a",
        to: "b",
        path: [{ x: -30, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }],
        lengthMeters: 60,
        class: "residential",
        widthMeters: 6,
        oneWay: "both",
        speedLimitKph: 30,
      }],
    };
    const spawn = selectSafeDriveSpawn(graph, collision, {
      edgeId: "edge",
      position: { x: 0, y: 0, z: 0 },
      headingRadians: Math.PI / 2,
    });
    expect(spawn).not.toBeNull();
    expect(collision.canOccupy(spawn!.position, 1.8)).toBe(true);
  });
});
