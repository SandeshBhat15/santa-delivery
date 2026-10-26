import * as THREE from 'three';

/**
 * =============================================================================
 * MAGICAL FLIGHT TRAIL — ENCHANTED CHRISTMAS DUST
 * =============================================================================
 * A sparse, delicate plume of tiny warm-golden sparkles that follows the
 * sleigh's actual world-space flight path.
 *
 * LOOK
 * - Distance-based emission along the frame's movement segment: the trail
 *   bends through turns and follows climbs/dives by construction.
 * - Natural gaps: spacing is several sprite diameters wide, and is randomized
 *   so the dust never reads as a dotted line or a solid band.
 * - Varied size / brightness / lifetime, gentle air drift, shrink + fade.
 * - Occasional four-point star glints and a few soft icy-blue motes.
 * - Soft round sprites with restrained additive blending and a hard near-lens
 *   size clamp, so nothing becomes a square or an opaque blob.
 *
 * INTEGRATION
 * - One THREE.Points object, one material, one preallocated particle pool.
 * - No per-frame allocation, no buffer uploads while idle.
 * - Mobile gets fewer particles, wider spacing and a lower size clamp.
 */

// --- Tuning ----------------------------------------------------------------
const SPACING_DESKTOP = 0.006;   // metres of travel between emission steps
const SPACING_MOBILE  = 0.008;
const MAX_SPAWNS_FRAME_DESKTOP = 48;
const MAX_SPAWNS_FRAME_MOBILE  = 32;

const MAX_PARTICLES_DESKTOP = 1200;
const MAX_PARTICLES_MOBILE  = 720;

const BACK_OFFSET = 0.11;        // anchor sits just behind the sleigh body
const DOWN_OFFSET = 0.030;       // ...and level with the rear rail

const TRAIL_HALF_WIDTH = 0.045;  // base plume radius (metres)
const TURN_SPREAD      = 0.080;  // extra lateral spread at full bank

export class MagicalFlightTrail {
  constructor(scene, camera = null, isMobile = false) {
    this.scene = scene;
    this.camera = camera;
    this.isMobile = isMobile;

    this.maxParticles = isMobile ? MAX_PARTICLES_MOBILE : MAX_PARTICLES_DESKTOP;
    this.spacing = isMobile ? SPACING_MOBILE : SPACING_DESKTOP;
    this.maxSpawnsPerFrame = isMobile ? MAX_SPAWNS_FRAME_MOBILE : MAX_SPAWNS_FRAME_DESKTOP;

    this.particlePool = new Array(this.maxParticles);
    this.nextParticleIdx = 0;
    this.activeCount = 0;
    this._wasActive = false;

    // Warm holiday palette, kept close to the bloom threshold so the dust
    // glows softly instead of blowing out into a white band.
    this.colorGold     = new THREE.Color(1.00, 0.66, 0.22);
    this.colorSunGold  = new THREE.Color(1.10, 0.82, 0.38);
    this.colorWarmWhite= new THREE.Color(1.18, 1.04, 0.78);
    this.colorIce      = new THREE.Color(0.45, 0.74, 1.00);

    // Reused scratch state (world path + turn spread).
    this._prevAnchor = new THREE.Vector3();
    this._anchor     = new THREE.Vector3();
    this._spawnPos   = new THREE.Vector3();
    this._heading    = new THREE.Vector3(0, 0, -1);
    this._rightVec   = new THREE.Vector3(1, 0, 0);

    this._hasPrevAnchor = false;
    this._distToNext = this.spacing * 0.5;
    this._turnFactor = 0;

    this._initParticlePool();
    this._initPointsMesh();
  }

  _initParticlePool() {
    for (let i = 0; i < this.maxParticles; i++) {
      this.particlePool[i] = {
        active: false,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        life: 0.0,
        invLife: 1.0,
        baseSize: 0.007,
        baseAlpha: 0.6,
        r: 1.0, g: 0.72, b: 0.30,
        type: 0.0,       // 0 = golden dust, 1 = four-point glint, 2 = icy mote
        rotSpeed: 0.0,
        rotPhase: 0.0,
        twinkleSpeed: 6.0,
        twinklePhase: 0.0
      };
    }
  }

  _initPointsMesh() {
    this.geometry = new THREE.BufferGeometry();

    this.posArray   = new Float32Array(this.maxParticles * 3);
    this.colorArray = new Float32Array(this.maxParticles * 3);
    this.sizeArray  = new Float32Array(this.maxParticles);
    this.alphaArray = new Float32Array(this.maxParticles);
    this.typeArray  = new Float32Array(this.maxParticles);
    this.rotArray   = new Float32Array(this.maxParticles);

    this.posAttr   = new THREE.BufferAttribute(this.posArray, 3);
    this.colorAttr = new THREE.BufferAttribute(this.colorArray, 3);
    this.sizeAttr  = new THREE.BufferAttribute(this.sizeArray, 1);
    this.alphaAttr = new THREE.BufferAttribute(this.alphaArray, 1);
    this.typeAttr  = new THREE.BufferAttribute(this.typeArray, 1);
    this.rotAttr   = new THREE.BufferAttribute(this.rotArray, 1);

    for (const a of [this.posAttr, this.colorAttr, this.sizeAttr, this.alphaAttr, this.typeAttr, this.rotAttr]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aColor', this.colorAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aType', this.typeAttr);
    this.geometry.setAttribute('aRot', this.rotAttr);

    this._lastFov = 0;
    this._lastViewportH = 0;
    this._lastDpr = 0;

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        // Calibrated in _updatePointScale() so a particle has the same apparent
        // screen size on any viewport height, FOV or device pixel ratio.
        uPointScale: { value: 480.0 },
        uMinSize: { value: 1.0 },
        // Hard cap prevents close-to-lens sprites becoming large glowing blobs.
        uMaxSize: { value: this.isMobile ? 40.0 : 56.0 },
        // Warm, luminous dust. Sized so bloom adds a soft halo without the
        // additive plume blowing out into a white band.
        uBrightness: { value: 0.94 },
        uFogNear: { value: 3.5 },
        uFogFar: { value: 25.0 }
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute float aType;
        attribute float aRot;
        attribute vec3 aColor;

        uniform float uPointScale;
        uniform float uMinSize;
        uniform float uMaxSize;

        varying vec3 vColor;
        varying float vAlpha;
        varying float vType;
        varying float vRot;
        varying float vEyeDist;

        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vType = aType;
          vRot = aRot;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float eyeDist = max(-mvPosition.z, 0.05);
          vEyeDist = eyeDist;

          float sizePx = (aSize * uPointScale) / eyeDist;
          sizePx = clamp(sizePx, uMinSize, uMaxSize);

          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = sizePx;
        }
      `,
      fragmentShader: `
        uniform float uFogNear;
        uniform float uFogFar;
        uniform float uBrightness;

        varying vec3 vColor;
        varying float vAlpha;
        varying float vType;
        varying float vRot;
        varying float vEyeDist;

        void main() {
          if (vAlpha <= 0.003) discard;

          vec2 uv = gl_PointCoord - vec2(0.5);
          float dist = length(uv) * 2.0;
          if (dist > 1.0) discard;

          float shape = 0.0;

          if (vType < 0.5) {
            // --- Tiny golden dust mote: soft halo with a small hot center ---
            float halo = exp(-dist * dist * 3.4);
            float core = exp(-dist * dist * 12.0);
            shape = halo * 0.55 + core * 0.95;
          } else if (vType < 1.5) {
            // --- Occasional four-point star glint (thin diffraction rays) ---
            float cosA = cos(vRot);
            float sinA = sin(vRot);
            vec2 rotUv = vec2(
              uv.x * cosA - uv.y * sinA,
              uv.x * sinA + uv.y * cosA
            );

            float ax = abs(rotUv.x);
            float ay = abs(rotUv.y);
            float rayX = max(0.0, 1.0 - ax * 2.3) * exp(-ay * ay * 150.0);
            float rayY = max(0.0, 1.0 - ay * 2.3) * exp(-ax * ax * 150.0);
            float bulb = exp(-dist * dist * 20.0);

            shape = (rayX + rayY) * 1.35 + bulb * 0.55;
          } else {
            // --- Soft icy mote: cool, diffuse, no hard edge ---
            shape = exp(-dist * dist * 4.2) * (1.0 - smoothstep(0.82, 1.0, dist));
          }

          // Radial falloff that reaches zero inside the quad, so the sprite
          // edge can never show up as a square against the night sky.
          shape *= 1.0 - smoothstep(0.64, 0.96, dist);

          // Dissipate if the dust drifts right up to the lens.
          float nearFade = smoothstep(0.04, 0.16, vEyeDist);

          // Respect the scene's winter fog so the dust belongs in the world.
          float fogFactor = clamp(
            (vEyeDist - uFogNear) / max(uFogFar - uFogNear, 0.001),
            0.0,
            1.0
          );
          float fogFade = 1.0 - smoothstep(0.0, 1.0, fogFactor);

          float finalAlpha = shape * vAlpha * nearFade * fogFade;
          if (finalAlpha <= 0.004) discard;

          // Stay just under the bloom threshold: the soft halo is the glow.
          vec3 finalRgb = vColor * finalAlpha * uBrightness;
          gl_FragColor = vec4(finalRgb, finalAlpha);
        }
      `
    });

    this.pointsMesh = new THREE.Points(this.geometry, this.material);
    this.pointsMesh.name = 'MagicalFlightDust';
    this.pointsMesh.frustumCulled = false;
    this.pointsMesh.renderOrder = 3;
    this.scene.add(this.pointsMesh);

    this._updatePointScale();
  }

  /**
   * Converts a world-space particle diameter into a gl_PointSize that looks
   * identical on any viewport height, field of view or device pixel ratio.
   * Runs only when the viewport or camera actually changes (never per frame).
   */
  _updatePointScale() {
    if (typeof window === 'undefined') return;

    const viewportH = window.innerHeight || 900;
    const dpr = Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.5 : 2.0);
    const fov = ((this.camera && this.camera.fov) || 50) * (Math.PI / 180);

    this.material.uniforms.uPointScale.value =
      (viewportH * dpr * 0.5) / Math.max(Math.tan(fov * 0.5), 0.001);
    // Clamps are expressed in CSS pixels, then converted to framebuffer pixels.
    this.material.uniforms.uMinSize.value = 1.0 * dpr;
    this.material.uniforms.uMaxSize.value = (this.isMobile ? 40.0 : 56.0) * dpr;

    this._lastFov = (this.camera && this.camera.fov) || 50;
    this._lastViewportH = viewportH;
    this._lastDpr = dpr;
  }

  _spawnParticleAt(pos) {
    if (this.nextParticleIdx >= this.maxParticles) {
      this.nextParticleIdx = 0;
    }
    const p = this.particlePool[this.nextParticleIdx++];

    p.active = true;
    p.life = 1.0;
    p.invLife = 1.0 / (1.1 + Math.random() * 1.1); // 1.1 - 2.2 s lifetime
    p.rotSpeed = (Math.random() - 0.5) * 0.9;
    p.rotPhase = Math.random() * Math.PI * 2;
    p.twinkleSpeed = 4.0 + Math.random() * 7.0;
    p.twinklePhase = Math.random() * Math.PI * 2;

    // Center-weighted lateral scatter: a slender ribbon of dust, never two
    // parallel rails. Turns open the spread and push the dust outward.
    const spread = TRAIL_HALF_WIDTH + Math.abs(this._turnFactor) * TURN_SPREAD;
    const lateral = (Math.random() + Math.random() - 1.0) * spread;
    const vertJitter = (Math.random() - 0.5) * 0.035;
    const alongJitter = (Math.random() - 0.5) * 0.014;

    const right = this._rightVec;
    p.x = pos.x + right.x * lateral + this._heading.x * alongJitter;
    p.y = pos.y + DOWN_OFFSET + vertJitter;
    p.z = pos.z + right.z * lateral + this._heading.z * alongJitter;

    // Gentle settling air drift. Outward push is stronger in banked turns.
    const outward = this._turnFactor * 0.048;
    p.vx = right.x * ((Math.random() - 0.5) * 0.024 + outward);
    p.vy = -0.008 + Math.random() * 0.016;
    p.vz = right.z * ((Math.random() - 0.5) * 0.024 + outward);

    const rand = Math.random();

    if (rand < 0.945) {
      // --- Warm golden dust, the backbone of the plume ---
      p.type = 0.0;
      const col = Math.random() < 0.68 ? this.colorGold : this.colorSunGold;
      p.r = col.r; p.g = col.g; p.b = col.b;

      // Mostly tiny motes, occasional brighter fleck.
      if (Math.random() < 0.14) {
        p.baseSize = 0.017 + Math.random() * 0.007;
        p.baseAlpha = 0.72 + Math.random() * 0.18;
      } else {
        p.baseSize = 0.0085 + Math.random() * 0.006;
        p.baseAlpha = 0.62 + Math.random() * 0.28;
      }
    } else if (rand < 0.985) {
      // --- Occasional four-point star glint ---
      p.type = 1.0;
      const col = Math.random() < 0.6 ? this.colorSunGold : this.colorWarmWhite;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.015 + Math.random() * 0.006;
      p.baseAlpha = 0.66 + Math.random() * 0.22;
      p.twinkleSpeed = 8.0 + Math.random() * 6.0;
    } else {
      // --- A few subtle icy-blue motes to complement the gold ---
      p.type = 2.0;
      const col = this.colorIce;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.006 + Math.random() * 0.0035;
      p.baseAlpha = 0.36 + Math.random() * 0.16;
      p.vy = -0.004 + Math.random() * 0.008;
    }
  }

  reset() {
    this._hasPrevAnchor = false;
    this._distToNext = this.spacing * 0.5;
    this.activeCount = 0;
    this.nextParticleIdx = 0;
    this._wasActive = false;

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particlePool[i];
      p.active = false;
      p.life = 0.0;
      this.alphaArray[i] = 0.0;
      this.sizeArray[i] = 0.0;
    }

    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  update(delta, flightState) {
    const dt = THREE.MathUtils.clamp(delta, 0.001, 0.1);
    const time = flightState.animTime || 0.0;

    // Recalibrate only when the viewport or camera FOV actually changes.
    if (typeof window !== 'undefined') {
      const camFov = (this.camera && this.camera.fov) || 50;
      const viewportH = window.innerHeight || 0;
      const dpr = Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.5 : 2.0);
      if (camFov !== this._lastFov || viewportH !== this._lastViewportH || dpr !== this._lastDpr) {
        this._updatePointScale();
      }
    }

    if (this.scene.fog && this.material) {
      this.material.uniforms.uFogNear.value = this.scene.fog.near;
      this.material.uniforms.uFogFar.value = this.scene.fog.far;
    }

    const pos = flightState.position ||
      ((typeof window !== 'undefined' && window.sleighController) ? window.sleighController.position : null) ||
      (typeof window !== 'undefined' ? window.game?.sleighController?.position : null);
    const speed = Math.max(0.0, flightState.speed || 0.0);
    const isMoving = speed > 0.25 && !!pos;

    const heading = flightState.heading || this._heading;
    this._heading.copy(heading);
    if (pos) {
      // Anchor at the sleigh's rear so the dust is born behind, not inside it.
      this._anchor.set(
        pos.x - heading.x * BACK_OFFSET,
        pos.y,
        pos.z - heading.z * BACK_OFFSET
      );
    } else {
      this._anchor.copy(this._prevAnchor);
    }

    // Bank tells us how hard the sleigh is turning: 0 = straight flight.
    const bankMax = 0.38;
    this._turnFactor = THREE.MathUtils.clamp((flightState.bank || 0) / bankMax, -1.0, 1.0);
    this._rightVec.set(-heading.z, 0, heading.x);
    if (this._rightVec.lengthSq() < 1e-6) {
      this._rightVec.set(1, 0, 0);
    } else {
      this._rightVec.normalize();
    }

    // --- Distance-based emission along the real world-space path ---
    let spawnedThisFrame = 0;
    if (isMoving && this._hasPrevAnchor) {
      const segLen = this._anchor.distanceTo(this._prevAnchor);
      const teleportLen = Math.max(1.2, speed * dt * 3.0 + 0.35);

      if (segLen > teleportLen) {
        // Reset/jump: drop the old path rather than drawing a long streak.
        this._distToNext = this.spacing * 0.5;
      } else if (segLen > 1e-5) {
        let remaining = segLen;
        let travelled = 0.0;

        if (this._distToNext <= 0.0001) {
          this._distToNext = this.spacing * 0.5;
        }

        while (remaining >= this._distToNext && spawnedThisFrame < this.maxSpawnsPerFrame) {
          travelled += this._distToNext;
          remaining -= this._distToNext;

          const t = travelled / segLen;
          this._spawnPos.lerpVectors(this._prevAnchor, this._anchor, t);
          this._spawnParticleAt(this._spawnPos);
          spawnedThisFrame++;

          // Lightly randomized spacing: a continuous plume that still
          // breathes, without the gaps turning into a scattered dot line.
          this._distToNext = this.spacing * (0.78 + Math.random() * 0.55);
        }

        this._distToNext -= remaining;
        if (this._distToNext < 0.0001) {
          this._distToNext = this.spacing * 0.5;
        }
      }
    } else if (!isMoving) {
      this._distToNext = this.spacing * 0.5;
    }

    this._prevAnchor.copy(this._anchor);
    this._hasPrevAnchor = true;

    // --- Simulate the pool and fill the shared buffers ---
    let activeCount = 0;
    const dragFactor = Math.exp(-1.6 * dt);

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particlePool[i];
      if (!p.active) continue;

      p.life -= dt * p.invLife;
      if (p.life <= 0.0) {
        p.active = false;
        this.alphaArray[i] = 0.0;
        this.sizeArray[i] = 0.0;
        continue;
      }

      activeCount++;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      p.vx *= dragFactor;
      p.vy *= dragFactor;
      p.vz *= dragFactor;

      const age = 1.0 - p.life;
      const fadeIn = Math.min(1.0, age / 0.08);
      // Hold the sparkle's brightness through most of its life, then dissolve.
      const fadeOut = Math.min(1.0, p.life / 0.45);
      const twinkle = 0.72 + 0.28 * Math.sin(time * p.twinkleSpeed + p.twinklePhase);

      // Shrink and soften as the mote ages.
      const size = p.baseSize * (1.0 - age * 0.55);
      const alpha = p.baseAlpha * fadeIn * fadeOut * twinkle;

      p.rotPhase += p.rotSpeed * dt;

      const i3 = i * 3;
      this.posArray[i3]     = p.x;
      this.posArray[i3 + 1] = p.y;
      this.posArray[i3 + 2] = p.z;

      this.colorArray[i3]     = p.r;
      this.colorArray[i3 + 1] = p.g;
      this.colorArray[i3 + 2] = p.b;

      this.sizeArray[i]  = size;
      this.alphaArray[i] = alpha;
      this.typeArray[i]  = p.type;
      this.rotArray[i]   = p.rotPhase;
    }

    this.activeCount = activeCount;

    if (activeCount > 0 || this._wasActive || spawnedThisFrame > 0) {
      this.posAttr.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
      this.typeAttr.needsUpdate = true;
      this.rotAttr.needsUpdate = true;
    }
    this._wasActive = activeCount > 0;
  }

  dispose() {
    if (this.pointsMesh) {
      this.scene.remove(this.pointsMesh);
      this.pointsMesh = null;
    }
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    this.particlePool = null;
  }
}

export default MagicalFlightTrail;
