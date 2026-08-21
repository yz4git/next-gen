import { terrainResolutionMeters } from "../terrain/quality";
import type { Attribution, LonLat, WorldData } from "../types";
import { OpenStreetMapProvider, type OsmResult } from "./openstreetmap";
import { OVERTURE_SOURCE_LABEL, OvertureBuildingsProvider } from "./overture";
import { TerrainProvider, type TerrainLoadProgress } from "./terrain";
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

const SOURCE_COUNT = 4;
const OVERTURE_TIMEOUT_MS = 30_000;
const TRANSPORTATION_TIMEOUT_MS = 30_000;
const OSM_TIMEOUT_MS = 42_000;
const TERRAIN_TIMEOUT_MS = 30_000;

export interface LoadProgress {
  stage: "buildings" | "transportation" | "map" | "terrain" | "assemble";
  message: string;
}

export function openDataProgressStage(completedSources: number): LoadProgress["stage"] {
  if (completedSources <= 0) return "buildings";
  if (completedSources === 1) return "transportation";
  if (completedSources === 2) return "map";
  if (completedSources === 3) return "terrain";
  return "assemble";
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
    let completedSources = 0;
    const emitDetail = (message: string): void => {
      onProgress?.({ stage: openDataProgressStage(completedSources), message });
    };
    const track = async <T>(label: string, promise: Promise<T>): Promise<T> => {
      try {
        return await promise;
      } finally {
        completedSources += 1;
        onProgress?.({
          stage: openDataProgressStage(completedSources),
          message: `${label} finished · ${completedSources}/${SOURCE_COUNT} sources`,
        });
      }
    };

    onProgress?.({ stage: "buildings", message: "Starting buildings, roads, map and terrain…" });
    const overturePromise = track(
      "Buildings",
      withProviderTimeout("Overture buildings", OVERTURE_TIMEOUT_MS, signal, (providerSignal) =>
        this.overture.load(center, radius, providerSignal)),
    );
    const transportationPromise = track(
      "Road network",
      withProviderTimeout("Overture transportation", TRANSPORTATION_TIMEOUT_MS, signal, (providerSignal) =>
        this.transportation.load(center, radius, providerSignal)),
    );
    const osmPromise = track(
      "OpenStreetMap",
      withProviderTimeout("OpenStreetMap", OSM_TIMEOUT_MS, signal, (providerSignal) =>
        this.osm.load(center, radius, providerSignal)),
    );
    const terrainPromise = track(
      "Terrain",
      withProviderTimeout("Terrain", TERRAIN_TIMEOUT_MS, signal, (providerSignal) =>
        this.terrain.load(center, radius, providerSignal, (progress) => emitDetail(terrainProgressMessage(progress)))),
    );

    const [overtureResult, transportationResult, osmResult, terrainResult] = await Promise.allSettled([
      overturePromise,
      transportationPromise,
      osmPromise,
      terrainPromise,
    ]);
    if (signal?.aborted) throw cancellationError();

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
      sourceDetails.push(`Mapzen terrain · adaptive ${terrain.columns}×${terrain.rows} grid · ≈${terrainResolutionMeters(terrain).toFixed(1)} m samples`);
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

function terrainProgressMessage(progress: TerrainLoadProgress): string {
  if (progress.phase === "tiles") return `Terrain tiles ${progress.completed}/${progress.total} decoded…`;
  if (progress.phase === "sampling") return `Sampling terrain grid ${progress.completed}/${progress.total} rows…`;
  return "Terrain cache ready…";
}

async function withProviderTimeout<T>(
  label: string,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  load: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    };
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onParentAbort = (): void => {
      controller.abort(parentSignal?.reason);
      finish(() => reject(cancellationError()));
    };

    if (parentSignal?.aborted) {
      onParentAbort();
      return;
    }
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      finish(() => reject(new Error(`${label} timed out`)));
    }, timeoutMs);

    load(controller.signal).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(parentSignal?.aborted ? cancellationError() : error)),
    );
  });
}

function cancellationError(): DOMException {
  return new DOMException("Generation cancelled", "AbortError");
}
