# Security policy

Please report security issues privately through GitHub's security advisory flow rather than a public issue. Include reproduction steps, affected browser and version, and the coordinate/provider request involved when relevant.

## Scope

Security-sensitive areas include:

- malformed or hostile provider data;
- local PLATEAU CityGML parsing;
- exact-coordinate disclosure;
- exported ZIP / JSON / GLB handling;
- browser storage and service-worker behavior;
- dependency vulnerabilities;
- GitHub Actions and release automation.

WorldSeed makes browser requests to public map-data services. Never place private API keys in `VITE_*` variables: Vite exposes them to the client bundle.

The documented trust boundaries and mitigations are in [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Automated checks

The repository runs:

- `npm audit --omit=dev --audit-level=high` for high-severity production dependency advisories;
- GitHub CodeQL analysis for JavaScript/TypeScript;
- the normal `npm run validate` CI pipeline for type, test, build, example, and production-bundle regression checks.

See `.github/workflows/security-audit.yml`.

## Disclosure

Please avoid publishing proof-of-concept exploit details before a fix is available. Reports should include the smallest reproducible case possible and should avoid real private locations or credentials.
