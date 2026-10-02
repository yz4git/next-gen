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
JSON files / GLB / starter kit
```

The IR is intentionally separate from the public schema version. The current internal IR version is `1`, while the existing public JSON contracts remain schema `1.0`.

## Properties

- deterministic JSON key ordering for stable diffs and reproducible data files
- a single version migration boundary
- no new runtime dependency
- existing v1 export filenames and schemas remain compatible
- `worldseed-ir.json` is included as a developer-facing unified representation

When the internal representation changes, add a migration in `src/ir/world-ir.ts` rather than spreading compatibility logic across loaders and exporters.
