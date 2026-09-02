import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('src/preload/index.ts') } },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@core': resolve('packages/core/src'),
        '@renderer': resolve('src/renderer/src'),
      },
    },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
});
