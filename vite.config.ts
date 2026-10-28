import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// GitHub Pages serves the app from /meltpoint/, so CI builds with BASE=/meltpoint/.
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
