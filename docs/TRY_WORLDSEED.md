# Try WorldSeed in five minutes

**Goal:** open a real WorldSeed schema-v1 export in an independent viewer, without cloning or building the WorldSeed generator. No account, API key or precise location is needed.

## Before you start

You need a desktop browser, a ZIP extraction tool, and Node.js (for the one-command static HTTP server below). This is a *desktop-first* export validation flow; for a quick iPhone experience, use the [browser demo](https://yz4git.github.io/next-gen/demo/).

## Option A — prebuilt ZIPs (recommended)

1. Download the [privacy-safe synthetic demo export](https://github.com/yz4git/next-gen/releases/download/v0.9.1/worldseed-demo-export-v0.9.1.zip). **Keep this ZIP compressed.**
2. Download the [prebuilt standalone consumer](https://github.com/yz4git/next-gen/releases/download/v0.9.1/worldseed-export-consumer-static-v0.9.1.zip). **Extract only the consumer ZIP** into its own directory.
3. Open a terminal in the *extracted consumer directory* and run:

   ```bash
   npx serve .
   ```

   If prompted to install `serve`, approve it. Open the local HTTP address printed in the terminal (often `http://localhost:3000`; use the actual printed address).
4. Drag the **still-zipped** `worldseed-demo-export-v0.9.1.zip` onto the consumer page.

### What success looks like

- A 3D city appears in the standalone consumer.
- Road graph lines and vehicle/pedestrian spawn markers can be inspected.
- The drive route appears when present in the sample.
- The UI shows metadata such as schema version and object/road counts.

The consumer reads the public export ZIP contract, not WorldSeed's generator source. The sample is synthetic and intentionally omits the exact WGS84 origin.

### If it doesn't work

| Symptom | Check |
| --- | --- |
| Blank page or assets fail to load | Use the HTTP address printed by `npx serve .`; do not open `index.html` with a `file://` URL. |
| Consumer loads but nothing renders | Make sure you extracted the **consumer** ZIP, not the **demo export** ZIP. |
| Drag/drop has no effect | Drop the entire original demo-export ZIP onto the consumer page, not individual files. |
| Unexpected ZIP or schema error | Use the two assets from the **same v0.9.1 release**; avoid mixing with another export version. |
| Port already in use | Follow the alternate localhost URL printed by the server or stop the conflicting server. |

If the problem persists, [open an issue](https://github.com/yz4git/next-gen/issues/new) with your browser, OS, steps to reproduce and any console error. Avoid sharing private coordinates.

## Option B — source-based standalone consumer

Download [worldseed-export-consumer-v0.9.1.zip](https://github.com/yz4git/next-gen/releases/download/v0.9.1/worldseed-export-consumer-v0.9.1.zip), extract it, and in the extracted project directory run:

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Drop the published synthetic demo export or a WorldSeed **Three.js kit** ZIP onto the page.

## Build your own integration

The public contract is independent of WorldSeed internals. A downstream project can consume `city.glb`, `terrain.glb`, `colliders.glb`, `worldseed-objects.json`, `road-graph.json`, `spawn-points.json`, `drive-route.json`, and `schemas/v1/*.schema.json`.

Read [the integration guide](REUSE.md#choose-an-integration-path) and [schema compatibility rules](SCHEMA_VERSIONING.md) before depending on field semantics.

**Tried it?** Share an independent reproducible example or a five-minute onboarding report in [Issue #23](https://github.com/yz4git/next-gen/issues/23). Public integrations may be listed in [ADOPTERS.md](../ADOPTERS.md) after verification.

## Privacy note

The published synthetic export omits an exact geographic origin. For real-world exports, leave **Include exact origin** disabled unless georeferencing is required. Generated data retains its original provider attribution and usage obligations.
