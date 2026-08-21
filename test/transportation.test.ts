import { describe, expect, it } from "vitest";
import { parseConnectorReferences, parseOneWay, parseSpeedLimit } from "../src/data/transportation";

describe("Overture transportation properties", () => {
  it("reads connector linear references", () => {
    expect(parseConnectorReferences('[{"connector_id":"junction-a","at":0},{"connector_id":"junction-b","at":0.75}]')).toEqual([
      { id: "junction-a", at: 0 },
      { id: "junction-b", at: 0.75 },
    ]);
  });

  it("derives one-way headings from access restrictions", () => {
    expect(parseOneWay('[{"access_type":"denied","when":{"heading":"backward"}}]')).toBe("forward");
    expect(parseOneWay('[{"access_type":"denied","when":{"heading":"forward"}}]')).toBe("backward");
    expect(parseOneWay(undefined)).toBe("both");
  });

  it("normalizes speed limits to km/h", () => {
    expect(parseSpeedLimit('[{"max_speed":{"unit":"km/h","value":50}}]')).toBe(50);
    expect(parseSpeedLimit('[{"max_speed":{"unit":"mph","value":30}}]')).toBeCloseTo(48.28032);
  });
});
