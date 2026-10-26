import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { soundManager } from './SoundManager.js';

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

    // Optional collectible stars placed along the route
    this.starsGroup = new THREE.Group();
    this.starsGroup.name = 'DeliveryStarsGroup';
    this.scene.add(this.starsGroup);
    this.activeStars = [];

    // Falling gifts & active delivery sparks
    this.activeGifts = [];
    this.activeSparkles = [];

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

    // Classic 3D 5-point star with beveled faceting and smooth centroid centering
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? 0.11 : 0.048;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) starShape.moveTo(px, py);
      else starShape.lineTo(px, py);
    }
    starShape.closePath();

    this._starGeo = new THREE.ExtrudeGeometry(starShape, {
      depth: 0.032,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.010,
      bevelThickness: 0.012
    });
    this._starGeo.center();

    // Warm golden star PBR material with soft emissive luminance (subtle, non-blinding)
    this._starMat = new THREE.MeshStandardMaterial({
      color: 0xffcb38,
      emissive: 0xf39c12,
      emissiveIntensity: 0.75,
      metalness: 0.68,
      roughness: 0.28,
      toneMapped: true
    });

    // Soft localized golden halo glow
    this._starHaloMat = new THREE.SpriteMaterial({
      map: this._haloTexture,
      color: 0xffca3d,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      fog: false,
      toneMapped: true
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

        <!-- Bottom-Right: One clearly labeled drop action, for mouse, touch and keyboard -->
        <div id="drop-zone">
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

  // Terrain-aware candidate validation:
  // Verifies house is on solid snowy ground (not water/lake), slope is gentle,
  // safe clearance from tree trunks, and unobstructed open flight approach.
  _isValidHouseCandidate(box, cx, cz) {
    if (!box || !box.min || !box.max) return false;
    const sizeX = box.max.x - box.min.x;
    const sizeZ = box.max.z - box.min.z;
    if (sizeX < 0.22 || sizeZ < 0.22) return false;

    const roofY = box.max.y;
    const groundY = box.min.y;
    // Houses must have believable height and not be miniature debris
    if (roofY - groundY < 0.18) return false;
    if (roofY < 0.58 || roofY > 2.20) return false;

    const centerX = (box.min.x + box.max.x) * 0.5;
    const centerZ = (box.min.z + box.max.z) * 0.5;

    // 1. Terrain elevation check: must rest on solid ground above water/lake level (lake surface ~0.48-0.50m)
    if (this.chunkSystem && this.chunkSystem.getHeight) {
      const terrainHeight = this.chunkSystem.getHeight(centerX, centerZ);
      if (terrainHeight < 0.53) return false; // In or below water
      // Must not be floating high in mid-air or sunk deep underground
      if (Math.abs(groundY - terrainHeight) > 0.45) return false;

      // 2. Slope check: verify ground under house is reasonably flat (not sheer cliff face)
      const sampleDist = 0.4;
      const hX1 = this.chunkSystem.getHeight(centerX + sampleDist, centerZ);
      const hX2 = this.chunkSystem.getHeight(centerX - sampleDist, centerZ);
      const hZ1 = this.chunkSystem.getHeight(centerX, centerZ + sampleDist);
      const hZ2 = this.chunkSystem.getHeight(centerX, centerZ - sampleDist);
      const slopeX = Math.abs(hX1 - hX2) / (sampleDist * 2);
      const slopeZ = Math.abs(hZ1 - hZ2) / (sampleDist * 2);
      if (slopeX > 0.38 || slopeZ > 0.38) return false; // Steep cliff face
    }

    // 3. Tree trunk clearance: ensure candidate does not overlap foliage stems
    if (this.chunkSystem && this.chunkSystem.templateTreePositions) {
      let lx = centerX - cx * this.chunkSystem.chunkSize;
      let lz = centerZ - cz * this.chunkSystem.chunkSize;
      const rotIdx = this.chunkSystem.getChunkRotationIndex ? this.chunkSystem.getChunkRotationIndex(cx, cz) : 0;
      if (rotIdx === 1) { const ox = lx; lx = -lz; lz = ox; }
      else if (rotIdx === 2) { lx = -lx; lz = -lz; }
      else if (rotIdx === 3) { const ox = lx; lx = lz; lz = -ox; }

      const trees = this.chunkSystem.templateTreePositions;
      for (let t = 0; t < trees.length; t++) {
        const distSq = (trees[t].x - lx) * (trees[t].x - lx) + (trees[t].z - lz) * (trees[t].z - lz);
        if (distSq < 0.45 * 0.45) return false; // Inside or touching tree trunk
      }
    }

    return true;
  }

  // Deterministic target selection for a chunk with terrain and clearance validation
  syncChunkTargets(chunkKey, cx, cz) {
    if (!this.chunkSystem) return;

    const chunkData = this.chunkSystem.chunks.get(chunkKey);
    const colliders = chunkData && Array.isArray(chunkData.houseColliders)
      ? chunkData.houseColliders
      : [];

    if (colliders.length === 0) return;

    const validatedCandidates = [];
    for (let i = 0; i < colliders.length; i++) {
      const box = colliders[i];
      if (!this._isValidHouseCandidate(box, cx, cz)) continue;

      const roof = new THREE.Vector3(
        (box.min.x + box.max.x) * 0.5,
        box.max.y,
        (box.min.z + box.max.z) * 0.5
      );

      // Avoid duplicates or houses clustered too tightly in the same chunk (< 1.2m apart)
      let tooClose = false;
      for (let j = 0; j < validatedCandidates.length; j++) {
        const c = validatedCandidates[j];
        if (Math.hypot(c.x - roof.x, c.z - roof.z) < 1.2) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        validatedCandidates.push(roof);
      }
    }

    // Register all validated delivery houses for this chunk
    validatedCandidates.forEach((roof, idx) => {
      const houseId = "house_" + chunkKey + "_" + idx;
      let houseData = this.trackedHouses.get(houseId);
      if (!houseData) {
        houseData = {
          houseId,
          chunkKey,
          worldPos: roof.clone(),
          delivered: false,
          marker: null
        };
        this.trackedHouses.set(houseId, houseData);
      } else {
        houseData.worldPos.copy(roof);
      }
    });

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

    // 1. Animate the single active golden beam marker
    for (let i = this.markersGroup.children.length - 1; i >= 0; i--) {
      const marker = this.markersGroup.children[i];
      const u = marker.userData;
      if (!u) continue;

      // Delivery completion: smooth golden dissolve
      if (u.isFading) {
        u.fadeProgress += delta * 1.5; // ~0.7s smooth dissolve
        const alpha = Math.max(0.0, 1.0 - u.fadeProgress);
        marker.traverse((child) => {
          if (child.material) {
            const baseOp = child.material.userData?.baseOpacity !== undefined
              ? child.material.userData.baseOpacity
              : 0.85;
            if (child.material.uniforms?.uOpacity) {
              child.material.uniforms.uOpacity.value = baseOp * alpha;
            } else {
              child.material.opacity = baseOp * alpha;
            }
          }
        });
        if (u.fadeProgress >= 1.0) {
          this.markersGroup.remove(marker);
          if (u.houseData) u.houseData.marker = null;
        }
        continue;
      }

      // Simple proximity check, mirroring triggerDelivery() exactly so READY
      // TO DROP always means a drop right now will land.
      const isActive = !!this.activeTarget && this.activeTarget.houseId === u.houseData.houseId;
      const isInRange = isActive &&
        !u.houseData.delivered &&
        this._isInDeliveryRange(sleighPos);

      if (isInRange !== u.inRange) {
        u.inRange = isInRange;
        if (u.beamMat) {
          u.beamMat.uniforms.uOpacity.value =
            u.beamMat.userData.baseOpacity * (isInRange ? 1.35 : 1.0);
        }
      }

      // Beam breathing glow and subtle shimmer over time
      if (u.beamMat) {
        u.beamMat.uniforms.uTime.value = elapsedTime;
      }
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

    // 4. Update sparkle particle effects
    for (let i = this.activeSparkles.length - 1; i >= 0; i--) {
      const sp = this.activeSparkles[i];
      sp.age += delta;
      if (sp.age >= sp.maxAge) {
        this.scene.remove(sp.mesh);
        this.activeSparkles.splice(i, 1);
      } else {
        const t = sp.age / sp.maxAge;
        const posAttr = sp.mesh.geometry.attributes.position;
        for (let j = 0; j < sp.velocities.length; j++) {
          posAttr.setX(j, posAttr.getX(j) + sp.velocities[j].x * delta);
          posAttr.setY(j, posAttr.getY(j) + sp.velocities[j].y * delta);
          posAttr.setZ(j, posAttr.getZ(j) + sp.velocities[j].z * delta);
        }
        posAttr.needsUpdate = true;
        sp.mesh.material.opacity = (1.0 - t);
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

    // Brief celebration: one sparkle burst and the success chime.
    this._spawnSparkleBurst(houseData.worldPos);
    soundManager.playSuccess();

    this.showBanner(
      `GIFT DELIVERED! +${points} PTS • ${this.deliveriesMade}/${this.deliveriesRequired}`,
      'success'
    );

    this.activeTarget = null;
    this.closestTarget = null;
    this._updateHUD();

    clearTimeout(this._nextTargetTimeout);
    clearTimeout(this._finishTimeout);

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
    clearTimeout(this._bannerTimeout);
    this._nextTargetTimeout = null;
    this._finishTimeout = null;

    this._hideResults();

    // Clear any gifts / particles left over from the previous run
    this.activeGifts.forEach((gift) => this.scene.remove(gift.mesh));
    this.activeGifts.length = 0;
    this.activeSparkles.forEach((sp) => this.scene.remove(sp.mesh));
    this.activeSparkles.length = 0;

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

    // Banner removed
  }

  _seedLoadedChunks() {
    if (!this.chunkSystem?.chunks) return;
    this.chunkSystem.chunks.forEach((_chunkData, key) => {
      const [cx, cz] = key.split(',').map(Number);
      this.syncChunkTargets(key, cx, cz);
    });
  }

  // Select 5 well-spaced delivery houses across distinct quadrants/regions of playable terrain
  _selectRunTargets() {
    const origin = this.sleighController?.position || new THREE.Vector3(0, 0.8, 8.0);
    const all = Array.from(this.trackedHouses.values()).filter((h) => !h.delivered);
    if (all.length === 0) {
      this.runTargets = [];
      return;
    }

    // 5 delivery houses at well-spaced locations across the playable terrain
    // with enough distance between targets to make flying feel like an adventure (>= 10m to 18m).
    const selected = [];
    const minDistanceThreshold = 10.0;

    let remaining = [...all];
    remaining.sort((a, b) => {
      const da = Math.hypot(a.worldPos.x - origin.x, a.worldPos.z - origin.z);
      const db = Math.hypot(b.worldPos.x - origin.x, b.worldPos.z - origin.z);
      const scoreA = Math.abs(da - 11.0);
      const scoreB = Math.abs(db - 11.0);
      return scoreA - scoreB;
    });

    if (remaining.length > 0) {
      selected.push(remaining.shift());
    }

    while (selected.length < this.deliveriesRequired && remaining.length > 0) {
      const lastPos = selected[selected.length - 1].worldPos;
      let bestCandidate = null;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const distFromLast = Math.hypot(cand.worldPos.x - lastPos.x, cand.worldPos.z - lastPos.z);
        
        let minDistFromAnySelected = distFromLast;
        for (let s = 0; s < selected.length; s++) {
          const d = Math.hypot(cand.worldPos.x - selected[s].worldPos.x, cand.worldPos.z - selected[s].worldPos.z);
          if (d < minDistFromAnySelected) minDistFromAnySelected = d;
        }

        let score = minDistFromAnySelected;
        if (cand.chunkKey !== selected[selected.length - 1].chunkKey) {
          score += 6.0;
        }

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = cand;
        }
      }

      if (bestCandidate && (bestScore >= minDistanceThreshold || remaining.length <= (this.deliveriesRequired - selected.length))) {
        selected.push(bestCandidate);
        remaining = remaining.filter((h) => h.houseId !== bestCandidate.houseId);
      } else if (remaining.length > 0) {
        remaining.sort((a, b) => {
          const da = Math.hypot(a.worldPos.x - lastPos.x, a.worldPos.z - lastPos.z);
          const db = Math.hypot(b.worldPos.x - lastPos.x, b.worldPos.z - lastPos.z);
          return db - da;
        });
        const picked = remaining.shift();
        selected.push(picked);
      } else {
        break;
      }
    }

    this.runTargets = selected.slice(0, this.deliveriesRequired);
  }
  _setNextTarget() {
    if (!this.runActive || this.runComplete) return;

    let next = this.runTargets[this.deliveriesMade];
    if (!next || next.delivered) {
      next = this.runTargets.find((target) => !target.delivered) || null;
    }

    // Chunks stream while the player flies. If the route was shorter than five
    // at start, adopt the nearest newly registered rooftop instead of ending.
    if (!next) {
      const usedIds = new Set(this.runTargets.map((target) => target.houseId));
      const candidates = Array.from(this.trackedHouses.values())
        .filter((house) => !house.delivered && !usedIds.has(house.houseId));
      const sleighPos = this.sleighController.position;
      let bestDist = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const d = Math.hypot(
          candidates[i].worldPos.x - sleighPos.x,
          candidates[i].worldPos.z - sleighPos.z
        );
        if (d < bestDist) {
          bestDist = d;
          next = candidates[i];
        }
      }
      if (next) this.runTargets.push(next);
    }

    if (!next) {
      this._finishRun(this.deliveriesMade >= this.deliveriesRequired);
      return;
    }

    this._activateTarget(next);
  }

  _activateTarget(houseData) {
    this.activeTarget = houseData || null;

    // Remove stale (non-fading) markers so only one beacon is visible.
    Array.from(this.markersGroup.children).forEach((marker) => {
      if (marker.userData?.houseData === houseData) return;
      if (marker.userData?.isFading) return;
      this.markersGroup.remove(marker);
      if (marker.userData?.houseData) marker.userData.houseData.marker = null;
    });

    if (houseData) {
      if (!houseData.marker) {
        const marker = this._createTargetMarker(houseData);
        houseData.marker = marker;
        this.markersGroup.add(marker);
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

        // Safe flight elevation: elevated comfortably above ground & trees (+0.95m to +1.35m)
        const elevationOffset = 0.95 + ((starId % 3) * 0.14);
        let finalY = terrainY + elevationOffset;

        // Ensure clearance from nearby house colliders
        if (this.chunkSystem?.getHouseCollidersNear) {
          const colliders = this.chunkSystem.getHouseCollidersNear(posX, posZ, 2.2);
          if (colliders && colliders.length > 0) {
            let maxRoofY = finalY;
            for (let c = 0; c < colliders.length; c++) {
              if (colliders[c].max.y > maxRoofY) maxRoofY = colliders[c].max.y;
            }
            finalY = Math.max(finalY, maxRoofY + 0.65);
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

        const starMesh = new THREE.Mesh(this._starGeo, this._starMat);
        starMesh.rotation.z = (starId * 0.65) % Math.PI;
        group.add(starMesh);

        // Soft ambient halo (subtle, non-blinding)
        const halo = new THREE.Sprite(this._starHaloMat);
        halo.scale.set(0.30, 0.30, 0.30);
        group.add(halo);

        this.starsGroup.add(group);
        this.activeStars.push({
          id: starId,
          group,
          mesh: starMesh,
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
      // Gentle, serene rotation and subtle floating bob
      star.mesh.rotation.y += delta * 1.5;
      star.group.position.y = star.baseY + Math.sin(elapsedTime * 2.0 + star.phase) * 0.035;

      if (!this.runActive || star.collected) continue;

      const dx = sleighPos.x - star.group.position.x;
      const dy = sleighPos.y - star.group.position.y;
      const dz = sleighPos.z - star.group.position.z;

      // Smooth spherical proximity pickup (~0.75m radius)
      if (dx * dx + dz * dz <= 0.85 * 0.85 && Math.abs(dy) <= 0.70) {
        this._collectStar(star, i);
      }
    }
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

    // Brief, localized star collection sparkle effect (non-blinding, mobile optimized)
    this._spawnStarSparkleBurst(worldPos);
    soundManager.playStar();
    this.showBanner(`STAR COLLECTED! +50 • ${this.starsCollected}/${this.starsTotal}`, 'star');
    this._updateHUD();
  }

  _spawnStarSparkleBurst(worldPos) {
    const count = this.isMobile ? 12 : 20;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = worldPos.x;
      positions[i * 3 + 1] = worldPos.y;
      positions[i * 3 + 2] = worldPos.z;

      // Soft warm gold and star-white sparkle colors
      const isGold = Math.random() > 0.3;
      colors[i * 3]     = 1.0;
      colors[i * 3 + 1] = isGold ? 0.82 : 0.95;
      colors[i * 3 + 2] = isGold ? 0.28 : 0.85;

      const angle = Math.random() * Math.PI * 2;
      const speed = 1.6 + Math.random() * 2.4;
      velocities.push({
        x: Math.cos(angle) * speed,
        y: 0.6 + Math.random() * 2.2,
        z: Math.sin(angle) * speed
      });
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: this.isMobile ? 0.22 : 0.28,
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
      age: 0.0,
      maxAge: 0.38
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

  _spawnSparkleBurst(worldPos) {
    const count = this.isMobile ? 24 : 60;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];

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
        x: Math.cos(angle) * speed,
        y: 1.5 + Math.random() * 5.0,
        z: Math.sin(angle) * speed
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
