import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // tus-js-client and sia-storage are runtime dependencies; keep them external
  // so the consumer's bundler dedupes them and picks the right browser/node
  // entry (sia-storage's browser build ships the WASM the player loads).
  external: ['tus-js-client', 'sia-storage'],
});
