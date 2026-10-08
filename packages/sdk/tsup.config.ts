import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // tsup always passes baseUrl to its declaration build, which typescript 6
  // deprecates; tsup is no longer maintained, so it will not change that
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  // tus-js-client and sia-storage are runtime dependencies; keep them external
  // so the consumer's bundler dedupes them and picks the right browser/node
  // entry (sia-storage's browser build ships the WASM the player loads).
  external: ['tus-js-client', '@siafoundation/sia-storage'],
});
