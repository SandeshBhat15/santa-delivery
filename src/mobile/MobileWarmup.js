import * as THREE from 'three';

export function runMobileWarmup(ctx) {
  const {
    renderer,
    scene,
    camera,
    chunkSystem,
    composer,
    loaderElement,
    sleighController,
    deliverySystem,
    snowParticles,
    largeSnowParticles
  } = ctx || {};

  if (!renderer || !scene || !camera) return;

  // 1. Initialize all textures on the GPU
  try {
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
  } catch (err) {
    console.warn('[MobileWarmup] Texture init warning:', err?.message || err);
  }

  // 2. Fill chunks using the sleigh's real start chunk and its neighbors up to the cap
  try {
    if (chunkSystem && typeof chunkSystem.generateChunk === 'function') {
      const half = (chunkSystem.chunkSize || 20.0) * 0.5;
      const startPos = sleighController?.position || new THREE.Vector3(0, 0, 0);
      const startCx = Math.floor((startPos.x + half) / (chunkSystem.chunkSize || 20.0));
      const startCz = Math.floor((startPos.z + half) / (chunkSystem.chunkSize || 20.0));
      const maxChunks = (chunkSystem.isMobile ? (window.MOBILE_MAX_CHUNKS || 6) : chunkSystem.maxLoadedChunks) || 6;

      // Sleigh start chunk first, then immediate 1-ring neighbors (matching ChunkScheduler mandatory set)
      const chunkCoords = [{ cx: startCx, cz: startCz }];
      const neighborOffsets = [
        { dx: 0, dz: -1 }, { dx: 1, dz: 0 }, { dx: 0, dz: 1 }, { dx: -1, dz: 0 },
        { dx: 1, dz: -1 }, { dx: -1, dz: -1 }, { dx: 1, dz: 1 }, { dx: -1, dz: 1 }
      ];

      for (let i = 0; i < neighborOffsets.length; i++) {
        if (chunkCoords.length >= maxChunks) break;
        chunkCoords.push({ cx: startCx + neighborOffsets[i].dx, cz: startCz + neighborOffsets[i].dz });
      }

      for (let i = 0; i < chunkCoords.length; i++) {
        try {
          chunkSystem.generateChunk(chunkCoords[i].cx, chunkCoords[i].cz);
        } catch (e) {
          console.warn(`[MobileWarmup] Failed to generate chunk ${chunkCoords[i].cx},${chunkCoords[i].cz}:`, e?.message || e);
        }
      }
    }
  } catch (err) {
    console.warn('[MobileWarmup] Chunk pre-generation warning:', err?.message || err);
  }

  // 3. Make every effect visible once during warm-up, render, then restore state
  const restoreTasks = [];
  try {
    // Sleigh trails
    if (sleighController?.flightTrail?.mesh) {
      const prev = sleighController.flightTrail.mesh.visible;
      sleighController.flightTrail.mesh.visible = true;
      restoreTasks.push(() => { sleighController.flightTrail.mesh.visible = prev; });
    }
    if (sleighController?.magicTrail?.mesh) {
      const prev = sleighController.magicTrail.mesh.visible;
      sleighController.magicTrail.mesh.visible = true;
      restoreTasks.push(() => { sleighController.magicTrail.mesh.visible = prev; });
    }

    // Snow particles
    if (snowParticles) {
      const prev = snowParticles.visible;
      snowParticles.visible = true;
      restoreTasks.push(() => { snowParticles.visible = prev; });
    }
    if (largeSnowParticles) {
      const prev = largeSnowParticles.visible;
      largeSnowParticles.visible = true;
      restoreTasks.push(() => { largeSnowParticles.visible = prev; });
    }

    // Delivery markers, route stars, and gift drop preview
    if (deliverySystem) {
      if (deliverySystem.markersGroup) {
        const prev = deliverySystem.markersGroup.visible;
        deliverySystem.markersGroup.visible = true;
        restoreTasks.push(() => { deliverySystem.markersGroup.visible = prev; });
      }
      if (deliverySystem.starsGroup) {
        const prev = deliverySystem.starsGroup.visible;
        deliverySystem.starsGroup.visible = true;
        restoreTasks.push(() => { deliverySystem.starsGroup.visible = prev; });
      }
      if (deliverySystem.giftDropMarker) {
        deliverySystem.giftDropMarker.setVisible(true);
        restoreTasks.push(() => { deliverySystem.giftDropMarker.setVisible(false); });
      }
      if (deliverySystem.guidanceFlow?.particleMesh) {
        const prev = deliverySystem.guidanceFlow.particleMesh.visible;
        deliverySystem.guidanceFlow.particleMesh.visible = true;
        restoreTasks.push(() => { deliverySystem.guidanceFlow.particleMesh.visible = prev; });
      }
    }
  } catch (err) {
    console.warn('[MobileWarmup] Effect visibility preparation warning:', err?.message || err);
  }

  const hideLoader = () => {
    // Restore states
    for (let i = 0; i < restoreTasks.length; i++) {
      try {
        restoreTasks[i]();
      } catch (err) {
        console.warn('[MobileWarmup] Restore task warning:', err?.message || err);
      }
    }

    if (loaderElement) {
      loaderElement.classList.add('hidden');
      setTimeout(() => loaderElement.remove(), 700);
    }
    if (typeof window !== 'undefined') window._loadingCompleteTime = performance.now();
  };

  const doRenderPasses = () => {
    // Render through composer at least twice to compile bloom & OutputPass shaders and allocate targets
    for (let r = 0; r < 2; r++) {
      try {
        if (composer) {
          composer.render();
        } else {
          renderer.render(scene, camera);
        }
      } catch (err) {
        console.warn(`[MobileWarmup] Warm-up render pass ${r + 1} warning:`, err?.message || err);
      }
    }
  };

  if (renderer.compileAsync) {
    renderer.compileAsync(scene, camera).catch((err) => {
      console.warn('[MobileWarmup] compileAsync warning:', err?.message || err);
    }).finally(() => {
      doRenderPasses();
      hideLoader();
    });
  } else {
    doRenderPasses();
    hideLoader();
  }
}