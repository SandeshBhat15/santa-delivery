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

// --- Scene & Realistic Night Sky Atmosphere ---
const scene = new THREE.Scene();

window.THREE = THREE;

// --- Cinematic Fairytale Winter Night Atmosphere ---
scene.background = null; // Let the procedural sky dome render as background
scene.environment = null;

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
// Cinematic framed view across the snowy island toward the glowing village
camera.position.set(-6.5, 2.0, -1.5);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
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
controls.target.set(0, 3.5, -5.5);
controls.update();

// --- Cinematic Post-Processing Pipeline (Bloom for Glowing Window Hearths) ---
const composer = new EffectComposer(renderer);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// UnrealBloomPass: Broad, soft dispersion of radiant amber warmth across village architecture and snow
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.42, // Bloom strength
  1.35, // Bloom radius: broad, soft falloff scattering into eaves, walls, and ground snow
  0.68  // Bloom threshold: lower threshold allows window emission glow to blend softly into neighboring surfaces
);
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

window.game = { scene, camera, renderer, controls, composer, bloomPass };

// --- Pure Procedural GLSL Aurora Night Sky Dome (Zero Images, Zero Canvas Textures) ---
const skyVertexShader = `
  varying vec3 vWorldDirection;
  void main() {
    vWorldDirection = position;
    vec4 mvPosition = viewMatrix * vec4(cameraPosition + position, 1.0);
    gl_Position = (projectionMatrix * mvPosition).xyww;
  }
`;

const skyFragmentShader = `
  uniform float uTime;
  varying vec3 vWorldDirection;

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
  float snoise2(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm2(vec2 p) {
    float f = 0.0;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    f += 0.5000 * snoise2(p); p = rot * p * 2.02;
    f += 0.2500 * snoise2(p); p = rot * p * 2.03;
    f += 0.1250 * snoise2(p); p = rot * p * 2.01;
    return f;
  }

  void main() {
    vec3 d = normalize(vWorldDirection);
    float h = d.y;

    // 1. Fairytale Midnight Sky Gradient (Exact match to reference sky.png)
    vec3 cZenith   = vec3(0.010, 0.018, 0.065); // Deep midnight cosmic navy
    vec3 cUpper    = vec3(0.032, 0.075, 0.240); // Rich royal fairytale sapphire
    vec3 cMid      = vec3(0.065, 0.130, 0.380); // Luminous deep blue
    vec3 cHorizon  = vec3(0.115, 0.160, 0.420); // Atmospheric indigo
    vec3 cBlush    = vec3(0.240, 0.170, 0.350); // Twilight violet/lavender glow

    vec3 sky = cZenith;
    sky = mix(sky, cUpper,   smoothstep(0.85, 0.45, h));
    sky = mix(sky, cMid,     smoothstep(0.50, 0.20, h));
    sky = mix(sky, cHorizon, smoothstep(0.24, 0.04, h));
    sky = mix(sky, cBlush,   smoothstep(0.08, -0.06, h));

    // 2. Cosmic Milky Way Nebula Band
    vec3 mwNormal = normalize(vec3(0.65, 0.55, -0.45));
    float mwDist = abs(dot(d, mwNormal));
    if (h > 0.02 && mwDist < 0.35) {
      float mwGlow = exp(-mwDist * 9.0) * smoothstep(0.02, 0.18, h);
      vec2 mwCoord = vec2(dot(d, cross(mwNormal, vec3(0,1,0))), dot(d, vec3(0,1,0))) * 3.2;
      float mwDust = fbm2(mwCoord + vec2(1.2, 3.4)) * 0.5 + 0.5;
      vec3 mwCol1 = vec3(0.16, 0.26, 0.62);
      vec3 mwCol2 = vec3(0.30, 0.16, 0.50);
      vec3 mwColor = mix(mwCol1, mwCol2, mwDust);
      sky += mwColor * mwGlow * (0.6 + 0.6 * mwDust) * 0.75;
    }

    // 3. Multi-Layer Celestial Starfield (Clean spherical Gaussian points)
    if (h > 0.02) {
      // Layer A: Crisp dense pinprick stars
      vec3 sGrid = d * 160.0;
      vec3 sid = floor(sGrid);
      vec3 sf = fract(sGrid) - 0.5;
      float sr = hash31(sid);
      if (sr > 0.82) {
        vec3 sOff = (vec3(hash31(sid + 1.1), hash31(sid + 2.3), hash31(sid + 3.7)) - 0.5) * 0.65;
        float sD = length(sf - sOff);
        float sTwinkle = sin(uTime * (2.0 + sr * 3.5) + sr * 62.8) * 0.25 + 0.75;
        float sBri = exp(-sD * sD * 900.0) * (sr - 0.82) * 9.0 * sTwinkle;
        vec3 sCol = (sr > 0.95) ? vec3(1.0, 0.94, 0.82) : vec3(0.88, 0.94, 1.0);
        sky += sCol * sBri * smoothstep(0.02, 0.10, h);
      }

      // Layer B: Sparkling jewel stars
      vec3 bGrid = d * 48.0;
      vec3 bid = floor(bGrid);
      vec3 bf = fract(bGrid) - 0.5;
      float br = hash31(bid + 88.0);
      if (br > 0.965 && h > 0.06) {
        vec3 bOff = (vec3(hash31(bid + 5.1), hash31(bid + 6.3), hash31(bid + 7.7)) - 0.5) * 0.5;
        float bD = length(bf - bOff);
        float bCore = exp(-bD * bD * 1200.0) * 2.8;
        float bAura = exp(-bD * 18.0) * 0.35;
        float bTwinkle = sin(uTime * 1.5 + br * 31.4) * 0.2 + 0.8;
        vec3 bCol = (br > 0.985) ? vec3(1.0, 0.90, 0.72) : vec3(0.88, 0.95, 1.0);
        sky += bCol * (bCore + bAura) * bTwinkle * (br - 0.965) * 35.0 * smoothstep(0.06, 0.16, h);
      }
    }

    // 4. Subtle, Ethereal Aurora Borealis Veil (Delicate & Restrained)
    if (h > 0.08 && h < 0.65) {
      float az = atan(d.z, d.x);
      float alt = h;

      // Center the aurora ribbon above the distant mountain peak in the framed camera view
      float azDiff = az - (-0.28);
      if (azDiff > 3.14159) azDiff -= 6.28318;
      if (azDiff < -3.14159) azDiff += 6.28318;
      float azArc = exp(-pow(azDiff * 1.5, 2.0));

      if (azArc > 0.02) {
        // Slender flowing ribbon
        float ribbonU = az * 2.2 + sin(az * 1.2 + uTime * 0.08) * 0.25;
        float ribbonCenter = 0.32 + sin(ribbonU + uTime * 0.10) * 0.07 + cos(ribbonU * 0.4 - uTime * 0.06) * 0.04;
        float dist = abs(alt - ribbonCenter);

        // Gentle, soft vertical drapery folds
        float drapery = snoise2(vec2(ribbonU * 2.6 + uTime * 0.12, alt * 3.2)) * 0.5 + 0.5;
        float curtain = exp(-dist * dist * 75.0) * (0.35 + 0.65 * drapery);

        // Soft watercolor palette: subtle emerald base to delicate violet crest
        vec3 cEmerald = vec3(0.04, 0.48, 0.35);
        vec3 cCyan    = vec3(0.06, 0.38, 0.55);
        vec3 cViolet  = vec3(0.38, 0.16, 0.50);

        vec3 col = mix(cEmerald, cCyan, smoothstep(ribbonCenter - 0.05, ribbonCenter + 0.02, alt));
        col = mix(col, cViolet, smoothstep(ribbonCenter + 0.01, ribbonCenter + 0.10, alt));

        // Soft, faint translucent glow
        float softGlow = exp(-dist * 12.0) * 0.08;
        vec3 auroraTotal = (col * curtain * 0.28 + cCyan * softGlow * 0.10) * azArc;

        sky += auroraTotal * smoothstep(0.08, 0.16, alt) * smoothstep(0.65, 0.42, alt);
      }
    }

    // 5. Stylized Twilight Horizon Clouds (Matching bottom of sky.png)
    if (h < 0.22 && h > -0.05) {
      vec2 cCoord = vec2(atan(d.z, d.x) * 3.5, (h + 0.05) * 12.0 + uTime * 0.006);
      float cn = fbm2(cCoord) * 0.5 + 0.5;
      float cDensity = smoothstep(0.46, 0.75, cn) * smoothstep(0.20, 0.06, h) * smoothstep(-0.05, 0.02, h);
      if (cDensity > 0.005) {
        vec3 cBase = vec3(0.09, 0.10, 0.22);
        vec3 cRim  = vec3(0.28, 0.22, 0.42);
        vec3 cColor = mix(cBase, cRim, smoothstep(0.02, 0.14, h + (cn - 0.5) * 0.1));
        sky = mix(sky, cColor, cDensity * 0.70);
      }
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`;

const skyShaderUniforms = {
  uTime: { value: 0 }
};

const skyMat = new THREE.ShaderMaterial({
  vertexShader: skyVertexShader,
  fragmentShader: skyFragmentShader,
  uniforms: skyShaderUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: true
});

const skyDome = new THREE.Mesh(new THREE.SphereGeometry(700, 64, 48), skyMat);
skyDome.name = 'ProceduralSkyDome';
skyDome.renderOrder = -1000;
scene.add(skyDome);

// --- True 3D Volumetric Height Fog & Atmospheric Perspective (Zero 2D Planes / Billboards) ---
// Enable scene fog so all 3D MeshStandardMaterials activate the fog pipeline
scene.fog = new THREE.Fog(0x182046, 1.0, 100.0);

// 1. Pass true 3D world coordinates from vertex shader to fragment shader
THREE.ShaderChunk.fog_pars_vertex = `
  #ifdef USE_FOG
    varying float vFogDepth;
    varying vec3 vFogWorldPos;
  #endif
`;

THREE.ShaderChunk.fog_vertex = `
  #ifdef USE_FOG
    vFogDepth = - mvPosition.z;
    vFogWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif
`;

// 2. Fragment shader declarations
THREE.ShaderChunk.fog_pars_fragment = `
  #ifdef USE_FOG
    uniform vec3 fogColor;
    varying float vFogDepth;
    varying vec3 vFogWorldPos;
  #endif
`;

// 3. True 3D Volumetric Height Mist + Atmospheric Distance Fog
// Analytically integrates exponential density along the 3D line of sight from camera to 3D surface
THREE.ShaderChunk.fog_fragment = `
  #ifdef USE_FOG
    vec3 fCamPos = cameraPosition;
    vec3 fWorldPos = vFogWorldPos;
    vec3 fRay = fWorldPos - fCamPos;
    float fDist = length(fRay);
    vec3 fRayDir = fRay / max(fDist, 0.0001);

    // --- 3D Volumetric Height Mist ---
    // Mist pools naturally at lake level (h0 = 0.38) and decays exponentially upwards
    float fBaseH = 0.38;
    float fHeightFalloff = 1.25;
    float fDensity0 = 0.18;

    float fDeltaY = fWorldPos.y - fCamPos.y;
    float fIntegral;
    if (abs(fDeltaY) > 0.001) {
      fIntegral = (exp(-fHeightFalloff * (fCamPos.y - fBaseH)) - exp(-fHeightFalloff * (fWorldPos.y - fBaseH))) / (fHeightFalloff * fDeltaY);
    } else {
      fIntegral = exp(-fHeightFalloff * (fCamPos.y - fBaseH));
    }
    fIntegral = max(0.0, fIntegral);

    // Subtle 3D spatial drift undulation in the volume
    float fEddy = sin(fWorldPos.x * 0.22 + fWorldPos.z * 0.16) * 0.15;
    float fHeightDepth = fIntegral * fDist * fDensity0 * (1.0 + fEddy);
    float fHeightFog = 1.0 - exp(-fHeightDepth);

    // --- 3D Atmospheric Distance Fog ---
    float fDistFog = smoothstep(5.0, 26.0, fDist) * 0.60;

    // Combined 3D fog thickness
    float fTotalFog = clamp(fHeightFog + fDistFog, 0.0, 0.78);

    // Rich cinematic twilight indigo color grading
    vec3 cValleyMist = vec3(0.08, 0.11, 0.25);
    vec3 cDistanceFog = vec3(0.12, 0.16, 0.36);
    vec3 fFogColor = mix(cValleyMist, cDistanceFog, smoothstep(0.0, 0.6, fDistFog));

    gl_FragColor.rgb = mix(gl_FragColor.rgb, fFogColor, fTotalFog);
  #endif
`;

// 1. Sky & Shadow Fill: Rich indigo ambient illumination with deep blue-violet shadow bounce
const starlightHemiLight = new THREE.HemisphereLight(0x324c8c, 0x161b36, 0.65);
scene.add(starlightHemiLight);

// 2. Moonlight Key: Subtle cool lavender-blue moonlight simulating distant moon illumination without visible sky/moon mesh
const moonLight = new THREE.DirectionalLight(0x6a90e0, 0.72);
moonLight.position.set(28, 48, -22);
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
moonLight.shadow.normalBias = 0.04;
moonLight.shadow.bias = -0.0002;
moonLight.shadow.radius = 2.5;
scene.add(moonLight);

// 3. Subtle midnight indigo fill to ensure deep crevices never clip to black
const ambientWarm = new THREE.AmbientLight(0x161c36, 0.22);
scene.add(ambientWarm);

// --- Pure Procedural GLSL Snowfall (Zero Canvas Textures) ---
const snowVertexShader = `
  uniform float uSize;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const snowFragmentShader = `
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(0.95, 0.98, 1.0), alpha * 0.85);
  }
`;

const snowBounds = { x: 45, y: 20, z: 45 };

// Layer 1: Ambient village snowfall
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
const snowMat = new THREE.ShaderMaterial({
  vertexShader: snowVertexShader,
  fragmentShader: snowFragmentShader,
  uniforms: { uSize: { value: 0.11 } },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
const snowParticles = new THREE.Points(snowGeo, snowMat);
scene.add(snowParticles);

// Layer 2: Near-camera fluffy flakes
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
const largeSnowMat = new THREE.ShaderMaterial({
  vertexShader: snowVertexShader,
  fragmentShader: snowFragmentShader,
  uniforms: { uSize: { value: 0.16 } },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
const largeSnowParticles = new THREE.Points(largeSnowGeo, largeSnowMat);
scene.add(largeSnowParticles);

// --- Custom Procedural Snow Shader Uniforms for Terrain Material ---
const terrainSnowUniforms = {
  uTime: { value: 0 },
  uSnowColor: { value: new THREE.Color(0xeaf2ff) },       // Soft luminous powder crest
  uSnowMidColor: { value: new THREE.Color(0x7e9cd6) },    // Translucent lavender-blue midtone
  uSnowShadowColor: { value: new THREE.Color(0x28305c) }, // Deep fairytale indigo-violet crevice shadow
  uSparkleIntensity: { value: 0.90 }
};

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

          // Preserve Blender glTF alpha transparency with alphaTest cutout for scalloped roof snow trim
          if (
            meshName.includes('house') ||
            meshName.includes('building') ||
            matName.includes('building') ||
            matName.includes('house')
          ) {
            mat.transparent = true;
            mat.alphaTest = 0.45; // Cuts out the transparent border around the wavy snow roof trim
            mat.depthWrite = true; // Ensures solid architecture occlusion without z-sorting artifacts
            mat.depthTest = true;
            mat.side = THREE.DoubleSide;
            mat.needsUpdate = true;
          }

          // 1. Process meshes with explicit emission textures (like house glowing windows)
          if (mat.emissiveMap) {
            mat.emissive = new THREE.Color(0xffa63b);
            mat.emissiveIntensity = 3.6;
            mat.toneMapped = true;
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
            mat.emissive = new THREE.Color(0xffa63b);
            mat.emissiveIntensity = 3.6;
            mat.toneMapped = true;
            mat.needsUpdate = true;
          }
          // 3. Ground, Cliffs, Lake and Plateau separation
          const isLake = meshName.includes('lake') ||
                         meshName.includes('water') ||
                         meshName.includes('river') ||
                         matName.includes('ice');

          const isTerrain = matName === 'terrain';

          if (isLake) {
            // Clone material so lake does not mutate shared Plateau material
            if (child.material === mat) {
              child.material = mat.clone();
            }
            const lakeMat = child.material;
            lakeMat.roughness = 0.22; // Clean icy gloss with soft moonlight specular highlights
            lakeMat.metalness = 0.05;
            lakeMat.color = new THREE.Color(0xffffff); // Full neutral multiplier so Seamless Crystalline Blue Ice Texture is completely visible
            lakeMat.needsUpdate = true;
          } else if (isTerrain && !mat.userData.snowShaderApplied) {
            // Apply custom procedural snow shader mixed with existing terrain texture exclusively to terrain material
            mat.userData.snowShaderApplied = true;
            mat.roughness = 0.80;
            mat.metalness = 0.0;
            mat.customProgramCacheKey = () => 'terrain_procedural_snow_v1';

            mat.onBeforeCompile = (shader) => {
              shader.uniforms.uTime = terrainSnowUniforms.uTime;
              shader.uniforms.uSnowColor = terrainSnowUniforms.uSnowColor;
              shader.uniforms.uSnowMidColor = terrainSnowUniforms.uSnowMidColor;
              shader.uniforms.uSnowShadowColor = terrainSnowUniforms.uSnowShadowColor;
              shader.uniforms.uSparkleIntensity = terrainSnowUniforms.uSparkleIntensity;

              // 1. Vertex Shader: compute and pass world coordinates & world normal
              shader.vertexShader = `
                varying vec3 vTerrainWorldPos;
                varying vec3 vTerrainWorldNormal;
              ` + shader.vertexShader;

              shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `
                #include <worldpos_vertex>
                vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
                vTerrainWorldNormal = normalize(mat3(modelMatrix) * normal);
                `
              );

              // 2. Fragment Shader: Inject procedural noise functions
              shader.fragmentShader = `
                varying vec3 vTerrainWorldPos;
                varying vec3 vTerrainWorldNormal;
                uniform float uTime;
                uniform vec3 uSnowColor;
                uniform vec3 uSnowMidColor;
                uniform vec3 uSnowShadowColor;
                uniform float uSparkleIntensity;

                float hash21Snow(vec2 p) {
                  p = fract(p * vec2(233.34, 851.73));
                  p += dot(p, p + 23.45);
                  return fract(p.x * p.y);
                }

                float snowNoise(vec2 p) {
                  vec2 i = floor(p);
                  vec2 f = fract(p);
                  vec2 u = f * f * (3.0 - 2.0 * f);
                  return mix(
                    mix(hash21Snow(i + vec2(0.0, 0.0)), hash21Snow(i + vec2(1.0, 0.0)), u.x),
                    mix(hash21Snow(i + vec2(0.0, 1.0)), hash21Snow(i + vec2(1.0, 1.0)), u.x),
                    u.y
                  );
                }

                float snowFBM(vec2 p) {
                  float v = 0.0;
                  float a = 0.5;
                  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
                  for (int i = 0; i < 3; i++) {
                    v += a * snowNoise(p);
                    p = rot * p * 2.1 + vec2(1.3, 2.7);
                    a *= 0.5;
                  }
                  return v;
                }
              ` + shader.fragmentShader;

              // Shared variables declared in void main() for map, roughness, and normal passes
              shader.fragmentShader = shader.fragmentShader.replace(
                'void main() {',
                `
                void main() {
                  vec3 sWPos = vTerrainWorldPos;
                  vec3 sWNorm = normalize(vTerrainWorldNormal);
                  vec2 sDriftUv = vec2(sWPos.x * 0.18 + sWPos.z * 0.11, sWPos.z * 0.18 - sWPos.x * 0.11);
                  float sMacroDrift = sin(sDriftUv.x * 1.5 + sin(sDriftUv.y * 1.0) * 0.8) * 0.5 + 0.5;
                  float sMicroRipples = snowFBM(sWPos.xz * 1.15);
                  float sDriftCombined = sMacroDrift * 0.42 + sMicroRipples * 0.58;
                  float sSlope = clamp(sWNorm.y, 0.0, 1.0);
                  float sSnowThreshold = 0.40 - sMicroRipples * 0.16;
                  float sSnowCoverage = smoothstep(sSnowThreshold, sSnowThreshold + 0.30, sSlope);
                `
              );

              // Replace map_fragment to blend procedural snow with existing terrain texture
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `
                #ifdef USE_MAP
                  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
                  #ifdef DECODE_VIDEO_TEXTURE
                    sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
                  #endif
                #else
                  vec4 sampledDiffuseColor = vec4(1.0);
                #endif

                // --- PROCEDURAL SNOW SHADER MIXED WITH TERRAIN TEXTURE ---
                // 1. Procedural Snow Depth Palette with Crevice Ambient Occlusion
                float creviceAO = clamp(sDriftCombined * 1.15 + 0.22, 0.52, 1.0);
                vec3 snowBase = mix(uSnowShadowColor * creviceAO, uSnowMidColor, smoothstep(0.18, 0.62, sDriftCombined));
                vec3 snowCrest = mix(snowBase, uSnowColor, smoothstep(0.52, 0.92, sDriftCombined));

                // 2. View-Dependent Powder Rim & Forward Translucency
                vec3 viewDir = normalize(vViewPosition);
                float fresnel = pow(1.0 - max(0.0, dot(sWNorm, viewDir)), 3.0);
                vec3 snowFinal = snowCrest + vec3(0.12, 0.16, 0.28) * fresnel * 0.50;

                // Subsurface forward scattering in view of moonlight
                vec3 moonDir = normalize(vec3(28.0, 48.0, -22.0));
                float sssScatter = pow(clamp(dot(viewDir, -moonDir), 0.0, 1.0), 3.0) * (1.0 - sSlope * 0.45);
                snowFinal += vec3(0.14, 0.18, 0.32) * sssScatter * 0.45;

                // 3. Crystalline Moonlight Sheen & Delicate Multi-Frequency Glitter
                vec3 halfVec = normalize(viewDir + moonDir);
                float specAngle = max(0.0, dot(sWNorm, halfVec));
                float moonSheen = pow(specAngle, 16.0) * (0.28 + 0.72 * sMacroDrift);
                float glitter1 = snowNoise(sWPos.xz * 32.0 + sin(uTime * 0.4) * 0.03);
                float glitter2 = snowNoise(sWPos.xz * 68.0 - cos(uTime * 0.3) * 0.03);
                float glitter = pow(glitter1 * glitter2 * specAngle, 4.5) * 1.6;
                vec3 sparkleColor = vec3(0.92, 0.96, 1.0) * (moonSheen * 0.22 + glitter * 0.28) * uSparkleIntensity;

                // 4. Harmonious Mixing with Existing Terrain Texture
                // Modulate the snow with the low-poly faceting of the original texture
                float texLum = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                vec3 facetedSnow = snowFinal * (texLum * 0.45 + 0.78);

                // Blend base terrain texture with our snow shader
                vec3 blendedDiffuse = mix(sampledDiffuseColor.rgb, facetedSnow, sSnowCoverage * 0.86);
                blendedDiffuse += sparkleColor * sSnowCoverage;

                diffuseColor.rgb = blendedDiffuse;
                `
              );

              // 5. Modify roughness to reflect powdery vs compacted icy drifts
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <roughnessmap_fragment>',
                `
                #include <roughnessmap_fragment>
                roughnessFactor = mix(roughnessFactor, mix(0.85, 0.48, sMacroDrift), sSnowCoverage * 0.85);
                `
              );

              // 6. Perturb geometric normal with procedural snow drift curvature for real 3D volume
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <normal_fragment_maps>',
                `
                #include <normal_fragment_maps>

                float eps = 0.06;
                float hC = snowFBM(sWPos.xz * 1.15) * 0.6 + sMacroDrift * 0.4;
                float hX = snowFBM((sWPos.xz + vec2(eps, 0.0)) * 1.15) * 0.6 + (sin((sDriftUv.x + eps * 0.18) * 1.5 + sin(sDriftUv.y * 1.0) * 0.8) * 0.5 + 0.5) * 0.4;
                float hZ = snowFBM((sWPos.xz + vec2(0.0, eps)) * 1.15) * 0.6 + (sin(sDriftUv.x * 1.5 + sin((sDriftUv.y + eps * 0.18) * 1.0) * 0.8) * 0.5 + 0.5) * 0.4;

                vec3 worldDriftN = normalize(vec3(-(hX - hC) / eps * 0.38, 1.0, -(hZ - hC) / eps * 0.38));
                vec3 viewDriftN = normalize((viewMatrix * vec4(worldDriftN, 0.0)).xyz);
                normal = normalize(mix(normal, viewDriftN, sSnowCoverage * 0.50));
                `
              );
            };

            mat.needsUpdate = true;
          }
        });
      }
    });

    // Frame camera on the cozy village across the frozen lake with atmospheric sky and moon in view
    camera.position.set(-6.2, 2.4, -2.0);
    camera.lookAt(0.5, 1.1, -4.5);
    controls.target.set(0.5, 1.1, -4.5);
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
  composer.setSize(width, height);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

  // Update procedural sky & aurora time
  if (skyShaderUniforms) {
    skyShaderUniforms.uTime.value = elapsedTime;
  }

  // Update procedural terrain snow shader time
  if (terrainSnowUniforms) {
    terrainSnowUniforms.uTime.value = elapsedTime;
  }

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

  // Render post-processed scene with bloom
  composer.render();
}

requestAnimationFrame(animate);
