import { describe, expect, it } from "vitest";
import worldseed from "../schemas/v1/worldseed.schema.json";
import objects from "../schemas/v1/worldseed-objects.schema.json";
import roadGraph from "../schemas/v1/road-graph.schema.json";
import spawns from "../schemas/v1/spawn-points.schema.json";
import driveRoute from "../schemas/v1/drive-route.schema.json";

describe("published JSON Schema files", () => {
  it("publish Draft 2020-12 schemas with v0.9.1 canonical IDs", () => {
    for (const schema of [worldseed, objects, roadGraph, spawns, driveRoute]) {
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.$id).toContain("/v0.9.1/schemas/v1/");
    }
  });

  it("defines road graph nodes as one closed object rather than conflicting allOf shapes", () => {
    const node = roadGraph.properties.nodes.items;
    expect(node.type).toBe("object");
    expect(node.required).toEqual(["id", "x", "y", "z", "edgeIds"]);
    expect(node.additionalProperties).toBe(false);
    expect(node.properties).toHaveProperty("id");
    expect(node.properties).toHaveProperty("edgeIds");
    expect(node).not.toHaveProperty("allOf");
  });
});
