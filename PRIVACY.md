# WorldSeed privacy and data flow

This document describes WorldSeed v0.7.0 as shipped in this repository. WorldSeed is a browser-only client application. It adds no user account, analytics tracker, advertising SDK, or WorldSeed application server.

## When data leaves the browser

No live map request is made for the bundled synthetic demo. When a user chooses **Seed this world** or confirms **Use my location**, the browser contacts:

- **OpenStreetMap Overpass:** receives the selected latitude, longitude, and search radius in the query body. WorldSeed tries two public Overpass instances for availability.
- **Overture Maps dataset on Amazon S3:** PMTiles range and tile requests identify the map tiles covering the selected area. They do not use a WorldSeed proxy.
- **Mapzen Terrain Tiles on Amazon S3:** Terrarium PNG requests identify the elevation tiles covering the selected area. They do not use a WorldSeed proxy.
- **The site host/CDN:** serves the app and may receive the requested URL plus normal connection metadata.

Those services can receive standard network metadata such as IP address, user agent, and request time under their own policies. WorldSeed sets a `no-referrer` policy so the current page URL is not sent as a referrer to external providers or links.

Relevant provider information:

- [OpenStreetMap Foundation privacy policy](https://osmfoundation.org/wiki/Privacy_Policy)
- [© OpenStreetMap contributors and licensing](https://www.openstreetmap.org/copyright)
- [Overture Maps attribution guidance](https://docs.overturemaps.org/attribution/)
- [Mapzen Terrain Tiles registry and attribution](https://registry.opendata.aws/terrain-tiles/)

## Local PLATEAU imports

Selecting **Import PLATEAU CityGML** reads the chosen `.gml` or `.xml` file into browser memory. WorldSeed does not upload the file, write it to IndexedDB, or send its contents to map providers. The imported model remains in the current page only and is discarded on reload or replacement. Exports created afterward can contain the imported geometry and its identifying attributes, so review them before redistribution and preserve the source dataset's required attribution.

## Browser storage

Live provider results are cached in IndexedDB for up to 7 days. Cache keys contain coordinates rounded to five decimal places plus the selected radius. Time-attack best times are stored locally in `localStorage` under route-derived identifiers and contain no coordinates. The service worker caches the same-origin application shell; navigation entries are normalized to `index.html` so coordinate query strings are not used as CacheStorage keys.

The **Clear local data & current URL** action:

1. deletes IndexedDB entries whose keys belong to WorldSeed;
2. deletes CacheStorage entries whose cache names belong to the WorldSeed shell;
3. deletes locally stored WorldSeed time-attack best times;
4. removes query parameters and fragments from the current tab URL; and
5. replaces the current scene and input with the bundled synthetic demo defaults.

It cannot delete copies already retained by another service, recipient, browser history entry, screenshot, downloaded file, or backup.

## Location, links, and exports

- Browser geolocation is requested only after a just-in-time disclosure. A successful coordinate is rounded to six decimals, placed in the input, and used for live requests.
- Normal generation and style changes do not add coordinates to the URL.
- When an exact-seed link is opened, its parameters populate the controls; starting a live request then removes them from the current address bar.
- An app-only share link contains no seed parameters. An exact seed link contains latitude, longitude, radius, style, and—when Drive mode is active—the deterministic route identifier; it is copied only after an explicit choice.
- GLB and starter-kit exports omit the exact origin by default. Users can opt in when georeferencing is required.
- Exported geometry and screenshots can remain recognizable even when coordinate metadata is removed. Metadata removal is not anonymization.

## Availability and fair use

WorldSeed applies a short client-side cooldown and disables relevant controls while generating. This reduces accidental duplicate requests from one browser, but it is not a shared rate limiter. A high-traffic public deployment should use a compliant cached proxy or hosted data pipeline rather than relying only on community Overpass instances.
