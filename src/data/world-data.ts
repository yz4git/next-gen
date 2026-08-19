import type { Attribution, LonLat, WorldData } from "../types";
import { OpenStreetMapProvider, type OsmResult } from "./openstreetmap";
import { OVERTURE_SOURCE_LABEL, OvertureBuildingsProvider } from "./overture";

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

export interface LoadProgress {
  stage: "buildings" | "map" | "assemble";
  message: string;
}

export class WorldDataService {
  private readonly overture = new OvertureBuildingsProvider();
  private readonly osm = new OpenStreetMapProvider();

  async load(
    center: LonLat,
    radius: number,
    signal?: AbortSignal,
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<WorldData> {
    onProgress?.({ stage: "buildings", message: "Reading Overture building tiles…" });
    const overturePromise = this.overture.load(center, radius, signal);
    onProgress?.({ stage: "map", message: "Querying OpenStreetMap streets and land…" });
    const osmPromise = this.osm.load(center, radius, signal);

    const [overtureResult, osmResult] = await Promise.allSettled([
      overturePromise,
      osmPromise,
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
    if (overtureResult.status === "fulfilled" && overtureResult.value.length > 0) {
      buildings = overtureResult.value;
      providerLabel = `${OVERTURE_SOURCE_LABEL} + OpenStreetMap`;
      sourceDetails = [...new Set(buildings.map((building) => building.geometrySource).filter((source): source is string => Boolean(source)))].sort();
      attributions.unshift(OVERTURE_ATTRIBUTION);
    } else {
      warnings.push("Overture building tiles were unavailable; OpenStreetMap buildings are being used.");
    }

    if (buildings.length === 0 && osmData.roads.length === 0 && osmData.areas.length === 0) {
      throw new Error("No open map data could be loaded for this location.");
    }

    onProgress?.({ stage: "assemble", message: "Normalizing open map data…" });
    return {
      center,
      radius,
      buildings,
      roads: osmData.roads,
      areas: osmData.areas,
      attributions,
      providerLabel,
      sourceDetails,
      generatedAt: new Date().toISOString(),
      warnings,
    };
  }
}
