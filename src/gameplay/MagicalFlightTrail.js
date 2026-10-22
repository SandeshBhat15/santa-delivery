import * as THREE from 'three';

/**
 * =============================================================================
 * SANTA'S FLIGHT TRAIL — GOLDEN COMET PLUME
 * =============================================================================
 * A bright core of golden sparkles that leaves the sleigh below and behind it,
 * fans out as it ages, and traces the exact path the sleigh has flown — so the
 * trail bends through turns and follows climbs and dives by construction.
 *
 * LAYERED LOOK (matches the reference art):
 * - a dense CORE of stretched gold sparkles that joins into a bright ribbon
 * - fine dust motes scattered through the plume
 * - large soft BOKEH glows for depth and warmth
 * - 4-point and 6-point STAR glints, mostly gold with a few icy-blue ones
 * - the plume WIDENS and drifts down as it ages, then dissolves smoothly
 *
 * HOW IT STAYS CONTINUOUS (no disconnected dots):
 * 1. EMISSION IS DISTANCE-BASED — a sparkle every ~5.5 mm of travel,
 *    interpolated along the frame's movement segment, so spacing is constant at
 *    any speed and independent of frame rate.
 * 2. SPRITES STRETCH ALONG THE FLOW — dash orientation comes from projecting
 *    the particle's flow direction into screen space, closing the gaps near the
 *    lens where a few millimetres subtend 20+ pixels.
 *
 * Santa stays clear: the plume is anchored below the sleigh's runners and fades
 * out before it reaches the lens.
 *
 * MOBILE: smaller pool, coarser spacing, tighter size clamp, one draw call,
 * no per-frame allocation, no buffer uploads while idle.
 */

// --- Tuning ---------------------------------------------------------------
const SPACING_DESKTOP = 0.0035;  // metres between sparkles along the path
const SPACING_MOBILE = 0.0050;
const BACK_OFFSET = 0.05;        // anchor sits this far behind the sleigh
const DOWN_OFFSET = -0.025;      // ...and this far below it (below the runners)
const FAN_HALF_WIDTH = 0.050;    // sleigh-width fan the plume leaves from
const MAX_SPAWNS_PER_FRAME = 220; // hitch/teleport guard

export class MagicalFlightTrail {
  constructor(scene, isMobile = false) {
    this.scene = scene;
    this.isMobile = isMobile;

    this.maxParticles = isMobile ? 420 : 640;
    this.particlePool = new Array(this.maxParticles);
    this.nextParticleIdx = 0;
    this.activeCount = 0;
    this._wasActive = false;

    this.spacing = isMobile ? SPACING_MOBILE : SPACING_DESKTOP;
    this._distToNext = this.spacing * 0.5;
    this._travelAccum = 0.0;      // total distance flown, drives the waft wave
    this._hasPrevAnchor = false;

    // Reference palette — warm golds, cream, and two icies
    this.colorWarmGold = new THREE.Color(0xE3A02F);
    this.colorBrightGold = new THREE.Color(0xF5C961);
    this.colorCream = new THREE.Color(0xFFE9B0);
    this.colorIceBlue = new THREE.Color(0x7FC4F0);
    this.colorPaleBlue = new THREE.Color(0xCDE9FB);

    this._prevAnchor = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
    this._spawnPos = new THREE.Vector3();
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
        dirX: 0, dirY: 0, dirZ: -1,
        life: 0.0,
        maxLife: 1.0,
        baseSize: 0.024,
        size: 0.024,
        stretch: 1.3,
        baseAlpha: 0.60,
        alpha: 0.0,
        r: 1.0, g: 0.72, b: 0.30,
        type: 0.0, // 0 dust, 1 four-point star, 2 soft bokeh, 3 six-point star
        rotSpeed: 0.0,
        rotPhase: 0.0,
        twinkleSpeed: 6.0,
        twinklePhase: 0.0
      };
    }
  }

  _initPointsMesh() {
    this.geometry = new THREE.BufferGeometry();

    this.posArray = new Float32Array(this.maxParticles * 3);
    this.dirArray = new Float32Array(this.maxParticles * 3);
    this.colorArray = new Float32Array(this.maxParticles * 3);
    this.sizeArray = new Float32Array(this.maxParticles);
    this.stretchArray = new Float32Array(this.maxParticles);
    this.alphaArray = new Float32Array(this.maxParticles);
    this.typeArray = new Float32Array(this.maxParticles);
    this.rotArray = new Float32Array(this.maxParticles);

    this.posAttr = new THREE.BufferAttribute(this.posArray, 3);
    this.dirAttr = new THREE.BufferAttribute(this.dirArray, 3);
    this.colorAttr = new THREE.BufferAttribute(this.colorArray, 3);
    this.sizeAttr = new THREE.BufferAttribute(this.sizeArray, 1);
    this.stretchAttr = new THREE.BufferAttribute(this.stretchArray, 1);
    this.alphaAttr = new THREE.BufferAttribute(this.alphaArray, 1);
    this.typeAttr = new THREE.BufferAttribute(this.typeArray, 1);
    this.rotAttr = new THREE.BufferAttribute(this.rotArray, 1);

    for (const a of [this.posAttr, this.dirAttr, this.colorAttr, this.sizeAttr,
                     this.stretchAttr, this.alphaAttr, this.typeAttr, this.rotAttr]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aDir', this.dirAttr);
    this.geometry.setAttribute('aColor', this.colorAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aStretch', this.stretchAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aType', this.typeAttr);
    this.geometry.setAttribute('aRot', this.rotAttr);

    // Sizes are authored in CSS pixels and scaled by render DPR so the plume
    // reads the same on a phone and a monitor.
    this.pixelRatio = Math.min(
      (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
      this.isMobile ? 1.5 : 2
    );

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uPointScale: { value: 240.0 },
        uMinSize: { value: 2.0 },
        uMaxSize: { value: this.isMobile ? 18.0 : 24.0 },
        uPixelRatio: { value: this.pixelRatio },
        uAspect: { value: 1.0 },
        uFogNear: { value: 3.5 },
        uFogFar: { value: 25.0 }
      },
      vertexShader: `
        attribute float aSize;
        attribute float aStretch;
        attribute float aAlpha;
        attribute float aType;
        attribute float aRot;
        attribute vec3 aColor;
        attribute vec3 aDir;

        uniform float uPointScale;
        uniform float uMinSize;
        uniform float uMaxSize;
        uniform float uPixelRatio;
        uniform float uAspect;

        varying vec3 vColor;
        varying float vAlpha;
        varying float vType;
        varying float vRot;
        varying float vStretch;
        varying float vEyeDist;
        varying vec2 vFlowDir;

        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vType = aType;
          vRot = aRot;
          vStretch = aStretch;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vec4 clipA = projectionMatrix * mvPosition;

          float eyeDist = max(-mvPosition.z, 0.08);
          vEyeDist = eyeDist;

          // The trail recedes almost straight away from the lens, so a finite
          // difference of two nearby points collapses to noise. Instead take
          // the flow's VANISHING POINT: the projection of its direction at
          // infinity. Streaks then lie radially away from it, which is exactly
          // how a receding trail reads in perspective.
          vec3 dirView = (modelViewMatrix * vec4(aDir, 0.0)).xyz;
          vec4 clipVP = projectionMatrix * vec4(dirView, 0.0);
          vec2 vpNdc = clipVP.xy / max(abs(clipVP.w), 1e-4);
          if (clipVP.w < 0.0) vpNdc = -vpNdc;

          vec2 ndcPos = clipA.xy / max(clipA.w, 1e-4);
          vec2 sd = vec2((ndcPos.x - vpNdc.x) * uAspect, -(ndcPos.y - vpNdc.y));
          float sdLen = length(sd);
          vFlowDir = sdLen > 1e-4 ? sd / sdLen : vec2(0.0, 1.0);

          // Bounded size: a sparkle near the lens can never balloon into a
          // blurry slab over Santa.
          float sizePx = aSize * uPointScale / max(eyeDist, 0.25);
          sizePx = clamp(sizePx, uMinSize, uMaxSize);

          gl_Position = clipA;
          gl_PointSize = min(sizePx * vStretch, uMaxSize * 1.25) * uPixelRatio;
        }
      `,
      fragmentShader: `
        uniform float uFogNear;
        uniform float uFogFar;

        varying vec3 vColor;
        varying float vAlpha;
        varying float vType;
        varying float vRot;
        varying float vStretch;
        varying float vEyeDist;
        varying vec2 vFlowDir;

        void main() {
          if (vAlpha <= 0.004) discard;

          vec2 uv = gl_PointCoord - vec2(0.5);
          float cosA = cos(vRot);
          float sinA = sin(vRot);
          vec2 rotUv = vec2(uv.x * cosA - uv.y * sinA, uv.x * sinA + uv.y * cosA);

          // Dash space: stretched along the flow, unscaled across it.
          vec2 f = vFlowDir;
          vec2 q = vec2(dot(rotUv, f) * vStretch, dot(rotUv, vec2(-f.y, f.x)));
          float dist = length(q) * 2.0;   // 0 centre, 1 at the cross edge
          if (dist > 1.0) discard;

          float shape = 0.0;
          float core = 0.0;
          float t = dist * 0.5;

          if (vType < 0.5) {
            // Golden dust: soft halo + tight hot core
            float halo = exp(-t * t * 5.5);
            float hot = exp(-t * 15.0);
            shape = halo * 0.62 + hot * 0.72;
            core = hot;
          } else if (vType < 1.5) {
            // Four-point starlight glint
            float dX = abs(rotUv.x);
            float dY = abs(rotUv.y);
            float rayX = max(0.0, 1.0 - dX * 4.0) * max(0.0, 1.0 - dY * 15.0);
            float rayY = max(0.0, 1.0 - dY * 4.0) * max(0.0, 1.0 - dX * 15.0);
            float bulb = exp(-t * 9.0);
            shape = (rayX + rayY) * 0.88 + bulb * 0.60;
            core = bulb;
          } else if (vType < 2.5) {
            // Soft bokeh glow: broad and gentle, no hard core
            float disc = smoothstep(1.0, 0.25, dist);
            shape = disc * (0.34 + 0.66 * exp(-t * t * 1.8));
            core = exp(-t * t * 2.6) * 0.45;
          } else {
            // Six-point star / snowflake sparkle
            float ang = atan(rotUv.y, rotUv.x);
            float rays = pow(abs(cos(ang * 3.0)), 8.0);
            float falloff = max(0.0, 1.0 - dist);
            float bulb = exp(-t * 8.0);
            shape = rays * falloff * 1.0 + bulb * 0.65;
            core = bulb;
          }

          // Soft antialiased edge so small sprites never turn to mush or hard
          // lozenges.
          shape *= smoothstep(1.0, 0.62, dist);

          // Near-camera fade: the plume thins out before the lens so it never
          // sweeps across Santa as a bright streak.
          float nearFade = smoothstep(0.12, 0.38, vEyeDist);

          // Scene fog fade
          float fogFactor = clamp((vEyeDist - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
          float fogFade = 1.0 - smoothstep(0.0, 1.0, fogFactor);

          float finalAlpha = shape * vAlpha * nearFade * fogFade;
          if (finalAlpha <= 0.004) discard;

          // Hot cores sit just over the bloom threshold for a soft halo;
          // everything else stays under it so nothing glares.
          vec3 finalRgb = vColor * 1.02 + vec3(0.055, 0.038, 0.010) * core;

          gl_FragColor = vec4(finalRgb, finalAlpha);
        }
      `
    });

    this.pointsMesh = new THREE.Points(this.geometry, this.material);
    this.pointsMesh.name = 'MagicalFlightTrail';
    this.pointsMesh.frustumCulled = false;
    this.pointsMesh.renderOrder = 2;
    this.scene.add(this.pointsMesh);
  }

  /**
   * Emit one sparkle at an exact point on the flown path.
   */
  _spawnParticleAt(pos, flightState, distanceAlong) {
    if (this.nextParticleIdx >= this.maxParticles) {
      this.nextParticleIdx = 0;
    }
    const p = this.particlePool[this.nextParticleIdx++];

    p.active = true;
    p.life = 1.0;
    p.maxLife = 0.50 + Math.random() * 0.35;

    const heading = flightState.heading || this._heading;
    this._rightVec.set(-heading.z, 0, heading.x).normalize();

    // Leave from a small fan the width of the sleigh, not a single razor point
    const lateral = (Math.random() - 0.5) * 2.0 * FAN_HALF_WIDTH;

    p.x = pos.x + this._rightVec.x * lateral;
    p.y = pos.y + (Math.random() - 0.5) * 0.010;
    p.z = pos.z + this._rightVec.z * lateral;

    p.dirX = heading.x;
    p.dirY = 0.0;
    p.dirZ = heading.z;

    // Outward fan: side kick + droop, so the plume opens up as it ages
    const side = (Math.random() - 0.5) * 2.0;
    const rand = Math.random();

    if (rand < 0.52) {
      // --- Core sparkle: dense, stretched, carries the bright ribbon --------
      p.type = 0.0;
      const col = Math.random() < 0.50 ? this.colorWarmGold
               : (Math.random() < 0.55 ? this.colorBrightGold : this.colorCream);
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.028 + Math.random() * 0.020;
      p.baseAlpha = 0.86 + Math.random() * 0.14;
      p.stretch = 1.30 + Math.random() * 0.40;
      p.vx = this._rightVec.x * side * 0.34;
      p.vz = this._rightVec.z * side * 0.34;
      p.vy = -0.03 - Math.random() * 0.10;
    } else if (rand < 0.78) {
      // --- Fine dust motes --------------------------------------------------
      p.type = 0.0;
      const col = Math.random() < 0.55 ? this.colorBrightGold : this.colorCream;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.012 + Math.random() * 0.012;
      p.baseAlpha = 0.38 + Math.random() * 0.20;
      p.stretch = 1.12 + Math.random() * 0.35;
      p.vx = this._rightVec.x * side * 0.95;
      p.vz = this._rightVec.z * side * 0.95;
      p.vy = -0.03 - Math.random() * 0.16;
    } else if (rand < 0.88) {
      // --- Soft bokeh glow: depth and warmth --------------------------------
      p.type = 2.0;
      const col = Math.random() < 0.45 ? this.colorWarmGold : this.colorBrightGold;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.055 + Math.random() * 0.040;
      p.baseAlpha = 0.14 + Math.random() * 0.12;
      p.stretch = 1.0;
      p.vx = this._rightVec.x * side * 0.55;
      p.vz = this._rightVec.z * side * 0.55;
      p.vy = -0.03 - Math.random() * 0.10;
    } else if (rand < 0.97) {
      // --- Four-point golden star glints ------------------------------------
      p.type = 1.0;
      const col = Math.random() < 0.55 ? this.colorBrightGold : this.colorCream;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.040 + Math.random() * 0.028;
      p.baseAlpha = 0.80 + Math.random() * 0.20;
      p.stretch = 1.0;
      p.vx = this._rightVec.x * side * 0.40;
      p.vz = this._rightVec.z * side * 0.40;
      p.vy = -0.025 - Math.random() * 0.09;
    } else if (rand < 0.995) {
      // --- Six-point icy star ----------------------------------------------
      p.type = 3.0;
      const col = Math.random() < 0.45 ? this.colorIceBlue : this.colorPaleBlue;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.045 + Math.random() * 0.030;
      p.baseAlpha = 0.75 + Math.random() * 0.22;
      p.stretch = 1.0;
      p.vx = this._rightVec.x * side * 0.42;
      p.vz = this._rightVec.z * side * 0.42;
      p.vy = -0.02 - Math.random() * 0.07;
    } else {
      // --- Rare pale-blue snow mote ----------------------------------------
      p.type = 3.0;
      const col = this.colorPaleBlue;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.022 + Math.random() * 0.014;
      p.baseAlpha = 0.60;
      p.stretch = 1.1;
      p.vx = this._rightVec.x * side * 0.30;
      p.vz = this._rightVec.z * side * 0.30;
      p.vy = -0.02 - Math.random() * 0.06;
    }

    // --- BROOM BRISTLES -----------------------------------------------------
    // Sharp golden streaks that sweep out sideways and down from the runners,
    // fanning like the bristles of a broom. Each streak is stretched along its
    // OWN swept direction (not the flight heading), so the strokes radiate.
    if (Math.random() < 0.22) {
      const side2 = (Math.random() - 0.5) * 2.0;
      const spread = 0.45 + Math.random() * 0.85;

      p.type = 0.0;
      const col = Math.random() < 0.60 ? this.colorBrightGold : this.colorCream;
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.baseSize = 0.018 + Math.random() * 0.014;
      p.baseAlpha = 0.40 + Math.random() * 0.20;
      p.stretch = 2.2 + Math.random() * 1.4;
      p.vx = this._rightVec.x * side2 * spread;
      p.vz = this._rightVec.z * side2 * spread;
      p.vy = -0.18 - Math.random() * 0.35 * Math.abs(side2);

      const len = Math.hypot(p.vx, p.vy, p.vz) || 1.0;
      p.dirX = p.vx / len;
      p.dirY = p.vy / len;
      p.dirZ = p.vz / len;
    }

    p.rotSpeed = (Math.random() - 0.5) * 1.4;
    p.rotPhase = Math.random() * Math.PI * 2;
    p.twinkleSpeed = 3.0 + Math.random() * 6.0;
    p.twinklePhase = Math.random() * Math.PI * 2;

    // Gentle backward drift keeps the plume flowing away from the sleigh
    p.vx += -heading.x * 0.05;
    p.vz += -heading.z * 0.05;
  }

  /**
   * Main per-frame update loop called from SleighController
   */
  update(delta, flightState) {
    if (!this.geometry || !this.material) return;

    const dt = Math.min(delta, 0.05);
    const time = flightState.animTime || 0.0;

    if (typeof window !== 'undefined' && window.innerHeight > 0) {
      this.material.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
    }

    if (this.scene.fog) {
      this.material.uniforms.uFogNear.value = this.scene.fog.near;
      this.material.uniforms.uFogFar.value = this.scene.fog.far;
    }

    const sc = typeof window !== 'undefined' ? window.game?.sleighController : null;
    const speed = Math.max(0.0, flightState.speed || 0.0);
    const isMoving = speed > 0.3 && !!sc;

    // 1. Anchor: just behind and below the sleigh (world space, no bone lookups)
    const heading = flightState.heading || this._heading;
    if (sc) {
      // sc.position is the current-frame rig position; group.matrixWorld is a
      // frame behind, which pushed the anchor backwards and opened a gap.
      const pos = sc.position;
      this._anchor.set(
        pos.x - heading.x * BACK_OFFSET,
        pos.y + DOWN_OFFSET,
        pos.z - heading.z * BACK_OFFSET
      );
    } else {
      this._anchor.copy(this._prevAnchor);
    }

    // 2. Distance-based emission — constant spacing, so the thread never breaks
    if (isMoving && this._hasPrevAnchor) {
      const segLen = this._anchor.distanceTo(this._prevAnchor);

      // Only a genuine teleport (respawn / scene change) breaks the thread; a
      // slow frame just travels further and keeps emitting.
      const teleportLen = Math.max(2.0, speed * dt * 3.0 + 0.5);
      if (segLen > teleportLen) {
        // Teleport / respawn: restart the plume instead of stringing a line
        this._distToNext = this.spacing * 0.5;
        this._travelAccum = 0.0;
      } else if (segLen > 1e-5) {
        let remaining = segLen;
        let travelled = 0.0;
        let spawned = 0;

        while (remaining >= this._distToNext && spawned < MAX_SPAWNS_PER_FRAME) {
          travelled += this._distToNext;
          remaining -= this._distToNext;

          const t = travelled / segLen;
          this._spawnPos.lerpVectors(this._prevAnchor, this._anchor, t);
          this._spawnParticleAt(this._spawnPos, flightState, this._travelAccum + travelled);
          this._distToNext = this.spacing * (0.86 + Math.random() * 0.28);
          spawned++;
        }

        this._distToNext -= remaining;
        this._travelAccum += segLen;
      }
    } else if (!isMoving) {
      // Reset so resuming from a stop doesn't dump a burst in one spot
      this._distToNext = this.spacing * 0.5;
    }

    this._prevAnchor.copy(this._anchor);
    this._hasPrevAnchor = true;

    // 3. Simulation
    let activeCount = 0;
    const dragFactor = Math.exp(-0.9 * dt);

    // FRUSTUM CULLING � the chase camera sits ~1.2 m behind the sleigh, so most
    // of the plume is behind the lens where it can never be seen again. Those
    // sparkles are freed on the spot instead of being simulated and uploaded
    // every frame. The limits are deliberately generous so a fast turn cannot
    // pop a visible sparkle out of existence.
    const cam = typeof window !== 'undefined' ? window.game?.camera : null;
    const vm = cam ? cam.matrixWorldInverse.elements : null;
    const cullLimX = cam ? Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) * cam.aspect * 1.7 : 1.0;
    const cullLimY = cam ? Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) * 1.7 : 1.0;

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particlePool[i];
      if (!p.active) continue;

      p.life -= dt / p.maxLife;

      if (p.life <= 0.0) {
        p.active = false;
        p.alpha = 0.0;
        this.alphaArray[i] = 0.0;
        continue;
      }

      activeCount++;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      p.vx *= dragFactor;
      p.vy *= dragFactor;
      p.vz *= dragFactor;

      // Cull to the camera: behind the lens, or well outside the view cone.
      if (vm) {
        const vx = vm[0] * p.x + vm[4] * p.y + vm[8] * p.z + vm[12];
        const vy = vm[1] * p.x + vm[5] * p.y + vm[9] * p.z + vm[13];
        const vz = vm[2] * p.x + vm[6] * p.y + vm[10] * p.z + vm[14];
        const depth = -vz;

        if (depth < 0.18 ||
            Math.abs(vx) > depth * cullLimX + 0.7 ||
            Math.abs(vy) > depth * cullLimY + 0.7) {
          p.active = false;
          p.alpha = 0.0;
          this.alphaArray[i] = 0.0;
          continue;
        }
      }

      const age = 1.0 - p.life;
      const fadeIn = THREE.MathUtils.clamp(age * p.maxLife / 0.012, 0.0, 1.0);
      // Long, smooth dissolve so the tail melts into the night
      const fadeOut = p.life * p.life * (3.0 - 2.0 * p.life);
      const twinkle = 0.88 + 0.12 * Math.sin(time * p.twinkleSpeed + p.twinklePhase);

      p.alpha = p.baseAlpha * fadeIn * fadeOut * twinkle;
      p.size = p.baseSize * (0.95 + 0.10 * Math.sin(age * Math.PI));
      p.rotPhase += p.rotSpeed * dt;

      const i3 = i * 3;
      this.posArray[i3]     = p.x;
      this.posArray[i3 + 1] = p.y;
      this.posArray[i3 + 2] = p.z;

      this.dirArray[i3]     = p.dirX;
      this.dirArray[i3 + 1] = p.dirY;
      this.dirArray[i3 + 2] = p.dirZ;

      this.colorArray[i3]     = p.r;
      this.colorArray[i3 + 1] = p.g;
      this.colorArray[i3 + 2] = p.b;

      this.sizeArray[i]    = p.size;
      this.stretchArray[i] = p.stretch;
      this.alphaArray[i]   = p.alpha;
      this.typeArray[i]    = p.type;
      this.rotArray[i]     = p.rotPhase;
    }

    this.activeCount = activeCount;

    if (activeCount > 0 || this._wasActive) {
      this.posAttr.needsUpdate = true;
      this.dirAttr.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
      this.stretchAttr.needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
      this.typeAttr.needsUpdate = true;
      this.rotAttr.needsUpdate = true;
    }
    this._wasActive = activeCount > 0;
  }

  initReindeerEmitters(reindeerArray) {
    // Trail is sleigh-anchored now; retained for call-site compatibility.
  }

  dispose() {
    if (this.pointsMesh) {
      this.scene.remove(this.pointsMesh);
      if (this.geometry) this.geometry.dispose();
      if (this.material) this.material.dispose();
    }
  }
}
