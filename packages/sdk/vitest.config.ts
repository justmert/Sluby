import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // real-browser tests run under vitest.browser.config.ts
    exclude: ['src/**/*.browser.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**', 'src/__browser__/**'],
      reporter: ['text', 'text-summary'],
    },
  },
});
