import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { soundManager } from './SoundManager.js';

export class DeliverySystem {
  constructor(scene, chunkSystem, sleighController, isMobile = false) {
    this.scene = scene;
    this.chunkSystem = chunkSystem;
    this.sleighController = sleighController;
    this.isMobile = isMobile;

    // Progression & stats
    this.giftsRemaining = 25;
    this.maxGifts = 25;
    this.totalDelivered = 0;
    this.combo = 0;
    this.score = 0;
    this.completedChunks = new Set();

    // Session persistence: Map of houseId -> { chunkKey, worldPos, delivered: boolean, markerGroup }
    this.trackedHouses = new Map();

    // Active markers pool
    this.markersGroup = new THREE.Group();
    this.markersGroup.name = 'DeliveryMarkersGroup';
    this.scene.add(this.markersGroup);

    // Falling gifts & active delivery sparks
    this.activeGifts = [];
    this.activeSparkles = [];

    // Current chunk tracking
    this.currentChunkKey = '0,0';
    this.currentChunkTargets = [];
    this.closestTarget = null;
    this.closestDistance = Infinity;

    // Delivery thresholds tuned to miniature house proportions (~0.28m wide) and flight corridor
    this.deliveryRadius = 1.8; // Horizontal proximity to house center for valid drop
    this.minDropHeight = 0.04; // Minimum height above roof target for natural drop
    this.maxDropHeight = 0.85; // Maximum height above roof target for accurate drop (calibrated to low flight level)

    // UI elements
    this._createHUD();

    // Gift geometry & materials (reused across drops)
    this.giftBoxGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    this.giftRibbonGeo = new THREE.BoxGeometry(0.57, 0.57, 0.14);
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
    // 1. Procedural High-DPI Canvas Textures matching the reference artwork
    this._beamTexture = this._createLightBeamTexture();
    this._starGlintTexture = this._createStarGlintTexture();
    this._haloTexture = this._createHaloTexture();
    this._checkmarkTexture = this._createCheckmarkTexture();
    this._snowflakeIconTexture = this._createSnowflakeIconTexture();

    // 2. 3D Volumetric Geometries calibrated to the miniature house models (~0.28m wide)
    // Slender vertical atmospheric light beam pillar: 14.0m high, 0.075m base radius
    this._beamGeo = new THREE.CylinderGeometry(0.045, 0.075, 14.0, 24, 1, true);
    this._beamGeo.translate(0, 7.0, 0);

    this.deliveredMat = new THREE.MeshBasicMaterial({
      color: 0x2ecc71,
      transparent: true,
      opacity: 0.75,
      fog: false
    });
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
      <div class="hud-card hud-top-right">
        <div class="hud-target-indicator">
          <div id="hud-compass-arrow" class="compass-arrow">▲</div>
          <div class="target-meta">
            <span class="target-title">NEXT CHIMNEY</span>
            <span id="hud-target-dist" class="target-dist">-- m</span>
            <span id="hud-delivery-status" class="delivery-status status-out-of-range">SEARCHING</span>
          </div>
        </div>
      </div>

      <div id="hud-banner" class="hud-banner hidden">
        <span id="hud-banner-text">PERFECT DELIVERY!</span>
      </div>

      <div id="mobile-controls-wrapper">
        <!-- Bottom-Left: Floating Virtual Flight Joystick (X: Turn/Roll, Y: Altitude/Climb/Dive) -->
        <div id="joystick-zone">
          <div id="joystick-base">
            <div id="joystick-thumb"></div>
          </div>
          <div class="control-label">FLIGHT STICK</div>
        </div>

        <!-- Bottom-Right: Large Drop Gift Button -->
        <div id="drop-zone">
          <button id="btn-drop-gift" class="btn-drop-large">
            <span class="drop-icon">🎁</span>
            <span class="drop-label">DROP GIFT</span>
          </button>
        </div>
      </div>
    `;

    container.appendChild(hud);

    this._setupVirtualJoystick();
    this._setupDropButton();
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

    const trigger = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.giftsRemaining <= 0) {
        this.refillGifts();
      } else {
        this.triggerDelivery();
      }
    };

    dropBtn.addEventListener('pointerdown', trigger);
    dropBtn.addEventListener('touchstart', trigger, { passive: false });
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

  // Deterministic target selection for a chunk (3 to 4 houses per chunk)
  syncChunkTargets(chunkKey, cx, cz) {
    if (!this.chunkSystem) return;

    const isCenter = (cx === 0 && cz === 0);
    const chunkSize = this.chunkSystem.chunkSize || 20.0;
    const worldChunkOrigin = new THREE.Vector3(cx * chunkSize, 0, cz * chunkSize);

    // Retrieve eligible house instances in this chunk
    let candidatePositions = [];

    if (isCenter && this.chunkSystem.templateHouses) {
      // Pick 4 signature houses across the 4 flight quadrants with exact rooftop surface contact positions right beside the chimney
      const targetSpecs = [
        { name: 'house4',    exactRoof: new THREE.Vector3(-1.140, 0.735, -5.080) }, // 1. Lakeside Chalet (North quadrant signature)
        { name: 'houseP_11', exactRoof: new THREE.Vector3(-2.880, 0.510, -2.420) }, // 2. South Street Chalet (South quadrant signature)
        { name: 'houseP_70', exactRoof: new THREE.Vector3(5.500, 0.768, -2.150) },  // 3. East Ridge Chalet (East quadrant signature)
        { name: 'houseP_23', exactRoof: new THREE.Vector3(-6.920, 0.490, -6.560) }  // 4. West Meadow Chalet (West quadrant signature)
      ];

      targetSpecs.forEach((spec, i) => {
        candidatePositions.push({
          houseId: `center_village_house_${i}`,
          worldPos: spec.exactRoof.clone()
        });
      });
    } else {
      // Wilderness chunk settlement: pick 3 or 4 houses deterministically
      const chunkData = this.chunkSystem.chunks.get(chunkKey);
      if (chunkData && chunkData.houseGroup && chunkData.houseGroup.children.length > 0) {
        const children = chunkData.houseGroup.children;
        // Deterministic target count: 3 or 4 houses based on chunk coordinates
        const targetCount = Math.min(children.length, (Math.abs(cx * 7 + cz * 13) % 2 === 0 ? 4 : 3));
        for (let idx = 0; idx < targetCount; idx++) {
          const mesh = children[idx];
          const worldPos = new THREE.Vector3(
            worldChunkOrigin.x + mesh.position.x + 0.025,
            mesh.position.y + 0.334,
            worldChunkOrigin.z + mesh.position.z + 0.003
          );
          candidatePositions.push({
            houseId: `wilderness_${chunkKey}_house_${idx}`,
            worldPos: worldPos
          });
        }
      }
    }

    // Register or restore tracked houses and spawn their stylized drop markers
    candidatePositions.forEach((cand) => {
      let houseData = this.trackedHouses.get(cand.houseId);
      if (!houseData) {
        houseData = {
          houseId: cand.houseId,
          chunkKey: chunkKey,
          worldPos: cand.worldPos.clone(),
          delivered: false,
          marker: null
        };
        this.trackedHouses.set(cand.houseId, houseData);
      } else {
        houseData.worldPos.copy(cand.worldPos);
      }

      // If not delivered and doesn't currently have an active visual marker in the scene, create one
      if (!houseData.delivered && !houseData.marker) {
        const marker = this._createTargetMarker(houseData);
        houseData.marker = marker;
        this.markersGroup.add(marker);
      }
    });

    this._updateVisualMarkers();
  }

  // Clean up visual markers when a chunk unloads while preserving delivery progress
  unloadChunkTargets(chunkKey) {
    this.trackedHouses.forEach((houseData) => {
      if (houseData.chunkKey === chunkKey && houseData.marker) {
        this.markersGroup.remove(houseData.marker);
        houseData.marker = null;
      }
    });
  }

  _updateVisualMarkers() {
    // Only maintain visual markers for current active chunk targets and closest target house
    this.trackedHouses.forEach((houseData) => {
      const isChunkActive = this.chunkSystem.chunks.has(houseData.chunkKey);
      const isRelevant = isChunkActive && (
        houseData.chunkKey === this.currentChunkKey ||
        (this.closestTarget && this.closestTarget.houseId === houseData.houseId)
      );

      if (isRelevant && !houseData.delivered && !houseData.marker) {
        const marker = this._createTargetMarker(houseData);
        houseData.marker = marker;
        this.markersGroup.add(marker);
      } else if ((!isRelevant || houseData.delivered) && houseData.marker && !houseData.marker.userData?.isFading) {
        this.markersGroup.remove(houseData.marker);
        houseData.marker = null;
      }
    });
  }

  _createTargetMarker(houseData) {
    const worldPos = houseData.worldPos;
    const marker = new THREE.Group();
    marker.position.copy(worldPos);
    marker.name = `Marker_${houseData.houseId}`;

    // 1. Tall vertical atmospheric light beam reaching high into the night sky (Panel 1, 2, 3)
    const beamMat = new THREE.MeshBasicMaterial({
      map: this._beamTexture,
      color: 0xffd152,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });
    beamMat.userData = { baseOpacity: 0.28 };
    const beamMesh = new THREE.Mesh(this._beamGeo, beamMat);
    marker.add(beamMesh);

    // 2. Subtle warm PointLight illuminating the snow on the roof beside the chimney
    const snowLight = new THREE.PointLight(0xffa63b, 0.015, 0.50, 1.0);
    snowLight.position.set(0, 0.04, 0);
    marker.add(snowLight);

    // 3. Floating Holographic Snowflake Medallion (Panel 2, 3, 4)
    const floatingIconGroup = new THREE.Group();
    floatingIconGroup.position.y = 0.18; // Hovering 18cm above roof ring

    // Soft celestial halo aura
    const haloMat = new THREE.SpriteMaterial({
      map: this._haloTexture,
      color: 0xffd152,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      fog: false
    });
    haloMat.userData = { baseOpacity: 0.35 };
    const haloSprite = new THREE.Sprite(haloMat);
    haloSprite.scale.set(0.20, 0.20, 0.20);
    floatingIconGroup.add(haloSprite);

    // Snowflake Medallion (crisp high-DPI sprite facing camera)
    const snowflakeMat = new THREE.SpriteMaterial({
      map: this._snowflakeIconTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      fog: false
    });
    snowflakeMat.userData = { baseOpacity: 0.95 };
    const snowflakeSprite = new THREE.Sprite(snowflakeMat);
    snowflakeSprite.scale.set(0.14, 0.14, 0.14);
    floatingIconGroup.add(snowflakeSprite);

    // In-Range Indicator: Floating Green Checkmark Badge (Panel 4)
    const checkmarkMat = new THREE.SpriteMaterial({
      map: this._checkmarkTexture,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      fog: false
    });
    checkmarkMat.userData = { baseOpacity: 0.98 };
    const checkmarkSprite = new THREE.Sprite(checkmarkMat);
    checkmarkSprite.scale.set(0.065, 0.065, 0.065);
    checkmarkSprite.position.y = 0.09; // Perched directly atop snowflake medallion
    checkmarkSprite.visible = false;
    floatingIconGroup.add(checkmarkSprite);

    marker.add(floatingIconGroup);

    // 4. Sparkle Particles: 4-Point Diamond Stars (Panel 2 & 3 callout)
    const sparkleCount = 18;
    const sparkleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(sparkleCount * 3);
    const sparkleVelocities = [];

    for (let p = 0; p < sparkleCount; p++) {
      const angle = Math.random() * Math.PI * 2;
      const rad = Math.random() * 0.065;
      positions[p * 3]     = Math.cos(angle) * rad;
      positions[p * 3 + 1] = 0.02 + Math.random() * 8.5;
      positions[p * 3 + 2] = Math.sin(angle) * rad;
      sparkleVelocities.push({
        y: 0.35 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2
      });
    }
    sparkleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const sparklesMat = new THREE.PointsMaterial({
      map: this._starGlintTexture,
      color: 0xffeb85,
      size: 0.055,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });
    sparklesMat.userData = { baseOpacity: 0.85 };
    const sparklesMesh = new THREE.Points(sparkleGeo, sparklesMat);
    marker.add(sparklesMesh);

    marker.userData = {
      houseData,
      basePos: worldPos.clone(),
      beamMesh,
      beamMat,
      snowLight,
      floatingIconGroup,
      snowflakeSprite,
      snowflakeMat,
      haloSprite,
      haloMat,
      checkmarkSprite,
      checkmarkMat,
      sparklesMesh,
      sparklesGeo: sparkleGeo,
      sparklesMat,
      sparkleCount,
      sparkleVelocities,
      inRange: false,
      isFading: false,
      fadeProgress: 0.0
    };

    return marker;
  }

  triggerDelivery() {
    if (this.giftsRemaining <= 0) {
      this.showBanner('OUT OF GIFTS! PRESS R TO REFILL', 'miss');
      soundManager.playMiss();
      return;
    }

    // Consume 1 gift
    this.giftsRemaining--;
    this._updateHUDGifts();

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

    // Check closest eligible undelivered house
    let bestTarget = null;
    let minDist = Infinity;
    let closestCandidate = null;
    let closestCandidateDist = Infinity;

    this.trackedHouses.forEach((houseData) => {
      if (houseData.delivered) return;
      if (!this.chunkSystem.chunks.has(houseData.chunkKey)) return;

      const horizDist = Math.hypot(
        startPos.x - houseData.worldPos.x,
        startPos.z - houseData.worldPos.z
      );
      const vertDist = startPos.y - houseData.worldPos.y;
      const totalDist = Math.hypot(horizDist, Math.max(0, vertDist));

      if (totalDist < closestCandidateDist) {
        closestCandidateDist = totalDist;
        closestCandidate = { houseData, horizDist, vertDist };
      }

      // Valid delivery range: suitable altitude above roof and within delivery radius
      if (horizDist <= this.deliveryRadius && vertDist >= this.minDropHeight && vertDist <= this.maxDropHeight) {
        if (horizDist < minDist) {
          minDist = horizDist;
          bestTarget = houseData;
        }
      }
    });

    // If missed drop, show a helpful hint
    if (!bestTarget && closestCandidate) {
      if (closestCandidate.vertDist > this.maxDropHeight) {
        this.showBanner('MISSED DROP: FLY LOWER OVER TARGET!', 'miss');
      } else if (closestCandidate.vertDist < this.minDropHeight) {
        this.showBanner('MISSED DROP: FLY HIGHER ABOVE ROOF!', 'miss');
      } else if (closestCandidate.horizDist > this.deliveryRadius) {
        this.showBanner('MISSED DROP: GET CLOSER TO CHIMNEY!', 'miss');
      }
    }

    this.activeGifts.push({
      mesh: giftGroup,
      startPos: startPos.clone(),
      targetHouse: bestTarget,
      isSuccess: !!bestTarget,
      targetPos: bestTarget ? bestTarget.worldPos.clone() : new THREE.Vector3(startPos.x, Math.max(0, startPos.y - 12), startPos.z),
      progress: 0.0,
      dropSpeed: 1.6, // Drop trajectory speed
      rotVel: new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 6
      )
    });
  }

  refillGifts() {
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
      if (this.giftsRemaining <= 0) {
        btn.classList.add('out-of-gifts');
        btn.querySelector('.drop-label').textContent = 'REFILL GIFTS';
      } else {
        btn.classList.remove('out-of-gifts');
        btn.querySelector('.drop-label').textContent = 'DROP GIFT';
      }
    }
  }

  update(delta, elapsedTime) {
    if (delta <= 0) return;

    // 0. Update target compass and active target selection first
    this._updateTargetCompass();

    const sleighPos = this.sleighController.position;
    const camera = this.sleighController?.camera;

    // 1. Animate active stylized drop markers
    for (let i = this.markersGroup.children.length - 1; i >= 0; i--) {
      const marker = this.markersGroup.children[i];
      const u = marker.userData;
      if (!u) continue;

      // Handle delivery completion smooth fade-out (Panel 7)
      if (u.isFading) {
        u.fadeProgress += delta * 1.5; // ~0.7s smooth dissolve
        const alpha = Math.max(0.0, 1.0 - u.fadeProgress);
        marker.traverse((child) => {
          if (child.material) {
            const baseOp = child.userData?.baseOpacity !== undefined ? child.userData.baseOpacity : 0.85;
            child.material.opacity = baseOp * alpha;
          }
        });
        if (u.fadeProgress >= 1.0) {
          this.markersGroup.remove(marker);
          if (u.houseData) u.houseData.marker = null;
        }
        continue;
      }

      // Billboard the floating holographic icon group towards camera
      if (camera && u.floatingIconGroup) {
        u.floatingIconGroup.quaternion.copy(camera.quaternion);
      }

      // Proximity & vertical altitude check to Santa's current position
      const horizDist = Math.hypot(sleighPos.x - u.basePos.x, sleighPos.z - u.basePos.z);
      const vertDist = sleighPos.y - u.basePos.y;
      const isInRange = (
        !u.houseData.delivered &&
        horizDist <= this.deliveryRadius &&
        vertDist >= this.minDropHeight &&
        vertDist <= this.maxDropHeight
      );

      // Clean visual hierarchy matching Panel 1 (Distant View):
      // Only the active primary target displays the vertical sky beam!
      const isActiveTarget = (this.closestTarget && this.closestTarget.houseId === u.houseData.houseId);
      if (isActiveTarget) {
        u.beamMesh.visible = true;
        u.beamMat.opacity = u.beamMat.userData.baseOpacity * (u.inRange ? 0.85 : 0.58);
        u.beamMesh.scale.set(1.0, 1.0, 1.0);
      } else {
        u.beamMesh.visible = false;
      }

      // Dynamic State Transitions: Default (Warm Gold) <-> In-Range (Vibrant Emerald Green)
      if (isInRange !== u.inRange) {
        u.inRange = isInRange;
        if (isInRange) {
          u.snowflakeMat.color.setHex(0x2ecc71);
          u.haloMat.color.setHex(0x2ecc71);
          u.beamMat.color.setHex(0x2ecc71);
          u.snowLight.color.setHex(0x2ecc71);
          u.checkmarkSprite.visible = true;
        } else {
          u.snowflakeMat.color.setHex(0xffffff);
          u.haloMat.color.setHex(0xffd152);
          u.beamMat.color.setHex(0xffd152);
          u.snowLight.color.setHex(0xffa63b);
          u.checkmarkSprite.visible = false;
        }
      }

      // Floating Snowflake smooth vertical sinusoidal bobbing
      const bobFreq = u.inRange ? 4.5 : 2.5;
      const bobAmp = u.inRange ? 0.024 : 0.016;
      u.floatingIconGroup.position.y = 0.22 + Math.sin(elapsedTime * bobFreq) * bobAmp;

      // Animated checkmark pulse when in range (Panel 4)
      if (u.inRange) {
        const pulse = 0.08 * (1.0 + Math.sin(elapsedTime * 6.0) * 0.18);
        u.checkmarkSprite.scale.set(pulse, pulse, pulse);
      }

      // Light beam slow rotation for ethereal god rays
      u.beamMesh.rotation.y += delta * 0.22;

      // Ambient 4-point diamond star particles drifting upward inside the light beam
      const posAttr = u.sparklesGeo.attributes.position;
      const vels = u.sparkleVelocities;
      for (let p = 0; p < u.sparkleCount; p++) {
        let y = posAttr.getY(p) + vels[p].y * delta;
        if (y > 7.5) y = 0.02;
        posAttr.setY(p, y);
        const wobbleX = Math.sin(elapsedTime * 1.5 + vels[p].phase) * 0.001;
        const wobbleZ = Math.cos(elapsedTime * 1.5 + vels[p].phase) * 0.001;
        posAttr.setX(p, posAttr.getX(p) + wobbleX);
        posAttr.setZ(p, posAttr.getZ(p) + wobbleZ);
      }
      posAttr.needsUpdate = true;
    }

    // 2. Animate falling gifts with golden sparkle trailing motes (Panel 5)
    for (let i = this.activeGifts.length - 1; i >= 0; i--) {
      const gift = this.activeGifts[i];
      gift.progress += gift.dropSpeed * delta;

      // Spawn golden diamond particle trail behind tumbling gift (Panel 5)
      if (Math.random() < 0.75) {
        this._spawnTrailSparkle(gift.mesh.position);
      }

      if (gift.progress >= 1.0) {
        // Impact
        this.scene.remove(gift.mesh);
        this.activeGifts.splice(i, 1);

        if (gift.isSuccess && gift.targetHouse && !gift.targetHouse.delivered) {
          this._handleSuccessfulDelivery(gift.targetHouse);
        } else {
          this._handleMissedDelivery(gift.targetPos);
        }
      } else {
        const t = gift.progress;
        // Parabolic arc lerp toward chimney
        gift.mesh.position.lerpVectors(gift.startPos, gift.targetPos, t);
        // Add parabolic gravity arc
        const arc = Math.sin(t * Math.PI) * 1.2;
        gift.mesh.position.y += arc;

        gift.mesh.rotation.x += gift.rotVel.x * delta;
        gift.mesh.rotation.y += gift.rotVel.y * delta;
        gift.mesh.rotation.z += gift.rotVel.z * delta;
      }
    }

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

  // Radial sunburst light rays shooting outward from chimney upon impact (Panel 6)
  _spawnDeliverySunburst(worldPos) {
    const rayCount = 12;
    const rayGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(rayCount * 2 * 3);
    const colors = new Float32Array(rayCount * 2 * 3);
    const rayDirs = [];

    for (let r = 0; r < rayCount; r++) {
      const angle = (r / rayCount) * Math.PI * 2;
      const elev = 0.2 + (r % 3) * 0.35;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const dy = elev;
      const len = Math.hypot(dx, dy, dz);
      rayDirs.push(new THREE.Vector3(dx / len, dy / len, dz / len));

      positions[r * 6]     = worldPos.x;
      positions[r * 6 + 1] = worldPos.y;
      positions[r * 6 + 2] = worldPos.z;
      colors[r * 6]     = 1.0;
      colors[r * 6 + 1] = 0.95;
      colors[r * 6 + 2] = 0.65;

      positions[r * 6 + 3] = worldPos.x + dx * 0.06;
      positions[r * 6 + 4] = worldPos.y + dy * 0.06;
      positions[r * 6 + 5] = worldPos.z + dz * 0.06;
      colors[r * 6 + 3] = 1.0;
      colors[r * 6 + 4] = 0.75;
      colors[r * 6 + 5] = 0.15;
    }

    rayGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    rayGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const rayMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });

    const rayLines = new THREE.LineSegments(rayGeo, rayMat);
    this.scene.add(rayLines);

    const startTime = performance.now();
    const duration = 800; // 0.8s burst

    const animateRays = () => {
      const elapsed = performance.now() - startTime;
      const progress = elapsed / duration;
      if (progress >= 1.0) {
        this.scene.remove(rayLines);
        rayLines.geometry.dispose();
        rayMat.dispose();
      } else {
        const expand = Math.sin(progress * Math.PI * 0.5) * 0.55;
        const posAttr = rayLines.geometry.attributes.position;
        for (let r = 0; r < rayCount; r++) {
          const dir = rayDirs[r];
          posAttr.setXYZ(r * 2 + 1, worldPos.x + dir.x * expand, worldPos.y + dir.y * expand, worldPos.z + dir.z * expand);
        }
        posAttr.needsUpdate = true;
        rayMat.opacity = Math.max(0, 1.0 - progress);
        requestAnimationFrame(animateRays);
      }
    };
    requestAnimationFrame(animateRays);
  }

  // Cozy warm facade and roof light pulse illuminating house upon successful delivery (Panel 6)
  _pulseHouseGlow(worldPos) {
    const light = new THREE.PointLight(0xffa63b, 3.5, 9.0, 1.8);
    light.position.copy(worldPos).add(new THREE.Vector3(0, 0.4, 0));
    this.scene.add(light);

    const startTime = performance.now();
    const duration = 2500; // 2.5 seconds warm house illumination

    const animateLight = () => {
      const elapsed = performance.now() - startTime;
      const progress = elapsed / duration;
      if (progress >= 1.0) {
        this.scene.remove(light);
        light.dispose();
      } else {
        light.intensity = 3.5 * (1.0 - Math.pow(progress, 0.7));
        requestAnimationFrame(animateLight);
      }
    };
    requestAnimationFrame(animateLight);
  }

  _handleSuccessfulDelivery(houseData) {
    houseData.delivered = true;
    this.totalDelivered++;
    this.combo++;

    // Calculate score
    const basePoints = 100;
    const comboBonus = (this.combo - 1) * 25;
    const points = basePoints + comboBonus;
    this.score += points;

    // Start smooth fade-out of marker (Panel 7)
    if (houseData.marker && houseData.marker.userData) {
      houseData.marker.userData.isFading = true;
    }

    // Create celebratory sparkle burst, radial sunburst rays & warm house light pulse (Panel 6)
    this._spawnSparkleBurst(houseData.worldPos);
    this._spawnDeliverySunburst(houseData.worldPos);
    this._pulseHouseGlow(houseData.worldPos);
    soundManager.playSuccess();

    this.showBanner(`GIFT DELIVERED! +${points} PTS (x${this.combo} COMBO)`, 'success');

    // Check chunk completion
    this._checkChunkCompletion(houseData.chunkKey);

    // Update HUD
    const totalEl = document.getElementById('hud-total-delivered');
    if (totalEl) totalEl.textContent = this.totalDelivered;
    const scoreEl = document.getElementById('hud-score');
    if (scoreEl) scoreEl.textContent = this.score;
  }

  _handleMissedDelivery(missPos) {
    this.combo = 0;
    this._spawnPuffCloud(missPos);
    soundManager.playMiss();
    this.showBanner('MISSED THE CHIMNEY! TRY AGAIN', 'miss');
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
    const sleighHeading = this.sleighController.rotationY;

    // Detect current chunk under sleigh
    const chunkSize = this.chunkSystem ? this.chunkSystem.chunkSize : 20.0;
    const half = chunkSize * 0.5;
    const currentCx = Math.floor((sleighPos.x + half) / chunkSize);
    const currentCz = Math.floor((sleighPos.z + half) / chunkSize);
    const currentKey = `${currentCx},${currentCz}`;

    if (currentKey !== this.currentChunkKey) {
      this.currentChunkKey = currentKey;
      this.syncChunkTargets(currentKey, currentCx, currentCz);
    }

    // Update chunk progress HUD
    const chunkHouses = Array.from(this.trackedHouses.values())
      .filter(h => h.chunkKey === this.currentChunkKey);
    const deliveredCount = chunkHouses.filter(h => h.delivered).length;
    const totalCount = chunkHouses.length;

    const progEl = document.getElementById('hud-chunk-progress');
    if (progEl) progEl.textContent = `${deliveredCount} / ${totalCount}`;

    // Find closest undelivered target: prioritize current chunk goals first
    let nearest = null;
    let nearestDist = Infinity;

    this.trackedHouses.forEach((houseData) => {
      if (houseData.delivered) return;
      if (!this.chunkSystem.chunks.has(houseData.chunkKey)) return;
      if (houseData.chunkKey !== this.currentChunkKey) return;

      const d = sleighPos.distanceTo(houseData.worldPos);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = houseData;
      }
    });

    // If current chunk is completed, locate closest undelivered house across any loaded chunk
    if (!nearest) {
      this.trackedHouses.forEach((houseData) => {
        if (houseData.delivered) return;
        if (!this.chunkSystem.chunks.has(houseData.chunkKey)) return;

        const d = sleighPos.distanceTo(houseData.worldPos);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = houseData;
        }
      });
    }

    this.closestTarget = nearest;
    this.closestDistance = nearestDist;

    // Update distance & compass arrow
    const distEl = document.getElementById('hud-target-dist');
    const arrowEl = document.getElementById('hud-compass-arrow');
    const statusEl = document.getElementById('hud-delivery-status');

    if (nearest && distEl && arrowEl) {
      distEl.textContent = `${Math.round(nearestDist)} m`;

      // Angle from sleigh to target in horizontal XZ plane
      const dx = nearest.worldPos.x - sleighPos.x;
      const dz = nearest.worldPos.z - sleighPos.z;
      const targetAngle = Math.atan2(-dx, -dz);

      // Relative angle compared to sleigh heading
      const relAngle = targetAngle - sleighHeading;
      const deg = THREE.MathUtils.radToDeg(relAngle);
      arrowEl.style.transform = `rotate(${deg}deg)`;

      // Delivery range calculation
      const horizDist = Math.hypot(dx, dz);
      const vertDist = sleighPos.y - nearest.worldPos.y;

      if (statusEl) {
        if (horizDist <= this.deliveryRadius && vertDist >= this.minDropHeight && vertDist <= this.maxDropHeight) {
          statusEl.textContent = 'READY TO DROP!';
          statusEl.className = 'delivery-status status-in-range';
        } else if (horizDist <= this.deliveryRadius && vertDist > this.maxDropHeight) {
          statusEl.textContent = 'TOO HIGH (DESCEND)';
          statusEl.className = 'delivery-status status-too-high';
        } else if (horizDist <= this.deliveryRadius && vertDist < this.minDropHeight) {
          statusEl.textContent = 'TOO LOW (CLIMB)';
          statusEl.className = 'delivery-status status-too-low';
        } else if (horizDist <= this.deliveryRadius * 1.8) {
          statusEl.textContent = 'APPROACHING...';
          statusEl.className = 'delivery-status status-out-of-range';
        } else {
          statusEl.textContent = 'IN FLIGHT';
          statusEl.className = 'delivery-status status-out-of-range';
        }
      }
    } else if (distEl && arrowEl) {
      distEl.textContent = 'ALL CLEAR';
      arrowEl.style.transform = 'rotate(0deg)';
      if (statusEl) {
        statusEl.textContent = 'CHUNK DONE';
        statusEl.className = 'delivery-status status-in-range';
      }
    }
  }
}
