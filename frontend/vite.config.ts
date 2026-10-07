/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => {
  // the studio talks to the api on its own origin; in dev, vite proxies to it
  const env = loadEnv(mode, here('.'), '');
  const target = env.STUDIO_API_PROXY_TARGET || 'http://localhost:3000';
  // the backend builds its oauth callback and tus upload urls from PUBLIC_URL,
  // so in dev set PUBLIC_URL to this server's origin (http://localhost:5173)
  const proxy = { target, changeOrigin: false, xfwd: true };

  return {
    plugins: [react(), tailwindcss()],
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
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts', './src/test/timeouts.ts'],
      // a loaded ci runner can take seconds per page render
      testTimeout: 30_000,
    },
  };
});
