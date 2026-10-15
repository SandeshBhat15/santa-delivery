import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// --- DOM Elements ---
const container = document.getElementById('app');
const fpsElement = document.getElementById('fps-counter');
const loaderElement = document.getElementById('loader');
const progressBar = document.getElementById('progress-bar');
const loaderStatus = document.getElementById('loader-status');

// --- Scene & Night Atmosphere ---
const scene = new THREE.Scene();
const nightColor = new THREE.Color(0x070c18);
scene.background = nightColor;
scene.fog = new THREE.FogExp2(0x070c18, 0.0075);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(25, 20, 35);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setSize(window.innerWidth, window.innerHeight);
// Limit pixel ratio to 2 for smooth mobile performance
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// --- Orbit Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI / 2 - 0.01; // Stay above ground
controls.minDistance = 4;
controls.maxDistance = 300;

window.game = { scene, camera, renderer, controls };

// --- Night Lighting ---
// Ambient moonlight with sky/ground contrast
const hemiLight = new THREE.HemisphereLight(0x354d75, 0x090e1c, 0.65);
scene.add(hemiLight);

// Directional Moonlight
const moonLight = new THREE.DirectionalLight(0xb4d4ff, 1.6);
moonLight.position.set(40, 60, 30);
moonLight.castShadow = true;
moonLight.shadow.mapSize.width = 2048;
moonLight.shadow.mapSize.height = 2048;
moonLight.shadow.camera.near = 10;
moonLight.shadow.camera.far = 180;
const d = 50;
moonLight.shadow.camera.left = -d;
moonLight.shadow.camera.right = d;
moonLight.shadow.camera.top = d;
moonLight.shadow.camera.bottom = -d;
moonLight.shadow.bias = -0.0004;
scene.add(moonLight);

// Subtle warm secondary fill
const ambientWarm = new THREE.AmbientLight(0x181e2b, 0.4);
scene.add(ambientWarm);

// --- Falling Snow Particles ---
function createSnowflakeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(235, 245, 255, 0.85)');
  gradient.addColorStop(0.7, 'rgba(200, 225, 255, 0.25)');
  gradient.addColorStop(1, 'rgba(200, 225, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

const snowCount = 2200;
const snowBounds = { x: 120, y: 55, z: 120 };
const snowGeo = new THREE.BufferGeometry();
const snowPositions = new Float32Array(snowCount * 3);
const snowVelocities = [];

for (let i = 0; i < snowCount; i++) {
  snowPositions[i * 3] = (Math.random() - 0.5) * snowBounds.x;
  snowPositions[i * 3 + 1] = Math.random() * snowBounds.y;
  snowPositions[i * 3 + 2] = (Math.random() - 0.5) * snowBounds.z;

  snowVelocities.push({
    fallSpeed: 0.05 + Math.random() * 0.08,
    swaySpeed: 0.8 + Math.random() * 1.2,
    swayAmp: 0.02 + Math.random() * 0.03,
    offset: Math.random() * Math.PI * 2
  });
}

snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));

const snowMat = new THREE.PointsMaterial({
  size: 0.7,
  map: createSnowflakeTexture(),
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const snowParticles = new THREE.Points(snowGeo, snowMat);
scene.add(snowParticles);

// --- Load Terrain GLTF with House Glow ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/libs/draco/gltf/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

const modelUrl = '/assets/models/terrain.glb';

gltfLoader.load(
  modelUrl,
  (gltf) => {
    const root = gltf.scene;

    // Compute bounding box to center terrain and frame camera
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Center model at origin
    root.position.x = -center.x;
    root.position.y = -box.min.y; // Keep base at ground level
    root.position.z = -center.z;

    scene.add(root);

    // Track glowing points for localized warm lighting
    const warmLightPositions = [];

    // Traverse and process materials & emissions
    root.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];

        materials.forEach((mat) => {
          if (!mat) return;

          const matName = (mat.name || '').toLowerCase();
          const meshName = (child.name || '').toLowerCase();

          // 1. Process meshes with explicit emission textures
          if (mat.emissiveMap) {
            mat.emissive = mat.emissive.getHex() === 0 ? new THREE.Color(0xffe0a0) : mat.emissive;
            mat.emissiveIntensity = 4.5;
            mat.needsUpdate = true;

            const worldPos = new THREE.Vector3();
            child.getWorldPosition(worldPos);
            warmLightPositions.push(worldPos);
          }
          // 2. Process stylized lantern/window/house glow materials
          else if (
            matName.includes('glow') ||
            matName.includes('lantern') ||
            matName.includes('window') ||
            matName.includes('lamp') ||
            matName.includes('light') ||
            matName.includes('emission') ||
            meshName.includes('lantern') ||
            meshName.includes('window')
          ) {
            mat.emissive = new THREE.Color(0xffa834); // Warm amber candle/lamp glow
            mat.emissiveIntensity = 5.0;
            mat.toneMapped = false; // Bypass tone mapping for intense radiant look
            mat.needsUpdate = true;

            const worldPos = new THREE.Vector3();
            child.getWorldPosition(worldPos);
            warmLightPositions.push(worldPos);
          }
          // 3. Crisp snow/rock surface response
          else if (matName.includes('snow') || matName.includes('ice')) {
            mat.roughness = Math.max(mat.roughness, 0.4);
          }
        });
      }
    });

    // Add localized warm point lights near houses/lanterns (capped to maintain 60 FPS)
    const maxLights = Math.min(warmLightPositions.length, 10);
    for (let i = 0; i < maxLights; i++) {
      const pos = warmLightPositions[i];
      const warmLight = new THREE.PointLight(0xff9922, 2.5, 14, 1.8);
      warmLight.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
      scene.add(warmLight);
    }

    // Auto-frame camera based on model dimensions
    const maxDim = Math.max(size.x, size.z, 20);
    camera.position.set(maxDim * 0.7, maxDim * 0.45, maxDim * 0.8);
    camera.lookAt(0, size.y * 0.25, 0);
    controls.target.set(0, size.y * 0.2, 0);
    controls.update();

    // Adjust shadow frustum to fit model size
    moonLight.shadow.camera.left = -maxDim * 0.6;
    moonLight.shadow.camera.right = maxDim * 0.6;
    moonLight.shadow.camera.top = maxDim * 0.6;
    moonLight.shadow.camera.bottom = -maxDim * 0.6;
    moonLight.shadow.camera.updateProjectionMatrix();

    // Fade out loader
    if (loaderElement) {
      loaderElement.classList.add('hidden');
      setTimeout(() => loaderElement.remove(), 700);
    }
  },
  (xhr) => {
    if (xhr.lengthComputable && xhr.total > 0) {
      const percent = Math.round((xhr.loaded / xhr.total) * 100);
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (loaderStatus) loaderStatus.textContent = `${percent}%`;
    }
  },
  (error) => {
    console.error('Failed to load terrain.glb:', error);
    if (loaderStatus) {
      loaderStatus.textContent = 'Error loading 3D model. Check console.';
      loaderStatus.style.color = '#ff6b6b';
    }
  }
);

// --- Window Resize Handling ---
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// --- Performance Telemetry & Animation Loop ---
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;
const clock = new THREE.Clock();

function animate(currentTime) {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const elapsedTime = clock.getElapsedTime();

  // Update controls
  controls.update();

  // Update Snow Particles
  const positions = snowGeo.attributes.position.array;
  for (let i = 0; i < snowCount; i++) {
    const v = snowVelocities[i];
    // Fall downwards
    positions[i * 3 + 1] -= v.fallSpeed;
    // Gentle sway
    positions[i * 3] += Math.sin(elapsedTime * v.swaySpeed + v.offset) * v.swayAmp;

    // Reset when below ground
    if (positions[i * 3 + 1] < 0) {
      positions[i * 3 + 1] = snowBounds.y;
      positions[i * 3] = (Math.random() - 0.5) * snowBounds.x;
      positions[i * 3 + 2] = (Math.random() - 0.5) * snowBounds.z;
    }
  }
  snowGeo.attributes.position.needsUpdate = true;

  // FPS & Draw Call Telemetry
  frameCount++;
  if (currentTime >= lastTime + 1000) {
    fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
    if (fpsElement) {
      fpsElement.textContent = `FPS: ${fps} | Calls: ${renderer.info.render.calls} | Polys: ${renderer.info.render.triangles.toLocaleString()}`;
    }
    frameCount = 0;
    lastTime = currentTime;
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
