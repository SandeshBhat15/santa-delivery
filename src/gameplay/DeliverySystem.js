import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { soundManager } from './SoundManager.js';
import { GiftDropMarker } from './GiftDropMarker.js';
import { TargetGuidanceFlow } from './TargetGuidanceFlow.js';

export class DeliverySystem {
  constructor(scene, chunkSystem, sleighController, isMobile = false) {
    this.scene = scene;
    this.chunkSystem = chunkSystem;
    this.sleighController = sleighController;
    this.isMobile = isMobile;

    // --- Run progression -------------------------------------------------
    // A run is exactly 5 deliveries. Gift stock is deliberately limited so
    // every wasted drop matters, which is what makes accuracy meaningful.
    this.deliveriesRequired = 5;
    this.deliveriesMade = 0;
    this.attempts = 0;
    this.hits = 0;
    this.starsTotal = 6;
    this.starsCollected = 0;
    this.maxGifts = 10;
    this.giftsRemaining = this.maxGifts;

    this.totalDelivered = 0;
    this.combo = 0;
    this.deliveryScore = 0;
    this.starScore = 0;
    this.score = 0;
    this.finalScore = 0;
    this.completedChunks = new Set();

    this.runActive = false;
    this.runComplete = false;
    this.activeTarget = null;
    this.runTargets = [];
    this._nextTargetTimeout = null;
    this._finishTimeout = null;
    this._bannerTimeout = null;
    this._crashFlashTimeout = null;
    this._finishReason = null;

    // Session persistence: Map of houseId -> { chunkKey, worldPos, delivered: boolean, markerGroup }
    this.trackedHouses = new Map();

    // Active target marker (only one is ever displayed)
    this.markersGroup = new THREE.Group();
    this.markersGroup.name = 'DeliveryMarkersGroup';
    this.scene.add(this.markersGroup);
    this.giftDropMarker = new GiftDropMarker(this.markersGroup, 0.085);
    this.roofPatches = new Map();

    // Optional collectible stars placed along the route
    this.starsGroup = new THREE.Group();
    this.starsGroup.name = 'DeliveryStarsGroup';
    this.scene.add(this.starsGroup);
    this.activeStars = [];

    // Falling gifts & active delivery sparks
    this.activeGifts = [];
    this.activeSparkles = [];
    this.activeShockwaves = [];
    this.activeWorldPopups = [];

    // Next-target guidance: temporary golden particle flow arcing toward destination
    this.guidanceFlow = new TargetGuidanceFlow(this.scene, this.isMobile);

    // Current chunk tracking
    this.currentChunkKey = '0,0';
    this.currentChunkTargets = [];
    this.closestTarget = null;
    this.closestDistance = Infinity;

    // Delivery is a single, forgiving proximity check. Fly near the highlighted
    // house's golden light beam and press DROP GIFT.
    this.deliveryRange = 2.2;
    this._rangeState = null;

    // UI elements
    this._createHUD();

    // Gift geometry & materials (reused across drops)
    // Sized to match the miniature village and sleigh scale
    this.giftBoxGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.giftRibbonGeo = new THREE.BoxGeometry(0.125, 0.125, 0.03);
    this.giftColors = [
      { box: 0xe74c3c, ribbon: 0xf1c40f }, // Red & Gold
      { box: 0x27ae60, ribbon: 0xe74c3c }, // Green & Red
      { box: 0x2980b9, ribbon: 0xf39c12 }, // Blue & Gold
      { box: 0x8e44ad, ribbon: 0x2ecc71 }  // Purple & Green
    ];

    // Marker beacon visuals (textures, geometries & materials matching reference image)
    this._initMarkerTemplate();
  }

  _initMarkerTemplate() {
    // 1. Procedural High-DPI Canvas Textures (existing art direction)
    this._starGlintTexture = this._createStarGlintTexture();
    this._haloTexture = this._createHaloTexture();

    // 2. Translucent golden beacon cylinder. Anchored at the target house rooftop,
    // open-ended, slender with soft edges and gradual fading toward the sky.
    // Slender radius (base: 0.055m, top: 0.085m) and tall height (12.0m) to be
    // easily spotted from afar without overpowering or occluding the house.
    this._beamHeight = 12.0;
    this._beamGeo = new THREE.CylinderGeometry(0.085, 0.055, this._beamHeight, 18, 1, true);
    this._beamGeo.translate(0, this._beamHeight * 0.5, 0);

    // 3D 10-pointed faceted celestial diamond star geometry (pyramidal diamond faceting)
    this._starGeo = this._createFacetedStarGeometry(0.14, 0.058, 0.048);

    // Inner glowing core diamond octahedron
    this._starCoreGeo = new THREE.OctahedronGeometry(0.052, 1);

    // Radiant, self-illuminating golden star material (immune to dark night fog blackout)
    this._starMat = new THREE.MeshStandardMaterial({
      color: 0xffe680,
      emissive: 0xffa500,
      emissiveIntensity: 1.85,
      metalness: 0.85,
      roughness: 0.15,
      fog: false,
      toneMapped: false
    });

    // Brilliant diamond star core material with warm core glow
    this._starCoreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      fog: false,
      toneMapped: false
    });

    // Soft celestial golden halo flare texture (centered bloom + cross glint)
    this._starHaloTexture = this._createStarHaloTexture();
    this._starHaloMat = new THREE.SpriteMaterial({
      map: this._starHaloTexture,
      color: 0xffcc33,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.70,
      depthWrite: false,
      fog: false,
      toneMapped: false
    });

    this.deliveredMat = new THREE.MeshBasicMaterial({
      color: 0x2ecc71,
      transparent: true,
      opacity: 0.75,
      fog: false
    });
  }

  // Soft, additive translucent golden beam material with subtle glow,
  // feather-soft edges, and gradual fading toward the sky.
  // The house and scenery behind it remain clearly visible.
  _createBeamMaterial(opacity = 0.24) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xf5b82e) }, // Warm, translucent golden-yellow
        uOpacity: { value: opacity },
        uTime: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;

        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        void main() {
          // Feathered cylindrical falloff: soft edges, no harsh lines or flat silhouette.
          float facing = clamp(abs(dot(normalize(vNormalView), normalize(vViewDir))), 0.0, 1.0);
          float softEdge = pow(facing, 1.5);

          // Gradual fading toward the sky:
          // Smooth rise from roof base (no harsh cut at anchor point),
          // graceful power-curve falloff toward the top into the sky.
          float baseFade = smoothstep(0.0, 0.035, vUv.y);
          float skyFade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.75);
          float heightFade = baseFade * skyFade;

          // Gentle ambient breathing shimmer (calm glow, no harsh strobe or blinding pulse)
          float glowPulse = 0.92 + 0.08 * sin(uTime * 1.8 + vUv.y * 2.5);

          float alpha = uOpacity * softEdge * heightFade * glowPulse;

          // Pure warm golden-yellow color without a harsh white core or excessive bloom flare
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true
    });

    material.userData = { baseOpacity: opacity };
    return material;
  }

  // Generates a crisp, luminous circular neon badge enclosing a 6-arm crystal snowflake with rich gold tones
  _createSnowflakeIconTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const cx = 128, cy = 128;

    // Outer soft atmospheric glow for the circular badge
    const glowGrad = ctx.createRadialGradient(cx, cy, 70, cx, cy, 126);
    glowGrad.addColorStop(0, 'rgba(255, 179, 0, 0.35)');
    glowGrad.addColorStop(0.6, 'rgba(255, 140, 0, 0.15)');
    glowGrad.addColorStop(1, 'rgba(255, 140, 0, 0.0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, 256, 256);

    // Subtle dark-amber inner disc backing for high contrast against snow
    const backingGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 96);
    backingGrad.addColorStop(0, 'rgba(255, 200, 50, 0.18)');
    backingGrad.addColorStop(0.75, 'rgba(255, 160, 0, 0.10)');
    backingGrad.addColorStop(1, 'rgba(255, 140, 0, 0.0)');
    ctx.fillStyle = backingGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 96, 0, Math.PI * 2);
    ctx.fill();

    // Crisp neon outer circle ring
    ctx.beginPath();
    ctx.arc(cx, cy, 96, 0, Math.PI * 2);
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#ffca28';
    ctx.shadowColor = '#ff8f00';
    ctx.shadowBlur = 12;
    ctx.stroke();

    // Inner bright gold highlight stroke
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#fff8e1';
    ctx.shadowBlur = 6;
    ctx.stroke();

    // Central 6-pointed crystal snowflake
    ctx.shadowColor = '#ff8f00';
    ctx.shadowBlur = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawArm = (angle) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      // Clean bold arm stem without busy micro-branching
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -74);
      ctx.lineWidth = 6.5;
      ctx.strokeStyle = '#fff9c4';
      ctx.stroke();

      // Clean diamond star tip
      ctx.beginPath();
      ctx.moveTo(0, -78);
      ctx.lineTo(10, -66);
      ctx.lineTo(0, -54);
      ctx.lineTo(-10, -66);
      ctx.closePath();
      ctx.fillStyle = '#ffca28';
      ctx.fill();

      ctx.restore();
    };

    for (let i = 0; i < 6; i++) {
      drawArm((i * Math.PI) / 3);
    }

    // Central sparkling diamond core
    ctx.beginPath();
    ctx.moveTo(cx, cy - 13);
    ctx.lineTo(cx + 13, cy);
    ctx.lineTo(cx, cy + 13);
    ctx.lineTo(cx - 13, cy);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#ffb300';
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  // Slender vertical atmospheric light beam with subtle god-ray streaks
  _createLightBeamTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 512, 0, 0);
    grad.addColorStop(0.0, 'rgba(255, 209, 82, 0.0)');
    grad.addColorStop(0.04, 'rgba(255, 220, 110, 0.55)');
    grad.addColorStop(0.12, 'rgba(255, 209, 82, 0.65)');
    grad.addColorStop(0.35, 'rgba(255, 195, 60, 0.35)');
    grad.addColorStop(0.70, 'rgba(255, 180, 40, 0.18)');
    grad.addColorStop(1.0, 'rgba(255, 170, 30, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 512);

    ctx.globalCompositeOperation = 'overlay';
    for (let x = 0; x < 128; x += 6) {
      const rayAlpha = 0.15 + Math.sin(x * 0.4) * 0.12;
      ctx.fillStyle = `rgba(255, 255, 240, ${rayAlpha})`;
      ctx.fillRect(x, 0, 3, 512);
    }

    return new THREE.CanvasTexture(canvas);
  }

  // 4-point diamond star glint for magical sparkle motes
  _createStarGlintTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const cx = 32, cy = 32;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.2, 'rgba(255, 225, 120, 0.85)');
    grad.addColorStop(0.5, 'rgba(255, 185, 40, 0.3)');
    grad.addColorStop(1, 'rgba(255, 185, 40, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    ctx.fillStyle = '#ffffff';
    // Vertical diamond spike
    ctx.beginPath();
    ctx.moveTo(cx, 2);
    ctx.lineTo(cx + 3, cy);
    ctx.lineTo(cx, 62);
    ctx.lineTo(cx - 3, cy);
    ctx.closePath();
    ctx.fill();

    // Horizontal diamond spike
    ctx.beginPath();
    ctx.moveTo(2, cy);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(62, cy);
    ctx.lineTo(cx, cy - 3);
    ctx.closePath();
    ctx.fill();

    return new THREE.CanvasTexture(canvas);
  }

  // 3D Faceted Double-Pyramid Diamond Star Geometry (20 diamond triangular faces)
  _createFacetedStarGeometry(outerR = 0.14, innerR = 0.058, depth = 0.048) {
    const geo = new THREE.BufferGeometry();
    const vertices = [];
    const points = [];

    // 10 perimeter points alternating outer and inner radius
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      points.push(new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r));
    }

    // Front center apex: (0, 0, +depth), Back center apex: (0, 0, -depth)
    for (let i = 0; i < 10; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % 10];

      // Front diamond facet (apex to edge)
      vertices.push(0, 0, depth);
      vertices.push(p1.x, p1.y, 0);
      vertices.push(p2.x, p2.y, 0);

      // Back diamond facet (apex to edge)
      vertices.push(0, 0, -depth);
      vertices.push(p2.x, p2.y, 0);
      vertices.push(p1.x, p1.y, 0);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // Soft luminous celestial halo texture with radial core bloom & diamond flare
  _createStarHaloTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const cx = 64, cy = 64;

    // 1. Soft radial bloom
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
    grad.addColorStop(0, 'rgba(255, 255, 240, 1.0)');
    grad.addColorStop(0.20, 'rgba(255, 220, 110, 0.85)');
    grad.addColorStop(0.45, 'rgba(255, 175, 40, 0.40)');
    grad.addColorStop(0.75, 'rgba(245, 140, 10, 0.12)');
    grad.addColorStop(1, 'rgba(245, 140, 10, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    // 2. Subtle 4-point celestial glint flare
    ctx.fillStyle = 'rgba(255, 255, 245, 0.85)';
    // Vertical diamond streak
    ctx.beginPath();
    ctx.moveTo(cx, 8);
    ctx.lineTo(cx + 4, cy);
    ctx.lineTo(cx, 120);
    ctx.lineTo(cx - 4, cy);
    ctx.closePath();
    ctx.fill();

    // Horizontal diamond streak
    ctx.beginPath();
    ctx.moveTo(8, cy);
    ctx.lineTo(cx, cy + 4);
    ctx.lineTo(120, cy);
    ctx.lineTo(cx, cy - 4);
    ctx.closePath();
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  // Celestial halo glow behind the floating icon
  _createHaloTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 235, 1.0)');
    grad.addColorStop(0.35, 'rgba(255, 214, 90, 0.65)');
    grad.addColorStop(0.7, 'rgba(255, 185, 0, 0.2)');
    grad.addColorStop(1, 'rgba(255, 185, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  // Green circular checkmark badge displayed when player is in drop range (Panel 4)
  _createCheckmarkTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const cx = 64, cy = 64;

    const glowGrad = ctx.createRadialGradient(cx, cy, 40, cx, cy, 64);
    glowGrad.addColorStop(0, 'rgba(46, 204, 113, 0.6)');
    glowGrad.addColorStop(1, 'rgba(46, 204, 113, 0.0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, 128, 128);

    ctx.beginPath();
    ctx.arc(cx, cy, 48, 0, Math.PI * 2);
    ctx.fillStyle = '#2ecc71';
    ctx.shadowColor = '#27ae60';
    ctx.shadowBlur = 10;
    ctx.fill();

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(38, 64);
    ctx.lineTo(54, 82);
    ctx.lineTo(90, 44);
    ctx.lineWidth = 11;
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    return new THREE.CanvasTexture(canvas);
  }

  _createHUD() {
    const container = document.getElementById('ui-container');
    if (!container) return;

    const hud = document.createElement('div');
    hud.id = 'santa-hud';
    hud.innerHTML = `
      <div class="hud-card hud-top-left hud-run-card">
        <div class="hud-row">
          <span class="hud-icon">🎁</span>
          <span class="hud-label">DELIVERIES</span>
          <span id="hud-deliveries" class="hud-value">0 / 5</span>
        </div>
        <div id="hud-progress-track" class="hud-progress-track" aria-hidden="true">
          <span class="progress-pip"></span>
          <span class="progress-pip"></span>
          <span class="progress-pip"></span>
          <span class="progress-pip"></span>
          <span class="progress-pip"></span>
        </div>
        <div class="hud-row">
          <span class="hud-icon">⭐</span>
          <span class="hud-label">STARS</span>
          <span id="hud-stars" class="hud-value">0 / 6</span>
        </div>
        <div class="hud-row">
          <span class="hud-icon">💎</span>
          <span class="hud-label">SCORE</span>
          <span id="hud-score" class="hud-value">0</span>
        </div>
        <div class="hud-row">
          <span class="hud-icon">🎯</span>
          <span class="hud-label">ACCURACY</span>
          <span id="hud-accuracy" class="hud-value">--</span>
        </div>
        <div class="hud-row hud-gift-stock">
          <span class="hud-icon">🛷</span>
          <span class="hud-label">GIFTS</span>
          <span id="hud-gifts-count" class="hud-value">10</span>
        </div>
      </div>

      <div id="hud-banner" class="hud-banner hidden">
        <span id="hud-banner-text">GIFT DELIVERED!</span>
      </div>

      <div id="mobile-controls-wrapper">
        <!-- Bottom-Left: Floating Virtual Flight Joystick (X: Turn/Roll, Y: Altitude/Climb/Dive) -->
        <div id="joystick-zone">
          <div id="joystick-base">
            <div id="joystick-thumb"></div>
          </div>
          <div class="control-label">FLIGHT</div>
        </div>

        <!-- Bottom-Right: Clearly labeled guide and drop actions -->
        <div id="drop-zone">
          <button id="btn-guide-wind" class="btn-guide-small" type="button" title="Summon Guiding Wind (G)">
            <span class="guide-icon">🌬️</span>
            <span class="guide-label">GUIDE</span>
            <span class="guide-key" aria-hidden="true">G</span>
          </button>
          <div id="drop-status" class="drop-status far" aria-live="polite">GET CLOSER</div>
          <button id="btn-drop-gift" class="btn-drop-large" type="button">
            <span class="drop-icon">🎁</span>
            <span class="drop-label">DROP GIFT</span>
            <span class="drop-key" aria-hidden="true">E</span>
          </button>
        </div>
      </div>

      <div id="crash-flash" class="crash-flash" aria-hidden="true"></div>

      <!-- End-of-run results screen -->
      <div id="results-overlay" class="results-overlay hidden">
        <div class="results-card">
          <div class="results-glow" aria-hidden="true"></div>
          <span class="results-kicker">SANTA'S SLEIGH RUN</span>
          <h2 id="results-title">DELIVERIES COMPLETE!</h2>
          <p id="results-subtitle">The village is warm and bright.</p>
          <div id="results-rating" class="results-rating" aria-label="Run rating">★★★</div>
          <div class="results-grid">
            <div class="result-stat">
              <span>DELIVERIES</span>
              <strong id="results-deliveries">0 / 5</strong>
            </div>
            <div class="result-stat">
              <span>ACCURACY</span>
              <strong id="results-accuracy">--</strong>
            </div>
            <div class="result-stat">
              <span>STARS</span>
              <strong id="results-stars">0 / 6</strong>
            </div>
            <div class="result-stat result-stat-score">
              <span>FINAL SCORE</span>
              <strong id="results-score">0</strong>
            </div>
          </div>
          <button id="btn-replay" class="btn-replay">🎄 FLY AGAIN</button>
        </div>
      </div>
    `;

    container.appendChild(hud);
    this.hudElement = hud;
    this._progressPips = Array.from(hud.querySelectorAll('.progress-pip'));

    this._setupVirtualJoystick();
    this._setupDropButton();
    this._setupGuideWind();

    const replayBtn = document.getElementById('btn-replay');
    if (replayBtn) {
      replayBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.startRun(true);
      });
    }
  }

  _setupVirtualJoystick() {
    const base = document.getElementById('joystick-base');
    const thumb = document.getElementById('joystick-thumb');
    if (!base || !thumb || !this.sleighController) return;

    let activePointerId = null;
    let baseRect = null;
    const maxRadius = 42; // Max pixel deflection from center

    const updateStick = (clientX, clientY) => {
      if (!baseRect) baseRect = base.getBoundingClientRect();
      const centerX = baseRect.left + baseRect.width / 2;
      const centerY = baseRect.top + baseRect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.hypot(dx, dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

      // Normalized input [-1..1]
      const normX = dx / maxRadius;
      const normY = dy / maxRadius;
      this.sleighController.setJoystickInput(normX, normY);
    };

    const resetStick = () => {
      activePointerId = null;
      baseRect = null;
      thumb.style.transform = 'translate(-50%, -50%)';
      this.sleighController.setJoystickInput(0, 0);
    };

    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activePointerId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      baseRect = base.getBoundingClientRect();
      updateStick(e.clientX, e.clientY);
    }, { passive: false });

    base.addEventListener('pointermove', (e) => {
      if (activePointerId === e.pointerId) {
        e.preventDefault();
        e.stopPropagation();
        updateStick(e.clientX, e.clientY);
      }
    }, { passive: false });

    const handlePointerEnd = (e) => {
      if (activePointerId === e.pointerId) {
        e.preventDefault();
        e.stopPropagation();
        try {
          base.releasePointerCapture(e.pointerId);
        } catch (_) {}
        resetStick();
      }
    };

    base.addEventListener('pointerup', handlePointerEnd);
    base.addEventListener('pointercancel', handlePointerEnd);
  }

  _setupAltitudeControl() {
    const track = document.getElementById('altitude-track');
    const knob = document.getElementById('altitude-knob');
    if (!track || !knob || !this.sleighController) return;

    let activePointerId = null;
    let trackRect = null;
    const maxTravel = 48; // Max upward/downward pixel travel from center

    const updateAltitude = (clientY) => {
      if (!trackRect) trackRect = track.getBoundingClientRect();
      const centerY = trackRect.top + trackRect.height / 2;

      let dy = clientY - centerY;
      if (dy > maxTravel) dy = maxTravel;
      if (dy < -maxTravel) dy = -maxTravel;

      knob.style.transform = `translate(-50%, calc(-50% + ${dy}px))`;

      // Inverted Y: pulling UP (negative dy) is climb (+1), pulling DOWN (positive dy) is dive (-1)
      const normAlt = -dy / maxTravel;
      this.sleighController.setVerticalInput(normAlt);
    };

    const resetAltitude = () => {
      activePointerId = null;
      trackRect = null;
      knob.style.transform = 'translate(-50%, -50%)';
      this.sleighController.setVerticalInput(0.0);
    };

    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activePointerId = e.pointerId;
      track.setPointerCapture(e.pointerId);
      trackRect = track.getBoundingClientRect();
      updateAltitude(e.clientY);
    }, { passive: false });

    track.addEventListener('pointermove', (e) => {
      if (activePointerId === e.pointerId) {
        e.preventDefault();
        e.stopPropagation();
        updateAltitude(e.clientY);
      }
    }, { passive: false });

    const handlePointerEnd = (e) => {
      if (activePointerId === e.pointerId) {
        e.preventDefault();
        e.stopPropagation();
        try {
          track.releasePointerCapture(e.pointerId);
        } catch (_) {}
        resetAltitude();
      }
    };

    track.addEventListener('pointerup', handlePointerEnd);
    track.addEventListener('pointercancel', handlePointerEnd);
  }

  _setupDropButton() {
    const dropBtn = document.getElementById('btn-drop-gift');
    if (!dropBtn) return;

    let lastTrigger = 0;
    const trigger = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // pointerdown gives instant feedback on touch; click covers keyboard
      // activation. The guard keeps a single press from dropping two gifts.
      const now = performance.now();
      if (now - lastTrigger < 250) return;
      lastTrigger = now;
      this.triggerDelivery();
    };

    dropBtn.addEventListener('pointerdown', trigger);
    dropBtn.addEventListener('click', trigger);
  }

  _setupGuideWind() {
    const guideBtn = document.getElementById('btn-guide-wind');
    const triggerWind = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.summonGuidingWind();
    };

    if (guideBtn) {
      guideBtn.addEventListener('pointerdown', triggerWind);
      guideBtn.addEventListener('click', triggerWind);
    }

    // Keyboard 'G' summons the Ghost of Tsushima guiding wind
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && !e.repeat) {
        triggerWind();
      }
    });
  }

  summonGuidingWind() {
    if (!this.runActive || this.runComplete || !this.activeTarget || !this.guidanceFlow) return;
    this.guidanceFlow.summonWind();
    this.showBanner('🌬️ GUIDING WIND SUMMONED', 'info');
  }

  showBanner(message, type = 'success') {
    const banner = document.getElementById('hud-banner');
    const textEl = document.getElementById('hud-banner-text');
    if (!banner || !textEl) return;

    textEl.textContent = message;
    banner.className = `hud-banner show ${type}`;

    clearTimeout(this._bannerTimeout);
    this._bannerTimeout = setTimeout(() => {
      banner.className = 'hud-banner hidden';
    }, 2400);
  }


  _getRoofPatchesForDef(def) {
    if (this.roofPatches.has(def.name)) {
      return this.roofPatches.get(def.name);
    }
    const geo = def.instMesh?.geometry;
    if (!geo || !geo.attributes.position) return { left: [], right: [] };

    const pos = geo.attributes.position;
    const idx = geo.index;
    const count = idx ? idx.count / 3 : pos.count / 3;
    const bbox = geo.boundingBox || new THREE.Box3().setFromBufferAttribute(pos);
    const maxY = bbox.max.y;
    const minY = bbox.min.y;

    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    const leftPatches = [];
    const rightPatches = [];

    for (let i = 0; i < count; i++) {
      const i0 = idx ? idx.getX(i * 3) : i * 3;
      const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
      vA.fromBufferAttribute(pos, i0);
      vB.fromBufferAttribute(pos, i1);
      vC.fromBufferAttribute(pos, i2);

      e1.subVectors(vB, vA);
      e2.subVectors(vC, vA);
      fn.crossVectors(e1, e2).normalize();

      const centerY = (vA.y + vB.y + vC.y) / 3;
      const hRel = (centerY - minY) / (maxY - minY || 1);
      const dotUp = fn.dot(up);

      // Usable sloped roof area: between 45% and 88% of house height, avoiding vertical walls & chimney peak
      if (hRel >= 0.45 && hRel <= 0.88 && dotUp >= 0.30 && dotUp <= 0.95) {
        const cx = (vA.x + vB.x + vC.x) / 3;
        const cz = (vA.z + vB.z + vC.z) / 3;
        // Keep margin away from extreme outer eaves
        if (Math.abs(cx) < 0.082 && Math.abs(cz) < 0.082) {
          const pt = {
            pos: new THREE.Vector3(cx, centerY, cz),
            normal: fn.clone()
          };
          if (fn.x < -0.05) leftPatches.push(pt);
          else if (fn.x > 0.05) rightPatches.push(pt);
        }
      }
    }

    const result = { left: leftPatches, right: rightPatches };
    this.roofPatches.set(def.name, result);
    return result;
  }

  _sampleRandomRooftopPoint(houseData) {
    if (!this.chunkSystem) return { pos: houseData.worldPos.clone(), rot: new THREE.Quaternion() };

    // Align precisely with the house instance's position, rotation and roof ridge
    if (houseData.def && houseData.baseMatrix) {
      const geo = houseData.def.instMesh?.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();

      const chunkSize = this.chunkSystem.chunkSize || 20.0;
      const [cx, cz] = (houseData.chunkKey || '0,0').split(',').map(Number);
      const chunkOffset = new THREE.Vector3(cx * chunkSize, 0, cz * chunkSize);

      const hPos = new THREE.Vector3();
      const hRot = new THREE.Quaternion();
      const hScale = new THREE.Vector3();
      houseData.baseMatrix.decompose(hPos, hRot, hScale);

      // Model's rooftop ridge peak in local coordinates (centered along X=0, peak at top of bounding box)
      // Lift slightly (+0.022m) so the ring never clips or z-fights with the roof geometry
      const topY = geo.boundingBox.max.y + 0.022;
      
      // Subtle longitudinal slide along the house roof ridge (local Z axis) avoiding chimney / outer edges
      const zOffset = (Math.random() - 0.5) * 0.045;
      const localRidgePoint = new THREE.Vector3(0.0, topY, zOffset);
      localRidgePoint.multiply(hScale);
      localRidgePoint.applyQuaternion(hRot);

      const worldSpot = hPos.clone().add(chunkOffset).add(localRidgePoint);
      return { pos: worldSpot, rot: hRot.clone() };
    }

    const fallback = houseData.worldPos.clone();
    return { pos: fallback, rot: new THREE.Quaternion() };
  }

  syncChunkTargets(chunkKey, cx, cz) {
    if (!this.chunkSystem || !this.chunkSystem.meshDefinitions) return;

    const chunkSize = this.chunkSystem.chunkSize || 20.0;
    const chunkOrigin = new THREE.Vector3(cx * chunkSize, 0, cz * chunkSize);
    const houseDefs = this.chunkSystem.meshDefinitions.filter(d => d.category === 'house');
    if (houseDefs.length === 0) return;

    // Collect all real houses in this chunk
    const allHouses = [];
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();

    for (let defIdx = 0; defIdx < houseDefs.length; defIdx++) {
      const def = houseDefs[defIdx];
      const geo = def.instMesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const topLocalY = geo.boundingBox.max.y;

      for (let b = 0; b < def.baseMatrices.length; b++) {
        const baseM = def.baseMatrices[b];
        baseM.decompose(v, q, s);

        const worldRoof = new THREE.Vector3(v.x, v.y + topLocalY * s.y, v.z).add(chunkOrigin);
        allHouses.push({
          def,
          defName: def.name,
          baseIndex: b,
          baseMatrix: baseM,
          worldPos: worldRoof
        });
      }
    }

    // Select 4-5 well-spaced houses per chunk for delivery targets
    allHouses.sort((a, b) =>
      Math.hypot(a.worldPos.x - chunkOrigin.x, a.worldPos.z - chunkOrigin.z) -
      Math.hypot(b.worldPos.x - chunkOrigin.x, b.worldPos.z - chunkOrigin.z)
    );

    const step = Math.max(1, Math.floor(allHouses.length / 5));
    for (let i = 0; i < 5 && i * step < allHouses.length; i++) {
      const h = allHouses[i * step];
      const houseId = `chunk_${chunkKey}_house_${i}`;
      let houseData = this.trackedHouses.get(houseId);
      if (!houseData) {
        houseData = {
          houseId,
          chunkKey,
          def: h.def,
          baseMatrix: h.baseMatrix,
          worldPos: h.worldPos.clone(),
          delivered: false,
          marker: null
        };
        this.trackedHouses.set(houseId, houseData);
      } else {
        houseData.def = h.def;
        houseData.baseMatrix = h.baseMatrix;
        houseData.worldPos.copy(h.worldPos);
      }
    }

    this._updateVisualMarkers();
  }

  // Clean up visual markers when a chunk unloads while preserving delivery progress
  unloadChunkTargets(chunkKey) {
    this.trackedHouses.forEach((houseData) => {
      // Keep the active target's beacon alive even if its chunk streams out, so
      // the player can always find their way back to the highlighted chimney.
      if (this.activeTarget && houseData.houseId === this.activeTarget.houseId) return;
      if (houseData.chunkKey === chunkKey && houseData.marker) {
        this.markersGroup.remove(houseData.marker);
        houseData.marker = null;
      }
    });
  }

  _updateVisualMarkers() {
    const desired = this.activeTarget;

    // Exactly one marker lives in the scene at a time.
    this.trackedHouses.forEach((houseData) => {
      if (houseData.marker && houseData !== desired && !houseData.marker.userData?.isFading) {
        this.markersGroup.remove(houseData.marker);
        houseData.marker = null;
      }
    });

    if (desired && !desired.delivered && !desired.marker) {
      const marker = this._createTargetMarker(desired);
      desired.marker = marker;
      this.markersGroup.add(marker);
    }
  }

  _createTargetMarker(houseData) {
    const worldPos = houseData.worldPos;
    const marker = new THREE.Group();
    marker.position.copy(worldPos);
    marker.name = `Marker_${houseData.houseId}`;

    // Translucent golden light beam anchored vertically on the target house roof.
    // The cylinder geometry's base sits at local y=0, so it begins precisely at worldPos.
    const beamMat = this._createBeamMaterial(0.24);
    const beamMesh = new THREE.Mesh(this._beamGeo, beamMat);
    beamMesh.renderOrder = 1;
    marker.add(beamMesh);

    marker.userData = {
      houseData,
      basePos: worldPos.clone(),
      beamMesh,
      beamMat,
      inRange: false,
      isFading: false,
      fadeProgress: 0.0
    };

    return marker;
  }

  _isInDeliveryRange(pos) {
    const target = this.activeTarget;
    if (!target || target.delivered) return false;
    const dx = pos.x - target.worldPos.x;
    const dy = pos.y - target.worldPos.y;
    const dz = pos.z - target.worldPos.z;
    return dx * dx + dy * dy + dz * dz <= this.deliveryRange * this.deliveryRange;
  }

  triggerDelivery() {
    if (!this.runActive || this.runComplete) return;

    if (!this.activeTarget) {
      this.showBanner('WAIT FOR THE NEXT TARGET', 'miss');
      return;
    }

    if (this.giftsRemaining <= 0) {
      this.showBanner(this.activeGifts.length > 0 ? 'GIFT IN FLIGHT...' : 'OUT OF GIFTS!', 'miss');
      soundManager.playMiss();
      return;
    }

    // Consume 1 gift and record the attempt. Accuracy is hits / attempts, so a
    // panicked extra drop genuinely costs the player something.
    this.giftsRemaining--;
    this.attempts++;

    // Spawn falling gift from sleigh
    const startPos = this.sleighController.getDropOrigin();
    const giftColorPair = this.giftColors[Math.floor(Math.random() * this.giftColors.length)];

    const giftGroup = new THREE.Group();
    giftGroup.position.copy(startPos);

    const boxMat = new THREE.MeshStandardMaterial({
      color: giftColorPair.box,
      roughness: 0.35,
      metalness: 0.1
    });
    const ribbonMat = new THREE.MeshStandardMaterial({
      color: giftColorPair.ribbon,
      roughness: 0.2,
      metalness: 0.5
    });

    const box = new THREE.Mesh(this.giftBoxGeo, boxMat);
    box.castShadow = true;
    giftGroup.add(box);

    const ribbon1 = new THREE.Mesh(this.giftRibbonGeo, ribbonMat);
    giftGroup.add(ribbon1);
    const ribbon2 = new THREE.Mesh(this.giftRibbonGeo, ribbonMat);
    ribbon2.rotation.y = Math.PI / 2;
    giftGroup.add(ribbon2);

    this.scene.add(giftGroup);
    soundManager.playDrop();

    // Only the currently highlighted target can be scored. Range is the same
    // simple proximity check the HUD uses, so READY TO DROP always means the
    // next press will land.
    const target = this.activeTarget;
    const rangePos = this.sleighController.position;
    const inRange = this._isInDeliveryRange(rangePos);

    // Closer drops score slightly better, but any in-range drop delivers.
    let precision = 0;
    if (inRange) {
      const dist = rangePos.distanceTo(target.worldPos);
      precision = Math.max(0, Math.min(1, 1 - dist / this.deliveryRange));
    }

    let targetPos;
    if (inRange) {
      targetPos = target.worldPos.clone();
    } else {
      const groundY = this.chunkSystem?.getHeight
        ? this.chunkSystem.getHeight(startPos.x, startPos.z)
        : 0.5;
      targetPos = new THREE.Vector3(startPos.x, groundY + 0.05, startPos.z);
    }

    if (!inRange) {
      this.showBanner('GET CLOSER TO THE TARGET!', 'miss');
    }

    this.activeGifts.push({
      mesh: giftGroup,
      startPos: startPos.clone(),
      targetHouse: inRange ? target : null,
      isSuccess: inRange,
      precision,
      targetPos,
      progress: 0.0,
      dropSpeed: 1.6, // Drop trajectory speed
      rotVel: new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 6
      )
    });

    this._updateHUD();
  }

  refillGifts() {
    if (this.runActive) {
      this.showBanner('GIFT STOCK IS LIMITED THIS RUN!', 'miss');
      return;
    }
    this.giftsRemaining = this.maxGifts;
    this._updateHUDGifts();
    this.showBanner('GIFTS REFILLED! 🎁✨', 'success');
    soundManager.playRefill();
  }

  _updateHUDGifts() {
    const el = document.getElementById('hud-gifts-count');
    if (el) el.textContent = this.giftsRemaining;

    const btn = document.getElementById('btn-drop-gift');
    if (btn) {
      const runnable = this.runActive && !this.runComplete && this.giftsRemaining > 0;
      btn.classList.remove('out-of-gifts');
      btn.classList.toggle('disabled', !runnable);
      btn.disabled = this.runComplete;

      const label = btn.querySelector('.drop-label');
      if (label) {
        label.textContent = this.giftsRemaining > 0 ? 'DROP GIFT' : 'NO GIFTS';
      }
    }
  }

  update(delta, elapsedTime) {
    if (delta <= 0) return;

    // 0. Update target compass and active target selection first
    this._updateTargetCompass();

    const sleighPos = this.sleighController.position;
    const camera = this.sleighController?.camera;

    // 1. Animate active upright GiftDropMarker
    if (this.giftDropMarker && this.activeTarget) {
      const camDist = camera ? camera.position.distanceTo(this.activeTarget.worldPos) : 15.0;
      const inRange = this._isInDeliveryRange(sleighPos);
      this.giftDropMarker.setState(inRange ? 'inrange' : 'default');
      this.giftDropMarker.update(delta, elapsedTime, camDist);
    }
    // 2. Animate falling gifts with golden sparkle trailing motes
    for (let i = this.activeGifts.length - 1; i >= 0; i--) {
      const gift = this.activeGifts[i];
      gift.progress += gift.dropSpeed * delta;

      if (Math.random() < 0.75) {
        this._spawnTrailSparkle(gift.mesh.position);
      }

      if (gift.progress >= 1.0) {
        // Impact
        this.scene.remove(gift.mesh);
        this.activeGifts.splice(i, 1);

        if (gift.isSuccess && gift.targetHouse && !gift.targetHouse.delivered) {
          this._handleSuccessfulDelivery(gift.targetHouse, gift.precision || 0);
        } else {
          this._handleMissedDelivery(gift.targetPos);
        }

        // Running out of gifts ends the run once every thrown gift has landed
        if (this.giftsRemaining <= 0 &&
            this.activeGifts.length === 0 &&
            this.deliveriesMade < this.deliveriesRequired &&
            !this.runComplete) {
          this._finishRun(false);
        }
      } else {
        const t = gift.progress;
        gift.mesh.position.lerpVectors(gift.startPos, gift.targetPos, t);
        // Parabolic gravity arc
        const arc = Math.sin(t * Math.PI) * (gift.isSuccess ? 1.2 : 0.7);
        gift.mesh.position.y += arc;

        gift.mesh.rotation.x += gift.rotVel.x * delta;
        gift.mesh.rotation.y += gift.rotVel.y * delta;
        gift.mesh.rotation.z += gift.rotVel.z * delta;
      }
    }

    // 3. Spin, bob and collect the optional route stars
    this._updateStars(delta, elapsedTime);

    // 4. Update next-target guidance particle flow (Ghost of Tsushima guiding wind)
    if (this.guidanceFlow) {
      const forward = new THREE.Vector3(
        -Math.sin(this.sleighController.rotationY || 0),
        0,
        -Math.cos(this.sleighController.rotationY || 0)
      );
      this.guidanceFlow.update(delta, sleighPos, forward);
    }

    // 5. Update sparkle particle effects
    for (let i = this.activeSparkles.length - 1; i >= 0; i--) {
      const sp = this.activeSparkles[i];
      sp.age += delta;
      if (sp.age >= sp.maxAge) {
        this.scene.remove(sp.mesh);
        if (sp.mesh.geometry) sp.mesh.geometry.dispose();
        if (sp.mesh.material) sp.mesh.material.dispose();
        this.activeSparkles.splice(i, 1);
      } else {
        const t = sp.age / sp.maxAge;
        const posAttr = sp.mesh.geometry.attributes.position;
        const applyCurve = sp.curved && sp.curveTargetDir;
        for (let j = 0; j < sp.velocities.length; j++) {
          const vel = sp.velocities[j];
          if (applyCurve) {
            // Smoothly steer velocity from initial direction toward target direction
            const steerRate = 2.4 * delta;
            vel.x += (sp.curveTargetDir.x * vel.targetSpeed - vel.x) * steerRate;
            vel.y += (sp.curveTargetDir.y * vel.targetSpeed - vel.y) * steerRate;
            vel.z += (sp.curveTargetDir.z * vel.targetSpeed - vel.z) * steerRate;
            // Slight natural airy drag
            vel.x *= (1.0 - 0.25 * delta);
            vel.y *= (1.0 - 0.25 * delta);
            vel.z *= (1.0 - 0.25 * delta);
          }
          posAttr.setX(j, posAttr.getX(j) + vel.x * delta);
          posAttr.setY(j, posAttr.getY(j) + vel.y * delta);
          posAttr.setZ(j, posAttr.getZ(j) + vel.z * delta);
        }
        posAttr.needsUpdate = true;
        // Non-linear smooth fade-in and graceful fade-out
        if (sp.curved) {
          const fadeIn = Math.min(1.0, sp.age / 0.25);
          const fadeOut = Math.max(0.0, 1.0 - Math.pow(t, 1.6));
          sp.mesh.material.opacity = (sp.baseOpacity || 0.95) * fadeIn * fadeOut;
        } else {
          sp.mesh.material.opacity = (1.0 - t);
        }
      }
    }

    // 6. Update expanding shockwave rings
    for (let i = this.activeShockwaves.length - 1; i >= 0; i--) {
      const sw = this.activeShockwaves[i];
      sw.age += delta;
      if (sw.age >= sw.maxAge) {
        this.scene.remove(sw.mesh);
        if (sw.mesh.geometry) sw.mesh.geometry.dispose();
        if (sw.mesh.material) sw.mesh.material.dispose();
        this.activeShockwaves.splice(i, 1);
      } else {
        const progress = sw.age / sw.maxAge;
        // Fast expansion with slight deceleration
        const easeScale = 1.0 - Math.pow(1.0 - progress, 2.5);
        const currentRadius = sw.startRadius + (sw.endRadius - sw.startRadius) * easeScale;
        sw.mesh.scale.set(currentRadius, currentRadius, currentRadius);
        // Smooth non-linear fade
        const fade = Math.pow(1.0 - progress, 1.8);
        sw.mesh.material.opacity = (sw.baseOpacity || 0.85) * fade;
      }
    }

    // 7. Update floating world-space popups (+50 score)
    for (let i = this.activeWorldPopups.length - 1; i >= 0; i--) {
      const wp = this.activeWorldPopups[i];
      wp.age += delta;
      if (wp.age >= wp.maxAge) {
        this.scene.remove(wp.sprite);
        if (wp.sprite.material) {
          if (wp.sprite.material.map) wp.sprite.material.map.dispose();
          wp.sprite.material.dispose();
        }
        this.activeWorldPopups.splice(i, 1);
      } else {
        const progress = wp.age / wp.maxAge;
        // Float upward
        wp.sprite.position.y = wp.startY + progress * 0.75;
        // Scale elastic bounce in first 20%, then gentle drift
        let scale = wp.baseScale;
        if (progress < 0.22) {
          const popT = progress / 0.22;
          scale = wp.baseScale * (0.4 + 0.8 * Math.sin(popT * Math.PI * 0.5));
        } else {
          scale = wp.baseScale * (1.2 - 0.2 * ((progress - 0.22) / 0.78));
        }
        wp.sprite.scale.set(scale, scale * 0.5, 1.0);
        // Smooth fade out towards end
        const alpha = progress < 0.7 ? 1.0 : 1.0 - ((progress - 0.7) / 0.3);
        wp.sprite.material.opacity = alpha;
      }
    }
  }

  // Trailing golden 4-point diamond star particles emitted behind falling gifts (Panel 5)
  _spawnTrailSparkle(worldPos) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([
      worldPos.x + (Math.random() - 0.5) * 0.08,
      worldPos.y + (Math.random() - 0.5) * 0.08,
      worldPos.z + (Math.random() - 0.5) * 0.08
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      map: this._starGlintTexture,
      color: 0xffea78,
      size: this.isMobile ? 0.06 : 0.08,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });

    const mesh = new THREE.Points(geo, mat);
    this.scene.add(mesh);

    this.activeSparkles.push({
      mesh,
      velocities: [{
        x: (Math.random() - 0.5) * 0.2,
        y: 0.1 + Math.random() * 0.25,
        z: (Math.random() - 0.5) * 0.2
      }],
      age: 0.0,
      maxAge: 0.5
    });
  }

  _handleSuccessfulDelivery(houseData, precision = 0) {
    houseData.delivered = true;
    this.deliveriesMade++;
    this.hits++;
    this.totalDelivered++;
    this.combo++;

    // Accuracy-based scoring: base + centered-drop precision + perfect bonus.
    const basePoints = 100;
    const precisionPoints = Math.round(Math.max(0, Math.min(1, precision)) * 100);
    const perfect = precision >= 0.85;
    const perfectBonus = perfect ? 50 : 0;
    const points = basePoints + precisionPoints + perfectBonus;
    this.deliveryScore += points;
    this.score = this.deliveryScore + this.starScore;

    // Smooth fade-out of the delivered marker
    if (houseData.marker && houseData.marker.userData) {
      houseData.marker.userData.isFading = true;
    }

    // Look up the next target if available to subtly bias chimney burst drift and launch particle flow
    let nextTarget = null;
    if (this.deliveriesMade < this.deliveriesRequired) {
      nextTarget = this.runTargets[this.deliveriesMade];
      if (!nextTarget || nextTarget.delivered) {
        nextTarget = this.runTargets.find((t) => !t.delivered && t.houseId !== houseData.houseId) || null;
      }
    }

    // Brief celebration: one sparkle burst (with gentle drift toward next target) and success chime.
    this._spawnSparkleBurst(houseData.worldPos, nextTarget ? nextTarget.worldPos : null);
    soundManager.playSuccess();
    if (this.giftDropMarker) this.giftDropMarker.burst();

    // Trigger golden guiding wind stream from Santa toward the next rooftop marker
    if (nextTarget && this.sleighController && this.guidanceFlow) {
      const sleighPos = this.sleighController.position;
      const forward = new THREE.Vector3(
        -Math.sin(this.sleighController.rotationY || 0),
        0,
        -Math.cos(this.sleighController.rotationY || 0)
      );
      this.guidanceFlow.setTarget(sleighPos, forward, nextTarget.worldPos);
    }

    this.showBanner(
      `GIFT DELIVERED! +${points} PTS • ${this.deliveriesMade}/${this.deliveriesRequired}`,
      'success'
    );

    this.activeTarget = null;
    this.closestTarget = null;
    this._updateHUD();

    clearTimeout(this._nextTargetTimeout);
    clearTimeout(this._finishTimeout);
    // Don't clear guidance flow here so the wind continues guiding the player during the transition to the next target

    if (this.deliveriesMade >= this.deliveriesRequired) {
      this._finishTimeout = setTimeout(() => this._finishRun(true), 1100);
    } else {
      this._nextTargetTimeout = setTimeout(() => this._setNextTarget(), 900);
    }
  }

  _handleMissedDelivery(missPos) {
    this.combo = 0;
    this._spawnPuffCloud(missPos);
    soundManager.playMiss();

    const acc = this._getAccuracy();
    const accText = this.attempts > 0 ? ` • ${Math.round(acc * 100)}% ACC` : '';
    this.showBanner(`MISSED THE CHIMNEY!${accText}`, 'miss');
    this._updateHUD();
  }

  // ---------------------------------------------------------------------------
  // Run lifecycle
  // ---------------------------------------------------------------------------

  startRun(resetFlight = true) {
    clearTimeout(this._nextTargetTimeout);
    clearTimeout(this._finishTimeout);
    if (this.guidanceFlow) {
      this.guidanceFlow.clear();
    }
    clearTimeout(this._bannerTimeout);
    this._nextTargetTimeout = null;
    this._finishTimeout = null;

    this._hideResults();

    // Clear any gifts / particles left over from the previous run
    this.activeGifts.forEach((gift) => this.scene.remove(gift.mesh));
    this.activeGifts.length = 0;
    this.activeSparkles.forEach((sp) => this.scene.remove(sp.mesh));
    this.activeSparkles.length = 0;
    this.activeShockwaves.forEach((sw) => {
      this.scene.remove(sw.mesh);
      if (sw.mesh.geometry) sw.mesh.geometry.dispose();
      if (sw.mesh.material) sw.mesh.material.dispose();
    });
    this.activeShockwaves.length = 0;
    this.activeWorldPopups.forEach((wp) => {
      this.scene.remove(wp.sprite);
      if (wp.sprite.material) {
        if (wp.sprite.material.map) wp.sprite.material.map.dispose();
        wp.sprite.material.dispose();
      }
    });
    this.activeWorldPopups.length = 0;
    if (this.guidanceFlow) {
      this.guidanceFlow.clear();
    }

    // Reset every registered house and remove all markers
    this.trackedHouses.forEach((houseData) => {
      houseData.delivered = false;
      if (houseData.marker) {
        this.markersGroup.remove(houseData.marker);
        houseData.marker = null;
      }
    });
    this.markersGroup.clear();

    this._clearStars();

    // Reset run state
    this.deliveriesMade = 0;
    this.attempts = 0;
    this.hits = 0;
    this.starsCollected = 0;
    this.giftsRemaining = this.maxGifts;
    this.deliveryScore = 0;
    this.starScore = 0;
    this.score = 0;
    this.finalScore = 0;
    this.combo = 0;
    this.totalDelivered = 0;
    this.runActive = true;
    this.runComplete = false;
    this.activeTarget = null;
    this.runTargets = [];
    this.closestTarget = null;
    this.closestDistance = Infinity;
    this.currentChunkKey = '0,0';
    this._rangeState = null;

    if (resetFlight && this.sleighController?.resetFlight) {
      this.sleighController.resetFlight();
    }
    if (this.sleighController) {
      this.sleighController.isPaused = false;
      if (this.sleighController.inputs) {
        Object.keys(this.sleighController.inputs).forEach((key) => {
          this.sleighController.inputs[key] = false;
        });
      }
    }
    this.sleighController?.armHouseCollisionDetection?.(1600);

    if (this.hudElement) this.hudElement.classList.remove('run-ended');

    // Register every currently streamed house, lock a 5-stop route, and place
    // three optional stars along the path between those stops.
    this._seedLoadedChunks();
    this._selectRunTargets();
    this._spawnRouteStars();
    this._activateTarget(this.runTargets[0] || null);
    this._updateHUD();

    this.showBanner('FOLLOW THE GOLDEN BEAM!', 'success');
  }

  _seedLoadedChunks() {
    if (!this.chunkSystem?.chunks) return;
    this.chunkSystem.chunks.forEach((_chunkData, key) => {
      const [cx, cz] = key.split(',').map(Number);
      this.syncChunkTargets(key, cx, cz);
    });
  }

  _selectRunTargets() {
    const origin = this.sleighController.position;
    const all = Array.from(this.trackedHouses.values()).filter((h) => !h.delivered);
    if (all.length === 0) {
      this.runTargets = [];
      return;
    }

    // Balanced random rooftop selection across loaded chunks with enjoyable flight separation
    // distance (7.5m - 12.5m) so Santa naturally glides between village rooftops in ~4-6 seconds.
    const route = [];
    const usedIds = new Set();
    let cursor = origin;
    const minDistance = 7.5;  // Comfortable separation in meters
    const maxDistance = 14.0; // Avoid excessively distant outliers

    while (route.length < this.deliveriesRequired) {
      // Find all unused houses within the ideal distance band (7.5m - 14.0m)
      let candidates = all.filter((h) => {
        if (usedIds.has(h.houseId)) return false;
        const d = Math.hypot(h.worldPos.x - cursor.x, h.worldPos.z - cursor.z);
        return d >= minDistance && d <= maxDistance;
      });

      // If strict distance band yields no candidates, accept any house at least minDistance away
      if (candidates.length === 0) {
        candidates = all.filter((h) => {
          if (usedIds.has(h.houseId)) return false;
          const d = Math.hypot(h.worldPos.x - cursor.x, h.worldPos.z - cursor.z);
          return d >= minDistance;
        });
      }

      // If still empty, accept any unused house
      if (candidates.length === 0) {
        candidates = all.filter((h) => !usedIds.has(h.houseId));
      }

      // If all houses have been used, break
      if (candidates.length === 0) break;

      // Pick randomly from the eligible candidates
      const randomIndex = Math.floor(Math.random() * candidates.length);
      const picked = candidates[randomIndex];

      usedIds.add(picked.houseId);
      route.push(picked);
      cursor = picked.worldPos;
    }

    this.runTargets = route.slice(0, this.deliveriesRequired);
  }

  _setNextTarget() {
    if (!this.runActive || this.runComplete) return;

    let next = this.runTargets[this.deliveriesMade];
    if (!next || next.delivered) {
      next = this.runTargets.find((target) => !target.delivered) || null;
    }

    // Chunks stream while the player flies. If the route was shorter than required,
    // adopt a random distant newly registered rooftop instead of ending.
    if (!next) {
      const usedIds = new Set(this.runTargets.map((target) => target.houseId));
      const sleighPos = this.sleighController.position;
      let candidates = Array.from(this.trackedHouses.values())
        .filter((house) => !house.delivered && !usedIds.has(house.houseId));

      // Prefer houses at comfortable distance (7.5m - 14.0m away)
      const distantCandidates = candidates.filter((h) => {
        const d = Math.hypot(h.worldPos.x - sleighPos.x, h.worldPos.z - sleighPos.z);
        return d >= 7.5 && d <= 14.0;
      });

      const pool = distantCandidates.length > 0 ? distantCandidates : candidates;
      if (pool.length > 0) {
        next = pool[Math.floor(Math.random() * pool.length)];
        this.runTargets.push(next);
      }
    }

    if (!next) {
      this._finishRun(this.deliveriesMade >= this.deliveriesRequired);
      return;
    }

    this._activateTarget(next);
  }

  _activateTarget(houseData) {
    this.activeTarget = houseData || null;

    if (!this.giftDropMarker) {
      this.giftDropMarker = new GiftDropMarker(this.markersGroup, 0.16);
    }

    if (houseData) {
      if (!this.giftDropMarker.group.parent) {
        this.markersGroup.add(this.giftDropMarker.group);
      }
      // Sample roof ridge location and house orientation
      const dropData = this._sampleRandomRooftopPoint(houseData);
      houseData.worldPos.copy(dropData.pos);
      this.giftDropMarker.setPosition(dropData.pos.x, dropData.pos.y, dropData.pos.z);
      this.giftDropMarker.setRotation(dropData.rot);
      this.giftDropMarker.setState('default');
      this.giftDropMarker.setVisible(true);
      houseData.marker = this.giftDropMarker.group;

      // Launch / update the golden guiding wind stream toward the newly activated target
      if (this.sleighController && this.runActive && this.guidanceFlow) {
        const forward = new THREE.Vector3(
          -Math.sin(this.sleighController.rotationY || 0),
          0,
          -Math.cos(this.sleighController.rotationY || 0)
        );
        this.guidanceFlow.setTarget(this.sleighController.position, forward, houseData.worldPos);
      }
    } else {
      if (this.giftDropMarker) {
        this.giftDropMarker.setVisible(false);
      }
    }

    this._updateHUD();
  }

  _getAccuracy() {
    return this.attempts > 0 ? this.hits / this.attempts : 0;
  }

  _finishRun(success, reason = null) {
    if (this.runComplete) return;
    this.runComplete = true;
    this.runActive = false;

    clearTimeout(this._nextTargetTimeout);
    clearTimeout(this._finishTimeout);
    if (this.guidanceFlow) {
      this.guidanceFlow.clear();
    }

    // Let the final beacon dissolve instead of snapping off
    if (this.activeTarget?.marker?.userData) {
      this.activeTarget.marker.userData.isFading = true;
    }
    this.activeTarget = null;

    const accuracy = this._getAccuracy();
    const accuracyBonus = Math.round(accuracy * 300);
    this.finalScore = this.deliveryScore + this.starScore + accuracyBonus;
    this.score = this.finalScore;

    // Freeze flight input behind the results panel
    const sc = this.sleighController;
    if (sc) {
      sc.isPaused = true;
      if (sc.inputs) {
        Object.keys(sc.inputs).forEach((key) => { sc.inputs[key] = false; });
      }
      if (sc.joystick) {
        sc.joystick.x = 0;
        sc.joystick.y = 0;
      }
      if (sc.setVerticalInput) sc.setVerticalInput(0);
    }

    this._updateHUD();
    this.hudElement?.classList.add('run-ended');
    this._showResults(success, reason);
    if (reason === 'crash') soundManager.playCrash();
    else soundManager.playChunkComplete();
  }

  handleHouseCrash() {
    if (!this.runActive || this.runComplete) return;
    this._finishReason = 'crash';
    this._flashCrash();
    this._finishRun(false, 'crash');
  }

  _flashCrash() {
    const flash = document.getElementById('crash-flash');
    if (!flash) return;
    flash.classList.remove('active');
    void flash.offsetWidth;
    flash.classList.add('active');
    clearTimeout(this._crashFlashTimeout);
    this._crashFlashTimeout = setTimeout(() => flash.classList.remove('active'), 900);
  }

  _updateHUD() {
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText('hud-deliveries', `${this.deliveriesMade} / ${this.deliveriesRequired}`);
    setText('hud-stars', `${this.starsCollected} / ${this.starsTotal}`);
    setText('hud-score', `${this.score}`);
    setText(
      'hud-accuracy',
      this.attempts > 0 ? `${Math.round(this._getAccuracy() * 100)}%` : '--'
    );
    setText('hud-gifts-count', `${this.giftsRemaining}`);

    if (this._progressPips) {
      this._progressPips.forEach((pip, index) => {
        pip.classList.toggle('filled', index < this.deliveriesMade);
        pip.classList.toggle(
          'current',
          this.runActive && !this.runComplete && index === this.deliveriesMade
        );
      });
    }

    this._updateHUDGifts();
  }

  _showResults(success, reason = null) {
    const overlay = document.getElementById('results-overlay');
    if (!overlay) return;

    const isCrash = reason === 'crash';
    const accuracy = this._getAccuracy();
    const accPct = Math.round(accuracy * 100);
    let rating = 1;
    if (!isCrash && this.deliveriesMade >= this.deliveriesRequired) {
      rating = accuracy >= 0.9 ? 3 : accuracy >= 0.65 ? 2 : 1;
    }

    const title = document.getElementById('results-title');
    const subtitle = document.getElementById('results-subtitle');
    const ratingEl = document.getElementById('results-rating');
    const deliveriesEl = document.getElementById('results-deliveries');
    const accuracyEl = document.getElementById('results-accuracy');
    const starsEl = document.getElementById('results-stars');
    const scoreEl = document.getElementById('results-score');

    if (title) {
      title.textContent = isCrash
        ? 'SLEIGH CRASHED!'
        : success
          ? rating === 3 ? 'PERFECT NIGHT!' : rating === 2 ? 'DELIVERIES COMPLETE!' : 'VILLAGE DELIVERED!'
          : 'RUN OVER';
    }
    if (subtitle) {
      subtitle.textContent = isCrash
        ? `Santa clipped a rooftop after ${this.deliveriesMade} of ${this.deliveriesRequired} deliveries.`
        : success
          ? `You delivered ${this.deliveriesMade} of ${this.deliveriesRequired} gifts before the night was through.`
          : `The gift sack ran dry after ${this.deliveriesMade} of ${this.deliveriesRequired} deliveries.`;
    }
    if (ratingEl) {
      ratingEl.textContent = '★'.repeat(rating) + '☆'.repeat(3 - rating);
    }
    if (deliveriesEl) deliveriesEl.textContent = `${this.deliveriesMade} / ${this.deliveriesRequired}`;
    if (accuracyEl) accuracyEl.textContent = `${accPct}%`;
    if (starsEl) starsEl.textContent = `${this.starsCollected} / ${this.starsTotal}`;
    if (scoreEl) scoreEl.textContent = `${this.finalScore}`;

    overlay.classList.remove('hidden');
    overlay.classList.add('visible');
    // Some mobile browsers pause CSS transitions for occluded/throttled tabs.
    // Force the final visible state so the results screen can never get stuck
    // half-faded. The entrance still feels animated thanks to the card transform.
    overlay.style.opacity = '1';
    overlay.style.visibility = 'visible';
    overlay.style.pointerEvents = 'auto';
  }

  _hideResults() {
    const overlay = document.getElementById('results-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.classList.add('hidden');
    overlay.style.opacity = '';
    overlay.style.visibility = '';
    overlay.style.pointerEvents = '';
  }

  // ---------------------------------------------------------------------------
  // Optional collectible route stars
  // ---------------------------------------------------------------------------

  _spawnRouteStars() {
    this._clearStars();
    if (this.runTargets.length < 2) return;

    const legs = this.runTargets.length - 1;
    let starId = 0;

    // Distribute collectible stars in small clusters along open flight corridors between target stops.
    // Each leg gets 1-2 stars in gentle arcs, cleanly elevated above snow and safely away
    // from houses, trees, and active target rooftop beacons.
    for (let leg = 0; leg < legs && starId < this.starsTotal; leg++) {
      const a = this.runTargets[leg].worldPos;
      const b = this.runTargets[leg + 1].worldPos;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const legDist = Math.hypot(dx, dz) || 1.0;
      const nx = -dz / legDist;
      const nz = dx / legDist;

      // Stars per leg: 2 on longer segments, 1 on tighter ones
      const starsOnLeg = (leg % 2 === 0 && (starId + 2 <= this.starsTotal)) ? 2 : 1;

      for (let s = 0; s < starsOnLeg && starId < this.starsTotal; s++) {
        // T-parameter along the flight path corridor (between 0.28 and 0.72)
        const t = starsOnLeg === 1 ? 0.50 : (s === 0 ? 0.36 : 0.64);
        
        // Gentle lateral offset: alternate sides along the route to reward intentional steering
        const lateralDir = (leg + s) % 2 === 0 ? 1.0 : -1.0;
        const lateralOffset = Math.min(1.6, Math.max(1.0, legDist * 0.28)) * lateralDir;

        const posX = a.x + dx * t + nx * lateralOffset;
        const posZ = a.z + dz * t + nz * lateralOffset;

        // Verify terrain height & clearance from houses
        const terrainY = this.chunkSystem?.getHeight
          ? this.chunkSystem.getHeight(posX, posZ)
          : 0.5;

        // Precise flight elevation: align directly with locked cruising altitude (0.58m above terrain)
        const targetClearance = this.sleighController?.targetFlightAltitude || 0.58;
        let finalY = terrainY + targetClearance;

        // Ensure clearance over nearby house colliders
        if (this.chunkSystem?.getHouseCollidersNear) {
          const colliders = this.chunkSystem.getHouseCollidersNear(posX, posZ, 2.2);
          if (colliders && colliders.length > 0) {
            let maxRoofY = finalY;
            for (let c = 0; c < colliders.length; c++) {
              if (colliders[c].max.y > maxRoofY) maxRoofY = colliders[c].max.y;
            }
            finalY = Math.max(finalY, maxRoofY + targetClearance);
          }
        }

        // Avoid spawning directly on top of delivery target roofs
        let tooCloseToHouse = false;
        for (let target of this.runTargets) {
          const distToTarget = Math.hypot(posX - target.worldPos.x, posZ - target.worldPos.z);
          if (distToTarget < 1.4) {
            tooCloseToHouse = true;
            break;
          }
        }
        if (tooCloseToHouse) continue;

        const group = new THREE.Group();
        group.name = `RouteStar_${starId}`;
        group.position.set(posX, finalY, posZ);

        // 1. Faceted 3D diamond star
        const starMesh = new THREE.Mesh(this._starGeo, this._starMat);
        starMesh.rotation.z = (starId * 0.65) % Math.PI;
        group.add(starMesh);

        // 2. Diamond sparkling core
        const coreMesh = new THREE.Mesh(this._starCoreGeo, this._starCoreMat);
        group.add(coreMesh);

        // 3. Radiant celestial golden halo flare
        const halo = new THREE.Sprite(this._starHaloMat);
        halo.scale.set(0.55, 0.55, 0.55);
        group.add(halo);

        // 4. Subtle orbiting golden stardust sparkles (fairy dust)
        const motesGeo = new THREE.BufferGeometry();
        const moteCount = 4;
        const motePositions = new Float32Array(moteCount * 3);
        for (let m = 0; m < moteCount; m++) {
          const mAngle = (m / moteCount) * Math.PI * 2;
          const mR = 0.22;
          motePositions[m * 3]     = Math.cos(mAngle) * mR;
          motePositions[m * 3 + 1] = (Math.random() - 0.5) * 0.08;
          motePositions[m * 3 + 2] = Math.sin(mAngle) * mR;
        }
        motesGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
        const motesMat = new THREE.PointsMaterial({
          map: this._starGlintTexture,
          color: 0xfffae0,
          size: 0.12,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false
        });
        const motesMesh = new THREE.Points(motesGeo, motesMat);
        group.add(motesMesh);

        this.starsGroup.add(group);
        this.activeStars.push({
          id: starId,
          group,
          mesh: starMesh,
          core: coreMesh,
          halo,
          motes: motesMesh,
          baseY: finalY,
          phase: starId * 1.15,
          collected: false
        });

        starId++;
      }
    }

    // Keep starsTotal synchronized with actually placed stars if any were skipped
    this.starsTotal = Math.max(1, this.activeStars.length);
    this._updateHUD();
  }

  _updateStars(delta, elapsedTime) {
    if (this.activeStars.length === 0) return;
    const sleighPos = this.sleighController.position;

    for (let i = this.activeStars.length - 1; i >= 0; i--) {
      const star = this.activeStars[i];
      if (!this.runActive || star.collected) continue;

      // Serene multi-axis rotation & floating bob
      star.mesh.rotation.y += delta * 1.8;
      star.mesh.rotation.x = Math.sin(elapsedTime * 1.5 + star.phase) * 0.15;
      if (star.core) {
        star.core.rotation.y -= delta * 2.5;
        star.core.rotation.z += delta * 1.2;
      }
      if (star.motes) {
        star.motes.rotation.y += delta * 1.4;
      }
      if (star.halo) {
        // Subtle gentle breathing pulse on the celestial flare
        const haloPulse = 0.52 + Math.sin(elapsedTime * 3.0 + star.phase) * 0.08;
        star.halo.scale.set(haloPulse, haloPulse, haloPulse);
      }

      // Smooth floating hover bob
      const targetBaseY = star.baseY + Math.sin(elapsedTime * 2.2 + star.phase) * 0.045;

      const dx = sleighPos.x - star.group.position.x;
      const dy = sleighPos.y - star.group.position.y;
      const dz = sleighPos.z - star.group.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(distSq);

      // Smooth Magnetic Attraction ("Coin Magnet" within 1.6m range)
      if (dist < 1.6 && dist > 0.001) {
        const pullSpeed = THREE.MathUtils.clamp((1.6 - dist) * 7.5, 2.0, 10.0);
        star.group.position.x += (dx / dist) * pullSpeed * delta;
        star.group.position.y += (dy / dist) * pullSpeed * delta;
        star.group.position.z += (dz / dist) * pullSpeed * delta;
      } else {
        // Natural return to hover anchor if out of magnetic pull
        star.group.position.y += (targetBaseY - star.group.position.y) * Math.min(delta * 4.0, 1.0);
      }

      // Pickup trigger (0.60m spherical proximity)
      if (dist <= 0.60) {
        this._collectStar(star, i);
      }
    }
  }

  _triggerHUDStarPulse() {
    const el = document.getElementById('hud-stars');
    if (!el) return;
    el.classList.remove('hud-star-pulse');
    void el.offsetWidth; // Force DOM reflow to restart CSS animation
    el.classList.add('hud-star-pulse');
  }

  _collectStar(star, index) {
    if (star.collected) return;
    star.collected = true; // Guard against duplicate pickup

    const worldPos = star.group.position.clone();
    this.starsGroup.remove(star.group);
    this.activeStars.splice(index, 1);

    this.starsCollected++;
    this.starScore += 50;
    this.score = this.deliveryScore + this.starScore;

    // Spectacular, multi-layered celebratory collection effects:
    // 1. Expanding golden planar shockwave ring
    this._spawnShockwaveRing(worldPos);

    // 2. Multi-tiered sparkling stardust & diamond ember burst
    this._spawnStarSparkleBurst(worldPos);

    // 3. Floating 3D world-space "+50 🌟" score popup
    this._spawnWorldScorePopup(worldPos, '+50 🌟');

    // 4. Crystalline chime sound with shimmer overtones
    soundManager.playStar();

    // 5. HUD banner notification and tactile counter pulse
    this.showBanner(`STAR COLLECTED! +50 • ${this.starsCollected}/${this.starsTotal}`, 'star');
    this._updateHUD();
    this._triggerHUDStarPulse();
  }

  _spawnShockwaveRing(worldPos) {
    // Ethereal horizontal planar shockwave ring expanding outward from collection center
    const ringGeo = new THREE.RingGeometry(0.08, 0.22, 32);
    // Orient horizontally (facing upwards)
    ringGeo.rotateX(-Math.PI / 2);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.90,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.copy(worldPos);
    this.scene.add(ringMesh);

    this.activeShockwaves.push({
      mesh: ringMesh,
      startRadius: 0.6,
      endRadius: this.isMobile ? 2.2 : 2.8,
      baseOpacity: 0.88,
      age: 0.0,
      maxAge: 0.38
    });
  }

  _spawnWorldScorePopup(worldPos, text) {
    // Dynamically render crisp billboard text to high-res offscreen canvas
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 52px system-ui, -apple-system, sans-serif';

    // Golden halo glow & dark outline for maximum legibility against snow & sky
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(20, 20, 25, 0.85)';
    ctx.strokeText(text, 128, 64);

    ctx.fillStyle = '#fff9d6';
    ctx.fillText(text, 128, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      depthTest: false
    });

    const sprite = new THREE.Sprite(spriteMat);
    // Slightly elevated above the star location
    sprite.position.set(worldPos.x, worldPos.y + 0.15, worldPos.z);
    const baseScale = this.isMobile ? 0.95 : 1.15;
    sprite.scale.set(baseScale, baseScale * 0.5, 1.0);
    this.scene.add(sprite);

    this.activeWorldPopups.push({
      sprite,
      startY: worldPos.y + 0.15,
      baseScale,
      age: 0.0,
      maxAge: 0.75
    });
  }

  _spawnStarSparkleBurst(worldPos) {
    const count = this.isMobile ? 36 : 64;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = worldPos.x;
      positions[i * 3 + 1] = worldPos.y;
      positions[i * 3 + 2] = worldPos.z;

      // Radiant festive gold, warm champagne, and diamond starburst
      const colorTier = Math.random();
      if (colorTier > 0.65) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 0.92; // Diamond White-Gold
      } else if (colorTier > 0.25) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.86; colors[i * 3 + 2] = 0.22; // Pure Gold
      } else {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.58; colors[i * 3 + 2] = 0.10; // Warm Amber
      }

      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;
      // High-energy initial explosion with slight upward buoyancy
      const speed = 2.2 + Math.random() * 4.2;
      velocities.push({
        x: Math.cos(phi) * Math.cos(theta) * speed,
        y: Math.sin(phi) * speed * 0.85 + 1.2,
        z: Math.cos(phi) * Math.sin(theta) * speed
      });
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      map: this._starGlintTexture || this._haloTexture,
      size: this.isMobile ? 0.32 : 0.42,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const sparkleMesh = new THREE.Points(geo, mat);
    this.scene.add(sparkleMesh);

    this.activeSparkles.push({
      mesh: sparkleMesh,
      velocities: velocities,
      age: 0.0,
      maxAge: 0.58
    });
  }

  _clearStars() {
    this.activeStars.forEach((star) => this.starsGroup.remove(star.group));
    this.activeStars.length = 0;
    this.starsGroup.clear();
  }

  _checkChunkCompletion(chunkKey) {
    const chunkHouses = Array.from(this.trackedHouses.values())
      .filter(h => h.chunkKey === chunkKey);

    const deliveredInChunk = chunkHouses.filter(h => h.delivered).length;
    const totalInChunk = chunkHouses.length;

    if (totalInChunk > 0 && deliveredInChunk === totalInChunk && !this.completedChunks.has(chunkKey)) {
      this.completedChunks.add(chunkKey);
      const chunkBonus = 500;
      this.score += chunkBonus;
      soundManager.playChunkComplete();
      this.showBanner(`🌟 CHUNK COMPLETED! +${chunkBonus} PTS BONUS! 🌟`, 'chunk-complete');
    }
  }

  _spawnSparkleBurst(worldPos, targetPos = null) {
    const count = this.isMobile ? 24 : 60;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];

    // Optional gentle drift toward target house
    let driftX = 0, driftY = 0, driftZ = 0;
    if (targetPos) {
      const dX = targetPos.x - worldPos.x;
      const dY = targetPos.y - worldPos.y;
      const dZ = targetPos.z - worldPos.z;
      const len = Math.hypot(dX, dY, dZ) || 1.0;
      driftX = (dX / len) * 0.9;
      driftY = Math.max(0.2, (dY / len) * 0.9);
      driftZ = (dZ / len) * 0.9;
    }

    for (let i = 0; i < count; i++) {
      positions[i * 3] = worldPos.x;
      positions[i * 3 + 1] = worldPos.y;
      positions[i * 3 + 2] = worldPos.z;

      // Golden & emerald star colors
      const isGold = Math.random() > 0.35;
      colors[i * 3]     = isGold ? 1.0 : 0.2;
      colors[i * 3 + 1] = isGold ? 0.85 : 1.0;
      colors[i * 3 + 2] = isGold ? 0.2 : 0.4;

      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 4.5;
      velocities.push({
        x: Math.cos(angle) * speed + driftX,
        y: 1.5 + Math.random() * 5.0 + driftY,
        z: Math.sin(angle) * speed + driftZ
      });
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: this.isMobile ? 0.35 : 0.45,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const sparkleMesh = new THREE.Points(geo, mat);
    this.scene.add(sparkleMesh);

    this.activeSparkles.push({
      mesh: sparkleMesh,
      velocities: velocities,
      age: 0.0,
      maxAge: 1.2
    });
  }

  /**
   * Spawns a sparse, subtle cluster of warm golden sparkles that gently drift
   * along a short curved arc pointing toward the next target house.
   * Does NOT form a line, ribbon, or beam; dissipates naturally within 1.5-1.8s.
   */
  _spawnDirectionalSparkles(originPos, targetPos, sleighForward) {
    if (!originPos || !targetPos) return;

    // Unit vector toward next target
    const toTarget = new THREE.Vector3().subVectors(targetPos, originPos);
    const dist = toTarget.length();
    if (dist < 0.001) return;
    toTarget.normalize();

    // Sleigh forward vector (or default north if not provided)
    const forward = sleighForward ? sleighForward.clone().normalize() : new THREE.Vector3(0, 0, -1);

    const count = this.isMobile ? 10 : 15;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];

    // Subtle spawn volume slightly forward / above Santa
    for (let i = 0; i < count; i++) {
      const spreadX = (Math.random() - 0.5) * 0.18;
      const spreadY = (Math.random() - 0.3) * 0.14;
      const spreadZ = (Math.random() - 0.5) * 0.18;

      positions[i * 3]     = originPos.x + forward.x * 0.22 + spreadX;
      positions[i * 3 + 1] = originPos.y + 0.12 + spreadY;
      positions[i * 3 + 2] = originPos.z + forward.z * 0.22 + spreadZ;

      // Pure warm golden palette: gold, champagne, amber
      const goldTone = Math.random();
      if (goldTone < 0.5) {
        // Warm brilliant gold
        colors[i * 3]     = 1.0;
        colors[i * 3 + 1] = 0.82;
        colors[i * 3 + 2] = 0.22;
      } else if (goldTone < 0.8) {
        // Soft golden champagne
        colors[i * 3]     = 1.0;
        colors[i * 3 + 1] = 0.92;
        colors[i * 3 + 2] = 0.45;
      } else {
        // Rich amber glint
        colors[i * 3]     = 1.0;
        colors[i * 3 + 1] = 0.72;
        colors[i * 3 + 2] = 0.15;
      }

      // Initial velocity combines Santa's forward glide + initial forward puff,
      // which will steer smoothly toward the target direction over time.
      const initialForwardBias = 0.45 + Math.random() * 0.35;
      const targetBias = 0.55 + Math.random() * 0.35;
      const speed = 1.35 + Math.random() * 0.65;

      const initVelX = (forward.x * initialForwardBias + toTarget.x * targetBias + (Math.random() - 0.5) * 0.2) * speed;
      const initVelY = (0.2 + toTarget.y * 0.35 + (Math.random() - 0.5) * 0.15) * speed;
      const initVelZ = (forward.z * initialForwardBias + toTarget.z * targetBias + (Math.random() - 0.5) * 0.2) * speed;

      velocities.push({
        x: initVelX,
        y: initVelY,
        z: initVelZ,
        targetSpeed: speed
      });
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      map: this._starGlintTexture || null,
      size: this.isMobile ? 0.18 : 0.24,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const sparkleMesh = new THREE.Points(geo, mat);
    this.scene.add(sparkleMesh);

    this.activeSparkles.push({
      mesh: sparkleMesh,
      velocities: velocities,
      curved: true,
      curveTargetDir: toTarget,
      baseOpacity: 0.95,
      age: 0.0,
      maxAge: 1.6 + Math.random() * 0.3
    });
  }

  _spawnPuffCloud(worldPos) {
    const count = 14;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = worldPos.x;
      positions[i * 3 + 1] = worldPos.y;
      positions[i * 3 + 2] = worldPos.z;

      const angle = Math.random() * Math.PI * 2;
      velocities.push({
        x: Math.cos(angle) * 1.5,
        y: 0.8 + Math.random() * 1.2,
        z: Math.sin(angle) * 1.5
      });
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xc8d6e5,
      size: 0.5,
      transparent: true,
      opacity: 0.7,
      depthWrite: false
    });

    const puffMesh = new THREE.Points(geo, mat);
    this.scene.add(puffMesh);

    this.activeSparkles.push({
      mesh: puffMesh,
      velocities: velocities,
      age: 0.0,
      maxAge: 0.8
    });
  }

  _updateTargetCompass() {
    const sleighPos = this.sleighController.position;

    // Detect current chunk under sleigh so newly streamed houses are registered.
    const chunkSize = this.chunkSystem ? this.chunkSystem.chunkSize : 20.0;
    const half = chunkSize * 0.5;
    const currentCx = Math.floor((sleighPos.x + half) / chunkSize);
    const currentCz = Math.floor((sleighPos.z + half) / chunkSize);
    const currentKey = `${currentCx},${currentCz}`;

    if (currentKey !== this.currentChunkKey) {
      this.currentChunkKey = currentKey;
      this.syncChunkTargets(currentKey, currentCx, currentCz);
    }

    let state = 'idle';
    if (this.runActive && !this.runComplete && this.activeTarget) {
      this.closestTarget = this.activeTarget;
      this.closestDistance = sleighPos.distanceTo(this.activeTarget.worldPos);
      state = this._isInDeliveryRange(sleighPos) ? 'ready' : 'far';
    } else {
      this.closestTarget = null;
      this.closestDistance = Infinity;
    }

    // Only touch the DOM when the proximity state actually changes.
    if (state === this._rangeState) return;
    this._rangeState = state;

    const statusEl = document.getElementById('drop-status');
    const dropBtn = document.getElementById('btn-drop-gift');

    if (statusEl) {
      statusEl.textContent =
        state === 'ready' ? 'READY TO DROP' :
        state === 'far' ? 'GET CLOSER' :
        this.runComplete ? 'RUN COMPLETE' : 'NEXT HOUSE...';
      statusEl.classList.toggle('ready', state === 'ready');
      statusEl.classList.toggle('far', state === 'far');
    }

    if (dropBtn) dropBtn.classList.toggle('ready', state === 'ready');
  }
}
