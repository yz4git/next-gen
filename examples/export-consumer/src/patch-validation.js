// Standalone consumer contract validation: no WorldSeed app imports.
export function prepareWorldSeedPatch({
  currentArchive,
  currentIrIndex,
  currentGeometryIndex,
  archive,
  patchManifest,
  irPatch,
  geometryPatch,
  nextIrIndex,
  nextGeometryIndex,
}) {
  const requireMatch = (valid, message) => {
    if (!valid) throw new Error("WorldSeed patch rejected: " + message);
  };
  requireMatch(
    patchManifest?.format === "worldseed-incremental-patch"
      && ["1", "2"].includes(patchManifest.version),
    "unsupported incremental patch",
  );
  requireMatch(irPatch?.format === "worldseed-ir-patch" && irPatch.version === "1", "invalid IR patch");
  requireMatch(
    geometryPatch?.format === "worldseed-geometry-patch" && geometryPatch.version === "1",
    "invalid geometry patch",
  );
  requireMatch(nextIrIndex?.format === "worldseed-ir-index" && nextIrIndex.version === "1", "invalid IR index");
  requireMatch(
    nextGeometryIndex?.format === "worldseed-geometry-index"
      && nextGeometryIndex.version === "1"
      && Array.isArray(nextGeometryIndex.tiles),
    "invalid geometry index",
  );
  const from = currentIrIndex.revisionHash;
  const to = nextIrIndex.revisionHash;
  requireMatch(typeof from === "string" && typeof to === "string", "invalid revision hashes");
  for (const [label, hash] of [
    ["patch base", patchManifest.fromRevisionHash],
    ["IR patch base", irPatch.fromRevisionHash],
    ["geometry patch base", geometryPatch.fromIrRevisionHash],
  ]) {
    if (hash != null) requireMatch(hash === from, label + " revision mismatch");
  }
  for (const [label, hash] of [
    ["patch target", patchManifest.toRevisionHash],
    ["IR patch target", irPatch.toRevisionHash],
    ["geometry patch target", geometryPatch.toIrRevisionHash],
  ]) {
    if (hash != null) requireMatch(hash === to, label + " revision mismatch");
  }
  for (const key of ["regenerated", "removed", "regeneratedBatches", "removedBatches"]) {
    requireMatch(Array.isArray(geometryPatch[key]), "invalid " + key + " list");
  }

  const mergedArchive = { ...currentArchive };
  for (const removal of geometryPatch.removed) {
    requireMatch(Array.isArray(removal.paths), "invalid removed tile paths");
    for (const path of removal.paths) delete mergedArchive[path];
  }
  const previousTiles = new Map((currentGeometryIndex.tiles || []).map((tile) => [tile.id, tile]));
  const previousBatchPath = (entry) => previousTiles.get(entry.tileId)?.batches?.find(
    (batch) => batch.id === entry.id && Boolean(batch.detail) === Boolean(entry.detail),
  )?.path;
  for (const entry of [...geometryPatch.regeneratedBatches, ...geometryPatch.removedBatches]) {
    const oldPath = previousBatchPath(entry);
    if (oldPath) delete mergedArchive[oldPath];
  }
  Object.assign(mergedArchive, archive);

  const nextById = new Map();
  for (const tile of nextGeometryIndex.tiles) {
    requireMatch(typeof tile.id === "string" && !nextById.has(tile.id), "duplicate tile ID");
    nextById.set(tile.id, tile);
    requireMatch(typeof tile.path === "string" && Boolean(mergedArchive[tile.path]),
      "missing base tile " + tile.id);
    if (tile.detailPath) requireMatch(Boolean(mergedArchive[tile.detailPath]),
      "missing detail tile " + tile.id);
    const batchKeys = new Set();
    for (const batch of tile.batches ?? []) {
      const key = String(Boolean(batch.detail)) + ":" + batch.id;
      requireMatch(typeof batch.id === "string" && !batchKeys.has(key), "duplicate batch ID " + key);
      batchKeys.add(key);
      if (batch.path) requireMatch(Boolean(mergedArchive[batch.path]),
        "missing override " + batch.path);
    }
  }

  const fullInvalidateIds = new Set([
    ...geometryPatch.regenerated.map((entry) => entry.id),
    ...geometryPatch.removed.map((entry) => entry.id),
  ]);
  for (const entry of geometryPatch.regenerated) {
    const tile = nextById.get(entry.id);
    requireMatch(tile && tile.path === entry.path, "regenerated tile index mismatch");
    requireMatch(Boolean(archive[entry.path]), "regenerated tile file missing " + entry.path);
    if (entry.detailPath) requireMatch(Boolean(archive[entry.detailPath]),
      "regenerated detail file missing " + entry.detailPath);
  }

  const batchRefreshIds = new Set();
  const batchTargets = new Map();
  for (const entry of geometryPatch.regeneratedBatches) {
    const tile = nextById.get(entry.tileId);
    const batch = tile?.batches?.find((candidate) =>
      candidate.id === entry.id && Boolean(candidate.detail) === Boolean(entry.detail));
    requireMatch(Boolean(batch) && batch.path === entry.path, "regenerated batch index mismatch");
    requireMatch(Boolean(archive[entry.path]), "regenerated batch file missing " + entry.path);
  }
  for (const entry of geometryPatch.removedBatches) {
    const tile = nextById.get(entry.tileId);
    requireMatch(
      !tile?.batches?.some((candidate) =>
        candidate.id === entry.id && Boolean(candidate.detail) === Boolean(entry.detail)),
      "removed batch is still declared " + entry.id,
    );
  }
  for (const entry of [...geometryPatch.regeneratedBatches, ...geometryPatch.removedBatches]) {
    if (fullInvalidateIds.has(entry.tileId)) continue;
    batchRefreshIds.add(entry.tileId);
    const targets = batchTargets.get(entry.tileId) ?? new Set();
    targets.add(entry.id);
    batchTargets.set(entry.tileId, targets);
  }

  return { mergedArchive, fullInvalidateIds, batchRefreshIds, batchTargets };
}
