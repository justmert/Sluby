import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/__tests__/helpers/global-setup.ts'],
    coverage: {
      provider: 'v8',
      // the per-file table and the totals, printed to the console (and so to
      // the ci log)
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/index.ts', 'src/db/schema.ts'],
    },
    // Ensure clean module state between tests
    restoreMocks: true,
  },
});
