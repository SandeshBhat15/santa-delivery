import * as THREE from 'three';

/**
 * PerformanceDebugger — Comprehensive Phase 1 Diagnostics Suite (v2)
 *
 * Updated per requirements:
 * 1. Accurately tracks full-frame draw calls/triangles with renderer.info.autoReset = false.
 * 2. Independent rAF FPS counter that never drops to 0 or freezes when render is skipped or logic is paused.
 * 3. 1.5s warmup (shader compiles) + 3s sampling + 2s thermal settle cooldown between tests.
 * 4. Baseline drift / thermal throttling detection (measures baseline at start and end).
 * 5. Object Bisect Tests: Hides one group of scene objects at a time (characters, enemies/targets,
 *    buildings, trees, cliffs, terrain, particles, sky) and reports meshes, draw calls, triangles, and FPS gain.
 * 6. Scene Audit & GPU Memory Report:
 *    - Top 15 meshes by triangle count (name, triangles, material type).
 *    - SkinnedMesh objects & total bone count.
 *    - Material distribution (Standard, Physical, Lambert, Basic, ShaderMaterial).
 *    - Materials using transmission, clearcoat, envMap, normal/roughness maps.
 *    - All textures with resolution (WxH) and estimated GPU VRAM.
 *    - Lights & shadow-casting lights.
 *    - CPU JS logic time vs render time vs total frame time.
 * 7. Copy results & Download .txt buttons formatted cleanly for pasting.
 */
const BUILD_VERSION = 'v2.4-mobile-audit';

export class PerformanceDebugger {
  constructor(gameContext) {
    this.ctx = gameContext;
    this.enabled = window.location.search.includes('debug=1');

    // Make sure autoReset is disabled so we accumulate full frame calls across all passes
    if (this.ctx.renderer) {
      this.ctx.renderer.info.autoReset = false;
    }

    // Live toggle state (baseline: matches defaults)
    this.state = {
      pixelRatio: this.ctx.renderer.getPixelRatio(),
      shadows: this.ctx.renderer.shadowMap.enabled,
      postProcessing: true,
      antialiasing: true,
      particles: true,
      groundOnly: false,
      pauseLogic: false,
      skipRender: false,
      dynamicLights: true
    };

    // Timing splits (ms)
    this.logicTime = 0;
    this.renderTime = 0;
    this.frameTime = 0;
    this.avgLogicTime = 0;
    this.avgRenderTime = 0;
    this.avgFrameTime = 0;

    // Independent rAF FPS Counter
    this.rAfFps = 0;
    this.rAfFrames = 0;
    this.rAfLastTime = performance.now();
    this.rAfHistory = [];

    // Telemetry snapshot
    this.lastCalls = 0;
    this.lastTriangles = 0;
    this.lastPoints = 0;
    this.lastGeometries = 0;
    this.lastTextures = 0;

    // Benchmark state
    this.isBenchmarking = false;
    this.lastBenchmarkText = '';

    if (this.enabled) {
      this._startIndependentRafCounter();
      this._initDOM();
    }
  }

  _startIndependentRafCounter() {
    let last = performance.now();
    let count = 0;
    const loop = (now) => {
      count++;
      if (now >= last + 1000) {
        this.rAfFps = Math.round((count * 1000) / (now - last));
        count = 0;
        last = now;
        this._updateHUD();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  recordLogicTime(ms) {
    this.logicTime = ms;
    this.avgLogicTime = this.avgLogicTime * 0.9 + ms * 0.1;
  }

  recordRenderTime(ms) {
    this.renderTime = ms;
    this.avgRenderTime = this.avgRenderTime * 0.9 + ms * 0.1;
  }

  beginFrame() {
    // Reset info at frame start so shadow passes, bloom passes, and main passes accumulate
    if (this.ctx.renderer) {
      this.ctx.renderer.info.reset();
    }
    this.frameStartTime = performance.now();
  }

  endFrame() {
    const now = performance.now();
    const dt = now - (this.frameStartTime || now);
    this.frameTime = dt;
    this.avgFrameTime = this.avgFrameTime * 0.9 + dt * 0.1;

    // Snapshot full frame metrics after all render and post-processing passes finished
    if (this.ctx.renderer) {
      const info = this.ctx.renderer.info;
      this.lastCalls = info.render.calls;
      this.lastTriangles = info.render.triangles;
      this.lastPoints = info.render.points;
      this.lastGeometries = info.memory.geometries;
      this.lastTextures = info.memory.textures;
    }
  }

  getDeviceInfo() {
    let unmaskedVendor = 'Unknown';
    let unmaskedRenderer = 'Unknown';

    try {
      const gl = this.ctx.renderer.getContext();
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        unmaskedVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'Unknown';
        unmaskedRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Unknown';
      }
    } catch (e) {
      console.warn('Unable to get WEBGL_debug_renderer_info:', e);
    }

    return {
      userAgent: navigator.userAgent,
      screenWidth: window.screen?.width || window.innerWidth,
      screenHeight: window.screen?.height || window.innerHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      unmaskedVendor,
      unmaskedRenderer
    };
  }

  // --- SCENE AUDIT & GPU MEMORY REPORT GENERATOR ---
  generateSceneReport() {
    const scene = this.ctx.scene;
    const allMeshes = [];
    const skinnedMeshes = [];
    let totalBones = 0;

    const materialCounts = {
      MeshStandardMaterial: 0,
      MeshPhysicalMaterial: 0,
      MeshLambertMaterial: 0,
      MeshBasicMaterial: 0,
      ShaderMaterial: 0,
      Other: 0
    };

    const expensiveMaterials = [];
    const texturesMap = new Map();
    let totalTextureBytes = 0;

    const seenMaterials = new Set();

    scene.traverse(obj => {
      // SkinnedMesh & Bones
      if (obj.isSkinnedMesh) {
        skinnedMeshes.push(obj);
        if (obj.skeleton && obj.skeleton.bones) {
          totalBones += obj.skeleton.bones.length;
        }
      }

      // Mesh triangle analysis
      if (obj.isMesh && obj.geometry) {
        const geo = obj.geometry;
        const triCount = geo.index ? (geo.index.count / 3) : (geo.attributes?.position?.count / 3 || 0);
        const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        const matType = mat ? mat.type : 'None';
        const instanceCount = obj.isInstancedMesh ? obj.count : 1;
        const effectiveTriangles = Math.round(triCount * instanceCount);

        allMeshes.push({
          name: obj.name || (obj.parent ? obj.parent.name : 'Unnamed'),
          trianglesPerInstance: Math.round(triCount),
          instances: instanceCount,
          totalTriangles: effectiveTriangles,
          materialType: matType,
          isInstanced: !!obj.isInstancedMesh
        });
      }

      // Material & Texture inspection
      const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      mats.forEach(mat => {
        if (!mat || seenMaterials.has(mat.id)) return;
        seenMaterials.add(mat.id);

        if (materialCounts[mat.type] !== undefined) {
          materialCounts[mat.type]++;
        } else {
          materialCounts.Other++;
        }

        // Check expensive features
        const hasTransmission = mat.transmission && mat.transmission > 0;
        const hasClearcoat = mat.clearcoat && mat.clearcoat > 0;
        const hasEnvMap = !!mat.envMap;
        const hasNormal = !!mat.normalMap;
        const hasRoughness = !!mat.roughnessMap;

        if (hasTransmission || hasClearcoat || hasEnvMap || hasNormal || hasRoughness) {
          expensiveMaterials.push({
            name: mat.name || `Mat_${mat.id}`,
            type: mat.type,
            features: [
              hasTransmission ? 'transmission' : null,
              hasClearcoat ? 'clearcoat' : null,
              hasEnvMap ? 'envMap' : null,
              hasNormal ? 'normalMap' : null,
              hasRoughness ? 'roughnessMap' : null,
            ].filter(Boolean).join(', ')
          });
        }

        // Check maps
        const mapKeys = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'envMap', 'lightMap'];
        mapKeys.forEach(k => {
          const tex = mat[k];
          if (tex && tex.isTexture && !texturesMap.has(tex.id)) {
            const img = tex.image;
            const w = img?.videoWidth || img?.naturalWidth || img?.width || 0;
            const h = img?.videoHeight || img?.naturalHeight || img?.height || 0;
            // Estimated uncompressed RGBA8 GPU footprint with mipmaps: w * h * 4 * 1.33
            const bytes = Math.round(w * h * 4 * 1.333);
            totalTextureBytes += bytes;
            texturesMap.set(tex.id, {
              name: tex.name || k,
              width: w,
              height: h,
              bytes
            });
          }
        });
      });
    });

    // Sort meshes by total polygon count descending
    allMeshes.sort((a, b) => b.totalTriangles - a.totalTriangles);
    const top15Meshes = allMeshes.slice(0, 15);

    // Lights count & shadows
    let totalLights = 0;
    let shadowLights = 0;
    const shadowLightNames = [];
    scene.traverse(o => {
      if (o.isLight) {
        totalLights++;
        if (o.castShadow) {
          shadowLights++;
          shadowLightNames.push(o.name || o.type);
        }
      }
    });

    return {
      top15Meshes,
      skinnedCount: skinnedMeshes.length,
      totalBones,
      materialCounts,
      expensiveMaterials,
      textures: Array.from(texturesMap.values()),
      totalTextureMB: (totalTextureBytes / (1024 * 1024)).toFixed(2),
      totalLights,
      shadowLights,
      shadowLightNames,
      avgLogicTime: this.avgLogicTime,
      avgRenderTime: this.avgRenderTime,
      avgFrameTime: this.avgFrameTime
    };
  }

  // --- OBJECT BISECT SYSTEM ---
  // Groups scene objects so we can isolate the exact bottleneck
  getObjectGroups() {
    const groups = {
      'Houses & Buildings': [],
      'Trees & Foliage': [],
      'Cliffs & Rocks': [],
      'Terrain / Ground': [],
      'Santa & Sleigh & Reindeer': [],
      'Gift Delivery & Markers & Stars': [],
      'Snow & Weather Particles': [],
      'Procedural Sky & Aurora Dome': []
    };

    // 1. Chunk System instanced meshes
    if (this.ctx.chunkSystem?.meshDefinitions) {
      this.ctx.chunkSystem.meshDefinitions.forEach(def => {
        if (!def.instMesh) return;
        const name = (def.name || '').toLowerCase();
        const cat = def.category;
        if (cat === 'house' || def.isHouse) {
          groups['Houses & Buildings'].push(def.instMesh);
        } else if (cat === 'foliage' || name.includes('tree') || name.includes('shrub')) {
          groups['Trees & Foliage'].push(def.instMesh);
        } else if (cat === 'cliff' || name.includes('cliff') || name.includes('plateau')) {
          groups['Cliffs & Rocks'].push(def.instMesh);
        } else if (cat === 'ground' || name.includes('plane') || name.includes('terrain')) {
          groups['Terrain / Ground'].push(def.instMesh);
        } else {
          groups['Houses & Buildings'].push(def.instMesh);
        }
      });
    }

    // 2. Sleigh Controller & Reindeer Team
    if (this.ctx.sleighController?.group) {
      groups['Santa & Sleigh & Reindeer'].push(this.ctx.sleighController.group);
    }

    // 3. Delivery System (Markers, Stars, Guidance Ribbon)
    if (this.ctx.deliverySystem) {
      if (this.ctx.deliverySystem.markersGroup) groups['Gift Delivery & Markers & Stars'].push(this.ctx.deliverySystem.markersGroup);
      if (this.ctx.deliverySystem.starsGroup) groups['Gift Delivery & Markers & Stars'].push(this.ctx.deliverySystem.starsGroup);
      if (this.ctx.deliverySystem.guidanceFlow?.particleMesh) groups['Gift Delivery & Markers & Stars'].push(this.ctx.deliverySystem.guidanceFlow.particleMesh);
    }

    // 4. Snow Particles
    if (this.ctx.snowParticles) groups['Snow & Weather Particles'].push(this.ctx.snowParticles);
    if (this.ctx.largeSnowParticles) groups['Snow & Weather Particles'].push(this.ctx.largeSnowParticles);

    // 5. Sky Group
    if (this.ctx.skyGroup) {
      groups['Procedural Sky & Aurora Dome'].push(this.ctx.skyGroup);
    }

    return groups;
  }

  _hideObjectGroup(groupName, hide) {
    const groups = this.getObjectGroups();
    const objs = groups[groupName] || [];
    objs.forEach(o => {
      o.visible = !hide;
    });
  }

  _initDOM() {
    // 1. Floating Pill Button (Touch-friendly 44px)
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'perf-debug-toggle-btn';
    this.toggleBtn.textContent = '⚙️ Debug';
    this.toggleBtn.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 100000;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(255, 215, 0, 0.85);
      color: #ffd700;
      font-weight: bold;
      font-size: 13px;
      padding: 9px 16px;
      min-height: 44px;
      border-radius: 22px;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(0,0,0,0.6);
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    `;
    document.body.appendChild(this.toggleBtn);

    // 2. Compact Telemetry HUD Overlay (Top-Left)
    this.hud = document.createElement('div');
    this.hud.id = 'perf-debug-hud';
    this.hud.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      z-index: 99998;
      background: rgba(10, 15, 25, 0.90);
      border: 1px solid rgba(255, 215, 0, 0.5);
      border-radius: 8px;
      padding: 8px 12px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.4;
      color: #e0e6ed;
      pointer-events: none;
      backdrop-filter: blur(6px);
      box-shadow: 0 4px 15px rgba(0,0,0,0.6);
      max-width: 280px;
    `;
    document.body.appendChild(this.hud);

    // 3. Touch-Friendly Interactive Control Panel (Collapsible)
    this.panel = document.createElement('div');
    this.panel.id = 'perf-debug-panel';
    this.panel.style.cssText = `
      position: fixed;
      top: 56px;
      right: 10px;
      left: 10px;
      max-width: 420px;
      margin-left: auto;
      z-index: 99999;
      background: rgba(13, 20, 36, 0.97);
      border: 1px solid rgba(100, 180, 255, 0.5);
      border-radius: 12px;
      padding: 14px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: #ffffff;
      max-height: 84vh;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.85);
      backdrop-filter: blur(12px);
      display: none;
      touch-action: pan-y;
      -webkit-overflow-scrolling: touch;
    `;

    const dprVal = (window.devicePixelRatio || 1).toFixed(1);

    this.panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334; padding-bottom:8px; margin-bottom:12px;">
        <strong style="color:#ffd700; font-size:14px;">⚙️ Phone Diagnostic & Bisect Suite</strong>
        <button id="btn-close-panel" style="background:#334155; border:none; color:#fff; padding:6px 12px; border-radius:6px; font-size:12px; cursor:pointer; min-height:36px;">✕ Close</button>
      </div>

      <!-- Live Timing Split Widget -->
      <div id="timing-split-box" style="background:#0f172a; padding:8px 10px; border-radius:6px; margin-bottom:12px; border:1px solid #334155; font-size:11px;">
        <div style="color:#38bdf8; font-weight:bold; margin-bottom:4px;">⏱️ Frame Timing Split (CPU vs GPU):</div>
        <div>JS Update Logic: <span id="time-logic" style="color:#ffd700; font-weight:bold;">0.0 ms</span></div>
        <div>renderer.render() CPU: <span id="time-render" style="color:#f472b6; font-weight:bold;">0.0 ms</span></div>
        <div>Total Frame Time: <span id="time-total" style="color:#4ade80; font-weight:bold;">0.0 ms</span></div>
        <div id="timing-verdict" style="margin-top:4px; font-weight:600; color:#cbd5e1; font-size:10px;"></div>
      </div>

      <!-- Active Quality Settings & Diagnostic Tools -->
      <div id="quality-settings-card" style="background:#0f172a; padding:8px 10px; border-radius:6px; margin-bottom:12px; border:1px solid #38bdf8; font-size:11px;">
        <div style="color:#38bdf8; font-weight:bold; margin-bottom:4px;">✨ Active Quality Telemetry:</div>
        <div id="active-quality-summary" style="line-height:1.45; color:#cbd5e1;">Loading quality telemetry...</div>
        <div style="display:flex; gap:6px; margin-top:8px;">
          <button id="btn-match-desktop" style="flex:1; background:#10b981; border:none; color:#fff; font-weight:bold; padding:6px 4px; border-radius:4px; font-size:11px; cursor:pointer;">✨ Match Desktop</button>
          <button id="btn-fps-cap" style="flex:1; background:#6366f1; border:none; color:#fff; font-weight:bold; padding:6px 4px; border-radius:4px; font-size:11px; cursor:pointer;">⚡ Cap: 30 FPS</button>
        </div>

        <!-- Single Feature Toggles (Default OFF) -->
        <div style="margin-top:10px; padding-top:8px; border-top:1px dashed #334155;">
          <div style="font-weight:bold; color:#facc15; margin-bottom:6px;">🛠️ Optimizations (Mobile Only):</div>
          <label class="dbg-touch-label"><input type="checkbox" id="chk-house-opaque" checked> <span>⚡ House Opaque (No alpha blend, depthWrite)</span></label>
          <label class="dbg-touch-label" style="margin-top:4px;"><input type="checkbox" id="chk-front-side" checked> <span>⚡ FrontSide Materials (Houses, cliffs, ground)</span></label>
          <div style="display:flex; gap:6px; margin-top:6px; margin-bottom:6px;">
            <button id="btn-compare-materials" style="flex:1; background:#0ea5e9; border:none; color:#fff; font-weight:bold; padding:6px 4px; border-radius:4px; font-size:11px; cursor:pointer;">🔄 Compare (Flip Both [C])</button>
          </div>
          <label class="dbg-touch-label" style="margin-top:4px;"><input type="checkbox" id="chk-chunk-culling"> <span>3. Chunk Frustum Culling (15% margin)</span></label>
          <label class="dbg-touch-label" style="margin-top:4px;"><input type="checkbox" id="chk-shadow-cadence"> <span>4. Shadow Update Every 2nd Frame</span></label>
          <label class="dbg-touch-label" style="margin-top:4px;"><input type="checkbox" id="chk-debug-wireframes"> <span>Show Chunk Bounding Wireframes</span></label>
        </div>

        <!-- 7 Individual Light Toggles (Default ON) -->
        <div style="margin-top:10px; padding-top:8px; border-top:1px dashed #334155;">
          <div style="font-weight:bold; color:#facc15; margin-bottom:6px;">💡 7-Light Audit Toggles:</div>
          <div style="display:grid; grid-template-columns: 1fr; gap:4px; font-size:11px;">
            <label><input type="checkbox" id="chk-lt-hemi" checked> 1. Starlight Hemisphere (0.46)</label>
            <label><input type="checkbox" id="chk-lt-moon" checked> 2. Moon Directional Key (0.95, Shadows)</label>
            <label><input type="checkbox" id="chk-lt-facade" checked> 3. Village Facade Light (0.35)</label>
            <label><input type="checkbox" id="chk-lt-ambient" checked> 4. Ambient Warm Crevice (0.14)</label>
            <label><input type="checkbox" id="chk-lt-aurora" checked> 5. Aurora Sky-to-Ground (0.16)</label>
            <label><input type="checkbox" id="chk-lt-lantern-l" checked> 6. Sleigh Lantern Left Point Light</label>
            <label><input type="checkbox" id="chk-lt-lantern-r" checked> 7. Sleigh Lantern Right Point Light</label>
          </div>
        </div>
      </div>

      <!-- Pixel Ratio Buttons -->
      <div style="margin-bottom:14px;">
        <div style="font-size:12px; color:#94a3b8; margin-bottom:6px; font-weight:600;">Pixel Ratio (DPR):</div>
        <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:6px;">
          <button class="dbg-btn" data-dpr="0.5">0.5x</button>
          <button class="dbg-btn" data-dpr="0.75">0.75x</button>
          <button class="dbg-btn" data-dpr="1.0">1.0x</button>
          <button class="dbg-btn" data-dpr="1.5">1.5x</button>
          <button class="dbg-btn" data-dpr="native">Nat(${dprVal}x)</button>
        </div>
      </div>

      <!-- Live Toggle Checkboxes -->
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:14px;">
        <label class="dbg-touch-label"><input type="checkbox" id="chk-shadows" checked> <span>Shadows</span></label>
        <label class="dbg-touch-label"><input type="checkbox" id="chk-postproc" checked> <span>Post-Processing (Bloom)</span></label>
        <label class="dbg-touch-label"><input type="checkbox" id="chk-particles" checked> <span>Particles & Transparent VFX</span></label>
        <label class="dbg-touch-label"><input type="checkbox" id="chk-groundonly"> <span>Hide All Except Ground</span></label>
        <label class="dbg-touch-label"><input type="checkbox" id="chk-pauselogic"> <span>Pause Game Logic (Render only)</span></label>
        <label class="dbg-touch-label"><input type="checkbox" id="chk-skiprender"> <span>Skip renderer.render() (Logic only)</span></label>
        <label class="dbg-touch-label"><input type="checkbox" id="chk-lights" checked> <span>Dynamic Lights</span></label>
      </div>

      <!-- Benchmark Actions -->
      <div style="border-top:1px solid #334; padding-top:12px; display:flex; flex-direction:column; gap:8px;">
        <button id="btn-quick-culling" style="
          width: 100%;
          min-height: 44px;
          background: linear-gradient(135deg, #10b981, #059669);
          border: none;
          color: white;
          font-weight: bold;
          padding: 8px 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          margin-bottom: 6px;
          touch-action: manipulation;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
        ">⚡ Quick Culling Test (6s)</button>
        <button id="btn-run-full-benchmark" style="
          width: 100%;
          min-height: 48px;
          background: linear-gradient(135deg, #e67e22, #f39c12);
          border: none;
          color: white;
          font-weight: bold;
          padding: 10px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          touch-action: manipulation;
          box-shadow: 0 4px 12px rgba(230, 126, 34, 0.4);
        ">🚀 Run Phone Benchmark + Bisect (~90s)</button>

        <div id="benchmark-status" style="font-size:12px; color:#f1c40f; min-height:20px; text-align:center; font-weight:600;"></div>
      </div>

      <!-- Results Container -->
      <div id="benchmark-results-container" style="margin-top:12px; display:none;">
        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <button id="btn-copy-results" style="
            flex:1;
            min-height: 44px;
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            touch-action: manipulation;
          ">📋 Copy Results</button>
          <button id="btn-dl-results" style="
            flex:1;
            min-height: 44px;
            background: #059669;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            touch-action: manipulation;
          ">💾 Download .txt</button>
        </div>
        <div id="benchmark-results" style="font-size:11px; max-height:300px; overflow-y:auto; -webkit-overflow-scrolling: touch;"></div>
      </div>
    `;

    document.body.appendChild(this.panel);

    // Apply label touch styles
    const labels = this.panel.querySelectorAll('.dbg-touch-label');
    labels.forEach(l => {
      l.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 38px;
        padding: 6px 10px;
        background: #1e293b;
        border-radius: 6px;
        cursor: pointer;
        touch-action: manipulation;
        font-size: 13px;
        user-select: none;
      `;
      const input = l.querySelector('input');
      if (input) {
        input.style.width = '20px';
        input.style.height = '20px';
      }
    });

    this._attachEventListeners();
  }

  _attachEventListeners() {
    this.toggleBtn.onclick = () => {
      const isHidden = this.panel.style.display === 'none';
      this.panel.style.display = isHidden ? 'block' : 'none';
      this.toggleBtn.textContent = isHidden ? '✕ Close' : '⚙️ Debug';
    };

    const closeBtn = this.panel.querySelector('#btn-close-panel');
    if (closeBtn) {
      closeBtn.onclick = () => {
        this.panel.style.display = 'none';
        this.toggleBtn.textContent = '⚙️ Debug';
      };
    }

    const btnStyle = `
      background: #1e293b;
      border: 1px solid #475569;
      color: #cbd5e1;
      padding: 8px 4px;
      min-height: 40px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      touch-action: manipulation;
    `;
    this.panel.querySelectorAll('.dbg-btn').forEach(b => {
      b.style.cssText = btnStyle;
      b.onclick = () => {
        const val = b.dataset.dpr;
        const dpr = val === 'native' ? (window.devicePixelRatio || 1) : parseFloat(val);
        this.setPixelRatio(dpr);
      };
    });

    const bindCheck = (id, key, callback) => {
      const el = this.panel.querySelector(id);
      if (el) {
        el.onchange = (e) => {
          this.state[key] = e.target.checked;
          if (callback) callback(e.target.checked);
        };
      }
    };

    bindCheck('#chk-shadows', 'shadows', (v) => {
      this.ctx.renderer.shadowMap.enabled = v;
      this.ctx.scene.traverse(o => {
        if (o.material) o.material.needsUpdate = true;
      });
    });

    bindCheck('#chk-postproc', 'postProcessing');
    bindCheck('#chk-particles', 'particles', (v) => this._toggleParticles(v));
    bindCheck('#chk-groundonly', 'groundOnly', (v) => this._toggleGroundOnly(v));
    bindCheck('#chk-pauselogic', 'pauseLogic');
    bindCheck('#chk-skiprender', 'skipRender');
    bindCheck('#chk-lights', 'dynamicLights', (v) => this._toggleLights(v));

    // Match Desktop Button
    const matchDeskBtn = this.panel.querySelector('#btn-match-desktop');
    if (matchDeskBtn) {
      matchDeskBtn.onclick = () => {
        if (window.mobileOptimizer) {
          window.mobileOptimizer.syncDesktopQuality();
        }
        this._updateQualityCard();
        alert('Quality resynchronized to full desktop parameters.');
      };
    }

    // 30 / 45 / 60 FPS Cap Cycler
    const fpsCapBtn = this.panel.querySelector('#btn-fps-cap');
    if (fpsCapBtn) {
      const currentCap = window._targetFpsCap || 30;
      fpsCapBtn.textContent = `⚡ Cap: ${currentCap} FPS`;
      fpsCapBtn.onclick = () => {
        let nextCap = 30;
        if (window._targetFpsCap === 30) nextCap = 45;
        else if (window._targetFpsCap === 45) nextCap = 60;
        else nextCap = 30;

        if (window.setFpsCap) window.setFpsCap(nextCap);
        fpsCapBtn.textContent = `⚡ Cap: ${nextCap} FPS`;
      };
    }

    // Material Optimization Toggles Listeners
    const houseOpaqueChk = this.panel.querySelector('#chk-house-opaque');
    if (houseOpaqueChk) {
      houseOpaqueChk.checked = window.mobileOptimizer ? (window.mobileOptimizer.toggles.houseOpaque !== false) : true;
      houseOpaqueChk.onchange = (e) => {
        if (window.mobileOptimizer) window.mobileOptimizer.setHouseOpaque(e.target.checked);
      };
    }

    const frontSideChk = this.panel.querySelector('#chk-front-side');
    if (frontSideChk) {
      frontSideChk.checked = window.mobileOptimizer ? (window.mobileOptimizer.toggles.frontSideMaterials !== false) : true;
      frontSideChk.onchange = (e) => {
        if (window.mobileOptimizer) window.mobileOptimizer.setFrontSideMaterials(e.target.checked);
      };
    }

    const compareBtn = this.panel.querySelector('#btn-compare-materials');
    if (compareBtn) {
      compareBtn.onclick = () => {
        if (window.mobileOptimizer) window.mobileOptimizer.toggleCompare();
      };
    }

    // Optimization Single Toggles Listeners
    const cullingChk = this.panel.querySelector('#chk-chunk-culling');
    if (cullingChk) {
      cullingChk.onchange = (e) => {
        if (window.mobileOptimizer) {
          window.mobileOptimizer.toggles.chunkFrustumCulling = e.target.checked;
          window.mobileOptimizer._updateChunkCullingFlags();
        }
      };
    }

    const shadowCadenceChk = this.panel.querySelector('#chk-shadow-cadence');
    if (shadowCadenceChk) {
      shadowCadenceChk.onchange = (e) => {
        if (window.mobileOptimizer) window.mobileOptimizer.toggles.shadowEvery2ndFrame = e.target.checked;
      };
    }

    // 7 Individual Light Toggle Listeners
    const bindLightToggle = (id, lightKey) => {
      const el = this.panel.querySelector(id);
      if (el) {
        el.onchange = (e) => {
          if (window.mobileOptimizer) window.mobileOptimizer.setLight(lightKey, e.target.checked);
        };
      }
    };
    bindLightToggle('#chk-lt-hemi', 'light_starlightHemi');
    bindLightToggle('#chk-lt-moon', 'light_moonLight');
    bindLightToggle('#chk-lt-facade', 'light_villageFacade');
    bindLightToggle('#chk-lt-ambient', 'light_ambientWarm');
    bindLightToggle('#chk-lt-aurora', 'light_auroraGround');
    bindLightToggle('#chk-lt-lantern-l', 'light_lanternLeft');
    bindLightToggle('#chk-lt-lantern-r', 'light_lanternRight');

    // Bounding Wireframes Checkbox
    const wireframeChk = this.panel.querySelector('#chk-debug-wireframes');
    if (wireframeChk) {
      wireframeChk.onchange = (e) => {
        if (window.mobileOptimizer) {
          window.mobileOptimizer.setDebugWireframes(e.target.checked);
        }
      };
    }

    const quickBtn = this.panel.querySelector('#btn-quick-culling');
    if (quickBtn) {
      quickBtn.onclick = () => this.runQuickCullingTest();
    }

    const benchBtn = this.panel.querySelector('#btn-run-full-benchmark');
    if (benchBtn) {
      benchBtn.onclick = () => this.runComprehensiveBenchmark();
    }

    const copyBtn = this.panel.querySelector('#btn-copy-results');
    if (copyBtn) {
      copyBtn.onclick = () => this._copyResultsToClipboard(copyBtn);
    }

    const dlBtn = this.panel.querySelector('#btn-dl-results');
    if (dlBtn) {
      dlBtn.onclick = () => this._downloadResultsFile();
    }
  }

  setPixelRatio(dpr) {
    this.state.pixelRatio = dpr;
    this.ctx.renderer.setPixelRatio(dpr);
    if (this.ctx.composer) {
      this.ctx.composer.setPixelRatio(dpr);
    }
  }

  _toggleParticles(visible) {
    if (this.ctx.snowParticles) this.ctx.snowParticles.visible = visible;
    if (this.ctx.largeSnowParticles) this.ctx.largeSnowParticles.visible = visible;
    if (this.ctx.sleighController?.flightTrail?.mesh) {
      this.ctx.sleighController.flightTrail.mesh.visible = visible;
    }
    if (this.ctx.sleighController?.magicTrail?.mesh) {
      this.ctx.sleighController.magicTrail.mesh.visible = visible;
    }
    if (this.ctx.deliverySystem?.guidanceFlow?.particleMesh) {
      this.ctx.deliverySystem.guidanceFlow.particleMesh.visible = visible;
    }
  }

  _toggleGroundOnly(groundOnly) {
    if (this.ctx.chunkSystem?.meshDefinitions) {
      this.ctx.chunkSystem.meshDefinitions.forEach(def => {
        if (def.instMesh) {
          def.instMesh.visible = groundOnly ? (def.category === 'ground') : true;
        }
      });
    }
    if (this.ctx.sleighController?.group) {
      this.ctx.sleighController.group.visible = !groundOnly;
    }
    if (this.ctx.deliverySystem?.markersGroup) {
      this.ctx.deliverySystem.markersGroup.visible = !groundOnly;
    }
    if (this.ctx.deliverySystem?.starsGroup) {
      this.ctx.deliverySystem.starsGroup.visible = !groundOnly;
    }
  }

  _toggleLights(enabled) {
    if (this.ctx.moonLight) this.ctx.moonLight.visible = enabled;
    if (this.ctx.auroraGroundLight) this.ctx.auroraGroundLight.visible = enabled;
    if (this.ctx.villageFacadeLight) this.ctx.villageFacadeLight.visible = enabled;
    if (this.ctx.starlightHemiLight) this.ctx.starlightHemiLight.visible = enabled;
    if (this.ctx.ambientWarm) this.ctx.ambientWarm.visible = enabled;
  }

  _countLights() {
    let totalLights = 0;
    let shadowLights = 0;
    this.ctx.scene.traverse(o => {
      if (o.isLight) {
        totalLights++;
        if (o.castShadow) shadowLights++;
      }
    });
    return { totalLights, shadowLights };
  }

  _updateQualityCard() {
    const cardEl = document.getElementById('active-quality-summary');
    if (!cardEl) return;
    const dpr = this.ctx.renderer.getPixelRatio().toFixed(2);
    const smSize = this.ctx.renderer.shadowMap.enabled ? (this.ctx.moonLight?.shadow?.mapSize?.width || 2048) : 0;
    const smType = this.ctx.renderer.shadowMap.type === THREE.PCFSoftShadowMap ? 'PCFSoft' : 'Basic';
    const lights = this._countLights();
    const stats = window.mobileOptimizer ? window.mobileOptimizer.stats : null;

    cardEl.innerHTML = `
      • <strong>Pixel Ratio:</strong> ${dpr}x (Max 2.5)<br/>
      • <strong>Shadow Map:</strong> ${smSize}x${smSize} (${smType})<br/>
      • <strong>Active Lights:</strong> ${lights.totalLights} (Shadow casters: ${lights.shadowLights})<br/>
      • <strong>Post-Processing:</strong> ${this.state.postProcessing ? 'Bloom ON (Full Res)' : 'Direct ON'}<br/>
      ${stats ? `
        • <strong>Main Pass Chunks:</strong> ${stats.main.chunksDrawn}/${stats.main.chunksTotal} (Houses: ${stats.main.houses.drawn}/${stats.main.houses.total}, Trees: ${stats.main.trees.drawn}/${stats.main.trees.total})<br/>
        • <strong>Shadow Pass Chunks:</strong> ${stats.shadow.chunksDrawn}/${stats.shadow.chunksTotal} (Houses: ${stats.shadow.houses.drawn}/${stats.shadow.houses.total})<br/>
      ` : ''}
      • <strong>Target Cap:</strong> ${window._targetFpsCap || 30} FPS
    `;
  }

  _updateHUD() {
    this._updateQualityCard();
    if (!this.hud) return;
    const lights = this._countLights();
    const dpr = this.ctx.renderer.getPixelRatio().toFixed(2);
    const passes = this.state.postProcessing ? (this.ctx.composer?.passes?.length || 0) : 0;

    const fps = this.rAfFps;
    const fpsColor = fps < 25 ? '#ff4d4f' : (fps < 50 ? '#faad14' : '#52c41a');

    this.hud.innerHTML = `
      <div style="font-weight:bold; color:#ffd700; margin-bottom:2px;">🎮 TELEMETRY (FULL FRAME)</div>
      <div><strong>FPS:</strong> <span style="font-size:13px; font-weight:bold; color:${fpsColor}">${fps}</span> (${this.avgFrameTime.toFixed(1)} ms)</div>
      <div><strong>Draw Calls:</strong> ${this.lastCalls}</div>
      <div><strong>Triangles:</strong> ${(this.lastTriangles || 0).toLocaleString()}</div>
      <div><strong>Geometries:</strong> ${this.lastGeometries} | <strong>Textures:</strong> ${this.lastTextures}</div>
      <div style="color:#a5f3fc; font-size:10px;">• <strong>santa aseet:</strong> ${this._getSantaAseetInfo()}</div>
      <div><strong>DPR:</strong> ${dpr}x | <strong>ShadowMap:</strong> ${this.ctx.renderer.shadowMap.enabled ? (this.ctx.moonLight?.shadow?.mapSize?.width || 2048) + 'px' : 'OFF'}</div>
      <div><strong>Lights:</strong> ${lights.totalLights} (Shadows: ${lights.shadowLights}) | <strong>Bloom:</strong> ${this.state.postProcessing ? 'ON' : 'OFF'}</div>
      ${window.mobileOptimizer ? `
        <div style="margin-top:2px; font-size:10px; border-top:1px dashed #475569; padding-top:2px;">
          <div style="color:#38bdf8; font-weight:600;">HouseOpaque: ${window.mobileOptimizer.toggles.houseOpaque ? 'ON' : 'OFF'} | FrontSide: ${window.mobileOptimizer.toggles.frontSideMaterials ? 'ON' : 'OFF'} [C]</div>
          <div style="color:#4ade80;"><strong>Main Pass (Chunks: ${window.mobileOptimizer.stats.main.chunksDrawn}/${window.mobileOptimizer.stats.main.chunksTotal}):</strong></div>
          <div>H: ${window.mobileOptimizer.stats.main.houses.drawn}/${window.mobileOptimizer.stats.main.houses.total} | T: ${window.mobileOptimizer.stats.main.trees.drawn}/${window.mobileOptimizer.stats.main.trees.total} | C: ${window.mobileOptimizer.stats.main.cliffs.drawn}/${window.mobileOptimizer.stats.main.cliffs.total}</div>
          <div style="color:#facc15; margin-top:1px;"><strong>Shadow Pass (Chunks: ${window.mobileOptimizer.stats.shadow.chunksDrawn}/${window.mobileOptimizer.stats.shadow.chunksTotal}):</strong></div>
          <div>H: ${window.mobileOptimizer.stats.shadow.houses.drawn}/${window.mobileOptimizer.stats.shadow.houses.total} | T: ${window.mobileOptimizer.stats.shadow.trees.drawn}/${window.mobileOptimizer.stats.shadow.trees.total}</div>
        </div>
      ` : ''}
    `;

    // Also update timing split box in panel if open
    const timeLogicEl = document.getElementById('time-logic');
    const timeRenderEl = document.getElementById('time-render');
    const timeTotalEl = document.getElementById('time-total');
    const verdictEl = document.getElementById('timing-verdict');

    if (timeLogicEl) timeLogicEl.textContent = `${this.avgLogicTime.toFixed(2)} ms`;
    if (timeRenderEl) timeRenderEl.textContent = `${this.avgRenderTime.toFixed(2)} ms`;
    if (timeTotalEl) timeTotalEl.textContent = `${this.avgFrameTime.toFixed(2)} ms`;
    if (verdictEl) {
      const cpuTime = this.avgLogicTime + this.avgRenderTime;
      const gpuTimeEst = Math.max(0, this.avgFrameTime - cpuTime);
      verdictEl.textContent = `CPU Total: ${cpuTime.toFixed(1)} ms | GPU Wait/Draw: ${gpuTimeEst.toFixed(1)} ms`;
    }
  }

  /**
   * Helper: accurately measures average FPS over sampleDurationMs using independent rAF counter
   */
  async _measureFps(sampleDurationMs = 3000) {
    let frameCount = 0;
    let isMeasuring = true;

    const onFrame = () => {
      if (!isMeasuring) return;
      frameCount++;
      requestAnimationFrame(onFrame);
    };

    const startTime = performance.now();
    requestAnimationFrame(onFrame);

    await new Promise(resolve => setTimeout(resolve, sampleDurationMs));
    isMeasuring = false;
    const elapsedSec = (performance.now() - startTime) / 1000;
    return Math.round(frameCount / elapsedSec);
  }

  // --- AUTOMATED BENCHMARK + OBJECT BISECT ---
    _saveFullState() {
    const s = {
      dpr: this.ctx.renderer.getPixelRatio(),
      shadows: this.ctx.renderer.shadowMap.enabled,
      shadowType: this.ctx.renderer.shadowMap.type,
      postProcessing: this.state.postProcessing,
      particles: this.state.particles,
      groundOnly: this.state.groundOnly,
      pauseLogic: this.state.pauseLogic,
      skipRender: this.state.skipRender,
      dynamicLights: this.state.dynamicLights,
      lights: []
    };
    this.ctx.scene.traverse(o => {
      if (o.isLight) {
        s.lights.push({ light: o, visible: o.visible, intensity: o.intensity });
      }
    });
    return s;
  }

  _restoreFullState(s) {
    if (!s) return;
    this.setPixelRatio(s.dpr);
    this.ctx.renderer.shadowMap.enabled = s.shadows;
    this.ctx.renderer.shadowMap.type = s.shadowType;
    this.state.postProcessing = s.postProcessing;
    this.state.particles = s.particles;
    this._toggleParticles(s.particles);
    this.state.groundOnly = s.groundOnly;
    this._toggleGroundOnly(s.groundOnly);
    this.state.pauseLogic = s.pauseLogic;
    this.state.skipRender = s.skipRender;
    this.state.dynamicLights = s.dynamicLights;
    this._toggleLights(s.dynamicLights);
    if (s.lights) {
      s.lights.forEach(l => {
        l.light.visible = l.visible;
        l.light.intensity = l.intensity;
      });
    }
    if (window.mobileOptimizer && window.mobileOptimizer.enabled) {
      window.mobileOptimizer.syncDesktopQuality();
    }
  }

  

  _getSantaAseetInfo() {
    let info = 'Loading...';
    this.ctx.scene.traverse(o => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          if (m.name === 'santa aseet' || (m.name || '').includes('santa')) {
            const tex = m.map || m.emissiveMap;
            if (tex && tex.image) {
              const w = tex.image.videoWidth || tex.image.naturalWidth || tex.image.width || 0;
              const h = tex.image.videoHeight || tex.image.naturalHeight || tex.image.height || 0;
              const mb = (w * h * 4 * 1.333 / (1024 * 1024)).toFixed(2);
              info = `${w}x${h} (~${mb} MB VRAM)`;
            }
          }
        });
      }
    });
    return info;
  }

  _getActiveSettingsHeader() {
    const dpr = this.ctx.renderer.getPixelRatio().toFixed(2);
    const smEnabled = this.ctx.renderer.shadowMap.enabled;
    const smSize = smEnabled ? (this.ctx.moonLight?.shadow?.mapSize?.width || 2048) : 0;
    const smType = this.ctx.renderer.shadowMap.type === THREE.PCFSoftShadowMap ? 'PCFSoft' : 'Basic';
    const cullingOn = window.mobileOptimizer ? (window.mobileOptimizer.toggles.chunkFrustumCulling === true) : false;
    const shadow2ndOn = window.mobileOptimizer ? (window.mobileOptimizer.toggles.shadowEvery2ndFrame === true) : false;
    const fpsCap = window._targetFpsCap || 30;
    const lights = this._countLights();

    const activeLightNames = [];
    if (this.ctx.starlightHemiLight?.visible) activeLightNames.push('1. Starlight Hemi');
    if (this.ctx.moonLight?.visible) activeLightNames.push('2. Moon Key (Shadows)');
    if (this.ctx.villageFacadeLight?.visible) activeLightNames.push('3. Village Facade');
    if (this.ctx.ambientWarm?.visible) activeLightNames.push('4. Ambient Warm');
    if (this.ctx.auroraGroundLight?.visible) activeLightNames.push('5. Aurora Ground');
    if (this.ctx.sleighController?.sleighLanterns?.[0]?.light?.visible) activeLightNames.push('6. Sleigh Lantern Left');
    if (this.ctx.sleighController?.sleighLanterns?.[1]?.light?.visible) activeLightNames.push('7. Sleigh Lantern Right');

    const stats = window.mobileOptimizer?.stats;
    const chunkStatsText = stats ? [
      `  - Main Pass Chunks:   ${stats.main.chunksDrawn}/${stats.main.chunksTotal} (Houses: ${stats.main.houses.drawn}/${stats.main.houses.total}, Trees: ${stats.main.trees.drawn}/${stats.main.trees.total}, Cliffs: ${stats.main.cliffs.drawn}/${stats.main.cliffs.total}, Ground: ${stats.main.ground.drawn}/${stats.main.ground.total})`,
      `  - Shadow Pass Chunks: ${stats.shadow.chunksDrawn}/${stats.shadow.chunksTotal} (Houses: ${stats.shadow.houses.drawn}/${stats.shadow.houses.total}, Trees: ${stats.shadow.trees.drawn}/${stats.shadow.trees.total}, Cliffs: ${stats.shadow.cliffs.drawn}/${stats.shadow.cliffs.total}, Ground: ${stats.shadow.ground.drawn}/${stats.shadow.ground.total})`
    ].join('\n') : '  (Chunk stats not available)';

    const meshAudit = this._auditChunkMeshes();

    return `BUILD / VERSION: ${BUILD_VERSION}
TIMESTAMP: ${new Date().toISOString()}

ACTIVE QUALITY SETTINGS AT RUN TIME:
- House Material Opaque (alphaMode OPAQUE, depthWrite=true): ${window.mobileOptimizer?.toggles.houseOpaque ? 'ON' : 'OFF'}
- FrontSide Materials (Houses, cliffs, ground, rocks): ${window.mobileOptimizer?.toggles.frontSideMaterials ? 'ON' : 'OFF'}
- Chunk Frustum Culling (15% margin): ${cullingOn ? 'ON' : 'OFF'}
- Shadow Map Update Cadence:          ${shadow2ndOn ? 'Every 2nd Frame' : 'Every Frame'}
- Active Lights (${lights.totalLights} total, ${lights.shadowLights} shadow casters):
  ${activeLightNames.join(', ')}
- Target FPS Cap:                     ${fpsCap} FPS
- Pixel Ratio (DPR):                  ${dpr}x
- Shadow Map:                         ${smEnabled ? `${smSize}x${smSize} (${smType})` : 'OFF'}
- Post-Processing (Bloom):            ${this.state.postProcessing ? 'ON (Full Resolution)' : 'OFF'}

PASS-SEPARATED CHUNK VISIBILITY:
${chunkStatsText}

CHUNK MESH AUDIT:
- Total Chunk Meshes by Category:
  * Houses:   ${meshAudit.categories.house || 0} meshes (${meshAudit.categoryInstances.house || 0} instances)
  * Foliage:  ${meshAudit.categories.foliage || 0} meshes (${meshAudit.categoryInstances.foliage || 0} instances)
  * Cliffs:   ${meshAudit.categories.cliff || 0} meshes (${meshAudit.categoryInstances.cliff || 0} instances)
  * Ground:   ${meshAudit.categories.ground || 0} meshes (${meshAudit.categoryInstances.ground || 0} instances)
  * Total:    ${meshAudit.totalMeshes} chunk InstancedMeshes across ${meshAudit.totalChunks} active chunks
- frustumCulled flag on chunk meshes: ${meshAudit.allFrustumCulledMatch ? (cullingOn ? 'All TRUE (Culling Active)' : 'All FALSE (Baseline)') : 'Mixed / Inconsistent'}
- computeBoundingSphere() status:     ${meshAudit.allHaveBoundingSphere ? 'Computed on ALL chunk meshes with +15% safety margin' : 'MISSING on some meshes'}`;
  }

  _auditChunkMeshes() {
    const cs = this.ctx.chunkSystem;
    const res = {
      totalChunks: cs?.chunks?.size || 0,
      totalMeshes: 0,
      categories: { house: 0, foliage: 0, cliff: 0, ground: 0 },
      categoryInstances: { house: 0, foliage: 0, cliff: 0, ground: 0 },
      allFrustumCulledMatch: true,
      allHaveBoundingSphere: true
    };

    if (!cs || !cs.chunks) return res;

    const expectedCulling = (window.mobileOptimizer && window.mobileOptimizer.toggles.chunkFrustumCulling === true);

    cs.chunks.forEach(chunkData => {
      if (chunkData.meshes) {
        chunkData.meshes.forEach(m => {
          res.totalMeshes++;
          const cat = m.userData?.category || 'ground';
          res.categories[cat] = (res.categories[cat] || 0) + 1;
          res.categoryInstances[cat] = (res.categoryInstances[cat] || 0) + (m.count || 0);

          if (m.frustumCulled !== expectedCulling) {
            res.allFrustumCulledMatch = false;
          }
          if (!m.boundingSphere || m.boundingSphere.radius <= 0) {
            res.allHaveBoundingSphere = false;
          }
        });
      }
    });

    return res;
  }

  async runQuickCullingTest() {
    if (this.isBenchmarking) return;
    this.isBenchmarking = true;

    // Clear stale stored benchmark text immediately
    this.lastBenchmarkText = '';

    const statusEl = this.panel.querySelector('#benchmark-status');
    const resultsContainer = this.panel.querySelector('#benchmark-results-container');
    const resultsEl = this.panel.querySelector('#benchmark-results');
    const quickBtn = this.panel.querySelector('#btn-quick-culling');
    const benchBtn = this.panel.querySelector('#btn-run-full-benchmark');
    if (quickBtn) quickBtn.disabled = true;
    if (benchBtn) benchBtn.disabled = true;

    resultsContainer.style.display = 'none';
    resultsEl.innerHTML = '';

    const origCulling = window.mobileOptimizer ? window.mobileOptimizer.toggles.chunkFrustumCulling : false;

    // Step 1: Culling OFF (3 seconds)
    statusEl.textContent = '⚡ [1/2] Measuring CULLING OFF (3s)...';
    if (window.mobileOptimizer) {
      window.mobileOptimizer.toggles.chunkFrustumCulling = false;
      window.mobileOptimizer._updateChunkCullingFlags();
    }
    await new Promise(r => setTimeout(r, 600)); // Short settle
    const offFps = await this._measureFps(3000);
    const offCalls = this.lastCalls;
    const offTris = this.lastTriangles;

    // Step 2: Culling ON (3 seconds)
    statusEl.textContent = '⚡ [2/2] Measuring CULLING ON (15% margin) (3s)...';
    if (window.mobileOptimizer) {
      window.mobileOptimizer.toggles.chunkFrustumCulling = true;
      window.mobileOptimizer._updateChunkCullingFlags();
    }
    await new Promise(r => setTimeout(r, 600)); // Short settle
    const onFps = await this._measureFps(3000);
    const onCalls = this.lastCalls;
    const onTris = this.lastTriangles;

    // Revert to original state
    if (window.mobileOptimizer) {
      window.mobileOptimizer.toggles.chunkFrustumCulling = origCulling;
      window.mobileOptimizer._updateChunkCullingFlags();
      const chk = this.panel.querySelector('#chk-chunk-culling');
      if (chk) chk.checked = origCulling;
    }

    const fpsGain = onFps - offFps;
    const callDelta = onCalls - offCalls;
    const triDelta = onTris - offTris;

    const devInfo = this.getDeviceInfo();
    const settingsHeader = this._getActiveSettingsHeader();

    // Construct plain-text export for Copy & Download
    this.lastBenchmarkText = `=== QUICK CULLING TEST REPORT ===
${settingsHeader}

DEVICE:
GPU: ${devInfo.unmaskedRenderer} (${devInfo.unmaskedVendor})
Screen: ${devInfo.screenWidth}x${devInfo.screenHeight} (DPR: ${devInfo.devicePixelRatio})

TEST RESULTS (3s sampling each):
- Culling OFF: ${offFps} FPS | Draw Calls: ${offCalls} | Triangles: ${offTris.toLocaleString()}
- Culling ON:  ${onFps} FPS | Draw Calls: ${onCalls} | Triangles: ${onTris.toLocaleString()}

DELTAS (Culling ON vs OFF):
- FPS Gain:        ${fpsGain >= 0 ? '+' + fpsGain : fpsGain} FPS
- Draw Call Delta: ${callDelta} calls
- Triangle Delta:  ${triDelta.toLocaleString()} triangles
=================================`;

    const gainColor = fpsGain >= 0 ? '#4ade80' : '#f87171';
    const triColor = triDelta <= 0 ? '#4ade80' : '#f87171';

    resultsEl.innerHTML = `
      <div style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #10b981; font-size:11px; margin-bottom:8px;">
        <div style="color:#10b981; font-weight:bold; font-size:13px; margin-bottom:6px;">⚡ Quick Culling Test Results (6s)</div>
        <div style="color:#94a3b8; font-size:10px; margin-bottom:8px;">Build: ${BUILD_VERSION} | ${new Date().toLocaleTimeString()}</div>
        <table style="width:100%; border-collapse:collapse; margin-bottom:8px;">
          <tr style="border-bottom:1px solid #334; color:#ffd700; text-align:left;">
            <th style="padding:4px 2px;">Mode</th>
            <th style="padding:4px 2px; text-align:right;">FPS</th>
            <th style="padding:4px 2px; text-align:right;">Calls</th>
            <th style="padding:4px 2px; text-align:right;">Triangles</th>
          </tr>
          <tr style="border-bottom:1px solid #223;">
            <td style="padding:4px 2px;">Culling OFF</td>
            <td style="padding:4px 2px; text-align:right; font-weight:bold;">${offFps}</td>
            <td style="padding:4px 2px; text-align:right;">${offCalls}</td>
            <td style="padding:4px 2px; text-align:right;">${offTris.toLocaleString()}</td>
          </tr>
          <tr style="border-bottom:1px solid #223;">
            <td style="padding:4px 2px;">Culling ON</td>
            <td style="padding:4px 2px; text-align:right; font-weight:bold; color:${gainColor};">${onFps}</td>
            <td style="padding:4px 2px; text-align:right;">${onCalls}</td>
            <td style="padding:4px 2px; text-align:right; color:${triColor};">${onTris.toLocaleString()}</td>
          </tr>
        </table>
        <div style="background:#1e293b; padding:6px 8px; border-radius:4px; font-weight:bold;">
          Delta: <span style="color:${gainColor};">${fpsGain >= 0 ? '+' + fpsGain : fpsGain} FPS</span> | 
          Tris: <span style="color:${triColor};">${triDelta.toLocaleString()}</span> | 
          Calls: <span>${callDelta}</span>
        </div>
      </div>
    `;

    resultsContainer.style.display = 'block';
    statusEl.textContent = '✅ Quick Culling Test Complete!';
    if (quickBtn) quickBtn.disabled = false;
    if (benchBtn) benchBtn.disabled = false;
    this.isBenchmarking = false;
  }

  async runComprehensiveBenchmark() {
    if (this.isBenchmarking) return;
    this.isBenchmarking = true;

    // Reset stored benchmark text immediately so stale data is never exported
    this.lastBenchmarkText = '';

    const statusEl = this.panel.querySelector('#benchmark-status');
    const resultsContainer = this.panel.querySelector('#benchmark-results-container');
    const resultsEl = this.panel.querySelector('#benchmark-results');
    const benchBtn = this.panel.querySelector('#btn-run-full-benchmark');
    if (benchBtn) benchBtn.disabled = true;

    resultsContainer.style.display = 'none';
    resultsEl.innerHTML = '';

    const masterState = this._saveFullState();
    const originalState = { ...this.state };
    const originalDpr = this.state.pixelRatio;

    // Phase A: Architectural Feature Toggles
    const featureTests = [
      { name: '01. Baseline (Initial)', run: () => {}, revert: () => {} },
      { name: '02. Pixel Ratio = 0.5x', run: () => this.setPixelRatio(0.5), revert: () => this.setPixelRatio(originalDpr) },
      { name: '03. Pixel Ratio = 1.0x', run: () => this.setPixelRatio(1.0), revert: () => this.setPixelRatio(originalDpr) },
      { name: '04. Shadows OFF', run: () => { this.ctx.renderer.shadowMap.enabled = false; }, revert: () => { this.ctx.renderer.shadowMap.enabled = originalState.shadows; } },
      { name: '05. Post-Processing OFF (Direct)', run: () => { this.state.postProcessing = false; }, revert: () => { this.state.postProcessing = originalState.postProcessing; } },
      { name: '06. Particles & VFX OFF', run: () => this._toggleParticles(false), revert: () => this._toggleParticles(true) },
      { name: '07. Ground Only (Hide all props)', run: () => this._toggleGroundOnly(true), revert: () => this._toggleGroundOnly(false) },
      { name: '08. Pause Game Logic (Render only)', run: () => { this.state.pauseLogic = true; }, revert: () => { this.state.pauseLogic = false; } },
      { name: '09. Skip Render (Logic only)', run: () => { this.state.skipRender = true; }, revert: () => { this.state.skipRender = false; } },
      { name: '10. Dynamic Lights OFF', run: () => this._toggleLights(false), revert: () => this._toggleLights(true) },
    ];

    // Phase B: Object Bisect Tests (Hide ONE group at a time)
    const bisectGroups = this.getObjectGroups();
    const bisectTests = Object.keys(bisectGroups).map((gName, idx) => {
      const objs = bisectGroups[gName];
      let meshCount = 0;
      let triCount = 0;
      objs.forEach(o => {
        o.traverse(c => {
          if (c.isMesh && c.geometry) {
            meshCount++;
            const t = c.geometry.index ? c.geometry.index.count / 3 : (c.geometry.attributes?.position?.count / 3 || 0);
            triCount += Math.round(t * (c.count || 1));
          }
        });
      });

      return {
        name: `Bisect: Hide [${gName}]`,
        groupName: gName,
        meshCount,
        triCount,
        run: () => this._hideObjectGroup(gName, true),
        revert: () => this._hideObjectGroup(gName, false)
      };
    });

    // Phase C: Single Toggle Optimizations (Materials + Chunk Frustum Culling + Shadow Cadence + 7 Lights Audit)
    const optTests = [
      {
        name: 'Toggle: House Material OPAQUE (depthWrite=true)',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.setHouseOpaque(true); },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.setHouseOpaque(false); }
      },
      {
        name: 'Toggle: FrontSide Materials (Houses, cliffs, ground)',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.setFrontSideMaterials(true); },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.setFrontSideMaterials(false); }
      },
      {
        name: 'Toggle: Chunk Frustum Culling ON (15% margin)',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.toggles.chunkFrustumCulling = true; },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.toggles.chunkFrustumCulling = false; }
      },
      {
        name: 'Toggle: Shadow Map Update Every 2nd Frame ON',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.toggles.shadowEvery2ndFrame = true; },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.toggles.shadowEvery2ndFrame = false; }
      },
      // Individual Light Audit (Disable ONE light at a time to record delta)
      {
        name: 'Light 1 OFF: Starlight Hemisphere Light',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_starlightHemi', false); },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_starlightHemi', true); }
      },
      {
        name: 'Light 2 OFF: Moon Directional Light',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_moonLight', false); },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_moonLight', true); }
      },
      {
        name: 'Light 3 OFF: Village Facade Light',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_villageFacade', false); },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_villageFacade', true); }
      },
      {
        name: 'Light 4 OFF: Ambient Warm Fill',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_ambientWarm', false); },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_ambientWarm', true); }
      },
      {
        name: 'Light 5 OFF: Aurora Sky-to-Ground Light',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_auroraGround', false); },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_auroraGround', true); }
      },
      {
        name: 'Light 6 OFF: Sleigh Lantern Point Light (Left)',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_lanternLeft', false); },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_lanternLeft', true); }
      },
      {
        name: 'Light 7 OFF: Sleigh Lantern Point Light (Right)',
        run: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_lanternRight', false); },
        revert: () => { if (window.mobileOptimizer) window.mobileOptimizer.setLight('light_lanternRight', true); }
      }
    ];

    const allTests = [...featureTests, ...bisectTests, ...optTests];
    const measurements = [];

    const totalSteps = allTests.length + 1; // +1 for final baseline drift test
    let step = 0;

    for (const t of allTests) {
      step++;
      statusEl.textContent = `[${step}/${totalSteps}] ${t.name} (Warmup 1.5s)...`;
      t.run();

      // 1.5s Warmup for shader compilation / pipeline stabilize
      await new Promise(r => setTimeout(r, 1500));

      statusEl.textContent = `[${step}/${totalSteps}] ${t.name} (Measuring 3s)...`;
      const avgFps = await this._measureFps(3000);

      // Snapshot full frame telemetry during test
      const calls = this.lastCalls;
      const tris = this.lastTriangles;

      measurements.push({
        name: t.name,
        fps: avgFps,
        calls,
        triangles: tris,
        isBisect: !!t.groupName,
        groupName: t.groupName,
        meshCount: t.meshCount,
        triCount: t.triCount
      });

      if (t.revert) {
        try { t.revert(); } catch(e) { console.warn('Error reverting test:', e); }
      }
      this._restoreFullState(masterState);

      // 3s Cooldown between tests to reduce thermal throttling
      statusEl.textContent = `[${step}/${totalSteps}] Cooling down (3s)...`;
      await new Promise(r => setTimeout(r, 3000));
    }

    // Final State Restoration & Drift Check
    this._restoreFullState(masterState);
    step++;
    statusEl.textContent = `[${step}/${totalSteps}] Verifying Restored Baseline State (3s)...`;
    await new Promise(r => setTimeout(r, 1500));
    const finalBaselineFps = await this._measureFps(3000);
    this._restoreFullState(masterState);

    const initialBaseFps = measurements[0].fps || 1;
    const thermalDrift = finalBaselineFps - initialBaseFps;

    // Generate Scene Audit Report
    const sceneReport = this.generateSceneReport();
    const devInfo = this.getDeviceInfo();

    // Render results
    let html = `
      <div style="background:#0f172a; padding:8px; border-radius:6px; margin-bottom:8px; border:1px solid #334155;">
        <div style="color:#ffd700; font-weight:bold; margin-bottom:4px;">📱 Device & Hardware:</div>
        <div><strong>GPU:</strong> ${devInfo.unmaskedRenderer}</div>
        <div><strong>Vendor:</strong> ${devInfo.unmaskedVendor}</div>
        <div><strong>Screen:</strong> ${devInfo.screenWidth}x${devInfo.screenHeight} (DPR: ${devInfo.devicePixelRatio})</div>
        <div><strong>Viewport:</strong> ${devInfo.windowWidth}x${devInfo.windowHeight}</div>
        <div style="font-size:9px; color:#64748b; margin-top:4px; word-break:break-all;"><strong>UA:</strong> ${devInfo.userAgent}</div>
      </div>

      <div style="background:#0f172a; padding:8px; border-radius:6px; margin-bottom:8px; border:1px solid #334155; font-size:11px;">
        <div style="color:#38bdf8; font-weight:bold; margin-bottom:4px;">⏱️ CPU vs GPU Timing Split (Baseline):</div>
        <div>JS Logic Update: <strong>${sceneReport.avgLogicTime.toFixed(2)} ms</strong></div>
        <div>renderer.render() CPU: <strong>${sceneReport.avgRenderTime.toFixed(2)} ms</strong></div>
        <div>Total Frame Time: <strong>${sceneReport.avgFrameTime.toFixed(2)} ms</strong></div>
        <div style="color:#a7f3d0; margin-top:2px;">Thermal Drift (Final vs Initial Baseline): <strong>${thermalDrift >= 0 ? `+${thermalDrift}` : thermalDrift} FPS</strong></div>
      </div>

      <div style="color:#ffd700; font-weight:bold; margin:8px 0 4px 0;">⚡ 1. Feature Toggle Benchmark:</div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:10px; font-size:11px;">
        <tr style="border-bottom:1px solid #556; text-align:left; color:#ffd700;">
          <th style="padding:4px;">Configuration</th>
          <th style="padding:4px; text-align:right;">Calls</th>
          <th style="padding:4px; text-align:right;">Avg FPS</th>
          <th style="padding:4px; text-align:right;">Delta</th>
        </tr>
    `;

    measurements.filter(m => !m.isBisect).forEach((m, idx) => {
      const delta = m.fps - initialBaseFps;
      const deltaColor = delta > 0 ? '#55ff55' : (delta < 0 ? '#ff5555' : '#888');
      const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
      html += `
        <tr style="border-bottom:1px solid #334;">
          <td style="padding:4px;">${m.name}</td>
          <td style="padding:4px; text-align:right;">${m.calls}</td>
          <td style="padding:4px; text-align:right; font-weight:bold;">${m.fps}</td>
          <td style="padding:4px; text-align:right; color:${deltaColor};">${idx === 0 ? '-' : deltaStr}</td>
        </tr>
      `;
    });
    html += `</table>`;

    // Bisect Table
    html += `
      <div style="color:#ffd700; font-weight:bold; margin:8px 0 4px 0;">🔍 2. Object Bisect Results (Hide ONE Group):</div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:10px; font-size:11px;">
        <tr style="border-bottom:1px solid #556; text-align:left; color:#ffd700;">
          <th style="padding:4px;">Object Group Hidden</th>
          <th style="padding:4px; text-align:right;">Meshes</th>
          <th style="padding:4px; text-align:right;">Tris</th>
          <th style="padding:4px; text-align:right;">Avg FPS</th>
          <th style="padding:4px; text-align:right;">Gain</th>
        </tr>
    `;

    measurements.filter(m => m.isBisect).forEach(m => {
      const delta = m.fps - initialBaseFps;
      const deltaColor = delta > 0 ? '#55ff55' : (delta < 0 ? '#ff5555' : '#888');
      const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
      html += `
        <tr style="border-bottom:1px solid #334;">
          <td style="padding:4px;">${m.groupName}</td>
          <td style="padding:4px; text-align:right;">${m.meshCount}</td>
          <td style="padding:4px; text-align:right;">${m.triCount.toLocaleString()}</td>
          <td style="padding:4px; text-align:right; font-weight:bold;">${m.fps}</td>
          <td style="padding:4px; text-align:right; color:${deltaColor}; font-weight:bold;">${deltaStr}</td>
        </tr>
      `;
    });
    html += `</table>`;

    // Scene Report Overview
    html += `
      <div style="color:#ffd700; font-weight:bold; margin:8px 0 4px 0;">📊 3. Top 15 Meshes by Polygon Count:</div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:10px; font-size:10px;">
        <tr style="border-bottom:1px solid #556; text-align:left; color:#ffd700;">
          <th style="padding:3px;">Mesh Name</th>
          <th style="padding:3px; text-align:right;">Instances</th>
          <th style="padding:3px; text-align:right;">Total Tris</th>
          <th style="padding:3px; text-align:right;">Material</th>
        </tr>
    `;

    sceneReport.top15Meshes.forEach(mesh => {
      html += `
        <tr style="border-bottom:1px solid #334;">
          <td style="padding:3px; word-break:break-all;">${mesh.name}</td>
          <td style="padding:3px; text-align:right;">${mesh.instances}</td>
          <td style="padding:3px; text-align:right; font-weight:bold;">${mesh.totalTriangles.toLocaleString()}</td>
          <td style="padding:3px; text-align:right; color:#94a3b8;">${mesh.materialType}</td>
        </tr>
      `;
    });
    html += `</table>`;

    html += `
      <div style="background:#0f172a; padding:8px; border-radius:6px; margin-bottom:8px; border:1px solid #334155; font-size:11px;">
        <div style="color:#ffd700; font-weight:bold; margin-bottom:4px;">📦 Material & Texture Audit:</div>
        <div>Skinned Meshes: <strong>${sceneReport.skinnedCount}</strong> (Total Bones: <strong>${sceneReport.totalBones}</strong>)</div>
        <div>Materials: Standard (${sceneReport.materialCounts.MeshStandardMaterial}), Physical (${sceneReport.materialCounts.MeshPhysicalMaterial}), Lambert (${sceneReport.materialCounts.MeshLambertMaterial}), Basic (${sceneReport.materialCounts.MeshBasicMaterial}), Shader (${sceneReport.materialCounts.ShaderMaterial})</div>
        <div>Textures: <strong>${sceneReport.textures.length}</strong> (Estimated VRAM: <strong>${sceneReport.totalTextureMB} MB</strong>)</div>
        <div>Lights: <strong>${sceneReport.totalLights}</strong> (Shadow casters: <strong>${sceneReport.shadowLights}</strong> [${sceneReport.shadowLightNames.join(', ')}])</div>
      </div>
    `;

    // Construct plain-text export for Copy & Download
    const settingsHeader = this._getActiveSettingsHeader();

    this.lastBenchmarkText = `=== MOBILE 3D GAME DIAGNOSTIC & BISECT REPORT ===
${settingsHeader}


1. DEVICE & HARDWARE TELEMETRY:
User Agent: ${devInfo.userAgent}
Screen: ${devInfo.screenWidth}x${devInfo.screenHeight} (DPR: ${devInfo.devicePixelRatio})
Viewport: ${devInfo.windowWidth}x${devInfo.windowHeight}
WebGL Vendor: ${devInfo.unmaskedVendor}
WebGL GPU Renderer: ${devInfo.unmaskedRenderer}

2. TIMING SPLIT & THERMAL DRIFT:
JS Logic Time: ${sceneReport.avgLogicTime.toFixed(2)} ms
renderer.render() CPU: ${sceneReport.avgRenderTime.toFixed(2)} ms
Total Frame Time: ${sceneReport.avgFrameTime.toFixed(2)} ms
Initial Baseline: ${initialBaseFps} FPS
Final Baseline (Thermal Drift Check): ${finalBaselineFps} FPS (Drift: ${thermalDrift >= 0 ? `+${thermalDrift}` : thermalDrift} FPS)

3. FEATURE TOGGLE RESULTS:
${measurements.filter(m => !m.isBisect).map((m, idx) => {
  const delta = idx === 0 ? '0 (Baseline)' : (m.fps - initialBaseFps >= 0 ? `+${m.fps - initialBaseFps}` : `${m.fps - initialBaseFps}`);
  return `- ${m.name.padEnd(38)}: ${m.fps} FPS | Calls: ${m.calls} | Gain: ${delta}`;
}).join('\n')}

4. OBJECT BISECT RESULTS (Hiding ONE group at a time):
${measurements.filter(m => m.isBisect).map(m => {
  const delta = m.fps - initialBaseFps >= 0 ? `+${m.fps - initialBaseFps}` : `${m.fps - initialBaseFps}`;
  return `- Hide [${m.groupName.padEnd(30)}]: ${m.fps} FPS (Gain: ${delta.padEnd(6)}) | Meshes: ${m.meshCount} | Tris: ${m.triCount.toLocaleString()}`;
}).join('\n')}

5. TOP 15 MESHES BY POLYGON COUNT:
${sceneReport.top15Meshes.map((m, i) => `${(i+1).toString().padStart(2)}. ${m.name.padEnd(35)} | Instances: ${m.instances.toString().padStart(3)} | Tris: ${m.totalTriangles.toLocaleString().padStart(8)} | Mat: ${m.materialType}`).join('\n')}

6. SCENE AUDIT:
Skinned Meshes: ${sceneReport.skinnedCount} (Total Bones: ${sceneReport.totalBones})
Material Counts:
  - MeshStandardMaterial: ${sceneReport.materialCounts.MeshStandardMaterial}
  - MeshPhysicalMaterial: ${sceneReport.materialCounts.MeshPhysicalMaterial}
  - MeshLambertMaterial:  ${sceneReport.materialCounts.MeshLambertMaterial}
  - MeshBasicMaterial:    ${sceneReport.materialCounts.MeshBasicMaterial}
  - ShaderMaterial:       ${sceneReport.materialCounts.ShaderMaterial}
  - Other:                ${sceneReport.materialCounts.Other}
Expensive Features Used:
${sceneReport.expensiveMaterials.length === 0 ? '  (None)' : sceneReport.expensiveMaterials.map(m => `  - ${m.name} (${m.type}): ${m.features}`).join('\n')}
Active Lights: ${sceneReport.totalLights} (Shadow Casters: ${sceneReport.shadowLights} -> ${sceneReport.shadowLightNames.join(', ')})
Textures (${sceneReport.textures.length} total, ~${sceneReport.totalTextureMB} MB VRAM):
${sceneReport.textures.map(t => `  - ${t.name}: ${t.width}x${t.height} (~${(t.bytes / (1024*1024)).toFixed(2)} MB)`).join('\n')}
=================================================`;

    resultsEl.innerHTML = html;
    resultsContainer.style.display = 'block';
    statusEl.textContent = '✅ Benchmark & Bisect Complete!';
    if (benchBtn) benchBtn.disabled = false;
    this.isBenchmarking = false;
  }

  async _copyResultsToClipboard(btn) {
    if (!this.lastBenchmarkText) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(this.lastBenchmarkText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = this.lastBenchmarkText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      const prev = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = prev; }, 2000);
    } catch (err) {
      alert('Could not copy directly. Please use "Download .txt" button.');
    }
  }

  _downloadResultsFile() {
    if (!this.lastBenchmarkText) return;
    try {
      const blob = new Blob([this.lastBenchmarkText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `phone_diagnostic_bisect_${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
    }
  }
}
