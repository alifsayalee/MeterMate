import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During dev the SPA runs on :5173 and proxies /api to the Express server on
// :4000, so the browser sees a single origin and no CORS surprises.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
