import * as THREE from 'three';

/**
 * MobileOptimizer — Safe, Visually-Lossless Single-Toggle Optimization Suite
 *
 * Implements:
 * 1. Native Three.js Per-Chunk Frustum Culling:
 *    - Each chunk has its OWN InstancedMesh per type with its own computed bounding sphere (+15% margin).
 *    - Three.js natively tests the camera frustum for the main pass, and the shadow camera for the shadow pass.
 *    - When toggle is OFF: frustumCulled = false on all chunk meshes (baseline behavior).
 *    - When toggle is ON: frustumCulled = true on all chunk meshes.
 * 2. Per-Pass Tracking via onBeforeRender:
 *    - Tracks chunks drawn in main pass vs total.
 *    - Tracks chunks drawn in shadow pass vs total.
 *    - Reports chunks culled from main pass (colored red in wireframe) vs drawn (green).
 * 3. Prints console warning if toggle is ON but drawn chunks equals total for 3s while camera moves.
 */

export class MobileOptimizer {
  constructor(gameContext, options = {}) {
    this.ctx = gameContext;
    this.enabled = options.isMobile === true;

    // Individual optimization toggles (ALL DEFAULT OFF except light toggles which start ON)
    this.toggles = {
      chunkFrustumCulling: false,
      shadowEvery2ndFrame: false,
      debugWireframes: false,
      houseOpaque: true,
      frontSideMaterials: true,
      // 7 individual light toggles
      light_starlightHemi: true,
      light_moonLight: true,
      light_villageFacade: true,
      light_ambientWarm: true,
      light_auroraGround: true,
      light_lanternLeft: true,
      light_lanternRight: true
    };

    // Live chunk draw stats
    this.stats = {
      main: {
        houses: { drawn: 0, total: 0 },
        trees: { drawn: 0, total: 0 },
        cliffs: { drawn: 0, total: 0 },
        ground: { drawn: 0, total: 0 },
        chunksDrawn: 0,
        chunksTotal: 0
      },
      shadow: {
        houses: { drawn: 0, total: 0 },
        trees: { drawn: 0, total: 0 },
        cliffs: { drawn: 0, total: 0 },
        ground: { drawn: 0, total: 0 },
        chunksDrawn: 0,
        chunksTotal: 0
      }
    };

    // Frame accumulation sets for onBeforeRender
    this._frameMainDrawnChunks = new Set();
    this._frameShadowDrawnChunks = new Set();
    this._frameMainDrawnCategories = { houses: 0, trees: 0, cliffs: 0, ground: 0 };
    this._frameShadowDrawnCategories = { houses: 0, trees: 0, cliffs: 0, ground: 0 };

    // Shadow cadence counter
    this._shadowFrameCounter = 0;

    // Wireframe debug group
    this.wireframeGroup = new THREE.Group();
    this.wireframeGroup.name = 'DebugWireframeChunkBounds';
    this.wireframeGroup.visible = false;
    this.ctx.scene.add(this.wireframeGroup);
    this.wireframeMeshes = new Map();

    // Reusable line materials
    this.matGreen = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.85 });
    this.matRed = new THREE.LineBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.85 });
    this.matYellow = new THREE.LineBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.85 });

    // Camera tracker for stagnation warning
    this._lastCamPos = new THREE.Vector3();
    this._stagnantTime = 0;
    this._hasWarnedStagnation = false;
    this._lastCulledChunksLogged = '';

    // Register global hook for onBeforeRender
    this._setupRenderHook();

    this._applied = false;
  }

  _setupRenderHook() {
    window._onChunkMeshRender = (mesh, camera, chunkKey, category) => {
      // Determine if this is the shadow pass or main pass
      const isShadowPass = (camera === this.ctx.moonLight?.shadow?.camera) || (camera?.isOrthographicCamera && camera !== this.ctx.camera);

      const catKey = (category === 'house' || mesh.userData.isHouse) ? 'houses'
                   : ((category === 'foliage' || (mesh.userData.defName || '').toLowerCase().includes('tree')) ? 'trees'
                   : (category === 'cliff' ? 'cliffs' : 'ground'));

      if (isShadowPass) {
        this._frameShadowDrawnChunks.add(chunkKey);
        this._frameShadowDrawnCategories[catKey] += mesh.userData.instanceCount || 1;
      } else {
        this._frameMainDrawnChunks.add(chunkKey);
        this._frameMainDrawnCategories[catKey] += mesh.userData.instanceCount || 1;
      }
    };
  }

  apply() {
    if (!this.enabled || this._applied) return;
    this._applied = true;
    console.log('[MobileOptimizer] Safe per-chunk frustum culling loaded (ALL OPTIMIZATIONS DEFAULT OFF).');
    this.syncDesktopQuality();
    this.applyMaterialOptimizations();
  }

  syncDesktopQuality() {
    const targetDpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.ctx.renderer.setPixelRatio(targetDpr);
    if (this.ctx.composer) {
      this.ctx.composer.setPixelRatio(targetDpr);
    }

    const moon = this.ctx.moonLight;
    if (moon) {
      this.ctx.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      moon.shadow.mapSize.width = 2048;
      moon.shadow.mapSize.height = 2048;
      const d = 28;
      moon.shadow.camera.left = -d;
      moon.shadow.camera.right = d;
      moon.shadow.camera.top = d;
      moon.shadow.camera.bottom = -d;
      moon.shadow.camera.near = 12;
      moon.shadow.camera.far = 120;
      moon.shadow.camera.updateProjectionMatrix();
      moon.shadow.autoUpdate = true;
    }

    if (this.ctx.camera) {
      this.ctx.camera.far = 3500;
      this.ctx.camera.updateProjectionMatrix();
    }
    this.ctx.scene.fog = null;

    if (window.perfDebugger) {
      window.perfDebugger.state.postProcessing = true;
    }

    this._updateChunkCullingFlags();
    this._buildDebugWireframes();
  }

  _updateChunkCullingFlags() {
    const cs = this.ctx.chunkSystem;
    if (!cs || !cs.chunks) return;

    const culling = (this.toggles.chunkFrustumCulling === true);

    cs.chunks.forEach(chunkData => {
      if (chunkData.meshes) {
        chunkData.meshes.forEach(m => {
          m.frustumCulled = culling;
        });
      }
    });
  }

  update(delta, playerPos, fps) {
    if (!this.enabled) return;

    const cam = this.ctx.camera;
    if (!cam) return;

    // 1. Alternating frame shadow update cadence
    if (this.toggles.shadowEvery2ndFrame && this.ctx.moonLight) {
      this._shadowFrameCounter++;
      this.ctx.moonLight.shadow.autoUpdate = (this._shadowFrameCounter % 2 === 0);
    } else if (this.ctx.moonLight && !this.ctx.moonLight.shadow.autoUpdate) {
      this.ctx.moonLight.shadow.autoUpdate = true;
    }

    // 2. Commit previous frame render hook stats into this.stats
    this._commitFrameStats();

    // 3. Update wireframe colors: Green = drawn in main pass, Red = culled from main pass
    this._updateWireframes();

    // 4. Stagnation warning check
    this._checkStagnation(delta, cam);

    // Reset frame accumulation sets for the next frame render
    this._frameMainDrawnChunks.clear();
    this._frameShadowDrawnChunks.clear();
    this._frameMainDrawnCategories = { houses: 0, trees: 0, cliffs: 0, ground: 0 };
    this._frameShadowDrawnCategories = { houses: 0, trees: 0, cliffs: 0, ground: 0 };
  }

  _commitFrameStats() {
    const cs = this.ctx.chunkSystem;
    if (!cs || !cs.chunks) return;

    const totalChunks = cs.chunks.size || 25;
    let totalHouses = 0, totalTrees = 0, totalCliffs = 0, totalGround = 0;

    cs.chunks.forEach(chunkData => {
      if (chunkData.meshes) {
        chunkData.meshes.forEach(m => {
          const cat = m.userData.category;
          const count = m.userData.instanceCount || 1;
          if (cat === 'house' || m.userData.isHouse) totalHouses += count;
          else if (cat === 'foliage' || (m.userData.defName || '').toLowerCase().includes('tree')) totalTrees += count;
          else if (cat === 'cliff') totalCliffs += count;
          else totalGround += count;
        });
      }
    });

    // Main pass stats
    this.stats.main.chunksDrawn = this._frameMainDrawnChunks.size;
    this.stats.main.chunksTotal = totalChunks;
    this.stats.main.houses.drawn = this._frameMainDrawnCategories.houses;
    this.stats.main.houses.total = totalHouses;
    this.stats.main.trees.drawn = this._frameMainDrawnCategories.trees;
    this.stats.main.trees.total = totalTrees;
    this.stats.main.cliffs.drawn = this._frameMainDrawnCategories.cliffs;
    this.stats.main.cliffs.total = totalCliffs;
    this.stats.main.ground.drawn = this._frameMainDrawnCategories.ground;
    this.stats.main.ground.total = totalGround;

    // Shadow pass stats
    this.stats.shadow.chunksDrawn = this._frameShadowDrawnChunks.size;
    this.stats.shadow.chunksTotal = totalChunks;
    this.stats.shadow.houses.drawn = this._frameShadowDrawnCategories.houses;
    this.stats.shadow.houses.total = totalHouses;
    this.stats.shadow.trees.drawn = this._frameShadowDrawnCategories.trees;
    this.stats.shadow.trees.total = totalTrees;
    this.stats.shadow.cliffs.drawn = this._frameShadowDrawnCategories.cliffs;
    this.stats.shadow.cliffs.total = totalCliffs;
    this.stats.shadow.ground.drawn = this._frameShadowDrawnCategories.ground;
    this.stats.shadow.ground.total = totalGround;
  }

  _updateWireframes() {
    if (!this.toggles.debugWireframes) {
      if (this.wireframeGroup.visible) this.wireframeGroup.visible = false;
      return;
    }

    if (!this.wireframeGroup.visible) this.wireframeGroup.visible = true;

    const cs = this.ctx.chunkSystem;
    if (!cs || !cs.chunks) return;

    if (this.wireframeMeshes.size !== cs.chunks.size) {
      this._buildDebugWireframes();
    }

    const culledList = [];

    cs.chunks.forEach((_chunkData, key) => {
      const wireframe = this.wireframeMeshes.get(key);
      if (!wireframe) return;

      const isDrawnMain = this._frameMainDrawnChunks.has(key);
      const isDrawnShadow = this._frameShadowDrawnChunks.has(key);

      if (isDrawnMain) {
        wireframe.material = this.matGreen; // Green = drawn in main pass
      } else if (isDrawnShadow) {
        wireframe.material = this.matYellow; // Yellow = shadow pass only
        culledList.push(key);
      } else {
        wireframe.material = this.matRed; // Red = culled from main pass
        culledList.push(key);
      }
    });

    // Print culled chunks occasionally when culling is active
    if (this.toggles.chunkFrustumCulling && culledList.length > 0) {
      const culledStr = culledList.sort().join(', ');
      if (culledStr !== this._lastCulledChunksLogged) {
        this._lastCulledChunksLogged = culledStr;
        console.log(`[Chunk Culling] ${culledList.length}/${cs.chunks.size} chunks culled (Red/Yellow): [${culledStr}]`);
      }
    }
  }

  _checkStagnation(delta, camera) {
    if (!this.toggles.chunkFrustumCulling) {
      this._stagnantTime = 0;
      this._hasWarnedStagnation = false;
      return;
    }

    const camMoved = camera.position.distanceTo(this._lastCamPos) > 0.05;
    this._lastCamPos.copy(camera.position);

    const isAllChunksDrawn = this.stats.main.chunksDrawn === this.stats.main.chunksTotal && this.stats.main.chunksTotal > 0;

    if (isAllChunksDrawn && camMoved) {
      this._stagnantTime += delta;
      if (this._stagnantTime >= 3.0 && !this._hasWarnedStagnation) {
        console.warn(`[MobileOptimizer WARNING] Chunk Frustum Culling is ON, but ALL ${this.stats.main.chunksTotal} chunks are drawn for >3s while camera moved!`);
        this._hasWarnedStagnation = true;
      }
    } else {
      this._stagnantTime = 0;
      this._hasWarnedStagnation = false;
    }
  }

  _buildDebugWireframes() {
    this.wireframeGroup.clear();
    this.wireframeMeshes.clear();
    const cs = this.ctx.chunkSystem;
    if (!cs || !cs.chunks) return;

    const chunkSize = cs.chunkSize || 20.0;
    const boxGeo = new THREE.BoxGeometry(chunkSize, 12, chunkSize);

    cs.chunks.forEach((chunkData, key) => {
      const wx = chunkData.cx * chunkSize;
      const wz = chunkData.cz * chunkSize;
      const wireframe = new THREE.LineSegments(new THREE.WireframeGeometry(boxGeo), this.matGreen);
      wireframe.position.set(wx, 6.0, wz);
      this.wireframeGroup.add(wireframe);
      this.wireframeMeshes.set(key, wireframe);
    });

    this.wireframeGroup.visible = this.toggles.debugWireframes;
  }

  setDebugWireframes(visible) {
    this.toggles.debugWireframes = visible;
    this._updateWireframes();
  }

  setLight(lightKey, enabled) {
    this.toggles[lightKey] = enabled;

    switch (lightKey) {
      case 'light_starlightHemi':
        if (this.ctx.starlightHemiLight) this.ctx.starlightHemiLight.visible = enabled;
        break;
      case 'light_moonLight':
        if (this.ctx.moonLight) this.ctx.moonLight.visible = enabled;
        break;
      case 'light_villageFacade':
        if (this.ctx.villageFacadeLight) this.ctx.villageFacadeLight.visible = enabled;
        break;
      case 'light_ambientWarm':
        if (this.ctx.ambientWarm) this.ctx.ambientWarm.visible = enabled;
        break;
      case 'light_auroraGround':
        if (this.ctx.auroraGroundLight) this.ctx.auroraGroundLight.visible = enabled;
        break;
      case 'light_lanternLeft':
        if (this.ctx.sleighController?.sleighLanterns?.[0]?.light) {
          this.ctx.sleighController.sleighLanterns[0].light.visible = enabled;
        }
        break;
      case 'light_lanternRight':
        if (this.ctx.sleighController?.sleighLanterns?.[1]?.light) {
          this.ctx.sleighController.sleighLanterns[1].light.visible = enabled;
        }
        break;
    }
  }
  applyMaterialOptimizations() {
    const cs = this.ctx.chunkSystem;
    if (!cs || !cs.sharedMaterials) return;

    const houseMat = cs.sharedMaterials.get('Winter Holiday Building Sprite Sheet');
    if (houseMat) {
      if (this.toggles.houseOpaque) {
        houseMat.transparent = false;
        houseMat.depthWrite = true;
        houseMat.opacity = 1.0;
        houseMat.alphaTest = 0.0;
      } else {
        houseMat.transparent = true;
        houseMat.depthWrite = true;
        houseMat.opacity = 1.0;
        houseMat.alphaTest = 0.45;
      }
      houseMat.needsUpdate = true;
    }

    // Update side on non-foliage materials
    cs.sharedMaterials.forEach((mat, name) => {
      const lower = (name || '').toLowerCase();
      const isFoliage = lower.includes('tree') || lower.includes('shrub');
      if (isFoliage) return; // Keep trees double-sided

      if (this.toggles.frontSideMaterials) {
        mat.side = THREE.FrontSide;
        mat.shadowSide = THREE.FrontSide;
      } else {
        mat.side = THREE.DoubleSide;
        mat.shadowSide = THREE.DoubleSide;
      }
      mat.needsUpdate = true;
    });

    // Update chunk meshes renderOrder
    if (cs.chunks) {
      cs.chunks.forEach(chunkData => {
        if (chunkData.meshes) {
          chunkData.meshes.forEach(m => {
            if (m.userData.category === 'house' || m.userData.isHouse) {
              m.renderOrder = this.toggles.houseOpaque ? 0 : 1;
            }
          });
        }
      });
    }
  }

  setHouseOpaque(enabled) {
    this.toggles.houseOpaque = enabled;
    this.applyMaterialOptimizations();
  }

  setFrontSideMaterials(enabled) {
    this.toggles.frontSideMaterials = enabled;
    this.applyMaterialOptimizations();
  }

  toggleCompare() {
    const newState = !this.toggles.houseOpaque;
    this.toggles.houseOpaque = newState;
    this.toggles.frontSideMaterials = newState;
    this.applyMaterialOptimizations();

    // Sync checkboxes if debug panel exists
    const chkHouse = document.getElementById('chk-house-opaque');
    if (chkHouse) chkHouse.checked = newState;
    const chkFront = document.getElementById('chk-front-side');
    if (chkFront) chkFront.checked = newState;

    console.log(`[MobileOptimizer] Compare flipped: houseOpaque=${newState}, frontSideMaterials=${newState}`);
    return newState;
  }
}
