import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config.js';

/**
 * Snapchat Web Lens build.
 *
 * A Web Lens is a zip of a static build that Snapchat unpacks and serves from a
 * private URL it controls. That imposes three things the normal web build does
 * not need:
 *
 *  1. `base: './'` so every reference is relative to index.html. With the
 *     default `/`, the Lens would ask Snapchat's origin for `/assets/...`.
 *  2. A separate output folder, so `npm run build` keeps producing the normal
 *     desktop/web bundle untouched.
 *  3. A mobile-only payload: the desktop instructions poster is never fetched
 *     by a phone and is excluded when packing.
 *
 * Build with `npm run build:snap`, then `npm run pack:snap`.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    base: './',
    build: {
      outDir: 'release/santas-sleigh-run-web',
      emptyOutDir: true,
      assetsInlineLimit: 0,
      sourcemap: false
    }
  })
);