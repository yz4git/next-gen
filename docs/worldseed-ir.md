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
