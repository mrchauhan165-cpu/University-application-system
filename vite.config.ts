import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages support:
 *  - `VITE_BASE_PATH` can be set to "/<repository>/" for project pages, or "/"
 *    for user/organisation pages and custom domains.
 *  - Hash based routing is used, so no server rewrites are required and deep
 *    links survive refreshes on any static host (Pages, Netlify, S3, nginx).
 */
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  build: {
    target: 'es2019',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 700,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Static SPA: any host name may serve it (sandbox previews, LAN, ngrok…).
    allowedHosts: true,
  },
  preview: { host: '0.0.0.0', allowedHosts: true },
  define: {
    __BUILD_MODE__: JSON.stringify(mode),
  },
}));
