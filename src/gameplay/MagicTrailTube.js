import * as THREE from 'three';

/**
 * =============================================================================
 * MAGIC TRAIL (TUBE) — SOFT 3D GOLDEN LIGHT TUBE
 * =============================================================================
 * Drop-in replacement for MagicTrail (same constructor options, same methods).
 * Instead of a flat camera-facing ribbon, the trail is a thin 3D TUBE rendered as
 * a glowing light-rod: brightness depends on how directly the surface faces the
 * camera (fresnel-style), so the silhouette fades to nothing and there is never a
 * hard edge. It looks the same from the side, from above and from straight behind
 * (a flat ribbon collapses or twists when viewed along its length).
 *
 * - ONE draw call (the ribbon used 4), one small shared geometry, additive blending.
 * - Same colours, light streaks, ripple and head/tail tapering as the ribbon.
 * - The tail: sampled by TIME, interpolated at exactly `life` seconds, radius and
 *   brightness both reach 0 there -> a rounded point, never a cut.
 * - Near-camera fade: when part of the trail comes close to the lens it fades out
 *   instead of being sliced by the near plane (a common cause of a hard "cut").
 *
 * Usage:
 *   const trail = new MagicTrailTube(scene, camera, { life: 1.0, widthScale: 0.05, gainScale: 0.5 });
 *   trail.update(elapsedTime, anchorWorldPos, forwardVector);
 */
export class MagicTrailTube {
  constructor(scene, camera, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this.life = opts.life ?? 2;
    this.minDist = opts.minDist ?? 0.45;              // API compatibility only (sampling is by time)
    this.maxPoints = opts.maxPoints ?? 420;
    this.widthScale = opts.widthScale ?? 1;
    this.gainScale = opts.gainScale ?? 1;
    this.streak = opts.streak ?? 1;
    this.radius = opts.radius ?? 2.75 * this.widthScale;   // same outer extent as the ribbon's glow layer
    this.wobble = opts.wobble ?? 0.15;                 // surface ripple (fraction of radius)
    this.radial = Math.max(5, Math.min(opts.radial ?? 8, 16));

    // --- time-sampled history (ring buffer, no per-frame allocation) ---
    this.samples = Math.max(8, Math.min(opts.samples ?? 48, this.maxPoints - 8));
    this._cap = this.samples + 8;
    this._sx = new Float32Array(this._cap);
    this._sy = new Float32Array(this._cap);
    this._sz = new Float32Array(this._cap);
    this._st = new Float64Array(this._cap);
    this._head = 0;
    this._count = 0;
    this._sampleDt = this.life / this.samples;

    const maxN = this._cap + 2;                        // samples + live head + interpolated tail
    this._ax = new Float32Array(maxN);
    this._ay = new Float32Array(maxN);
    this._az = new Float32Array(maxN);
    this._aage = new Float32Array(maxN);
    this._aarc = new Float32Array(maxN);

    // --- tube geometry: (radial + 1) vertices per ring, rings from the sleigh back to the tail ---
    const R = this.radial, vpr = R + 1;
    this._vpr = vpr;
    const nv = maxN * vpr;
    this.pos = new Float32Array(nv * 3);   // ring centre (the shader pushes it out along aN/aB)
    this.aN = new Float32Array(nv * 3);
    this.aB = new Float32Array(nv * 3);
    this.uv = new Float32Array(nv * 2);    // x = age fraction along the trail, y = angle around the tube (0..1)
    const idx = new Uint16Array((maxN - 1) * R * 6);
    let w = 0;
    for (let i = 0; i < maxN - 1; i++) {
      for (let j = 0; j < R; j++) {
        const a = i * vpr + j, b = a + vpr;
        idx[w++] = a; idx[w++] = b; idx[w++] = a + 1;       // winding verified by test: faces point OUT of the tube
        idx[w++] = b; idx[w++] = b + 1; idx[w++] = a + 1;
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aN', new THREE.BufferAttribute(this.aN, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aB', new THREE.BufferAttribute(this.aB, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));

    this.uTime = { value: 0 };
    this.uGlow = { value: opts.glow ?? 1 };
    this.material = this._material(opts);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 998;
    scene.add(this.mesh);
    this.meshes = [this.mesh];                         // same field the ribbon exposes

    this._t = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._fallback = new THREE.Vector3(0, 0, 1);
  }

  _material(opts) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,            // the trail skims the snow; depth testing made it clip/flicker
      side: THREE.FrontSide,       // one layer of fragments: only the faces turned toward the camera
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.uTime,
        uGlowG: this.uGlow,
        uStreak: { value: this.streak },
        uGain: { value: this.gainScale },
        uRadius: { value: this.radius },
        uWob: { value: this.wobble },
        uNear0: { value: opts.nearFadeStart ?? 0.08 },   // metres from the camera: fully hidden below this
        uNear1: { value: opts.nearFadeEnd ?? 0.6 }       // ... fully visible above this
      },
      vertexShader: `
        uniform float uTime, uRadius, uWob;
        attribute vec3 aN;
        attribute vec3 aB;
        varying vec2 vUv;
        varying vec3 vNrm;
        varying vec3 vView;
        varying vec3 vAxis;
        void main() {
          vUv = uv;
          vAxis = cross(aN, aB);      // direction of the tube at this ring
          float u = uv.x;
          float th = uv.y * 6.2831853;
          vec3 dir = aN * cos(th) + aB * sin(th);

          // radius tapers to exactly 0 at the sleigh (u = 0) and at the tail (u = 1): round, never cut.
          // The head taper is long (a third of the trail) so it still looks soft when seen from straight behind.
          float taper = smoothstep(0.0, 0.34, u) * (1.0 - smoothstep(0.35, 1.0, u));
          float r = uRadius * taper * (1.0 - 0.25 * u);
          r *= 1.0 + uWob * sin(u * 18. - uTime * 4. + th * 2.);   // ripple travelling along the tube

          vec3 p = position + dir * r;
          vNrm = dir;
          vView = cameraPosition - p;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
        }`,
      fragmentShader: `
        uniform float uTime, uGlowG, uGain, uStreak, uNear0, uNear1;
        varying vec2 vUv;
        varying vec3 vNrm;
        varying vec3 vView;
        varying vec3 vAxis;
        void main() {
          float u = vUv.x;
          float dist = length(vView);
          vec3 V = vView / max(dist, 1e-4);
          // Seen along its length a plain fresnel tube goes dark, but a real glow gets BRIGHTER (more of it along the
          // line of sight). Remove the viewing-angle term from the profile and add it back as thickness.
          float vt = dot(V, normalize(vAxis));
          float sinPhi = sqrt(max(1.0 - vt * vt, 0.0025));
          float ndv = clamp(dot(normalize(vNrm), V) / sinPhi, 0.0, 1.0);   // 1 = centre of the tube, 0 = silhouette (any angle)
          float thick = mix(1.0, clamp(1.0 / sinPhi, 1.0, 3.0), 0.65);

          float core = pow(ndv, 64.0);   // thin bright centre line
          float glow = pow(ndv, 7.0);    // soft halo that fades to NOTHING at the silhouette: no hard edge

          float head = smoothstep(0.0, 0.30, u);
          float fade = head * head * (1.0 - smoothstep(0.35, 1.0, u));   // eases in from the sleigh: no blunt start when seen from behind
          fade *= smoothstep(uNear0, uNear1, dist);                                  // never sliced by the near plane

          float y = vUv.y;               // light streaks swirl around the tube (integer multiples of 2*pi: no seam)
          float st = .55 + .9 * (
            pow(.5 + .5 * sin(y * 18.849556 + sin(u * 4. + uTime * .6) * 2. + 1.3), 10.) +
            .8 * pow(.5 + .5 * sin(y * 31.415927 - sin(u * 3. - uTime * .5) * 2.), 12.));

          vec3 gold = vec3(1.0, 0.76, 0.35);
          vec3 warmGold = vec3(1.0, 0.90, 0.60);
          vec3 blue = vec3(0.40, 0.75, 1.0);
          vec3 c = mix(mix(warmGold, gold, u * 1.3), blue, smoothstep(.75, 1., u) * .35);
          c = mix(c, vec3(1.0, 0.98, 0.92), core * .35);

          // matched by eye to the four ribbon layers combined (thin bright core + soft streaky halo)
          float I = (core * .62 + glow * .28 * st * uStreak) * thick;
          gl_FragColor = vec4(c * I * fade * uGain * uGlowG, 1.);
        }`
    });
  }

  _idx(k) { return (this._head + k) % this._cap; }

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

    if (this._count && time < this._st[this._idx(this._count - 1)] - 0.001) this.clear();

    if (this._count === 0 || time - this._st[this._idx(this._count - 1)] >= this._sampleDt) this._push(time, position);

    while (this._count > 1 && time - this._st[this._idx(1)] >= life) {
      this._head = (this._head + 1) % this._cap;
      this._count--;
    }

    // Path, newest first: live head -> samples -> tail interpolated at exactly `life` seconds old.
    const ax = this._ax, ay = this._ay, az = this._az, aage = this._aage;
    ax[0] = position.x; ay[0] = position.y; az[0] = position.z; aage[0] = 0;
    let n = 1;
    for (let k = this._count - 1; k >= 0; k--) {
      const i = this._idx(k);
      const age = time - this._st[i];
      if (age <= 1e-4) continue;
      const pAge = aage[n - 1];
      if (age >= life) {
        const f = (life - pAge) / Math.max(age - pAge, 1e-6);
        ax[n] = ax[n - 1] + (this._sx[i] - ax[n - 1]) * f;
        ay[n] = ay[n - 1] + (this._sy[i] - ay[n - 1]) * f;
        az[n] = az[n - 1] + (this._sz[i] - az[n - 1]) * f;
        aage[n] = life; n++;
        break;
      }
      ax[n] = this._sx[i]; ay[n] = this._sy[i]; az[n] = this._sz[i]; aage[n] = age; n++;
    }
    if (n < 2) { this.geo.setDrawRange(0, 0); return; }

    const span = Math.min(life, Math.max(aage[n - 1], 0.002));
    const aarc = this._aarc;
    aarc[0] = 0;
    for (let i = 1; i < n; i++) aarc[i] = aarc[i - 1] + Math.hypot(ax[i] - ax[i - 1], ay[i] - ay[i - 1], az[i] - az[i - 1]);
    const totalArc = aarc[n - 1];

    const fb = forward || this._fallback;
    const vpr = this._vpr, R = this.radial;
    const T = this._t, N = this._n, B = this._b;

    for (let i = 0; i < n; i++) {
      const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
      T.set(ax[a] - ax[b], ay[a] - ay[b], az[a] - az[b]);          // direction of travel
      if (T.lengthSq() < 1e-6) T.copy(fb);
      T.normalize();
      // Stable frame from world-up (so the light streaks never spin from frame to frame).
      let ux = 0, uy = 1, uz = 0;
      if (Math.abs(T.y) > 0.98) { ux = 1; uy = 0; }
      const d = ux * T.x + uy * T.y + uz * T.z;
      N.set(ux - T.x * d, uy - T.y * d, uz - T.z * d).normalize();
      B.crossVectors(T, N);

      const uAge = aage[i] / span;
      const uArc = totalArc > 0.02 ? aarc[i] / totalArc : 0.0;
      const u = THREE.MathUtils.clamp(Math.max(uAge, uArc), 0.0, 1.0);

      for (let j = 0; j <= R; j++) {
        const o = i * vpr + j;
        this.pos[o * 3] = ax[i]; this.pos[o * 3 + 1] = ay[i]; this.pos[o * 3 + 2] = az[i];
        this.aN[o * 3] = N.x; this.aN[o * 3 + 1] = N.y; this.aN[o * 3 + 2] = N.z;
        this.aB[o * 3] = B.x; this.aB[o * 3 + 1] = B.y; this.aB[o * 3 + 2] = B.z;
        this.uv[o * 2] = u;
        this.uv[o * 2 + 1] = j / R;
      }
    }
    const at = this.geo.attributes;
    at.position.needsUpdate = at.aN.needsUpdate = at.aB.needsUpdate = at.uv.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * R * 6);
    this._lastN = n;
  }

  get trailType() {
    return 'tube';
  }

  get drawnTriangles() {
    const count = this.geo?.drawRange?.count || 0;
    return count > 0 ? Math.floor(count / 3) : 0;
  }

  get drawnVertices() {
    const count = this.geo?.drawRange?.count || 0;
    if (count <= 0) return 0;
    const rings = Math.floor(count / (this.radial * 6));
    return (rings + 1) * (this.radial + 1);
  }

  setGlow(v) { this.uGlow.value = v; }
  setLife(seconds) { this.life = seconds; this._sampleDt = seconds / this.samples; }
  clear() { this._head = 0; this._count = 0; this.geo.setDrawRange(0, 0); }
  reset() { this.clear(); }

  dispose() {
    this.material.dispose();
    this.scene.remove(this.mesh);
    this.meshes.length = 0;
    this.geo.dispose();
    this._count = 0;
  }
}

export default MagicTrailTube;
