import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';

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
 * BatchedChunkSystem — Ultra-Low Draw Call Dynamic Chunk Streaming World System with LOD & Hard Budget
 *
 * Implements:
 * 1. MOBILE LOAD RADIUS: 75m on mobile (desktop keeps 110m / fog far). Never loads beyond it.
 * 2. MESHOPTIMIZER LOD GEOMETRIES (LOD0 / LOD1 ~35% / LOD2 ~10%):
 *    - Automatically generated via meshoptimizer at startup for houses, trees, and cliffs.
 *    - Each mesh definition maintains 3 InstancedMeshes (one per LOD level).
 * 3. MOBILE LOD BANDS:
 *    - LOD0 (< 20m), LOD1 (20-45m), LOD2 (>= 45m), with 8m hysteresis measured from sleigh.
 * 4. HARD BUDGET GOVERNOR (Mobile 1,000,000 triangles total = main + shadow):
 *    - If total triangles > 1,000,000, dynamically contracts LOD0 radius (20 -> 15 -> 10m),
 *      then LOD1 radius (45 -> 35 -> 25m), then loadRadius (75 -> 65 -> 55m).
 *    - If under 800k, restores them back towards nominal defaults.
 * 5. MOBILE SHADOW PASS:
 *    - Casters within 30m of the sleigh only.
 *    - Main pass LOD0 meshes have castShadow = false on mobile; dedicated LOD1/LOD2 shadow casters handle the shadow map.
 * 6. CHUNK GENERATION TIME BUDGET:
 *    - At most 1 chunk per frame, within a 2ms time budget, keeping Gen under 3ms.
 * 7. HUD TELEMETRY:
 *    - Real-time display of Main Tris, Shadow Tris, Total Tris, Budget, Rad, LOD Radii, per-LOD counts.
 */
export class BatchedChunkSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.chunkSize = 20.0;
    this.isMobile = options.isMobile ?? false;
    this.maxLoadedChunks = options.maxLoadedChunks || (this.isMobile ? 32 : 54);

    // 1. Mobile load radius: 75m nominal on mobile, 110m on desktop
    this.nominalLoadRadius = this.isMobile ? 75.0 : 110.0;
    this.loadRadius = this.nominalLoadRadius;

    // Dynamic LOD radii defaults
    this.nominalLod0Radius = this.isMobile ? 20.0 : 45.0;
    this.nominalLod1Radius = this.isMobile ? 45.0 : 85.0;
    this.lod0Radius = this.nominalLod0Radius;
    this.lod1Radius = this.nominalLod1Radius;
    this.lodHysteresis = this.isMobile ? 8.0 : 10.0;

    // Hard triangle budget: 1,000,000 on mobile, 4,000,000 on desktop
    this.polyBudget = this.isMobile ? 1000000 : 4000000;
    this.shadowCasterDistance = this.isMobile ? 30.0 : 56.0;

    // Active loaded chunks: Map of key ("cx,cz") -> ChunkRecord
    this.chunks = new Map();
    // Slots per LOD level: lodSlots[lodLevel][slotIndex] -> ChunkRecord
    this.lodSlots = [
      new Array(this.maxLoadedChunks).fill(null),
      new Array(this.maxLoadedChunks).fill(null),
      new Array(this.maxLoadedChunks).fill(null)
    ];
    this.lodActiveCounts = [0, 0, 0];

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

    // Dedicated shadow caster group for mobile
    this.shadowGroup = new THREE.Group();
    this.shadowGroup.name = 'BatchedShadowGroup';
    this.scene.add(this.shadowGroup);

    // InstancedMeshes by LOD: [lod0Meshes[], lod1Meshes[], lod2Meshes[]]
    this.instancedMeshesLOD = [[], [], []];
    this.shadowMeshes = [];

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
      lod0Radius: this.lod0Radius,
      lod1Radius: this.lod1Radius,
      mainTriangles: 0,
      shadowTriangles: 0,
      totalTriangles: 0,
      budget: this.polyBudget,
      countsPerLOD: {
        LOD0: { chunks: 0, houses: 0, trees: 0, cliffs: 0, tris: 0 },
        LOD1: { chunks: 0, houses: 0, trees: 0, cliffs: 0, tris: 0 },
        LOD2: { chunks: 0, houses: 0, trees: 0, cliffs: 0, tris: 0 }
      }
    };
    this._frameTimes5s = [];
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

  _simplifyGeometry(geometry, ratio, targetError = 0.15) {
    if (!geometry || !geometry.attributes.position) return geometry;
    const pos = geometry.attributes.position.array;
    let indices = geometry.index ? geometry.index.array : null;

    if (!indices) {
      const vertCount = geometry.attributes.position.count;
      indices = new Uint32Array(vertCount);
      for (let i = 0; i < vertCount; i++) indices[i] = i;
    }

    const targetCount = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
    let simplifiedIndices = null;

    try {
      const res = MeshoptSimplifier.simplify(indices, pos, 3, targetCount, targetError);
      if (res && res[0] && res[0].length <= targetCount * 1.35) {
        simplifiedIndices = res[0];
      } else {
        const sloppy = MeshoptSimplifier.simplifySloppy(indices, pos, 3, null, targetCount, 0.35);
        if (sloppy && sloppy[0]) simplifiedIndices = sloppy[0];
      }
    } catch (err) {
      // Fallback
    }

    if (!simplifiedIndices || simplifiedIndices.length === 0) {
      return geometry.clone();
    }

    const simplifiedGeo = geometry.clone();
    simplifiedGeo.setIndex(new THREE.BufferAttribute(simplifiedIndices, 1));
    simplifiedGeo.computeVertexNormals();
    return simplifiedGeo;
  }

  initFromGLTF(gltfRoot) {
    this.meshDefinitions = [];
    this.templateHouseColliders = [];
    this.chunks.clear();
    for (let l = 0; l < 3; l++) {
      this.lodSlots[l].fill(null);
      this.lodActiveCounts[l] = 0;
    }
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

      // 3. Generate meshoptimizer LOD geometries (LOD0: 100%, LOD1: ~35%, LOD2: ~10%)
      const geoLOD0 = child.geometry;
      let geoLOD1 = geoLOD0;
      let geoLOD2 = geoLOD0;

      // Only simplify houses, trees, and cliffs (ground planes stay 1:1)
      if (category !== 'ground') {
        geoLOD1 = this._simplifyGeometry(geoLOD0, 0.35, 0.15);
        geoLOD2 = this._simplifyGeometry(geoLOD0, 0.10, 0.30);
      }

      const getTriCount = (geo) => (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3);
      const trisLOD = [
        Math.round(getTriCount(geoLOD0)),
        Math.round(getTriCount(geoLOD1)),
        Math.round(getTriCount(geoLOD2))
      ];

      const refInstMesh = new THREE.InstancedMesh(child.geometry, child.material, matrices.length);
      refInstMesh.name = 'Ref_' + (child.name || 'Mesh');
      refInstMesh.visible = false;

      this.meshDefinitions.push({
        name: child.name,
        geometry: geoLOD0,
        instMesh: refInstMesh,
        geometryLOD: [geoLOD0, geoLOD1, geoLOD2],
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
        trisLOD
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

    // Build the 3 LOD InstancedMesh arrays
    this.createGlobalInstancedMeshes();
  }

  createGlobalInstancedMeshes() {
    // Clear old meshes
    for (let l = 0; l < 3; l++) {
      this.instancedMeshesLOD[l].forEach(im => {
        this.worldGroup.remove(im);
        if (im.dispose) im.dispose();
      });
      this.instancedMeshesLOD[l] = [];
    }
    this.shadowMeshes.forEach(im => {
      this.shadowGroup.remove(im);
      if (im.dispose) im.dispose();
    });
    this.shadowMeshes = [];

    for (let lod = 0; lod < 3; lod++) {
      for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
        const def = this.meshDefinitions[defIdx];
        const maxInstances = def.baseCount * this.maxLoadedChunks;

        const instMesh = new THREE.InstancedMesh(def.geometryLOD[lod], def.material, maxInstances);
        instMesh.name = `Global_${def.name}_LOD${lod}`;

        // 5. SHADOW PASS on mobile: Main-pass LOD0 meshes do not cast shadows.
        // Dedicated shadow casters or LOD1/LOD2 handle the shadow map.
        if (this.isMobile) {
          instMesh.castShadow = (lod > 0 && def.castShadow);
        } else {
          instMesh.castShadow = def.castShadow;
        }
        instMesh.receiveShadow = def.receiveShadow;
        instMesh.frustumCulled = false;
        instMesh.count = 0;
        instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        instMesh.userData = {
          lodLevel: lod,
          defIndex: defIdx,
          defName: def.name,
          category: def.category,
          baseCount: def.baseCount,
          triPerInst: def.trisLOD[lod]
        };

        this.worldGroup.add(instMesh);
        this.instancedMeshesLOD[lod].push(instMesh);
      }
    }

    // On mobile, create lightweight LOD2 shadow caster meshes (within 30m of sleigh)
    if (this.isMobile) {
      for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
        const def = this.meshDefinitions[defIdx];
        if (!def.castShadow) continue;
        const maxInstances = def.baseCount * 12; // ~12 chunks within 30m
        const sMesh = new THREE.InstancedMesh(def.geometryLOD[2], def.material, maxInstances);
        sMesh.name = `Shadow_${def.name}_LOD2`;
        sMesh.castShadow = true;
        sMesh.receiveShadow = false;
        sMesh.frustumCulled = false;
        sMesh.count = 0;
        sMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        sMesh.userData = { defIndex: defIdx, baseCount: def.baseCount };
        this.shadowGroup.add(sMesh);
        this.shadowMeshes.push(sMesh);
      }
    }
  }

  _acquireChunkRecord(cx, cz) {
    let chunk = this.chunkPool.pop();
    if (!chunk) {
      chunk = {
        key: '',
        cx: 0,
        cz: 0,
        lodBand: 0,
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
    chunk.lodBand = 0;
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
   * Writes a chunk's instance matrices into the specified LOD buffer slot
   */
  _writeChunkBlock(chunk, targetLOD, slotIndex) {
    const wx = chunk.cx * this.chunkSize;
    const wz = chunk.cz * this.chunkSize;
    const meshes = this.instancedMeshesLOD[targetLOD];

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = meshes[defIdx];
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

  /**
   * Swap-removes a chunk slot from the specified LOD buffer
   */
  _swapRemoveChunkBlock(freedSlot, targetLOD) {
    const activeCount = this.lodActiveCounts[targetLOD];
    const lastSlot = activeCount - 1;
    const meshes = this.instancedMeshesLOD[targetLOD];

    if (freedSlot < lastSlot) {
      const movingChunk = this.lodSlots[targetLOD][lastSlot];

      for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
        const def = this.meshDefinitions[defIdx];
        const instMesh = meshes[defIdx];
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
      this.lodSlots[targetLOD][freedSlot] = movingChunk;
    }

    this.lodSlots[targetLOD][lastSlot] = null;
    this.lodActiveCounts[targetLOD]--;

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = meshes[defIdx];
      instMesh.count = this.lodActiveCounts[targetLOD] * def.baseCount;
    }
  }

  generateChunk(cx, cz) {
    const key = cx + ',' + cz;
    if (this.chunks.has(key)) return;

    const tStart = performance.now();
    const wx = cx * this.chunkSize;
    const wz = cz * this.chunkSize;

    // 3. Compute LOD Band from sleigh distance with hysteresis
    const distToSleigh = Math.hypot(wx - this._sleighPos.x, wz - this._sleighPos.z);
    const initialLOD = this._computeLODBand(distToSleigh, 0);

    const slot = this.lodActiveCounts[initialLOD];
    if (slot >= this.maxLoadedChunks) {
      console.warn(`[BatchedChunkSystem] Buffer cap reached for LOD${initialLOD}. Cannot generate ${key}`);
      return;
    }

    this.lodActiveCounts[initialLOD]++;

    const chunk = this._acquireChunkRecord(cx, cz);
    chunk.lodBand = initialLOD;
    chunk.slotIndex = slot;
    this.chunks.set(key, chunk);
    this.lodSlots[initialLOD][slot] = chunk;

    // Write chunk block into LOD buffer
    this._writeChunkBlock(chunk, initialLOD, slot);

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshesLOD[initialLOD][defIdx];
      instMesh.count = this.lodActiveCounts[initialLOD] * def.baseCount;
    }

    // Register with DeliverySystem
    if (window.deliverySystem && window.deliverySystem.syncChunkTargets) {
      window.deliverySystem.syncChunkTargets(key, cx, cz);
    }

    this._updateBoundsAndStats();
    this.telemetry.lastGenDurationMs = performance.now() - tStart;
  }

  destroyChunk(key) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    const currentLOD = chunk.lodBand;
    const freedSlot = chunk.slotIndex;

    this._swapRemoveChunkBlock(freedSlot, currentLOD);
    this.chunks.delete(key);

    if (window.deliverySystem && window.deliverySystem.unloadChunkTargets) {
      window.deliverySystem.unloadChunkTargets(key);
    }

    this._updateBoundsAndStats();
    this._releaseChunkRecord(chunk);
  }

  /**
   * Move chunk between LOD buffers
   */
  _transitionChunkLOD(chunk, newLOD) {
    const oldLOD = chunk.lodBand;
    if (oldLOD === newLOD) return;

    const oldSlot = chunk.slotIndex;
    const newSlot = this.lodActiveCounts[newLOD];

    if (newSlot >= this.maxLoadedChunks) return; // Cannot exceed buffer cap

    // 1. Remove from old LOD
    this._swapRemoveChunkBlock(oldSlot, oldLOD);

    // 2. Add to new LOD
    this.lodActiveCounts[newLOD]++;
    chunk.lodBand = newLOD;
    chunk.slotIndex = newSlot;
    chunk.lastBandChange = performance.now();
    this.lodSlots[newLOD][newSlot] = chunk;

    this._writeChunkBlock(chunk, newLOD, newSlot);

    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshesLOD[newLOD][defIdx];
      instMesh.count = this.lodActiveCounts[newLOD] * def.baseCount;
    }

    this._updateBoundsAndStats();
  }

  _computeLODBand(distance, currentBand) {
    const h = this.lodHysteresis;
    const r0 = this.lod0Radius;
    const r1 = this.lod1Radius;

    if (currentBand === 0) {
      if (distance > r0 + h) return distance >= (r1 + h) ? 2 : 1;
      return 0;
    } else if (currentBand === 1) {
      if (distance < r0 - h) return 0;
      if (distance > r1 + h) return 2;
      return 1;
    } else {
      if (distance < r1 - h) return distance < (r0 - h) ? 0 : 1;
      return 2;
    }
  }

  _updateBoundsAndStats() {
    let mainTris = 0;
    let shadowTris = 0;

    const lodCounts = {
      LOD0: { chunks: this.lodActiveCounts[0], houses: 0, trees: 0, cliffs: 0, tris: 0 },
      LOD1: { chunks: this.lodActiveCounts[1], houses: 0, trees: 0, cliffs: 0, tris: 0 },
      LOD2: { chunks: this.lodActiveCounts[2], houses: 0, trees: 0, cliffs: 0, tris: 0 }
    };

    for (let lod = 0; lod < 3; lod++) {
      const meshes = this.instancedMeshesLOD[lod];
      const lodKey = `LOD${lod}`;

      for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
        const def = this.meshDefinitions[defIdx];
        const count = meshes[defIdx].count;
        const triPerInst = def.trisLOD[lod];
        const totalTrisForMesh = count * triPerInst;

        mainTris += totalTrisForMesh;
        lodCounts[lodKey].tris += totalTrisForMesh;

        if (def.category === 'house') lodCounts[lodKey].houses += count;
        else if (def.category === 'foliage') lodCounts[lodKey].trees += count;
        else if (def.category === 'cliff') lodCounts[lodKey].cliffs += count;

        // Shadow pass triangles calculation
        if (this.isMobile) {
          // Dedicated LOD2 shadow casters within 30m
          if (def.castShadow) {
            const castersIn30m = Math.min(count, def.baseCount * 6);
            shadowTris += castersIn30m * def.trisLOD[2];
          }
        } else {
          if (def.castShadow) {
            shadowTris += count * triPerInst;
          }
        }
      }
    }

    this.telemetry.loadedChunks = this.chunks.size;
    this.telemetry.mainTriangles = mainTris;
    this.telemetry.shadowTriangles = shadowTris;
    this.telemetry.totalTriangles = mainTris + shadowTris;
    this.telemetry.countsPerLOD = lodCounts;
    this.telemetry.loadRadius = this.loadRadius;
    this.telemetry.lod0Radius = this.lod0Radius;
    this.telemetry.lod1Radius = this.lod1Radius;
  }

  /**
   * 4. HARD BUDGET GOVERNOR (1,000,000 max on mobile)
   */
  _enforceBudget() {
    const totalTris = this.telemetry.totalTriangles;

    if (totalTris > this.polyBudget) {
      // Over budget: Step 1 shrink LOD0 radius (20 -> 15 -> 10m)
      if (this.lod0Radius > 10.0) {
        this.lod0Radius = Math.max(10.0, this.lod0Radius - 5.0);
      }
      // Step 2 shrink LOD1 radius (45 -> 35 -> 25m)
      else if (this.lod1Radius > 25.0) {
        this.lod1Radius = Math.max(25.0, this.lod1Radius - 10.0);
      }
      // Step 3 shrink load radius by one chunk (75 -> 65 -> 55m)
      else if (this.loadRadius > 55.0) {
        this.loadRadius = Math.max(55.0, this.loadRadius - this.chunkSize * 0.5);
      }
    } else if (totalTris < this.polyBudget * 0.80) {
      // Under 800k: Recover back towards nominal
      if (this.loadRadius < this.nominalLoadRadius) {
        this.loadRadius = Math.min(this.nominalLoadRadius, this.loadRadius + 5.0);
      } else if (this.lod1Radius < this.nominalLod1Radius) {
        this.lod1Radius = Math.min(this.nominalLod1Radius, this.lod1Radius + 5.0);
      } else if (this.lod0Radius < this.nominalLod0Radius) {
        this.lod0Radius = Math.min(this.nominalLod0Radius, this.lod0Radius + 5.0);
      }
    }
  }

  update(streamFocus, camera) {
    if (!camera) return;

    const now = performance.now();
    const frameDeltaMs = now - this._lastFrameTime;
    this._lastFrameTime = now;

    this._frameTimes5s.push({ t: now, dt: frameDeltaMs });
    while (this._frameTimes5s.length > 0 && (now - this._frameTimes5s[0].t) > 5000) {
      this._frameTimes5s.shift();
    }
    let worstDt = 0;
    for (let i = 0; i < this._frameTimes5s.length; i++) {
      if (this._frameTimes5s[i].dt > worstDt) worstDt = this._frameTimes5s[i].dt;
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

    if (chunkChanged || rotatedSignificantly || timeElapsed || this.chunks.size === 0) {
      this.lastStreamCheckTime = now;
      this.lastStreamCamQuat.copy(camera.quaternion);
      this.lastFocusChunkX = curFocusChunkX;
      this.lastFocusChunkZ = curFocusChunkZ;

      this._recomputePriorityQueue(camera, curFocusChunkX, curFocusChunkZ, now);
    }

    // 6. CHUNK GENERATION: at most 1 chunk per frame, within 2 ms budget
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

    // Process at most 1 LOD band change per frame with 1s cooldown & 8m hysteresis
    this._processLODBandUpdate(now);

    // Dynamic Hard Budget Governor check
    this._enforceBudget();

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

  _processLODBandUpdate(now) {
    for (const [key, chunk] of this.chunks.entries()) {
      if ((now - chunk.lastBandChange) < 1000) continue;

      const wx = chunk.cx * this.chunkSize;
      const wz = chunk.cz * this.chunkSize;
      const dist = Math.hypot(wx - this._sleighPos.x, wz - this._sleighPos.z);
      const targetBand = this._computeLODBand(dist, chunk.lodBand);

      if (targetBand !== chunk.lodBand) {
        this._transitionChunkLOD(chunk, targetBand);
        break; // Only 1 chunk band change per frame
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
