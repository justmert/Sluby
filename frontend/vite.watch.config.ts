import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// the public watch page's hybrid player, built after the studio into the same
// dist. its entry keeps a fixed name, since the page the backend renders
// cannot know a hash; the chunks it loads are hashed under assets/
export default defineConfig({
  resolve: {
    alias: {
      '@sluby/sdk': here('../packages/sdk/src/index.ts'),
      '@sluby/player/hls': here('../packages/player/src/hls.ts'),
    },
  },
  build: {
    emptyOutDir: false,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      input: { 'watch-player': here('./src/watch/main.ts') },
      output: {
        entryFileNames: 'studio/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
