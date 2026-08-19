import { describe, expect, it } from "vitest";
import {
  boundsAround,
  distanceMeters,
  fromLocalMeters,
  parseCoordinate,
  parseCoordinateInput,
  toLocalMeters,
} from "../src/geo/coordinates";

describe("coordinate conversion", () => {
  it("round-trips local meters around the selected origin", () => {
    const origin = [139.767125, 35.681236] as const;
    const local = { x: 237.4, z: -91.7 };
    const restored = toLocalMeters(fromLocalMeters(local, origin), origin);
    expect(restored.x).toBeCloseTo(local.x, 6);
    expect(restored.z).toBeCloseTo(local.z, 6);
  });

  it("accepts conventional latitude, longitude text", () => {
    expect(parseCoordinate("35.681236, 139.767125")).toEqual([139.767125, 35.681236]);
    expect(parseCoordinate("95, 139")).toBeNull();
  });

  it("extracts coordinates without consuming Google map data", () => {
    expect(parseCoordinateInput("https://www.google.com/maps/@48.858370,2.294481,16z")).toEqual([2.294481, 48.85837]);
    expect(parseCoordinateInput("https://maps.google.com/?q=40.706100%2C-74.009200")).toEqual([-74.0092, 40.7061]);
  });

  it("creates bounds at approximately the requested radius", () => {
    const center = [2.294481, 48.85837] as const;
    const bounds = boundsAround(center, 500);
    expect(distanceMeters(center, [center[0], bounds.north])).toBeCloseTo(500, 0);
    expect(distanceMeters(center, [bounds.east, center[1]])).toBeCloseTo(500, 0);
  });
});

