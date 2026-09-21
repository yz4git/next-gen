# WorldSeed v0.9.1 — Schema validation hotfix

This patch fixes the published road-graph JSON Schema without changing the v1 data contract.

## Fixed

- Reworked the `road-graph.json` node schema so `id`, `x`, `y`, `z`, and `edgeIds` validate correctly under Draft 2020-12.
- Updated schema `$id` URLs to the v0.9.1 source tag.
- Updated generated WorldSeed version metadata to 0.9.1.

## Compatibility

The exported data contract remains **schemaVersion 1.0**. Existing v0.9.0 export data remains compatible; this release corrects the machine-readable validator definition.

For new integrations, use v0.9.1 or later.
