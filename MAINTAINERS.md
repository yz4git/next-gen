# Maintainers

WorldSeed is currently maintained by:

- **yz4git** — primary maintainer

## Maintainer responsibilities

The primary maintainer is responsible for:

- issue triage and prioritization;
- pull-request review and merge decisions;
- release preparation and release notes;
- export-schema compatibility and deprecation policy;
- geospatial provider adapters and attribution requirements;
- privacy-sensitive behavior around coordinates and exports;
- security reports and dependency updates;
- CI, browser/mobile compatibility, and reproducible regression tests;
- reviewing public downstream integration reports before listing them in `ADOPTERS.md`.

## Decision model

WorldSeed currently uses a maintainer-led model. Small, well-scoped fixes may be merged after review and CI. Changes that affect the public export contract, privacy behavior, attribution, provider usage, or security boundaries should be discussed in an issue before implementation.

Compatibility-impacting decisions are documented in:

- [MAINTENANCE.md](MAINTENANCE.md)
- [docs/SCHEMA_VERSIONING.md](docs/SCHEMA_VERSIONING.md)
- [SECURITY.md](SECURITY.md)
- [PRIVACY.md](PRIVACY.md)

## Contributions

External contributors do not need commit access. Focused pull requests, reproducible bug reports, integration reports, schema feedback, and provider fixtures are all useful maintenance contributions.

If additional maintainers join, this file should be updated with their public GitHub identity and responsibility areas.
