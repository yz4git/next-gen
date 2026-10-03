# WorldSeed export consumer example

This is a **standalone downstream application**. It does not import code from `src/` and does not depend on WorldSeed's renderer, data providers, or internal object model.

It consumes only the public files created by **Three.js kit** export:

- `city.glb`
- `worldseed.json`
- `worldseed-objects.json`
- `road-graph.json`
- `spawn-points.json`
- `drive-route.json`
- `worldseed-tiles.index.json`, `worldseed-tiles/*.glb`, and optional `worldseed-tiles/detail/*.glb` when present
- `worldseed-ir.index.json` and `worldseed-ir/chunks/*.json` when present
- `schemas/v1/*.schema.json`

## Fastest trial

If you do not have your own WorldSeed export yet, download the privacy-safe synthetic sample:

https://github.com/yz4git/next-gen/releases/download/v0.9.1/worldseed-demo-export-v0.9.1.zip

A prebuilt static copy of this consumer is also published at:

https://github.com/yz4git/next-gen/releases/download/v0.9.1/worldseed-export-consumer-static-v0.9.1.zip

Serve the extracted static consumer with any local HTTP server and drop the demo export ZIP onto it.

## Run from source

```bash
cd examples/export-consumer
npm install
npm run dev
```

Export a Three.js kit from WorldSeed and drop the resulting ZIP onto the example.

The consumer overlays the routable road graph, shows vehicle/pedestrian spawn points, and draws the active drive route. New exports use the geometry tile index to parse only nearby tile GLBs into the Three.js scene, prioritize the nearest jobs, adapt base/detail range, DPR and one/two-job parsing concurrency from measured FPS, defer new detail parses briefly after frame-time spikes, learn parse cost from actual ZIP byte sizes and measured GLTF parse timings so heavy jobs serialize while light jobs can stay two-way, stage parsed scenes through a GPU upload queue so vertex/material-heavy tiles attach at most one per frame and learn stricter/looser upload thresholds from post-attach frame times for the current import, add optional detail GLBs only at closer range, and dispose distant GPU resources; older exports fall back to `city.glb`. It rejects JSON contract versions other than schema `1.0`.

## Why this example exists

WorldSeed's goal is not only to display a city in its own UI. The export contract is intended to be usable by independent games, simulations, tools, and renderers. This directory is deliberately isolated from the WorldSeed application code to exercise that boundary.

If you publish another integration, please open an issue titled **Integration report** and link the project. Real downstream usage helps stabilize the contract.
