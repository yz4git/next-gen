# Maintenance policy

WorldSeed is an actively maintained early-stage open-source project. This document describes the routine work used to keep releases, integrations, schemas, providers, and browser behavior reproducible.

## Issue triage

Issues are reviewed for:

1. reproducibility;
2. impact on generated geometry or gameplay;
3. impact on the public export contract;
4. privacy, attribution, or security impact;
5. whether the issue is provider-specific or deterministic;
6. whether a regression fixture can be added.

Public integration reports are verified before being added to `ADOPTERS.md`. Stars, clones, downloads, or private conversations are not treated as verified downstream adoption.

## Pull-request review

A pull request should explain what it changes, how it was tested, and whether it affects:

- generated geometry;
- exported files or JSON fields;
- geospatial provider requests;
- attribution;
- exact-coordinate handling;
- browser/mobile behavior;
- security boundaries.

`npm run validate` is the baseline repository check. Security-sensitive changes should also pass the Security audit workflow.

## Release process

WorldSeed follows semantic versioning for the application release line.

Before a release:

1. update `package.json` and generated version metadata;
2. update `CHANGELOG.md`;
3. run `npm run validate`;
4. validate exported schema documents and the standalone consumer;
5. verify privacy-safe export defaults;
6. publish release notes and release assets;
7. confirm the published tag and downloadable artifacts.

Patch releases may correct validators, documentation, packaging, or compatible behavior without changing schema semantics.

## Export-contract compatibility

The JSON export contract has an independent schema version. Application releases and schema versions are intentionally separate.

Current contract:

- application: v0.9.x
- export schema: `1.0`

Within schema v1:

- additive optional fields are allowed;
- existing field meaning should not change silently;
- removing or renaming required fields requires a new major schema version;
- consumers must not depend on internal `src/` modules;
- machine-readable schemas live under `schemas/v1/`.

See [docs/SCHEMA_VERSIONING.md](docs/SCHEMA_VERSIONING.md).

## Provider maintenance

Provider integrations must preserve provenance and attribution through normalization and export.

When a provider changes:

- prefer public documented endpoints;
- add or update deterministic fixtures where possible;
- keep fallbacks explicit;
- avoid proprietary imagery or scraped geometry;
- document data-quality limitations rather than silently fabricating source precision.

## Security and privacy maintenance

Security reports use GitHub's private security-advisory flow. Exact coordinates remain opt-in for sharing and export. Browser-visible `VITE_*` configuration must never contain private credentials.

Automated checks are defined in `.github/workflows/security-audit.yml` and cover dependency auditing plus CodeQL analysis of JavaScript/TypeScript.

The threat model is documented in [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Deprecation

If a public export field, schema behavior, or provider integration must be deprecated:

1. document the replacement first;
2. keep the old behavior for a reasonable compatibility window when practical;
3. note the change in `CHANGELOG.md`;
4. add a migration note for downstream consumers;
5. make breaking schema changes only under a new major schema version.

## Maintenance evidence

The public repository history is the source of truth for maintenance activity: issues, pull requests, CI runs, security checks, releases, changelog entries, and reproducible integration reports.
