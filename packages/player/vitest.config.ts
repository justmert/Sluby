import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // real-browser tests run under vitest.browser.config.ts
    exclude: ['src/**/*.browser.test.ts', 'src/**/*.browser.test.tsx'],
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/__tests__/**', 'src/__browser__/**'],
      reporter: ['text', 'text-summary'],
    },
  },
});
