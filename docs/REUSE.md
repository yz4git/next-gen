# Reusing WorldSeed

WorldSeed is intended to be useful outside the browser UI. A generated seed can be exported as geometry plus structured local-meter gameplay data so another project can treat the city as an input asset rather than a screenshot.

## Export bundle

The starter-kit ZIP currently contains:

| File | Intended downstream use |
| --- | --- |
| `city.glb` | Complete rendered world for a viewer, prototype, or DCC import |
| `terrain.glb` | Terrain-only geometry |
| `colliders.glb` | Merged building collision boxes |
| `worldseed.json` | Seed metadata, source summary, radius, coordinate-system details, and statistics |
| `worldseed-objects.json` | Stable semantic object records and local bounds |
| `road-graph.json` | Routable connector topology and road properties |
| `spawn-points.json` | Collision-safe vehicle and pedestrian starts |
| `drive-route.json` | Deterministic checkpoint route for the current seed |
| `ATTRIBUTION.md` | Attribution generated for the selected source data |
| Vite + Three.js viewer | Minimal example that loads the exported world |

Exact-origin metadata is omitted by default unless the user explicitly opts in.

## Integration patterns

### 1. Three.js game prototype

Use `city.glb` for rendering, `colliders.glb` for collision setup, and `spawn-points.json` for initial actors. Use `road-graph.json` when vehicles or route-based NPCs need street topology.

### 2. Semantic simulation

Use `worldseed-objects.json` instead of deriving meaning from triangle groups. Objects retain semantic layer information and local-meter bounds that can be used for queries, placement, or simulation rules.

### 3. Custom renderer

Ignore the bundled viewer and load the exported GLBs and JSON files in your own runtime. The world uses local coordinates with X east, Y up, and Z south.

### 4. Local PLATEAU workflow

PLATEAU CityGML can be imported locally in the browser. Standard-mesh files are recommended. The file is parsed in memory and is not uploaded by WorldSeed.

## Attribution and source terms

WorldSeed source code is MIT-licensed, but generated world data remains subject to the licenses and attribution requirements of its underlying providers. Keep the generated `ATTRIBUTION.md` with redistributed exports and review provider-specific terms for your region and use case.

## Share an integration

Real-world reuse helps stabilize the export contract. If you publish an open-source integration, demo, benchmark, or adapter, open an issue with:

- a link to the project;
- which WorldSeed export files you use;
- the runtime or engine;
- any format or performance friction you encountered.

Please do not report private project URLs or exact location data that you do not want to disclose.
