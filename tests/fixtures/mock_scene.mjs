// tests/fixtures/mock_scene.mjs
// Lightweight Three.js scene, camera, and chunk mocks for headless testing

import * as THREE from 'three';

export function createMockSceneContext() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
  camera.position.set(0, 1.5, 10);

  const controls = {
    enabled: false,
    update: () => {},
    target: new THREE.Vector3()
  };

  const chunkSystem = {
    getHeight: (x, z) => 0.0, // Flat terrain at y=0.0
    isChunkLoaded: () => true,
    update: () => {}
  };

  return { scene, camera, controls, chunkSystem };
}

/**
 * Creates mock target cottage coordinates and beacon bounding volume
 */
export function createMockCottageTarget(x = 0, y = 0, z = -20) {
  return {
    position: new THREE.Vector3(x, y, z),
    chimneyPosition: new THREE.Vector3(x, y + 1.2, z),
    beaconRadius: 0.16,
    beaconHeight: 0.22,
    iconHeight: 0.48
  };
}

/**
 * Creates mock route stars list
 */
export function createMockRouteStars(count = 6) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      id: i,
      position: new THREE.Vector3(Math.sin(i) * 5, 1.2, -10 - i * 15),
      collected: false,
      radius: 0.35
    });
  }
  return stars;
}
