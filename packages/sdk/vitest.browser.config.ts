import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { tusContractPlugin } from './src/__browser__/tus-plugin.ts';

// real-browser tests: the browser build of tus-js-client, with its
// localStorage resume store, against a real tus server. the node tests stay in
// vitest.config.ts.
export default defineConfig({
  plugins: [tusContractPlugin()],
  test: {
    name: 'sdk-browser',
    include: ['src/**/*.browser.test.ts'],
    testTimeout: 30_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
});
