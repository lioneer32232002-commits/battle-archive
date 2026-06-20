import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        midway: resolve(__dirname, 'battles/midway/index.html'),
        yamato: resolve(__dirname, 'battles/yamato/index.html'),
        brecourt: resolve(__dirname, 'battles/brecourt/index.html'),
      },
    },
  },
});
