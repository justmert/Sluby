import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { hlsFixtureGateway } from './src/__browser__/gateway.ts';

// real-browser tests: hls.js plays a real HLS fixture through MSE in chromium.
// the jsdom unit tests stay in vitest.config.ts.
export default defineConfig({
  plugins: [
    hlsFixtureGateway(fileURLToPath(new URL('./src/__browser__/fixtures/hls', import.meta.url))),
  ],
  test: {
    name: 'player-browser',
    include: ['src/**/*.browser.test.{ts,tsx}'],
    // the gateway's request log and fault switches are shared server state
    fileParallelism: false,
    testTimeout: 30_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
