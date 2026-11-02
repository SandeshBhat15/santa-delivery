import * as THREE from 'three';

/**
 * QualityPanel — Live on-screen touch quality controls and benchmarking panel (?debug=1)
 *
 * Controls:
 * - Pixel ratio cycle: 2.5 / 2.25 / 2 / 1.75 / 1.5
 * - Bloom on/off
 * - Composer on/off
 * - Lights 7 / merged (weak fill lights folded into hemisphere light)
 * - Shadows off / 1024 PCF / 2048 PCFSoft
 * - Chunks 3 / 4 / 5 / 6
 * - Fog on/off
 * - Copy settings and results button (5s average FPS, real renderer.info triangles and calls)
 *
 * After each toggle: calls renderer.compile(scene, camera) and ignores the first 2s of FPS.
 */
export class QualityPanel {
  constructor(context) {
    this.ctx = context;
    const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    this.enabled = urlParams.get('debug') === '1';

    const initialDpr = this.ctx.renderer ? this.ctx.renderer.getPixelRatio() : 2.0;
    const pixelRatios = [2.5, 2.25, 2.0, 1.75, 1.5];
    let dprIdx = pixelRatios.indexOf(initialDpr);
    if (dprIdx === -1) {
      dprIdx = 2; // Default 2.0
    }

    let chunkCap = 6;
try {
  chunkCap = window.chunkScheduler?.maxChunks || this.ctx.chunkSystem?.maxLoadedChunks || 6;
} catch (e) {}

    const chunkCaps = [3, 4, 5, 6];
    let chunkIdx = chunkCaps.indexOf(chunkCap);
    if (chunkIdx === -1) chunkIdx = 3; // Default 6

    this.state = {
      pixelRatios,
      pixelRatioIndex: dprIdx,
      bloom: true,
      composer: urlParams.get('composer') !== '0',
      lightsMerged: false,
      shadowModes: ['off', '1024 PCF', '2048 PCFSoft'],
      shadowModeIndex: 2, // Default 2048 PCFSoft
      chunkCaps,
      chunkCapIndex: chunkIdx,
      fog: true
    };

    // FPS averaging with 2s post-toggle warmup ignore
    this.warmupUntil = 0;
    this.fpsRing = new Float32Array(300);
    this.fpsRingIdx = 0;
    this.fpsRingCount = 0;

    if (!this.enabled) return;

    this._createDOM();
    this._updateButtonLabels();
  }

  get bloomEnabled() {
    return this.state ? this.state.bloom : true;
  }

  get composerEnabled() {
    return this.state ? this.state.composer : true;
  }

  update(fps) {
    if (!this.enabled || !this.state) return;
    const now = performance.now();
    if (now < this.warmupUntil) {
      this.fpsRingCount = 0;
      this.fpsRingIdx = 0;
      return;
    }
    if (Number.isFinite(fps) && fps > 0) {
      this.fpsRing[this.fpsRingIdx] = fps;
      this.fpsRingIdx = (this.fpsRingIdx + 1) % 300;
      if (this.fpsRingCount < 300) {
        this.fpsRingCount++;
      }
    }
  }

  getAverageFps() {
    if (this.fpsRingCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.fpsRingCount; i++) {
      sum += this.fpsRing[i];
    }
    return sum / this.fpsRingCount;
  }

  _onToggle() {
    this.warmupUntil = performance.now() + 2000;
    this.fpsRingCount = 0;
    this.fpsRingIdx = 0;

    try {
      if (this.ctx.renderer && this.ctx.scene && this.ctx.camera) {
        this.ctx.renderer.compile(this.ctx.scene, this.ctx.camera);
      }
    } catch (err) {
      console.warn('[QualityPanel] renderer.compile error:', err);
    }
    this._updateButtonLabels();
  }

  cyclePixelRatio() {
    this.state.pixelRatioIndex = (this.state.pixelRatioIndex + 1) % this.state.pixelRatios.length;
    const dpr = this.state.pixelRatios[this.state.pixelRatioIndex];
    const { renderer, composer, bloomPass } = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (renderer) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h);
    }
    if (composer) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
    }
    if (bloomPass && bloomPass.setSize) {
      bloomPass.setSize(Math.round(w * dpr), Math.round(h * dpr));
    }
    this._onToggle();
  }

  toggleBloom() {
    this.state.bloom = !this.state.bloom;
    if (this.ctx.bloomPass) {
      this.ctx.bloomPass.enabled = this.state.bloom;
    }
    this._onToggle();
  }

  toggleComposer() {
    this.state.composer = !this.state.composer;
    this._onToggle();
  }

  toggleLights() {
    this.state.lightsMerged = !this.state.lightsMerged;
    const { starlightHemiLight, villageFacadeLight, ambientWarm, auroraGroundLight } = this.ctx;
    if (this.state.lightsMerged) {
      // Fold weak fill lights into the hemisphere light
      if (villageFacadeLight) villageFacadeLight.visible = false;
      if (ambientWarm) ambientWarm.visible = false;
      if (auroraGroundLight) auroraGroundLight.visible = false;
      if (starlightHemiLight) starlightHemiLight.intensity = 0.74; // 0.46 + 0.14 + 0.14
    } else {
      // Restore all 7 lights
      if (villageFacadeLight) villageFacadeLight.visible = true;
      if (ambientWarm) ambientWarm.visible = true;
      if (auroraGroundLight) auroraGroundLight.visible = true;
      if (starlightHemiLight) starlightHemiLight.intensity = 0.46;
    }
    this._onToggle();
  }

  cycleShadows() {
    this.state.shadowModeIndex = (this.state.shadowModeIndex + 1) % this.state.shadowModes.length;
    const mode = this.state.shadowModes[this.state.shadowModeIndex];
    const { renderer, moonLight } = this.ctx;

    if (mode === 'off') {
      if (renderer) renderer.shadowMap.enabled = false;
      if (moonLight) moonLight.castShadow = false;
    } else if (mode === '1024 PCF') {
      if (renderer) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
      }
      if (moonLight) {
        moonLight.castShadow = true;
        moonLight.shadow.mapSize.set(1024, 1024);
        if (moonLight.shadow.map) {
          moonLight.shadow.map.dispose();
          moonLight.shadow.map = null;
        }
      }
    } else if (mode === '2048 PCFSoft') {
      if (renderer) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
      if (moonLight) {
        moonLight.castShadow = true;
        moonLight.shadow.mapSize.set(2048, 2048);
        if (moonLight.shadow.map) {
          moonLight.shadow.map.dispose();
          moonLight.shadow.map = null;
        }
      }
    }
    this._onToggle();
  }

  cycleChunks() {
    this.state.chunkCapIndex = (this.state.chunkCapIndex + 1) % this.state.chunkCaps.length;
    const newCap = this.state.chunkCaps[this.state.chunkCapIndex];
    if (window.chunkScheduler) {
      window.chunkScheduler.maxChunks = newCap;
    }
    if (this.ctx.chunkSystem) {
      this.ctx.chunkSystem.maxLoadedChunks = newCap;
      while (this.ctx.chunkSystem.chunks.size > newCap) {
        if (window.chunkScheduler && window.chunkScheduler.evictLowestPriority) {
          const evicted = window.chunkScheduler.evictLowestPriority();
          if (!evicted) break;
        } else {
          break;
        }
      }
    }
    this._onToggle();
  }

  toggleFog() {
    this.state.fog = !this.state.fog;
    if (window.mobileFog) {
      window.mobileFog.enabled = this.state.fog;
      if (this.ctx.scene) {
        this.ctx.scene.fog = this.state.fog ? window.mobileFog.fog : null;
      }
    }
    this._onToggle();
  }

  copyResults() {
    const avgFps = this.getAverageFps().toFixed(1);
    const triangles = this.ctx.renderer?.info?.render?.triangles ?? 0;
    const calls = this.ctx.renderer?.info?.render?.calls ?? 0;
    const dpr = this.state.pixelRatios[this.state.pixelRatioIndex];
    const shadowMode = this.state.shadowModes[this.state.shadowModeIndex];
    const chunkCap = this.state.chunkCaps[this.state.chunkCapIndex];

    const text = [
      '=== QUALITY BENCHMARK RESULTS ===',
      `5s Average FPS: ${avgFps}`,
      `Render Triangles: ${triangles.toLocaleString()}`,
      `Draw Calls: ${calls}`,
      `Pixel Ratio (DPR): ${dpr}x`,
      `Bloom: ${this.state.bloom ? 'ON' : 'OFF'}`,
      `Composer: ${this.state.composer ? 'ON' : 'OFF'}`,
      `Lights: ${this.state.lightsMerged ? 'Merged (3 lights, fill merged into hemi)' : '7 Lights'}`,
      `Shadows: ${shadowMode}`,
      `Chunk Cap: ${chunkCap}`,
      `Fog: ${this.state.fog ? 'ON' : 'OFF'}`,
      `Loaded Chunks: ${this.ctx.chunkSystem?.chunks?.size ?? 'n/a'}`,
      `Model: ${window._loadedModelName || 'terrain.glb'}`,
      `Timestamp: ${new Date().toISOString()}`
    ].join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this._showCopyNotification('Copied to clipboard!');
      }).catch(() => {
        this._showCopyNotification('Copy failed');
      });
    } else {
      console.log(text);
      this._showCopyNotification('Printed to console');
    }
  }

  _showCopyNotification(msg) {
    if (!this.copyBtn) return;
    const originalText = this.copyBtn.textContent;
    this.copyBtn.textContent = msg;
    this.copyBtn.style.borderColor = '#4ade80';
    this.copyBtn.style.color = '#4ade80';
    setTimeout(() => {
      if (this.copyBtn) {
        this.copyBtn.textContent = originalText;
        this.copyBtn.style.borderColor = '#f59e0b';
        this.copyBtn.style.color = '#fef08a';
      }
    }, 1800);
  }

  _updateButtonLabels() {
    if (!this.dom) return;
    const dpr = this.state.pixelRatios[this.state.pixelRatioIndex];
    if (this.btnDpr) this.btnDpr.textContent = `DPR: ${dpr}x`;
    if (this.btnBloom) this.btnBloom.textContent = `Bloom: ${this.state.bloom ? 'ON' : 'OFF'}`;
    if (this.btnComposer) this.btnComposer.textContent = `Composer: ${this.state.composer ? 'ON' : 'OFF'}`;
    if (this.btnLights) this.btnLights.textContent = `Lights: ${this.state.lightsMerged ? 'Merged' : '7'}`;
    if (this.btnShadows) this.btnShadows.textContent = `Shadows: ${this.state.shadowModes[this.state.shadowModeIndex]}`;
    if (this.btnChunks) this.btnChunks.textContent = `Chunks: ${this.state.chunkCaps[this.state.chunkCapIndex]}`;
    if (this.btnFog) this.btnFog.textContent = `Fog: ${this.state.fog ? 'ON' : 'OFF'}`;
  }

  _createDOM() {
    const container = document.createElement('div');
    container.id = 'quality-panel';
    container.style.cssText = `
      position: fixed;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 10px;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(56, 189, 248, 0.5);
      border-radius: 8px;
      backdrop-filter: blur(6px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      max-width: 95vw;
    `;

    const createBtn = (id, label, onClick, extraStyle = '') => {
      const btn = document.createElement('button');
      btn.id = id;
      btn.textContent = label;
      btn.style.cssText = `
        font-family: monospace;
        font-size: 11px;
        font-weight: 600;
        padding: 5px 9px;
        background: #1e293b;
        color: #e2e8f0;
        border: 1px solid #38bdf8;
        border-radius: 5px;
        cursor: pointer;
        touch-action: manipulation;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
        white-space: nowrap;
        ${extraStyle}
      `;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      container.appendChild(btn);
      return btn;
    };

    this.btnDpr = createBtn('qp-btn-dpr', 'DPR', () => this.cyclePixelRatio());
    this.btnBloom = createBtn('qp-btn-bloom', 'Bloom', () => this.toggleBloom());
    this.btnComposer = createBtn('qp-btn-composer', 'Composer', () => this.toggleComposer());
    this.btnLights = createBtn('qp-btn-lights', 'Lights', () => this.toggleLights());
    this.btnShadows = createBtn('qp-btn-shadows', 'Shadows', () => this.cycleShadows());
    this.btnChunks = createBtn('qp-btn-chunks', 'Chunks', () => this.cycleChunks());
    this.btnFog = createBtn('qp-btn-fog', 'Fog', () => this.toggleFog());

    this.copyBtn = createBtn('qp-btn-copy', '📋 Copy Results', () => this.copyResults(), 'border-color: #f59e0b; color: #fef08a;');

    document.body.appendChild(container);
    this.dom = container;
  }
}
