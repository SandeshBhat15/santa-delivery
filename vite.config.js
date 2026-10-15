import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // Allows testing on local mobile devices over Wi-Fi
    port: 5173
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 0 // Do not inline 3D assets/textures as base64
  }
});
