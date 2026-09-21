# WorldSeed v0.9.0 — Interoperable City Export

WorldSeed v0.9.0 turns the project from a browser city demo into a more explicit open interchange layer for game-ready geospatial worlds.

## Highlights

- **Versioned export contract** — JSON Schema v1 for metadata, semantic objects, road graphs, spawn points, and drive routes.
- **Schemas ship with every starter kit** — exported `worldseed.json` links to the exact relative schema files included in the ZIP.
- **Standalone consumer example** — `examples/export-consumer/` imports a WorldSeed ZIP without using WorldSeed runtime code, then renders the city, road graph, spawns, and route.
- **Dense-city road quality** — terrain-following junction patches, trimmed road mouths, curved sidewalk corners, and per-arm crosswalks reduce overlap and z-fighting at intersections such as Shibuya.
- **Drive and Drone reliability** — collision-safe vehicle spawns, dense-city Drone clearance, and improved iPhone landscape HUD layout.
- **Export geometry reliability** — normalized geometry batching removes mixed-attribute merge failures.
- **Terrain-following road detail** — roads, sidewalks, and markings are sampled in shorter terrain-aware segments instead of long planar strips.
- **OpenStreetMap fallback hardening** — configurable Overpass endpoint plus POST/GET retry behavior.

## Export contract

The Three.js kit contains:

- `city.glb`
- `terrain.glb`
- `colliders.glb`
- `worldseed.json`
- `worldseed-objects.json`
- `road-graph.json`
- `spawn-points.json`
- `drive-route.json`
- `schemas/v1/*.schema.json`
- `ATTRIBUTION.md`
- a minimal Vite + Three.js viewer

See `docs/SCHEMA_VERSIONING.md` for compatibility rules.

## For downstream developers

The project now maintains `ADOPTERS.md` and an **Integration report** issue template. Public integrations are listed only after a reproducible artifact is provided; the project's own consumer example is not counted as external adoption.

## Status

WorldSeed remains early-stage. Provider availability, dense-city visual fidelity, and export ergonomics will continue to evolve. Schema-major changes will use a new contract family rather than silently changing v1 semantics.
