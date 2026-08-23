import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // tus-js-client is a runtime dependency; keep it external so the consumer
  // dedupes it and picks the right browser/node entry.
  external: ['tus-js-client'],
});
