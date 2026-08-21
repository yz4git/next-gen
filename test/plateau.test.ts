import { describe, expect, it } from "vitest";
import { createPlateauWorld, parsePlateauCityGml, parsePositionList } from "../src/data/plateau";
import { createPlateauSurfaceGeometry } from "../src/generation/plateau";
import { buildCity } from "../src/generation/city-builder";

const cityGml = `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:bldg="http://www.opengis.net/citygml/building/2.0">
  <gml:boundedBy><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/6697" srsDimension="3">
    <gml:lowerCorner>35.6809 139.7669 5</gml:lowerCorner>
    <gml:upperCorner>35.6812 139.7672 17</gml:upperCorner>
  </gml:Envelope></gml:boundedBy>
  <core:cityObjectMember>
    <bldg:Building gml:id="bldg-001">
      <gml:name>Station Annex</gml:name>
      <bldg:boundedBy><bldg:GroundSurface><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>
        <gml:posList srsDimension="3">35.6810 139.7670 5 35.6810 139.7671 5 35.6811 139.7671 5 35.6811 139.7670 5 35.6810 139.7670 5</gml:posList>
      </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface></bldg:GroundSurface></bldg:boundedBy>
      <bldg:boundedBy><bldg:WallSurface><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>
        <gml:posList srsDimension="3">35.6810 139.7670 5 35.6810 139.7671 5 35.6810 139.7671 15 35.6810 139.7670 15 35.6810 139.7670 5</gml:posList>
      </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface></bldg:WallSurface></bldg:boundedBy>
      <bldg:boundedBy><bldg:RoofSurface><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>
        <gml:posList srsDimension="3">35.6810 139.7670 15 35.6810 139.7671 15 35.6811 139.7671 17 35.6811 139.7670 17 35.6810 139.7670 15</gml:posList>
      </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy>
    </bldg:Building>
  </core:cityObjectMember>
</core:CityModel>`;

const lod1CityGml = `<core:CityModel xmlns:core="urn:core" xmlns:gml="urn:gml" xmlns:bldg="urn:bldg">
  <core:cityObjectMember><bldg:Building gml:id="lod1-001"><bldg:lod1Solid><gml:Solid><gml:exterior><gml:CompositeSurface>
    <gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>35.0 139.0 3 35.0 139.0001 3 35.0001 139.0001 3 35.0001 139.0 3 35.0 139.0 3</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
    <gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>35.0 139.0 13 35.0001 139.0 13 35.0001 139.0001 13 35.0 139.0001 13 35.0 139.0 13</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
    <gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>35.0 139.0 3 35.0 139.0001 3 35.0 139.0001 13 35.0 139.0 13 35.0 139.0 3</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
  </gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod1Solid></bldg:Building></core:cityObjectMember>
</core:CityModel>`;

describe("PLATEAU CityGML ingestion", () => {
  it("reads EPSG:6697 latitude-longitude-height position lists", () => {
    expect(parsePositionList("35.6 139.7 12 35.61 139.71 13", 3)).toEqual([
      [139.7, 35.6, 12],
      [139.71, 35.61, 13],
    ]);
  });

  it("preserves LOD2 semantic surfaces and derives a playable footprint", () => {
    const parsed = parsePlateauCityGml(cityGml, "sample.gml");
    expect(parsed.center[0]).toBeCloseTo(139.76705);
    expect(parsed.center[1]).toBeCloseTo(35.68105);
    expect(parsed.radius).toBe(100);
    expect(parsed.model.lod2Buildings).toBe(1);
    expect(parsed.model.buildings[0]).toMatchObject({
      id: "bldg-001",
      name: "Station Annex",
      lod: 2,
      minimumElevation: 5,
      maximumElevation: 17,
    });
    expect(parsed.model.buildings[0]?.surfaces.map((surface) => surface.kind)).toEqual([
      "ground", "wall", "roof",
    ]);
    expect(parsed.buildings[0]?.polygons[0]?.[0]).toHaveLength(5);
    expect(parsed.buildings[0]?.height).toBe(12);
  });

  it("ingests LOD1 solids and chooses the lowest horizontal face as footprint", () => {
    const parsed = parsePlateauCityGml(lod1CityGml, "lod1.gml");
    expect(parsed.model.lod1Buildings).toBe(1);
    expect(parsed.model.lod2Buildings).toBe(0);
    expect(parsed.model.buildings[0]?.surfaces).toHaveLength(3);
    expect(parsed.buildings[0]).toMatchObject({ id: "lod1-001", height: 10, source: "plateau" });
    expect(parsed.buildings[0]?.polygons).toHaveLength(1);
  });

  it("creates a local-only world and triangulates vertical and roof surfaces", () => {
    const world = createPlateauWorld(cityGml, "sample.gml");
    expect(world.plateau?.sourceName).toBe("sample.gml");
    expect(world.providerLabel).toContain("Project PLATEAU");
    expect(world.warnings.join(" ")).toContain("not uploaded");
    const wall = world.plateau?.buildings[0]?.surfaces.find((surface) => surface.kind === "wall");
    expect(wall).toBeDefined();
    const geometry = createPlateauSurfaceGeometry(wall!, world.center, world.plateau!.baseElevation);
    expect(geometry?.index?.count).toBe(6);
    geometry?.dispose();
  });

  it("builds LOD2 surfaces into semantic streamed layers", async () => {
    const world = createPlateauWorld(cityGml, "sample.gml");
    const built = await buildCity(world, "low-poly");
    expect(built.stats.plateauBuildings).toBe(1);
    expect(built.stats.plateauLod2Buildings).toBe(1);
    expect(built.group.getObjectByName("Buildings")?.children.length).toBeGreaterThan(0);
    expect(built.group.getObjectByName("Roofs")?.children.length).toBeGreaterThan(0);
    expect(built.manifest.objects.find((object) => object.id === "building:bldg-001")).toMatchObject({
      source: "plateau",
      kind: "lod2",
      properties: { lod: 2, surfaceCount: 3 },
    });
  });
});
