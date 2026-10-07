# Changelog

## Unreleased

- Added standalone-consumer patch preflight to verify revision chains and all referenced tile/batch assets before mutating live scenes; pre-parse visible sub-batch GLBs and terrain so truncated files cannot partially hot-swap the street.
- Fixed in-place geometry reverts: previously overridden baked sub-batches are restored when a follow-on patch removes their overrides, preserving their original hierarchy.

- Added a REDox-inspired, dependency-free WorldSeed IR v1 that normalizes metadata, semantic objects, road graphs, spawn points, and drive routes behind one versioned intermediate representation.
- Added deterministic per-chunk IR content hashes plus global, geometry-global, and revision hashes for dependency-aware incremental builds.
- Added minimal IR patch manifests/files and IR-driven geometry patch planning so unchanged 300 m tile GLBs can be reused instead of regenerated.
- Added geometry recipe-version invalidation, unified `worldseed-patch.zip` creation, explicit removed-path handling, and standalone-consumer hot patch application with base-revision validation.
- Added a stable object dependency graph with source-derived semantic IDs, node/dependency hashes, reverse impact propagation, and artifact-specific invalidation for geometry, colliders, road graph, spawns, route, semantic manifest, and metadata.
- Incremental geometry now uses impacted `artifact:geometry:*` nodes when dependency data is available, so spawn-only changes can reuse existing tile GLBs; collider regeneration is also skipped unless building dependencies are impacted.
- Added an in-app **Incremental patch** export flow that reads a previous Three.js kit ZIP locally in the browser and emits the current-world patch.
- Added portable `worldseed-build-state.json` baselines containing the IR index, dependency graph, and geometry index; full kits and patches bundle the next state, the app can download it separately without exact-origin metadata, and Incremental patch now prefers this small JSON over reopening a large previous kit ZIP.
- Added **Patch Preview** before incremental export, showing stable-object changes, geometry rebuild/reuse counts, affected artifacts, removed tiles, and estimated uncompressed payload size; the preview recomputes when exact-origin export changes.
- Full-export build states now retain measured per-tile GLB byte lengths so later patch-size estimates can scale from real previous payloads instead of geometry heuristics alone.
- Added stable four-way geometry sub-batches keyed by feature-ID hashes for buildings, roofs, areas, and roads, with per-batch stable dependency IDs and geometry/upload statistics in the geometry index.
- Added incremental patch contract v2 with replacement/removal sub-batch GLBs and persistent override paths, allowing recipe-v2 edits such as a single building change to reuse the surrounding 300 m tile instead of re-exporting it wholesale.
- Bumped the geometry recipe to v2; recipe-v1 baselines conservatively rebuild tiles once, then subsequent build states use sub-batch patching. The standalone consumer accepts v1/v2 patches and reconciles batch overrides while preserving the original full tile as a baseline.
- The standalone consumer now hot-swaps changed v2 geometry batches directly inside already-loaded tile scenes, targeting only batch IDs named by the patch instead of unloading/reloading the surrounding tile.
- Patch Preview now reports full-tile and sub-batch rebuild/reuse counts and includes sub-batch GLB estimates in the pre-compression payload estimate.
- Starter-kit exports now route structured data through the IR, emit deterministic JSON key ordering, and include `worldseed-ir.json` while preserving all existing schema v1 filenames and semantics.
- Added an explicit IR migration boundary plus regression tests for round-tripping, deterministic serialization, and unsupported versions.
- Added 300 m chunked IR exports with a lightweight spatial index, tile-local semantic objects, road graph subsets, spawn data, boundary-aware chunk selection, and a storage-agnostic lazy chunk reader.
- Added per-tile GLB geometry exports, a geometry tile index, transform-preserving tile extraction, and a starter viewer that lazy-loads nearby geometry plus matching IR chunks and disposes distant GPU resources.
- Added nearest-first tile scheduling with a two-load concurrency cap, stale-job dropping, and frame-yielded ZIP parsing to reduce mobile CPU/GPU spikes.
- Added directional low-priority prefetch for one or two forward base tiles plus matching IR chunks, backed by a seven-day export-namespaced IndexedDB cache in generated starter kits.
- Drive mode now publishes vehicle motion hints so the live runtime can prewarm at most two base geometry tiles ahead of forward or reverse travel without pulling detail geometry forward.
- Added adaptive streaming budgets driven by device hints and measured FPS, scaling base/detail range, DPR, load/prefetch concurrency, forward look-ahead, and Starter Kit IndexedDB record/byte cache limits with hysteresis and LRU-style eviction.
- Added a frame-time aware scheduler that keeps base geometry responsive while temporarily deferring new detail and background prefetch work after 28 ms / 45 ms frame spikes.
- Added a parse-cost aware scheduler using exported GLB byte sizes and measured base/detail parse milliseconds-per-megabyte to serialize heavy jobs while retaining two-way concurrency for light tiles.
- Added a split visible-tile fetch and parse pipeline in generated starter kits, buffering up to two fetched jobs ahead of cost-aware parsing and sharing in-flight requests with predictive prefetch.
- Added GPU upload-aware staging using per-tile vertex/geometry-byte/material hints and parsed-scene measurements, limiting heavy scene attachments and live runtime heavy base activations to one per frame.
- Added per-session GPU upload threshold learning from post-attach frame-time excess above a rolling normal-frame baseline, reducing false GPU blame from unrelated or generally slow frames.
- Added a milliseconds-per-equivalent-MB GPU cost model combining geometry bytes, vertices, and materials; after two samples it predicts upload overhead and adds one/two-frame staging when the expected GPU cost reaches 10/24 ms.
- Added confidence-weighted GPU cost prediction with single-outlier holdout, same-direction repeated-outlier confirmation, robust clamping, and threshold-learning suppression for rejected samples.
- Split exported tile geometry into wider-range base GLBs and optional close-range detail GLBs while keeping terrain global and `city.glb` as a compatibility fallback.
- Distant runtime tiles now release GPU geometry/material resources outside a hysteresis margin while retaining CPU-side data for automatic re-upload when the tile becomes visible again.

## 0.9.1 — Schema validation hotfix

- Fixed the road-graph v1 JSON Schema node definition so node IDs and edge references validate correctly under Draft 2020-12 `additionalProperties` rules.
- Updated published schema `$id` URLs and generated version metadata for the patch release.

## 0.9.0 — Interoperable City Export

- Added versioned JSON Schema v1 contracts for world metadata, semantic objects, road graphs, spawn points, and drive routes, and bundled them into starter-kit exports.
- Added a standalone export-consumer example that reads a WorldSeed ZIP without importing WorldSeed application code.
- Added a verified-adopter registry and Integration report issue template for reproducible downstream usage.
- Added dedicated terrain-following junction patches for multi-road intersections and sharp two-road connections, replacing stacked road strips at dense intersections.
- Added trimmed road mouths, curved corner-sidewalk meshes, and per-arm crosswalk geometry to reduce close-range overlap, z-fighting, and abrupt sidewalk transitions.
- Added adaptive Mapzen DEM sampling at 65×65, 129×129, or 257×257 based on world radius, keeping live terrain near an ~8 m source-sample target at larger seeds.
- Added progressive high-resolution terrain replacement from the already-cached DEM after the first city frame is available.
- Added mode-aware terrain LOD: Drive/Walk keep full terrain detail while distant Orbit/Drone views reduce triangle work without changing exported geometry.
- Added Data Quality terrain coloring where slope moves from cool to warm colors, elevation changes lightness, and facet density exposes the active terrain LOD.
- Exposed the live terrain source grid and approximate meter-per-sample resolution in world source details.
- Added regression coverage for adaptive sampling, terrain mesh density, LOD decimation, and quality colors.

## 0.8.2 — Mobile WORLD panel visibility

- Moved the panel toggle into the mobile workspace layer so the green CLOSE button stays above the open WORLD panel.
- Kept the WORLD reopen control visible after closing the panel.

## 0.8.1 — Drive controls and cinematic Drone

- Made the WORLD settings panel independently closable and reopenable in every explore mode.
- Reversed the virtual-pad and keyboard steering mapping to match the requested visual turn direction.
- Made holding BRAKE / REVERSE after the car stops engage bounded reverse motion.
- Replaced the slow Drone orbit with cinematic swoops, altitude changes, moving focus, banking, and FOV drift.

## 0.8.0 — Landmark presets and Drone camera

- Replaced mobile left/right steering buttons with a continuous virtual steering pad and thumb-sized control.
- Added famous-landmark presets across Japan, Europe, North America, the Middle East, and Australia.
- Added an automatic Drone camera mode with a slow orbit, height drift, and shareable mode state.

## 0.7.1 — Mobile Drive polish

- Added an iPhone Drive focus mode that hides the large world panel while driving, with a compact toggle to reopen it.
- Enlarged and repositioned touch steering and pedal controls for thumb-sized targets and safe-area insets.
- Corrected left/right steering direction for both touch buttons and keyboard arrows/A-D input.
- Bumped the service-worker shell cache so mobile clients receive the updated controls.

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
