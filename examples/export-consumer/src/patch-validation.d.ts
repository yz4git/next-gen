export interface PreparedWorldSeedPatch {
  mergedArchive: Record<string, Uint8Array>;
  fullInvalidateIds: Set<string>;
  batchRefreshIds: Set<string>;
  batchTargets: Map<string, Set<string>>;
}

export function prepareWorldSeedPatch(input: {
  currentArchive: Record<string, Uint8Array>;
  currentIrIndex: any;
  currentGeometryIndex: any;
  archive: Record<string, Uint8Array>;
  patchManifest: any;
  irPatch: any;
  geometryPatch: any;
  nextIrIndex: any;
  nextGeometryIndex: any;
}): PreparedWorldSeedPatch;
