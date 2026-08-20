import { describe, expect, it } from "vitest";
import { getDriveSteeringInput, type DriveButton } from "../src/interaction/drive-controller";

describe("drive steering input", () => {
  it("maps left intent to the vehicle's left turn direction", () => {
    expect(getDriveSteeringInput(new Set(["KeyA"]), new Set<DriveButton>())).toBe(1);
    expect(getDriveSteeringInput(new Set(["ArrowLeft"]), new Set<DriveButton>())).toBe(1);
    expect(getDriveSteeringInput(new Set<string>(), new Set<DriveButton>(["left"]))).toBe(1);
  });

  it("maps right intent in the opposite direction and cancels crossed input", () => {
    expect(getDriveSteeringInput(new Set(["KeyD"]), new Set<DriveButton>())).toBe(-1);
    expect(getDriveSteeringInput(new Set(["ArrowRight"]), new Set<DriveButton>())).toBe(-1);
    expect(getDriveSteeringInput(new Set(["KeyA"]), new Set<DriveButton>(["right"]))).toBe(0);
  });
});
