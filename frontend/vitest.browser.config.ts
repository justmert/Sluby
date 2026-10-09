import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// real-browser tests for what jsdom cannot show, such as motion's frame loop
// deciding whether a screen ever appears. the jsdom suite stays in vite.config.ts.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': here('./src'),
      '@sluby/sdk': here('../packages/sdk/src/index.ts'),
      '@sluby/player': here('../packages/player/src/index.ts'),
    },
  },
  test: {
    name: 'studio-browser',
    include: ['src/**/*.browser.test.{ts,tsx}'],
    testTimeout: 60_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
});
