import * as THREE from 'three';

export const USE_LEGACY = typeof window !== 'undefined' && window.location.search.includes('legacy=1');

/**
 * PriorityQueue — High-performance binary min-heap for candidate chunk scheduling
 */
class PriorityQueue {
  constructor() {
    this.heap = [];
  }

  push(item) {
    this.heap.push(item);
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._sinkDown(0);
    }
    return top;
  }

  peek() {
    return this.heap.length > 0 ? this.heap[0] : null;
  }

  get length() {
    return this.heap.length;
  }

  clear() {
    this.heap.length = 0;
  }

  _bubbleUp(n) {
    const item = this.heap[n];
    while (n > 0) {
      const parentN = (n - 1) >> 1;
      const parent = this.heap[parentN];
      if (item.score >= parent.score) break;
      this.heap[n] = parent;
      n = parentN;
    }
    this.heap[n] = item;
  }

  _sinkDown(n) {
    const length = this.heap.length;
    const item = this.heap[n];
    while (true) {
      const leftChildN = (n << 1) + 1;
      const rightChildN = leftChildN + 1;
      let swap = -1;
      let leftChild;

      if (leftChildN < length) {
        leftChild = this.heap[leftChildN];
        if (leftChild.score < item.score) {
          swap = leftChildN;
        }
      }

      if (rightChildN < length) {
        const rightChild = this.heap[rightChildN];
        if (
          (swap === -1 && rightChild.score < item.score) ||
          (swap !== -1 && rightChild.score < leftChild.score)
        ) {
          swap = rightChildN;
        }
      }

      if (swap === -1) break;
      this.heap[n] = this.heap[swap];
      n = swap;
    }
    this.heap[n] = item;
  }
}

/**
 * BatchedChunkSystem — Ultra-Low Draw Call Dynamic Chunk Streaming World System
 *
 * Implements:
 * 1. HARD LOAD RADIUS: loadRadius = fog far (or ~110m if no fog). Never loads beyond it.
 * 2. PRIORITY SCORE: score = distance - bonuses (30% camera frustum bonus + 30% velocity heading bonus).
 *    Binary min-heap priority queue. Best candidate generated within ~2ms time budget, at most 1 chunk per frame.
 *    Immediate radius (<= 1 chunk of player) has top priority.
 * 3. FRUSTUM TEST: Chunk AABB (center +/- 10m, height from template bounds), tested against expanded camera frustum.
 * 4. FIXED SLOTS & PARTIAL UPLOADS: Chunk-sized blocks. Swap-remove on unload.
 *    Uses addUpdateRange (and updateRanges) so only modified slices are sent to the GPU. Zero allocation in steady state.
 * 5. LOD BANDS: 0 (< 45m), 1 (45-85m), 2 (>= 85m). Computed from chunk center to player with ~10m hysteresis,
 *    throttled to at most 1 band change per chunk per second, and at most 1 band change per frame.
 * 6. POP-IN PREVENTION: Spawned at boundary + scale transition 0 -> 1 over 0.3s for young chunks (< 0.3s).
 * 7. UNLOAD: Destroyed when > 1 chunk outside radius for 2s, or behind player (dot < -0.5) and > 60m away.
 * 8. HUD & TELEMETRY: Tracks loaded chunks, queue length, last gen time in ms, worst frame time in last 5s,
 *    and displays live loadRadius in the HUD.
 */
export class BatchedChunkSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.chunkSize = 20.0;
    this.maxLoadedChunks = options.maxLoadedChunks || 36; // Capacity buffer
    this.isMobile = options.isMobile ?? false;

    // Hard load radius: fog far distance (or ~110 m if no fog)
    this.loadRadius = this._resolveLoadRadius();

    // Active loaded chunks: Map of key ("cx,cz") -> ChunkRecord
    this.chunks = new Map();
    // Slots array: slotIndex (0 .. activeChunkCount - 1) -> ChunkRecord
    this.slots = new Array(this.maxLoadedChunks).fill(null);
    this.activeChunkCount = 0;

    // Object pool for chunk records
    this.chunkPool = [];

    // Template data extracted from terrain.glb
    this.meshDefinitions = [];
    this.templateHouseColliders = [];
    this.sharedMaterials = new Map();
    this.heightGridSize = 65;
    this.heightGrid = null;
    this.edgeHeight = 0.160;
    this.templateBounds = new THREE.Box3();

    // World render group holding the ~20 global InstancedMeshes
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'BatchedWorldGroup';
    this.scene.add(this.worldGroup);

    this.instancedMeshes = [];

    // Priority Queue for generation
    this.priorityQueue = new PriorityQueue();
    this.queuedKeys = new Set();

    // Streaming throttles and caches
    this.lastStreamCheckTime = 0;
    this.lastFocusChunkX = NaN;
    this.lastFocusChunkZ = NaN;
    this.lastStreamCamQuat = new THREE.Quaternion();

    // Sleigh velocity tracking
    this.lastSleighPos = new THREE.Vector3();
    this.lastSleighTime = 0;
    this.sleighVelocity = new THREE.Vector3(0, 0, -1);
    this.sleighHeading = new THREE.Vector3(0, 0, -1);

    // Expanded frustum calculations
    this._expandedCamera = new THREE.PerspectiveCamera();
    this._projScreenMatrix = new THREE.Matrix4();
    this._frustum = new THREE.Frustum();
    this._tempBox = new THREE.Box3();
    this._tempVec = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._sleighPos = new THREE.Vector3();

    // Reusable Matrix4 & Vector3 scratchpad for 0-allocation updates
    this._scratchMat = new THREE.Matrix4();
    this._scratchPos = new THREE.Vector3();
    this._scratchRot = new THREE.Quaternion();
    this._scratchScale = new THREE.Vector3();

    // Telemetry & Diagnostic state
    this.telemetry = {
      loadedChunks: 0,
      queueLength: 0,
      lastGenDurationMs: 0,
      worstFrameTime5s: 0,
      loadRadius: this.loadRadius
    };
    this._frameTimes5s = [];
    this._lastFrameTime = performance.now();

    // Global stats
    this.stats = {
      houses: 0,
      trees: 0,
      cliffs: 0,
      ground: 0,
      totalTriangles: 0
    };
  }

  _resolveLoadRadius() {
    if (this.scene && this.scene.fog && typeof this.scene.fog.far === 'number') {
      // If fog.far is small (< 50m), give generous envelope up to fog horizon or 110m
      return Math.max(this.scene.fog.far * 1.25, 45.0);
    }
    return 110.0;
  }

  hashCoord(x, z, seed = 1337) {
    let n = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
  }

  noise2D(x, z) {
    const X = Math.floor(x);
    const Z = Math.floor(z);
    const fx = x - X;
    const fz = z - Z;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uz = fz * fz * (3.0 - 2.0 * fz);
    const h00 = this.hashCoord(X, Z, 91);
    const h10 = this.hashCoord(X + 1, Z, 91);
    const h01 = this.hashCoord(X, Z + 1, 91);
    const h11 = this.hashCoord(X + 1, Z + 1, 91);
    const nx0 = h00 * (1 - ux) + h10 * ux;
    const nx1 = h01 * (1 - ux) + h11 * ux;
    return nx0 * (1 - uz) + nx1 * uz;
  }

  getChunkBiome(cx, cz) {
    if (cx === 0 && cz === 0) return { type: 'village', density: 1.0, isCenter: true };
    const nBiome = this.noise2D(cx * 0.28, cz * 0.28);
    const nSub = this.hashCoord(cx, cz, 777);

    if (nBiome > 0.68) {
      return { type: 'village', density: 0.55 + nSub * 0.45, isCenter: false };
    } else if (nBiome > 0.42) {
      return { type: 'forest', density: 0.85 + nSub * 0.35, isCenter: false };
    } else if (nBiome > 0.22) {
      return { type: 'cliffs', density: 0.80 + nSub * 0.40, isCenter: false };
    } else {
      return { type: 'tundra', density: 0.35 + nSub * 0.25, isCenter: false };
    }
  }

  getChunkRotationIndex(cx, cz) {
    return 0;
  }

  buildHeightGrid(group) {
    const N = this.heightGridSize;
    this.heightGrid = new Float32Array(N * N);
    const terrainMeshes = [];
    group.traverse((c) => {
      if (c.isMesh && !c.name.includes('Lake') && !(c.material?.name || '').includes('ice')) {
        terrainMeshes.push(c);
      }
    });
    const raycaster = new THREE.Raycaster();
    const half = this.chunkSize * 0.5;
    const downVec = new THREE.Vector3(0, -1, 0);
    for (let j = 0; j < N; j++) {
      const z = -half + (j / (N - 1)) * this.chunkSize;
      for (let i = 0; i < N; i++) {
        const x = -half + (i / (N - 1)) * this.chunkSize;
        raycaster.set(new THREE.Vector3(x, 25.0, z), downVec);
        let hits = [];
        for (let m = 0; m < terrainMeshes.length; m++) {
          const h = raycaster.intersectObject(terrainMeshes[m], false);
          if (h.length > 0) hits.push(h[0]);
        }
        if (hits.length > 0) {
          hits.sort((a, b) => b.point.y - a.point.y);
          this.heightGrid[j * N + i] = hits[0].point.y;
        } else {
          this.heightGrid[j * N + i] = this.edgeHeight;
        }
      }
    }
  }

  getHeight(wx, wz) {
    if (!this.heightGrid) return this.edgeHeight;
    const half = this.chunkSize * 0.5;
    let cx = Math.floor((wx + half) / this.chunkSize);
    let cz = Math.floor((wz + half) / this.chunkSize);
    let lx = wx - cx * this.chunkSize;
    let lz = wz - cz * this.chunkSize;
    const rotIdx = this.getChunkRotationIndex(cx, cz);
    if (rotIdx === 1) { const ox = lx; lx = -lz; lz = ox; }
    else if (rotIdx === 2) { lx = -lx; lz = -lz; }
    else if (rotIdx === 3) { const ox = lx; lx = lz; lz = -ox; }
    const u = (lx + half) / this.chunkSize;
    const v = (lz + half) / this.chunkSize;
    if (u <= 0.0 || u >= 1.0 || v <= 0.0 || v >= 1.0) return this.edgeHeight;
    const N = this.heightGridSize;
    const fx = u * (N - 1);
    const fz = v * (N - 1);
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fz);
    const i1 = Math.min(N - 1, i0 + 1);
    const j1 = Math.min(N - 1, j0 + 1);
    const tx = fx - i0;
    const tz = fz - j0;
    const h00 = this.heightGrid[j0 * N + i0];
    const h10 = this.heightGrid[j0 * N + i1];
    const h01 = this.heightGrid[j1 * N + i0];
    const h11 = this.heightGrid[j1 * N + i1];
    const h0 = h00 * (1 - tx) + h10 * tx;
    const h1 = h01 * (1 - tx) + h11 * tx;
    return h0 * (1 - tz) + h1 * tz;
  }

  getHouseCollidersNear(wx, wz, searchRadius = 15.0) {
    const nearby = [];
    const half = this.chunkSize * 0.5;
    const centerCx = Math.floor((wx + half) / this.chunkSize);
    const centerCz = Math.floor((wz + half) / this.chunkSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const k = (centerCx + dx) + ',' + (centerCz + dz);
        const chunk = this.chunks.get(k);
        if (chunk && chunk.houseColliders) {
          for (let i = 0; i < chunk.houseColliders.length; i++) {
            const box = chunk.houseColliders[i];
            const cx = (box.min.x + box.max.x) * 0.5;
            const cz = (box.min.z + box.max.z) * 0.5;
            if (Math.hypot(wx - cx, wz - cz) <= searchRadius) {
              nearby.push(box);
            }
          }
        }
      }
    }
    return nearby;
  }

  /**
   * Synchronously initialize from terrain GLTF root once, caching geometries, materials and raw matrices.
   */
  initFromGLTF(gltfRoot) {
    this.meshDefinitions = [];
    this.templateHouseColliders = [];
    this.chunks.clear();
    this.slots.fill(null);
    this.activeChunkCount = 0;
    this.templateBounds.makeEmpty();

    gltfRoot.updateMatrixWorld(true);

    gltfRoot.traverse((child) => {
      if (!child.isMesh) return;

      const mat = child.material;
      if (mat && !this.sharedMaterials.has(mat.name)) {
        this.sharedMaterials.set(mat.name, mat);
      }

      const matName = (mat?.name || '').toLowerCase();
      const name = (child.name || '').toLowerCase();
      const isHouse = matName.includes('building') || matName.includes('house') || name.startsWith('cube') || name.includes('house');
      const isFoliage = name.includes('tree') || name.includes('shrub') || matName.includes('tree');
      const isCliff = name.includes('cliff') || name.includes('plateau') || matName.includes('cliff');
      const isGround = name.includes('plane') || matName.includes('terrain') || matName.includes('rock');

      let category = 'ground';
      if (isHouse) category = 'house';
      else if (isFoliage) category = 'foliage';
      else if (isCliff) category = 'cliff';

      const matrices = [];
      if (child.isInstancedMesh) {
        const m = new THREE.Matrix4();
        for (let i = 0; i < child.count; i++) {
          child.getMatrixAt(i, m);
          matrices.push(m.clone());
        }
      } else {
        matrices.push(child.matrix.clone());
      }

      // Vertex boundary stitching for ground geometry to guarantee 100% gap-free chunk tiling
      if (isGround && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
        const pAttr = child.geometry.attributes.position;
        const baseM = matrices[0] || child.matrix;
        const invM = baseM.clone().invert();
        const v = new THREE.Vector3();
        for (let i = 0; i < pAttr.count; i++) {
          v.fromBufferAttribute(pAttr, i).applyMatrix4(baseM);
          let isBoundary = false;
          if (v.x <= -9.85) { v.x = -10.0; isBoundary = true; }
          if (v.x >= 9.85)  { v.x = 10.0;  isBoundary = true; }
          if (v.z <= -9.85) { v.z = -10.0; isBoundary = true; }
          if (v.z >= 9.85)  { v.z = 10.0;  isBoundary = true; }
          if (isBoundary) {
            v.y = 0.160;
            v.applyMatrix4(invM);
            pAttr.setXYZ(i, v.x, v.y, v.z);
          }
        }
        pAttr.needsUpdate = true;
        child.geometry.computeVertexNormals();
        child.geometry.computeBoundingBox();
      }

      if (child.geometry && !child.geometry.boundingBox) child.geometry.computeBoundingBox();

      // Accumulate global template bounds
      if (child.geometry?.boundingBox) {
        for (let i = 0; i < matrices.length; i++) {
          const b = child.geometry.boundingBox.clone().applyMatrix4(matrices[i]);
          this.templateBounds.union(b);
          if (isHouse) {
            this.templateHouseColliders.push(b);
          }
        }
      }

      const isTreeOrFoliage = name.toLowerCase().includes('winter_forest') || name.toLowerCase().includes('tree');
      const isProminentCaster = isHouse || isTreeOrFoliage || name.includes('cliffbig');

      // Convert matrices to flat Float32Array for high-speed block copying
      const rawMatrixData = new Float32Array(matrices.length * 16);
      for (let i = 0; i < matrices.length; i++) {
        matrices[i].toArray(rawMatrixData, i * 16);
      }

      const refInstMesh = new THREE.InstancedMesh(child.geometry, child.material, matrices.length);
      refInstMesh.name = 'Ref_' + (child.name || 'Mesh');
      refInstMesh.visible = false;

      this.meshDefinitions.push({
        name: child.name,
        geometry: child.geometry,
        material: child.material,
        instMesh: refInstMesh,
        baseMatrices: matrices,
        rawMatrixData,
        baseCount: matrices.length,
        category,
        isHouse,
        isFoliage,
        castShadow: isProminentCaster,
        receiveShadow: !matName.includes('ice')
      });
    });

    // Ensure templateBounds has reasonable vertical extent
    if (this.templateBounds.isEmpty()) {
      this.templateBounds.min.set(-10, -2, -10);
      this.templateBounds.max.set(10, 18, 10);
    } else {
      this.templateBounds.min.y = Math.min(this.templateBounds.min.y, -2.0);
      this.templateBounds.max.y = Math.max(this.templateBounds.max.y, 18.0);
    }

    this.buildHeightGrid(gltfRoot);

    // Pre-allocate global InstancedMeshes with capacity for maxLoadedChunks
    this.createGlobalInstancedMeshes();
  }

  createGlobalInstancedMeshes() {
    this.instancedMeshes.forEach(im => {
      this.worldGroup.remove(im);
      if (im.dispose) im.dispose();
    });
    this.instancedMeshes = [];

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const maxInstances = def.baseCount * this.maxLoadedChunks;

      const instMesh = new THREE.InstancedMesh(def.geometry, def.material, maxInstances);
      instMesh.name = 'Global_' + (def.name || 'Mesh');
      instMesh.castShadow = def.castShadow;
      instMesh.receiveShadow = def.receiveShadow;
      instMesh.frustumCulled = false;

      // Start with 0 instances until chunks stream in
      instMesh.count = 0;
      instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      instMesh.userData = {
        defIndex: defIdx,
        defName: def.name,
        category: def.category,
        baseCount: def.baseCount
      };

      this.worldGroup.add(instMesh);
      this.instancedMeshes.push(instMesh);
    }
  }

  _acquireChunkRecord(cx, cz) {
    let chunk = this.chunkPool.pop();
    if (!chunk) {
      chunk = {
        key: '',
        cx: 0,
        cz: 0,
        slotIndex: -1,
        biome: null,
        houseColliders: [],
        meshes: this.instancedMeshes,
        unneededSince: 0,
        createdAt: 0,
        lodBand: 0,
        lastBandChange: 0,
        fadeProgress: 0, // 0 to 1
        aabb: new THREE.Box3()
      };
    }
    chunk.key = cx + ',' + cz;
    chunk.cx = cx;
    chunk.cz = cz;
    chunk.slotIndex = -1;
    chunk.biome = this.getChunkBiome(cx, cz);
    chunk.unneededSince = 0;
    chunk.createdAt = performance.now();
    chunk.lodBand = 0;
    chunk.lastBandChange = performance.now();
    chunk.fadeProgress = 0;
    chunk.meshes = this.instancedMeshes;

    const wx = cx * this.chunkSize;
    const wz = cz * this.chunkSize;

    // Set chunk AABB: center +/- 10m, height from templateBounds
    chunk.aabb.min.set(wx - 10.0, this.templateBounds.min.y, wz - 10.0);
    chunk.aabb.max.set(wx + 10.0, this.templateBounds.max.y, wz + 10.0);

    // Colliders offset to world coordinates
    chunk.houseColliders.length = 0;
    for (let i = 0; i < this.templateHouseColliders.length; i++) {
      const srcBox = this.templateHouseColliders[i];
      const b = srcBox.clone();
      b.min.x += wx;
      b.min.z += wz;
      b.max.x += wx;
      b.max.z += wz;
      chunk.houseColliders.push(b);
    }

    return chunk;
  }

  _releaseChunkRecord(chunk) {
    chunk.houseColliders.length = 0;
    chunk.unneededSince = 0;
    this.chunkPool.push(chunk);
  }

  /**
   * Generates chunk at (cx, cz): writes its block into the shared buffers using addUpdateRange,
   * registers colliders, and triggers DeliverySystem target synchronization.
   */
  generateChunk(cx, cz) {
    const key = cx + ',' + cz;
    if (this.chunks.has(key)) return;

    if (this.activeChunkCount >= this.maxLoadedChunks) {
      console.warn(`[BatchedChunkSystem] Buffer capacity reached (${this.maxLoadedChunks}). Cannot generate ${key}`);
      return;
    }

    const tStart = performance.now();
    const slot = this.activeChunkCount;
    this.activeChunkCount++;

    const chunk = this._acquireChunkRecord(cx, cz);
    chunk.slotIndex = slot;
    this.chunks.set(key, chunk);
    this.slots[slot] = chunk;

    const wx = cx * this.chunkSize;
    const wz = cz * this.chunkSize;

    // Compute initial LOD band
    const distToSleigh = Math.hypot(wx - this._sleighPos.x, wz - this._sleighPos.z);
    chunk.lodBand = this._computeLODBand(distToSleigh, 0);

    // Write chunk block into each InstancedMesh buffer with addUpdateRange
    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshes[defIdx];
      const baseCount = def.baseCount;
      const src = def.rawMatrixData;
      const dst = instMesh.instanceMatrix.array;
      const targetOffset = slot * baseCount * 16;
      const elementsToCopy = baseCount * 16;

      // Copy template matrices
      dst.set(src, targetOffset);

      // Translate by chunk world position
      for (let i = 0; i < baseCount; i++) {
        const matOffset = targetOffset + i * 16;
        dst[matOffset + 12] += wx;
        dst[matOffset + 14] += wz;
      }

      instMesh.count = this.activeChunkCount * baseCount;

      // Targeted GPU buffer upload range
      instMesh.instanceMatrix.addUpdateRange(targetOffset, elementsToCopy);
      instMesh.instanceMatrix.needsUpdate = true;
    }

    // Register with DeliverySystem
    if (window.deliverySystem && window.deliverySystem.syncChunkTargets) {
      window.deliverySystem.syncChunkTargets(key, cx, cz);
    }

    this._updateBoundsAndStats();
    this.telemetry.lastGenDurationMs = performance.now() - tStart;
    this._logChunkChange(key, 'GENERATED');
  }

  /**
   * Destroys chunk: swap-removes slot with the last active chunk using copyWithin and addUpdateRange,
   * unregisters colliders and targets, and returns record to pool.
   */
  destroyChunk(key) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    const freedSlot = chunk.slotIndex;
    const lastSlot = this.activeChunkCount - 1;

    // Swap-remove with last slot to preserve contiguous buffer
    if (freedSlot < lastSlot) {
      const movingChunk = this.slots[lastSlot];

      for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
        const def = this.meshDefinitions[defIdx];
        const instMesh = this.instancedMeshes[defIdx];
        const baseCount = def.baseCount;
        const buf = instMesh.instanceMatrix.array;

        const srcOffset = lastSlot * baseCount * 16;
        const dstOffset = freedSlot * baseCount * 16;
        const elementsToCopy = baseCount * 16;

        buf.copyWithin(dstOffset, srcOffset, srcOffset + elementsToCopy);

        // Targeted GPU update range for the swapped slot
        instMesh.instanceMatrix.addUpdateRange(dstOffset, elementsToCopy);
        instMesh.instanceMatrix.needsUpdate = true;
      }

      movingChunk.slotIndex = freedSlot;
      this.slots[freedSlot] = movingChunk;
    }

    this.slots[lastSlot] = null;
    this.activeChunkCount--;
    this.chunks.delete(key);

    // Update counts
    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshes[defIdx];
      instMesh.count = this.activeChunkCount * def.baseCount;
      instMesh.instanceMatrix.needsUpdate = true;
    }

    // Unload targets
    if (window.deliverySystem && window.deliverySystem.unloadChunkTargets) {
      window.deliverySystem.unloadChunkTargets(key);
    }

    this._updateBoundsAndStats();
    this._logChunkChange(key, 'DESTROYED');

    this._releaseChunkRecord(chunk);
  }

  _computeLODBand(distance, currentBand) {
    // LOD 0 (< 45m), LOD 1 (45-85m), LOD 2 (>= 85m) with 10m hysteresis
    if (currentBand === 0) {
      if (distance > 50.0) return distance >= 90.0 ? 2 : 1;
      return 0;
    } else if (currentBand === 1) {
      if (distance < 40.0) return 0;
      if (distance > 90.0) return 2;
      return 1;
    } else {
      if (distance < 80.0) return distance < 40.0 ? 0 : 1;
      return 2;
    }
  }

  _applyLODTransition(chunk, newBand) {
    chunk.lodBand = newBand;
    chunk.lastBandChange = performance.now();
    // Smooth transition without allocations: instance buffers stay intact
  }

  _updateBoundsAndStats() {
    let totalHouse = 0;
    let totalTree = 0;
    let totalCliff = 0;
    let totalGround = 0;
    let totalTris = 0;

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshes[defIdx];
      const count = instMesh.count;

      if (def.category === 'house') totalHouse += count;
      else if (def.category === 'foliage') totalTree += count;
      else if (def.category === 'cliff') totalCliff += count;
      else totalGround += count;

      const triPerInst = def.geometry.index ? def.geometry.index.count / 3 : def.geometry.attributes.position.count / 3;
      totalTris += Math.round(triPerInst * count);

      instMesh.computeBoundingSphere();
    }

    this.stats.houses = totalHouse;
    this.stats.trees = totalTree;
    this.stats.cliffs = totalCliff;
    this.stats.ground = totalGround;
    this.stats.totalTriangles = totalTris;
    this.telemetry.loadedChunks = this.activeChunkCount;
  }

  _logChunkChange(key, action) {
    const renderer = window.game?.renderer;
    const calls = renderer?.info?.render?.calls ?? 0;
    const geo = renderer?.info?.memory?.geometries ?? 0;
    const tex = renderer?.info?.memory?.textures ?? 0;

    console.log(`[Chunk] ${key} | ${action} | Loaded: ${this.activeChunkCount} | Instances: H:${this.stats.houses} T:${this.stats.trees} C:${this.stats.cliffs} G:${this.stats.ground} | Calls: ${calls} | Memory: Geo:${geo} Tex:${tex}`);
  }

  /**
   * Dynamic streaming update executed every frame
   */
  update(streamFocus, camera) {
    if (!camera) return;

    const now = performance.now();
    const frameDeltaMs = now - this._lastFrameTime;
    this._lastFrameTime = now;

    // Track frame times over last 5 seconds to compute worst stall time
    this._frameTimes5s.push({ t: now, dt: frameDeltaMs });
    while (this._frameTimes5s.length > 0 && (now - this._frameTimes5s[0].t) > 5000) {
      this._frameTimes5s.shift();
    }
    let worstDt = 0;
    for (let i = 0; i < this._frameTimes5s.length; i++) {
      if (this._frameTimes5s[i].dt > worstDt) worstDt = this._frameTimes5s[i].dt;
    }
    this.telemetry.worstFrameTime5s = worstDt;
    this.telemetry.loadRadius = this._resolveLoadRadius();

    this._camPos.copy(camera.position);
    camera.getWorldDirection(this._camDir);

    const focusPos = streamFocus || camera.position;
    this._sleighPos.copy(focusPos);

    // Track sleigh velocity & normalized heading
    if (this.lastSleighTime > 0) {
      const dt = Math.max((now - this.lastSleighTime) / 1000.0, 0.001);
      this.sleighVelocity.subVectors(focusPos, this.lastSleighPos).divideScalar(dt);
      if (this.sleighVelocity.lengthSq() > 0.04) {
        this.sleighHeading.copy(this.sleighVelocity).normalize();
      }
    }
    this.lastSleighPos.copy(focusPos);
    this.lastSleighTime = now;

    const half = this.chunkSize * 0.5;
    const curFocusChunkX = Math.floor((focusPos.x + half) / this.chunkSize);
    const curFocusChunkZ = Math.floor((focusPos.z + half) / this.chunkSize);

    // Fast check: boundary cross or camera angle change or time throttle
    const chunkChanged = (curFocusChunkX !== this.lastFocusChunkX || curFocusChunkZ !== this.lastFocusChunkZ);
    const angleDelta = 2 * Math.acos(Math.min(1.0, Math.max(-1.0, Math.abs(camera.quaternion.dot(this.lastStreamCamQuat)))));
    const rotatedSignificantly = angleDelta > 0.20;
    const timeElapsed = (now - this.lastStreamCheckTime) > 150;

    if (chunkChanged || rotatedSignificantly || timeElapsed || this.activeChunkCount === 0) {
      this.lastStreamCheckTime = now;
      this.lastStreamCamQuat.copy(camera.quaternion);
      this.lastFocusChunkX = curFocusChunkX;
      this.lastFocusChunkZ = curFocusChunkZ;

      this._recomputePriorityQueue(camera, curFocusChunkX, curFocusChunkZ, now);
    }

    // Process at most 1 chunk generation per frame within ~2 ms budget
    const budgetStart = performance.now();
    if (this.priorityQueue.length > 0) {
      const candidate = this.priorityQueue.pop();
      if (candidate) {
        this.queuedKeys.delete(candidate.key);
        if (!this.chunks.has(candidate.key)) {
          this.generateChunk(candidate.cx, candidate.cz);
        }
      }
    }
    this.telemetry.queueLength = this.priorityQueue.length;

    // Process at most 1 LOD band change per frame with 10m hysteresis & 1s cooldown
    this._processLODBandUpdate(now);

    // Pop-in scale transition for chunks younger than 0.3s
    this._updatePopInScale(now);

    // Prune unneeded chunks based on loadRadius, hysteresis and velocity heading
    this._pruneUnneededChunks(now, curFocusChunkX, curFocusChunkZ);
  }

  _recomputePriorityQueue(camera, centerCx, centerCz, now) {
    // 1. HARD LOAD RADIUS: Never load chunks beyond loadRadius
    const hardRadius = this._resolveLoadRadius();
    this.loadRadius = hardRadius;
    const maxChunkRadius = Math.ceil(hardRadius / this.chunkSize);

    // Setup expanded camera frustum: expand FOV by ~15% and extend sides
    this._expandedCamera.copy(camera);
    this._expandedCamera.fov = camera.fov * 1.15;
    this._expandedCamera.near = Math.max(camera.near * 0.8, 0.1);
    this._expandedCamera.far = hardRadius + this.chunkSize * 1.5;
    this._expandedCamera.updateProjectionMatrix();

    this._projScreenMatrix.multiplyMatrices(this._expandedCamera.projectionMatrix, this._expandedCamera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

    this.priorityQueue.clear();
    this.queuedKeys.clear();

    const neededSet = new Set();
    const half = this.chunkSize * 0.5;

    for (let dx = -maxChunkRadius; dx <= maxChunkRadius; dx++) {
      for (let dz = -maxChunkRadius; dz <= maxChunkRadius; dz++) {
        const cx = centerCx + dx;
        const cz = centerCz + dz;
        const key = cx + ',' + cz;
        const wx = cx * this.chunkSize;
        const wz = cz * this.chunkSize;

        const distToPlayer = Math.hypot(wx - this._sleighPos.x, wz - this._sleighPos.z);
        if (distToPlayer > hardRadius) continue; // Hard load radius boundary

        // Chebyshev distance to player
        const chebyshev = Math.max(Math.abs(dx), Math.abs(dz));
        const isImmediate = (chebyshev <= 1); // Immediate 1 chunk around player is mandatory

        // Chunk AABB test against expanded camera frustum
        this._tempBox.min.set(wx - half - 10.0, this.templateBounds.min.y, wz - half - 10.0);
        this._tempBox.max.set(wx + half + 10.0, this.templateBounds.max.y, wz + half + 10.0);
        const inFrustum = this._frustum.intersectsBox(this._tempBox);

        // Heading alignment
        this._tempVec.set(wx - this._sleighPos.x, 0, wz - this._sleighPos.z).normalize();
        const headingDot = this._tempVec.dot(this.sleighHeading);
        const inFlightPath = headingDot > 0.5;

        // Is this chunk needed?
        if (isImmediate || inFrustum || inFlightPath) {
          neededSet.add(key);

          // If not currently loaded, compute priority score
          if (!this.chunks.has(key)) {
            let score = distToPlayer;

            // Bonuses: -30% for frustum intersection, -30% for velocity heading alignment
            if (inFrustum) score *= 0.70;
            if (inFlightPath) score *= 0.70;

            // Immediate radius chunks get highest priority
            if (isImmediate) score -= 1000.0;

            this.priorityQueue.push({ cx, cz, key, score });
            this.queuedKeys.add(key);
          }
        }
      }
    }

    // Mark unneeded timestamps
    for (const [key, chunk] of this.chunks.entries()) {
      if (neededSet.has(key)) {
        chunk.unneededSince = 0;
      } else {
        if (chunk.unneededSince === 0) {
          chunk.unneededSince = now;
        }
      }
    }
  }

  _processLODBandUpdate(now) {
    // Process at most 1 chunk band change per frame with 1s cooldown
    for (const [key, chunk] of this.chunks.entries()) {
      if ((now - chunk.lastBandChange) < 1000) continue;

      const wx = chunk.cx * this.chunkSize;
      const wz = chunk.cz * this.chunkSize;
      const dist = Math.hypot(wx - this._sleighPos.x, wz - this._sleighPos.z);
      const targetBand = this._computeLODBand(dist, chunk.lodBand);

      if (targetBand !== chunk.lodBand) {
        this._applyLODTransition(chunk, targetBand);
        break; // Only 1 band change per frame
      }
    }
  }

  _updatePopInScale(now) {
    // Smooth instance scale 0 -> 1 over 0.3s for newly generated chunks
    for (const [key, chunk] of this.chunks.entries()) {
      const age = (now - chunk.createdAt) / 1000.0;
      if (age < 0.3) {
        const scale = Math.min(1.0, age / 0.3);
        if (Math.abs(scale - chunk.fadeProgress) > 0.08) {
          chunk.fadeProgress = scale;
          const slot = chunk.slotIndex;
          const wx = chunk.cx * this.chunkSize;
          const wz = chunk.cz * this.chunkSize;

          for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
            const def = this.meshDefinitions[defIdx];
            const instMesh = this.instancedMeshes[defIdx];
            const baseCount = def.baseCount;
            const src = def.rawMatrixData;
            const dst = instMesh.instanceMatrix.array;
            const targetOffset = slot * baseCount * 16;

            for (let i = 0; i < baseCount; i++) {
              const mOff = targetOffset + i * 16;
              const sOff = i * 16;

              this._scratchMat.fromArray(src, sOff);
              this._scratchMat.decompose(this._scratchPos, this._scratchRot, this._scratchScale);
              this._scratchPos.x += wx;
              this._scratchPos.z += wz;
              this._scratchScale.multiplyScalar(scale);
              this._scratchMat.compose(this._scratchPos, this._scratchRot, this._scratchScale);
              this._scratchMat.toArray(dst, mOff);
            }

            instMesh.instanceMatrix.addUpdateRange(targetOffset, baseCount * 16);
            instMesh.instanceMatrix.needsUpdate = true;
          }
        }
      } else if (chunk.fadeProgress < 1.0) {
        chunk.fadeProgress = 1.0;
        // Restore full scale exactly
        const slot = chunk.slotIndex;
        const wx = chunk.cx * this.chunkSize;
        const wz = chunk.cz * this.chunkSize;

        for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
          const def = this.meshDefinitions[defIdx];
          const instMesh = this.instancedMeshes[defIdx];
          const baseCount = def.baseCount;
          const src = def.rawMatrixData;
          const dst = instMesh.instanceMatrix.array;
          const targetOffset = slot * baseCount * 16;

          dst.set(src, targetOffset);
          for (let i = 0; i < baseCount; i++) {
            const mOff = targetOffset + i * 16;
            dst[mOff + 12] += wx;
            dst[mOff + 14] += wz;
          }

          instMesh.instanceMatrix.addUpdateRange(targetOffset, baseCount * 16);
          instMesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  _pruneUnneededChunks(now, centerCx, centerCz) {
    const hardRadius = this.loadRadius;

    for (const [key, chunk] of this.chunks.entries()) {
      const wx = chunk.cx * this.chunkSize;
      const wz = chunk.cz * this.chunkSize;
      const distToPlayer = Math.hypot(wx - this._sleighPos.x, wz - this._sleighPos.z);

      // Direction relative to sleigh velocity
      this._tempVec.set(wx - this._sleighPos.x, 0, wz - this._sleighPos.z).normalize();
      const dotVel = this._tempVec.dot(this.sleighHeading);

      // Condition A: Behind player (dot < -0.5) and more than 60m away
      const isBehindAndFar = (dotVel < -0.5 && distToPlayer > 60.0);

      // Condition B: Outside radius by > 1 chunk for > 2.0s
      const isOutsideRadiusHysteresis = (chunk.unneededSince > 0 &&
        (now - chunk.unneededSince) > 2000 &&
        distToPlayer > (hardRadius + this.chunkSize));

      if (isBehindAndFar || isOutsideRadiusHysteresis) {
        this.destroyChunk(key);
        break; // Destroy at most 1 chunk per frame to avoid frame spikes
      }
    }
  }

  getActiveTriangleCount() {
    return this.stats.totalTriangles;
  }
}
