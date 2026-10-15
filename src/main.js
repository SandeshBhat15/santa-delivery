import * as THREE from 'three';

// --- Scene Setup ---
const container = document.getElementById('app');
const fpsElement = document.getElementById('fps-counter');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1422);
scene.fog = new THREE.FogExp2(0x0e1422, 0.025);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 4, 8);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setSize(window.innerWidth, window.innerHeight);
// Limit pixel ratio to 2 for mobile performance (prevents GPU overheating on 3x screens)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xddeeff, 0.8);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfffaed, 2.0);
sunLight.position.set(10, 15, 10);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 50;
const d = 10;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
scene.add(sunLight);

// --- Starter Visuals (Ground + Demo Object) ---
// Ground plane
const groundGeo = new THREE.PlaneGeometry(30, 30);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x1f293d,
  roughness: 0.8,
  metalness: 0.1
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Grid helper for spatial reference
const gridHelper = new THREE.GridHelper(30, 30, 0x00ffcc, 0x2b384e);
gridHelper.position.y = 0.01;
scene.add(gridHelper);

// Starter floating crystal / cube
const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
const material = new THREE.MeshStandardMaterial({
  color: 0x00d9ff,
  roughness: 0.3,
  metalness: 0.4
});
const cube = new THREE.Mesh(geometry, material);
cube.position.set(0, 1.5, 0);
cube.castShadow = true;
cube.receiveShadow = true;
scene.add(cube);

// --- Window Resize Handling ---
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// --- Performance / FPS Counter ---
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;

// --- Animation Loop ---
function animate(currentTime) {
  requestAnimationFrame(animate);

  // FPS calculation
  frameCount++;
  if (currentTime >= lastTime + 1000) {
    fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
    if (fpsElement) {
      fpsElement.textContent = `FPS: ${fps} | Calls: ${renderer.info.render.calls} | Polys: ${renderer.info.render.triangles}`;
    }
    frameCount = 0;
    lastTime = currentTime;
  }

  // Demo rotation
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.015;

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
