import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['manifold-3d'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { port: Number(process.env.PORT) || 5180 },
  preview: { port: Number(process.env.PORT) || 5180 },
});
