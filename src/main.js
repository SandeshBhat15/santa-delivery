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

// --- Scene Setup: Clean Charcoal Studio Diorama Backdrop ---
const scene = new THREE.Scene();
const studioBgColor = new THREE.Color(0x181a20); // Dark graphite studio floor matching reference
scene.background = studioBgColor;
scene.fog = new THREE.FogExp2(0x181a20, 0.005);

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
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// --- Post-Processing: Subtle, Tight Golden Bloom ---
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Tight bloom to create subtle corona around lantern beads without blinding washouts
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.35, // Subtle strength
  0.28, // Tight radius
  0.84  // Threshold isolates only pure glowing lantern cores and window lights
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

// --- Cinematic Lighting (Matching Reference Image Palette) ---

// 1. Sky Fill Light: Rich periwinkle / violet-blue giving snow its signature painterly twilight tone
const hemiLight = new THREE.HemisphereLight(0x5c74b2, 0x18243e, 1.25);
scene.add(hemiLight);

// 2. Primary Moonlight: Cool crisp directional light casting diagonal shadows from top-left to bottom-right
const moonLight = new THREE.DirectionalLight(0xb4ccff, 2.2);
moonLight.position.set(-20, 36, -24);
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
moonLight.shadow.bias = -0.0003;
scene.add(moonLight);

// 3. Deep ambient fill for shadow depth
const ambientFill = new THREE.AmbientLight(0x1a2644, 0.4);
scene.add(ambientFill);



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
          }

          // 2. Window emission: Clean warm luminescence
          if (mat.emissiveMap) {
            mat.emissive = new THREE.Color(0xffffff);
            mat.emissiveIntensity = 3.2;
            mat.needsUpdate = true;
          }

          // 3. Frozen Crystalline Ice Lake: Mirror-like reflection of lights and moon
          if (
            matName.includes('ice') ||
            matName.includes('water') ||
            (mat.map && mat.map.name && mat.map.name.toLowerCase().includes('ice'))
          ) {
            mat.roughness = 0.1;
            mat.metalness = 0.22;
            if ('clearcoat' in mat) {
              mat.clearcoat = 1.0;
              mat.clearcoatRoughness = 0.08;
            }
          }

          // 4. Snowy Terrain: Soft moonlit diffuse response
          if (matName.includes('snow') || matName.includes('terrain')) {
            mat.roughness = 0.7;
            mat.metalness = 0.03;
          }

          // 5. Rock Cliffs: Rich warm contrast
          if (matName.includes('rock') || matName.includes('cliff')) {
            mat.roughness = 0.88;
          }
        });
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
