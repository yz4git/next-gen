# WorldSeed launch kit

WorldSeed is looking for independent downstream users who can validate the schema-v1 export contract in real projects. Do not claim adoption that cannot be linked to a public artifact.

## One-line description

**WorldSeed turns open geospatial data into playable, exportable 3D worlds with GLB geometry, semantic objects, colliders, routable road graphs, spawn points, routes, and versioned JSON Schema.**

## Recommended launch links

- Latest release: https://github.com/yz4git/next-gen/releases/tag/v0.9.1
- Five-minute trial: https://github.com/yz4git/next-gen/blob/main/docs/TRY_WORLDSEED.md
- Schema policy: https://github.com/yz4git/next-gen/blob/main/docs/SCHEMA_VERSIONING.md
- Early-adopter issue: https://github.com/yz4git/next-gen/issues/19
- Cross-runtime good first issue: https://github.com/yz4git/next-gen/issues/20

## Show HN draft

Title: **Show HN: WorldSeed – turn open map data into game-ready Three.js cities**

WorldSeed is an MIT-licensed browser tool that turns a coordinate into a local-meter 3D world using Overture Maps, OpenStreetMap, Mapzen terrain, and optional local PLATEAU CityGML. The interesting part for me is the export boundary: v0.9.x ships GLB geometry plus semantic objects, colliders, a routable road graph, spawn points, routes, provenance, and versioned JSON Schema. There is a standalone consumer that imports only the public ZIP contract and no WorldSeed runtime code. I am looking for independent integrations in other games, simulations, engines, and DCC tools to find what the v1 contract gets wrong.

## Three.js forum draft

Title: **WorldSeed v0.9.x: game-ready city exports + standalone Three.js consumer**

I have been building WorldSeed, an MIT-licensed browser project that converts open geospatial data into local-meter Three.js worlds. The current release focuses on interoperability rather than only the built-in renderer: exported kits contain city/terrain/collider GLBs, semantic objects, routable road graphs, spawn points, drive routes, attribution, and JSON Schema v1. A standalone consumer example is included and a privacy-safe demo export is available so the contract can be tested without setting up the generator. Feedback from people who try the export in another Three.js project would be especially useful.

## Reddit / community draft

**WorldSeed v0.9.x — open geospatial data to reusable 3D game-world exports**

I am looking for early users of WorldSeed's export format. It produces a playable browser city from open geospatial sources and exports GLB geometry together with semantic objects, colliders, road topology, spawn points, routes, attribution, and versioned schemas. The repo includes a standalone downstream consumer and a synthetic demo export. I would especially like feedback from Babylon.js, Godot, Blender, simulation, or procedural-game workflows. Public reproducible integrations can be listed in ADOPTERS.md.

## What counts as adoption evidence

A GitHub star is welcome but is not counted as integration evidence. Prefer a public repository, demo, benchmark, article with source, adapter, validator, or other inspectable artifact that consumes the export contract.
