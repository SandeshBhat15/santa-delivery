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

// --- Scene & Realistic Night Sky Atmosphere ---
const scene = new THREE.Scene();

window.THREE = THREE;

// 1. Deep Midnight Winter Sky Dome Texture
function createSkyDomeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Vertical atmospheric gradient: Deep cosmic black at zenith -> Dark midnight indigo -> Horizon mist veil
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#010308'); // Cosmic midnight zenith
  grad.addColorStop(0.35, '#020612'); // Deep interstellar dark
  grad.addColorStop(0.65, '#050e1f'); // Moonlit scattered deep atmosphere
  grad.addColorStop(0.85, '#0b182b'); // Horizon mountain mist veil (matches fog)
  grad.addColorStop(1.0, '#07101e'); // Low ground absorption

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  // Soft lunar glow halo in the upper night sky
  const glowGrad = ctx.createRadialGradient(720, 240, 10, 720, 240, 320);
  glowGrad.addColorStop(0.0, 'rgba(100, 150, 220, 0.14)');
  glowGrad.addColorStop(0.5, 'rgba(40, 75, 130, 0.05)');
  glowGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, 1024, 512);

  return new THREE.CanvasTexture(canvas);
}

const skyTexture = createSkyDomeTexture();
const skyGeo = new THREE.SphereGeometry(500, 32, 24);
const skyMat = new THREE.MeshBasicMaterial({
  map: skyTexture,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false
});
const skyDome = new THREE.Mesh(skyGeo, skyMat);
scene.add(skyDome);

// Deep dark midnight background color matching the horizon mist
const nightMistyColor = new THREE.Color(0x0b182b);
scene.background = nightMistyColor;

// 2. Realistic Low-Altitude Winter Mist & Distance Fog
// FogExp2 gently wraps the entire scene in atmospheric cool night mist
scene.fog = new THREE.FogExp2(0x0b182b, 0.032);

// 3. Moon Disk & Celestial Lunar Corona
const moonPivot = new THREE.Group();
const moonDist = 380;
const moonGeo = new THREE.PlaneGeometry(28, 28);

function createMoonTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.18, 'rgba(225, 240, 255, 0.9)');
  grad.addColorStop(0.38, 'rgba(150, 190, 245, 0.45)');
  grad.addColorStop(0.70, 'rgba(80, 130, 210, 0.12)');
  grad.addColorStop(1.0, 'rgba(50, 90, 170, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

const moonMat = new THREE.MeshBasicMaterial({
  map: createMoonTexture(),
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide
});
const moonMesh = new THREE.Mesh(moonGeo, moonMat);
moonMesh.position.set(130, 220, 100);
moonMesh.lookAt(0, 0, 0);
scene.add(moonMesh);

// 4. Subtle Distant Stars in the clear mountain night
const starCount = 550;
const starGeo = new THREE.BufferGeometry();
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const u = Math.random();
  const v = Math.random();
  const theta = u * 2.0 * Math.PI;
  const phi = Math.acos(2.0 * v - 1.0);
  const r = 420;
  const y = Math.abs(r * Math.cos(phi)) + 20; // upper hemisphere
  starPositions[i * 3] = r * Math.sin(phi) * Math.sin(theta);
  starPositions[i * 3 + 1] = y;
  starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.cos(theta);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({
  color: 0xc4dcff,
  size: 1.1,
  transparent: true,
  opacity: 0.7,
  depthWrite: false
});
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
// Starting framed view looking across the misty frozen river toward the glowing houses
camera.position.set(-6, 2.5, -2.0);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92; // Deep, authentic night contrast
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// --- Orbit Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI / 2 - 0.02; // Keep camera above ground
controls.minDistance = 2.0;
controls.maxDistance = 250;
controls.target.set(0, 0.6, -4.5);
controls.update();

window.game = { scene, camera, renderer, controls };

// --- Authentic Night Lighting (Cool, Subtle Moonlight) ---
// Ambient moonlight: cool deep navy sky bounce with dark shadowed ground
const hemiLight = new THREE.HemisphereLight(0x162844, 0x03060a, 0.20);
scene.add(hemiLight);

// Directional Moonlight: soft silver-blue beam casting long night shadows
const moonLight = new THREE.DirectionalLight(0x7aa0ce, 0.32);
moonLight.position.set(45, 75, 35);
moonLight.castShadow = true;
moonLight.shadow.mapSize.width = 2048;
moonLight.shadow.mapSize.height = 2048;
moonLight.shadow.camera.near = 10;
moonLight.shadow.camera.far = 190;
const d = 55;
moonLight.shadow.camera.left = -d;
moonLight.shadow.camera.right = d;
moonLight.shadow.camera.top = d;
moonLight.shadow.camera.bottom = -d;
moonLight.shadow.normalBias = 0.05; // Eliminates shadow acne and banding on low-poly terrain
moonLight.shadow.bias = -0.0001;
scene.add(moonLight);

// Minimal night ambient fill
const ambientWarm = new THREE.AmbientLight(0x081322, 0.08);
scene.add(ambientWarm);

// --- Tangible Drifting Low Ground Mist (Soft Rolling Fog Banks across the lake & valleys) ---
function createMistTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Radial gradient with cubic smooth falloff (no clipping edges)
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0.0, 'rgba(215, 235, 255, 0.42)');
  grad.addColorStop(0.25, 'rgba(175, 210, 250, 0.30)');
  grad.addColorStop(0.55, 'rgba(125, 170, 225, 0.14)');
  grad.addColorStop(0.80, 'rgba(75, 125, 190, 0.04)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

const mistTexture = createMistTexture();
const mistGroup = new THREE.Group();
mistGroup.name = 'valleyMistGroup';
scene.add(mistGroup);

const mistSprites = [];

// Low ground mist anchor positions: along the frozen river, village hollows, cliff bases, and valleys
const mistAnchors = [
  // Along the frozen lake / river
  { x: -3.2, y: 0.38, z: 1.0, w: 5.5, h: 1.7, op: 0.22 },
  { x: -1.2, y: 0.38, z: 1.3, w: 5.0, h: 1.6, op: 0.20 },
  { x: 1.0, y: 0.38, z: 0.6, w: 5.4, h: 1.7, op: 0.22 },
  { x: 3.2, y: 0.40, z: -0.4, w: 5.8, h: 1.8, op: 0.19 },
  { x: 5.5, y: 0.42, z: -1.8, w: 6.2, h: 1.9, op: 0.21 },
  // Between village cottages and background mountain
  { x: -4.5, y: 0.65, z: -3.5, w: 6.5, h: 2.0, op: 0.18 },
  { x: -2.0, y: 0.68, z: -4.2, w: 7.2, h: 2.1, op: 0.22 },
  { x: 0.5, y: 0.70, z: -4.8, w: 7.0, h: 2.0, op: 0.20 },
  { x: 2.8, y: 0.75, z: -4.5, w: 6.4, h: 1.9, op: 0.19 },
  // Valley under the central cliff
  { x: -1.2, y: 0.80, z: -7.0, w: 8.5, h: 2.5, op: 0.25 },
  { x: 1.5, y: 0.85, z: -7.5, w: 9.0, h: 2.6, op: 0.26 },
  { x: 3.8, y: 0.90, z: -8.0, w: 8.5, h: 2.4, op: 0.24 },
  // Village entry path & hollows
  { x: -6.5, y: 0.55, z: -1.0, w: 5.5, h: 1.8, op: 0.20 },
  { x: -5.0, y: 0.48, z: 0.2, w: 5.2, h: 1.6, op: 0.19 },
  // Right slope and church surroundings
  { x: 6.0, y: 0.85, z: -4.0, w: 6.2, h: 1.8, op: 0.18 },
  { x: 8.2, y: 0.90, z: -3.0, w: 5.8, h: 1.7, op: 0.17 },
  { x: 7.5, y: 0.70, z: 0.5, w: 5.5, h: 1.7, op: 0.18 }
];

mistAnchors.forEach((loc) => {
  // Layer multiple soft drifting sprites per anchor
  for (let j = 0; j < 2; j++) {
    const mat = new THREE.SpriteMaterial({
      map: mistTexture,
      transparent: true,
      opacity: loc.op * (0.8 + Math.random() * 0.4),
      color: new THREE.Color(0x789ec6), // Cool moonlit atmospheric vapor
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    const sprite = new THREE.Sprite(mat);
    const jx = loc.x + (Math.random() - 0.5) * 1.6;
    const jy = loc.y + (Math.random() - 0.5) * 0.15;
    const jz = loc.z + (Math.random() - 0.5) * 1.6;
    const jw = loc.w * (0.85 + Math.random() * 0.3);
    const jh = loc.h * (0.85 + Math.random() * 0.3);
    sprite.position.set(jx, jy, jz);
    sprite.scale.set(jw, jh, 1.0);
    mistGroup.add(sprite);

    mistSprites.push({
      sprite,
      baseX: jx,
      baseY: jy,
      driftSpeed: 0.002 + Math.random() * 0.003,
      driftRange: 2.5 + Math.random() * 1.5,
      bobFreq: 0.35 + Math.random() * 0.45,
      phase: Math.random() * Math.PI * 2
    });
  }
});

// --- Delicate, True-to-Scale Winter Snowfall Particles ---
function createSnowflakeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.25, 'rgba(240, 248, 255, 0.9)');
  gradient.addColorStop(0.55, 'rgba(200, 225, 255, 0.3)');
  gradient.addColorStop(0.85, 'rgba(160, 200, 245, 0.06)');
  gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const snowTexture = createSnowflakeTexture();

// Snow volume bounds covering the playable island and sky
const snowBounds = { x: 45, y: 20, z: 45 };

// Layer 1: Dense ambient village snowfall
const snowCount = 3200;
const snowGeo = new THREE.BufferGeometry();
const snowPositions = new Float32Array(snowCount * 3);
const snowVelocities = [];

for (let i = 0; i < snowCount; i++) {
  snowPositions[i * 3] = (Math.random() - 0.5) * snowBounds.x;
  snowPositions[i * 3 + 1] = Math.random() * snowBounds.y;
  snowPositions[i * 3 + 2] = (Math.random() - 0.5) * snowBounds.z;

  snowVelocities.push({
    fallSpeed: 0.016 + Math.random() * 0.028,
    swaySpeed: 0.8 + Math.random() * 1.2,
    swayAmp: 0.012 + Math.random() * 0.02,
    windDrift: 0.007 + Math.random() * 0.01,
    offset: Math.random() * Math.PI * 2
  });
}

snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
const snowMat = new THREE.PointsMaterial({
  size: 0.18, // True-to-scale delicate snow crystals
  map: snowTexture,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
const snowParticles = new THREE.Points(snowGeo, snowMat);
scene.add(snowParticles);

// Layer 2: Soft foreground flakes fluttering near camera lens
const largeSnowCount = 280;
const largeSnowGeo = new THREE.BufferGeometry();
const largeSnowPositions = new Float32Array(largeSnowCount * 3);
const largeSnowVelocities = [];

for (let i = 0; i < largeSnowCount; i++) {
  largeSnowPositions[i * 3] = (Math.random() - 0.5) * snowBounds.x;
  largeSnowPositions[i * 3 + 1] = Math.random() * snowBounds.y;
  largeSnowPositions[i * 3 + 2] = (Math.random() - 0.5) * snowBounds.z;

  largeSnowVelocities.push({
    fallSpeed: 0.014 + Math.random() * 0.022,
    swaySpeed: 0.6 + Math.random() * 0.9,
    swayAmp: 0.02 + Math.random() * 0.03,
    windDrift: 0.009 + Math.random() * 0.012,
    offset: Math.random() * Math.PI * 2
  });
}

largeSnowGeo.setAttribute('position', new THREE.BufferAttribute(largeSnowPositions, 3));
const largeSnowMat = new THREE.PointsMaterial({
  size: 0.38, // Atmospheric foreground flakes (delicate, not huge blobs)
  map: snowTexture,
  transparent: true,
  opacity: 0.80,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
const largeSnowParticles = new THREE.Points(largeSnowGeo, largeSnowMat);
scene.add(largeSnowParticles);

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

          // Fix Blender glTF alpha transparency: ensure solid architecture is opaque with depthWrite
          if (
            meshName.includes('house') ||
            meshName.includes('building') ||
            matName.includes('building') ||
            matName.includes('house')
          ) {
            mat.transparent = false;
            mat.depthWrite = true;
            mat.depthTest = true;
            mat.alphaTest = 0;
          }

          // 1. Process meshes with explicit emission textures (like house glowing windows)
          if (mat.emissiveMap) {
            mat.emissive = new THREE.Color(0xffa834);
            mat.emissiveIntensity = 3.5;
            mat.toneMapped = false;
            mat.needsUpdate = true;
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
            mat.emissive = new THREE.Color(0xffa834);
            mat.emissiveIntensity = 3.5;
            mat.toneMapped = false;
            mat.needsUpdate = true;
          }
          // 3. Realistic night response for snow and frozen crystalline ice
          else if (matName.includes('snow')) {
            mat.roughness = 0.85; // Powdery fresh dry snow
            mat.metalness = 0.02;
          } else if (matName.includes('ice') || matName.includes('water')) {
            mat.roughness = 0.18; // Glazed frozen river surface reflecting moonlight
            mat.metalness = 0.1;
          }
        });
      }
    });

    // --- Analyze Houses and Setup Soft Glow & Chunk Lights ---
    const houseMeshes = [];
    root.traverse((child) => {
      const meshName = (child.name || '').toLowerCase();
      if (child.isMesh && (meshName.includes('house') || meshName.includes('building') || meshName.includes('cottage') || meshName.includes('cabin'))) {
        houseMeshes.push(child);
      }
    });

    // Extract world positions for clustering
    const housesData = houseMeshes.map((mesh) => {
      const pos = new THREE.Vector3();
      mesh.getWorldPosition(pos);
      return { mesh, pos };
    });

    // Spatial clustering: Group houses closer than 1.4 units into chunks
    const CLUSTER_DIST = 1.4;
    const clusters = [];
    const visited = new Set();

    for (let i = 0; i < housesData.length; i++) {
      if (visited.has(i)) continue;
      const cluster = [housesData[i]];
      visited.add(i);

      const queue = [housesData[i]];
      while (queue.length > 0) {
        const current = queue.shift();
        for (let j = 0; j < housesData.length; j++) {
          if (!visited.has(j)) {
            const dx = current.pos.x - housesData[j].pos.x;
            const dz = current.pos.z - housesData[j].pos.z;
            const dist = Math.hypot(dx, dz);
            if (dist <= CLUSTER_DIST) {
              visited.add(j);
              cluster.push(housesData[j]);
              queue.push(housesData[j]);
            }
          }
        }
      }
      clusters.push(cluster);
    }

    // Array to store village lights for subtle cozy flicker
    window.villageLights = [];

    // Add lighting based on cluster size:
    // - Single / Isolated house (1-2 houses): soft intimate glow, smaller radius
    // - Chunk of houses (3+ houses): 1 central warm light with larger spread & soft falloff
    clusters.forEach((cluster) => {
      const count = cluster.length;
      const center = new THREE.Vector3();
      cluster.forEach((h) => center.add(h.pos));
      center.divideScalar(count);

      if (count >= 3) {
        // Chunk of houses: 1 light with more spread, elevated slightly above roofs
        const spreadRadius = Math.min(6 + count * 0.15, 12);
        const chunkLight = new THREE.PointLight(0xffb040, 1.35, spreadRadius, 1.4);
        chunkLight.position.set(center.x, center.y + 0.8, center.z);
        scene.add(chunkLight);

        window.villageLights.push({
          light: chunkLight,
          baseIntensity: 1.35,
          freq: 1.5 + Math.random() * 2.0,
          phase: Math.random() * Math.PI * 2
        });
      } else {
        // Isolated house: soft cozy glow, close to ground/doorstep, not too intense
        const softLight = new THREE.PointLight(0xff9d26, 0.75, 4.0, 1.6);
        softLight.position.set(center.x, center.y + 0.35, center.z);
        scene.add(softLight);

        window.villageLights.push({
          light: softLight,
          baseIntensity: 0.75,
          freq: 2.0 + Math.random() * 2.5,
          phase: Math.random() * Math.PI * 2
        });
      }
    });

    // Frame camera on the cozy village across the frozen lake with atmospheric mist in view
    camera.position.set(-5.5, 2.2, -2.0);
    camera.lookAt(0.5, 0.5, -4.5);
    controls.target.set(0.5, 0.5, -4.5);
    controls.update();

    // Adjust shadow frustum to fit model size
    const maxDim = Math.max(size.x, size.z, 20);
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

  // Subtle warm flicker for village house lights (simulating fireplace/hearth embers)
  if (window.villageLights && window.villageLights.length > 0) {
    for (let i = 0; i < window.villageLights.length; i++) {
      const vl = window.villageLights[i];
      const flicker = Math.sin(elapsedTime * vl.freq + vl.phase) * 0.08 +
                      Math.cos(elapsedTime * vl.freq * 2.3) * 0.04;
      vl.light.intensity = vl.baseIntensity * (1 + flicker);
    }
  }

  // Update Drifting Low Ground Mist (Wafting across lake, valley, and village)
  if (mistSprites && mistSprites.length > 0) {
    for (let i = 0; i < mistSprites.length; i++) {
      const ms = mistSprites[i];
      ms.sprite.position.x = ms.baseX + Math.sin(elapsedTime * ms.driftSpeed * 10 + ms.phase) * ms.driftRange;
      ms.sprite.position.y = ms.baseY + Math.sin(elapsedTime * ms.bobFreq + ms.phase) * 0.05;
    }
  }

  // Update Snow Particles (Layer 1 - Fine background snowfall)
  const positions = snowGeo.attributes.position.array;
  for (let i = 0; i < snowCount; i++) {
    const v = snowVelocities[i];
    positions[i * 3 + 1] -= v.fallSpeed;
    positions[i * 3] += Math.sin(elapsedTime * v.swaySpeed + v.offset) * v.swayAmp + v.windDrift;
    positions[i * 3 + 2] += Math.cos(elapsedTime * 0.6 + v.offset) * 0.01;

    // Wrap around boundaries
    if (positions[i * 3 + 1] < 0) {
      positions[i * 3 + 1] = snowBounds.y;
      positions[i * 3] = (Math.random() - 0.5) * snowBounds.x;
      positions[i * 3 + 2] = (Math.random() - 0.5) * snowBounds.z;
    }
    if (positions[i * 3] > snowBounds.x * 0.5) positions[i * 3] = -snowBounds.x * 0.5;
  }
  snowGeo.attributes.position.needsUpdate = true;

  // Update Snow Particles (Layer 2 - Near camera fluffy flakes)
  const largePositions = largeSnowGeo.attributes.position.array;
  for (let i = 0; i < largeSnowCount; i++) {
    const v = largeSnowVelocities[i];
    largePositions[i * 3 + 1] -= v.fallSpeed;
    largePositions[i * 3] += Math.sin(elapsedTime * v.swaySpeed + v.offset) * v.swayAmp + v.windDrift;
    largePositions[i * 3 + 2] += Math.cos(elapsedTime * 0.5 + v.offset) * 0.015;

    // Wrap around boundaries
    if (largePositions[i * 3 + 1] < 0) {
      largePositions[i * 3 + 1] = snowBounds.y;
      largePositions[i * 3] = (Math.random() - 0.5) * snowBounds.x;
      largePositions[i * 3 + 2] = (Math.random() - 0.5) * snowBounds.z;
    }
    if (largePositions[i * 3] > snowBounds.x * 0.5) largePositions[i * 3] = -snowBounds.x * 0.5;
  }
  largeSnowGeo.attributes.position.needsUpdate = true;

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
