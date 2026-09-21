# WorldSeed export schema versioning

WorldSeed v0.9.0 publishes machine-readable JSON Schema files for every JSON document in the Three.js starter-kit export.

## Current contract

The current contract family is **v1**, represented by `schemaVersion: "1.0"` where the exported document already carries a schema version.

- `schemas/v1/worldseed.schema.json`
- `schemas/v1/worldseed-objects.schema.json`
- `schemas/v1/road-graph.schema.json`
- `schemas/v1/spawn-points.schema.json`
- `schemas/v1/drive-route.schema.json`

The same files are copied into each exported starter-kit ZIP under `schemas/v1/`. `worldseed.json` contains relative paths to all five schemas.

## Compatibility policy

WorldSeed treats the first component of the schema version as the compatibility boundary.

- **v1.x additive changes** may add optional fields, enum values where consumers are expected to ignore unknown values, or additional files that do not change existing field meaning.
- **v2.x breaking changes** are required for removing or renaming required fields, changing coordinate semantics, changing units, or changing the meaning/type of an existing field.
- Export consumers should select behavior from `schemaVersion`, not from the WorldSeed application version.
- Application releases and schema releases are intentionally decoupled. WorldSeed v0.9.0 still exports schema v1.

## Coordinates and units

Unless a schema says otherwise, exported gameplay coordinates are local meters:

- **X** increases east.
- **Y** increases up.
- **Z** increases south.

Exact geographic origin is optional. Privacy-safe exports set `origin` to `null` while preserving the local-meter geometry and gameplay data.

## Consumer guidance

Consumers should validate JSON at import boundaries and then rely on the documented contract rather than renderer internals. A standalone consumer example is available in `examples/export-consumer/`; it reads a WorldSeed starter-kit ZIP without importing WorldSeed application code.
