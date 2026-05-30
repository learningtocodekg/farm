import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ['@mkkellogg/gaussian-splats-3d'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
