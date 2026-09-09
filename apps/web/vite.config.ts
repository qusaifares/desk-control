import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const CONTROLLER = process.env.DESK_CONTROL_HTTP ?? 'http://127.0.0.1:7420';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy so the UI talks to one origin in dev and in production (where the
    // controller can serve the built bundle itself).
    proxy: {
      '/api': { target: CONTROLLER, changeOrigin: true, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
