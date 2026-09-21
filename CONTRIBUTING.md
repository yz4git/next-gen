# Contributing to WorldSeed

Thanks for helping grow WorldSeed. The project aims to make public geospatial data directly useful in games, simulations, and browser-based 3D tools while preserving provenance, attribution, and privacy boundaries.

## Before you start

1. Check existing issues before opening a duplicate.
2. For larger provider, export-format, or architecture changes, open an issue first so the data contract can be discussed.
3. Create a focused branch from `main`.
4. Run `npm install`, then `npm run validate` before opening a pull request.

## Contribution rules

- Keep provider adapters separate from rendering code.
- Include a small fixture-based test for provider parsing or normalization changes.
- Preserve attribution and source metadata through normalization and export.
- Do not add dependencies on proprietary map imagery, scraped map geometry, undocumented endpoints, or data whose reuse terms are unclear.
- Keep exact coordinates opt-in in sharing and exports.
- Prefer deterministic output when the same seed and source data are used.
- Document changes to exported files or semantic fields because downstream tools may depend on them.

## Good first contributions

- Additional deterministic demo seeds
- Accessibility and keyboard-navigation improvements
- Output-size and performance profiling
- More roof-shape fixtures
- Better multipolygon edge cases
- Starter-kit integration examples for common Three.js game patterns
- Small documentation fixes around attribution or provider setup

## Pull requests

Please include:

- what problem the change solves;
- how you tested it;
- whether it changes generated geometry, export files, provider requests, privacy behavior, or attribution;
- screenshots or small exported fixtures when they make the change easier to review.

Small, focused pull requests are preferred.

## Reuse reports are valuable too

If you use WorldSeed in another open-source project, you do not need to contribute code. Opening an issue that links to a reproducible integration, demo, or repository helps document real-world usage and informs the export contract.

See [docs/REUSE.md](docs/REUSE.md) for current integration paths.
