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
- `worldseed-tiles/<x>_<z>.glb` contains base render geometry for one tile.
- `worldseed-tiles/detail/<x>_<z>.glb` is optional and carries objects marked `worldseedDetail`, such as roofs, road markings, street furniture, and other close-range decoration.
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

Current cache caps are 20 records in `economy`, 40 in `balanced`, and 72 in `quality`. Starter Kit cache entries are LRU-like using a last-access timestamp, retain the existing seven-day TTL, and are trimmed whenever the tier drops or after batches of new writes.

This makes Safari/iPhone behavior conservative at startup while still allowing a capable device to recover visual range after sustained smooth rendering.
