import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- DOM Elements ---
const container = document.getElementById('app');
const fpsElement = document.getElementById('fps-counter');
const loaderElement = document.getElementById('loader');
const progressBar = document.getElementById('progress-bar');
const loaderStatus = document.getElementById('loader-status');

// --- Scene Setup: Clean Midnight Twilight Backdrop ---
const scene = new THREE.Scene();
const studioBgColor = new THREE.Color(0x0c111e); // Deep midnight indigo matching reference
scene.background = studioBgColor;
scene.fog = new THREE.FogExp2(0x0c111e, 0.004);

// --- Camera: Hero 3/4 Elevated Isometric Framing ---
const camera = new THREE.PerspectiveCamera(
  32, // Narrow FOV for tabletop diorama look
  window.innerWidth / window.innerHeight,
  0.5,
  500
);
// Exact framing to match user's reference image
camera.position.set(-18.0, 18.5, 13.0);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// --- Post-Processing: Cinematic Golden Hearth Bloom ---
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Bloom creates warm golden coronas around window emissions and cabin hearths
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.45, // Crisp warm corona
  0.32, // Natural radius
  0.85  // Isolates high-intensity window emissions from the snow
);
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

// --- Orbit Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0.0, 0.8, 0.0);
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 4;
controls.maxDistance = 200;
controls.update();

window.game = { scene, camera, renderer, controls, composer };

// --- Cinematic Lighting (Teal & Orange / Deep Indigo & Amber Palette) ---

// 1. Sky Fill Light: Rich twilight indigo providing cool blue shadows on snow
const hemiLight = new THREE.HemisphereLight(0x3e5894, 0x0a1020, 0.55);
scene.add(hemiLight);

// 2. Primary Moonlight: Cool crisp lunar beam casting long, dramatic diagonal shadows
const moonLight = new THREE.DirectionalLight(0x9ebbff, 1.35);
moonLight.position.set(-18, 22, -22);
moonLight.castShadow = true;
moonLight.shadow.mapSize.width = 2048;
moonLight.shadow.mapSize.height = 2048;
moonLight.shadow.camera.near = 5;
moonLight.shadow.camera.far = 120;
const shadowSpan = 32;
moonLight.shadow.camera.left = -shadowSpan;
moonLight.shadow.camera.right = shadowSpan;
moonLight.shadow.camera.top = shadowSpan;
moonLight.shadow.camera.bottom = -shadowSpan;
moonLight.shadow.bias = -0.00008;
moonLight.shadow.normalBias = 0.04;
moonLight.shadow.radius = 2.0;
scene.add(moonLight);

// 3. Deep ambient fill for shadow depth
const ambientFill = new THREE.AmbientLight(0x101828, 0.15);
scene.add(ambientFill);

// --- Warm Radial Hearth Glow Texture (Firelight spilling from windows onto snow) ---
function createHearthGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255, 145, 25, 0.95)');
  g.addColorStop(0.25, 'rgba(255, 105, 15, 0.65)');
  g.addColorStop(0.55, 'rgba(215, 65, 5, 0.25)');
  g.addColorStop(0.85, 'rgba(160, 35, 0, 0.05)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

const hearthGlowGeo = new THREE.PlaneGeometry(1.3, 1.3);
const hearthGlowMat = new THREE.MeshBasicMaterial({
  map: createHearthGlowTexture(),
  transparent: true,
  opacity: 0.55,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});

const villagePointLights = [];



// --- Load Terrain GLTF ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/libs/draco/gltf/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

const modelUrl = '/assets/models/terrain.glb';

gltfLoader.load(
  modelUrl,
  (gltf) => {
    const root = gltf.scene;

    // Center model at origin
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());

    root.position.x = -center.x;
    root.position.y = -box.min.y;
    root.position.z = -center.z;

    scene.add(root);

    const houseCoords = [];

    // Traverse and optimize materials
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

          // 1. House Material: Preserve Alpha Texture while keeping DepthWrite
          if (
            meshName.includes('house') ||
            meshName.includes('building') ||
            matName.includes('building') ||
            matName.includes('house')
          ) {
            mat.transparent = true;
            mat.alphaTest = 0.5; // Cleanly clips cutout texture borders
            mat.depthWrite = true; // Prevents backface bleed/sorting glitch
            mat.depthTest = true;
            mat.side = THREE.DoubleSide;

            // Collect world position for hearth light spill on surrounding snow
            const wp = new THREE.Vector3();
            child.getWorldPosition(wp);
            houseCoords.push(wp);
          }

          // 2. Window emission: Fiery golden-amber hearth glow
          if (mat.emissiveMap) {
            mat.emissive = new THREE.Color(0xff7a10);
            mat.emissiveIntensity = 4.8;
            mat.needsUpdate = true;
          }

          // 3. Frozen Crystalline Ice Lake: Mirror-like reflection of moonlight & icy luminescence
          if (
            matName.includes('ice') ||
            matName.includes('water') ||
            (mat.map && mat.map.name && mat.map.name.toLowerCase().includes('ice'))
          ) {
            mat.roughness = 0.25;
            mat.metalness = 0.05;
            mat.emissive = new THREE.Color(0x1a4a80);
            mat.emissiveIntensity = 1.0;
            mat.needsUpdate = true;
          }

          // 4. Snowy Terrain: Soft moonlit diffuse response
          if (matName.includes('snow') || matName.includes('terrain')) {
            mat.roughness = 0.65;
            mat.metalness = 0.02;
          }

          // 5. Rock Cliffs: Rich warm contrast
          if (matName.includes('rock') || matName.includes('cliff')) {
            mat.roughness = 0.85;
          }
        });
      }
    });

    // Add warm hearth light pools under cabins (firelight spilling onto snow, matching reference)
    const filteredPoints = [];
    houseCoords.forEach((hp) => {
      // Keep decals inside the island boundary so they don't overhang into the black void
      if (Math.abs(hp.x) > 8.9 || Math.abs(hp.z) > 8.9) return;

      const tooClose = filteredPoints.some(
        (p) => Math.hypot(p.x - hp.x, p.z - hp.z) < 0.95
      );
      if (!tooClose) {
        filteredPoints.push(hp);

        // Ground firelight pool under house
        const pool = new THREE.Mesh(hearthGlowGeo, hearthGlowMat);
        pool.position.set(hp.x, hp.y + 0.015, hp.z);
        pool.rotation.x = -Math.PI / 2;
        scene.add(pool);

        // Subtle dynamic warm village point light (capped to max 12 lights inside the village, avoiding perimeter)
        if (
          villagePointLights.length < 12 &&
          filteredPoints.length % 3 === 0 &&
          Math.abs(hp.x) < 8.2 &&
          Math.abs(hp.z) < 8.2
        ) {
          const pl = new THREE.PointLight(0xff8815, 0.95, 3.5, 2.0);
          pl.position.set(hp.x, hp.y + 0.45, hp.z);
          pl.userData = { baseIntensity: 0.95, seed: Math.random() * 10 };
          scene.add(pl);
          villagePointLights.push(pl);
        }
      }
    });

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
  composer.setSize(width, height);
});

// --- Animation Loop ---
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;
const clock = new THREE.Clock();

function animate(currentTime) {
  requestAnimationFrame(animate);

  const elapsedTime = clock.getElapsedTime();

  // Update camera controls
  controls.update();

  // Gentle hearth fire flicker animation for village cabins
  villagePointLights.forEach((pl) => {
    const flicker =
      Math.sin(elapsedTime * 3.8 + pl.userData.seed) * 0.10 +
      Math.cos(elapsedTime * 2.2 + pl.userData.seed * 2) * 0.05;
    pl.intensity = pl.userData.baseIntensity * (1 + flicker);
  });
  // Telemetry
  frameCount++;
  if (currentTime >= lastTime + 1000) {
    fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
    if (fpsElement) {
      fpsElement.textContent = `FPS: ${fps} | Calls: ${renderer.info.render.calls} | Polys: ${renderer.info.render.triangles.toLocaleString()}`;
    }
    frameCount = 0;
    lastTime = currentTime;
  }

  // Render via Bloom Composer
  composer.render();
}

requestAnimationFrame(animate);
