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
