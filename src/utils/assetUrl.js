/**
 * Base-aware asset URLs.
 *
 * A Snapchat Web Lens is served from a private URL that is not the site root,
 * and the path differs between review and production. Every asset reference
 * therefore has to stay relative: `./audio/bell.mp3`, never `/audio/bell.mp3`.
 *
 * Vite rewrites `import.meta.env.BASE_URL` to `'./'` for a relative build and
 * to `'/'` for a normal dev/root build, so one helper covers both.
 */
export const ASSET_BASE = import.meta.env.BASE_URL || './';

export function assetUrl(path) {
  const clean = String(path).replace(/^\.?\//, '');
  return `${ASSET_BASE}${clean}`;
}