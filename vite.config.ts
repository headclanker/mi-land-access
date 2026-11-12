import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the site works at a domain root or a sub-path (e.g. GitHub Pages).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'SketchX',
        short_name: 'SketchX',
        description: 'SketchX — Michigan hunting land map: public land, parcels, hunting units, markups and GPS tracks.',
        lang: 'en-US',
        theme_color: '#14201a',
        background_color: '#14201a',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        categories: ['navigation', 'sports', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest,json}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Recently viewed basemap tiles: cache-first with a hard size cap.
            urlPattern: ({ url }) =>
              (url.hostname === 'basemap.nationalmap.gov' && url.pathname.includes('/tile/')) ||
              url.hostname === 'tile.openstreetmap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'basemap-tiles',
              expiration: { maxEntries: 2500, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 3D view: AWS Terrain Tiles (terrarium PNGs). Immutable data, so cache-first with a cap.
            urlPattern: ({ url }) => url.hostname === 's3.amazonaws.com' && url.pathname.startsWith('/elevation-tiles-prod/terrarium/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'terrain-tiles',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 3D buildings: OpenFreeMap TileJSON (names the current dated tile set) — network first.
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org' && !url.pathname.endsWith('.pbf'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'building-tilejson',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 3D buildings: vector tiles under a dated path, so cache-first with a cap.
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org' && url.pathname.endsWith('.pbf'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'building-tiles',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Land data queries: network first, fall back to the last answer when offline.
            urlPattern: ({ url }) => url.pathname.endsWith('/query') && url.pathname.includes('/rest/services/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'land-data',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 14, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
