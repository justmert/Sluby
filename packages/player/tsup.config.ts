import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // react/react-dom are peer deps; hls.js is a runtime dep. Keep them external
  // so a single copy is shared with the host app.
  external: ['react', 'react-dom', 'hls.js'],
});
