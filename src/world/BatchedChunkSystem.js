import * as THREE from 'three';
import { ChunkScheduler } from './ChunkScheduler.js';
import { MobileFog } from './MobileFog.js';

export const USE_LEGACY = typeof window !== 'undefined' && window.location.search.includes('legacy=1');

const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const chunkParam = parseInt(urlParams.get('chunks'), 10);
export const MOBILE_MAX_CHUNKS = (!isNaN(chunkParam) && chunkParam > 0) ? Math.min(6, chunkParam) : 6;
export const DESKTOP_MAX_CHUNKS = (!isNaN(chunkParam) && chunkParam > 0) ? chunkParam : 16;

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
 * 1. CHUNK STREAMING: Single-slot InstancedMesh per mesh definition with full original geometry.
 * 2. MOBILE CHUNK SCHEDULER: Priority scoring, directional lookahead, eviction thrash protection, and hard chunk cap.
 * 3. SHADOW PASS: Controlled shadow casting on mobile with optional full shadows flag.
 * 4. CHUNK GENERATION TIME BUDGET: Smooth chunk generation with per-frame time budgeting.
 * 5. HUD TELEMETRY: Real-time display of loaded chunks, triangles, draw calls, and frame times.
 */
export class BatchedChunkSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.chunkSize = 20.0;
    this.isMobile = options.isMobile ?? false;
    this.maxLoadedChunks = options.maxLoadedChunks || (this.isMobile ? MOBILE_MAX_CHUNKS : DESKTOP_MAX_CHUNKS);

    this.mobileFog = this.isMobile ? new MobileFog(this.scene, { isMobile: true }) : null;
    this.scheduler = this.isMobile ? new ChunkScheduler(this, { isMobile: true, maxChunks: MOBILE_MAX_CHUNKS }) : null;
    this.trianglesPerChunk = 0;
    this.capViolations = 0;

    // 1. Load radius: matches scheduler region on mobile (~45m), 110m on desktop
    this.nominalLoadRadius = this.isMobile ? 45.0 : 110.0;
    this.loadRadius = this.nominalLoadRadius;


    this.shadowCasterDistance = this.isMobile ? 25.0 : 56.0;

    // Active loaded chunks: Map of key ("cx,cz") -> ChunkRecord
    this.chunks = new Map();
    // Single slot array: chunkSlots[slotIndex] -> ChunkRecord
    this.chunkSlots = new Array(this.maxLoadedChunks).fill(null);
    this.activeChunkCount = 0;

    // Reusable chunk records pool
    this.chunkPool = [];

    // Template data extracted from terrain.glb
    this.meshDefinitions = [];
    this.templateHouseColliders = [];
    this.sharedMaterials = new Map();
    this.heightGridSize = 65;
    this.heightGrid = null;
    this.edgeHeight = 0.160;
    this.templateBounds = new THREE.Box3();

    // World render group
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

    // Scratchpad
    this._scratchMat = new THREE.Matrix4();
    this._scratchPos = new THREE.Vector3();
    this._scratchRot = new THREE.Quaternion();
    this._scratchScale = new THREE.Vector3();

    // Telemetry & Live HUD metrics
    this.telemetry = {
      loadedChunks: 0,
      queueLength: 0,
      lastGenDurationMs: 0,
      worstFrameTime5s: 0,
      loadRadius: this.loadRadius,
      mainTriangles: 0,
      shadowTriangles: 0,
      totalTriangles: 0
    };
    this._frameTimeRing = new Float32Array(360);
    this._frameTimeRingIdx = 0;
    this._frameTimeRingCount = 0;
    this._lastFrameTime = performance.now();
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

  initFromGLTF(gltfRoot) {
    this.meshDefinitions = [];
    this.templateHouseColliders = [];
    this.chunks.clear();
    this.chunkSlots.fill(null);
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

      const rawMatrixData = new Float32Array(matrices.length * 16);
      for (let i = 0; i < matrices.length; i++) {
        matrices[i].toArray(rawMatrixData, i * 16);
      }

      const triCount = Math.round(child.geometry.index ? child.geometry.index.count / 3 : child.geometry.attributes.position.count / 3);

      const refInstMesh = new THREE.InstancedMesh(child.geometry, child.material, matrices.length);
      refInstMesh.name = 'Ref_' + (child.name || 'Mesh');
      refInstMesh.visible = false;

      this.meshDefinitions.push({
        name: child.name,
        geometry: child.geometry,
        instMesh: refInstMesh,
        material: child.material,
        baseMatrices: matrices,
        rawMatrixData,
        baseCount: matrices.length,
        category,
        isHouse,
        isFoliage,
        isCliff,
        castShadow: isProminentCaster,
        receiveShadow: !matName.includes('ice'),
        triangles: triCount
      });
    });

    if (this.templateBounds.isEmpty()) {
      this.templateBounds.min.set(-10, -2, -10);
      this.templateBounds.max.set(10, 18, 10);
    } else {
      this.templateBounds.min.y = Math.min(this.templateBounds.min.y, -2.0);
      this.templateBounds.max.y = Math.max(this.templateBounds.max.y, 18.0);
    }

    this.buildHeightGrid(gltfRoot);

    // Build the InstancedMeshes
    this.createGlobalInstancedMeshes();

    this.trianglesPerChunk = this.meshDefinitions.reduce((sum, def) => sum + def.baseCount * def.triangles, 0);
    console.log(`[BatchedChunkSystem] Loaded ${window._loadedModelName || "terrain.glb"}: ${this.trianglesPerChunk.toLocaleString()} triangles per chunk`);
  }

  createGlobalInstancedMeshes() {
    // Clear old meshes
    this.instancedMeshes.forEach(im => {
      this.worldGroup.remove(im);
      if (im.dispose) im.dispose();
    });
    this.instancedMeshes = [];

    const fullShadows = urlParams.get('shadows') === 'full';

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const maxInstances = def.baseCount * this.maxLoadedChunks;

      const instMesh = new THREE.InstancedMesh(def.geometry, def.material, maxInstances);
      instMesh.name = `Global_${def.name}`;

      if (this.isMobile) {
        const isTreeOrHouse = (def.category === 'house' || def.category === 'foliage');
        instMesh.castShadow = fullShadows ? def.castShadow : (def.castShadow && !isTreeOrHouse);
      } else {
        instMesh.castShadow = def.castShadow;
      }
      instMesh.receiveShadow = def.receiveShadow;
      instMesh.frustumCulled = false;
      instMesh.count = 0;
      instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      instMesh.userData = {
        defIndex: defIdx,
        defName: def.name,
        category: def.category,
        baseCount: def.baseCount,
        triPerInst: def.triangles
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
        unneededSince: 0,
        createdAt: 0,
        lastBandChange: 0,
        fadeProgress: 0,
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
    chunk.lastBandChange = performance.now();
    chunk.fadeProgress = 0;

    const wx = cx * this.chunkSize;
    const wz = cz * this.chunkSize;

    chunk.aabb.min.set(wx - 10.0, this.templateBounds.min.y, wz - 10.0);
    chunk.aabb.max.set(wx + 10.0, this.templateBounds.max.y, wz + 10.0);

    const houseCount = this.templateHouseColliders.length;
    // Ensure chunk.houseColliders has enough pooled Box3 instances
    while (chunk.houseColliders.length < houseCount) {
      chunk.houseColliders.push(new THREE.Box3());
    }
    chunk.houseColliders.length = houseCount;

    for (let i = 0; i < houseCount; i++) {
      const srcBox = this.templateHouseColliders[i];
      const b = chunk.houseColliders[i];
      b.min.x = srcBox.min.x + wx;
      b.min.y = srcBox.min.y;
      b.min.z = srcBox.min.z + wz;
      b.max.x = srcBox.max.x + wx;
      b.max.y = srcBox.max.y;
      b.max.z = srcBox.max.z + wz;
    }

    return chunk;
  }

  _releaseChunkRecord(chunk) {
    chunk.unneededSince = 0;
    this.chunkPool.push(chunk);
  }

  /**
   * Writes a chunk's instance matrices into the specified buffer slot
   */
  _writeChunkBlock(chunk, slotIndex) {
    const wx = chunk.cx * this.chunkSize;
    const wz = chunk.cz * this.chunkSize;

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshes[defIdx];
      const baseCount = def.baseCount;
      const src = def.rawMatrixData;
      const dst = instMesh.instanceMatrix.array;
      const targetOffset = slotIndex * baseCount * 16;
      const elementsToCopy = baseCount * 16;

      dst.set(src, targetOffset);
      for (let i = 0; i < baseCount; i++) {
        const matOffset = targetOffset + i * 16;
        dst[matOffset + 12] += wx;
        dst[matOffset + 14] += wz;
      }

      instMesh.instanceMatrix.addUpdateRange(targetOffset, elementsToCopy);
      instMesh.instanceMatrix.needsUpdate = true;
    }
  }

  _swapRemoveChunkBlock(freedSlot) {
    const lastSlot = this.activeChunkCount - 1;

    if (freedSlot < lastSlot) {
      const movingChunk = this.chunkSlots[lastSlot];

      for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
        const def = this.meshDefinitions[defIdx];
        const instMesh = this.instancedMeshes[defIdx];
        const baseCount = def.baseCount;
        const buf = instMesh.instanceMatrix.array;

        const srcOffset = lastSlot * baseCount * 16;
        const dstOffset = freedSlot * baseCount * 16;
        const elementsToCopy = baseCount * 16;

        buf.copyWithin(dstOffset, srcOffset, srcOffset + elementsToCopy);
        instMesh.instanceMatrix.addUpdateRange(dstOffset, elementsToCopy);
        instMesh.instanceMatrix.needsUpdate = true;
      }

      movingChunk.slotIndex = freedSlot;
      this.chunkSlots[freedSlot] = movingChunk;
    }

    this.chunkSlots[lastSlot] = null;
    this.activeChunkCount--;

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshes[defIdx];
      instMesh.count = this.activeChunkCount * def.baseCount;
    }
  }

  generateChunk(cx, cz) {
    const key = cx + ',' + cz;
    if (this.chunks.has(key)) return;

    if (this.isMobile && this.chunks.size >= MOBILE_MAX_CHUNKS) {
      if (this.scheduler && this.scheduler.evictLowestPriority) {
        this.scheduler.evictLowestPriority();
      }
      if (this.chunks.size >= MOBILE_MAX_CHUNKS) {
        this.capViolations++;
        console.error(`[BatchedChunkSystem] Refusing to generate ${key}: Cap reached (${this.chunks.size}/${MOBILE_MAX_CHUNKS})`);
        return;
      }
    }

    const tStart = performance.now();
    const slot = this.activeChunkCount;
    if (slot >= this.maxLoadedChunks) {
      console.warn(`[BatchedChunkSystem] Buffer cap reached (${this.maxLoadedChunks}). Cannot generate ${key}`);
      return;
    }

    this.activeChunkCount++;

    const chunk = this._acquireChunkRecord(cx, cz);
    chunk.slotIndex = slot;
    chunk.createdAt = performance.now();
    this.chunks.set(key, chunk);
    this.chunkSlots[slot] = chunk;

    if (this.isMobile && this.chunks.size > MOBILE_MAX_CHUNKS) {
      this.capViolations++;
      console.error(`[BatchedChunkSystem] Cap violated! chunks.size=${this.chunks.size} > ${MOBILE_MAX_CHUNKS}`);
    }

    this._writeChunkBlock(chunk, slot);

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshes[defIdx];
      instMesh.count = this.activeChunkCount * def.baseCount;
    }

    if (window.deliverySystem && window.deliverySystem.syncChunkTargets) {
      window.deliverySystem.syncChunkTargets(key, cx, cz);
    }

    this._updateBoundsAndStats();
    this.telemetry.lastGenDurationMs = performance.now() - tStart;
  }

  destroyChunk(key) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    const freedSlot = chunk.slotIndex;
    this._swapRemoveChunkBlock(freedSlot);
    this.chunks.delete(key);

    if (window.deliverySystem && window.deliverySystem.unloadChunkTargets) {
      window.deliverySystem.unloadChunkTargets(key);
    }

    this._updateBoundsAndStats();
    this._releaseChunkRecord(chunk);
  }

  _updateBoundsAndStats() {
    let mainTris = 0;
    let shadowTris = 0;

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshes[defIdx];
      if (!instMesh) continue;
      const count = instMesh.count;
      const triPerInst = def.triangles;
      const totalTrisForMesh = count * triPerInst;

      mainTris += totalTrisForMesh;

      if (this.isMobile) {
        if (def.castShadow) {
          const isTreeOrHouse = (def.category === 'house' || def.category === 'foliage');
          const casts = (urlParams.get('shadows') === 'full') || !isTreeOrHouse;
          if (casts) {
            const castersIn25m = Math.min(count, def.baseCount * 5);
            shadowTris += castersIn25m * triPerInst;
          }
        }
      } else {
        if (def.castShadow) {
          shadowTris += count * triPerInst;
        }
      }
    }

    this.telemetry.loadedChunks = this.chunks.size;
    this.telemetry.mainTriangles = mainTris;
    this.telemetry.shadowTriangles = shadowTris;
    this.telemetry.totalTriangles = mainTris + shadowTris;
    this.telemetry.loadRadius = this.loadRadius;
  }

  update(streamFocus, camera) {
    if (!camera) return;

    const now = performance.now();
    const frameDeltaMs = now - this._lastFrameTime;
    this._lastFrameTime = now;

    this._frameTimeRing[this._frameTimeRingIdx] = frameDeltaMs;
    this._frameTimeRingIdx = (this._frameTimeRingIdx + 1) % 360;
    if (this._frameTimeRingCount < 360) {
      this._frameTimeRingCount++;
    }

    let worstDt = 0;
    const ringCount = this._frameTimeRingCount;
    for (let i = 0; i < ringCount; i++) {
      const dt = this._frameTimeRing[i];
      if (dt > worstDt) worstDt = dt;
    }
    this.telemetry.worstFrameTime5s = worstDt;

    this._camPos.copy(camera.position);
    camera.getWorldDirection(this._camDir);

    const focusPos = streamFocus || camera.position;
    this._sleighPos.copy(focusPos);

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

    const chunkChanged = (curFocusChunkX !== this.lastFocusChunkX || curFocusChunkZ !== this.lastFocusChunkZ);
    const angleDelta = 2 * Math.acos(Math.min(1.0, Math.max(-1.0, Math.abs(camera.quaternion.dot(this.lastStreamCamQuat)))));
    const rotatedSignificantly = angleDelta > 0.20;
    const timeElapsed = (now - this.lastStreamCheckTime) > 150;

    if (!this.scheduler || this.scheduler.disabled) {
      if (chunkChanged || rotatedSignificantly || timeElapsed || this.chunks.size === 0) {
        this.lastStreamCheckTime = now;
        this.lastStreamCamQuat.copy(camera.quaternion);
        this.lastFocusChunkX = curFocusChunkX;
        this.lastFocusChunkZ = curFocusChunkZ;

        this._recomputePriorityQueue(camera, curFocusChunkX, curFocusChunkZ, now);
      }
    }

    if (this.mobileFog) {
      this.mobileFog.update(frameDeltaMs / 1000.0, camera, this.chunks, this.chunkSize);
    }
    
    // 3. On mobile with the scheduler active, the old priority queue and old radius-based loading must NEVER run
    if (this.scheduler && !this.scheduler.disabled) {
      this.scheduler.update(this._sleighPos, camera, now, frameDeltaMs, this.mobileFog);
      return; // Return unconditionally when scheduler is active!
    }

    // 6. CHUNK GENERATION (only runs when scheduler is disabled or on desktop):
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

    // Prune unneeded chunks
    this._pruneUnneededChunks(now, curFocusChunkX, curFocusChunkZ);
  }

  _recomputePriorityQueue(camera, centerCx, centerCz, now) {
    const hardRadius = this.loadRadius;
    const maxChunkRadius = Math.ceil(hardRadius / this.chunkSize);

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
        if (distToPlayer > hardRadius) continue;

        const chebyshev = Math.max(Math.abs(dx), Math.abs(dz));
        const isImmediate = (chebyshev <= 1);

        this._tempBox.min.set(wx - half - 10.0, this.templateBounds.min.y, wz - half - 10.0);
        this._tempBox.max.set(wx + half + 10.0, this.templateBounds.max.y, wz + half + 10.0);
        const inFrustum = this._frustum.intersectsBox(this._tempBox);

        this._tempVec.set(wx - this._sleighPos.x, 0, wz - this._sleighPos.z).normalize();
        const headingDot = this._tempVec.dot(this.sleighHeading);
        const inFlightPath = headingDot > 0.5;

        if (isImmediate || inFrustum || inFlightPath) {
          neededSet.add(key);

          if (!this.chunks.has(key)) {
            let score = distToPlayer;
            if (inFrustum) score *= 0.70;
            if (inFlightPath) score *= 0.70;
            if (isImmediate) score -= 1000.0;

            this.priorityQueue.push({ cx, cz, key, score });
            this.queuedKeys.add(key);
          }
        }
      }
    }

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

  _pruneUnneededChunks(now, centerCx, centerCz) {
    const hardRadius = this.loadRadius;

    for (const [key, chunk] of this.chunks.entries()) {
      const wx = chunk.cx * this.chunkSize;
      const wz = chunk.cz * this.chunkSize;
      const distToPlayer = Math.hypot(wx - this._sleighPos.x, wz - this._sleighPos.z);

      this._tempVec.set(wx - this._sleighPos.x, 0, wz - this._sleighPos.z).normalize();
      const dotVel = this._tempVec.dot(this.sleighHeading);

      const isBehindAndFar = (dotVel < -0.5 && distToPlayer > 60.0);
      const isOutsideRadiusHysteresis = (chunk.unneededSince > 0 &&
        (now - chunk.unneededSince) > 2000 &&
        distToPlayer > (hardRadius + this.chunkSize));

      if (isBehindAndFar || isOutsideRadiusHysteresis) {
        this.destroyChunk(key);
        break;
      }
    }
  }

  getActiveTriangleCount() {
    return this.telemetry.totalTriangles;
  }
}
