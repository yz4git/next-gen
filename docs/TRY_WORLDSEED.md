# Try WorldSeed in five minutes

You can test the **schema v1 export contract without building WorldSeed itself**.

## Option A — use the published demo export

Download these two assets from the v0.9.1 release:

- [Privacy-safe demo export](https://github.com/yz4git/next-gen/releases/download/v0.9.1/worldseed-demo-export-v0.9.1.zip)
- [Prebuilt static export consumer](https://github.com/yz4git/next-gen/releases/download/v0.9.1/worldseed-export-consumer-static-v0.9.1.zip)

The demo export is generated from WorldSeed's synthetic first-run world and intentionally omits the exact WGS84 origin.

Unzip the static consumer and serve the directory with any local HTTP server, for example:

```bash
npx serve .
```

Open the shown local URL, then drag `worldseed-demo-export-v0.9.1.zip` onto the page.

You should see:

- the exported city GLB;
- routable road-graph lines;
- vehicle and pedestrian spawn markers;
- the active drive route when present;
- schema/generator/object/road counts from the exported JSON contract.

## Option B — consume the source example

Download [worldseed-export-consumer-v0.9.1.zip](https://github.com/yz4git/next-gen/releases/download/v0.9.1/worldseed-export-consumer-v0.9.1.zip), then:

```bash
npm install
npm run dev
```

Drop either the published demo export or your own WorldSeed **Three.js kit** ZIP onto the page.

## Build your own integration

The public contract is intentionally independent of WorldSeed internals. A downstream project can consume any combination of:

- `city.glb`, `terrain.glb`, `colliders.glb`;
- `worldseed-objects.json`;
- `road-graph.json`;
- `spawn-points.json`;
- `drive-route.json`;
- `schemas/v1/*.schema.json`.

See [SCHEMA_VERSIONING.md](SCHEMA_VERSIONING.md) before depending on field semantics.

If you publish a reproducible integration, submit an **Integration report** issue. Verified public integrations are listed in [../ADOPTERS.md](../ADOPTERS.md).

## Privacy note

The published demo export uses synthetic demonstration data and does not include an exact geographic origin. For your own real-world exports, leave **Include exact origin** disabled unless georeferencing is intentionally required.
