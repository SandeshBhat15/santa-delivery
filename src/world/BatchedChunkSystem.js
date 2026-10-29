import * as THREE from 'three';

export const USE_LEGACY = typeof window !== 'undefined' && window.location.search.includes('legacy=1');

/**
 * BatchedChunkSystem — Ultra-Low Draw Call Dynamic Chunk Streaming World System
 *
 * Implements the exact Dynamic Chunk Streaming architecture:
 * 1. terrain.glb loaded & parsed EXACTLY ONCE at startup.
 *    - Keeps shared geometries, materials, and tile instance matrices as Float32Array per mesh type.
 *    - Extracts per-tile gameplay data (house colliders, height grid).
 *    - Never adds GLTF root to the scene.
 * 2. Starts with ONLY the chunks needed for initial camera view and player surroundings.
 * 3. Chunks are lightweight records: grid coordinates (cx, cz), slotIndex in shared instance buffers.
 *    - Generating a chunk = copying cached tile matrices into shared instance buffer at slotIndex * count * 16,
 *      offsetting x & z by chunk world origin, and registering colliders/targets.
 *    - Zero GLB loading, zero object cloning, zero allocations in steady state.
 * 4. Dynamic streaming:
 *    - Throttled check (at most every 200 ms unless camera moves across chunk boundary or rotates > 15 deg).
 *    - Needed set: chunks intersecting camera frustum up to fog/far distance (or 75m) + Chebyshev radius 1 around player.
 *    - Missing needed chunks queued and generated (nearest & view-aligned first, at most 1 per frame).
 *    - Chunks unneeded for > 2.0s and > 1 chunk outside needed set are destroyed.
 * 5. Destroying a chunk:
 *    - Swap-remove slot with the last active chunk in the shared instance buffer.
 *    - Unregister colliders, glow lights, DeliverySystem targets.
 *    - Reusable chunk record returned to pool. Shared geometries and materials are NEVER disposed.
 * 6. Rendering:
 *    - ONE InstancedMesh per mesh type for the whole world (~20 total).
 *    - Pre-sized for max capacity (MAX_CHUNKS = 20 chunks).
 *    - instMesh.count = activeChunks * baseCount.
 *    - instanceMatrix.needsUpdate = true only when loaded set changes.
 *    - frustumCulled = false with bounding sphere encompassing active area.
 * 7. Console logging:
 *    - Emits: [Chunk] <cx,cz> | <GENERATED|DESTROYED> | Loaded: <N> | Instances: H:<h> T:<t> C:<c> G:<g> | Calls: <calls> | Memory: Geo:<geo> Tex:<tex>
 */
export class BatchedChunkSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.chunkSize = 20.0;
    this.maxLoadedChunks = options.maxLoadedChunks || 20; // Capacity buffer (typically 7-12 active)
    this.isMobile = options.isMobile ?? false;

    // Active loaded chunks: Map of key ("cx,cz") -> ChunkRecord
    this.chunks = new Map();
    // Slot array: slotIndex (0 .. activeChunkCount - 1) -> ChunkRecord
    this.slots = new Array(this.maxLoadedChunks).fill(null);
    this.activeChunkCount = 0;

    // Reusable chunk record pool
    this.chunkPool = [];

    // Template data extracted from terrain.glb
    this.meshDefinitions = [];
    this.templateHouseColliders = [];
    this.sharedMaterials = new Map();
    this.heightGridSize = 65;
    this.heightGrid = null;
    this.edgeHeight = 0.160;

    // World render group holding the ~20 global InstancedMeshes
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'BatchedWorldGroup';
    this.scene.add(this.worldGroup);

    this.instancedMeshes = [];

    // Streaming queues and update throttle state
    this.generationQueue = [];
    this.lastStreamCheckTime = 0;
    this.lastStreamCamPos = new THREE.Vector3();
    this.lastStreamCamQuat = new THREE.Quaternion();
    this.lastFocusChunkX = NaN;
    this.lastFocusChunkZ = NaN;

    // Frustum and camera scratch objects
    this._projScreenMatrix = new THREE.Matrix4();
    this._frustum = new THREE.Frustum();
    this._tempBox = new THREE.Box3();
    this._tempVec = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._sleighPos = new THREE.Vector3();

    // Stats
    this.stats = {
      houses: 0,
      trees: 0,
      cliffs: 0,
      ground: 0,
      totalTriangles: 0
    };
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
   * Synchronously parse terrain GLTF root once, caching geometries, materials and raw matrices.
   */
  initFromGLTF(gltfRoot) {
    this.meshDefinitions = [];
    this.templateHouseColliders = [];
    this.chunks.clear();
    this.slots.fill(null);
    this.activeChunkCount = 0;

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

      if (isHouse && child.geometry?.boundingBox) {
        for (let i = 0; i < matrices.length; i++) {
          const hBox = child.geometry.boundingBox.clone().applyMatrix4(matrices[i]);
          this.templateHouseColliders.push(hBox);
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

    this.buildHeightGrid(gltfRoot);

    // Pre-allocate the ~20 global InstancedMeshes with capacity for MAX_CHUNKS
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
      instMesh.frustumCulled = false; // Bounding sphere encompasses loaded area

      // Start with 0 active instances until chunks are generated
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

  /**
   * Acquire a chunk record from pool or create new
   */
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
        meshes: this.instancedMeshes, // Kept for optimizer compatibility
        unneededSince: 0
      };
    }
    chunk.key = cx + ',' + cz;
    chunk.cx = cx;
    chunk.cz = cz;
    chunk.slotIndex = -1;
    chunk.biome = this.getChunkBiome(cx, cz);
    chunk.unneededSince = 0;
    chunk.meshes = this.instancedMeshes;

    // Instantiate house colliders offset to world space
    const wx = cx * this.chunkSize;
    const wz = cz * this.chunkSize;
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
   * Generate chunk at (cx, cz): allocates a slot, copies template matrices with world offset,
   * registers gameplay objects, and marks buffer updates.
   */
  generateChunk(cx, cz) {
    const key = cx + ',' + cz;
    if (this.chunks.has(key)) return;

    if (this.activeChunkCount >= this.maxLoadedChunks) {
      console.warn(`[BatchedChunkSystem] Max chunk capacity reached (${this.maxLoadedChunks}). Cannot generate ${key}`);
      return;
    }

    const slot = this.activeChunkCount;
    this.activeChunkCount++;

    const chunk = this._acquireChunkRecord(cx, cz);
    chunk.slotIndex = slot;
    this.chunks.set(key, chunk);
    this.slots[slot] = chunk;

    const wx = cx * this.chunkSize;
    const wz = cz * this.chunkSize;

    // Copy cached tile matrices into the shared instance buffers at the allocated slot
    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshes[defIdx];
      const baseCount = def.baseCount;
      const src = def.rawMatrixData;
      const dst = instMesh.instanceMatrix.array;
      const targetOffset = slot * baseCount * 16;

      // Direct memory copy of base matrix batch
      dst.set(src, targetOffset);

      // Offset the translation column (elements 12, 13, 14 of each 4x4 matrix)
      for (let i = 0; i < baseCount; i++) {
        const matOffset = targetOffset + i * 16;
        dst[matOffset + 12] += wx;
        dst[matOffset + 14] += wz;
      }

      instMesh.count = this.activeChunkCount * baseCount;
      instMesh.instanceMatrix.needsUpdate = true;
    }

    // Register with DeliverySystem
    if (window.deliverySystem && window.deliverySystem.syncChunkTargets) {
      window.deliverySystem.syncChunkTargets(key, cx, cz);
    }

    this._updateBoundsAndStats();
    this._logChunkChange(key, 'GENERATED');
  }

  /**
   * Destroy chunk: swaps last active slot into freed slot to keep buffers compact,
   * unregisters colliders & delivery targets, and returns record to pool.
   */
  destroyChunk(key) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    const freedSlot = chunk.slotIndex;
    const lastSlot = this.activeChunkCount - 1;

    // If freed slot is not the last slot, swap-remove with the last slot
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

        // Copy last chunk's instance data into the freed slot
        buf.copyWithin(dstOffset, srcOffset, srcOffset + elementsToCopy);
      }

      movingChunk.slotIndex = freedSlot;
      this.slots[freedSlot] = movingChunk;
    }

    this.slots[lastSlot] = null;
    this.activeChunkCount--;
    this.chunks.delete(key);

    // Update instanceMesh counts and mark needsUpdate
    for (let defIdx = 0; defIdx < this.meshDefinitions.length; defIdx++) {
      const def = this.meshDefinitions[defIdx];
      const instMesh = this.instancedMeshes[defIdx];
      instMesh.count = this.activeChunkCount * def.baseCount;
      instMesh.instanceMatrix.needsUpdate = true;
    }

    // Unload targets from DeliverySystem
    if (window.deliverySystem && window.deliverySystem.unloadChunkTargets) {
      window.deliverySystem.unloadChunkTargets(key);
    }

    this._updateBoundsAndStats();
    this._logChunkChange(key, 'DESTROYED');

    this._releaseChunkRecord(chunk);
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

      // Recompute bounding sphere for instanced mesh
      instMesh.computeBoundingSphere();
    }

    this.stats.houses = totalHouse;
    this.stats.trees = totalTree;
    this.stats.cliffs = totalCliff;
    this.stats.ground = totalGround;
    this.stats.totalTriangles = totalTris;
  }

  _logChunkChange(key, action) {
    const renderer = window.game?.renderer;
    const calls = renderer?.info?.render?.calls ?? 0;
    const geo = renderer?.info?.memory?.geometries ?? 0;
    const tex = renderer?.info?.memory?.textures ?? 0;

    console.log(`[Chunk] ${key} | ${action} | Loaded: ${this.activeChunkCount} | Instances: H:${this.stats.houses} T:${this.stats.trees} C:${this.stats.cliffs} G:${this.stats.ground} | Calls: ${calls} | Memory: Geo:${geo} Tex:${tex}`);
  }

  /**
   * Dynamic streaming update called every frame
   */
  update(streamFocus, camera) {
    if (!camera) return;

    this._camPos.copy(camera.position);
    camera.getWorldDirection(this._camDir);

    const focusPos = streamFocus || camera.position;
    this._sleighPos.copy(focusPos);

    const now = performance.now();
    const half = this.chunkSize * 0.5;
    const curFocusChunkX = Math.floor((focusPos.x + half) / this.chunkSize);
    const curFocusChunkZ = Math.floor((focusPos.z + half) / this.chunkSize);

    // Fast check: entered new chunk or rotated > ~15 deg (angle > 0.26 rad)
    const chunkChanged = (curFocusChunkX !== this.lastFocusChunkX || curFocusChunkZ !== this.lastFocusChunkZ);
    const angleDelta = 2 * Math.acos(Math.min(1.0, Math.max(-1.0, Math.abs(camera.quaternion.dot(this.lastStreamCamQuat)))));
    const rotatedSignificantly = angleDelta > 0.26;
    const timeElapsed = (now - this.lastStreamCheckTime) > 200;

    if (chunkChanged || rotatedSignificantly || timeElapsed || this.activeChunkCount === 0) {
      this.lastStreamCheckTime = now;
      this.lastStreamCamPos.copy(camera.position);
      this.lastStreamCamQuat.copy(camera.quaternion);
      this.lastFocusChunkX = curFocusChunkX;
      this.lastFocusChunkZ = curFocusChunkZ;

      this._recomputeNeededChunks(camera, curFocusChunkX, curFocusChunkZ, now);
    }

    // Process at most 1 chunk generation per frame to maintain silky 60 FPS
    if (this.generationQueue.length > 0) {
      const nextCoords = this.generationQueue.shift();
      this.generateChunk(nextCoords.cx, nextCoords.cz);
    }

    // Check unneeded chunks for destruction (hysteresis: unneeded for > 2.0s and > 1 chunk outside needed set)
    this._pruneUnneededChunks(now, curFocusChunkX, curFocusChunkZ);
  }

  _recomputeNeededChunks(camera, centerCx, centerCz, now) {
    // Build camera frustum
    this._projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

    const neededSet = new Set();
    const candidateChunks = [];
    const maxRadius = 3; // Check up to 3 chunks away (~60-70m), covering frustum

    const half = this.chunkSize * 0.5;

    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      for (let dz = -maxRadius; dz <= maxRadius; dz++) {
        const cx = centerCx + dx;
        const cz = centerCz + dz;
        const key = cx + ',' + cz;

        const isPlayerSurrounding = Math.abs(dx) <= 1 && Math.abs(dz) <= 1; // Chebyshev distance <= 1

        let isNeeded = isPlayerSurrounding;

        if (!isNeeded) {
          // Test frustum intersection with chunk AABB
          const wx = cx * this.chunkSize;
          const wz = cz * this.chunkSize;
          this._tempBox.min.set(wx - half, -2.0, wz - half);
          this._tempBox.max.set(wx + half, 18.0, wz + half);

          if (this._frustum.intersectsBox(this._tempBox)) {
            // Distance limit to fog/visibility limit (~75m)
            const dist = Math.hypot(wx - camera.position.x, wz - camera.position.z);
            if (dist <= 75.0) {
              isNeeded = true;
            }
          }
        }

        if (isNeeded) {
          neededSet.add(key);

          // If not currently loaded and not in generation queue, consider for queuing
          if (!this.chunks.has(key)) {
            const wx = cx * this.chunkSize;
            const wz = cz * this.chunkSize;
            const dist = Math.hypot(wx - camera.position.x, wz - camera.position.z);

            this._tempVec.set(wx - camera.position.x, 0, wz - camera.position.z).normalize();
            const viewDot = this._tempVec.dot(this._camDir);

            candidateChunks.push({
              cx,
              cz,
              key,
              dist,
              viewDot,
              score: dist - viewDot * 25.0 // Nearest and best aligned with camera view vector
            });
          }
        }
      }
    }

    // Sort candidate missing chunks by priority (nearest and in front of camera)
    candidateChunks.sort((a, b) => a.score - b.score);

    // Update generation queue (prevent duplicates)
    const existingQueueKeys = new Set(this.generationQueue.map(c => c.key));
    for (let i = 0; i < candidateChunks.length; i++) {
      const cand = candidateChunks[i];
      if (!existingQueueKeys.has(cand.key)) {
        this.generationQueue.push(cand);
        existingQueueKeys.add(cand.key);
      }
    }

    // Update unneeded timestamps for loaded chunks
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
    // Only destroy chunks if activeChunkCount > 0 and chunk has been unneeded for > 2000 ms
    // and is > 1 chunk outside needed Chebyshev radius
    for (const [key, chunk] of this.chunks.entries()) {
      if (chunk.unneededSince > 0 && (now - chunk.unneededSince) > 2000) {
        const dx = Math.abs(chunk.cx - centerCx);
        const dz = Math.abs(chunk.cz - centerCz);
        const outsideMargin = (dx > 2 || dz > 2);

        if (outsideMargin) {
          this.destroyChunk(key);
          break; // Destroy at most 1 chunk per frame to avoid hitches
        }
      }
    }
  }

  getActiveTriangleCount() {
    return this.stats.totalTriangles;
  }
}
