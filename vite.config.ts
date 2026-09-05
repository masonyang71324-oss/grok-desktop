import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: 'production-csp',
      transformIndexHtml: (html) =>
        command === 'build' ? html.replace(' ws://127.0.0.1:5197', '') : html,
    },
  ],
  base: './',
  server: { host: '127.0.0.1', port: 5197, strictPort: true },
}));
