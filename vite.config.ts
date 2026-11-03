import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    root: path.resolve(__dirname, 'frontend'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'shared'),
        '@': path.resolve(__dirname, 'frontend'),
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
    },
    server: {
      // HMR can be disabled with DISABLE_HMR where file watching is disruptive.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Ignore private runtime data so server writes don't interrupt active streams.
      watch: process.env.DISABLE_HMR === 'true'
        ? null
        : { ignored: ['**/.local/**'] },
    },
  };
});
