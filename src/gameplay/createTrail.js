import { MagicTrail } from './MagicTrail.js';
import { MagicTrailTube } from './MagicTrailTube.js';

/**
 * Creates either MagicTrailTube (default) or MagicTrail (if ?trail=ribbon in URL).
 *
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 * @param {Object} opts
 * @returns {MagicTrailTube | MagicTrail}
 */
export function createTrail(scene, camera, opts = {}) {
  const urlParams = typeof window !== 'undefined' && window.location?.search
    ? new URLSearchParams(window.location.search)
    : null;
  const useRibbon = urlParams && urlParams.get('trail') === 'ribbon';

  if (useRibbon) {
    return new MagicTrail(scene, camera, opts);
  }
  return new MagicTrailTube(scene, camera, opts);
}

export default createTrail;
