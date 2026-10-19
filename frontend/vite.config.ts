/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// preloads the latin body and heading fonts, which every page renders above
// the fold, so they arrive with the css instead of after it. the file names
// are hashed, so they come from the bundle; the mono font stays lazy.
function preloadFonts(names: RegExp[]): Plugin {
  let base = '/';
  return {
    name: 'sluby-preload-fonts',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        return Object.keys(ctx.bundle ?? {})
          .filter((file) => names.some((name) => name.test(file)))
          .map((file) => ({
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'font',
              type: 'font/woff2',
              href: base + file,
              crossorigin: '',
            },
            injectTo: 'head' as const,
          }));
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // the studio talks to the api on its own origin; in dev, vite proxies to it
  const env = loadEnv(mode, here('.'), '');
  const target = env.STUDIO_API_PROXY_TARGET || 'http://localhost:3000';
  // the backend builds its oauth callback and tus upload urls from PUBLIC_URL,
  // so in dev set PUBLIC_URL to this server's origin (http://localhost:5173)
  const proxy = { target, changeOrigin: false, xfwd: true };

  return {
    plugins: [react(), tailwindcss(), preloadFonts([/figtree-latin-wght-normal-[^/]*\.woff2$/])],
    resolve: {
      alias: {
        '@': here('./src'),
        // build the workspace packages from source, so the studio never runs
        // against a stale dist and needs no prebuild step
        '@sluby/sdk': here('../packages/sdk/src/index.ts'),
        '@sluby/player': here('../packages/player/src/index.ts'),
      },
    },
    build: {
      // hls.js alone is about 575 kB minified; it loads only with a player
      chunkSizeWarningLimit: 600,
      rolldownOptions: {
        output: {
          // hls.js and recharts are most of the asset player and analytics
          // chunks; on their own they cache across deploys that only change
          // studio code
          codeSplitting: {
            groups: [
              // react and the small helpers every chunk shares. without this
              // group the charts group pulled them in as its dependencies, so
              // every page preloaded the whole charts chunk (111 kB gzip) just
              // to get react
              {
                name: 'react',
                priority: 10,
                test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store|react-is|clsx)[\\/]/,
              },
              { name: 'hls', test: /node_modules[\\/]hls\.js[\\/]/ },
              {
                name: 'charts',
                test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|decimal\.js-light|es-toolkit|@reduxjs|immer|reselect|redux)[\\/]/,
              },
            ],
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': proxy,
        '/v1': proxy,
        '/health': proxy,
        // the public watch page the backend renders
        '/watch': proxy,
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.test.{ts,tsx}'],
      // real-browser tests run from vitest.browser.config.ts
      exclude: ['src/**/*.browser.test.{ts,tsx}', '**/node_modules/**'],
      setupFiles: ['./src/test/setup.ts', './src/test/timeouts.ts'],
      // a loaded ci runner can take seconds per page render
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  };
});
