import * as THREE from 'three';

/**
 * =============================================================================
 * MAGIC TRAIL — SOFT GOLDEN LIGHT RIBBON
 * =============================================================================
 * A soft golden light-ribbon that follows a moving object (ribbon only, no
 * particles). Ported from `magic-trail.js` (three.js r128 global `THREE`) into
 * an ES module for this Vite project (three ^0.170). The shader logic is kept
 * byte-for-byte identical to the source apart from the width-scale uniform.
 *
 * LOOK
 * - Four draw layers over one shared, preallocated BufferGeometry: a wide soft
 *   glow, a thin bright core and two counter-rippling strands.
 * - Additive blending, no depth writes: reads best on the dark night sky and
 *   picks up bloom from the composer as a halo.
 * - Colour runs pale gold near the head to warm gold mid-trail with a cool
 *   blue kick in the last quarter, and fades out toward the tail.
 *
 * INTEGRATION (see SleighController)
 * - `update(elapsedSeconds, worldAnchor, forward)` once per frame.
 * - `minDist / maxPoints / life` are sized for this game's mini rig: the sleigh
 *   cruises at 1.8-2.8 m/s, so a 1.1 s life is a ~2-3 m ribbon.
 * - `widthScale` shrinks the original file's world units (built for a ~4 m
 *   sleigh) down to this scene's ~0.28 m sled footprint.
 *
 * TAIL FIX
 * - The old version removed points one at a time and pinched the last N *points* to zero width, so the
 *   visible end of the ribbon jumped back by one point spacing each time a point expired (a hard, stepping cut).
 * - Now: the anchor is sampled at a fixed TIME step, the oldest vertex is interpolated at exactly `life`
 *   seconds old, and tapering depends only on continuous age. The end slides smoothly and always fades to 0.
 *
 * Usage:
 *   const trail = new MagicTrail(scene, camera, { life: 1.0, widthScale: 0.05, gainScale: 0.5 });
 *   trail.update(elapsedTime, anchorWorldPos, forwardVector);
 */
export class MagicTrail {
  constructor(scene, camera, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this.life = opts.life ?? 2;            // seconds the trail stays visible
    this.minDist = opts.minDist ?? 0.45;   // kept for API compatibility; the trail is now sampled by TIME, not distance
    this.maxPoints = opts.maxPoints ?? 420;
    this.widthScale = opts.widthScale ?? 1;
    this.gainScale = opts.gainScale ?? 1; // keeps the additive stack gold instead of clipping to white
    this.streak = opts.streak ?? 1;       // light-streak amplitude in the ribbon (shimmer when < 1)

    // --- time-sampled history (ring buffer, zero allocations per frame) ---
    // The anchor is sampled at a fixed time step (life / samples) instead of every `minDist` metres.
    // That keeps the ribbon dense at any speed and, together with the interpolated tail below,
    // makes the visible end of the trail move continuously instead of jumping one point at a time.
    this.samples = Math.max(8, Math.min(opts.samples ?? 48, this.maxPoints - 8));
    this._cap = this.samples + 8;
    this._sx = new Float32Array(this._cap);
    this._sy = new Float32Array(this._cap);
    this._sz = new Float32Array(this._cap);
    this._st = new Float64Array(this._cap);   // sample times (seconds)
    this._head = 0;                           // ring index of the OLDEST sample
    this._count = 0;
    this._sampleDt = this.life / this.samples;

    const n = this._cap + 2;                  // stored samples + live head + interpolated tail
    this._maxN = n;
    this._ax = new Float32Array(n);           // scratch: ribbon vertices, newest first
    this._ay = new Float32Array(n);
    this._az = new Float32Array(n);
    this._aage = new Float32Array(n);
    this._aarc = new Float32Array(n);         // scratch: cumulative arc length from the head

    this.pos = new Float32Array(n * 6);
    this.side = new Float32Array(n * 6);
    this.uv = new Float32Array(n * 4);
    const idx = new Uint16Array((n - 1) * 6);
    for (let i = 0; i < n - 1; i++) {
      const a = 2 * i;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    this.envelope = new Float32Array(n * 4).fill(1); // constant: tapering is now driven only by continuous age (u)
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(this.side, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aEnvelope', new THREE.BufferAttribute(this.envelope, 2));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));

    // Uniforms shared by every layer
    this.uTime = { value: 0 };
    this.uGlow = { value: opts.glow ?? 1 };

    // Layers: wide soft glow, thin bright core, and two wavy strands
    // ribbonMaterial(width, brightness, waveAmount, wavePhase)
    this.meshes = [
      new THREE.Mesh(this.geo, this._material(2.2, 0.22, 0.35, 0)),
      new THREE.Mesh(this.geo, this._material(0.35, 0.50, 0.08, 0)),
      new THREE.Mesh(this.geo, this._material(0.85, 0.22, 0.8, 1.7)),
      new THREE.Mesh(this.geo, this._material(0.75, 0.18, -0.9, 3.9)),
    ];
    this.meshes.forEach(m => {
      m.frustumCulled = false;
      m.renderOrder = 998; // render right with transparency, before the sparkle Points (999)
      scene.add(m);
    });

    this._t = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._fallback = new THREE.Vector3(0, 0, 1);
  }

  _material(width, gain, wave, phase) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false, // trail skims the snow — testing depth made it clip/flicker
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.uTime, uGlowG: this.uGlow,
        uStreak: { value: this.streak },
        uWidth: { value: width * this.widthScale },
      uGain: { value: gain * this.gainScale },
        // The ripple amplitude is a world-space offset too, so it follows the
        // same scale as the ribbon width (otherwise the tail would wave ~1 m).
        uWob: { value: wave * this.widthScale }, uPh: { value: phase },
      },
      vertexShader: `
        uniform float uTime, uWidth, uWob, uPh;
        attribute vec3 aSide;
        attribute vec2 aEnvelope; // x = head envelope [0..1], y = tail envelope [0..1]
        varying vec2 vUv;
        varying vec2 vEnvelope;
        void main() {
          vUv = uv;
          vEnvelope = aEnvelope;
          float u = uv.x; // continuous time-parameter along the ribbon
          
          // Organic double-envelope taper:
          // Combines continuous temporal age falloff with structural endpoint pinching.
          // This guarantees 100% mathematical zero-width at the exact head vertex (sleigh)
          // and at the exact tail vertex (oldest waypoint), regardless of trail length or flight speed!
          float ageHeadTaper = smoothstep(0.0, 0.12, u);
          // Strictly ascending edges for 100% standard GLSL compliance across all mobile & desktop GPUs:
          float ageTailTaper = 1.0 - smoothstep(0.35, 0.85, u);
          // Pure sinusoidal pinching to exact 0 at structural endpoints (sleigh head and oldest tail waypoint)
          float taper = ageHeadTaper * ageTailTaper * aEnvelope.x * aEnvelope.y;
          float w = uWidth * taper * (1.0 - 0.25 * u) * 1.25;

          float off = sin(u * 18. - uTime * 4. + uPh) * uWob * u * aEnvelope.y; // ripple smoothly along the trail
          vec3 p = position + aSide * ((uv.y * 2. - 1.) * w + off);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
        }`,
      fragmentShader: `
        uniform float uTime, uGlowG, uGain, uStreak;
        varying vec2 vUv;
        varying vec2 vEnvelope;
        void main() {
          float u = vUv.x, d = abs(vUv.y * 2. - 1.);
          float core = exp(-d * d * 28.);
          float glow = exp(-d * d * 3.2) * (1.0 - d * d);

          // Combined temporal age fading + structural tip pinch fading:
          float ageHeadFade = smoothstep(0.0, 0.12, u);
          // Strictly ascending edges for GLSL mobile GPU compatibility:
          float ageTailFade = 1.0 - smoothstep(0.35, 0.85, u);
          float fade = ageHeadFade * ageTailFade * vEnvelope.x * vEnvelope.y;

          // Cross-sectional edge feathering so ribbon edges never show rectangular borders:
          fade *= (1.0 - smoothstep(0.15, 1.0, d));

          float st = .55 + .9 * (
            pow(.5 + .5 * sin(vUv.y * 17. + sin(u * 4. + uTime * .6) * 2. + 1.3), 10.) +
            .8 * pow(.5 + .5 * sin(vUv.y * 31. - sin(u * 3. - uTime * .5) * 2.), 12.)); // light streaks
          vec3 gold = vec3(1.0, 0.76, 0.35);
          vec3 warmGold = vec3(1.0, 0.90, 0.60);
          vec3 blue = vec3(0.40, 0.75, 1.0);
          vec3 c = mix(mix(warmGold, gold, u * 1.3), blue, smoothstep(.75, 1., u) * .35);
          c = mix(c, vec3(1.0, 0.98, 0.92), core * .35);
          gl_FragColor = vec4(c * (core * .75 + glow * .40 * st * uStreak) * fade * uGain * uGlowG, 1.);
        }`,
    });
  }

  _idx(k) { return (this._head + k) % this._cap; }   // k = 0 oldest ... count-1 newest

  _push(time, p) {
    if (this._count >= this._cap) { this._head = (this._head + 1) % this._cap; this._count--; }
    const i = this._idx(this._count);
    this._sx[i] = p.x; this._sy[i] = p.y; this._sz[i] = p.z; this._st[i] = time;
    this._count++;
  }

  /** Call once per frame. time = seconds, position = world-space trail start, forward = optional direction hint. */
  update(time, position, forward) {
    this.uTime.value = time;
    const life = this.life;

    // Time went backwards (scene restart): start over.
    if (this._count && time < this._st[this._idx(this._count - 1)] - 0.001) this.clear();

    // 1. Sample the anchor at a fixed time step (independent of speed and frame rate).
    if (this._count === 0 || time - this._st[this._idx(this._count - 1)] >= this._sampleDt) {
      this._push(time, position);
    }

    // 2. Prune. Keep ONE sample older than `life` so the tail can be interpolated at exactly `life`.
    while (this._count > 1 && time - this._st[this._idx(1)] >= life) {
      this._head = (this._head + 1) % this._cap;
      this._count--;
    }

    // 3. Build the ribbon, newest first: live head -> stored samples -> interpolated tail.
    const ax = this._ax, ay = this._ay, az = this._az, aage = this._aage;
    let n = 0;
    ax[0] = position.x; ay[0] = position.y; az[0] = position.z; aage[0] = 0; n = 1;

    for (let k = this._count - 1; k >= 0; k--) {
      const i = this._idx(k);
      const age = time - this._st[i];
      if (age <= 1e-4) continue;                                   // same instant as the live head
      const pAge = aage[n - 1];
      if (age >= life) {
        // This sample is older than the window: put the tail vertex at exactly age == life,
        // sliding along the path between this sample and the next newer vertex.
        const f = (life - pAge) / Math.max(age - pAge, 1e-6);
        ax[n] = ax[n - 1] + (this._sx[i] - ax[n - 1]) * f;
        ay[n] = ay[n - 1] + (this._sy[i] - ay[n - 1]) * f;
        az[n] = az[n - 1] + (this._sz[i] - az[n - 1]) * f;
        aage[n] = life; n++;
        break;
      }
      ax[n] = this._sx[i]; ay[n] = this._sy[i]; az[n] = this._sz[i]; aage[n] = age; n++;
    }

    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }

    // While the trail is still growing (just spawned / after reset) the oldest vertex is younger than `life`.
    // Normalise by the real span so the ribbon ALWAYS fades to nothing at its oldest vertex (no hard end).
    const span = Math.min(life, Math.max(aage[n - 1], 0.002));

    // Arc length from the head, so the ribbon also tapers to nothing at the end of its DRAWN length
    // (e.g. after the sleigh stops and restarts, when older samples are stacked on one spot).
    const aarc = this._aarc;
    aarc[0] = 0;
    for (let i = 1; i < n; i++) {
      aarc[i] = aarc[i - 1] + Math.hypot(ax[i] - ax[i - 1], ay[i] - ay[i - 1], az[i] - az[i - 1]);
    }
    const totalArc = aarc[n - 1];

    const cam = this.camera.position;
    const fb = forward || this._fallback;

    for (let i = 0; i < n; i++) {
      const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
      this._t.set(ax[a] - ax[b], ay[a] - ay[b], az[a] - az[b]);   // tangent along the trail
      if (this._t.lengthSq() < 1e-6) this._t.copy(fb);
      this._t.normalize();
      this._c.set(cam.x - ax[i], cam.y - ay[i], cam.z - az[i]);
      this._s.crossVectors(this._t, this._c);                      // sideways, so the ribbon faces the camera
      if (this._s.lengthSq() < 1e-8) this._s.set(1, 0, 0);
      this._s.normalize();

      // continuous: 0 at the sleigh, 1 at the tail. At constant speed age and arc length agree;
      // taking the larger one guarantees the visible end always reaches 1 (fully faded).
      const uAge = aage[i] / span;
      const uArc = totalArc > 0.02 ? aarc[i] / totalArc : 0.0;
      const u = THREE.MathUtils.clamp(Math.max(uAge, uArc), 0.0, 1.0);

      for (let k = 0; k < 2; k++) {
        const o = i * 2 + k;
        this.pos[o * 3]     = ax[i];
        this.pos[o * 3 + 1] = ay[i];
        this.pos[o * 3 + 2] = az[i];
        this.side[o * 3]     = this._s.x;
        this.side[o * 3 + 1] = this._s.y;
        this.side[o * 3 + 2] = this._s.z;
        this.uv[o * 2]     = u;
        this.uv[o * 2 + 1] = k;
      }
    }
    const at = this.geo.attributes;
    at.position.needsUpdate = at.aSide.needsUpdate = at.uv.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }

  get trailType() {
    return 'ribbon';
  }

  get drawnTriangles() {
    const count = this.geo?.drawRange?.count || 0;
    // 4 meshes render the same geometry -> total triangles across trail meshes
    return count > 0 ? (count / 3) * (this.meshes?.length || 4) : 0;
  }

  get drawnVertices() {
    const count = this.geo?.drawRange?.count || 0;
    return count > 0 ? (count / 6 + 1) * 2 : 0;
  }

  setGlow(v) { this.uGlow.value = v; }
  setLife(seconds) { this.life = seconds; this._sampleDt = seconds / this.samples; }
  clear() {
    this._head = 0;
    this._count = 0;
    this.geo.setDrawRange(0, 0);
  }
  /** Alias so call sites that reset every trail (`reset()`) work uniformly. */
  reset() { this.clear(); }

  dispose() {
    this.meshes.forEach(m => {
      m.material.dispose();
      this.scene.remove(m);
    });
    this.meshes.length = 0;
    this.geo.dispose();
    this._count = 0;
  }
}

export default MagicTrail;