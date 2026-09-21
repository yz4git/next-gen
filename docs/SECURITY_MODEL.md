# Security model

WorldSeed is a browser-first geospatial application and export pipeline. Its main security and privacy risks come from external data, browser networking, local file import, downloadable exports, and dependency/runtime behavior.

## Trust boundaries

### External geospatial providers

WorldSeed may request data from Overture-hosted PMTiles, OpenStreetMap Overpass, and terrain tile providers.

Risks include malformed data, unexpected schema changes, service unavailability, oversized responses, and provider-side logging of requested areas.

Mitigations include:

- bounded world radius and building limits;
- provider-specific parsing and normalization;
- request fallbacks and explicit data-quality warnings;
- no private API credentials in browser-visible configuration;
- source attribution and provenance preserved through export.

### Exact coordinates

A geographic seed can be sensitive even when the generated geometry is public.

Mitigations include:

- exact origin omitted from exports by default;
- explicit opt-in before adding exact origin metadata;
- explicit exact-seed sharing choices;
- local-data clearing;
- no analytics or account system in the WorldSeed application.

Removing origin metadata does not anonymize recognizable geometry. Users must still review published exports and screenshots.

### Local PLATEAU import

PLATEAU CityGML files are parsed locally in browser memory.

Risks include oversized or malformed XML and excessive geometry.

Mitigations include file-size, radius, and building-count bounds plus parser validation. Imported local files are not intentionally uploaded by WorldSeed.

### Exported ZIP / JSON / GLB

Exports are an interoperability boundary and may be consumed by other tools.

Mitigations include:

- versioned JSON Schema;
- standalone downstream consumer tests;
- deterministic local-meter coordinates;
- explicit attribution artifacts;
- schema-version compatibility policy;
- no executable scripts embedded as part of the data contract.

Consumers should still treat imported files as untrusted input and enforce their own resource limits.

### Browser dependencies

WorldSeed depends on npm packages and GitHub Actions.

Mitigations include:

- lockfile-based installs in CI;
- dependency auditing;
- CodeQL static analysis;
- minimal runtime dependencies;
- review of dependency changes in pull requests.

## Secrets

WorldSeed does not require a private application API key for normal browser operation.

Never place secrets in `VITE_*` variables because Vite exposes them to client bundles. Repository administration credentials used by GitHub Actions are stored only as GitHub Actions secrets and are not part of the application runtime.

## Reporting

Do not open a public issue for a vulnerability. Follow [SECURITY.md](../SECURITY.md) and use GitHub's private security-advisory flow.
