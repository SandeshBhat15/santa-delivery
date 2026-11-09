import * as THREE from 'three';

/**
 * TargetGuidanceFlow
 * ----------------------------------------------------------------------------
 * A luminous stream of enchanted golden wind and stardust currents
 * connecting Santa directly to the next active drop point (cottage chimney).
 *
 * Visual Style:
 *  - Ethereal, shimmering ribbon stream of sparkling golden embers and stardust motes.
 *  - Arcs gracefully forward from Santa's lead reindeer and sweeps smoothly into
 *    the active rooftop chimney beacon.
 *  - Continuous, clear, radiant stream with sparkling glints.
 */
export class TargetGuidanceFlow {
  constructor(scene, isMobile = false) {
    this.scene = scene;
    this.isMobile = isMobile;

    // --- State & Timers ---
    this.isActive = false;
    this.isGusting = false;
    this.gustTimer = 0;
    this.gustDuration = 2.0;        // Periodic guidance pulse length (seconds)
    this.restTimer = 0;
    this.restDuration = 4.8;        // Calm interval between guidance streams
    this.emissionAccumulator = 0;
    this.lostTimer = 0;
    this.lostThreshold = 3.2;

    // Tracking Vectors
    this.sleighPos = new THREE.Vector3();
    this.sleighForward = new THREE.Vector3(0, 0, -1);
    this.frontAnchor = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.targetDirection = new THREE.Vector3(0, 0, -1);
    this.targetDistance = Infinity;

    // Bézier Control Points
    this.p0 = new THREE.Vector3();
    this.p1 = new THREE.Vector3();
    this.p2 = new THREE.Vector3();
    this.p3 = new THREE.Vector3();
    this.curveLength = 25.0;

    // Temporary scratch vectors for curve sampling without GC
    this._vTmp1 = new THREE.Vector3();
    this._vTmp2 = new THREE.Vector3();
    this._vTang = new THREE.Vector3();
    this._vNormal = new THREE.Vector3(0, 1, 0);
    this._vBinormal = new THREE.Vector3();

    // Palette: Enchanted Christmas Stardust (glowing warm golds, champagne, bright starlight)
    this.palette = [
      new THREE.Color(1.0, 0.90, 0.35), // Radiant Christmas Gold
      new THREE.Color(1.0, 0.98, 0.70), // Luminous Champagne
      new THREE.Color(1.0, 0.78, 0.22), // Warm Amber Gold
      new THREE.Color(1.0, 1.0, 0.95),  // Diamond Star Frost
    ];

    this._initParticleSystem();
  }

  /* -------------------------------------------------------------------------
   * PARTICLE SYSTEM & SHADER
   * ------------------------------------------------------------------------- */
  _initParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Soft, delicate golden stardust (restrained bloom profile)
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 26);
    grad.addColorStop(0.0, 'rgba(255, 250, 220, 0.90)');
    grad.addColorStop(0.3, 'rgba(255, 215, 120, 0.65)');
    grad.addColorStop(0.6, 'rgba(240, 165, 40, 0.25)');
    grad.addColorStop(1.0, 'rgba(200, 120, 20, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.fill();

    // Subtle 4-point cross-glint with restrained luminance
    ctx.strokeStyle = 'rgba(255, 245, 210, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(32, 6);
    ctx.lineTo(32, 58);
    ctx.moveTo(6, 32);
    ctx.lineTo(58, 32);
    ctx.stroke();

    this.particleTexture = new THREE.CanvasTexture(canvas);
    this.particleTexture.generateMipmaps = false;
    this.particleTexture.minFilter = THREE.LinearFilter;
  }

  _initParticleSystem() {
    this._initParticleTexture();

    // Density: 400 desktop / 240 mobile
    this.maxParticles = this.isMobile ? 240 : 400;
    this.pool = new Array(this.maxParticles);

    this.positions = new Float32Array(this.maxParticles * 3);
    this.colorsAttr = new Float32Array(this.maxParticles * 3);
    this.alphasAttr = new Float32Array(this.maxParticles);
    this.sizesAttr = new Float32Array(this.maxParticles);

    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleGeometry.setAttribute('customColor', new THREE.BufferAttribute(this.colorsAttr, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleGeometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphasAttr, 1).setUsage(THREE.DynamicDrawUsage));
    this.particleGeometry.setAttribute('size', new THREE.BufferAttribute(this.sizesAttr, 1).setUsage(THREE.DynamicDrawUsage));

    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        pointTexture: { value: this.particleTexture }
      },
      vertexShader: `
        attribute float alpha;
        attribute float size;
        attribute vec3 customColor;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = customColor;
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float eyeDist = max(-mvPosition.z, 0.1);
          // Gentle, refined stardust motes with clean depth-scale
          float ptSize = (size * 260.0) / eyeDist;
          gl_PointSize = clamp(ptSize, 2.5, 11.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D pointTexture;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          if (vAlpha <= 0.005) discard;
          vec4 tex = texture2D(pointTexture, gl_PointCoord);
          // Controlled luminance: luminous and clear without over-blooming
          gl_FragColor = vec4(vColor * tex.rgb * 0.95, vAlpha * tex.a * 0.85);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      fog: false
    });

    this.particleMesh = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.visible = false;
    this.particleMesh.renderOrder = 999;
    this.particleMesh.name = 'GuidingPureParticles';
    this.scene.add(this.particleMesh);

    for (let i = 0; i < this.maxParticles; i++) {
      this.pool[i] = {
        active: false,
        u: 0.0,
        speedU: 0.35,
        swirlPhase: 0.0,
        swirlRadius: 0.08,
        swirlSpeed: 4.0,
        age: 0,
        maxLife: 2.8,
        baseSize: 0.018,
        colorIndex: 0,
        glint: false
      };
      this.alphasAttr[i] = 0.0;
      this.positions[i * 3 + 1] = -9999;
    }
  }

  /* -------------------------------------------------------------------------
   * TARGET CONTROL & BEZIER MATH
   * ------------------------------------------------------------------------- */
  setTarget(sleighPos, sleighForward, targetPos) {
    if (!targetPos) {
      this.clear();
      return;
    }

    this.isActive = true;
    if (this.particleMesh) this.particleMesh.visible = true;

    if (sleighPos) this.sleighPos.copy(sleighPos);
    if (sleighForward) this.sleighForward.copy(sleighForward).normalize();
    this.targetPos.copy(targetPos);

    this._updateCurve();

    // Populate initial stream along curve immediately so user never waits
    this._seedInitialStream();

    // Trigger an initial prompt gust when setting a new target
    this.summonWind();
  }

  summonWind() {
    if (!this.isActive) return;
    this.isGusting = true;
    this.gustTimer = 0;
    this.restTimer = 0;
    this.emissionAccumulator = 0;
    this.lostTimer = 0;
    if (this.particleMesh) this.particleMesh.visible = true;
  }

  _seedInitialStream() {
    // Populate an initial breadcrumb stream along the entire curve
    const initialCount = this.isMobile ? 14 : 22;
    for (let c = 0; c < initialCount; c++) {
      for (let i = 0; i < this.maxParticles; i++) {
        const p = this.pool[i];
        if (!p.active) {
          p.active = true;
          // Spawn initial pulse heading out along the first half of the curve
          p.u = (c / initialCount) * 0.45 + 0.02;
          p.speedU = 0.38 + Math.random() * 0.12;
          p.swirlPhase = Math.random() * Math.PI * 2;
          p.swirlRadius = 0.04 + Math.random() * 0.08;
          p.swirlSpeed = (Math.random() - 0.5) * 4.0;
          p.age = p.u * 1.2;
          p.maxLife = 2.6;

          p.baseSize = this.isMobile
            ? (0.012 + Math.random() * 0.008)
            : (0.014 + Math.random() * 0.010);
          p.colorIndex = Math.floor(Math.random() * this.palette.length);
          p.glint = Math.random() < 0.35;

          const col = this.palette[p.colorIndex];
          this.colorsAttr[i * 3]     = col.r;
          this.colorsAttr[i * 3 + 1] = col.g;
          this.colorsAttr[i * 3 + 2] = col.b;
          this.sizesAttr[i] = p.baseSize;

          // Calculate initial position right away
          this._sampleCurve(p.u, this._vTmp1);
          this._sampleCurveTangent(p.u, this._vTang);
          this._vBinormal.crossVectors(this._vTang, this._vNormal).normalize();
          const localNormal = this._vTmp2.crossVectors(this._vBinormal, this._vTang).normalize();
          const cosPhase = Math.cos(p.swirlPhase) * p.swirlRadius;
          const sinPhase = Math.sin(p.swirlPhase) * p.swirlRadius;

          this.positions[i * 3]     = this._vTmp1.x + this._vBinormal.x * cosPhase + localNormal.x * sinPhase;
          this.positions[i * 3 + 1] = this._vTmp1.y + this._vBinormal.y * cosPhase + localNormal.y * sinPhase;
          this.positions[i * 3 + 2] = this._vTmp1.z + this._vBinormal.z * cosPhase + localNormal.z * sinPhase;

          const fadeIn = Math.min(1.0, p.u / 0.10);
          const fadeOut = Math.max(0.0, (1.0 - p.u) / 0.15);
          this.alphasAttr[i] = 0.95 * fadeIn * fadeOut;
          break;
        }
      }
    }

    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.alpha.needsUpdate = true;
    this.particleGeometry.attributes.size.needsUpdate = true;
    this.particleGeometry.attributes.customColor.needsUpdate = true;
  }

  _updateCurve() {
    // Sleigh-front launch anchor: directly in front of lead reindeer
    this.frontAnchor.copy(this.sleighPos).addScaledVector(this.sleighForward, 0.85);
    this.frontAnchor.y += 0.16;

    this.targetDirection.subVectors(this.targetPos, this.frontAnchor);
    this.targetDistance = this.targetDirection.length();
    if (this.targetDistance > 0.001) {
      this.targetDirection.normalize();
    } else {
      this.targetDirection.copy(this.sleighForward);
    }

    // Guidance arc length: connects directly to the target house
    this.curveLength = this.targetDistance;

    this.p0.copy(this.frontAnchor);
    // Connect into the elevated golden ring / beacon height (0.55m above rooftop)
    this.p3.copy(this.targetPos);
    this.p3.y += 0.55;

    // P1 shoots forward and curves naturally toward the target
    const lead = Math.min(this.curveLength * 0.35, 7.0);
    this.p1.copy(this.p0).addScaledVector(this.sleighForward, lead * 0.85);
    this.p1.addScaledVector(this.targetDirection, lead * 0.15);
    this.p1.y += 0.28;

    // P2 descends gracefully into the floating beacon ring
    this.p2.copy(this.p3).addScaledVector(this.targetDirection, -lead * 0.65);
    this.p2.y += 0.45;
  }

  clear() {
    this.isActive = false;
    this.isGusting = false;
    this.gustTimer = 0;
    this.restTimer = 0;

    for (let i = 0; i < this.maxParticles; i++) {
      this.pool[i].active = false;
      this.alphasAttr[i] = 0.0;
      this.positions[i * 3 + 1] = -9999;
    }
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.alpha.needsUpdate = true;

    if (this.particleMesh) this.particleMesh.visible = false;
  }

  _sampleCurve(t, out) {
    const omt = 1 - t;
    const omt2 = omt * omt;
    const omt3 = omt2 * omt;
    const t2 = t * t;
    const t3 = t2 * t;

    out.x = omt3 * this.p0.x + 3 * omt2 * t * this.p1.x + 3 * omt * t2 * this.p2.x + t3 * this.p3.x;
    out.y = omt3 * this.p0.y + 3 * omt2 * t * this.p1.y + 3 * omt * t2 * this.p2.y + t3 * this.p3.y;
    out.z = omt3 * this.p0.z + 3 * omt2 * t * this.p1.z + 3 * omt * t2 * this.p2.z + t3 * this.p3.z;
    return out;
  }

  _sampleCurveTangent(t, out) {
    const omt = 1 - t;
    out.x = 3 * omt * omt * (this.p1.x - this.p0.x) + 6 * omt * t * (this.p2.x - this.p1.x) + 3 * t * t * (this.p3.x - this.p2.x);
    out.y = 3 * omt * omt * (this.p1.y - this.p0.y) + 6 * omt * t * (this.p2.y - this.p1.y) + 3 * t * t * (this.p3.y - this.p2.y);
    out.z = 3 * omt * omt * (this.p1.z - this.p0.z) + 6 * omt * t * (this.p2.z - this.p1.z) + 3 * t * t * (this.p3.z - this.p2.z);
    out.normalize();
    return out;
  }

  /* -------------------------------------------------------------------------
   * PARTICLE FLOW STREAM EMISSION
   * ------------------------------------------------------------------------- */
  _emitStreamParticles(count = 2) {
    for (let c = 0; c < count; c++) {
      for (let i = 0; i < this.maxParticles; i++) {
        const p = this.pool[i];
        if (!p.active) {
          p.active = true;
          p.u = Math.random() * 0.02;
          p.speedU = 0.32 + Math.random() * 0.16;
          p.swirlPhase = Math.random() * Math.PI * 2;
          p.swirlRadius = 0.04 + Math.random() * 0.10;
          p.swirlSpeed = (Math.random() - 0.5) * 5.0;
          p.age = 0;
          p.maxLife = 3.0;

          p.baseSize = this.isMobile
            ? (0.014 + Math.random() * 0.010)
            : (0.018 + Math.random() * 0.014);
          p.colorIndex = Math.floor(Math.random() * this.palette.length);
          p.glint = Math.random() < 0.30;

          const col = this.palette[p.colorIndex];
          this.colorsAttr[i * 3]     = col.r;
          this.colorsAttr[i * 3 + 1] = col.g;
          this.colorsAttr[i * 3 + 2] = col.b;
          this.sizesAttr[i] = p.baseSize;
          this.alphasAttr[i] = 0.0;
          break;
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
   * MAIN UPDATE LOOP
   * ------------------------------------------------------------------------- */
  update(delta, sleighPos = null, sleighForward = null) {
    if (!this.isActive) return;

    if (sleighPos) this.sleighPos.copy(sleighPos);
    if (sleighForward) this.sleighForward.copy(sleighForward).normalize();
    this._updateCurve();

    // Proximity fade: smoothly dissolve only when very close (0.8m) to the chimney
    const closeFade = Math.min(1.0, Math.max(0.0, (this.targetDistance - 0.8) / 0.8));
    if (closeFade <= 0.02) {
      for (let i = 0; i < this.maxParticles; i++) {
        if (this.pool[i].active) {
          this.alphasAttr[i] *= (1.0 - 6.0 * delta);
          if (this.alphasAttr[i] < 0.01) {
            this.pool[i].active = false;
            this.positions[i * 3 + 1] = -9999;
          }
        }
      }
      this.particleGeometry.attributes.position.needsUpdate = true;
      this.particleGeometry.attributes.alpha.needsUpdate = true;
      return;
    }

    // Interval guidance flow: emits in graceful pulses rather than continuous solid stream
    const headingDot = this.sleighForward.dot(this.targetDirection);
    const isHeadingAway = headingDot < 0.25;

    if (this.isGusting) {
      this.gustTimer += delta;
      // Active pulse emission rate
      const pulseRate = this.isMobile ? 26 : 38;
      this.emissionAccumulator += pulseRate * delta;
      const spawnCount = Math.floor(this.emissionAccumulator);
      if (spawnCount > 0) {
        this._emitStreamParticles(spawnCount);
        this.emissionAccumulator -= spawnCount;
      }

      if (this.gustTimer >= this.gustDuration) {
        this.isGusting = false;
        this.restTimer = 0;
        this.lostTimer = 0;
      }
    } else {
      this.restTimer += delta;
      if (isHeadingAway) {
        this.lostTimer += delta;
      } else {
        this.lostTimer = Math.max(0, this.lostTimer - delta * 0.5);
      }
      // Re-trigger guiding pulse at configured interval (or when lost/off-heading)
      if (this.lostTimer >= this.lostThreshold || this.restTimer >= this.restDuration) {
        this.summonWind();
      }
    }

    // Update particles along Bézier curve
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.pool[i];
      if (!p.active) continue;

      p.age += delta;
      p.u += p.speedU * delta;

      if (p.u >= 1.0 || p.age >= p.maxLife) {
        p.active = false;
        this.alphasAttr[i] = 0.0;
        this.positions[i * 3 + 1] = -9999;
        continue;
      }

      this._sampleCurve(p.u, this._vTmp1);
      this._sampleCurveTangent(p.u, this._vTang);

      this._vBinormal.crossVectors(this._vTang, this._vNormal).normalize();
      const localNormal = this._vTmp2.crossVectors(this._vBinormal, this._vTang).normalize();

      p.swirlPhase += p.swirlSpeed * delta;
      const cosPhase = Math.cos(p.swirlPhase) * p.swirlRadius;
      const sinPhase = Math.sin(p.swirlPhase) * p.swirlRadius;

      const px = this._vTmp1.x + this._vBinormal.x * cosPhase + localNormal.x * sinPhase;
      const py = this._vTmp1.y + this._vBinormal.y * cosPhase + localNormal.y * sinPhase;
      const pz = this._vTmp1.z + this._vBinormal.z * cosPhase + localNormal.z * sinPhase;

      this.positions[i * 3]     = px;
      this.positions[i * 3 + 1] = py;
      this.positions[i * 3 + 2] = pz;

      const fadeIn = Math.min(1.0, p.u / 0.10);
      const fadeOut = Math.max(0.0, (1.0 - p.u) / 0.15);
      let alpha = 0.95 * fadeIn * fadeOut * closeFade;

      if (p.glint) {
        alpha *= (0.80 + 0.20 * Math.sin(p.age * 22.0));
        this.sizesAttr[i] = p.baseSize * (1.0 + 0.35 * Math.sin(p.age * 18.0));
      } else {
        this.sizesAttr[i] = p.baseSize;
      }

      this.alphasAttr[i] = Math.max(0.0, alpha);
    }

    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.alpha.needsUpdate = true;
    this.particleGeometry.attributes.size.needsUpdate = true;
  }

  dispose() {
    this.clear();
    if (this.particleMesh?.parent) this.particleMesh.parent.remove(this.particleMesh);
    if (this.particleGeometry) this.particleGeometry.dispose();
    if (this.particleMaterial) this.particleMaterial.dispose();
    if (this.particleTexture) this.particleTexture.dispose();
  }
}
