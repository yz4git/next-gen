import type { DriveRoute, RoadGraph, WorldManifest } from "../types";

export const WORLDSEED_IR_FORMAT = "worldseed-ir" as const;
export const WORLDSEED_IR_VERSION = "1" as const;

export interface WorldSeedIrDocument {
  format: typeof WORLDSEED_IR_FORMAT;
  version: typeof WORLDSEED_IR_VERSION;
  metadata: Record<string, unknown>;
  semantic: WorldManifest;
  navigation: {
    roadGraph: RoadGraph;
    spawnPoints: Record<string, unknown>;
    driveRoute: DriveRoute | null;
  };
}

export interface CreateWorldSeedIrInput {
  metadata: Record<string, unknown>;
  manifest: WorldManifest;
  roadGraph: RoadGraph;
  spawnPoints: Record<string, unknown>;
  driveRoute: DriveRoute | null;
}

export function createWorldSeedIr(input: CreateWorldSeedIrInput): WorldSeedIrDocument {
  return {
    format: WORLDSEED_IR_FORMAT,
    version: WORLDSEED_IR_VERSION,
    metadata: input.metadata,
    semantic: input.manifest,
    navigation: {
      roadGraph: input.roadGraph,
      spawnPoints: input.spawnPoints,
      driveRoute: input.driveRoute,
    },
  };
}

export function parseWorldSeedIr(input: string | unknown): WorldSeedIrDocument {
  const document = typeof input === "string" ? JSON.parse(input) as unknown : input;
  return migrateWorldSeedIr(document);
}

export function migrateWorldSeedIr(input: unknown): WorldSeedIrDocument {
  const document = requireRecord(input, "WorldSeed IR root");
  if (document["format"] !== WORLDSEED_IR_FORMAT) {
    throw new Error(`Unsupported WorldSeed IR format: ${String(document["format"])}`);
  }

  const version = document["version"];
  if (version !== WORLDSEED_IR_VERSION && version !== "1.0") {
    throw new Error(`Unsupported WorldSeed IR version: ${String(version)}`);
  }

  const metadata = requireRecord(document["metadata"], "WorldSeed IR metadata");
  const semantic = requireRecord(document["semantic"], "WorldSeed IR semantic manifest");
  const navigation = requireRecord(document["navigation"], "WorldSeed IR navigation");
  requireRecord(navigation["roadGraph"], "WorldSeed IR road graph");
  requireRecord(navigation["spawnPoints"], "WorldSeed IR spawn points");

  return {
    ...document,
    format: WORLDSEED_IR_FORMAT,
    version: WORLDSEED_IR_VERSION,
    metadata,
    semantic: semantic as unknown as WorldManifest,
    navigation: {
      ...navigation,
      roadGraph: navigation["roadGraph"] as RoadGraph,
      spawnPoints: navigation["spawnPoints"] as Record<string, unknown>,
      driveRoute: (navigation["driveRoute"] ?? null) as DriveRoute | null,
    },
  } as WorldSeedIrDocument;
}

export function serializeWorldSeedIr(document: WorldSeedIrDocument, pretty = true): string {
  return serializeCanonicalJson(document, pretty);
}

export function encodeWorldSeedIrFiles(document: WorldSeedIrDocument): Record<string, string> {
  return {
    "worldseed.json": serializeCanonicalJson(document.metadata),
    "worldseed-objects.json": serializeCanonicalJson(document.semantic),
    "road-graph.json": serializeCanonicalJson(document.navigation.roadGraph),
    "spawn-points.json": serializeCanonicalJson(document.navigation.spawnPoints),
    "drive-route.json": serializeCanonicalJson(document.navigation.driveRoute),
    "worldseed-ir.json": serializeWorldSeedIr(document),
  };
}

export function serializeCanonicalJson(value: unknown, pretty = true): string {
  return JSON.stringify(canonicalize(value), null, pretty ? 2 : undefined);
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("WorldSeed IR cannot encode non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => entry === undefined ? null : canonicalize(entry));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      output[key] = canonicalize(entry);
    }
    return output;
  }
  if (value === undefined) return null;
  throw new Error(`WorldSeed IR cannot encode ${typeof value} values`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
