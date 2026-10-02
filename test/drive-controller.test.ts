import { describe, expect, it } from "vitest";
import { CollisionIndex } from "../src/generation/collision";
import { driveStreamingHintForState, getDriveSteeringInput, selectSafeDriveSpawn, type DriveButton } from "../src/interaction/drive-controller";
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



describe("drive streaming hint", () => {
  it("points forward for positive speed and backwards while reversing", () => {
    const forward = driveStreamingHintForState({ x: 10, z: 20, heading: Math.PI / 2, speed: 8, steering: 0 });
    expect(forward).not.toBeNull();
    expect(forward!.directionX).toBeCloseTo(1);
    expect(forward!.directionZ).toBeCloseTo(0);
    expect(forward!.speedMetersPerSecond).toBe(8);

    const reverse = driveStreamingHintForState({ x: 10, z: 20, heading: Math.PI / 2, speed: -4, steering: 0 });
    expect(reverse).not.toBeNull();
    expect(reverse!.directionX).toBeCloseTo(-1);
    expect(reverse!.directionZ).toBeCloseTo(0);
  });

  it("does not prefetch while stopped or inactive", () => {
    expect(driveStreamingHintForState({ x: 0, z: 0, heading: 0, speed: 0, steering: 0 })).toBeNull();
    expect(driveStreamingHintForState({ x: 0, z: 0, heading: 0, speed: 10, steering: 0 }, false)).toBeNull();
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
        surface: "paved",
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
