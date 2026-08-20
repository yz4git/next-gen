# Changelog

## 0.7.0 — Drive Any City

- Added a routable local-meter road graph from Overture Transportation segments and connectors, with OpenStreetMap fallback.
- Added arcade vehicle physics, a chase camera, keyboard and touch controls, collision handling, and off-road recovery.
- Added deterministic time-attack routes, checkpoints, local best times, and explicit exact-route sharing.
- Added tiled sidewalks, lane markings, crosswalks, street trees, lights, and signs.
- Expanded the starter kit with separate terrain and collider GLBs plus road graph, spawn point, and drive route manifests.

## 0.6.0 — PLATEAU LOD import

- Added local-only PLATEAU CityGML import for EPSG:6697 LOD1 solids and LOD2 semantic surfaces.
- Preserved Ground, Wall, Roof, Closure, and fallback surface classes through rendering and semantic export.
- Added a 150 MB browser safety cap, 1 km world clipping, PLATEAU attribution, and LOD regression fixtures.

## 0.5.0 — Tiled runtime streaming

- Re-batched buildings, roofs, roads, and areas into stable 300 m world tiles.
- Added mode-aware distance streaming for base and detail meshes while preserving full-world exports.
- Added active/total tile telemetry and tile IDs to semantic objects.

## 0.4.0 — Semantic game objects

- Added stable Terrain, Areas, Roads, Buildings, and Roofs scene layers.
- Added `worldseed-objects.json` with privacy-safe IDs, properties, local centers, and bounds.
- Attached source feature IDs to optimized GLB batches and the starter runtime.

## 0.3.0 — Roof meshes

- Added flat, gabled, hipped, and skillion roof geometry.
- Added provider roof-height, shape, and color handling with deterministic fallbacks.

## 0.2.0 — Terrain runtime

- Added Mapzen Terrarium elevation sampling, local terrain meshes, and attribution.
- Added terrain-following roads, areas, buildings, and Walk/Fly controls.
- Added deterministic offline-demo terrain and a flat fallback when elevation tiles fail.

## 0.1.1 — Public Safety Update

- Added just-in-time location disclosure, explicit sharing choices, privacy-safe export defaults, visible attribution, local-data clearing, request cooldowns, and coordinate-safe service-worker caching.
