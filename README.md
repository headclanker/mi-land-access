# MI Land Access

A Michigan-only hunting land-access map for phones and desktops. It shows public land, county
parcel owners and hunting units on USGS or OpenStreetMap basemaps, colour-coded by how likely you
are to be allowed to hunt there. It also does waypoints, lines, shapes, GPS tracks, a compass and
offline use. It is an installable PWA built with Vite, TypeScript and MapLibre GL, with no UI
framework.

> **Not legal advice.** The green / yellow / red / grey grades are an automated guess from public
> GIS records and owner names. Data can be outdated or wrong. Always verify boundaries, ownership
> and local rules, and get the landowner's permission before you enter private land.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # vitest unit tests (pure logic)
npm run build     # tsc type-check + production build into dist/
npm run preview   # serve dist/ (service worker + offline caching active)
```

The service worker only registers in production builds (`build` + `preview`, or any static host).
Deploy `dist/` to any static HTTPS host. Geolocation, compass and install all need HTTPS (or
localhost).

## What's where

| Path | What |
| --- | --- |
| `src/contract.ts` | Fixed interface between the app shell and the data/grading module |
| `src/data/**`, `src/grading/**` | Layer catalogue, county list, grading rules (data module) |
| `src/app/app.ts` | Wires everything together |
| `src/app/map/` | MapLibre setup, basemaps, layer-order anchors, worker URL |
| `src/app/layers/arcgis.ts` | Generic ArcGIS REST loader: tile-snapped bbox queries, pagination, generalisation, LRU cache, Esri-JSON fallback |
| `src/app/layers/manager.ts` | Per-layer loading (debounce, abort, global request limiter, county filtering) and grade styling |
| `src/app/layers/enrich.ts` | Grading glue (`gradeFeature` → `_grade/_category/_reason/_refs`, parcels also `_ownerGrade/_ownerCategory`), stable feature ids, acreage |
| `src/grading/reconcile.ts` | One verdict per parcel: owner-name grade vs. overlapping public-land layers (precedence rules in `docs/DATA_SOURCES.md` §5a) |
| `src/app/layers/coverage.ts`, `reconcileLayers.ts` | Fast approximate parcel/public-land overlap (sample points + banded point-in-polygon) and applying the reconciled verdict to loaded parcels |
| `src/app/layers/counties.ts` | County outlines (from the county reference layer) + coverage flags from `data/counties.ts` |
| `src/app/details/` | Tap → details sheet, owner info, permission-letter generator, address tidying |
| `src/app/markups/` | Waypoints / lines / shapes / tracks: model, IndexedDB store, drawing, GeoJSON + GPX, share links |
| `src/app/tracker/` | Shared GPS watcher, my-location dot + accuracy circle, track recorder (Wake Lock, survives reloads) |
| `src/app/compass/` | DeviceOrientation compass (iOS permission + `webkitCompassHeading`, Android absolute), heading-up, bearing/distance to a waypoint |
| `src/app/ui/` | Bottom sheet / sidebar, layer panel + legend + species filter, basemap picker, search, theme, disclaimer, icons |
| `src/app/util/` | Geodesy and formatting, coordinate parsing, DOM helpers, persistence |
| `src/app/tests/` | Unit tests for the pure modules |

## How data loading works

For each visible layer at or above its `minZoom`, the viewport is split into web-mercator tiles
one zoom level coarser than the map, with at most about 12 tiles. Each tile is fetched with
`/query?...&geometryType=esriGeometryEnvelope&outSR=4326&f=geojson`, following
`exceededTransferLimit` with `resultOffset`. Below zoom 14 the query also passes
`maxAllowableOffset` (about half a pixel). Tiles are cached in memory (LRU, 240 tiles) under
`layer@z/x/y` keys. Requests for tiles that leave the view are aborted. All layers share a limit
of 8 requests in flight, and the refresh after a pan is debounced by 350 ms. County parcel layers
are only queried when their county is in view, using generalised county outlines that are
fetched once. Every feature goes through `gradeFeature`, and the result is stored on the feature
for styling and the details sheet. Where county parcels are loaded, each parcel is then
reconciled with the public-land layers overlapping it (debounced, client-side), so a piece of
ground shows one colour: park hunting zones, HAP and Commercial Forest first, then DNR /
national-forest ownership, then the county owner name, then PAD-US. Game-area and park
boundaries are outlines only. See `docs/DATA_SOURCES.md` §5a.

## Offline

The app shell is precached. Basemap tiles you have viewed are cached cache-first, up to 2,500
tiles or 30 days. Land-data responses are cached network-first, up to 400 responses or 14 days.
To prepare for no signal, pan over your area before you go. The cache can be cleared under
More → Offline.

## Sharing

- **Link**: the selected markups (or all of them) are packed compactly, compressed with
  deflate-raw and base64url-encoded into `#m=…`. Opening the link imports them.
- **GPX / GeoJSON**: export and import. The importer also reads third-party GPX files
  (`wpt`/`rte`/`trk`).
- **Send**: shares a GPX file through the Web Share API where the browser supports it.

All markups and the in-progress track are stored on the device in IndexedDB, with localStorage as
a fallback.
