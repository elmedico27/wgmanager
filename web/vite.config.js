import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:preview` makes one self-contained HTML file with the mock
// backend inside, for design review. `npm run build` is the real app (no mock).
export default defineConfig(({ mode }) => ({
  // Mock mode for `npm run dev` and the preview build. A build-time constant
  // (not a .env file: the repo ignores .env.*), so `npm run build` drops the mock.
  // `npm run dev:real` runs the UI against a real backend on localhost:7501.
  define: { __MOCK__: JSON.stringify(mode === 'development' || mode === 'preview') },
  server: mode === 'real' ? { proxy: { '/api': 'http://127.0.0.1:7501' } } : undefined,
  plugins: [svelte(), tailwindcss(), ...(mode === 'preview' ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === 'preview' ? 'dist-preview' : 'dist',
    emptyOutDir: true,
  },
}));
