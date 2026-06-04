import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api/ollama-proxy': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ollama-proxy/, ''),
      },
    },
  },
});
