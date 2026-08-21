import { describe, expect, it } from "vitest";
import { openDataProgressStage } from "../src/data/world-data";

describe("open data loading progress", () => {
  it("advances only as providers actually settle", () => {
    expect(openDataProgressStage(0)).toBe("buildings");
    expect(openDataProgressStage(1)).toBe("transportation");
    expect(openDataProgressStage(2)).toBe("map");
    expect(openDataProgressStage(3)).toBe("terrain");
    expect(openDataProgressStage(4)).toBe("assemble");
    expect(openDataProgressStage(8)).toBe("assemble");
  });
});
