import type { Attribution, LonLat, WorldData } from "../types";
import { OpenStreetMapProvider, type OsmResult } from "./openstreetmap";
import { OVERTURE_SOURCE_LABEL, OvertureBuildingsProvider } from "./overture";
import { TerrainProvider } from "./terrain";
import { OvertureTransportationProvider } from "./transportation";

const OVERTURE_ATTRIBUTION: Attribution = {
  label: "Overture Maps Foundation",
  url: "https://overturemaps.org/",
  license: "ODbL 1.0 + source-specific attribution",
  licenseUrl: "https://docs.overturemaps.org/attribution/",
};

const OSM_ATTRIBUTION: Attribution = {
  label: "© OpenStreetMap contributors",
  url: "https://www.openstreetmap.org/copyright",
  license: "ODbL 1.0",
  licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
};

const TERRAIN_ATTRIBUTION: Attribution = {
  label: "Mapzen Terrain Tiles",
  url: "https://registry.opendata.aws/terrain-tiles/",
  license: "Open elevation data sources",
  licenseUrl: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
};

export interface LoadProgress {
  stage: "buildings" | "transportation" | "map" | "terrain" | "assemble";
  message: string;
}

export class WorldDataService {
  private readonly overture = new OvertureBuildingsProvider();
  private readonly osm = new OpenStreetMapProvider();
  private readonly terrain = new TerrainProvider();
  private readonly transportation = new OvertureTransportationProvider();

  async load(
    center: LonLat,
    radius: number,
    signal?: AbortSignal,
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<WorldData> {
    onProgress?.({ stage: "buildings", message: "Reading Overture building tiles…" });
    const overturePromise = this.overture.load(center, radius, signal);
    onProgress?.({ stage: "transportation", message: "Building the Overture road network…" });
    const transportationPromise = this.transportation.load(center, radius, signal);
    onProgress?.({ stage: "map", message: "Querying OpenStreetMap streets and land…" });
    const osmPromise = this.osm.load(center, radius, signal);
    onProgress?.({ stage: "terrain", message: "Sampling open elevation tiles…" });
    const terrainPromise = this.terrain.load(center, radius, signal);

    const [overtureResult, transportationResult, osmResult, terrainResult] = await Promise.allSettled([
      overturePromise,
      transportationPromise,
      osmPromise,
      terrainPromise,
    ]);
    if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");

    const warnings: string[] = [];
    let osmData: OsmResult = { buildings: [], roads: [], areas: [] };
    if (osmResult.status === "fulfilled") {
      osmData = osmResult.value;
    } else {
      warnings.push("OpenStreetMap streets and land data could not be loaded.");
    }

    let buildings = osmData.buildings;
    let providerLabel = "OpenStreetMap";
    let sourceDetails: string[] = [];
    const attributions = [OSM_ATTRIBUTION];
    let usesOverture = false;
    if (overtureResult.status === "fulfilled" && overtureResult.value.length > 0) {
      buildings = overtureResult.value;
      providerLabel = `${OVERTURE_SOURCE_LABEL} + OpenStreetMap`;
      sourceDetails = [...new Set(buildings.map((building) => building.geometrySource).filter((source): source is string => Boolean(source)))].sort();
      usesOverture = true;
    } else {
      warnings.push("Overture building tiles were unavailable; OpenStreetMap buildings are being used.");
    }

    let roads = osmData.roads;
    if (transportationResult.status === "fulfilled" && transportationResult.value.length > 0) {
      roads = transportationResult.value;
      providerLabel = usesOverture
        ? `${OVERTURE_SOURCE_LABEL} + OpenStreetMap`
        : `${OVERTURE_SOURCE_LABEL} transportation + OpenStreetMap`;
      sourceDetails.push("Overture transportation segments + connectors");
      usesOverture = true;
    } else {
      warnings.push("Overture transportation tiles were unavailable; OpenStreetMap roads are being used.");
    }

    if (usesOverture) attributions.unshift(OVERTURE_ATTRIBUTION);

    const terrain = terrainResult.status === "fulfilled" ? terrainResult.value : undefined;
    if (terrain) {
      attributions.push(TERRAIN_ATTRIBUTION);
      providerLabel = `${providerLabel} + Mapzen terrain`;
    } else {
      warnings.push("Elevation tiles were unavailable; this world is using flat terrain.");
    }

    if (buildings.length === 0 && roads.length === 0 && osmData.areas.length === 0) {
      throw new Error("No open map data could be loaded for this location.");
    }

    onProgress?.({ stage: "assemble", message: "Normalizing open map data…" });
    return {
      center,
      radius,
      buildings,
      roads,
      areas: osmData.areas,
      attributions,
      providerLabel,
      sourceDetails,
      generatedAt: new Date().toISOString(),
      warnings,
      terrain,
    };
  }
}
