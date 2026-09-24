import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Dashboard API lives on the backend (8787).
      '/api': 'http://127.0.0.1:8787',
      // /search is BOTH a page route (GET, rendered by Vite's history fallback)
      // and a backend POST route (POST /search). The backend has no GET /search
      // — proxying GET /search would 404 the page. bypass runs before
      // proxy.web: for GET, returning req.url (a string) makes Vite's middleware
      // rewrite req.url to itself and call next(), so Vite's own SPA fallback
      // renders index.html. For POST we return undefined, which falls through to
      // the backend proxy.
      '/search': {
        target: 'http://127.0.0.1:8787',
        bypass(req) {
          if (req.method === 'POST') return undefined; // POST /search -> backend
          return req.url;                              // GET /search -> Vite renders the page
        },
      },
      '/fetch': 'http://127.0.0.1:8787',
      '/health': 'http://127.0.0.1:8787',
    },
  },
});
