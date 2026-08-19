# Security policy

Please report security issues privately through GitHub's security advisory flow rather than a public issue. Include reproduction steps, affected browser and version, and the coordinate/provider request involved when relevant.

WorldSeed makes browser requests to public map-data services. Never place private API keys in `VITE_*` variables: Vite exposes them to the client bundle.

