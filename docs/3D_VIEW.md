# 3D view

SketchX has an optional 3D view, roughly what Apple Maps calls 3D: the map tilts over real
terrain with shaded relief, the horizon fades into a sky, and buildings stand up as simple grey
blocks. It uses free, open data only, with no accounts and no API keys.

## Using it

- Tap the **3D** button in the map-button column (below the topo / satellite thumbnail). It is a
  toggle button (`aria-pressed`), so it works from the keyboard with Enter or Space. The map eases
  to a tilt of about 58°, and the button turns orange.
- In 3D, drag with two fingers to tilt and turn. On a computer, right-drag or Ctrl-drag tilts and
  turns, and Shift + arrow keys work too. The most you can tilt is 72°.
- Tap **3D** again to go back to the flat map. The map eases back to no tilt and north up, and the
  terrain is removed. If the compass's **Heading up** mode is on, the compass keeps control of
  the bearing and only the tilt changes.
- The mode, the terrain height and the last tilt and bearing you used in 3D are remembered across
  reloads.
- Settings are under **More → 3D view**:
  - **Terrain height**: 1×, 1.5× (the default), 2× or 3×. Michigan is flat, so 1× (true scale)
    hardly shows outside the Porcupine and Huron Mountains. 1.5× makes the UP escarpments and the
    Sleeping Bear dunes read clearly without making the Lower Peninsula look exaggerated. 3× is the
    most before it starts to look silly.
  - **3D buildings**: on by default. Shown in 3D from zoom 14.
  - **Shaded relief**: *Off*, *In 3D* (the default) or *Always*, which adds relief shading to the
    flat map as well. The shading is subtle on the topo and street maps, which already have
    contours, and a little stronger on satellite imagery.
- While 3D or shaded relief is on, the coordinate readout also shows the approximate ground
  elevation in feet (for example `≈ 1,640 ft`), rounded to 10 ft. This is the map centre, or the
  mouse pointer on a computer.

Everything else keeps working in 3D. Basemaps and the topo / satellite toggle, land-grade fills
and hatching, parcel lines and owner labels, hunting units, the statewide overview, markups, the
GPS dot, accuracy circle and recorded track are all drawn on the terrain. Taps, drawing,
the crosshair (**Place here** / **Add point**), the details sheet, search, the compass,
the scale bar and the north reset all use the terrain surface, so a tap lands where your finger is.

## Data sources and attribution

| What | Source | Credit shown on the map |
| --- | --- | --- |
| Elevation (terrain mesh, relief shading, elevation readout) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen / Tilezen Joerd), terrarium-encoded PNG, `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, zoom 0–15 | "Terrain: Mapzen / AWS Terrain Tiles (USGS 3DEP, SRTM, GMTED2010, NOAA ETOPO1; Canada OGL)", linked to the [dataset attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| Buildings | [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema, `building` layer, `render_height` / `render_min_height`). The source is the TileJSON `https://tiles.openfreemap.org/planet`, so the dated tile path stays current. | "Buildings: OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors" |

MapLibre adds each credit to the map's attribution (the ⓘ button) only while its source is
drawn: the terrain credit while 3D or relief is on, and the buildings credit while buildings are
visible. More → About → Data sources carries the longer credit for the dataset: USGS 3DEP
(formerly NED), GMTED2010 and SRTM courtesy of the U.S. Geological Survey; ETOPO1 from NOAA;
Canadian data under the Open Government Licence – Canada; and other regions as listed by the
Terrain Tiles attribution.

Both hosts send `Access-Control-Allow-Origin: *`, and both load cross-origin in the browser.

## How it is built

- `src/app/map/view3dModel.ts` holds the pure logic, with unit tests in
  `src/app/tests/view3d.test.ts`. This covers the settings and their validation, the mode state
  machine (`reduce`, `planFor`), the camera for entering and leaving 3D (`cameraFor`, with
  heading-up), the exaggeration clamp, the URL builders, the attribution, terrarium decoding, the
  styling for relief, buildings and sky, and the clipped data box for a tilted camera.
- `src/app/map/view3d.ts` applies all of that to MapLibre. It owns the 3D button, the More-pane
  settings and the elevation sampler.
- **Lazy loading.** Nothing is added to the style until 3D or relief is first switched on. The
  flat map loads and draws exactly as before, and no elevation or building request is made.
- **Sources.** There are two `raster-dem` sources over the same tiles, because MapLibre asks for
  separate ones for terrain and hillshade. The terrain source treats the 256-px PNGs as 512 px.
  That is one zoom level coarser and a quarter of the requests, and it avoids needle-like mesh
  spikes that MapLibre 6 drew at some tile seams with 256-px elevation tiles. The hillshade
  source uses 256 px, for crisp relief. Both are limited to a box around Michigan, and each keeps
  at most 160 tiles in memory.
- **Layer order.** A placeholder layer, `anchor-relief`, sits between the basemap and the land
  fills. Relief shading goes just above it, and a basemap switch re-inserts the basemap just
  below it, so changing map styles never covers the relief.
- **Buildings** are a `fill-extrusion` layer from zoom 14. It sits under the point symbols and
  labels, at 78% opacity with a vertical gradient, so parcels and owner names stay readable. The
  colour is a neutral warm grey tuned for topo or satellite and for light or dark theme.
  Buildings without a height get 6 m (about two storeys). Outlines marked `hide_3d` are skipped,
  because their building parts are drawn instead.
- **Sky.** The sky and haze follow the theme and basemap, so the horizon fades out instead of
  ending at a hard edge.
- **Elevation readout.** In 3D the readout uses MapLibre's `queryTerrainElevation`, divided by
  the exaggeration. With relief on the flat map (no terrain mesh), it decodes the terrarium PNG
  under the point itself and keeps the last 8 tiles.
- **Land data with a tilted camera.** A tilted camera can see to the horizon, so its bounds can
  span a county. The land-data loader (`LayerManager.viewBBox`) loads only up to 2× the flat
  screen around the centre (`loadBBoxFor`), so parcels near the camera keep full detail. Land
  data is not drawn far toward the horizon, where it would be a few pixels tall anyway.

## Cost and performance

- **Data.** An elevation tile is a few KB over lakes and up to about 120 KB over hills. A tilted phone screen needs a few dozen
  tiles for terrain plus those for relief shading. A session of panning in 3D is typically a few
  MB, more with satellite imagery. Building tiles (only from zoom 14) are tens of KB each in
  towns. Nothing is fetched while 3D and relief are off.
- **Rendering.** Terrain draws every layer into textures that are wrapped over a 3D mesh, and
  tilted views cover more tiles. This uses noticeably more GPU and battery than the flat map. On
  an older phone, use 1× terrain, turn off buildings or relief, or go back to the flat map (the
  same advice is shown in the More pane). There is no automatic quality reduction.
- **Offline.** The service worker caches elevation tiles cache-first (`terrain-tiles`, up to
  1,500 tiles for 60 days) and building tiles cache-first (`building-tiles`, up to 800 tiles for
  30 days). The building TileJSON is cached network-first (`building-tilejson`). Areas you viewed
  in 3D while online therefore work in 3D offline. Elsewhere the terrain is flat (no tiles) and
  buildings are missing. **More → Clear cached map data** clears these caches too.

## Known limits

- This is not photorealistic 3D. Buildings are simple extruded footprints, and there are no trees,
  textures or landmarks.
- The elevation data is about 10–30 m resolution (USGS 3DEP in Michigan, coarser offshore and in
  Canada). Small features such as ditches, berms, small knolls and creek banks are smoothed or
  missing, and steep bluffs are softened. The elevation readout is approximate, rounded to 10 ft.
- The Great Lakes and inland lakes are flat at their surface elevation (there is no bathymetry).
- Building coverage depends on OpenStreetMap. It is good in cities such as Grand Rapids and
  Marquette, and sparse or absent in rural areas, where farm buildings and cabins are often not
  mapped. Building heights are estimates unless someone has tagged them in OpenStreetMap.
- With a strong tilt, land layers, labels and markups far toward the horizon are not loaded or
  are hidden by MapLibre's label collision. Zoom or tilt less to see more.
- When you search for a county or park, the map frames it for the current tilt, so it zooms out
  further than on the flat map.
- In 3D, the GPS dot and search pin lie flat on the ground.
