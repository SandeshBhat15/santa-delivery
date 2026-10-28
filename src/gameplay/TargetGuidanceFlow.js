import * as THREE from 'three';

/**
 * TargetGuidanceFlow — Pure Golden Stardust Stream (Guiding Wind)
 *
 * 100% pure particle flow guidance inspired by Ghost of Tsushima's guiding wind.
 * NO giant glowing billboard orbs, NO polygon ribbons or solid tubes.
 *
 * Emits directly in front of the lead reindeer (+0.85m ahead of the sleigh)
 * and streams in continuous, fluid traveling waves along the 3D Bézier curve
 * toward the active rooftop chimney marker.
 *
 * Features:
 * - Fluid stream of tiny golden stardust specks (1.5px to 9px), embers, and diamond motes.
 * - Progressive wave flow: motes travel along the curve at natural wind speeds (4-6 m/s).
 * - Sleigh-front anchor: cleanly ahead of Santa and never clipping the camera.
 * - Periodic rhythmic wind gusts (and instant summon with 'G' or HUD button).
 * - Smooth proximity dissolve when approaching within 2.5m of the chimney.
 * - Zero GC / 100% pre-allocated buffer architecture.
 */
export class TargetGuidanceFlow {
  constructor(scene, isMobile = false) {
    this.scene = scene;
    this.isMobile = isMobile;

    // --- State & Timers ---
    this.isActive = false;
    this.isGusting = false;
    this.gustTimer = 0;
    this.gustDuration = 4.8;        // Duration of active streaming wind wave
    this.restTimer = 0;
    this.restDuration = 1.6;        // Calm lull between automatic gusts
    this.emissionAccumulator = 0;

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
    this.curveLength = 16.0;

    // Temporary scratch vectors for curve sampling without GC
    this._vTmp1 = new THREE.Vector3();
    this._vTmp2 = new THREE.Vector3();
    this._vTang = new THREE.Vector3();
    this._vNormal = new THREE.Vector3(0, 1, 0);
    this._vBinormal = new THREE.Vector3();

    // Palette: Enchanted Christmas Stardust (warm shimmering golds, soft champagne, amber)
    this.palette = [
      new THREE.Color(1.0, 0.88, 0.32), // Radiant Christmas Gold
      new THREE.Color(1.0, 0.96, 0.65), // Luminous Champagne
      new THREE.Color(1.0, 0.72, 0.16), // Warm Amber
      new THREE.Color(1.0, 1.0, 0.92),  // Diamond Star Frost
    ];

    this._initParticleSystem();
  }

  /* -------------------------------------------------------------------------
   * PURE STARDUST PARTICLE SYSTEM (Stream of tiny sparkling motes)
   * ------------------------------------------------------------------------- */
  _initParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Concentrated sparkling soft radial center (delicate stardust speck)
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 28);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.2, 'rgba(255, 240, 175, 0.90)');
    grad.addColorStop(0.5, 'rgba(255, 185, 45, 0.35)');
    grad.addColorStop(1.0, 'rgba(255, 140, 20, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();

    // Tiny delicate 4-point cross-glint
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(32, 8);
    ctx.lineTo(32, 56);
    ctx.moveTo(8, 32);
    ctx.lineTo(56, 32);
    ctx.stroke();

    this.particleTexture = new THREE.CanvasTexture(canvas);
    this.particleTexture.generateMipmaps = false;
    this.particleTexture.minFilter = THREE.LinearFilter;
  }

  _initParticleSystem() {
    this._initParticleTexture();

    // High density flow stream (380 desktop / 220 mobile motes)
    this.maxParticles = this.isMobile ? 220 : 380;
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
          // Delicate fine stardust size: 1.5px to 9.5px (never giant glowing balls)
          float ptSize = (size * 175.0) / eyeDist;
          gl_PointSize = clamp(ptSize, 1.5, 9.5);
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
          gl_FragColor = vec4(vColor * tex.rgb * 1.2, vAlpha * tex.a);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
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
        u: 0.0,            // Parameter t along the Bezier curve (0.0 to 1.0)
        speedU: 0.35,      // Speed along the curve per second
        swirlPhase: 0.0,   // Vortex rotation phase
        swirlRadius: 0.08, // Radial spread around the central flow centerline
        swirlSpeed: 4.0,   // Angular swirl speed
        age: 0,
        maxLife: 2.5,
        baseSize: 0.012,
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

    if (!this.isGusting && this.restTimer === 0) {
      this.summonWind();
    }
  }

  summonWind() {
    if (!this.isActive) return;
    this.isGusting = true;
    this.gustTimer = 0;
    this.restTimer = 0;
    this.emissionAccumulator = 0;
    if (this.particleMesh) this.particleMesh.visible = true;
  }

  _updateCurve() {
    // Sleigh-front launch anchor: 0.85m directly in front of the lead reindeer
    this.frontAnchor.copy(this.sleighPos).addScaledVector(this.sleighForward, 0.85);
    this.frontAnchor.y += 0.16;

    this.targetDirection.subVectors(this.targetPos, this.frontAnchor);
    this.targetDistance = this.targetDirection.length();
    if (this.targetDistance > 0.001) {
      this.targetDirection.normalize();
    } else {
      this.targetDirection.copy(this.sleighForward);
    }

    // Guidance arc length (14m to 18m reach)
    const maxPath = 17.0;
    this.curveLength = Math.min(this.targetDistance, maxPath);

    this.p0.copy(this.frontAnchor);

    if (this.targetDistance > maxPath) {
      this.p3.copy(this.p0).addScaledVector(this.targetDirection, this.curveLength);
    } else {
      this.p3.copy(this.targetPos);
    }

    // P1 shoots cleanly forward in reindeer flight heading
    const forwardLead = Math.min(this.curveLength * 0.35, 3.5);
    this.p1.copy(this.p0).addScaledVector(this.sleighForward, forwardLead);
    this.p1.y += 0.22;

    // P2 curves smoothly into the target rooftop chimney
    const targetLead = Math.min(this.curveLength * 0.35, 3.5);
    this.p2.copy(this.p3).addScaledVector(this.targetDirection, -targetLead);
    this.p2.y += 0.30;
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
   * PARTICLE FLOW STREAM EMISSION (Traveling currents)
   * ------------------------------------------------------------------------- */
  _emitStreamParticles(count = 2) {
    for (let c = 0; c < count; c++) {
      for (let i = 0; i < this.maxParticles; i++) {
        const p = this.pool[i];
        if (!p.active) {
          p.active = true;
          // Seed near origin with tiny jitter
          p.u = Math.random() * 0.03;
          // Wind travel rate: traverses 15m curve in ~2.5 - 3.2 seconds
          p.speedU = 0.32 + Math.random() * 0.16;
          p.swirlPhase = Math.random() * Math.PI * 2;
          p.swirlRadius = 0.04 + Math.random() * 0.12; // narrow ribbon-like stream
          p.swirlSpeed = (Math.random() - 0.5) * 5.0;
          p.age = 0;
          p.maxLife = 2.8;

          p.baseSize = this.isMobile
            ? (0.010 + Math.random() * 0.008)
            : (0.012 + Math.random() * 0.010);
          p.colorIndex = Math.floor(Math.random() * this.palette.length);
          p.glint = Math.random() < 0.28;

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
   * MAIN UPDATE LOOP (Flow of particles along curve)
   * ------------------------------------------------------------------------- */
  update(delta, sleighPos = null, sleighForward = null) {
    if (!this.isActive) return;

    if (sleighPos) this.sleighPos.copy(sleighPos);
    if (sleighForward) this.sleighForward.copy(sleighForward).normalize();
    this._updateCurve();

    // Proximity fade: smoothly dissolve within 2.5m of the chimney
    const closeFade = Math.min(1.0, Math.max(0.0, (this.targetDistance - 2.0) / 1.5));
    if (closeFade <= 0.05) {
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

    // 1. Manage Wind Gust Cycles
    if (this.isGusting) {
      this.gustTimer += delta;

      // Continuous emission during active wind gust (spawns flowing stardust currents)
      const emissionRate = this.isMobile ? 38 : 65; // particles per second
      this.emissionAccumulator += emissionRate * delta;
      const spawnCount = Math.floor(this.emissionAccumulator);
      if (spawnCount > 0) {
        this._emitStreamParticles(spawnCount);
        this.emissionAccumulator -= spawnCount;
      }

      if (this.gustTimer >= this.gustDuration) {
        this.isGusting = false;
        this.restTimer = 0;
      }
    } else {
      this.restTimer += delta;
      if (this.restTimer >= this.restDuration) {
        // Automatically start next guiding wind gust
        this.isGusting = true;
        this.gustTimer = 0;
        this.restTimer = 0;
        this.emissionAccumulator = 0;
      }
    }

    // 2. Update and Advance Stardust Flow along the Bézier Curve
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.pool[i];
      if (!p.active) continue;

      p.age += delta;
      p.u += p.speedU * delta;

      // Particle expires when reaching end of curve or exceeding lifespan
      if (p.u >= 1.0 || p.age >= p.maxLife) {
        p.active = false;
        this.alphasAttr[i] = 0.0;
        this.positions[i * 3 + 1] = -9999;
        continue;
      }

      // Sample central point on Bézier curve at current u
      this._sampleCurve(p.u, this._vTmp1);
      this._sampleCurveTangent(p.u, this._vTang);

      // Compute orthonormal coordinate frame for gentle vortex swirl
      this._vBinormal.crossVectors(this._vTang, this._vNormal).normalize();
      const localNormal = this._vTmp2.crossVectors(this._vBinormal, this._vTang).normalize();

      p.swirlPhase += p.swirlSpeed * delta;
      const cosPhase = Math.cos(p.swirlPhase) * p.swirlRadius;
      const sinPhase = Math.sin(p.swirlPhase) * p.swirlRadius;

      // Displace particle along normal and binormal plane for natural organic stream breadth
      const px = this._vTmp1.x + this._vBinormal.x * cosPhase + localNormal.x * sinPhase;
      const py = this._vTmp1.y + this._vBinormal.y * cosPhase + localNormal.y * sinPhase;
      const pz = this._vTmp1.z + this._vBinormal.z * cosPhase + localNormal.z * sinPhase;

      this.positions[i * 3]     = px;
      this.positions[i * 3 + 1] = py;
      this.positions[i * 3 + 2] = pz;

      // Opacity envelope: gentle fade-in near sleigh, glowing cruise, soft dissipation near target
      const fadeIn = Math.min(1.0, p.u / 0.12);
      const fadeOut = Math.max(0.0, (1.0 - p.u) / 0.18);
      let alpha = 0.90 * fadeIn * fadeOut * closeFade;

      if (p.glint) {
        alpha *= (0.75 + 0.25 * Math.sin(p.age * 22.0));
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
