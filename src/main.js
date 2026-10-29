import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SleighController } from './gameplay/SleighController.js';
import { DeliverySystem } from './gameplay/DeliverySystem.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { KawaseBloomPass } from './postprocessing/KawaseBloomPass.js';
import { PerformanceDebugger } from './debug/PerformanceDebugger.js';
import { MobileOptimizer } from './mobile/MobileOptimizer.js';
import { BatchedChunkSystem, USE_LEGACY } from './world/BatchedChunkSystem.js';

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
// Calculate adaptive FOV so portrait phone screens (9:19+) show the same panoramic sky width as 16:9 desktop
const isPortrait = window.innerHeight > window.innerWidth;
const initialFov = isPortrait ? 65 : 50;

const camera = new THREE.PerspectiveCamera(
  initialFov,
  window.innerWidth / window.innerHeight,
  0.2,
  3500
);
// Cinematic framed view across the snowy island toward the glowing village
camera.position.set(-6.5, 2.0, -1.5);

// --- Device Capability Detection ---
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                  (window.innerWidth <= 840) ||
                  ('ontouchstart' in window && window.innerWidth <= 1024);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setSize(window.innerWidth, window.innerHeight);
// High visual fidelity: 1.5x pixel ratio on mobile provides razor-sharp display on 1080p screens with smooth 60+ FPS
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
container.appendChild(renderer.domElement);

// --- Orbit Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI / 2 - 0.02; // Keep camera above ground
controls.minDistance = 2.0;
controls.maxDistance = 350;
controls.target.set(0, 3.5, -5.5);
controls.update();

// Expose on window for runtime devtools QA inspection
window.camera = camera;
window.controls = controls;

// --- Cinematic Post-Processing Pipeline (Bloom for Glowing Window Hearths) ---
// --- Full Cinematic Unreal Bloom Pipeline with Anti-Black-Square Protection ---
const composer = new EffectComposer(renderer);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomRes = new THREE.Vector2(window.innerWidth, window.innerHeight);
const bloomPass = new KawaseBloomPass(
  bloomRes,
  1.4,  // Rich, warm cinematic bloom intensity
  0.32, // Smooth threshold for glowing windows, aurora, and lanterns
  2.2   // Wide, soft blur scattering radius
);
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

window.game = { scene, camera, renderer, controls, composer, bloomPass };

// Performance Debugger Suite (activated with ?debug=1)
const perfDebugger = new PerformanceDebugger({
  renderer,
  scene,
  camera,
  composer,
  bloomPass,
  get sleighController() { return sleighController; },
  get deliverySystem() { return deliverySystem; },
  get chunkSystem() { return chunkSystem; },
  get snowParticles() { return snowParticles; },
  get largeSnowParticles() { return largeSnowParticles; },
  get moonLight() { return moonLight; },
  get auroraGroundLight() { return auroraGroundLight; },
  get villageFacadeLight() { return villageFacadeLight; },
  get starlightHemiLight() { return starlightHemiLight; },
  get ambientWarm() { return ambientWarm; },
  get skyGroup() { return skyGroup; }
});
window.perfDebugger = perfDebugger;

// Mobile Performance Optimizer (only active on mobile devices, desktop unchanged)
const mobileOptimizer = new MobileOptimizer({
  renderer,
  scene,
  camera,
  composer,
  get chunkSystem() { return chunkSystem; },
  get sleighController() { return sleighController; },
  get deliverySystem() { return deliverySystem; },
  get moonLight() { return moonLight; },
  get starlightHemiLight() { return starlightHemiLight; },
  get villageFacadeLight() { return villageFacadeLight; },
  get ambientWarm() { return ambientWarm; },
  get auroraGroundLight() { return auroraGroundLight; },
  get skyGroup() { return skyGroup; },
}, { isMobile: IS_MOBILE });
window.mobileOptimizer = mobileOptimizer;

// ============================================================================
// UNIFIED WORLD-SPACE SKY, PROCEDURAL MILKY WAY & 3D VOLUMETRIC AURORA SYSTEM
// ============================================================================
const skyGroup = new THREE.Group();
skyGroup.name = 'ProceduralWinterSkyGroup';
scene.add(skyGroup);

// Consistent world-space moon direction (soft winter moon in the ENE sky)
const WORLD_MOON_DIR = new THREE.Vector3(0.46, 0.36, -0.81).normalize();

const skyUniforms = {
  uTime: { value: 0 },
  uCameraPos: { value: new THREE.Vector3() },
  uMoonDir: { value: WORLD_MOON_DIR },
  uWeatherOvercast: { value: 0.0 }
};

function seededRandom(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function clampVal(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const WINTER_SKY_AND_AURORA_GLSL = `
  // Continuous gradient noise (Cubic Hermite interpolation, no texture lookups or tiling seams)
  vec2 gradHash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
  }

  float gradNoise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dot(gradHash22(i), f),
          dot(gradHash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
      mix(dot(gradHash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
          dot(gradHash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Seamless deep-navy (#040a18) to muted atmospheric cold-blue (#0e1b2f) winter night gradient
  // Continuous across the entire sphere (y in [-1, 1]) with zero horizon discontinuity
  vec3 evaluateWinterNightSky(vec3 rd, vec3 moonDir) {
    float y = rd.y;

    // Rich cinematic nocturnal palette:
    // Zenith deep navy: #040a18 (0.0012, 0.0035, 0.0125 in linear)
    // Upper midnight blue: #071224 (0.0032, 0.0085, 0.0260 in linear)
    // Mid cold navy: #0a1832 (0.0055, 0.0145, 0.0420 in linear)
    // Horizon atmospheric blue: #0e1b2f (0.0085, 0.0210, 0.0540 in linear)
    vec3 zenithNavy   = vec3(0.0012, 0.0035, 0.0125);
    vec3 upperNavy    = vec3(0.0032, 0.0085, 0.0260);
    vec3 midColdBlue  = vec3(0.0055, 0.0145, 0.0420);
    vec3 horizonHaze  = vec3(0.0085, 0.0210, 0.0540);
    vec3 nadirAbyss   = vec3(0.0020, 0.0050, 0.0140);

    float upperT = clamp(y, 0.0, 1.0);
    vec3 sky = mix(horizonHaze, midColdBlue, smoothstep(0.0, 0.28, upperT));
    sky = mix(sky, upperNavy, smoothstep(0.18, 0.62, upperT));
    sky = mix(sky, zenithNavy, smoothstep(0.48, 0.98, upperT));

    // Smooth transition below y = 0 so looking downward from high altitude has zero seam
    float lowerT = 1.0 - smoothstep(-0.45, 0.0, y);
    sky = mix(sky, nadirAbyss, lowerT);

    // Subtle atmospheric horizon blend - gentle linear-space haze without bright edge banding
    float horizonBelt = exp(-abs(y) * 4.2);
    sky += vec3(0.0025, 0.0065, 0.0160) * horizonBelt * 0.55;

    // Fast polynomial squaring replaces expensive transcendental pow/exp2 calls for mobile ALUs
    float mDot = max(0.0, dot(rd, moonDir));
    float m2 = mDot * mDot;
    float m4 = m2 * m2;
    float wideScatter = m4 * mDot; // mDot^5
    float m8 = m4 * m4;
    float m16 = m8 * m8;
    float m24 = m16 * m8;
    float innerGlow = m24 * m2; // mDot^26
    float m32 = m16 * m16;
    float m64 = m32 * m32;
    float tightCorona = m64 * m32 * m16 * m2 * mDot; // mDot^115

    sky += vec3(0.008, 0.018, 0.045) * wideScatter * 0.45;
    sky += vec3(0.035, 0.070, 0.140) * innerGlow * 0.35;
    sky += vec3(0.080, 0.130, 0.220) * tightCorona * 0.20;

    // Very faint high-altitude blue lift gives the zenith more depth without adding grain.
    float upperVeil = smoothstep(0.18, 0.92, y);
    sky += vec3(0.0010, 0.0030, 0.0090) * upperVeil;

    // Procedural Milky Way: a broad, curved galactic band with smooth cloud structure
    // and dark dust lanes. Built from continuous directional noise, not a texture or plane.
    // The band is deliberately subtle so it supports, rather than competes with, the aurora.
    vec2 galacticCoord = vec2(atan(rd.z, rd.x), rd.y * 2.15);
    float galacticLongitude = galacticCoord.x;
    float galacticCurve = 0.17 * sin(galacticLongitude * 1.15 - 0.55)
                        + 0.055 * sin(galacticLongitude * 2.25 + 0.8);
    float galacticLatitude = galacticCoord.y - galacticCurve;
    float broadBand = exp(-galacticLatitude * galacticLatitude * 10.5);
    float bandEdge = 1.0 - smoothstep(0.22, 0.62, abs(galacticLatitude));

    if (bandEdge > 0.002) {
      // Seam-safe low-frequency cloud coordinates. Do not feed atan(longitude) directly
      // into noise: atan jumps from +PI to -PI and creates a visible vertical seam.
      // Direction-based coordinates remain continuous across the sphere's longitude wrap.
      vec2 cloudCoord = vec2(rd.x, rd.z) * 7.0 + vec2(13.7, 4.2);
      float cloudA = gradNoise2D(cloudCoord);
      float cloudB = gradNoise2D(cloudCoord * 1.85 + vec2(7.1, 21.4));
      float galacticClouds = smoothstep(-0.30, 0.42, cloudA * 0.78 + cloudB * 0.22);

      // A smooth, wandering dark dust lane gives the band depth instead of a uniform stripe.
      float dustLaneCenter = galacticCurve + 0.035 * sin(galacticLongitude * 2.8 + 1.3);
      float dustDist = (galacticCoord.y - dustLaneCenter) * 17.0;
      float dustLane = exp(-dustDist * dustDist);
      // Reuse low-frequency cloud structure for dust variation, eliminating redundant 3rd noise lookup
      float dustVariation = smoothstep(-0.20, 0.35, cloudA);
      float dustMask = 1.0 - dustLane * (0.28 + 0.34 * dustVariation);

      // Suppress the galaxy close to the moon where glare would wash out faint stars.
      float moonGalaxyFade = 1.0 - 0.78 * smoothstep(0.965, 0.997, mDot);
      // Slightly dim the galactic band near the brightest aurora-facing upper horizon.
      float galacticIntensity = broadBand * bandEdge * (0.32 + 0.68 * galacticClouds)
                              * dustMask * moonGalaxyFade;
      vec3 milkyWayTint = vec3(0.045, 0.075, 0.125);
      sky += milkyWayTint * galacticIntensity * 0.32;
      // A restrained cool core provides depth without turning the Milky Way into a bright cloud.
      sky += vec3(0.015, 0.028, 0.055) * broadBand * galacticClouds * dustMask * moonGalaxyFade * 0.14;
    }

    return sky;
  }

  // Precomputed curtain parameters to eliminate redundant ALU & transcendental operations in the raymarching loop
  struct AuroraCurtainDef {
    float u0, du;
    float v0, dv;
    float h0, dh;
    float foldAmplitude;
    float foldFrequency;
    float tMacro;
    float tWave;
    float tRay;
    float seed;
    float maxV;           // precomputed lateral cutoff (foldAmplitude * 2.55 + 115.0)
    float stepV;          // precomputed per-ray step advance across lateral distance v
    vec2 tSpan;           // per-ray active interval [tStart, tEnd] where curtain is non-zero
    float isActive;       // 1.0 if ray intersects curtain volume, 0.0 if ray completely misses
  };

  // Evaluate a single 3D folded auroral curtain in unified world-space units (1 unit = 100m, or 1km = 10 units)
  // Evaluated directly along the 1D ray parameter t using precomputed linear coordinates
  // Returns vec3(volumetricDensity, normalizedAltitude, rayHighlightFactor)
  vec3 evaluateAuroraCurtain3D(float t, AuroraCurtainDef c) {
    float v = c.v0 + c.dv * t;
    if (abs(v) > c.maxV) {
      return vec3(0.0);
    }

    float hNorm = c.h0 + c.dh * t;
    if (hNorm <= 0.0 || hNorm >= 1.0) {
      return vec3(0.0);
    }

    float u = c.u0 + c.du * t;

    // Organic longitudinal wave harmonics replace heavy 1D-constant 2D noise lookups
    float warpLow = sin(u * 0.0018 + c.tMacro * 0.35 + c.seed * 2.3) * 0.72
                  + sin(u * 0.0039 - c.tMacro * 0.22 + c.seed * 4.1) * 0.28;
    float warpMed = sin(u * 0.0052 - c.tWave * 0.28 + c.seed * 5.7 + hNorm * 1.57) * 0.70
                  + sin(u * 0.0108 + c.tWave * 0.42 + c.seed * 2.1) * 0.30;

    // Broad sweeping arch + serpentine S-folds + Kelvin-Helmholtz hook curls
    float uWarped   = u + warpLow * 160.0;
    float largeArch = sin(uWarped * 0.0026 + c.tMacro + c.seed) * (c.foldAmplitude * 1.35);
    float sFold     = cos(uWarped * c.foldFrequency - c.tWave + c.seed * 1.9) * (c.foldAmplitude * 0.62);
    float hookCurl  = sin(u * c.foldFrequency * 2.15 + warpMed * 3.4 + c.tWave * 1.15) * (c.foldAmplitude * 0.38);

    // Upper rays gently lag behind the lower ionization edge in the upper-atmosphere wind
    float altitudeShear = sin(u * 0.0065 + hNorm * 1.75 - c.tWave * 0.9) * (c.foldAmplitude * 0.18 * hNorm);

    float sheetCenterV = largeArch + sFold + hookCurl + altitudeShear;

    // Fast bounding check before sampling thickness noise
    float distToSheet = abs(v - sheetCenterV);
    float baseHalfWidth = mix(11.0, 28.0, hNorm * sqrt(hNorm));
    float boundWidth = baseHalfWidth + c.stepV * 0.8;
    if (distToSheet > boundWidth * 3.172) {
      return vec3(0.0);
    }

    // Variable sheet thickness: crisp at the lower ~100km edge, softly diffusing upward,
    // modulated by smooth longitudinal harmonics without expensive grid noise
    float thicknessMod = 0.78 + 0.32 * sin(u * 0.0040 + c.tMacro + c.seed * 9.1);
    float halfWidth = baseHalfWidth * thicknessMod;

    // Analytic box-convolved Gaussian filter eliminates venetian-blind step rippling without high-frequency dither
    float effHalfWidth = sqrt(halfWidth * halfWidth + c.stepV * c.stepV * 1.15);
    float normDist = distToSheet / effHalfWidth;
    if (normDist > 2.6) {
      return vec3(0.0);
    }

    // Macro longitudinal mask creating natural dark sky gaps & transparent regions along the ribbon
    float longitudinalHarmonic = sin(u * 0.0019 + c.tMacro * 0.40 + c.seed * 3.1) * 0.70
                               + sin(u * 0.0038 - c.tMacro * 0.20 + c.seed * 1.7) * 0.30;
    float subGapHarmonic       = sin(u * 0.0058 - c.tWave * 0.20 + c.seed * 6.4);
    float curtainEnvelope      = smoothstep(-0.18, 0.34, longitudinalHarmonic + subGapHarmonic * 0.35);
    if (curtainEnvelope <= 0.005) {
      return vec3(0.0);
    }

    // Smooth Gaussian cross-section profile with energy conservation
    float sheetProfile = exp(-normDist * normDist * 1.35) * (halfWidth / effHalfWidth);

    // Curvilinear arc coordinate along the folded curtain so vertical filaments follow folds naturally
    float arcCoord = u + warpLow * 95.0 + sFold * 0.75 + hookCurl * 0.55;

    // Multi-frequency harmonic domain warp perturbs ray coordinates organically without extra 2D noise lookups
    float branchWarp = sin(arcCoord * 0.0095 + c.tRay * 0.16 + c.seed * 4.1 + hNorm * 1.8) * 0.68
                     + sin(arcCoord * 0.0210 - c.tRay * 0.24 + c.seed * 1.3) * 0.32;
    float rayCoord   = arcCoord * 0.016 + branchWarp * 0.72;

    float ray1 = gradNoise2D(vec2(rayCoord, hNorm * 0.24 - c.tRay * 0.07 + c.seed));

    // Vertical ray bundles with dark gaps between bundles
    float rayBundles = smoothstep(-0.65, 0.65, ray1);
    float filamentStructure = mix(0.91, 0.98, rayBundles);

    // Vertical ionization profile:
    // Soft bottom edge, Cauchy emission peak, and cubic asymptotic top fade to zero
    float bottomEdge = smoothstep(0.0, 0.08, hNorm);
    float hDiff = (hNorm - 0.12) * 14.2857; // 1.0 / 0.07
    float lowerPeak  = 1.0 + 0.55 / (1.0 + hDiff * hDiff * 0.85);
    float fadeBase   = clamp(1.0 - hNorm, 0.0, 1.0);
    // Cubic top fade completely eliminates any visible upper boundary cutoff
    float topFade    = fadeBase * fadeBase * fadeBase;
    float verticalProfile = bottomEdge * lowerPeak * topFade;

    // Linear continuous density integration preserves smooth volumetric accumulation without artificial threshold banding
    float density = sheetProfile * filamentStructure * curtainEnvelope * verticalProfile * 0.65;
    return vec3(density, hNorm, rayBundles);
  }

  // Fast precomputation helper initializing closed-form linear coordinates and analytic interval bounding
  AuroraCurtainDef initAuroraCurtain(
    vec3 roWorld, vec3 rd, vec2 dRay,
    vec2 cosSin, float lateralOffset,
    float baseHeight, float topHeight,
    float foldAmp, float foldFreq,
    float time, float timeScale, float seedVal,
    float tEntry, float tExit
  ) {
    AuroraCurtainDef c;
    c.foldAmplitude = foldAmp;
    c.foldFrequency = foldFreq;
    c.tMacro = time * (timeScale * 0.22);
    c.tWave  = time * (timeScale * 0.48);
    c.tRay   = time * (timeScale * 0.85);
    c.seed = seedVal;
    c.maxV = foldAmp * 2.55 + 115.0;

    float invHeight = 1.0 / (topHeight - baseHeight);
    c.h0 = (roWorld.y - baseHeight) * invHeight;
    c.dh = rd.y * invHeight;

    vec2 p0 = roWorld.xz + vec2(0.07, -0.15) * (roWorld.y - baseHeight);
    c.v0 = -cosSin.y * p0.x + cosSin.x * p0.y - lateralOffset;
    c.dv = -cosSin.y * dRay.x + cosSin.x * dRay.y;

    c.u0 = cosSin.x * p0.x + cosSin.y * p0.y;
    c.du = cosSin.x * dRay.x + cosSin.y * dRay.y;

    // Fast analytic 1D interval bounding
    float tHMin = 0.0;
    float tHMax = 1850.0;
    if (abs(c.dh) > 1e-6) {
      float tH1 = -c.h0 / c.dh;
      float tH2 = (1.0 - c.h0) / c.dh;
      tHMin = min(tH1, tH2);
      tHMax = max(tH1, tH2);
    } else if (c.h0 < 0.0 || c.h0 > 1.0) {
      c.isActive = 0.0;
      c.tSpan = vec2(1.0, 0.0);
      c.stepV = 1.0;
      return c;
    }

    float tVMin = -1e9;
    float tVMax =  1e9;
    if (abs(c.dv) > 1e-6) {
      float tV1 = (-c.maxV - c.v0) / c.dv;
      float tV2 = ( c.maxV - c.v0) / c.dv;
      tVMin = min(tV1, tV2);
      tVMax = max(tV1, tV2);
    } else if (abs(c.v0) > c.maxV) {
      c.isActive = 0.0;
      c.tSpan = vec2(1.0, 0.0);
      c.stepV = 1.0;
      return c;
    }

    float cMin = max(tEntry, max(tHMin, tVMin));
    float cMax = min(tExit,  min(tHMax, tVMax));

    c.tSpan = vec2(cMin, cMax);
    c.isActive = (cMax > cMin) ? 1.0 : 0.0;
    c.stepV = 1.0;
    return c;
  }

  // Bounded 3D volumetric ray march through the atmospheric aurora shell [baseAlt .. topAlt]
  // Works correctly whether the camera is below, inside, or above the aurora volume
  vec4 raymarch3DAurora(vec3 roWorld, vec3 rd, float time) {
    if (rd.y < -0.02) return vec4(0.0);

    const float minAlt = 200.0;
    const float maxAlt = 820.0;

    // Scaled planetary curvature in world units so the aurora curves gently around the distant horizon
    // Numerically expanded to eliminate large number cancellation on mobile 24-bit floats
    const float planetRadius = 18000.0;
    float b = dot(roWorld, rd) + planetRadius * rd.y;
    float roSq = dot(roWorld, roWorld);

    float discOuter = b * b - (roSq + 2.0 * planetRadius * (roWorld.y - maxAlt) - maxAlt * maxAlt);
    if (discOuter < 0.0) return vec4(0.0);

    float sOuter = sqrt(discOuter);
    vec2 hitOuter = vec2(-b - sOuter, -b + sOuter);
    if (hitOuter.y <= 0.0) return vec4(0.0);

    float discInner = b * b - (roSq + 2.0 * planetRadius * (roWorld.y - minAlt) - minAlt * minAlt);
    vec2 hitInner = vec2(-1.0);
    if (discInner >= 0.0) {
      float sInner = sqrt(discInner);
      hitInner = vec2(-b - sInner, -b + sInner);
    }

    // General interval intersection for a spherical shell (handles camera below, inside, or above)
    float tEntry = 0.0;
    float tExit  = 0.0;

    if (hitInner.x > 0.0) {
      // Camera is above or looking downward across the inner shell
      tEntry = max(0.0, hitOuter.x);
      tExit  = hitInner.x;
    } else if (hitInner.y > 0.0) {
      // Standard case: camera is on/near the ground inside the inner shell looking up
      tEntry = hitInner.y;
      tExit  = hitOuter.y;
    } else {
      // Grazing ray between the inner and outer shells
      tEntry = max(0.0, hitOuter.x);
      tExit  = hitOuter.y;
    }

    // Tighten bounds with exact planar altitude slab [minAlt, maxAlt] where curtains are defined
    // This eliminates hundreds of units of empty raymarch before entering or after exiting the curtains
    if (abs(rd.y) > 0.0005) {
      float tAlt1 = (minAlt - roWorld.y) / rd.y;
      float tAlt2 = (maxAlt - roWorld.y) / rd.y;
      float tAltMin = min(tAlt1, tAlt2);
      float tAltMax = max(tAlt1, tAlt2);
      tEntry = max(tEntry, max(0.0, tAltMin));
      tExit  = min(tExit, tAltMax);
    } else if (roWorld.y < minAlt || roWorld.y > maxAlt) {
      // Ray is horizontal and entirely outside the vertical curtain slab
      return vec4(0.0);
    }

    // Clamp maximum march distance to 1850 units (curtains beyond this distance are fully atmospheric-veiled)
    tExit = min(tExit, 1850.0);
    if (tExit <= tEntry) return vec4(0.0);

    // Precompute curtain definitions outside the raymarch loop to eliminate per-step trigonometric calls
    vec2 dRay = rd.xz + vec2(0.07, -0.15) * rd.y;

    AuroraCurtainDef cDef1 = initAuroraCurtain(
      roWorld, rd, dRay,
      vec2(0.942751, 0.333487), -260.0,
      215.0, 720.0, 145.0, 0.0048,
      time, 1.0, 1.7, tEntry, tExit
    );

    AuroraCurtainDef cDef2 = initAuroraCurtain(
      roWorld, rd, dRay,
      vec2(0.975897, -0.218230), 140.0,
      245.0, 780.0, 92.0, 0.0062,
      time, -0.82, 7.4, tEntry, tExit
    );

    AuroraCurtainDef cDef3 = initAuroraCurtain(
      roWorld, rd, dRay,
      vec2(0.836464, 0.548037), 440.0,
      230.0, 700.0, 130.0, 0.0041,
      time, 0.68, 15.2, tEntry, tExit
    );

    AuroraCurtainDef cDef4 = initAuroraCurtain(
      roWorld, rd, dRay,
      vec2(0.408494, 0.912764), -420.0,
      260.0, 760.0, 98.0, 0.0054,
      time, -0.74, 23.9, tEntry, tExit
    );

    float rayMin = 1e9;
    float rayMax = -1e9;
    if (cDef1.isActive > 0.5) { rayMin = min(rayMin, cDef1.tSpan.x); rayMax = max(rayMax, cDef1.tSpan.y); }
    if (cDef2.isActive > 0.5) { rayMin = min(rayMin, cDef2.tSpan.x); rayMax = max(rayMax, cDef2.tSpan.y); }
    if (cDef3.isActive > 0.5) { rayMin = min(rayMin, cDef3.tSpan.x); rayMax = max(rayMax, cDef3.tSpan.y); }
    if (cDef4.isActive > 0.5) { rayMin = min(rayMin, cDef4.tSpan.x); rayMax = max(rayMax, cDef4.tSpan.y); }

    // Instant step-0 rejection for rays that miss all 4 aurora ribbons
    if (rayMax <= rayMin) return vec4(0.0);

    tEntry = rayMin;
    tExit  = rayMax;

    // Universal 32-step raymarching delivers desktop-grade volumetric curtains and silky smooth performance
    const int STEPS = 32;
    float marchLength = tExit - tEntry;
    float stepSize = marchLength / float(STEPS);

    // Smooth centered sampling: zero screen-space dither eliminates all checkerboard and stippling artifacts
    float jitter = 0.5;

    vec3 accumLight = vec3(0.0);
    float transmittance = 1.0;

    // Restrained, atmospheric winter game palette:
    // Soft emerald-green lower edge -> luminous cyan-turquoise core -> muted teal-blue upper rays
    vec3 lowerEmerald  = vec3(0.10, 0.92, 0.55);
    vec3 coreTurquoise = vec3(0.10, 0.84, 0.78);
    vec3 upperCyanBlue = vec3(0.08, 0.48, 0.68);
    vec3 faintTealTop  = vec3(0.06, 0.27, 0.48);

    // Precompute step advance across lateral distance v for each active curtain
    // Calibrated to the exact maximum fold derivative of each curtain's harmonic components
    cDef1.stepV = length(vec2(abs(cDef1.dv), abs(cDef1.du) * 1.55 + abs(rd.y) * 0.25)) * stepSize;
    cDef2.stepV = length(vec2(abs(cDef2.dv), abs(cDef2.du) * 1.25 + abs(rd.y) * 0.25)) * stepSize;
    cDef3.stepV = length(vec2(abs(cDef3.dv), abs(cDef3.du) * 1.35 + abs(rd.y) * 0.25)) * stepSize;
    cDef4.stepV = length(vec2(abs(cDef4.dv), abs(cDef4.du) * 1.20 + abs(rd.y) * 0.25)) * stepSize;

    for (int i = 0; i < STEPS; i++) {
      if (transmittance < 0.02) break;

      float t = tEntry + (float(i) + jitter) * stepSize;

      // Curtain 1: Sweeping primary northern ribbon with prominent S-folds
      vec3 c1 = (cDef1.isActive > 0.5 && t >= cDef1.tSpan.x && t <= cDef1.tSpan.y)
              ? evaluateAuroraCurtain3D(t, cDef1) : vec3(0.0);

      // Curtain 2: High-altitude intersecting turquoise curtain with finer ripples
      vec3 c2 = (cDef2.isActive > 0.5 && t >= cDef2.tSpan.x && t <= cDef2.tSpan.y)
              ? evaluateAuroraCurtain3D(t, cDef2) : vec3(0.0);

      // Curtain 3: Distant outer arc leaving broad dark star-filled sky gaps
      vec3 c3 = (cDef3.isActive > 0.5 && t >= cDef3.tSpan.x && t <= cDef3.tSpan.y)
              ? evaluateAuroraCurtain3D(t, cDef3) : vec3(0.0);

      // Curtain 4: Subtle western counter-ribbon for 360-degree depth & parallax
      vec3 c4 = (cDef4.isActive > 0.5 && t >= cDef4.tSpan.x && t <= cDef4.tSpan.y)
              ? evaluateAuroraCurtain3D(t, cDef4) : vec3(0.0);

      float totalDensity = c1.x * 1.12 + c2.x * 0.72 + c3.x * 0.58 + c4.x * 0.42;

      if (totalDensity > 0.001) {
        float weightSum = c1.x + c2.x + c3.x + c4.x + 1e-5;
        float avgH   = (c1.x * c1.y + c2.x * c2.y + c3.x * c3.y + c4.x * c4.y) / weightSum;
        float avgRay = (c1.x * c1.z + c2.x * c2.z + c3.x * c3.z + c4.x * c4.z) / weightSum;

        // Smooth vertical transition: emerald base -> turquoise ribbon -> muted blue-teal crown
        vec3 sampleColor = mix(lowerEmerald, coreTurquoise, smoothstep(0.05, 0.36, avgH));
        sampleColor = mix(sampleColor, upperCyanBlue, smoothstep(0.32, 0.72, avgH));
        sampleColor = mix(sampleColor, faintTealTop, smoothstep(0.68, 0.98, avgH));

        // Subtle cyan-turquoise highlight along crisp vertical ray bundles
        sampleColor = mix(sampleColor, vec3(0.20, 1.00, 0.88), avgRay * (1.0 - avgH * 0.55) * 0.12);

        // Physical Beer-Lambert optical depth integration
        // Grazing rays passing edge-on along a fold naturally accumulate higher optical depth
        // Evaluated via 2nd-order Taylor expansion to eliminate transcendental exp() per step
        float sigmaT = totalDensity * stepSize * 0.0058;
        float stepAlpha = clamp(sigmaT * (1.0 - 0.5 * sigmaT), 0.0, 1.0);
        float stepTransmittance = 1.0 - stepAlpha;

        // Gentle self-luminance boost where folds overlap in 3D space
        float overlapBoost = 1.0 + smoothstep(0.12, 0.72, totalDensity) * 0.28;
        vec3 stepScattering = sampleColor * overlapBoost;

        accumLight += transmittance * stepAlpha * stepScattering;
        transmittance *= stepTransmittance;
      }
    }

    // Smooth atmospheric extinction near the horizon so curtains never clip abruptly
    // and blend naturally into the distant cold-blue horizon haze
    float horizonAtmosphericFade = smoothstep(-0.02, 0.12, rd.y);
    accumLight *= horizonAtmosphericFade;
    float finalAlpha = (1.0 - transmittance) * horizonAtmosphericFade;

    // Rich cinematic luminance tone curve: vibrant emerald & electric turquoise highlights
    accumLight *= 1.45;
    accumLight = accumLight / (1.0 + accumLight * 0.35);

    return vec4(accumLight, finalAlpha);
  }
`;

const skyDomeMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: skyUniforms.uTime,
    uCameraPos: skyUniforms.uCameraPos,
    uMoonDir: skyUniforms.uMoonDir,
    uWeatherOvercast: skyUniforms.uWeatherOvercast
  },
  vertexShader: `
    varying vec3 vRayDir;
    void main() {
      // Local vertex position on the centered sky sphere gives the exact world-space ray direction
      vRayDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform vec3 uCameraPos;
    uniform vec3 uMoonDir;
    uniform float uWeatherOvercast;
    varying vec3 vRayDir;

    ${WINTER_SKY_AND_AURORA_GLSL}

    void main() {
      vec3 rd = normalize(vRayDir);
      vec3 baseSky = evaluateWinterNightSky(rd, uMoonDir);
      vec4 aurora  = raymarch3DAurora(uCameraPos, rd, uTime);

      // Atmospheric overcast dimming & diffusion during snowstorms / blizzards
      vec3 overcastHaze = vec3(0.045, 0.065, 0.115);
      baseSky = mix(baseSky, overcastHaze, uWeatherOvercast * 0.75);
      float auroraSuppression = 1.0 - uWeatherOvercast * 0.85;

      // Subtle atmospheric scattering halo around the aurora curtains
      vec3 composite = baseSky * (1.0 - aurora.a * 0.32 * auroraSuppression) + (aurora.rgb * 1.35) * auroraSuppression;
      gl_FragColor = vec4(composite, 1.0);
    }
  `,
  side: THREE.BackSide,
  depthWrite: false,
  toneMapped: true,
  fog: false
});

const SKY_RADIUS = 1800;
const skyDomeMesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 32), skyDomeMat);
skyDomeMesh.renderOrder = -20;
skyGroup.add(skyDomeMesh);

const STAR_COUNT = 700;
const starGeo = new THREE.BufferGeometry();
const starPositions = new Float32Array(STAR_COUNT * 3);
const starColors = new Float32Array(STAR_COUNT * 3);
const starPhases = new Float32Array(STAR_COUNT);
const starSizes = new Float32Array(STAR_COUNT);

// Minimum Poisson-like angular separation and moon-exclusion zone for natural star placement
const STAR_RADIUS = 1720.0;
for (let i = 0; i < STAR_COUNT; i++) {
  const s1 = seededRandom(i * 3.71 + 1.1);
  const s2 = seededRandom(i * 7.13 + 2.3);
  const s3 = seededRandom(i * 13.37 + 3.7);
  const s4 = seededRandom(i * 19.91 + 5.1);

  const theta = s1 * Math.PI * 2.0;
  // Distribute across upper hemisphere down to just below the horizon
  const u = Math.pow(s2, 0.85) * 0.96 + 0.02;
  const phi = Math.acos(u);

  const dx = Math.sin(phi) * Math.cos(theta);
  const dy = Math.cos(phi);
  const dz = Math.sin(phi) * Math.sin(theta);

  starPositions[i * 3 + 0] = dx * STAR_RADIUS;
  starPositions[i * 3 + 1] = dy * STAR_RADIUS;
  starPositions[i * 3 + 2] = dz * STAR_RADIUS;

  // Dim stars near the moon's glare so the moon feels naturally luminous
  const dotMoon = dx * WORLD_MOON_DIR.x + dy * WORLD_MOON_DIR.y + dz * WORLD_MOON_DIR.z;
  const moonMask = clampVal((1.0 - dotMoon) * 4.5, 0.15, 1.0);

  // Power-law magnitude distribution: mostly faint pinpoint stars, only a few brighter stars
  const brightness = (0.36 + 0.78 * Math.pow(s3, 2.25)) * moonMask;

  // Subtle cold blue-white and soft ivory star tints
  if (s4 < 0.55) {
    starColors[i * 3 + 0] = 0.76 * brightness;
    starColors[i * 3 + 1] = 0.88 * brightness;
    starColors[i * 3 + 2] = 1.05 * brightness;
  } else if (s4 < 0.85) {
    starColors[i * 3 + 0] = 0.92 * brightness;
    starColors[i * 3 + 1] = 0.95 * brightness;
    starColors[i * 3 + 2] = 1.00 * brightness;
  } else {
    starColors[i * 3 + 0] = 0.66 * brightness;
    starColors[i * 3 + 1] = 0.84 * brightness;
    starColors[i * 3 + 2] = 1.08 * brightness;
  }

  starPhases[i] = s4 * 62.8318;
  starSizes[i] = (1.15 + Math.pow(s3, 3.0) * 2.25) * Math.min(window.devicePixelRatio || 1, 1.75);
}

starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));
starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));

const starFieldMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: skyUniforms.uTime,
    uWeatherOvercast: skyUniforms.uWeatherOvercast
  },
  vertexShader: `
    attribute float aPhase;
    attribute float aSize;
    varying vec3 vColor;
    varying float vTwinkle;
    varying float vHorizonFade;
    uniform float uTime;
    void main() {
      vColor = color;
      float rate = 0.65 + mod(aPhase, 1.35);
      vTwinkle = 0.76 + 0.24 * sin(uTime * rate + aPhase);
      vec3 dir = normalize(position);
      // Smoothly fade stars into the denser atmospheric haze near the horizon
      vHorizonFade = smoothstep(0.03, 0.22, dir.y);
      gl_PointSize = aSize * (0.94 + 0.14 * vTwinkle);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vTwinkle;
    varying float vHorizonFade;
    uniform float uWeatherOvercast;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
      if (d > 1.0) discard;
      float core = exp(-d * d * 4.2) * (1.0 - smoothstep(0.1, 1.0, d));
      float stormFade = 1.0 - uWeatherOvercast * 0.90;
      gl_FragColor = vec4(vColor * vTwinkle * 1.18, core * vHorizonFade * stormFade * 0.96);
    }
  `,
  vertexColors: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  fog: false
});

const starPoints = new THREE.Points(starGeo, starFieldMat);
starPoints.renderOrder = -18;
skyGroup.add(starPoints);

const MOON_DISTANCE = 1620.0;
const moonGroup = new THREE.Group();
moonGroup.position.copy(WORLD_MOON_DIR).multiplyScalar(MOON_DISTANCE);
moonGroup.lookAt(0, 0, 0);
skyGroup.add(moonGroup);

const moonSphereMat = new THREE.ShaderMaterial({
  vertexShader: `
    varying vec3 vLocalDir;
    varying vec3 vViewNormal;
    void main() {
      vLocalDir = normalize(position);
      vViewNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vLocalDir;
    varying vec3 vViewNormal;

    float moonHash(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    float moonNoise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(moonHash(i + vec3(0,0,0)), moonHash(i + vec3(1,0,0)), f.x),
            mix(moonHash(i + vec3(0,1,0)), moonHash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(moonHash(i + vec3(0,0,1)), moonHash(i + vec3(1,0,1)), f.x),
            mix(moonHash(i + vec3(0,1,1)), moonHash(i + vec3(1,1,1)), f.x), f.y),
        f.z
      );
    }

    void main() {
      vec3 p = vLocalDir * 2.4;
      float n1 = moonNoise(p + vec3(1.2, 0.7, 0.4));
      float n2 = moonNoise(p * 1.65 - vec3(0.6, 1.4, 0.9));
      float maria = smoothstep(0.32, 0.72, n1 * 0.78 + n2 * 0.22);

      // Soft stylized lunar basins
      float basin1 = 1.0 - smoothstep(0.15, 0.38, length(vLocalDir.xy - vec2(-0.26, 0.18)));
      float basin2 = 1.0 - smoothstep(0.12, 0.30, length(vLocalDir.xy - vec2(0.30, -0.14)));
      float detail = clamp(maria * 0.65 + (basin1 + basin2) * 0.35, 0.0, 1.0);

      // Soft warm-white highlands & cool slate-blue maria
      vec3 highlandWhite = vec3(0.72, 0.79, 0.91);
      vec3 mariaSlate    = vec3(0.43, 0.54, 0.71);
      vec3 surfaceCol    = mix(highlandWhite, mariaSlate, detail * 0.56);
      // Gentle terminator-style shading gives the disc depth without a bright artificial rim.
      float faceLight = 0.84 + 0.16 * clamp(vLocalDir.z * 0.5 + 0.5, 0.0, 1.0);
      surfaceCol *= faceLight;

      // Soft spherical limb darkening & atmospheric edge blend
      float mu = clamp(abs(vViewNormal.z), 0.0, 1.0);
      // Subtle limb shading only; avoid the bright double-ring caused by a tinted transparent edge.
      float limbShade = smoothstep(0.0, 0.18, mu);
      surfaceCol *= mix(0.82, 1.0, limbShade);
      gl_FragColor = vec4(surfaceCol, 1.0);
    }
  `,
  transparent: true,
  depthWrite: false,
  fog: false
});

const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(56.0, 40, 40), moonSphereMat);
moonMesh.name = 'Procedural3DMoonSphere';
moonMesh.renderOrder = -15;
moonGroup.add(moonMesh);

// --- Native Three.js Distance Fog & Procedural Winter Mist System ---
// Global fog uniform injection for time-based procedural ground mist
const fogTimeUniform = { value: 0 };
if (THREE.UniformsLib.fog) {
  THREE.UniformsLib.fog.uFogTime = fogTimeUniform;
}

// 1. Native Three.js Distance Fog as the base effect
// Scaled for miniature flight perspective:
// - Near: 3.5m -> Immediate foreground (Santa, sleigh, immediate trees & chimneys) stays 100% crisp and readable
// - Far: 22.0m -> Smooth atmospheric perspective where distant mountains and pine forests seamlessly dissolve into horizon
// - Color: 0x0e1b2f -> Exactly matches the sky shader's horizon haze color (#0e1b2f)
const fogColorHex = 0x0e1b2f;
scene.fog = new THREE.Fog(fogColorHex, 3.5, 22.0);

// 2. Pass true 3D world coordinates from vertex shader to fragment shader (supports InstancedMesh)
THREE.ShaderChunk.fog_pars_vertex = `
  #ifdef USE_FOG
    varying float vFogDepth;
    varying vec3 vFogWorldPos;
  #endif
`;

THREE.ShaderChunk.fog_vertex = `
  #ifdef USE_FOG
    vFogDepth = - mvPosition.z;
    #ifdef USE_INSTANCING
      vFogWorldPos = (modelMatrix * (instanceMatrix * vec4(transformed, 1.0))).xyz;
    #elif defined(USE_SPRITE)
      vFogWorldPos = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #else
      vFogWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    #endif
  #endif
`;

// 3. Fragment shader declarations with native uniforms & procedural simplex noise
THREE.ShaderChunk.fog_pars_fragment = `
  #ifdef USE_FOG
    uniform vec3 fogColor;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #else
      uniform float fogNear;
      uniform float fogFar;
    #endif
    uniform float uFogTime;
    varying float vFogDepth;
    varying vec3 vFogWorldPos;

    vec3 permuteFog(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    float snoiseFog(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                         -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v -   i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permuteFog(permuteFog(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
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
  #endif
`;

// 4. Combined Atmospheric Distance Fog & Procedural Terrain-Conforming Ground Mist
THREE.ShaderChunk.fog_fragment = `
  #ifdef USE_FOG
    vec3 fCamPos = cameraPosition;
    vec3 fWorldPos = vFogWorldPos;
    float fDist = length(fWorldPos - fCamPos);

    // =========================================================================
    // 1. VISIBLE DISTANCE FOG (Smooth natural cubic-smoothstep atmospheric extinction)
    // =========================================================================
    float dNorm = clamp((fDist - fogNear) / max(fogFar - fogNear, 0.001), 0.0, 1.0);
    float fDistFog = smoothstep(0.0, 1.0, dNorm);
    fDistFog = pow(fDistFog, 0.85); // Gentle atmospheric veil lifting distant mountains into the night sky

    // =========================================================================
    // 2. PROCEDURAL GROUND MIST & VALLEY HAZE
    // =========================================================================
    // Low-lying winter valley haze clinging to hollows and terrain depressions (up to y=1.2)
    float hMistFalloff = smoothstep(1.20, 0.10, fWorldPos.y);

    // Subtle drifting atmospheric mist noise
    vec2 mistUv = fWorldPos.xz * 0.12;
    float t = uFogTime * 0.024;
    #if 0
    float patchDensity = smoothstep(-0.45, 0.40, sin(mistUv.x * 2.1 + t * 0.3) * cos(mistUv.y * 2.1 + t * 0.2));
    #else
    float n1 = snoiseFog(mistUv + vec2(t * 0.35, t * 0.15));
    float n2 = snoiseFog(mistUv * 2.2 - vec2(t * 0.25, t * 0.38));
    float patchNoise = n1 * 0.60 + n2 * 0.40;
    float patchDensity = smoothstep(-0.35, 0.50, patchNoise);
    #endif

    // Haze develops beyond immediate flight clearance (fDist > 2.0)
    float fgClear = smoothstep(2.0, 6.0, fDist);
    float groundMistDensity = hMistFalloff * (patchDensity * 0.40 + 0.60) * fgClear * 0.35;

    // Atmospheric night sky horizon color blend
    vec3 cMistColor = fogColor;

    // Final Compositing: seamless atmospheric depth
    float fTotalFog = clamp(fDistFog + groundMistDensity * (1.0 - fDistFog), 0.0, 1.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, cMistColor, fTotalFog);
  #endif
`;

// 1. Sky & Shadow Fill: Lifted blue-violet sky light with deep nocturnal ground bounce for readable terrain facets
const starlightHemiLight = new THREE.HemisphereLight(0x22365a, 0x08101c, 0.46);
scene.add(starlightHemiLight);

// 2. Moonlight Key: Subtle cool moonlit silver-blue beam casting crisp night shadows
const moonLight = new THREE.DirectionalLight(0x7ea4e8, 0.95);
moonLight.position.set(28, 48, -22);
moonLight.castShadow = true;
// 2048 shadow map saves massive fillrate and depth bandwidth (75% less texels than 4096)
const shadowMapDim = 2048;
moonLight.shadow.mapSize.width = shadowMapDim;
moonLight.shadow.mapSize.height = shadowMapDim;
moonLight.shadow.camera.near = 12;
moonLight.shadow.camera.far = 120;
const d = 28;
moonLight.shadow.camera.left = -d;
moonLight.shadow.camera.right = d;
moonLight.shadow.camera.top = d;
moonLight.shadow.camera.bottom = -d;
moonLight.shadow.normalBias = 0.02;
moonLight.shadow.bias = -0.00015;
moonLight.shadow.radius = 1.6;
scene.add(moonLight);
scene.add(moonLight.target);

// --- Runtime shadow rig -----------------------------------------------------
// The moonlight direction is CONSTANT (fixed offset from its aim point), so the shadow
// angle never changes while the rig slides across the snow. The aim point is pinned to
// the GROUND under Santa (not to the airborne sleigh), which lets us keep the shadow
// frustum tight and therefore keep the texel density high enough for tree/house
// shadows to actually read on the snow instead of being averaged away.
const MOON_OFFSET = new THREE.Vector3(24, 42, -18); // constant light offset => constant light direction
const shadowFocus = new THREE.Vector3(0, 0, 0); // ground-projected anchor of the shadow frustum
const MOON_DIR = new THREE.Vector3(-24, -42, 18).normalize(); // unit vector pointing from the moon into the scene

// 3. Front Key Fill: Soft warm frontal illumination that brings out the vibrant red timber walls
const villageFacadeLight = new THREE.DirectionalLight(0xffeedd, 0.35);
villageFacadeLight.position.set(-18, 14, 12);
villageFacadeLight.target.position.set(-2.8, 0.5, -4.0);
scene.add(villageFacadeLight);
scene.add(villageFacadeLight.target);

// 4. Subtle twilight ambient fill to ensure crevices and recesses preserve clarity without flattening shadows
const ambientWarm = new THREE.AmbientLight(0x0e1828, 0.14);
scene.add(ambientWarm);

// 5. Aurora Sky-to-Ground Key Fill: Soft, breathing emerald-cyan ambient glow coming from northern sky
const auroraGroundLight = new THREE.DirectionalLight(0x2ec99a, 0.16);
auroraGroundLight.position.set(-15, 45, 35); // Above and to the north
auroraGroundLight.castShadow = false; // Soft environmental bounce
scene.add(auroraGroundLight);

// --- Cinematic Procedural Snowfall Particle System (Dendritic Crystals & Soft Bokeh) ---
const snowVertexShader = `
  uniform float uSize;
  uniform vec3 uWindVelocity;
  attribute float aSize;
  attribute float aRotSpeed;
  attribute float aFlakeType;
  attribute float aPhase;
  varying float vFlakeType;
  varying float vPhase;
  varying float vDepthFade;
  varying vec2 vRot;

  void main() {
    vFlakeType = aFlakeType;
    vPhase = aPhase;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float depth = max(-mvPosition.z, 0.4);

    // Natural physical size attenuation with smooth clamp
    // Calibrated for crisp, delicate winter snowfall without oversized giant blobs
    float baseScale = (260.0 / depth) * uSize * aSize;
    gl_PointSize = clamp(baseScale, 1.5, 22.0);

    // Near plane camera fade to eliminate harsh near-clip popping
    vDepthFade = smoothstep(0.3, 1.8, depth);

    // Precompute rotation 2D sin/cos
    float angle = aPhase + position.y * aRotSpeed;
    vRot = vec2(cos(angle), sin(angle));

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const snowFragmentShader = `
  uniform float uOpacity;
  uniform float uOvercast;
  varying float vFlakeType;
  varying float vPhase;
  varying float vDepthFade;
  varying vec2 vRot;

  void main() {
    // Centered coordinates [-1, 1]
    vec2 uv = (gl_PointCoord - vec2(0.5)) * 2.0;
    float r2 = dot(uv, uv);
    if (r2 > 1.0) discard;

    // Fast, lightweight soft circular snow flake (no expensive trigonometric dendritic branching)
    float alpha = clamp(1.0 - r2, 0.0, 1.0);
    alpha = alpha * alpha; // Smooth natural falloff

    // Coloration: Crisp winter matte snow (held under bloom threshold 0.30 so snowfall never glows)
    vec3 flakeColor = vec3(0.24, 0.26, 0.28);

    float finalAlpha = alpha * uOpacity * vDepthFade;
    if (finalAlpha < 0.005) discard;

    gl_FragColor = vec4(flakeColor, finalAlpha);
  }
`;

const snowBounds = { x: 50, y: 22, z: 50 };

// Layer 1: Ambient village snowfall (optimized count for silky 60-120+ FPS on mobile, high density on desktop)
const snowCount = 3600;
const snowGeo = new THREE.BufferGeometry();
const snowPositions = new Float32Array(snowCount * 3);
const snowSizes = new Float32Array(snowCount);
const snowRotSpeeds = new Float32Array(snowCount);
const snowFlakeTypes = new Float32Array(snowCount);
const snowPhases = new Float32Array(snowCount);
const snowVelocities = [];

for (let i = 0; i < snowCount; i++) {
  snowPositions[i * 3]     = (Math.random() - 0.5) * snowBounds.x;
  snowPositions[i * 3 + 1] = Math.random() * snowBounds.y;
  snowPositions[i * 3 + 2] = (Math.random() - 0.5) * snowBounds.z;

  snowSizes[i] = 0.85 + Math.random() * 0.95;
  snowRotSpeeds[i] = (Math.random() - 0.5) * 2.8;
  snowFlakeTypes[i] = Math.random();
  snowPhases[i] = Math.random() * Math.PI * 2;

  snowVelocities.push({
    fallSpeed: 0.016 + Math.random() * 0.024,
    swaySpeed: 0.7 + Math.random() * 1.3,
    swayAmp: 0.014 + Math.random() * 0.022,
    windDrift: 0.006 + Math.random() * 0.010,
    offset: Math.random() * Math.PI * 2
  });
}

snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
snowGeo.setAttribute('aSize', new THREE.BufferAttribute(snowSizes, 1));
snowGeo.setAttribute('aRotSpeed', new THREE.BufferAttribute(snowRotSpeeds, 1));
snowGeo.setAttribute('aFlakeType', new THREE.BufferAttribute(snowFlakeTypes, 1));
snowGeo.setAttribute('aPhase', new THREE.BufferAttribute(snowPhases, 1));

const snowMat = new THREE.ShaderMaterial({
  vertexShader: snowVertexShader,
  fragmentShader: snowFragmentShader,
  uniforms: {
    uSize: { value: 0.12 },
    uOpacity: { value: 0.85 },
    uOvercast: { value: 0.0 }
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending
});
const snowParticles = new THREE.Points(snowGeo, snowMat);
snowParticles.visible = true;
scene.add(snowParticles);

// Layer 2: Near-camera fluffy flakes & Bokeh Orbs
const largeSnowCount = 420;
const largeSnowGeo = new THREE.BufferGeometry();
const largeSnowPositions = new Float32Array(largeSnowCount * 3);
const largeSnowSizes = new Float32Array(largeSnowCount);
const largeSnowRotSpeeds = new Float32Array(largeSnowCount);
const largeSnowFlakeTypes = new Float32Array(largeSnowCount);
const largeSnowPhases = new Float32Array(largeSnowCount);
const largeSnowVelocities = [];

for (let i = 0; i < largeSnowCount; i++) {
  largeSnowPositions[i * 3]     = (Math.random() - 0.5) * snowBounds.x;
  largeSnowPositions[i * 3 + 1] = Math.random() * snowBounds.y;
  largeSnowPositions[i * 3 + 2] = (Math.random() - 0.5) * snowBounds.z;

  largeSnowSizes[i] = 0.9 + Math.random() * 0.9;
  largeSnowRotSpeeds[i] = (Math.random() - 0.5) * 2.2;
  largeSnowFlakeTypes[i] = Math.random();
  largeSnowPhases[i] = Math.random() * Math.PI * 2;

  largeSnowVelocities.push({
    fallSpeed: 0.014 + Math.random() * 0.022,
    swaySpeed: 0.5 + Math.random() * 0.9,
    swayAmp: 0.022 + Math.random() * 0.035,
    windDrift: 0.008 + Math.random() * 0.012,
    offset: Math.random() * Math.PI * 2
  });
}

largeSnowGeo.setAttribute('position', new THREE.BufferAttribute(largeSnowPositions, 3));
largeSnowGeo.setAttribute('aSize', new THREE.BufferAttribute(largeSnowSizes, 1));
largeSnowGeo.setAttribute('aRotSpeed', new THREE.BufferAttribute(largeSnowRotSpeeds, 1));
largeSnowGeo.setAttribute('aFlakeType', new THREE.BufferAttribute(largeSnowFlakeTypes, 1));
largeSnowGeo.setAttribute('aPhase', new THREE.BufferAttribute(largeSnowPhases, 1));

const largeSnowMat = new THREE.ShaderMaterial({
  vertexShader: snowVertexShader,
  fragmentShader: snowFragmentShader,
  uniforms: {
    uSize: { value: 0.18 },
    uOpacity: { value: 0.85 },
    uOvercast: { value: 0.0 }
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending
});
const largeSnowParticles = new THREE.Points(largeSnowGeo, largeSnowMat);
largeSnowParticles.visible = true;
scene.add(largeSnowParticles);

// =============================================================================
// DYNAMIC PROCEDURAL WEATHER ENGINE (Seamless 4-Phase Meteorological Cycle)
// =============================================================================
class DynamicWeatherEngine {
  constructor(options = {}) {
    // Phase durations in seconds:
    // 0: Clear & Aurora (~45s) -> 1: Gentle Flurries (~35s) -> 2: Heavy Blizzard (~30s) -> 3: Calming/Clearing (~22s)
    this.phaseDurations = [45, 35, 30, 22];
    this.totalCycleDuration = this.phaseDurations.reduce((a, b) => a + b, 0); // 132s (~2.2 mins)

    // Current interpolated dynamic metrics (all smoothed with dampening)
    this.currentPhase = 0;
    this.weatherIntensity = 0.0; // 0.0 (Clear) to 1.0 (Blizzard)
    this.windVelocity = new THREE.Vector3(0.008, 0, 0.004);
    this.windGust = 0.0;
    this.fogNear = 3.5;
    this.fogFar = 22.0;

    // Smoothed transition values
    this.targetIntensity = 0.0;
    this.smoothedIntensity = 0.0;
  }

  update(elapsedTime, delta) {
    const cycleTime = elapsedTime % this.totalCycleDuration;

    let accum = 0;
    let phase = 0;
    let phaseFraction = 0;

    for (let i = 0; i < this.phaseDurations.length; i++) {
      if (cycleTime < accum + this.phaseDurations[i]) {
        phase = i;
        phaseFraction = (cycleTime - accum) / this.phaseDurations[i];
        break;
      }
      accum += this.phaseDurations[i];
    }

    this.currentPhase = phase;

    // Calculate target weather intensity based on sinusoidal smoothstep transitions between phases
    // Phase 0: Clear & Aurora (0.0 -> 0.05)
    // Phase 1: Flurries (0.05 -> 0.50)
    // Phase 2: Heavy Blizzard (0.50 -> 1.0 -> 0.80)
    // Phase 3: Calming / Clearing (0.80 -> 0.0)
    if (!this.debugLock) {
      if (phase === 0) {
        // Clear celestial night with glowing aurora
        this.targetIntensity = 0.0;
      } else if (phase === 1) {
        // Flurries gathering
        this.targetIntensity = Math.sin(phaseFraction * Math.PI * 0.5) * 0.45;
      } else if (phase === 2) {
        // Full blizzard peak
        const peak = Math.sin(phaseFraction * Math.PI);
        this.targetIntensity = 0.45 + peak * 0.55;
      } else if (phase === 3) {
        // Calming clearing
        this.targetIntensity = (1.0 - Math.sin(phaseFraction * Math.PI * 0.5)) * 0.50;
      }
    }

    // Smooth exponential approach (no jarring snaps)
    const smoothRate = Math.min(delta * 1.8, 1.0);
    this.smoothedIntensity += (this.targetIntensity - this.smoothedIntensity) * smoothRate;
    this.weatherIntensity = this.smoothedIntensity;

    // Wind gusts: base drift plus turbulent multi-scale gusts tied to blizzard intensity
    const gustNoise1 = Math.sin(elapsedTime * 0.72) * Math.cos(elapsedTime * 0.41);
    const gustNoise2 = Math.sin(elapsedTime * 1.45 + 1.2) * 0.5;
    this.windGust = (gustNoise1 * 0.6 + gustNoise2 * 0.4) * (0.2 + this.weatherIntensity * 0.8);

    const windStrength = 0.008 + this.weatherIntensity * 0.042 + Math.max(0, this.windGust) * 0.025;
    const windAngle = Math.sin(elapsedTime * 0.08) * 0.6 + 0.35; // Prevailing eastward with subtle shift
    this.windVelocity.set(
      Math.cos(windAngle) * windStrength,
      -0.001 * this.weatherIntensity,
      Math.sin(windAngle) * windStrength
    );

    // Atmospheric Distance Fog Harmonization
    // Clear: near 3.5, far 22.0 (matches horizon background seamlessly)
    // Blizzard: near 1.8, far 12.0 (atmospheric winter whiteout without abrupt walls)
    this.fogNear = 3.5 - this.weatherIntensity * 1.7;
    this.fogFar  = 22.0 - this.weatherIntensity * 10.0;

    if (scene.fog) {
      scene.fog.near = this.fogNear;
      scene.fog.far = this.fogFar;
    }

    // Coupled Sky & Starfield Overcast
    if (skyUniforms && skyUniforms.uWeatherOvercast) {
      skyUniforms.uWeatherOvercast.value = this.weatherIntensity;
    }

    // Continuous snowfall across all phases (crisp ambient flurries even in clear weather, dense during blizzards)
    const snowAlpha = 0.75 + this.weatherIntensity * 0.22;
    if (snowMat && snowMat.uniforms.uOpacity) {
      snowMat.uniforms.uOpacity.value = snowAlpha;
    }
    if (largeSnowMat && largeSnowMat.uniforms.uOpacity) {
      largeSnowMat.uniforms.uOpacity.value = snowAlpha * 0.95;
    }
  }
}

const weatherEngine = new DynamicWeatherEngine();
window.weatherEngine = weatherEngine;

// =============================================================================
// AUTOMATIC ADAPTIVE VILLAGE WARM-LIGHTING SYSTEM
// =============================================================================
class VillageLightingSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.clusterThreshold = options.clusterThreshold || 2.4; // Merge distance in meters
    this.maxPoolLights = 0; // Pure shader-based ground illumination without blinding point light orbs

    // Bounds of the terrain in world XZ
    this.boundsMin = new THREE.Vector2(-11.0, -11.0);
    this.boundsMax = new THREE.Vector2(11.0, 11.0);
    this.boundsSize = new THREE.Vector2(22.0, 22.0);

    // Canvas & CanvasTexture for ground illumination
    this.canvasSize = 512;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasSize;
    this.canvas.height = this.canvasSize;
    this.ctx = this.canvas.getContext('2d');

    this.lightMapTexture = new THREE.CanvasTexture(this.canvas);
    this.lightMapTexture.generateMipmaps = false;
    this.lightMapTexture.minFilter = THREE.LinearFilter;
    this.lightMapTexture.magFilter = THREE.LinearFilter;
    this.lightMapTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.lightMapTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.lightMapTexture.flipY = false;

    // Uniforms object for terrain shader
    this.uniforms = {
      uVillageLightMap: { value: this.lightMapTexture },
      uLightBoundsMin: { value: this.boundsMin },
      uLightBoundsSize: { value: this.boundsSize },
      uGroundWarmthIntensity: { value: 1.45 }
    };

    // Tracked houses: Map of mesh -> { mesh, name, lastWorldPos: Vector3, isCustom: boolean }
    this.trackedHouses = new Map();

    // Clusters: array of { id, centroid: Vector3, radius: number, houses: Array, isIsolated: boolean }
    this.clusters = [];

    // Light pool is empty - ground illumination is 100% handled by procedural snow lightmap shader
    this.lightPool = [];

    this.isDirty = true;
    this.testObjects = [];
    this.activeAnimations = [];
    this.tempVec = new THREE.Vector3();
  }

  // Scan scene graph for house meshes
  scanScene() {
    const foundMeshes = new Set();
    this.scene.traverse((obj) => {
      if (obj.isMesh) {
        const name = (obj.name || '').toLowerCase();
        if (name.includes('house') || name.includes('building') || obj.userData.isHouse) {
          foundMeshes.add(obj);
          if (!this.trackedHouses.has(obj)) {
            const wp = new THREE.Vector3();
            obj.getWorldPosition(wp);
            this.trackedHouses.set(obj, {
              mesh: obj,
              name: obj.name || `House_${this.trackedHouses.size + 1}`,
              lastWorldPos: wp.clone(),
              isCustom: !!obj.userData.isCustom
            });
            this.isDirty = true;
          }
        }
      }
    });

    // Remove any tracked houses that are no longer in the scene
    for (const [mesh] of this.trackedHouses.entries()) {
      if (!foundMeshes.has(mesh) || !mesh.parent) {
        this.trackedHouses.delete(mesh);
        this.isDirty = true;
      }
    }

    if (this.isDirty) {
      this.recalculate();
    }
  }

  // Recalculate clusters and render ground lightmap
  recalculate() {
    this.isDirty = false;
    const houseList = [];
    const wp = new THREE.Vector3();

    for (const [mesh, data] of this.trackedHouses.entries()) {
      mesh.getWorldPosition(wp);
      data.lastWorldPos.copy(wp);
      houseList.push({
        mesh,
        name: data.name,
        pos: wp.clone()
      });
    }

    // Spatial clustering using distance threshold
    const threshold = this.clusterThreshold;
    const visited = new Set();
    const clusters = [];

    for (let i = 0; i < houseList.length; i++) {
      if (visited.has(i)) continue;
      const clusterHouses = [houseList[i]];
      visited.add(i);
      const queue = [houseList[i]];

      while (queue.length > 0) {
        const curr = queue.shift();
        for (let j = 0; j < houseList.length; j++) {
          if (visited.has(j)) continue;
          const d = Math.hypot(curr.pos.x - houseList[j].pos.x, curr.pos.z - houseList[j].pos.z);
          if (d <= threshold) {
            visited.add(j);
            clusterHouses.push(houseList[j]);
            queue.push(houseList[j]);
          }
        }
      }

      // Compute centroid
      const centroid = new THREE.Vector3();
      for (const h of clusterHouses) {
        centroid.add(h.pos);
      }
      centroid.divideScalar(clusterHouses.length);

      // Compute radius
      let maxDist = 0;
      for (const h of clusterHouses) {
        const d = Math.hypot(h.pos.x - centroid.x, h.pos.z - centroid.z);
        if (d > maxDist) maxDist = d;
      }

      clusters.push({
        id: clusters.length,
        centroid,
        radius: maxDist,
        houses: clusterHouses,
        isIsolated: clusterHouses.length === 1
      });
    }

    // Sort clusters by visual weight (house count)
    clusters.sort((a, b) => b.houses.length - a.houses.length);
    this.clusters = clusters;

    // Allocate pool lights to top clusters / sub-clusters
    this.allocatePoolLights();

    // Redraw 2D ground lightmap
    this.renderLightMap(houseList, clusters);
  }

  // Allocate 5 pool lights among active clusters
  allocatePoolLights() {
    const targets = [];

    for (const cluster of this.clusters) {
      if (targets.length >= this.maxPoolLights) break;

      // If this cluster has many houses (> 20 houses like lakeside village) and spans a wide area
      if (cluster.houses.length >= 20 && targets.length + 2 <= this.maxPoolLights) {
        // Divide into 2 natural sub-clusters along X axis for distributed illumination
        const hList = cluster.houses.slice().sort((a, b) => a.pos.x - b.pos.x);
        const half = Math.floor(hList.length / 2);
        const g1 = hList.slice(0, half);
        const g2 = hList.slice(half);

        const c1 = new THREE.Vector3();
        g1.forEach((h) => c1.add(h.pos));
        c1.divideScalar(g1.length);
        c1.y += 0.65; // At window height

        const c2 = new THREE.Vector3();
        g2.forEach((h) => c2.add(h.pos));
        c2.divideScalar(g2.length);
        c2.y += 0.65;

        targets.push({ pos: c1, intensity: 0.65, dist: 14.0 });
        targets.push({ pos: c2, intensity: 0.60, dist: 13.0 });
      } else {
        const pos = cluster.centroid.clone();
        pos.y += 0.60;
        const intensity = cluster.isIsolated ? 0.38 : Math.min(0.65, 0.46 + cluster.houses.length * 0.015);
        const dist = cluster.isIsolated ? 7.5 : Math.min(14.0, 8.5 + cluster.radius * 0.8);
        targets.push({ pos, intensity, dist });
      }
    }

    // Assign targets to light pool
    for (let i = 0; i < this.maxPoolLights; i++) {
      const light = this.lightPool[i];
      if (i < targets.length) {
        light.userData.targetPosition.copy(targets[i].pos);
        light.userData.targetIntensity = targets[i].intensity;
        light.distance = targets[i].dist;
        light.visible = true;
      } else {
        light.userData.targetIntensity = 0.0;
      }
    }
  }

  // Draw procedural lightmap with smooth Hermite falloff and 'screen' soft saturation
  renderLightMap(houseList, clusters) {
    const ctx = this.ctx;
    const size = this.canvasSize;
    const bMin = this.boundsMin;
    const bSize = this.boundsSize;

    // Clear to pitch black with source-over to guarantee clean frame clear
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    // Screen composite operation: screen(A, B) = A + B - AB (prevents blowout/clipping)
    ctx.globalCompositeOperation = 'screen';

    const w2cX = (x) => ((x - bMin.x) / bSize.x) * size;
    const w2cY = (z) => ((z - bMin.y) / bSize.y) * size;
    const m2px = (m) => (m / bSize.x) * size;

    // 1. Broad cluster washes for multi-house clusters (groups >= 2 houses)
    for (const cluster of clusters) {
      if (cluster.isIsolated) continue;

      const clusterCenters = [];
      if (cluster.houses.length >= 15) {
        const hList = cluster.houses.slice().sort((a, b) => a.pos.x - b.pos.x);
        const half = Math.floor(hList.length / 2);
        const g1 = hList.slice(0, half);
        const g2 = hList.slice(half);
        const c1 = new THREE.Vector3();
        g1.forEach((h) => c1.add(h.pos));
        c1.divideScalar(g1.length);
        const c2 = new THREE.Vector3();
        g2.forEach((h) => c2.add(h.pos));
        c2.divideScalar(g2.length);
        clusterCenters.push({ pos: c1, r: 3.2 });
        clusterCenters.push({ pos: c2, r: 3.2 });
      } else {
        const r = Math.min(3.2, Math.max(2.0, cluster.radius * 0.75 + 1.2));
        clusterCenters.push({ pos: cluster.centroid, r });
      }

      const k = cluster.houses.length;
      const alphaPeak = Math.min(0.20, 0.08 + 0.025 * Math.log2(k));

      for (const cc of clusterCenters) {
        const cx = w2cX(cc.pos.x);
        const cy = w2cY(cc.pos.z);
        const cr = m2px(cc.r);

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
        grad.addColorStop(0, `rgba(240, 150, 50, ${alphaPeak.toFixed(3)})`);
        grad.addColorStop(0.35, `rgba(215, 120, 35, ${(alphaPeak * 0.60).toFixed(3)})`);
        grad.addColorStop(0.70, `rgba(165, 75, 18, ${(alphaPeak * 0.18).toFixed(3)})`);
        grad.addColorStop(0.90, 'rgba(80, 25, 5, 0.008)');
        grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2. Local ground-light pool around each individual house
    for (const h of houseList) {
      const cx = w2cX(h.pos.x);
      const cy = w2cY(h.pos.z);
      const localRadius = 1.45;
      const lr = m2px(localRadius);

      // Smooth Hermite progression: flat at center, 0 at edge
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, lr);
      grad.addColorStop(0, 'rgba(255, 178, 78, 0.40)');
      grad.addColorStop(0.22, 'rgba(245, 152, 56, 0.30)');
      grad.addColorStop(0.52, 'rgba(215, 118, 32, 0.14)');
      grad.addColorStop(0.80, 'rgba(150, 60, 10, 0.02)');
      grad.addColorStop(0.94, 'rgba(80, 25, 5, 0.005)');
      grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, lr, 0, Math.PI * 2);
      ctx.fill();
    }

    this.lightMapTexture.needsUpdate = true;
  }

  // Update loop: checks house movements, animates transitions, and lerps point lights
  update(delta) {
    // 1. Process active animations
    if (this.activeAnimations.length > 0) {
      for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
        const anim = this.activeAnimations[i];
        anim.elapsed += delta;
        const t = Math.min(1.0, anim.elapsed / anim.duration);
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        anim.mesh.position.lerpVectors(anim.startPos, anim.targetPos, ease);
        anim.mesh.updateMatrixWorld(true);
        this.isDirty = true;

        if (t >= 1.0) {
          this.activeAnimations.splice(i, 1);
        }
      }
    }

    // 2. Lightweight dirty check: check if any tracked house position changed
    if (!this.isDirty) {
      for (const [mesh, data] of this.trackedHouses.entries()) {
        mesh.getWorldPosition(this.tempVec);
        if (this.tempVec.distanceToSquared(data.lastWorldPos) > 0.0004) {
          this.isDirty = true;
          break;
        }
      }
    }

    if (this.isDirty) {
      this.recalculate();
    }

    // 3. Smooth point light lerping (position and intensity)
    const lerpSpeed = Math.min(1.0, delta * 5.0);
    for (const light of this.lightPool) {
      const targetPos = light.userData.targetPosition;
      const targetInt = light.userData.targetIntensity;

      light.position.lerp(targetPos, lerpSpeed);
      light.intensity = THREE.MathUtils.lerp(light.intensity, targetInt, lerpSpeed);

      if (light.intensity < 0.01 && targetInt === 0) {
        light.visible = false;
      }
    }
  }

  // Public Test & Management API
  addHouse({ name, x = 0, y = 0.5, z = 0, scale = 1.0 } = {}) {
    let template = null;
    for (const [mesh] of this.trackedHouses.entries()) {
      template = mesh;
      break;
    }
    let newMesh;
    if (template) {
      newMesh = template.clone();
      newMesh.material = template.material; // share material
    } else {
      const geo = new THREE.BoxGeometry(0.5, 0.4, 0.5);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8b3a2a,
        emissive: new THREE.Color(0xffa63b),
        emissiveIntensity: 2.4,
        roughness: 0.7
      });
      newMesh = new THREE.Mesh(geo, mat);
    }
    newMesh.name = name || `house_dynamic_${Date.now()}`;
    newMesh.userData.isHouse = true;
    newMesh.userData.isCustom = true;
    newMesh.position.set(x, y, z);
    newMesh.scale.setScalar(scale);
    this.scene.add(newMesh);
    newMesh.updateMatrixWorld(true);

    this.scanScene();
    return newMesh;
  }

  removeHouse(meshOrName) {
    let targetMesh = null;
    if (typeof meshOrName === 'string') {
      for (const [mesh, data] of this.trackedHouses.entries()) {
        if (data.name === meshOrName || mesh.name === meshOrName) {
          targetMesh = mesh;
          break;
        }
      }
    } else if (meshOrName && meshOrName.isMesh) {
      targetMesh = meshOrName;
    }

    if (!targetMesh) return false;

    if (targetMesh.parent) {
      targetMesh.parent.remove(targetMesh);
    }
    this.trackedHouses.delete(targetMesh);
    this.isDirty = true;
    this.recalculate();
    return true;
  }

  moveHouse(meshOrName, x, y, z, duration = 0) {
    let targetMesh = null;
    if (typeof meshOrName === 'string') {
      for (const [mesh, data] of this.trackedHouses.entries()) {
        if (data.name === meshOrName || mesh.name === meshOrName) {
          targetMesh = mesh;
          break;
        }
      }
    } else if (meshOrName && meshOrName.isMesh) {
      targetMesh = meshOrName;
    }

    if (!targetMesh) return false;

    const targetPos = new THREE.Vector3(x, y, z);
    if (duration <= 0) {
      targetMesh.position.copy(targetPos);
      targetMesh.updateMatrixWorld(true);
      this.isDirty = true;
      this.recalculate();
    } else {
      this.activeAnimations = this.activeAnimations.filter((a) => a.mesh !== targetMesh);
      this.activeAnimations.push({
        mesh: targetMesh,
        startPos: targetMesh.position.clone(),
        targetPos,
        duration,
        elapsed: 0
      });
    }
    return true;
  }

  getClusters() {
    return this.clusters.map((c) => ({
      id: c.id,
      count: c.houses.length,
      centroid: [c.centroid.x, c.centroid.y, c.centroid.z],
      radius: c.radius,
      isIsolated: c.isIsolated,
      houses: c.houses.map((h) => h.name)
    }));
  }

  getHouses() {
    const list = [];
    for (const [mesh, data] of this.trackedHouses.entries()) {
      list.push({
        name: data.name,
        pos: [data.lastWorldPos.x, data.lastWorldPos.y, data.lastWorldPos.z],
        isCustom: data.isCustom
      });
    }
    return list;
  }

  setGroundIntensity(value) {
    this.uniforms.uGroundWarmthIntensity.value = value;
  }

  // Pre-configured validation test scenarios
  testScenario(num) {
    this.cleanupTestObjects();

    if (num === 1) {
      // 1. Isolated House: Frame camera on an isolated house
      const iso = this.clusters.find((c) => c.isIsolated) || { houses: [{ pos: new THREE.Vector3(-7.10, 0.96, 3.82) }] };
      const hp = iso.houses[0].pos;
      camera.position.set(hp.x - 3.2, hp.y + 1.8, hp.z + 3.2);
      camera.lookAt(hp.x, hp.y + 0.3, hp.z);
      controls.target.set(hp.x, hp.y + 0.3, hp.z);
      controls.update();
      return { scenario: 1, name: 'Isolated House', housePos: hp };
    } else if (num === 2) {
      // 2. Village Group: Frame camera on lakeside village
      camera.position.set(-6.2, 2.4, -2.0);
      camera.lookAt(0.5, 1.1, -4.5);
      controls.target.set(0.5, 1.1, -4.5);
      controls.update();
      return { scenario: 2, name: 'Village Group', clusterCount: this.clusters.length };
    } else if (num === 3) {
      // 3. Houses spread apart: spawn two test houses 3.2m apart (beyond 2.4m merge threshold)
      const h1 = this.addHouse({ name: 'test_spread_A', x: 0.0, y: 0.5, z: 0.0 });
      const h2 = this.addHouse({ name: 'test_spread_B', x: 3.2, y: 0.5, z: 0.0 });
      this.testObjects.push(h1, h2);
      camera.position.set(1.6, 3.5, 4.5);
      camera.lookAt(1.6, 0.5, 0.0);
      controls.target.set(1.6, 0.5, 0.0);
      controls.update();
      return { scenario: 3, name: 'Houses Spread Apart', distance: 3.2 };
    } else if (num === 4) {
      // 4. Moving House Transition: move house from isolated to village cluster
      const anchorHouse = this.addHouse({ name: 'test_anchor_house', x: 0.0, y: 0.5, z: 0.0 });
      const movingHouse = this.addHouse({ name: 'test_moving_house', x: 3.8, y: 0.5, z: 0.0 });
      this.testObjects.push(anchorHouse, movingHouse);
      camera.position.set(1.8, 3.2, 4.5);
      camera.lookAt(1.8, 0.5, 0.0);
      controls.target.set(1.8, 0.5, 0.0);
      controls.update();
      this.moveHouse(movingHouse, 1.2, 0.5, 0.0, 3.0);
      return { scenario: 4, name: 'Moving House Transition' };
    } else if (num === 5) {
      // 5. Add & Remove House
      const tempHouse = this.addHouse({ name: 'test_temp_house', x: 0.0, y: 0.5, z: 0.0 });
      camera.position.set(0.0, 2.5, 3.5);
      camera.lookAt(0.0, 0.5, 0.0);
      controls.target.set(0.0, 0.5, 0.0);
      controls.update();
      return { scenario: 5, name: 'Add and Remove House', house: tempHouse.name };
    } else if (num === 6) {
      // 6. Dense Cluster: spawn tight group of 8 houses within 1.2m
      for (let i = 0; i < 8; i++) {
        const ox = (Math.random() - 0.5) * 1.2;
        const oz = (Math.random() - 0.5) * 1.2;
        const h = this.addHouse({ name: `test_dense_${i}`, x: 0.0 + ox, y: 0.5, z: 0.0 + oz });
        this.testObjects.push(h);
      }
      camera.position.set(0.0, 3.2, 3.8);
      camera.lookAt(0.0, 0.5, 0.0);
      controls.target.set(0.0, 0.5, 0.0);
      controls.update();
      return { scenario: 6, name: 'Dense Cluster Non-Blowout', houseCount: 8 };
    }
  }

  cleanupTestObjects() {
    if (this.testObjects && this.testObjects.length > 0) {
      for (const obj of this.testObjects) {
        this.removeHouse(obj);
      }
      this.testObjects = [];
    }
    this.activeAnimations = [];
  }

  resetToGameplay() {
    this.cleanupTestObjects();
    camera.position.set(-6.2, 2.4, -2.0);
    camera.lookAt(0.5, 1.1, -4.5);
    controls.target.set(0.5, 1.1, -4.5);
    controls.update();
  }

  runDiagnostics() {
    return {
      trackedHousesCount: this.trackedHouses.size,
      clustersCount: this.clusters.length,
      activePoolLights: this.lightPool.filter((l) => l.userData.targetIntensity > 0).length,
      clusters: this.getClusters()
    };
  }
}

// Instantiate VillageLightingSystem
const lightingSystem = new VillageLightingSystem(scene);
window.game.lightingSystem = lightingSystem;
window.lightingSystem = lightingSystem;

// --- Custom Procedural Snow Shader Uniforms for Terrain Material ---
const terrainSnowUniforms = {
  uTime: { value: 0 },
  uSnowColor: { value: new THREE.Color(0xf0f5ff) },       // Luminous powder crest
  uSnowMidColor: { value: new THREE.Color(0x8faee4) },    // Translucent lavender-blue midtone
  uSnowShadowColor: { value: new THREE.Color(0x364478) }, // Rich blue-violet crevice shadow (lifted from murky dark)
  uSparkleIntensity: { value: 0.90 },
  uVillageLightMap: lightingSystem.uniforms.uVillageLightMap,
  uLightBoundsMin: lightingSystem.uniforms.uLightBoundsMin,
  uLightBoundsSize: lightingSystem.uniforms.uLightBoundsSize,
  uGroundWarmthIntensity: lightingSystem.uniforms.uGroundWarmthIntensity,
  uAuroraGroundIntensity: { value: 0.32 },
  uAuroraColor: { value: new THREE.Color(0x28f0a8) },
  uAuroraDir: { value: new THREE.Vector3(-0.35, 0.78, 0.52).normalize() }
};

// =============================================================================
// SEAMLESS PROCEDURAL OPEN WORLD CHUNK SYSTEM
// =============================================================================
class InfiniteChunkSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.chunkSize = 20.0;
    this.loadRadius = options.loadRadius || 1;
    this.chunks = new Map();
    this.chunkPool = [];
    this.templateChunkRoot = null;
    this.templateTerrainMeshes = [];
    this.templateFoliageMeshes = [];
    this.templateHouseMesh = null;
    this.templateHouseColliders = [];
    this.sharedMaterials = new Map();
    this.heightGridSize = 65;
    this.heightGrid = null;
    this.edgeHeight = 0.160;
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'InfiniteWorldGroup';
    this.scene.add(this.worldGroup);
    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();
    this.chunkBox = new THREE.Box3();
    this.activeChunkCoords = new Set();
  }

  // Deterministic seedable random (Wang hash + LCG)
  hashCoord(x, z, seed = 1337) {
    let n = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
  }

  // Multi-frequency 2D procedural noise for natural biome distribution
  noise2D(x, z) {
    const X = Math.floor(x);
    const Z = Math.floor(z);
    const fx = x - X;
    const fz = z - Z;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uz = fz * fz * (3.0 - 2.0 * fz);
    const h00 = this.hashCoord(X, Z, 91);
    const h10 = this.hashCoord(X + 1, Z, 91);
    const h01 = this.hashCoord(X, Z + 1, 91);
    const h11 = this.hashCoord(X + 1, Z + 1, 91);
    const nx0 = h00 * (1 - ux) + h10 * ux;
    const nx1 = h01 * (1 - ux) + h11 * ux;
    return nx0 * (1 - uz) + nx1 * uz;
  }

  // Returns biome descriptor: 'village', 'forest', 'cliffs', or 'tundra'
  getChunkBiome(cx, cz) {
    // Chunk (0,0) is always the starting village
    if (cx === 0 && cz === 0) return { type: 'village', density: 1.0, isCenter: true };

    // Biome distribution driven by smooth low-frequency noise
    const nBiome = this.noise2D(cx * 0.28, cz * 0.28);
    const nSub = this.hashCoord(cx, cz, 777);

    if (nBiome > 0.68) {
      // Village outposts dotting the landscape
      return { type: 'village', density: 0.55 + nSub * 0.45, isCenter: false };
    } else if (nBiome > 0.42) {
      // Dense Alpine Pine Forest
      return { type: 'forest', density: 0.85 + nSub * 0.35, isCenter: false };
    } else if (nBiome > 0.22) {
      // Mountain Ridge & High Cliffs
      return { type: 'cliffs', density: 0.80 + nSub * 0.40, isCenter: false };
    } else {
      // Frozen Tundra & Open Ice Valley
      return { type: 'tundra', density: 0.35 + nSub * 0.25, isCenter: false };
    }
  }

  initFromGLTF(gltfRoot) {
    // Global Instanced Mesh architecture with generous capacity for 5x5 chunk streaming (25 chunks)
    this.meshDefinitions = [];
    this.templateHouseColliders = [];
    this.activeChunkCoords = new Set();

    gltfRoot.updateMatrixWorld(true);

    gltfRoot.traverse((child) => {
      if (!child.isMesh) return;

      const mat = child.material;
      if (mat && !this.sharedMaterials.has(mat.name)) {
        this.sharedMaterials.set(mat.name, mat);
      }

      const matName = (mat?.name || '').toLowerCase();
      const name = (child.name || '').toLowerCase();
      const isHouse = matName.includes('building') || matName.includes('house') || name.startsWith('cube') || name.includes('house');
      const isFoliage = name.includes('tree') || name.includes('shrub') || matName.includes('tree');
      const isCliff = name.includes('cliff') || name.includes('plateau') || matName.includes('cliff');
      const isGround = name.includes('plane') || matName.includes('terrain') || matName.includes('rock');

      let category = 'ground';
      if (isHouse) category = 'house';
      else if (isFoliage) category = 'foliage';
      else if (isCliff) category = 'cliff';

      const matrices = [];
      if (child.isInstancedMesh) {
        const m = new THREE.Matrix4();
        for (let i = 0; i < child.count; i++) {
          child.getMatrixAt(i, m);
          matrices.push(m.clone());
        }
      } else {
        matrices.push(child.matrix.clone());
      }

      
      // Vertex boundary stitching for ground geometry to ensure 100% gap-free chunk tiling
      if (isGround && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
        const pAttr = child.geometry.attributes.position;
        const baseM = matrices[0] || child.matrix;
        const invM = baseM.clone().invert();
        const v = new THREE.Vector3();
        for (let i = 0; i < pAttr.count; i++) {
          v.fromBufferAttribute(pAttr, i).applyMatrix4(baseM);
          let isBoundary = false;
          if (v.x <= -9.85) { v.x = -10.0; isBoundary = true; }
          if (v.x >= 9.85)  { v.x = 10.0;  isBoundary = true; }
          if (v.z <= -9.85) { v.z = -10.0; isBoundary = true; }
          if (v.z >= 9.85)  { v.z = 10.0;  isBoundary = true; }
          if (isBoundary) {
            // Anchor perimeter edge height uniformly to 0.160m to guarantee zero elevation discrepancy across seams
            v.y = 0.160;
            v.applyMatrix4(invM);
            pAttr.setXYZ(i, v.x, v.y, v.z);
          }
        }
        pAttr.needsUpdate = true;
        child.geometry.computeVertexNormals();
        child.geometry.computeBoundingBox();
      }

      if (child.geometry && !child.geometry.boundingBox) child.geometry.computeBoundingBox();

      if (isHouse && child.geometry?.boundingBox) {
        for (let i = 0; i < matrices.length; i++) {
          const hBox = child.geometry.boundingBox.clone().applyMatrix4(matrices[i]);
          this.templateHouseColliders.push(hBox);
        }
      }

      const isFlatTerrain = name.includes('plane') || matName.includes('terrain') || matName.includes('ice');
      const isTreeOrFoliage = name.toLowerCase().includes('winter_forest') || name.toLowerCase().includes('tree');
      const isProminentCaster = isHouse || isTreeOrFoliage || name.includes('cliffbig');

      // Create a reference placeholder instMesh so deliverySystem and external references continue working
      const refInstMesh = new THREE.InstancedMesh(child.geometry, child.material, matrices.length);
      refInstMesh.name = 'Ref_' + (child.name || 'Mesh');
      refInstMesh.visible = false; // Placeholder only

      this.meshDefinitions.push({
        name: child.name,
        geometry: child.geometry,
        material: child.material,
        instMesh: refInstMesh,
        baseMatrices: matrices,
        category,
        isHouse,
        castShadow: isProminentCaster,
        receiveShadow: !matName.includes('ice')
      });
    });

    this.buildHeightGrid(gltfRoot);
    this.update(new THREE.Vector3(0, 0, 0));
    console.log('[InfiniteChunkSystem] Per-chunk spatial open world initialized with ' + this.meshDefinitions.length + ' definitions.');
  }

  buildHeightGrid(group) {
    const N = this.heightGridSize;
    this.heightGrid = new Float32Array(N * N);
    const terrainMeshes = [];
    group.traverse((c) => {
      if (c.isMesh && !c.name.includes('Lake') && !(c.material?.name || '').includes('ice')) {
        terrainMeshes.push(c);
      }
    });
    const raycaster = new THREE.Raycaster();
    const half = this.chunkSize * 0.5;
    const downVec = new THREE.Vector3(0, -1, 0);
    for (let j = 0; j < N; j++) {
      const z = -half + (j / (N - 1)) * this.chunkSize;
      for (let i = 0; i < N; i++) {
        const x = -half + (i / (N - 1)) * this.chunkSize;
        raycaster.set(new THREE.Vector3(x, 25.0, z), downVec);
        let hits = [];
        for (let m = 0; m < terrainMeshes.length; m++) {
          const h = raycaster.intersectObject(terrainMeshes[m], false);
          if (h.length > 0) hits.push(h[0]);
        }
        if (hits.length > 0) {
          hits.sort((a, b) => b.point.y - a.point.y);
          this.heightGrid[j * N + i] = hits[0].point.y;
        } else {
          this.heightGrid[j * N + i] = this.edgeHeight;
        }
      }
    }
  }

  getHeight(wx, wz) {
    if (!this.heightGrid) return this.edgeHeight;
    const half = this.chunkSize * 0.5;
    let cx = Math.floor((wx + half) / this.chunkSize);
    let cz = Math.floor((wz + half) / this.chunkSize);
    let lx = wx - cx * this.chunkSize;
    let lz = wz - cz * this.chunkSize;
    const rotIdx = this.getChunkRotationIndex(cx, cz);
    if (rotIdx === 1) { const ox = lx; lx = -lz; lz = ox; }
    else if (rotIdx === 2) { lx = -lx; lz = -lz; }
    else if (rotIdx === 3) { const ox = lx; lx = lz; lz = -ox; }
    const u = (lx + half) / this.chunkSize;
    const v = (lz + half) / this.chunkSize;
    if (u <= 0.0 || u >= 1.0 || v <= 0.0 || v >= 1.0) return this.edgeHeight;
    const N = this.heightGridSize;
    const fx = u * (N - 1);
    const fz = v * (N - 1);
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fz);
    const i1 = Math.min(N - 1, i0 + 1);
    const j1 = Math.min(N - 1, j0 + 1);
    const tx = fx - i0;
    const tz = fz - j0;
    const h00 = this.heightGrid[j0 * N + i0];
    const h10 = this.heightGrid[j0 * N + i1];
    const h01 = this.heightGrid[j1 * N + i0];
    const h11 = this.heightGrid[j1 * N + i1];
    const h0 = h00 * (1 - tx) + h10 * tx;
    const h1 = h01 * (1 - tx) + h11 * tx;
    return h0 * (1 - tz) + h1 * tz;
  }

  getChunkRotationIndex(cx, cz) {
    return 0;
  }

  getHouseCollidersNear(wx, wz, searchRadius = 15.0) {
    const nearby = [];
    const half = this.chunkSize * 0.5;
    const centerCx = Math.floor((wx + half) / this.chunkSize);
    const centerCz = Math.floor((wz + half) / this.chunkSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const k = (centerCx + dx) + ',' + (centerCz + dz);
        const chunk = this.chunks.get(k);
        if (chunk && chunk.houseColliders) {
          for (let i = 0; i < chunk.houseColliders.length; i++) {
            const box = chunk.houseColliders[i];
            const cx = (box.min.x + box.max.x) * 0.5;
            const cz = (box.min.z + box.max.z) * 0.5;
            if (Math.hypot(wx - cx, wz - cz) <= searchRadius) {
              nearby.push(box);
            }
          }
        }
      }
    }
    return nearby;
  }

  update(targetPos, cam = camera) {
    if (!this.meshDefinitions || this.meshDefinitions.length === 0) return;
    const half = this.chunkSize * 0.5;
    const focusPos = targetPos || (cam ? cam.position : new THREE.Vector3());
    const playerCx = Math.floor((focusPos.x + half) / this.chunkSize);
    const playerCz = Math.floor((focusPos.z + half) / this.chunkSize);

    const r = this.loadRadius;
    const neededChunks = [];
    let changed = false;
    const newSet = new Set();

    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const cx = playerCx + dx;
        const cz = playerCz + dz;
        const key = cx + ',' + cz;
        newSet.add(key);
        const biome = this.getChunkBiome(cx, cz);
        neededChunks.push({ cx, cz, key, biome });
      }
    }

    // Check if streaming boundary moved
    if (newSet.size !== this.activeChunkCoords.size) {
      changed = true;
    } else {
      for (const k of newSet) {
        if (!this.activeChunkCoords.has(k)) { changed = true; break; }
      }
    }

    // No bedrock mesh needed
    if (!changed) return;
    this.activeChunkCoords = newSet;

    // Clear and rebuild active chunk registry
    this.chunks.clear();
    const chunkM = new THREE.Matrix4();
    const tempM = new THREE.Matrix4();

    for (const chunk of neededChunks) {
      const { cx, cz, key, biome } = chunk;
      const wx = cx * this.chunkSize;
      const wz = cz * this.chunkSize;
      const rotIdx = this.getChunkRotationIndex(cx, cz);
      const angle = rotIdx * (Math.PI / 2);
      const chunkOrigin = new THREE.Vector3(wx, 0, wz);
      const rotMat = new THREE.Matrix4().makeRotationY(angle);
      const houseColliders = [];

      // Every chunk has the full set of house colliders
      for (let i = 0; i < this.templateHouseColliders.length; i++) {
        const lb = this.templateHouseColliders[i];
        const b = lb.clone();
        b.min.add(chunkOrigin);
        b.max.add(chunkOrigin);
        houseColliders.push(b);
      }

      this.chunks.set(key, { key, cx, cz, houseColliders, biome });
      if (window.deliverySystem && window.deliverySystem.syncChunkTargets) {
        window.deliverySystem.syncChunkTargets(key, cx, cz);
      }
    }

    // Clean up meshes from unneeded chunks
    for (const [key, chunkData] of this.chunks.entries()) {
      if (!newSet.has(key)) {
        if (chunkData.meshes) {
          chunkData.meshes.forEach(m => {
            this.worldGroup.remove(m);
            if (m.dispose) m.dispose();
          });
        }
      }
    }

    // Build or update meshes per chunk
    const cullingEnabled = (window.mobileOptimizer && window.mobileOptimizer.toggles.chunkFrustumCulling === true);

    for (const chunk of neededChunks) {
      const { cx, cz, key } = chunk;
      const chunkData = this.chunks.get(key);
      if (!chunkData) continue;

      if (!chunkData.meshes) {
        chunkData.meshes = [];
        const wx = cx * this.chunkSize;
        const wz = cz * this.chunkSize;
        const rotIdx = this.getChunkRotationIndex(cx, cz);
        const angle = rotIdx * (Math.PI / 2);
        chunkM.makeRotationY(angle);
        chunkM.setPosition(wx, 0, wz);

        for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
          const def = this.meshDefinitions[defIdx];
          const totalB = def.baseMatrices.length;
          if (totalB === 0) continue;

          // Each chunk has its OWN InstancedMesh per type with exact capacity
          const chunkInstMesh = new THREE.InstancedMesh(def.geometry, def.material, totalB);
          chunkInstMesh.name = `Chunk_${key}_${def.name}`;
          chunkInstMesh.castShadow = def.castShadow;
          chunkInstMesh.receiveShadow = def.receiveShadow;
          chunkInstMesh.userData = {
            chunkKey: key,
            category: def.category,
            isHouse: def.isHouse,
            defName: def.name,
            trianglesPerInst: def.geometry.index ? def.geometry.index.count / 3 : def.geometry.attributes.position.count / 3,
            instanceCount: totalB
          };

          for (let b = 0; b < totalB; b++) {
            tempM.multiplyMatrices(chunkM, def.baseMatrices[b]);
            chunkInstMesh.setMatrixAt(b, tempM);
          }

          chunkInstMesh.instanceMatrix.needsUpdate = true;

          // Compute accurate world-space bounding bounds including instance transforms and geometry radius
          chunkInstMesh.computeBoundingBox();
          chunkInstMesh.computeBoundingSphere();

          // Add 15% safety margin
          if (chunkInstMesh.boundingSphere) {
            chunkInstMesh.boundingSphere.radius *= 1.15;
          }

          // Let Three.js perform camera & shadow frustum culling
          chunkInstMesh.frustumCulled = cullingEnabled;

          // Tag onBeforeRender to measure main pass vs shadow pass draws
          chunkInstMesh.onBeforeRender = function(renderer, scene, camera, geometry, material, group) {
            if (window._onChunkMeshRender) {
              window._onChunkMeshRender(chunkInstMesh, camera, key, def.category);
            }
          };

          this.worldGroup.add(chunkInstMesh);
          chunkData.meshes.push(chunkInstMesh);
        }
      } else {
        // Update frustumCulled flag if toggle changed
        chunkData.meshes.forEach(m => {
          m.frustumCulled = cullingEnabled;
        });
      }
    }
  }
}

const chunkSystem = USE_LEGACY
  ? new InfiniteChunkSystem(scene, { loadRadius: 2, unloadRadius: 2 })
  : new BatchedChunkSystem(scene, { loadRadius: 2, unloadRadius: 2, isMobile: IS_MOBILE });
console.log(USE_LEGACY ? '[World] Running in LEGACY per-chunk mode (?legacy=1)' : '[World] Running in HIGH-PERFORMANCE BATCHED mode');
window.chunkSystem = chunkSystem;
window.game.chunkSystem = chunkSystem;

let sleighController = null;
let deliverySystem = null;

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
            // Anti-aliasing and mipmap filtering on house textures to eliminate subpixel crawl and bloom jitter
            const maxAniso = renderer.capabilities.getMaxAnisotropy();
            if (mat.map) {
              mat.map.anisotropy = maxAniso;
              mat.map.generateMipmaps = true;
              mat.map.minFilter = THREE.LinearMipmapLinearFilter;
              mat.map.magFilter = THREE.LinearFilter;
              mat.map.needsUpdate = true;
            }
            if (mat.emissiveMap) {
              mat.emissiveMap.anisotropy = maxAniso;
              mat.emissiveMap.generateMipmaps = true;
              mat.emissiveMap.minFilter = THREE.LinearMipmapLinearFilter;
              mat.emissiveMap.magFilter = THREE.LinearFilter;
              mat.emissiveMap.needsUpdate = true;
            }
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
                         meshName.includes('plateau') ||
                         matName.includes('ice');

          const isTerrain = matName === 'terrain';

          if (isLake) {
            // Clone material so lake does not mutate shared Plateau material
            if (child.material === mat) {
              child.material = mat.clone();
            }
            child.receiveShadow = false; // Prevent shadow acne on flat horizontal plane
            const lakeMat = child.material;
            lakeMat.roughness = 0.28;
            lakeMat.metalness = 0.05;
            lakeMat.color = new THREE.Color(0xffffff);
            lakeMat.customProgramCacheKey = () => 'lake_frozen_ice_material_v3';

            lakeMat.onBeforeCompile = (shader) => {
              // 1. Remap diffuse color to deep navy-blue & cobalt-blue with subtle icy-cyan and embedded cracks
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `
                #ifdef USE_MAP
                  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
                  #ifdef DECODE_VIDEO_TEXTURE
                    sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
                  #endif

                  float pattern = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                  float crack = smoothstep(0.48, 0.82, pattern);

                  // Deep navy, rich cobalt, subtle icy-cyan, and embedded crystalline cracks
                  vec3 cNavy   = vec3(0.038, 0.105, 0.340); // Deep nocturnal navy
                  vec3 cCobalt = vec3(0.085, 0.245, 0.640); // Rich winter cobalt
                  vec3 cCyan   = vec3(0.135, 0.370, 0.750); // Subtle icy cyan nuance
                  vec3 cCrack  = vec3(0.210, 0.460, 0.840); // Subsurface embedded crack (soft, non-neon)

                  vec3 iceColor = mix(cNavy, cCobalt, smoothstep(0.08, 0.52, pattern));
                  iceColor = mix(iceColor, cCyan, smoothstep(0.30, 0.70, pattern) * 0.45);
                  // Soft subsurface embedded cracks with controlled low contrast
                  iceColor = mix(iceColor, cCrack, crack * 0.55);

                  diffuseColor.rgb = iceColor;
                #endif
                `
              );

              // 2. Modulate roughness across the pattern for natural frozen ice variation
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <roughnessmap_fragment>',
                `
                #include <roughnessmap_fragment>
                #ifdef USE_MAP
                  float rPattern = dot(texture2D( map, vMapUv ).rgb, vec3(0.299, 0.587, 0.114));
                  float rCrack = smoothstep(0.48, 0.82, rPattern);
                  // Smooth glossy frozen glaze (0.28) with softly frosted fracture seams (0.42)
                  roughnessFactor = mix(0.28, 0.42, rCrack);
                #endif
                `
              );

              // 3. Uniformly soft specular highlights without color distortion or neon reflections
              shader.fragmentShader = shader.fragmentShader.replace(
                'vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
                `
                vec3 filteredDirectSpec = reflectedLight.directSpecular;
                // Uniformly damp intense specular peaks to preserve frozen glossy sheen without blinding hotspots
                float specLum = dot(filteredDirectSpec.rgb, vec3(0.299, 0.587, 0.114));
                float maxLum = 0.55;
                if (specLum > maxLum) {
                  filteredDirectSpec.rgb *= (maxLum / specLum);
                }

                vec3 totalSpecular = filteredDirectSpec + reflectedLight.indirectSpecular;
                `
              );
            };

            lakeMat.needsUpdate = true;
          } else if (isTerrain && !mat.userData.snowShaderApplied) {
            // Apply custom procedural snow shader mixed with existing terrain texture exclusively to terrain material
            mat.userData.snowShaderApplied = true;
            mat.roughness = 0.80;
            mat.metalness = 0.0;
            mat.customProgramCacheKey = () => 'terrain_procedural_snow_v3';

            mat.onBeforeCompile = (shader) => {
              shader.uniforms.uTime = terrainSnowUniforms.uTime;
              shader.uniforms.uSnowColor = terrainSnowUniforms.uSnowColor;
              shader.uniforms.uSnowMidColor = terrainSnowUniforms.uSnowMidColor;
              shader.uniforms.uSnowShadowColor = terrainSnowUniforms.uSnowShadowColor;
              shader.uniforms.uSparkleIntensity = terrainSnowUniforms.uSparkleIntensity;
              shader.uniforms.uVillageLightMap = terrainSnowUniforms.uVillageLightMap;
              shader.uniforms.uLightBoundsMin = terrainSnowUniforms.uLightBoundsMin;
              shader.uniforms.uLightBoundsSize = terrainSnowUniforms.uLightBoundsSize;
              shader.uniforms.uGroundWarmthIntensity = terrainSnowUniforms.uGroundWarmthIntensity;
              shader.uniforms.uAuroraGroundIntensity = terrainSnowUniforms.uAuroraGroundIntensity;
              shader.uniforms.uAuroraColor = terrainSnowUniforms.uAuroraColor;
              shader.uniforms.uAuroraDir = terrainSnowUniforms.uAuroraDir;

              // 1. Vertex Shader: compute and pass world coordinates & world normal
              shader.vertexShader = `
                varying vec3 vTerrainWorldPos;
                varying vec3 vTerrainWorldNormal;
              ` + shader.vertexShader;

              shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `
                #include <worldpos_vertex>
                #ifdef USE_INSTANCING
                  vTerrainWorldPos = worldPosition.xyz;
                  vTerrainWorldNormal = normalize((modelMatrix * vec4(transformedNormal, 0.0)).xyz);
                #else
                  vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
                  vTerrainWorldNormal = normalize(mat3(modelMatrix) * normal);
                #endif
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
                uniform sampler2D uVillageLightMap;
                uniform vec2 uLightBoundsMin;
                uniform vec2 uLightBoundsSize;
                uniform float uGroundWarmthIntensity;
                uniform float uAuroraGroundIntensity;
                uniform vec3 uAuroraColor;
                uniform vec3 uAuroraDir;

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
                  float sSnowThreshold = 0.15 - sMicroRipples * 0.10;
                  float sSnowCoverage = smoothstep(sSnowThreshold, sSnowThreshold + 0.25, sSlope);
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

                // Harmonize underlying cliff/rock texture so exposed steep crevices take on a cool slate-navy tone
                // rather than saturated greenish/cyan vertex or texture tint
                float rawLum = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                vec3 rockTone = mix(vec3(0.12, 0.16, 0.24) * (rawLum * 0.65 + 0.35), sampledDiffuseColor.rgb, 0.35);

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
                vec3 moonDir = normalize(vec3(24.0, 42.0, -18.0));
                float sssScatter = pow(clamp(dot(viewDir, -moonDir), 0.0, 1.0), 3.0) * (1.0 - sSlope * 0.45);
                snowFinal += vec3(0.14, 0.18, 0.32) * sssScatter * 0.45;

                // 3. Crystalline Moonlight Sheen & Delicate Multi-Frequency Glitter
                vec3 halfVec = normalize(viewDir + moonDir);
                float specAngle = clamp(dot(sWNorm, halfVec), 0.0, 1.0);
                float moonSheen = pow(specAngle, 16.0) * (0.28 + 0.72 * sMacroDrift);
                float glitter1 = snowNoise(sWPos.xz * 32.0 + sin(uTime * 0.4) * 0.03);
                float glitter2 = snowNoise(sWPos.xz * 68.0 - cos(uTime * 0.3) * 0.03);
                float glitterBase = clamp(glitter1 * glitter2 * specAngle, 0.0, 1.0);
                float glitter = pow(glitterBase, 4.5) * 1.6;
                vec3 sparkleColor = vec3(0.92, 0.96, 1.0) * clamp(moonSheen * 0.22 + glitter * 0.28, 0.0, 1.0) * uSparkleIntensity;

                // 4. Harmonious Mixing with Existing Terrain Texture
                // Modulate the snow with the low-poly faceting of the original texture
                float texLum = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                vec3 facetedSnow = snowFinal * (texLum * 0.45 + 0.78);

                // Blend rock tone with our snow shader
                vec3 blendedDiffuse = mix(rockTone, facetedSnow, sSnowCoverage * 0.92);
                blendedDiffuse += sparkleColor * sSnowCoverage;

                // 5. Automatic Adaptive Village Warm Ground Illumination
                vec2 lightUv = (sWPos.xz - uLightBoundsMin) / uLightBoundsSize;
                vec2 clampedUv = clamp(lightUv, 0.0, 1.0);
                vec4 villageLight = texture2D(uVillageLightMap, clampedUv);

                float inBounds = smoothstep(0.0, 0.02, lightUv.x) * (1.0 - smoothstep(0.98, 1.0, lightUv.x)) * smoothstep(0.0, 0.02, lightUv.y) * (1.0 - smoothstep(0.98, 1.0, lightUv.y));
                float slopeFactor = pow(clamp(sWNorm.y, 0.0, 1.0), 1.2);
                float lightLum = max(villageLight.r, max(villageLight.g, villageLight.b));
                float cleanCutoff = smoothstep(0.012, 0.035, lightLum);
                vec3 warmGlow = villageLight.rgb * inBounds * slopeFactor * cleanCutoff * uGroundWarmthIntensity;

                // 6. Aurora Sky-to-Ground Illumination
                // Luminous emerald-teal ethereal light falling onto snow slopes, plateaus, and crests
                float skyFacing = clamp(dot(sWNorm, uAuroraDir) * 0.70 + sWNorm.y * 0.50, 0.0, 1.0);
                // Multi-scale procedural slow wave matching atmospheric curtain motion
                float aWave1 = sin(sWPos.x * 0.055 + sWPos.z * 0.035 + uTime * 0.28);
                float aWave2 = cos(sWPos.z * 0.048 - sWPos.x * 0.028 + uTime * 0.20);
                float aMod = (aWave1 * 0.5 + aWave2 * 0.5) * 0.25 + 0.75; // 0.50 to 1.0 breathing factor
                vec3 auroraGlow = uAuroraColor * (skyFacing * aMod * uAuroraGroundIntensity * sSnowCoverage);
                auroraGlow *= (texLum * 0.40 + 0.60);

                // 7. Shadow-aware additive glows.
                // The runtime shadow map only attenuates the DIRECT moonlight term. The aurora and
                // village glows are additive, so they keep re-lighting the snow inside a shadow and
                // flatten every tree/house shadow out. Sampling the same shadow map here and
                // attenuating the glows restores the contrast the moon key is supposed to give.
                float terrainShadow = 1.0;
                #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
                {
                  vec4 shadowCoord = vDirectionalShadowCoord[ 0 ];
                  shadowCoord.xyz /= shadowCoord.w;
                  shadowCoord.z += directionalLightShadows[ 0 ].shadowBias;
                  vec2 shadowTexel = 1.0 / directionalLightShadows[ 0 ].shadowMapSize;
                  // 4-tap cross PCF (4 extra fetches) keeps the shadow edge soft without paying
                  // for the full 9-tap PCF_SOFT kernel twice on every terrain pixel
                  float lit = step( shadowCoord.z, unpackRGBAToDepth( texture2D( directionalShadowMap[ 0 ], shadowCoord.xy ) ) );
                  lit += step( shadowCoord.z, unpackRGBAToDepth( texture2D( directionalShadowMap[ 0 ], shadowCoord.xy + vec2( shadowTexel.x, 0.0 ) ) ) );
                  lit += step( shadowCoord.z, unpackRGBAToDepth( texture2D( directionalShadowMap[ 0 ], shadowCoord.xy - vec2( shadowTexel.x, 0.0 ) ) ) );
                  lit += step( shadowCoord.z, unpackRGBAToDepth( texture2D( directionalShadowMap[ 0 ], shadowCoord.xy + vec2( 0.0, shadowTexel.y ) ) ) );
                  lit += step( shadowCoord.z, unpackRGBAToDepth( texture2D( directionalShadowMap[ 0 ], shadowCoord.xy - vec2( 0.0, shadowTexel.y ) ) ) );
                  terrainShadow = lit * 0.2;
                }
                #endif
                float glowShadow = mix( 1.0, terrainShadow, 0.85 );
                auroraGlow *= glowShadow;
                warmGlow *= mix( 1.0, glowShadow, 0.45 );

                diffuseColor.rgb = blendedDiffuse + warmGlow + auroraGlow;
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

                #if 0
                // Mobile: lightweight macro drift curvature avoids 4 multi-octave FBM evaluations per pixel
                vec3 worldDriftN = normalize(vec3(-cos(sDriftUv.x * 1.5) * 0.12, 1.0, -sin(sDriftUv.y * 1.0) * 0.12));
                vec3 viewDriftN = normalize((viewMatrix * vec4(worldDriftN, 0.0)).xyz);
                normal = normalize(mix(normal, viewDriftN, sSnowCoverage * 0.35));
                #else
                // Desktop: full multi-frequency FBM analytical derivative
                float eps = 0.06;
                float hC = snowFBM(sWPos.xz * 1.15) * 0.6 + sMacroDrift * 0.4;
                float hX = snowFBM((sWPos.xz + vec2(eps, 0.0)) * 1.15) * 0.6 + (sin((sDriftUv.x + eps * 0.18) * 1.5 + sin(sDriftUv.y * 1.0) * 0.8) * 0.5 + 0.5) * 0.4;
                float hZ = snowFBM((sWPos.xz + vec2(0.0, eps)) * 1.15) * 0.6 + (sin(sDriftUv.x * 1.5 + sin((sDriftUv.y + eps * 0.18) * 1.0) * 0.8) * 0.5 + 0.5) * 0.4;

                vec3 worldDriftN = normalize(vec3(-(hX - hC) / eps * 0.38, 1.0, -(hZ - hC) / eps * 0.38));
                vec3 viewDriftN = normalize((viewMatrix * vec4(worldDriftN, 0.0)).xyz);
                normal = normalize(mix(normal, viewDriftN, sSnowCoverage * 0.50));
                #endif
                `
              );
            };

            mat.needsUpdate = true;
          }
        });
      }
    });

    // Initialize InfiniteChunkSystem with the imported terrain template
    chunkSystem.initFromGLTF(root);

    // Initial streaming around the village center
    chunkSystem.update(new THREE.Vector3(0, 0, 0));

    // Initialize Santa Flight Controller & Gift Delivery System
    sleighController = new SleighController(scene, camera, controls, chunkSystem, IS_MOBILE);
    deliverySystem = new DeliverySystem(scene, chunkSystem, sleighController, IS_MOBILE);

    window.sleighController = sleighController;
    window.deliverySystem = deliverySystem;
    window.game.sleighController = sleighController;
    window.game.deliverySystem = deliverySystem;

    // Synchronize initial targets for origin village chunk (0,0)
    deliverySystem.syncChunkTargets('0,0', 0, 0);

    // Begin the first 5-delivery run immediately (seeds every preloaded chunk)
    deliverySystem.startRun(false);

    // Disable OrbitControls mouse drag overrides so camera smoothly tracks Santa's sleigh
    controls.enabled = false;

    // Keyboard shortcuts: R for gift refill, C for Mobile Optimization Compare toggle
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR') {
        if (deliverySystem) deliverySystem.refillGifts();
      } else if (e.code === 'KeyC') {
        if (window.mobileOptimizer) window.mobileOptimizer.toggleCompare();
      }
    });

    // Initialize automatic adaptive VillageLightingSystem once scene is loaded
    lightingSystem.scanScene();

    // Shadow frustum tightened around the ground under Santa for maximum texel density and reduced shadow-pass polygon load.
    // Desktop: 56m across a 2048 map => ~2.7cm per texel (tree/house shadows stay razor sharp).
    // Mobile: 36m across a 1024 map => ~3.5cm per texel.
    const shadowExtent = 20;
    moonLight.shadow.camera.left = -shadowExtent;
    moonLight.shadow.camera.right = shadowExtent;
    moonLight.shadow.camera.top = shadowExtent;
    moonLight.shadow.camera.bottom = -shadowExtent;
    moonLight.shadow.camera.updateProjectionMatrix();

    // Apply mobile optimizations AFTER chunkSystem, lights, and materials are ready
    if (mobileOptimizer && mobileOptimizer.enabled) {
      mobileOptimizer.apply();
    }

    // Pre-warm GPU textures and precompile shader pipelines during load screen to eliminate runtime frame drops
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

    if (renderer.compileAsync) {
      renderer.compileAsync(scene, camera).catch(() => {}).finally(() => {
        if (loaderElement) {
          loaderElement.classList.add('hidden');
          setTimeout(() => loaderElement.remove(), 700);
        }
      });
    } else {
      if (loaderElement) {
        loaderElement.classList.add('hidden');
        setTimeout(() => loaderElement.remove(), 700);
      }
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
  camera.fov = (height > width) ? 65 : 50;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  const pRatio = Math.min(window.devicePixelRatio || 1, 2.5);
  renderer.setPixelRatio(pRatio);
  composer.setSize(width, height);
  composer.setPixelRatio(pRatio);

  if (bloomPass) {
    const bRes = new THREE.Vector2(width, height);
    bloomPass.setSize(bRes.x, bRes.y);
  }
});

// --- Performance Telemetry & Animation Loop ---
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;
const clock = new THREE.Clock();


window._printScenePolys = function() {
  if (chunkSystem && typeof chunkSystem.getActiveTriangleCount === 'function') {
    window._visibleSceneTriangles = chunkSystem.getActiveTriangleCount();
    return;
  }
  let uniqueTriangles = 0;
  const seenGeometries = new Set();
  scene.traverse(o => {
    if (o.isMesh && o.visible && o.geometry && !seenGeometries.has(o.geometry.id)) {
      seenGeometries.add(o.geometry.id);
      const tri = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      uniqueTriangles += tri;
    }
  });
  window._visibleSceneTriangles = Math.round(uniqueTriangles);
};
setInterval(() => { if (window._printScenePolys) window._printScenePolys(); }, 1000);
let _targetFpsCap = (typeof IS_MOBILE !== 'undefined' && IS_MOBILE) ? 30 : 60;
window._targetFpsCap = _targetFpsCap;
window.setFpsCap = function(cap) {
  _targetFpsCap = cap;
  window._targetFpsCap = cap;
  console.log('[FrameRate] FPS cap set to:', cap);
};

let _lastRenderTimeMs = 0;
function animate(currentTime) {
  requestAnimationFrame(animate);

  if (_targetFpsCap && _targetFpsCap < 60) {
    // Dynamic minimum interval: 30 FPS -> ~32.5ms, 45 FPS -> ~21.2ms
    const minInterval = (1000 / _targetFpsCap) - 1.0;
    if (currentTime - _lastRenderTimeMs < minInterval) {
      return;
    }
  }
  _lastRenderTimeMs = currentTime;

  if (perfDebugger) {
    perfDebugger.beginFrame();
  } else {
    renderer.info.reset();
  }

  const logicStart = performance.now();
  const delta = clock.getDelta();
  const elapsedTime = clock.getElapsedTime();

  const pauseLogic = perfDebugger?.state?.pauseLogic;

  // Update Santa Sleigh Flight & Gift Delivery systems
  if (sleighController && !pauseLogic) {
    sleighController.update(delta, elapsedTime);
  }
  if (deliverySystem && !pauseLogic) {
    deliverySystem.update(delta, elapsedTime);
  }

  // Update dynamic procedural infinite chunk streaming based on sleigh position / exploration focus
  if (window.chunkSystem && !pauseLogic) {
    const streamFocus = sleighController ? sleighController.position : controls.target;
    window.chunkSystem.update(streamFocus, camera);
  }

  // Mobile optimizer culling and telemetry (runs EVERY FRAME before render)
  if (mobileOptimizer && mobileOptimizer.enabled) {
    const focusPos = sleighController ? sleighController.position : (controls.target || camera.position);
    mobileOptimizer.update(delta, focusPos, fps);
  }

  // Update unified procedural winter night sky, 3D aurora & Milky Way
  if (skyGroup && !pauseLogic) {
    skyGroup.position.copy(camera.position);
    skyUniforms.uTime.value = elapsedTime;
    skyUniforms.uCameraPos.value.copy(camera.position);
  }

  // Update procedural terrain snow shader time
  if (terrainSnowUniforms && !pauseLogic) {
    terrainSnowUniforms.uTime.value = elapsedTime;
  }

  // Update procedural low-lying winter mist time
  if (fogTimeUniform && !pauseLogic) {
    fogTimeUniform.value = elapsedTime;
  }

  // Update automatic adaptive village warm-lighting system
  if (lightingSystem && !pauseLogic) {
    lightingSystem.update(delta);
  }

  // Update dynamic procedural weather engine (cycles through Clear -> Flurries -> Blizzard -> Clearing)
  if (weatherEngine && !pauseLogic) {
    weatherEngine.update(elapsedTime, delta);
  }

  // Anchor snowfall simulation volume to current exploration focus (controls.target or camera)
  const snowFocus = (controls && controls.target) ? controls.target : camera.position;
  if (snowParticles) {
    snowParticles.position.set(snowFocus.x, 0, snowFocus.z);
  }
  if (largeSnowParticles) {
    largeSnowParticles.position.set(snowFocus.x, 0, snowFocus.z);
  }

  // Modulate aurora sky-to-ground ambient bounce in sync with atmospheric curtains & weather
  const weatherDim = 1.0 - weatherEngine.weatherIntensity * 0.70;
  if (auroraGroundLight) {
    const aBreath = Math.sin(elapsedTime * 0.28) * 0.05 + Math.cos(elapsedTime * 0.17) * 0.03;
    auroraGroundLight.intensity = (0.22 + aBreath) * weatherDim;
  }
  if (starlightHemiLight) {
    const hemiBreath = Math.sin(elapsedTime * 0.22) * 0.04;
    starlightHemiLight.intensity = (0.56 + hemiBreath) * (0.65 + 0.35 * weatherDim);
  }
  if (moonLight) {
    if (sleighController) {
      const sp = sleighController.position;
      // Ground-projected focus: the tight shadow frustum rides along the snow the player can
      // actually see (the sleigh flies far above it), while the light offset stays constant
      // so the moonlight direction - and therefore the shadow angle - never changes.
      const focusLerp = 1.0 - Math.exp(-delta * 4.0);
      shadowFocus.x += (sp.x - shadowFocus.x) * focusLerp;
      shadowFocus.z += (sp.z - shadowFocus.z) * focusLerp;
      shadowFocus.y = 0;

      // Anti-jitter: snap directional shadow camera in texel increments to completely stop sub-pixel shadow crawling
      const currentExtent = 20;
      const worldTexelSize = (currentExtent * 2.0) / shadowMapDim;
      const snappedFocusX = Math.floor(shadowFocus.x / worldTexelSize) * worldTexelSize;
      const snappedFocusZ = Math.floor(shadowFocus.z / worldTexelSize) * worldTexelSize;

      moonLight.position.set(
        snappedFocusX + MOON_OFFSET.x,
        MOON_OFFSET.y,
        snappedFocusZ + MOON_OFFSET.z
      );
      moonLight.target.position.set(snappedFocusX, 0, snappedFocusZ);
      moonLight.target.updateMatrixWorld();
    }
    // Softly diffuse moonlight during blizzards
    moonLight.intensity = 0.95 * (0.60 + 0.40 * weatherDim);
  }

  // Physical snowfall update with dynamic wind gusts and blizzard turbulence
  const windX = weatherEngine.windVelocity.x;
  const windZ = weatherEngine.windVelocity.z;
  const fallSpeedMultiplier = 1.0 + weatherEngine.weatherIntensity * 1.8;

  if (snowParticles && snowParticles.visible) {
    const positions = snowGeo.attributes.position.array;
    for (let i = 0; i < snowCount; i++) {
      const v = snowVelocities[i];
      // Accelerated fall speed during blizzards
      positions[i * 3 + 1] -= v.fallSpeed * fallSpeedMultiplier;

      // Dynamic wind drift + chaotic flutter
      const sway = Math.sin(elapsedTime * v.swaySpeed + v.offset) * v.swayAmp;
      positions[i * 3]     += (v.windDrift + windX) + sway;
      positions[i * 3 + 2] += (v.windDrift * 0.4 + windZ) + Math.cos(elapsedTime * 0.6 + v.offset) * 0.01;

      // Wrap around local bounds centered on player/camera
      if (positions[i * 3 + 1] < 0) {
        positions[i * 3 + 1] = snowBounds.y;
        positions[i * 3]     = (Math.random() - 0.5) * snowBounds.x;
        positions[i * 3 + 2] = (Math.random() - 0.5) * snowBounds.z;
      }
      if (positions[i * 3] > snowBounds.x * 0.5) {
        positions[i * 3] = -snowBounds.x * 0.5;
      } else if (positions[i * 3] < -snowBounds.x * 0.5) {
        positions[i * 3] = snowBounds.x * 0.5;
      }

      if (positions[i * 3 + 2] > snowBounds.z * 0.5) {
        positions[i * 3 + 2] = -snowBounds.z * 0.5;
      } else if (positions[i * 3 + 2] < -snowBounds.z * 0.5) {
        positions[i * 3 + 2] = snowBounds.z * 0.5;
      }
    }
    snowGeo.attributes.position.needsUpdate = true;
  }

  // Update Snow Particles (Layer 2 - Near camera fluffy flakes)
  if (largeSnowParticles && largeSnowParticles.visible) {
    const largePositions = largeSnowGeo.attributes.position.array;
    for (let i = 0; i < largeSnowCount; i++) {
      const v = largeSnowVelocities[i];
      largePositions[i * 3 + 1] -= v.fallSpeed * fallSpeedMultiplier;

      const sway = Math.sin(elapsedTime * v.swaySpeed + v.offset) * v.swayAmp;
      largePositions[i * 3]     += (v.windDrift + windX * 1.15) + sway;
      largePositions[i * 3 + 2] += (v.windDrift * 0.5 + windZ * 1.15) + Math.cos(elapsedTime * 0.5 + v.offset) * 0.015;

      if (largePositions[i * 3 + 1] < 0) {
        largePositions[i * 3 + 1] = snowBounds.y;
        largePositions[i * 3]     = (Math.random() - 0.5) * snowBounds.x;
        largePositions[i * 3 + 2] = (Math.random() - 0.5) * snowBounds.z;
      }
      if (largePositions[i * 3] > snowBounds.x * 0.5) {
        largePositions[i * 3] = -snowBounds.x * 0.5;
      } else if (largePositions[i * 3] < -snowBounds.x * 0.5) {
        largePositions[i * 3] = snowBounds.x * 0.5;
      }

      if (largePositions[i * 3 + 2] > snowBounds.z * 0.5) {
        largePositions[i * 3 + 2] = -snowBounds.z * 0.5;
      } else if (largePositions[i * 3 + 2] < -snowBounds.z * 0.5) {
        largePositions[i * 3 + 2] = snowBounds.z * 0.5;
      }
    }
    largeSnowGeo.attributes.position.needsUpdate = true;
  }

  const logicEnd = performance.now();
  if (perfDebugger) perfDebugger.recordLogicTime(logicEnd - logicStart);

  // Render scene with cinematic bloom or direct render toggle
  const renderStart = performance.now();
  if (!perfDebugger?.state?.skipRender) {
    const useBloom = (perfDebugger?.state?.postProcessing !== false)
                  && !(mobileOptimizer?.enabled && mobileOptimizer._bloomDisabled);
    if (useBloom) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }
  const renderEnd = performance.now();
  if (perfDebugger) perfDebugger.recordRenderTime(renderEnd - renderStart);

  const sceneCalls = renderer.info.render.calls;
  const sceneTriangles = renderer.info.render.triangles;

  if (perfDebugger) perfDebugger.endFrame();

  // FPS & Draw Call Telemetry
  frameCount++;
  if (currentTime >= lastTime + 1000) {
    fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
    if (fpsElement) {
      const visTri = window._visibleSceneTriangles || sceneTriangles;
      const cs = window.chunkSystem;
      let chunkInfo = '';
      if (cs && cs.telemetry) {
        const t = cs.telemetry;
        chunkInfo = ` | Chunks: ${t.loadedChunks} (Q:${t.queueLength}, Gen:${t.lastGenDurationMs.toFixed(1)}ms, Max5s:${t.worstFrameTime5s.toFixed(1)}ms, Rad:${Math.round(t.loadRadius)}m)`;
      }
      fpsElement.textContent = `FPS: ${fps} | Calls: ${sceneCalls} | Polys: ${visTri.toLocaleString()}${chunkInfo}`;
    }
    frameCount = 0;
    lastTime = currentTime;
  }
}

requestAnimationFrame(animate);
