import { defineConfig } from 'tsup';

export default defineConfig({
  // `hls` is the react-free entry for plain hls.js apps
  entry: { index: 'src/index.ts', hls: 'src/hls.ts' },
  format: ['esm', 'cjs'],
  // tsup always passes baseUrl to its declaration build, which typescript 6
  // deprecates; tsup is no longer maintained, so it will not change that
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  // react/react-dom are peer deps; hls.js is a runtime dep. Keep them external
  // so a single copy is shared with the host app.
  external: ['react', 'react-dom', 'hls.js'],
});
