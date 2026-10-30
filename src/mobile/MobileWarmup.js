import * as THREE from 'three';

export function runMobileWarmup(ctx) {
  const { renderer, scene, camera, chunkSystem, loaderElement } = ctx || {};
  if (!renderer || !scene || !camera) return;

  if (renderer.initTexture) {
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (m.map) renderer.initTexture(m.map);
          if (m.emissiveMap) renderer.initTexture(m.emissiveMap);
          if (m.normalMap) renderer.initTexture(m.normalMap);
          if (m.roughnessMap) renderer.initTexture(m.roughnessMap);
        });
      }
    });
  }

  if (chunkSystem && typeof chunkSystem.update === 'function') {
    try { chunkSystem.update(new THREE.Vector3(0, 0, 0)); } catch (e) {}
  }

  const hideLoader = () => {
    if (loaderElement) {
      loaderElement.classList.add('hidden');
      setTimeout(() => loaderElement.remove(), 700);
    }
    if (typeof window !== 'undefined') window._loadingCompleteTime = performance.now();
  };

  if (renderer.compileAsync) {
    renderer.compileAsync(scene, camera).catch(() => {}).finally(() => {
      try { renderer.render(scene, camera); } catch (e) {}
      hideLoader();
    });
  } else {
    try { renderer.render(scene, camera); } catch (e) {}
    hideLoader();
  }
}