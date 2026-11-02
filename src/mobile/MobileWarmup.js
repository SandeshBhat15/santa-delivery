import * as THREE from 'three';

export function runMobileWarmup(ctx) {
  const { renderer, scene, camera, chunkSystem, loaderElement } = ctx || {};
  if (!renderer || !scene || !camera) return;

  // 1. Initialize all textures on the GPU
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

  // 2. Fill all 6 chunk slots once at maximum capacity
  if (chunkSystem && typeof chunkSystem.generateChunk === 'function') {
    const slots = [
      [0, 0], [1, 0], [-1, 0],
      [0, 1], [0, -1], [1, 1]
    ];
    for (let i = 0; i < slots.length; i++) {
      try {
        chunkSystem.generateChunk(slots[i][0], slots[i][1]);
      } catch (e) {}
    }
  }

  const hideLoader = () => {
    if (loaderElement) {
      loaderElement.classList.add('hidden');
      setTimeout(() => loaderElement.remove(), 700);
    }
    if (typeof window !== 'undefined') window._loadingCompleteTime = performance.now();
  };

  // 3. Compile async with all lights & shadows enabled, and render one frame with effects visible
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