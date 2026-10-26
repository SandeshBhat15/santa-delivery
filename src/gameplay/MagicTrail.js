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
 * Usage:
 *   const trail = new MagicTrail(scene, camera, { life: 1.0, widthScale: 0.05, gainScale: 0.5 });
 *   trail.update(elapsedTime, anchorWorldPos, forwardVector);
 */
export class MagicTrail {
  constructor(scene, camera, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this.life = opts.life ?? 2;            // seconds the trail stays visible
    this.minDist = opts.minDist ?? 0.45;   // distance between stored trail points
    this.maxPoints = opts.maxPoints ?? 420;
    this.widthScale = opts.widthScale ?? 1;
    this.gainScale = opts.gainScale ?? 1; // keeps the additive stack gold instead of clipping to white
    this.streak = opts.streak ?? 1;       // light-streak amplitude in the ribbon (shimmer when < 1)
    this.points = [];                      // stored samples, oldest first: {x, y, z, t}

    const n = this.maxPoints;
    this.pos = new Float32Array(n * 6);
    this.side = new Float32Array(n * 6);
    this.uv = new Float32Array(n * 4);
    const idx = new Uint16Array((n - 1) * 6);
    for (let i = 0; i < n - 1; i++) {
      const a = 2 * i;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(this.side, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));

    // Uniforms shared by every layer
    this.uTime = { value: 0 };
    this.uGlow = { value: opts.glow ?? 1 };

    // Layers: wide soft glow, thin bright core, and two wavy strands
    // ribbonMaterial(width, brightness, waveAmount, wavePhase)
    this.meshes = [
      new THREE.Mesh(this.geo, this._material(2.4, 0.24, 0.45, 0)),
      new THREE.Mesh(this.geo, this._material(0.35, 0.55, 0.1, 0)),
      new THREE.Mesh(this.geo, this._material(0.9, 0.24, 1.0, 1.7)),
      new THREE.Mesh(this.geo, this._material(0.8, 0.2, -1.2, 3.9)),
    ];
    this.meshes.forEach(m => {
      m.frustumCulled = false;
      m.renderOrder = 2; // after opaque world, before the sparkle Points (3)
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
        varying vec2 vUv;
        void main() {
          vUv = uv;
          float u = uv.x;                                              // 0 at the head, 1 at the tail
          float w = uWidth * (.2 + .8 * smoothstep(0., .35, u)) * (1. - .7 * u);
          float off = sin(u * 18. - uTime * 4. + uPh) * uWob * u;      // ripple along the trail
          vec3 p = position + aSide * ((uv.y * 2. - 1.) * w + off);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
        }`,
      fragmentShader: `
        uniform float uTime, uGlowG, uGain, uStreak;
        varying vec2 vUv;
        void main() {
          float u = vUv.x, d = abs(vUv.y * 2. - 1.);
          float core = exp(-d * d * 30.);
          float glow = exp(-d * d * 2.8) * smoothstep(1., .7, d);
          float fade = pow(1. - u, 2.6) * smoothstep(0., .03, u + .03);  // fades out toward the tail
          float st = .55 + .9 * (
            pow(.5 + .5 * sin(vUv.y * 17. + sin(u * 4. + uTime * .6) * 2. + 1.3), 10.) +
            .8 * pow(.5 + .5 * sin(vUv.y * 31. - sin(u * 3. - uTime * .5) * 2.), 12.));  // light streaks
          vec3 gold = vec3(1., .78, .4), pale = vec3(1., .93, .7), blue = vec3(.5, .8, 1.);
          vec3 c = mix(mix(pale, gold, u * 1.3), blue, smoothstep(.75, 1., u) * .35);
          c = mix(c, vec3(1.), core * .3);
          gl_FragColor = vec4(c * (core * .7 + glow * .4 * st * uStreak) * fade * uGain * uGlowG, 1.);
        }`,
    });
  }

  /** Call once per frame. time = seconds, position = world-space trail start, forward = optional direction hint. */
  update(time, position, forward) {
    this.uTime.value = time;
    const pts = this.points, life = this.life;
    while (pts.length && time - pts[0].t > life) pts.shift();
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last.x - position.x, last.y - position.y, last.z - position.z) > this.minDist) {
      pts.push({ x: position.x, y: position.y, z: position.z, t: time });
    }

    const n = Math.min(pts.length, this.maxPoints);
    if (n === 0) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    const get = i => pts[pts.length - 1 - i];            // i = 0 is the newest point
    const cam = this.camera.position;
    const fb = forward || this._fallback;

    for (let i = 0; i < n; i++) {
      const p = get(i), a = get(Math.max(i - 1, 0)), b = get(Math.min(i + 1, n - 1));
      this._t.set(a.x - b.x, a.y - b.y, a.z - b.z);      // tangent along the trail
      if (this._t.lengthSq() < 1e-6) this._t.copy(fb);
      this._t.normalize();
      this._c.set(cam.x - p.x, cam.y - p.y, cam.z - p.z);
      this._s.crossVectors(this._t, this._c);            // sideways, so the ribbon faces the camera
      if (this._s.lengthSq() < 1e-8) this._s.set(1, 0, 0);
      this._s.normalize();
      const u = Math.min((time - p.t) / life, 1);
      for (let k = 0; k < 2; k++) {
        const o = i * 2 + k;
        this.pos[o * 3] = p.x; this.pos[o * 3 + 1] = p.y; this.pos[o * 3 + 2] = p.z;
        this.side[o * 3] = this._s.x; this.side[o * 3 + 1] = this._s.y; this.side[o * 3 + 2] = this._s.z;
        this.uv[o * 2] = u; this.uv[o * 2 + 1] = k;
      }
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aSide.needsUpdate = a.uv.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(n - 1, 0) * 6);
  }

  setGlow(v) { this.uGlow.value = v; }
  setLife(seconds) { this.life = seconds; }
  clear() { this.points.length = 0; }
  /** Alias so call sites that reset every trail (`reset()`) work uniformly. */
  reset() { this.clear(); }

  dispose() {
    this.meshes.forEach(m => {
      m.material.dispose();
      this.scene.remove(m);
    });
    this.meshes.length = 0;
    this.geo.dispose();
    this.points.length = 0;
  }
}

export default MagicTrail;