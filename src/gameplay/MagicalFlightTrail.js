import * as THREE from 'three';

/**
 * =============================================================================
 * ENCHANTED PIXIE STARDUST & SPARKLING FLIGHT TRAIL
 * =============================================================================
 * Premium, cinematic flight particle system for Santa's sleigh & reindeer.
 *
 * Core Technical Specifications:
 * - 100% Bone-Anchored: Emitters dynamically bind to the exact hoof bones
 *   (`front_leg_foot_l/r`, `back_leg_foot_l/r`) of all 4 reindeer, tracking their
 *   galloping animation accurately in world space.
 * - Sleigh Runner Emitters: Left & right runner tips emit a subtle trailing wake.
 * - 3 Distinct Procedural Particle Shaders in 1 Single Draw Call:
 *   1. Luminous Golden Stardust: Soft radiant fairy glow with warm champagne center
 *   2. Rotating 4-Point Starlight Diamonds: Elegant diffraction sparkle flares that spin and twinkle
 *   3. Crystalline Arctic Snowflakes: 6-pointed icy-cyan frost stars (#00E5FF / #80DEEA)
 * - Safe View Frustum: Smooth near-camera fade (smoothstep) prevents any lens clutter or clipping.
 * - Zero Garbage Collection: Pre-allocated typed arrays and object pools (60+ FPS on mobile).
 * - Exact 1 Draw Call.
 */
export class MagicalFlightTrail {
  constructor(scene, isMobile = false) {
    this.scene = scene;
    this.isMobile = isMobile;

    this.maxParticles = isMobile ? 360 : 750;
    this.particlePool = new Array(this.maxParticles);
    this.nextParticleIdx = 0;
    this.spawnAccumulator = 0.0;
    this.activeCount = 0;

    // Palette: Enchanted Christmas Twilight
    this.colorWarmGold = new THREE.Color(0xFFB300);      // Deep amber gold (#FFB300)
    this.colorBrightGold = new THREE.Color(0xFFE082);    // Luminous champagne (#FFE082)
    this.colorRoseGold = new THREE.Color(0xFFCA28);      // Vivid sunburst gold
    this.colorArcticCyan = new THREE.Color(0x00E5FF);    // Vibrant arctic aurora cyan (#00E5FF)
    this.colorFrostedWhite = new THREE.Color(0xE0F7FA);  // Frost crystalline white

    // Dynamically populated hoof bone references
    this.hoofBones = [];
    this.hoofBonesFound = false;

    // Sleigh runner emitter anchors (local space fallback/runners)
    this.runnerOffsets = [
      new THREE.Vector3(-0.48, 0.06, 0.20),
      new THREE.Vector3(0.48, 0.06, 0.20)
    ];

    this._tempSpawnPos = new THREE.Vector3();
    this._tempLocalPos = new THREE.Vector3();
    this._heading = new THREE.Vector3(0, 0, -1);
    this._rightVec = new THREE.Vector3(1, 0, 0);

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
        maxLife: 1.0,
        baseSize: 0.10,
        size: 0.10,
        baseAlpha: 0.98,
        alpha: 0.0,
        r: 1.0, g: 0.85, b: 0.40,
        type: 0.0, // 0 = Stardust Glow, 1 = 4-Point Star Diamond, 2 = Snowflake
        rotSpeed: 0.0,
        rotPhase: 0.0,
        twinkleSpeed: 8.0,
        twinklePhase: 0.0
      };
    }
  }

  _initPointsMesh() {
    this.geometry = new THREE.BufferGeometry();

    this.posArray = new Float32Array(this.maxParticles * 3);
    this.colorArray = new Float32Array(this.maxParticles * 3);
    this.sizeArray = new Float32Array(this.maxParticles);
    this.alphaArray = new Float32Array(this.maxParticles);
    this.typeArray = new Float32Array(this.maxParticles);
    this.rotArray = new Float32Array(this.maxParticles);

    this.posAttr = new THREE.BufferAttribute(this.posArray, 3);
    this.colorAttr = new THREE.BufferAttribute(this.colorArray, 3);
    this.sizeAttr = new THREE.BufferAttribute(this.sizeArray, 1);
    this.alphaAttr = new THREE.BufferAttribute(this.alphaArray, 1);
    this.typeAttr = new THREE.BufferAttribute(this.typeArray, 1);
    this.rotAttr = new THREE.BufferAttribute(this.rotArray, 1);

    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.typeAttr.setUsage(THREE.DynamicDrawUsage);
    this.rotAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aColor', this.colorAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aType', this.typeAttr);
    this.geometry.setAttribute('aRot', this.rotAttr);

    // Custom Shader with Camera-Near Safety Fade & Rich Procedural Shapes
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0.0 },
        uFogNear: { value: 3.5 },
        uFogFar: { value: 25.0 }
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute float aType;
        attribute float aRot;
        attribute vec3 aColor;

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
          gl_Position = projectionMatrix * mvPosition;

          float eyeDist = max(-mvPosition.z, 0.08);
          vEyeDist = eyeDist;

          // Responsive perspective scaling: prominent and luminous
          gl_PointSize = aSize * (380.0 / eyeDist);
          gl_PointSize = clamp(gl_PointSize, 3.0, 58.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uFogNear;
        uniform float uFogFar;

        varying vec3 vColor;
        varying float vAlpha;
        varying float vType;
        varying float vRot;
        varying float vEyeDist;

        void main() {
          if (vAlpha <= 0.005) discard;

          vec2 uv = gl_PointCoord - vec2(0.5);
          float dist = length(uv);
          if (dist > 0.5) discard;

          float shape = 0.0;
          float coreIntensity = 0.0;

          // Rotation matrix
          float cosA = cos(vRot);
          float sinA = sin(vRot);
          vec2 rotUv = vec2(uv.x * cosA - uv.y * sinA, uv.x * sinA + uv.y * cosA);

          if (vType < 0.5) {
            // Type 0: Luminous Golden Pixie Stardust Glow
            float radialGlow = exp(-dist * dist * 10.0);
            float innerCore = exp(-dist * 18.0);
            shape = radialGlow * 0.72 + innerCore * 0.68;
            coreIntensity = innerCore;
          } else if (vType < 1.5) {
            // Type 1: Rotating 4-Point Sparkling Diamond Star
            float dX = abs(rotUv.x);
            float dY = abs(rotUv.y);
            float rayX = max(0.0, 1.0 - dX * 3.4) * max(0.0, 1.0 - dY * 13.0);
            float rayY = max(0.0, 1.0 - dY * 3.4) * max(0.0, 1.0 - dX * 13.0);
            float centerBulb = exp(-dist * 9.0);
            shape = (rayX + rayY) * 0.95 + centerBulb * 0.65;
            coreIntensity = centerBulb;
          } else {
            // Type 2: Crystalline Arctic Snowflake Star
            float angle = atan(rotUv.y, rotUv.x);
            float arms = max(0.0, cos(angle * 6.0));
            arms = pow(arms, 2.8);
            float centerGlow = smoothstep(0.45, 0.0, dist);
            shape = centerGlow * (0.35 + 0.75 * arms);
            coreIntensity = exp(-dist * 12.0);
          }

          // Smooth antialiased outer edge
          shape *= smoothstep(0.50, 0.32, dist);

          // 1. Camera-Near Safety Fade: smoothly vanishes if within 0.18m-0.42m of camera lens
          float nearCameraFade = smoothstep(0.18, 0.42, vEyeDist);

          // 2. Scene Fog Fade
          float fogFactor = clamp((vEyeDist - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
          float fogFade = 1.0 - smoothstep(0.0, 1.0, fogFactor);

          float finalAlpha = shape * vAlpha * nearCameraFade * fogFade;
          if (finalAlpha <= 0.005) discard;

          // Warm radiant color: saturated rich core without bloom blowout
          vec3 finalRgb = vColor * 1.12 + vec3(0.32, 0.28, 0.18) * coreIntensity;

          gl_FragColor = vec4(finalRgb, finalAlpha);
        }
      `
    });

    this.pointsMesh = new THREE.Points(this.geometry, this.material);
    this.pointsMesh.name = 'EnchantedMagicalFlightTrail';
    this.pointsMesh.frustumCulled = false;
    this.scene.add(this.pointsMesh);
  }

  /**
   * Search and cache all 16 reindeer hoof bone transforms
   */
  _bindHoofBones(sleighController) {
    if (!sleighController?.group) return;

    this.hoofBones = [];
    const deerNames = ['Reindeer_Lead_L', 'Reindeer_Lead_R', 'Reindeer_Back_L', 'Reindeer_Back_R'];
    const boneNames = ['front_leg_foot_l', 'front_leg_foot_r', 'back_leg_foot_l', 'back_leg_foot_r'];

    deerNames.forEach(dName => {
      const deer = sleighController.group.getObjectByName(dName);
      if (deer) {
        boneNames.forEach(bName => {
          const bone = deer.getObjectByName(bName);
          if (bone) {
            this.hoofBones.push(bone);
          }
        });
      }
    });

    if (this.hoofBones.length > 0) {
      this.hoofBonesFound = true;
    }
  }

  /**
   * Spawn a single stardust particle from a given emitter origin
   */
  _spawnParticle(originPos, flightState) {
    if (this.nextParticleIdx >= this.maxParticles) {
      this.nextParticleIdx = 0;
    }
    const p = this.particlePool[this.nextParticleIdx];
    this.nextParticleIdx++;

    p.active = true;
    p.life = 1.0;
    p.maxLife = 0.85 + Math.random() * 0.55; // 0.85s to 1.40s lifetime for continuous flowing trail

    // Jittered origin around emitter point
    const scatter = 0.040;
    p.x = originPos.x + (Math.random() - 0.5) * scatter;
    p.y = originPos.y + (Math.random() - 0.5) * scatter * 0.6;
    p.z = originPos.z + (Math.random() - 0.5) * scatter;

    const heading = flightState.heading || this._heading;
    this._rightVec.set(-heading.z, 0, heading.x).normalize();

    // Natural wake: subtle backward slipstream + gentle outward curl + upward buoyancy
    const sideSign = (Math.random() < 0.5) ? -1.0 : 1.0;
    const outwardSpurt = sideSign * (0.012 + Math.random() * 0.028);
    const backwardDrift = -0.15;

    p.vx = heading.x * backwardDrift + this._rightVec.x * outwardSpurt + (Math.random() - 0.5) * 0.015;
    p.vy = (0.025 + Math.random() * 0.050); // Gentle upward buoyant float
    p.vz = heading.z * backwardDrift + this._rightVec.z * outwardSpurt + (Math.random() - 0.5) * 0.015;

    p.rotSpeed = (Math.random() - 0.5) * 4.2;
    p.rotPhase = Math.random() * Math.PI * 2;
    p.twinkleSpeed = 8.0 + Math.random() * 12.0;
    p.twinklePhase = Math.random() * Math.PI * 2;

    // Palette & Shape selection:
    // ~55% Warm Golden Stardust, ~30% Sparkling 4-point Diamond, ~15% Arctic Snowflake
    const rand = Math.random();
    if (rand < 0.55) {
      // Type 0: Golden Stardust Glow
      p.type = 0.0;
      const col = Math.random() < 0.65 ? this.colorWarmGold : this.colorBrightGold;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.085 + Math.random() * 0.045;
      p.baseAlpha = 0.98;
    } else if (rand < 0.85) {
      // Type 1: 4-Point Sparkling Star Diamond
      p.type = 1.0;
      const col = Math.random() < 0.65 ? this.colorBrightGold : this.colorRoseGold;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.105 + Math.random() * 0.055;
      p.baseAlpha = 1.0;
    } else {
      // Type 2: Crystalline Arctic Snowflake
      p.type = 2.0;
      const col = Math.random() < 0.70 ? this.colorArcticCyan : this.colorFrostedWhite;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.090 + Math.random() * 0.040;
      p.baseAlpha = 0.95;
    }

    // Boost & acceleration multiplier
    if (flightState.isBoosting) {
      p.baseSize *= 1.30;
      p.maxLife *= 1.20;
    }
  }

  /**
   * Main per-frame update loop called from SleighController
   */
  update(delta, flightState) {
    if (!this.geometry || !this.material) return;

    // Clamp delta to prevent single-frame spikes
    const dt = Math.min(delta, 0.05);

    const time = flightState.animTime || 0.0;
    this.material.uniforms.uTime.value = time;

    // Sync Fog
    if (this.scene.fog) {
      this.material.uniforms.uFogNear.value = this.scene.fog.near;
      this.material.uniforms.uFogFar.value = this.scene.fog.far;
    }

    const speed = Math.max(0.0, flightState.speed || 0.0);
    const speedRatio = THREE.MathUtils.clamp(
      (speed - (flightState.minSpeed || 2.0)) / ((flightState.maxSpeed || 8.0) - (flightState.minSpeed || 2.0)),
      0.0,
      1.0
    );

    const sc = window.game?.sleighController;
    const isMoving = speed > 0.35 && !!sc;

    // Lazily bind hoof bones if not yet found
    if (!this.hoofBonesFound && sc) {
      this._bindHoofBones(sc);
    }

    // 1. Spawning Logic
    if (isMoving) {
      // Rich, continuous particle stream
      let baseRate = (this.isMobile ? 220.0 : 420.0) * (0.75 + speedRatio * 0.75);
      if (flightState.isBoosting) baseRate *= 1.45;

      this.spawnAccumulator += dt * baseRate;

      const hasBones = this.hoofBones.length > 0;
      const sleighMatrix = sc.group.matrixWorld;

      while (this.spawnAccumulator >= 1.0) {
        this.spawnAccumulator -= 1.0;

        // 80% Hooves emitters, 20% Runner emitters
        if (hasBones && Math.random() < 0.80) {
          const bone = this.hoofBones[Math.floor(Math.random() * this.hoofBones.length)];
          bone.getWorldPosition(this._tempSpawnPos);
        } else {
          const runnerOffset = this.runnerOffsets[Math.floor(Math.random() * this.runnerOffsets.length)];
          this._tempSpawnPos.copy(runnerOffset).applyMatrix4(sleighMatrix);
        }

        this._spawnParticle(this._tempSpawnPos, flightState);
      }
    } else {
      this.spawnAccumulator = 0.0;
    }

    // 2. Particle Simulation Loop
    let activeCount = 0;
    const dragFactor = Math.exp(-0.80 * dt);

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particlePool[i];
      if (!p.active) {
        this.alphaArray[i] = 0.0;
        continue;
      }

      p.life -= dt / p.maxLife;

      if (p.life <= 0.0) {
        p.active = false;
        p.alpha = 0.0;
        this.alphaArray[i] = 0.0;
        continue;
      }

      activeCount++;

      // Physics integration
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      p.vx *= dragFactor;
      p.vy *= dragFactor;
      p.vz *= dragFactor;

      const age = 1.0 - p.life;
      // Quick attack and smooth linear-exponential decay
      const fadeIn = THREE.MathUtils.clamp(age / 0.08, 0.0, 1.0);
      const fadeOut = Math.pow(p.life, 1.15);
      const twinkle = 0.85 + 0.15 * Math.sin(time * p.twinkleSpeed + p.twinklePhase);

      p.alpha = p.baseAlpha * fadeIn * fadeOut * twinkle;
      p.size = p.baseSize * (0.90 + 0.30 * Math.sin(age * Math.PI));
      p.rotPhase += p.rotSpeed * dt;

      const i3 = i * 3;
      this.posArray[i3]     = p.x;
      this.posArray[i3 + 1] = p.y;
      this.posArray[i3 + 2] = p.z;

      this.colorArray[i3]     = p.r;
      this.colorArray[i3 + 1] = p.g;
      this.colorArray[i3 + 2] = p.b;

      this.sizeArray[i]  = p.size;
      this.alphaArray[i] = p.alpha;
      this.typeArray[i]  = p.type;
      this.rotArray[i]   = p.rotPhase;
    }

    this.activeCount = activeCount;

    // Flag buffer attributes for GPU upload
    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.typeAttr.needsUpdate = true;
    this.rotAttr.needsUpdate = true;
  }

  initReindeerEmitters(reindeerArray) {
    // Retained for backward compatibility
  }

  dispose() {
    if (this.pointsMesh) {
      this.scene.remove(this.pointsMesh);
      if (this.geometry) this.geometry.dispose();
      if (this.material) this.material.dispose();
    }
  }
}
