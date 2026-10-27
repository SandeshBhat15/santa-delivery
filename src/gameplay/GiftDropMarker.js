import * as THREE from 'three';

/**
 * GiftDropMarker: glowing drop-zone marker (snowflake icon, drop ring, subtle light beam, sparkles).
 * Calibrated with soft, non-glaring illumination that harmonizes with UnrealBloomPass.
 * Sized and tuned for the village house rooftop ridge scale.
 */
export const GIFT_MARKER_STATES = {
  default:  { color: [1.0, 0.72, 0.28],  css: '#e6a832', intensity: 0.32,  badge: null },    // Warm soft gold
  inrange:  { color: [0.22, 0.88, 0.42], css: '#2ecc71', intensity: 0.38,  badge: 'check' }, // Crisp emerald green
  outrange: { color: [0.92, 0.22, 0.22], css: '#e74c3c', intensity: 0.32,  badge: 'x' },     // Ruby red
  done:     { color: [0.55, 0.65, 0.78], css: '#7f8c8d', intensity: 0.10,  badge: null },    // Dimmed inactive
};

export class GiftDropMarker {
  static _sparkTex = null;

  constructor(parent, radius = 0.085, opts = {}) {
    this.radius = radius;
    this.iconHeight = opts.iconHeight ?? 0.48;   // Icon height above the ring, scaled for mini houses
    this.group = new THREE.Group();
    this.group.name = 'GiftDropMarkerGroup';
    parent.add(this.group);

    this.color = new THREE.Vector3(1.0, 0.72, 0.28);
    this.targetColor = new THREE.Vector3();
    this.intensity = 0.32;
    this.targetIntensity = 0.32;
    this.iconOpacity = 0.95;
    this.burstTime = -1;
    this.uColor = { value: this.color };
    this.uTime = { value: 0 };
    this.uIntensity = { value: 0.32 };

    this._buildRings(radius);
    this._buildBeams();
    this._buildIcon();
    this._buildSparkles();
    this.setState('default');
    this.color.copy(this.targetColor);
  }

  /* ---------- construction ---------- */
  _ringMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: this.uColor, uT: this.uTime, uI: this.uIntensity, uF: { value: 1 } },
      vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `
        uniform vec3 uColor; uniform float uT, uI, uF; varying vec2 v;
        void main() {
          vec2 p = v - .5; float r = length(p) * 2.; float d = r - .8;
          // Soft restrained gaussian band to prevent bloom blowout
          float co = 0.65 * exp(-d * d / .0085), ha = 0.30 * exp(-d * d / .045), a = co + ha;
          a *= .85 + .15 * sin(atan(p.y, p.x) * 3. + uT * 1.8);
          a *= smoothstep(1., .88, r);
          vec3 c = (mix(uColor, vec3(1.), .15) * co + uColor * vec3(1., .75, .50) * ha) * (a / (co + ha + .0001));
          gl_FragColor = vec4(c * uI * uF, 1.);
        }`,
    });
  }

  _addRing(radius, y) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._ringMaterial());
    m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(radius / .4);
    m.position.y = y;
    this.group.add(m);
    return m;
  }

  _buildRings(radius) {
    this.ring = this._addRing(radius, 0.018);                                  // Drop zone ring right on the roof ridge
    this.mini = [0, 1, 2].map(() => this._addRing(radius * .55, 0.12));        // Small rings drifting up the beam
    this.burstRing = this._addRing(radius, 0.022);
    this.burstRing.visible = false;
  }

  _buildBeams() {
    const H = 6.0; // Subtle vertical height
    const makeBeam = (rTop, rBottom, k) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(rTop, rBottom, H, 16, 1, true).translate(0, H / 2, 0),
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          uniforms: { uColor: this.uColor, uI: this.uIntensity, uK: { value: k } },
          vertexShader: `varying vec3 n, w; varying float h;
            void main(){ n = normalMatrix * normal; vec4 mv = modelViewMatrix * vec4(position, 1.); w = -mv.xyz; h = position.y / ${H}.; gl_Position = projectionMatrix * mv; }`,
          fragmentShader: `uniform vec3 uColor; uniform float uI, uK; varying vec3 n, w; varying float h;
            void main(){
              float f = pow(abs(dot(normalize(n), normalize(w))), 1.8);
              // Translucent, feather-soft atmospheric glow
              gl_FragColor = vec4(uColor * f * pow(clamp(1. - h * .88, 0.0, 1.0), 1.8) * uK * (uI * 0.45), 1.);
            }`,
        }));
      this.group.add(m);
      return m;
    };
    this.beams = [makeBeam(0.012, 0.028, 0.45), makeBeam(0.005, 0.014, 0.75)];  // Gentle slender beam
    this.needle = makeBeam(0.006, 0.012, 0);                                    // Subtle distant needle
  }

  _buildIcon() {
    this.iconCanvas = document.createElement('canvas');
    this.iconCanvas.width = 256;
    this.iconCanvas.height = 320;
    this.ix = this.iconCanvas.getContext('2d');
    this.iconTex = new THREE.CanvasTexture(this.iconCanvas);
    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.iconTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }));
    this.icon.center.set(.5, .406);
    this.group.add(this.icon);
  }

  _drawIcon(css, badge) {
    const ix = this.ix;
    ix.clearRect(0, 0, 256, 320);

    // Render crisp, controlled lines without excessive bloom flare
    const pass = (stroke, blur, wk) => {
      ix.strokeStyle = stroke;
      ix.lineCap = 'round';
      ix.shadowColor = css;
      ix.shadowBlur = blur;
      ix.lineWidth = 11 * wk;
      ix.beginPath();
      ix.arc(128, 190, 88, 0, 6.283);
      ix.stroke();
      ix.lineWidth = 8 * wk;
      ix.save();
      ix.translate(128, 190);
      for (let i = 0; i < 6; i++) {
        ix.rotate(1.0472);
        ix.beginPath();
        ix.moveTo(0, 0);
        ix.lineTo(0, -56);
        for (const d of [24, 40]) {
          ix.moveTo(0, -d);
          ix.lineTo(12, -d - 12);
          ix.moveTo(0, -d);
          ix.lineTo(-12, -d - 12);
        }
        ix.stroke();
      }
      ix.restore();
      if (badge) {
        ix.lineWidth = 6 * wk;
        ix.beginPath();
        ix.arc(128, 48, 28, 0, 6.283);
        ix.stroke();
        ix.beginPath();
        if (badge === 'check') {
          ix.moveTo(114, 48);
          ix.lineTo(125, 59);
          ix.lineTo(144, 37);
        } else {
          ix.moveTo(116, 36);
          ix.lineTo(140, 60);
          ix.moveTo(140, 36);
          ix.lineTo(116, 60);
        }
        ix.stroke();
      }
    };
    // Reduced shadow blur: 12px instead of 34px prevents over-exposure blowout
    pass(css, 12, 1);
    pass('#fffaf0', 0, 0.4);
    this.iconTex.needsUpdate = true;
  }

  _buildSparkles() {
    if (!GiftDropMarker._sparkTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,0.9)');
      r.addColorStop(.3, 'rgba(255,230,160,0.4)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
      const h = g.createLinearGradient(0, 0, 64, 0);
      const v = g.createLinearGradient(0, 0, 0, 64);
      [h, v].forEach(q => {
        q.addColorStop(0, 'rgba(255,255,255,0)');
        q.addColorStop(.5, 'rgba(255,240,180,0.8)');
        q.addColorStop(1, 'rgba(255,255,255,0)');
      });
      g.fillStyle = h;
      g.fillRect(0, 30.5, 64, 3);
      g.fillStyle = v;
      g.fillRect(30.5, 0, 3, 64);
      GiftDropMarker._sparkTex = new THREE.CanvasTexture(c);
    }
    const N = 32;
    this.sp = [];
    for (let i = 0; i < N; i++) {
      this.sp.push({
        a: Math.random() * 6.283,
        r: .025 + Math.random() * 0.065,
        y: Math.random() * 0.55,
        v: .10 + Math.random() * 0.22
      });
    }
    this.spPos = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.spPos, 3));
    this.sparks = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.045,
      map: GiftDropMarker._sparkTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
  }

  /* ---------- API ---------- */
  setState(name) {
    const s = GIFT_MARKER_STATES[name];
    if (!s) return;
    this.state = name;
    this.targetColor.set(s.color[0], s.color[1], s.color[2]);
    this.targetIntensity = s.intensity;
    this._drawIcon(s.css, s.badge);
  }

  burst() {
    this.burstTime = 0;
    this.burstRing.visible = true;
  }

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
  }

  setRotation(quaternion) {
    if (quaternion) {
      this.group.quaternion.copy(quaternion);
    }
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  /** dt and t in seconds, camDist = distance from the camera to the marker. */
  update(dt, t, camDist = 15.0) {
    if (!this.group.visible) return;

    const k1 = 1 - Math.exp(-dt * 6);
    this.color.lerp(this.targetColor, k1);
    this.intensity += (this.targetIntensity - this.intensity) * (1 - Math.exp(-dt * 5));
    this.uIntensity.value = this.intensity * (.95 + .05 * Math.sin(t * 2.5));
    this.uTime.value = t;

    // icon: gentle scaling with camera distance so it stays readable without ballooning
    const s = Math.min(Math.max(camDist / 14, 0.40), 1.6);
    const pulse = 1 + .02 * Math.sin(t * 2.5);
    const iy = this.iconHeight + (s - 0.40) * 0.22 + Math.sin(t * 1.5) * .025;
    this.icon.position.y = iy;
    this.icon.scale.set(0.35 * s * pulse, 0.44 * s * pulse, 1);
    this.iconOpacity += ((this.state === 'done' ? .2 : 0.95) - this.iconOpacity) * k1;
    this.icon.material.opacity = this.iconOpacity;

    // beam terminates neatly under the floating icon
    const kb = Math.sqrt(s * 0.65);
    const far = Math.min(Math.max((camDist - 22) / 30, 0), 1);
    this.beams.forEach(b => b.scale.set(kb, Math.max(iy - 0.08 * s, 0.25) / 6.0, kb));
    this.needle.visible = far > .01;
    this.needle.position.y = iy + 0.25 * s;
    this.needle.scale.set(kb, 1, kb);
    this.needle.material.uniforms.uK.value = far * 0.4;

    // mini rings drift up smoothly
    this.mini.forEach((m, i) => {
      const ph = (t * .38 + i / 3) % 1;
      m.position.y = .02 + ph * 0.45;
      m.material.uniforms.uF.value = Math.sin(ph * 3.14) * .65;
      m.scale.setScalar(this.radius * .55 * (1 - .25 * ph) / .4);
    });

    // sparkles rise gently
    const spH = 0.52;
    this.sp.forEach((p, i) => {
      p.y += p.v * dt;
      if (p.y > spH) p.y = 0;
      p.a += dt * .6;
      this.spPos[i * 3]     = Math.cos(p.a) * p.r;
      this.spPos[i * 3 + 1] = p.y;
      this.spPos[i * 3 + 2] = Math.sin(p.a) * p.r;
    });
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.material.color.setRGB(this.color.x, this.color.y, this.color.z);
    this.sparks.material.opacity = Math.min(this.intensity * 2.2, 0.85);

    // expanding ring flash after burst()
    if (this.burstTime >= 0) {
      this.burstTime += dt;
      const f = this.burstTime / .75;
      this.burstRing.scale.setScalar(this.radius * (1 + f * 1.8) / .4);
      this.burstRing.material.uniforms.uF.value = Math.max(1 - f, 0) * 0.8;
      if (f >= 1) {
        this.burstRing.visible = false;
        this.burstTime = -1;
      }
    }
  }

  dispose() {
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.iconTex.dispose();
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
  }
}
