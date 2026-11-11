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
        name: 'MI Land Access',
        short_name: 'MI Land',
        description: 'Michigan hunting land access map: public land, parcels, hunting units, markups and GPS tracks.',
        lang: 'en-US',
        theme_color: '#14201a',
        background_color: '#14201a',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        categories: ['navigation', 'sports', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
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
