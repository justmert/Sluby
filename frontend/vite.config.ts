/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => {
  // the studio talks to the api on its own origin; in dev, vite proxies to it
  const env = loadEnv(mode, here('.'), '');
  const target = env.STUDIO_API_PROXY_TARGET || 'http://localhost:4500';
  // keep the browser's Host so the oauth callback and tus upload urls the
  // backend builds point back at the studio origin, not the proxy target
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
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
