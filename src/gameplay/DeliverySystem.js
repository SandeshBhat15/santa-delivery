import * as THREE from 'three';
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

    // Delivery thresholds
    this.deliveryRadius = 10.0; // Horizontal proximity to house center for valid drop
    this.minDropHeight = 0.4;   // Minimum height above roof target for natural drop
    this.maxDropHeight = 6.5;   // Maximum height above roof target for accurate drop (tuned to rooftop flight corridor)

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

    // Marker beacon visuals (floating glowing gift + vertical beam)
    this._initMarkerTemplate();
  }

  _initMarkerTemplate() {
    this.markerMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.85
    });

    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd152,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.deliveredMat = new THREE.MeshBasicMaterial({
      color: 0x2ecc71,
      transparent: true,
      opacity: 0.75
    });
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

  // Deterministic target selection for a chunk
  syncChunkTargets(chunkKey, cx, cz) {
    if (!this.chunkSystem || !this.chunkSystem.templateHouses) return;

    const isCenter = (cx === 0 && cz === 0);
    const chunkSize = this.chunkSystem.chunkSize;
    const worldChunkOrigin = new THREE.Vector3(cx * chunkSize, 0, cz * chunkSize);

    // Retrieve eligible house instances in this chunk
    let candidatePositions = [];

    if (isCenter) {
      // Pick 5 distinct houses evenly distributed around the central village
      const templateHouses = this.chunkSystem.templateHouses;
      // Filter out houses with suitable roof heights
      const sorted = [...templateHouses].sort((a, b) => {
        return (a.pos.x * 3.1 + a.pos.z * 7.3) - (b.pos.x * 3.1 + b.pos.z * 7.3);
      });

      // Deterministically pick exactly 5 houses using pseudo-random stride
      const step = Math.floor(sorted.length / 5);
      for (let i = 0; i < 5; i++) {
        const h = sorted[(i * step + 3) % sorted.length];
        const worldPos = new THREE.Vector3().copy(h.pos);
        // Roof drop target point (top of chimney / roof peak)
        worldPos.y += 1.8;
        candidatePositions.push({
          houseId: `center_village_house_${i}`,
          worldPos: worldPos
        });
      }
    } else {
      // Wilderness chunk settlement
      const chunkData = this.chunkSystem.chunks.get(chunkKey);
      if (chunkData && chunkData.houseGroup && chunkData.houseGroup.children.length > 0) {
        chunkData.houseGroup.children.forEach((mesh, idx) => {
          const worldPos = new THREE.Vector3(
            worldChunkOrigin.x + mesh.position.x,
            mesh.position.y + 1.8,
            worldChunkOrigin.z + mesh.position.z
          );
          candidatePositions.push({
            houseId: `wilderness_${chunkKey}_house_${idx}`,
            worldPos: worldPos
          });
        });
      }
    }

    // Register or restore tracked houses
    candidatePositions.forEach((cand) => {
      if (!this.trackedHouses.has(cand.houseId)) {
        this.trackedHouses.set(cand.houseId, {
          houseId: cand.houseId,
          chunkKey: chunkKey,
          worldPos: cand.worldPos,
          delivered: false,
          marker: null
        });
      }
    });

    this._updateVisualMarkers();
  }

  _updateVisualMarkers() {
    // Drop markers removed as requested for an immersive, clean environment.
    // Clean up any remaining markers from the scene
    if (this.markersGroup && this.markersGroup.children.length > 0) {
      this.markersGroup.clear();
    }
  }

  _createTargetMarker(worldPos) {
    const marker = new THREE.Group();
    marker.position.copy(worldPos);

    // 1. Floating glowing gift box
    const boxMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), boxMat);
    box.position.y = 1.0;
    marker.add(box);

    const ribbon = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.48, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xe74c3c })
    );
    ribbon.position.y = 1.0;
    marker.add(ribbon);

    // 2. Soft atmospheric beacon pillar (tapered cone with soft additive blend)
    const beamGeo = new THREE.ConeGeometry(0.45, 2.8, 12, 1, true);
    beamGeo.translate(0, 1.4, 0); // Ground to top
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffb300,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    marker.add(beam);

    // 3. Pulsing targeting circle on the roof
    const ringGeo = new THREE.RingGeometry(0.45, 0.75, 16);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffd700,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    }));
    ring.position.y = 0.05;
    marker.add(ring);

    marker.userData = { box, ribbon, ring, beam, basePos: worldPos.clone() };
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

    // 1. Animate active beacons
    this.markersGroup.children.forEach((marker) => {
      const u = marker.userData;
      if (u) {
        u.box.rotation.y = elapsedTime * 2.2;
        u.ribbon.rotation.y = elapsedTime * 2.2;
        u.box.position.y = 1.0 + Math.sin(elapsedTime * 3.5) * 0.12;
        u.ribbon.position.y = u.box.position.y;
        u.ring.scale.setScalar(0.95 + Math.sin(elapsedTime * 4.0) * 0.15);
      }
    });

    // 2. Animate falling gifts (smooth parabolic trajectory toward chimney)
    for (let i = this.activeGifts.length - 1; i >= 0; i--) {
      const gift = this.activeGifts[i];
      gift.progress += gift.dropSpeed * delta;

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
        // Parabolic arc lerp
        gift.mesh.position.lerpVectors(gift.startPos, gift.targetPos, t);
        // Add subtle arc bounce
        const arc = Math.sin(t * Math.PI) * 1.2;
        gift.mesh.position.y += arc;

        gift.mesh.rotation.x += gift.rotVel.x * delta;
        gift.mesh.rotation.y += gift.rotVel.y * delta;
        gift.mesh.rotation.z += gift.rotVel.z * delta;
      }
    }

    // 3. Update sparkle particle effects
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

    // 4. Update HUD and closest target compass
    this._updateTargetCompass();
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

    // Remove marker
    if (houseData.marker) {
      this.markersGroup.remove(houseData.marker);
      houseData.marker = null;
    }

    // Create celebratory sparkle burst at chimney
    this._spawnSparkleBurst(houseData.worldPos);
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

    // Find closest undelivered target
    let nearest = null;
    let nearestDist = Infinity;

    this.trackedHouses.forEach((houseData) => {
      if (houseData.delivered) return;
      if (!this.chunkSystem.chunks.has(houseData.chunkKey)) return;

      const d = sleighPos.distanceTo(houseData.worldPos);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = houseData;
      }
    });

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
