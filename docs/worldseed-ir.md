# WorldSeed IR

WorldSeed IR is the internal, versioned intermediate representation used between world generation and export.

The design is inspired by the same general idea used by CAPCOM's REDox project: normalize data into one representation, then encode that representation into the formats consumers need. WorldSeed does **not** depend on REDox or .NET and does not copy REDox source code.

## Why it exists

WorldSeed already combines multiple sources and emits several related artifacts. A shared IR gives those artifacts one assembly boundary:

```
open geospatial sources
        ↓
   WorldSeed IR
   ├─ metadata
   ├─ semantic objects
   └─ navigation
        ├─ road graph
        ├─ spawn points
        └─ drive route
        ↓
   chunk index
   ├─ worldseed-ir.index.json
   └─ worldseed-ir/chunks/*.json
        ↓
JSON files / GLB / starter kit
```

The IR is intentionally separate from the public schema version. The current internal IR version is `1`, while the existing public JSON contracts remain schema `1.0`.

## Properties

- deterministic JSON key ordering for stable diffs and reproducible data files
- a single version migration boundary
- no new runtime dependency
- existing v1 export filenames and schemas remain compatible
- `worldseed-ir.json` is included as a developer-facing unified representation
- `worldseed-ir.index.json` is a lightweight spatial index using the same 300 m tiles as runtime rendering
- `worldseed-ir/chunks/*.json` carries tile-local semantic objects, road edges/nodes, and spawn points
- terrain metadata and other global records stay outside chunks to avoid duplication
- consumers can select nearby chunk descriptors before parsing tile-local data

When the internal representation changes, add a migration in `src/ir/world-ir.ts` rather than spreading compatibility logic across loaders and exporters.


## Chunked loading

The full `worldseed-ir.json` remains available for compatibility and tooling that prefers one document. Streaming consumers should start with `worldseed-ir.index.json`.

Each descriptor contains tile coordinates, local-meter bounds, object/road/spawn counts, and the path to one chunk. A chunk contains only data assigned to that tile. Road endpoint nodes are copied into the chunk that owns the corresponding edge so a chunk is independently useful.

Chunk selection uses tile-bounds padding, matching WorldSeed's renderer visibility policy. This deliberately loads a neighboring tile near a boundary rather than allowing visible objects to pop in late.

The chunk format is an **internal IR contract**, not a replacement for the public schema v1 files. The existing `worldseed.json`, `worldseed-objects.json`, `road-graph.json`, `spawn-points.json`, and `drive-route.json` remain unchanged.


## Lazy-reader API

`loadWorldSeedIrChunks(index, x, z, distanceMeters, read)` separates spatial selection from storage. The `read` callback receives only the paths selected for the requested local-meter position and range.

That means the same loader can be backed by browser `fetch()`, an extracted starter-kit directory, an IndexedDB cache, or another archive reader without changing the chunk-selection rules. Loaded chunks are checked against the descriptor ID before being returned.


## Geometry streaming

Structured-data chunks and render geometry use the same 300 m tile coordinate system.

- `worldseed-tiles.index.json` lists renderable geometry tiles.
- `worldseed-tiles/<x>_<z>.glb` contains base render geometry for one tile. Its descriptor can include `byteLength`, `vertexCount`, `geometryByteLength`, and `materialCount` hints.
- `worldseed-tiles/detail/<x>_<z>.glb` is optional and carries objects marked `worldseedDetail`, such as roofs, road markings, street furniture, and other close-range decoration. Its descriptor can include matching `detail*` byte/vertex/material hints.
- `worldseed-ir/chunks/<x>_<z>.json` carries the matching semantic, navigation, and spawn data when present.
- `terrain.glb` remains global because terrain continuity crosses tile boundaries.
- `city.glb` remains in the starter kit as a compatibility fallback.

The generated starter viewer loads `terrain.glb` once, then prioritizes tile jobs by distance from the current OrbitControls target. At most two GLB jobs run concurrently. Base tiles use a wider streaming radius; optional detail tiles use a shorter radius and a small priority penalty so nearby playable structure appears before decorative geometry. Distant tile scenes are removed and their geometry/material GPU resources are disposed. A queued or completed tile that is no longer desired is discarded instead of being attached to the scene.

The IR index exposes `geometryIndexPath` so tools that begin from structured data can discover the geometry tile index without hard-coding a second entry point.


## Predictive prefetch and cache

The generated starter viewer keeps visible work and predictive work separate.

- visible base/detail jobs remain distance-prioritized and capped at two concurrent GLB loads
- movement of the current view target is smoothed into a forward direction
- one or two base tiles in a narrow forward corridor can be prefetched before they enter the normal base radius
- prefetch downloads only the base GLB and matching IR chunk; it does not parse the GLB or attach anything to the scene
- prefetch runs only when it does not displace queued visible work
- GLB ArrayBuffers and IR chunk text are stored in IndexedDB via `idb-keyval`
- cache records expire after seven days
- cache keys include the export generator, generation timestamp, and radius so different exports do not reuse stale tile bytes
- old WorldSeed starter-cache namespaces on the same origin are removed on boot
- IndexedDB failure is non-fatal; the viewer falls back to normal network loading

This keeps network latency ahead of camera/player movement while leaving GLTF parsing and GPU upload on the normal visible-tile path.


## Live Drive prewarm

The WorldSeed application itself already owns generated geometry in CPU memory, so it does not need the starter kit's network/IndexedDB prefetch path. Instead, Drive mode publishes a lightweight motion hint from the fixed-step vehicle state:

- local-meter vehicle position
- signed travel direction derived from heading and forward/reverse speed
- absolute speed in meters per second

The runtime tile streamer uses that hint to select at most two base tiles in a narrow corridor ahead of the vehicle. Those base objects become visible slightly earlier than the normal camera-distance rule, which lets Three.js perform GPU upload before the vehicle reaches the tile. Detail objects are never pulled forward by this rule.

The look-ahead distance scales with speed and is capped, so stopped/slow vehicles do not keep unnecessary tiles active.


## Adaptive streaming budgets

WorldSeed uses three streaming tiers: `economy`, `balanced`, and `quality`.

Mobile devices, low-memory devices when that information is available, and low-core-count devices start at `balanced`. Other devices start at `quality`. The renderer then adjusts from measured frame rate rather than trusting the device label alone.

- below 48 FPS for two samples: drop one tier
- below 36 FPS: drop immediately
- 57 FPS or better for six samples: recover one tier
- hysteresis resets when a tier changes, preventing rapid oscillation

The budget controls:

- base-tile visibility distance
- detail-tile visibility distance
- Drive/predictive prefetch distance
- visible GLB concurrency
- background prefetch concurrency
- render DPR cap
- generated Starter Kit IndexedDB record count

Current cache caps are 20 records / 32 MB in `economy`, 40 records / 64 MB in `balanced`, and 72 records / 128 MB in `quality`. Starter Kit cache entries track last access and byte size, retain the existing seven-day TTL, and evict the oldest entries until both the record and byte budgets are satisfied whenever the tier drops or after batches of new writes.

This makes Safari/iPhone behavior conservative at startup while still allowing a capable device to recover visual range after sustained smooth rendering.


## Frame-time aware scheduling

Average FPS controls the longer-lived adaptive tier, while individual frame times control short-lived optional-work cooldowns.

- a frame at or above 28 ms starts a 10-frame optional-work cooldown
- a frame at or above 45 ms starts a 24-frame cooldown
- frames at 20 ms or below recover two cooldown steps at a time
- other healthy frames recover one step at a time

Base geometry is never blocked by this scheduler. It only postpones work that can safely arrive later:

- new detail geometry becoming visible in the live WorldSeed renderer
- detail GLB load/parse jobs in the generated starter viewer
- detail GLB parse jobs in the standalone export consumer
- generated starter-viewer background prefetch

Already-visible live detail stays visible during a spike, avoiding a quality flicker. Already-started asynchronous GLB work is allowed to finish rather than being discarded after the expensive parse has already begun.

The scheduler therefore reacts much faster than the multi-sample FPS tier while keeping structural/base world loading responsive.


## Parse-cost aware concurrency

Generated geometry descriptors record base/detail GLB byte sizes. The starter viewer combines those byte hints with measured `GLTFLoader.parseAsync()` time.

- base and detail maintain separate exponentially smoothed milliseconds-per-megabyte estimates
- before enough samples exist, conservative default rates are used
- a predicted parse of 18 ms or more is serialized
- if active estimated parse work plus the next candidate reaches 24 ms, the next parse also waits
- light jobs can still use the adaptive tier's two-job limit
- the standalone ZIP consumer uses the actual archived byte length when available, so even older indexes can be scheduled accurately
- download/cache time is not included in the learned parse rate; the timing specifically surrounds GLTF parsing

This complements the frame-time scheduler: cost prediction prevents likely spikes before a parse begins, while frame-time gating reacts to spikes that still occur.


## Split fetch and parse pipeline

The generated starter viewer separates visible-tile I/O from GLTF parsing.

- up to two visible GLB jobs can be fetching or waiting as fetched bytes ahead of the parse stage
- fetched base/detail bytes and the matching base IR chunk are held only until their parse job becomes eligible
- the parse stage still uses measured cost and adaptive concurrency, so a heavy GLB can serialize parsing without blocking the next visible network/IndexedDB read
- frame-time pressure can postpone ready detail jobs without blocking ready base jobs behind them
- visible loading and predictive prefetch share in-flight binary/text requests by normalized path, preventing duplicate network reads when a prefetched tile becomes visible mid-request
- stale ready jobs are dropped when the tile is no longer desired

The standalone ZIP consumer does not need a network fetch queue because its GLB bytes are already resident in the unzipped archive. It therefore keeps the cost-aware parse stage without adding an artificial fetch stage.


## GPU upload-aware activation

GLTF parsing and first-render GPU upload are treated as separate costs.

After a tile has parsed, the starter viewer and standalone consumer inspect the parsed scene's unique geometries and materials and estimate upload pressure from:

- position vertex count
- total BufferGeometry attribute/index byte size
- unique material count

Light scenes can be attached two per frame. Medium scenes (at least 180k vertices, 6 MB of geometry buffers, or 16 materials) wait one frame and are attached alone. Very heavy scenes (350k vertices, 12 MB, or 32 materials) wait two frames and are also attached alone.

Parsed scenes wait in a bounded upload-ready queue. Frame-time pressure may keep detail uploads waiting, but base work is allowed one extra slot so blocked detail cannot prevent structural geometry from progressing.

The live WorldSeed renderer applies the same thresholds before a base tile becomes visible for the first time or after its GPU resources were previously released. Heavy base tiles are activated at most one per frame. This spreads implicit Three.js buffer/material re-upload across frames instead of allowing several large tiles to become visible simultaneously.


### Per-session threshold learning

The 180k/350k vertex, 6/12 MB geometry-buffer, and 16/32 material thresholds are starting points rather than permanent device classifications.

WorldSeed maintains a rolling baseline from normal frames only. Frames above 28 ms are treated as outliers and do not raise that baseline. Whenever one or more parsed scenes are attached, only the next frame is treated as upload feedback, and the learned signal is the frame-time excess above the current baseline:

- upload excess of 24 ms or more: immediately multiply thresholds by 0.82
- two upload-feedback samples with 10 ms or more excess: multiply thresholds by 0.90
- five upload-feedback samples with 4 ms or less excess: multiply thresholds by 1.06
- the learned scale is clamped to 0.55–1.35

Lower threshold scales classify smaller tiles as medium/heavy, causing earlier staging. Higher scales let capable devices attach larger tiles without unnecessary delay.

The state is intentionally session-only. It resets for a new live world/starter page and for each standalone-consumer ZIP import rather than persisting to IndexedDB, because thermal state, browser conditions, and background load can change between sessions. Normal frames update only the baseline; they do not directly train the GPU threshold scale. This prevents a device that is already rendering at, for example, ~24 ms per frame from blaming a 31 ms post-upload frame entirely on GPU upload.


### Learned GPU cost prediction

Threshold scaling remains a safety guard, but after two upload-feedback samples WorldSeed also predicts the expected frame-time increase for each new scene.

Upload work is normalized into an approximate equivalent-megabyte value:

- geometry buffer bytes contribute directly in MB
- every 250k position vertices add one equivalent MB
- every 32 unique materials add one equivalent MB
- the minimum sample size is 0.25 equivalent MB to keep tiny scenes numerically stable

For each post-attach feedback sample, WorldSeed divides the baseline-relative upload excess by the combined equivalent MB attached in that frame. This yields a per-session milliseconds-per-equivalent-MB rate, updated with an exponential moving average.

The scheduler then predicts the next tile's upload overhead:

- predicted excess below 10 ms: no extra learned delay
- 10–24 ms: at least one-frame staging
- 24 ms or more: at least two-frame staging

The final delay is the stricter of the legacy vertex/byte/material threshold result and the learned-cost prediction. The learned predictor is not used until at least two samples exist, so startup behavior remains conservative and deterministic.

If two light scenes attach in one frame, their upload hints are combined and learned as one frame-level sample, matching the single observed frame-time result.


### GPU cost confidence and outliers

The learned milliseconds-per-equivalent-MB model carries an explicit confidence value.

- confidence starts at 0
- each accepted sample raises confidence toward 1.0
- six accepted samples reach full confidence
- predictions blend the conservative 1.6 ms/equivalent-MB default with the learned rate according to confidence

After two accepted samples, a new rate is treated as an outlier when it is more than 3× or less than one-third of the current learned rate. The first such sample is held out rather than changing the model or GPU threshold scale, and confidence is reduced slightly.

A second outlier is accepted only when it points in the same direction as the first one. This lets sustained thermal throttling or a real performance recovery update the model while preventing unrelated high/low spikes from masquerading as repeated evidence. Accepted repeated outliers are also clamped to at most 2× or 0.5× the current rate and use a smaller EMA weight.

Because threshold-scale learning is skipped for a rejected GPU-cost sample, a one-off GC pause or Safari scheduling stall cannot simultaneously distort both the continuous cost predictor and the discrete upload threshold scale.


## Incremental World Build

The chunked IR is also the dependency boundary for partial rebuilds.

Each IR chunk descriptor carries a deterministic canonical `contentHash`. The index also carries:

- `globalHash` for global/export-level data
- `geometryGlobalHash` for inputs that can invalidate render geometry across all tiles, currently style plus global semantic records
- `revisionHash` for the complete IR revision

`createWorldSeedIrPatchManifest(previous, next)` compares the hashes and reports added, changed, removed, and unchanged chunks. Older indexes without hashes are handled conservatively: their chunks are treated as changed rather than guessed unchanged.

`encodeWorldSeedIrPatchFiles()` emits a minimal IR patch set containing the new index, the patch manifest, only added/changed chunk files, and updated public road/spawn/semantic JSON when tile-local data changed. Global metadata/route files are included when the global hash changes.

### Stable object dependency graph

Full exports include `worldseed-ir.dependencies.json`. It is an internal dependency graph layered on top of the chunk index.

Semantic stable IDs use source identity rather than generated render IDs:

`semantic:<source>:<layer>:<sourceId>`

The graph also models road nodes, road edges, spawns, drive routes, and derived artifacts. Current dependency edges include:

- roof semantic objects → matching building semantic object
- road semantic objects → matching road-graph edges
- road edges → endpoint road nodes
- edge-bound spawns → their road edge
- route-bound spawns → their drive route
- tile geometry artifacts → tile-local semantic objects and road edges
- collider artifact → building semantic objects
- road-graph artifact → road nodes and edges
- spawn-points artifact → spawn nodes
- drive-route artifact → route node
- semantic-manifest artifact → semantic objects
- world-metadata artifact → metadata content

Every node has a canonical content hash that includes both its content and dependency IDs. `diffWorldSeedIrDependencyGraphs(previous, next)` finds added/changed/removed stable nodes, builds a reverse dependency closure across both revisions, and returns the impacted derived artifacts.

This makes invalidation more precise than chunk hashes alone. A spawn-only edit still changes its IR chunk, but does not invalidate the tile geometry GLB or colliders. A building edit invalidates its geometry tile, the semantic manifest, and colliders without forcing road/spawn/route artifacts to rebuild.

When a previous dependency graph is unavailable, patch generation falls back to the conservative chunk-level behavior for compatibility with older exports.

### Incremental geometry

IR chunk IDs and geometry tile IDs share the same 300 m coordinate space. `createGeometryIncrementalPlan()` converts the IR patch into a geometry rebuild plan.

A tile is regenerated when:

- its matching `artifact:geometry:<tileId>` is impacted by the stable object dependency graph (or, for legacy bases without a dependency graph, its IR chunk was added or changed)
- it is a new geometry tile
- its base/detail structure or layer summary changed
- `geometryGlobalHash` changed
- the geometry `recipeVersion` changed
- a caller explicitly forces the tile

Unchanged tile descriptors reuse previous base/detail GLB byte-length metadata and their GLBs are omitted from the patch archive. Removed tiles and obsolete detail GLBs are represented as explicit delete paths.

The geometry index has a separate recipe version so a renderer/export-algorithm change can invalidate all geometry even when source IR content is unchanged.

### Stable geometry sub-batches

Geometry recipe v2 adds a second incremental boundary inside each 300 m tile. Buildings, roofs, areas, and road geometry are assigned to one of four deterministic sub-batches using a stable hash of the source feature ID. The hash slot does not depend on insertion order, so adding an unrelated object does not reshuffle existing objects between batches.

Each geometry tile descriptor can carry a `batches` array. A batch records:

- stable batch ID
- base/detail role and semantic layer
- source feature IDs
- stable IR dependency IDs
- object, vertex, geometry-byte, and material counts
- an optional override GLB `path` and measured `byteLength`

Full exports still store normal whole-tile base/detail GLBs. Batch GLBs appear only when a v2 incremental patch replaces a changed sub-batch. The geometry index in the next build state keeps those override paths, so later patches can chain without flattening the tile.

The incremental planner is hybrid:

- new tiles, geometry-global changes, forced tiles, or recipe changes regenerate the whole tile
- old baselines without batch metadata fall back to whole-tile invalidation
- recipe-v2 baselines compare stable batches and regenerate only batches whose dependencies or geometry structure changed
- removed batches are emitted separately without rebuilding unaffected batches

The geometry recipe version is now `2`. Moving from recipe 1 to recipe 2 intentionally performs one conservative full-tile rebuild; after that build state is saved, later edits can use sub-batch granularity.

The top-level incremental patch contract is version `2` when batch overrides may be present. The standalone consumer accepts patch v1 and v2. A v2 consumer keeps the original full tile as its baseline, retires baked-in nodes for replaced/removed batch IDs, and layers the current override GLBs on top. The visible affected tile is reloaded from the local archive so resource ownership remains simple, but the network/export payload can remain sub-batch-sized.

### Portable build state

Full kit exports and incremental patch archives include `worldseed-build-state.json`. The app can also download this file directly through **Build state**.

The build state contains only:

- the current IR index
- the stable object dependency graph
- the current geometry index and recipe version

It intentionally does not contain the full world IR document, GLB bytes, or exact WGS84 origin. This makes it much smaller than a starter-kit ZIP and suitable as the preferred baseline on memory-constrained mobile browsers.

The next **Incremental patch** operation can read the JSON directly without unzipping the previous full kit. Older kit ZIPs remain supported: the app reads their indexes and dependency graph when present, and falls back conservatively when the dependency graph is absent.

Every new full kit and every patch archive carries the next build state, so incremental builds can form a revision chain:

`full export → build state A → patch A→B → build state B → patch B→C`

`parseWorldSeedBuildState()` validates the internal format/version and the embedded IR, dependency, and geometry index formats before the state is accepted.

### Patch preview

`createWorldSeedPatchPreview()` runs the same IR dependency diff and geometry incremental planner used by patch export, but stops before GLB serialization. It reports:

- added/changed/removed stable object-node counts when a dependency graph baseline is available
- changed IR chunk count
- geometry tile IDs that will be regenerated or removed
- stable geometry sub-batches that will be replaced/removed
- reusable tile and sub-batch counts
- whether metadata, semantic manifest, road graph, spawn points, drive route, colliders, or terrain will be refreshed
- an estimated uncompressed payload size

For existing tiles with measured GLB byte lengths in the previous build state, geometry size estimation scales the previous measured GLB size by the ratio of current to previous geometry-buffer bytes. New or legacy tiles fall back to vertex, geometry-buffer, and material pressure. Collider and terrain estimates use their current geometry upload statistics.

The estimate deliberately describes payload before ZIP compression; it is not presented as an exact archive size.

The app recalculates Patch Preview when the privacy option changes, because including the exact origin can turn metadata into an affected artifact even when scene geometry is unchanged.

### Unified patch ZIP

`createWorldSeedIncrementalPatchArchive()` combines the IR patch and geometry patch into one archive. A patch contains:

- `worldseed.patch.json`
- `worldseed-ir.patch.json`
- the new `worldseed-ir.index.json`
- only added/changed IR chunks
- updated public structured-data files when required
- `worldseed-tiles.patch.json`
- the new `worldseed-tiles.index.json`
- regenerated whole-tile base/detail GLBs only when whole-tile fallback is required
- v2 `worldseed-batches/.../*.glb` overrides for changed stable sub-batches
- explicit tile and sub-batch removal records
- refreshed colliders only when the collider dependency artifact is impacted (legacy bases conservatively refresh on tile-local IR changes)
- refreshed terrain when geometry-global inputs changed

`city.glb` remains a compatibility fallback for full exports and is intentionally not rebuilt into every incremental patch. The top-level patch manifest flags when that fallback would need a full refresh.

### Hot patch consumer

The standalone export consumer accepts a full export first and then an incremental patch ZIP.

Before applying it, the consumer requires the loaded IR `revisionHash` to equal the patch `fromRevisionHash`. This prevents applying a patch to the wrong base world.

When accepted, the consumer cancels stale tile jobs, invalidates tiles named by whole-tile or sub-batch changes, removes obsolete tile/batch paths, merges patch files, swaps the IR/geometry indexes, refreshes terrain and structured-data overlays when included, and restarts streaming. For recipe-v2 batch patches, the full tile remains the baseline while override GLBs replace only current batch IDs.

This turns the REDox-style IR from an internal normalization layer into a dependency graph for reproducible partial world updates.
