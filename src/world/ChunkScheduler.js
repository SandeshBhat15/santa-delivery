import * as THREE from 'three';

/**
 * ChunkScheduler — Intelligent Smooth Chunk Streaming Governor for Mobile
 *
 * Implements Requirements 1, 3, 4, 5, 6:
 * - Cap: Max 5 loaded chunks on mobile, never exceeded.
 * - Priority:
 *   1. Sleigh's chunk
 *   2. Nearest chunk in travel direction (ahead)
 *   3. Side neighbors (perpendicular to travel)
 *   4. Next chunk ahead (2 chunks ahead)
 *   + Bonus for chunk containing current delivery target along path
 *   + Prefetch: Every 150 ms predict sleigh position ~1.5 s ahead (+ turn anticipation) with priority bonus
 * - Eviction:
 *   - Evict lowest priority chunk when slot is needed
 *   - NEVER evict sleigh's chunk
 *   - NEVER evict a chunk younger than 1.5 s
 * - Generation budget: At most 1 chunk per frame (~2 ms budget)
 * - Smooth scheduling decisions:
 *   - Generate or unload only while chunk AABB (+10%) is outside camera frustum when possible.
 *   - If must generate while partly in view, allow only when nearest visible part is beyond ~85% of fogFar (wait up to 300 ms);
 *     sleigh's chunk and nearest neighbor are exempt.
 *   - Skip chunk work on any frame after a frame over 20 ms.
 *   - Fallback: If scheduler throws or loaded set becomes empty, disable and fall back with console warning.
 *   - Flag ?smooth=0 restores old behavior exactly.
 *   - Flag ?lod=0 (default 0 on mobile) keeps original geometry without runtime LOD simplification.
 *   - Visible pops counter: chunks generated or unloaded while inside frustum and within fogFar.
 *   - Debug wireframe AABB visualization toggle.
 */
export class ChunkScheduler {
  constructor(chunkSystem, options = {}) {
    this.chunkSystem = chunkSystem;
    this.isMobile = options.isMobile ?? false;
    this.maxChunks = options.maxChunks || 5;

    // Flags
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    this.smoothEnabled = params.get('smooth') !== '0';
    this.lodFlag = params.get('lod');
    this.useLod = this.lodFlag === '1' || (!this.isMobile && this.lodFlag !== '0'); // default 0 on mobile, 1 on desktop
    this.debug = params.get('debug') === '1';

    // State tracking
    this.disabled = !this.smoothEnabled; // If ?smooth=0, disabled
    this.hasWarnedFallback = false;

    // Timing & Frame Guard
    this.lastFrameTimeMs = 0;
    this.skipNextFrameDueToLongFrame = false;

    // Prefetch timer: every 150ms
    this.lastPrefetchTime = 0;
    this.predictedChunkKey = null;

    // Delayed requests map: key -> { requestTime, candidate, visibleSince }
    this.delayedRequests = new Map();

    // Visible pops counter
    this.visiblePops = 0;

    // Frustum & Math Helpers
    this._frustum = new THREE.Frustum();
    this._projScreenMatrix = new THREE.Matrix4();
    this._tempBox = new THREE.Box3();
    this._tempBoxMargin = new THREE.Box3();
    this._tempVec = new THREE.Vector3();
    this._sleighForward = new THREE.Vector3(0, 0, -1);
    this._lastSleighPos = new THREE.Vector3();
    this._lastSleighYaw = 0;
    this._sleighYawRate = 0;
    this._lastTime = performance.now();

    // AABB Debug Wireframe Visualizer
    this.showAABBs = false;
    this.debugGroup = new THREE.Group();
    this.debugGroup.name = 'ChunkScheduler_DebugAABBs';
    this.debugGroup.visible = false;
    if (this.chunkSystem.scene) {
      this.chunkSystem.scene.add(this.debugGroup);
    }
    this.debugBoxes = new Map(); // key -> Box3Helper

    // Telemetry
    this.telemetry = {
      queueLength: 0,
      delayedRequestsCount: 0,
      visiblePops: 0,
      lastGenMs: 0,
      maxFrameTime5s: 0,
      loadedChunksCount: 0,
      maxChunks: this.maxChunks
    };

    window.chunkScheduler = this;
  }

  toggleAABBs() {
    this.showAABBs = !this.showAABBs;
    this.debugGroup.visible = this.showAABBs;
    return this.showAABBs;
  }

  /**
   * Helper: check if a chunk box (+10% margin) intersects the camera frustum
   */
  _isBoxInFrustum(cx, cz, marginFactor = 1.10) {
    const cs = this.chunkSystem.chunkSize || 20.0;
    const half = cs * 0.5 * marginFactor;
    const wx = cx * cs;
    const wz = cz * cs;
    const bMinY = this.chunkSystem.templateBounds?.min?.y ?? -2.0;
    const bMaxY = this.chunkSystem.templateBounds?.max?.y ?? 18.0;

    this._tempBoxMargin.min.set(wx - half, bMinY, wz - half);
    this._tempBoxMargin.max.set(wx + half, bMaxY, wz + half);

    return this._frustum.intersectsBox(this._tempBoxMargin);
  }

  /**
   * Helper: compute nearest point on chunk AABB to camera
   */
  _nearestPointDistanceToCamera(cx, cz, camPos) {
    const cs = this.chunkSystem.chunkSize || 20.0;
    const half = cs * 0.5;
    const wx = cx * cs;
    const wz = cz * cs;
    const bMinY = this.chunkSystem.templateBounds?.min?.y ?? -2.0;
    const bMaxY = this.chunkSystem.templateBounds?.max?.y ?? 18.0;

    this._tempBox.min.set(wx - half, bMinY, wz - half);
    this._tempBox.max.set(wx + half, bMaxY, wz + half);

    const clampedX = THREE.MathUtils.clamp(camPos.x, this._tempBox.min.x, this._tempBox.max.x);
    const clampedY = THREE.MathUtils.clamp(camPos.y, this._tempBox.min.y, this._tempBox.max.y);
    const clampedZ = THREE.MathUtils.clamp(camPos.z, this._tempBox.min.z, this._tempBox.max.z);

    return Math.hypot(camPos.x - clampedX, camPos.y - clampedY, camPos.z - clampedZ);
  }

  /**
   * Safe fallback trigger
   */
  _triggerFallback(reason) {
    if (!this.hasWarnedFallback) {
      console.warn(`[ChunkScheduler FALLBACK] ${reason}. Reverting to standard chunk streaming.`);
      this.hasWarnedFallback = true;
    }
    this.disabled = true;
  }

  /**
   * Record visible pop if a chunk was generated or unloaded while inside the frustum and closer than fogFar
   */
  _checkPop(cx, cz, camera, fogFar) {
    if (!camera) return;
    const inFrustum = this._isBoxInFrustum(cx, cz, 1.0);
    if (inFrustum) {
      const dist = this._nearestPointDistanceToCamera(cx, cz, camera.position);
      if (dist < (fogFar || 45.0)) {
        this.visiblePops++;
        this.telemetry.visiblePops = this.visiblePops;
      }
    }
  }

  /**
   * Main scheduler update called from BatchedChunkSystem.update()
   * Returns true if handled by ChunkScheduler, or false if BatchedChunkSystem should use its old logic.
   */
  update(sleighPos, camera, now, frameDeltaMs, mobileFog) {
    if (this.disabled) return false;

    try {
      return this._executeScheduling(sleighPos, camera, now, frameDeltaMs, mobileFog);
    } catch (err) {
      this._triggerFallback(`Exception caught during schedule: ${err.message}`);
      return false;
    }
  }

  _executeScheduling(sleighPos, camera, now, frameDeltaMs, mobileFog) {
    const cs = this.chunkSystem;
    const half = cs.chunkSize * 0.5;
    const currentCx = Math.floor((sleighPos.x + half) / cs.chunkSize);
    const currentCz = Math.floor((sleighPos.z + half) / cs.chunkSize);
    const currentSleighKey = `${currentCx},${currentCz}`;

    // Update Frustum
    this._projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

    // Frame Guard: Skip chunk generation on any frame after a frame over 20 ms
    const wasOver20ms = this.skipNextFrameDueToLongFrame;
    this.skipNextFrameDueToLongFrame = (frameDeltaMs > 20.0);

    // 1. Calculate sleigh velocity, forward heading & yaw rate for turning anticipation
    const dt = Math.max(0.001, (now - this._lastTime) / 1000.0);
    this._lastTime = now;

    if (this._lastSleighPos.lengthSq() > 0) {
      this._tempVec.subVectors(sleighPos, this._lastSleighPos);
      if (this._tempVec.lengthSq() > 0.0001) {
        this._sleighForward.copy(this._tempVec).normalize();
      }
    }
    this._lastSleighPos.copy(sleighPos);

    const currentYaw = Math.atan2(this._sleighForward.x, this._sleighForward.z);
    let deltaYaw = currentYaw - this._lastSleighYaw;
    while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    this._sleighYawRate = deltaYaw / dt;
    this._lastSleighYaw = currentYaw;

    // 2. Prefetch: every 150 ms predict the sleigh position ~1.5 s ahead (+ turn anticipation)
    if (now - this.lastPrefetchTime > 150) {
      this.lastPrefetchTime = now;
      const speed = cs.sleighVelocity ? cs.sleighVelocity.length() : 1.8;
      const lookaheadDist = Math.max(3.0, speed * 1.5); // ~1.5 s ahead

      // Turn bias: predict turn angle
      const predictedYaw = currentYaw + this._sleighYawRate * 1.5;
      const predDirX = Math.sin(predictedYaw);
      const predDirZ = Math.cos(predictedYaw);

      const predX = sleighPos.x + (predDirX * 0.7 + this._sleighForward.x * 0.3) * lookaheadDist;
      const predZ = sleighPos.z + (predDirZ * 0.7 + this._sleighForward.z * 0.3) * lookaheadDist;

      const pCx = Math.floor((predX + half) / cs.chunkSize);
      const pCz = Math.floor((predZ + half) / cs.chunkSize);
      this.predictedChunkKey = `${pCx},${pCz}`;
    }

    // 3. Find current delivery target chunk key (Requirement 5)
    let targetChunkKey = null;
    if (window.deliverySystem && window.deliverySystem.activeTarget) {
      const tPos = window.deliverySystem.activeTarget.worldPos;
      if (tPos) {
        const tCx = Math.floor((tPos.x + half) / cs.chunkSize);
        const tCz = Math.floor((tPos.z + half) / cs.chunkSize);
        targetChunkKey = `${tCx},${tCz}`;
      }
    }

    // 4. Score Candidate Chunks Around Sleigh (max radius 2 chunks)
    // Priority rules:
    // 1. Sleigh's chunk (base priority: 10000)
    // 2. Nearest chunk in the travel direction (dot > 0.6) (base priority: 8000)
    // 3. Side neighbors (dot between -0.4 and 0.6) (base priority: 6000)
    // 4. Next chunk ahead (2 chunks in travel direction) (base priority: 4000)
    // + Current delivery target bonus (+2500)
    // + Prefetch predicted chunk bonus (+1500)
    const candidates = [];
    const neededKeySet = new Set();

    // Check a 3x3 or 5x5 neighborhood around sleigh
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const cx = currentCx + dx;
        const cz = currentCz + dz;
        const key = `${cx},${cz}`;
        const wx = cx * cs.chunkSize;
        const wz = cz * cs.chunkSize;

        let priority = 0;
        const isSleighChunk = (dx === 0 && dz === 0);

        if (isSleighChunk) {
          priority = 10000;
        } else {
          // Direction from sleigh to chunk
          const toChunk = new THREE.Vector2(wx - sleighPos.x, wz - sleighPos.z);
          const dist = toChunk.length();
          toChunk.normalize();

          const fwd2D = new THREE.Vector2(this._sleighForward.x, this._sleighForward.z).normalize();
          const dot = toChunk.dot(fwd2D);

          const chebyshev = Math.max(Math.abs(dx), Math.abs(dz));

          if (chebyshev === 1) {
            if (dot > 0.5) {
              // Nearest chunk in travel direction
              priority = 8000 + dot * 500 - dist;
            } else if (dot >= -0.5) {
              // Side neighbors
              priority = 6000 + dot * 300 - dist;
            } else {
              // Chunk behind
              priority = 2000 - dist;
            }
          } else if (chebyshev === 2) {
            if (dot > 0.7) {
              // Next chunk ahead
              priority = 4000 + dot * 400 - dist;
            } else {
              priority = 1000 - dist;
            }
          }
        }

        // Target bonus
        if (key === targetChunkKey) {
          priority += 2500;
        }

        // Prefetch bonus
        if (key === this.predictedChunkKey) {
          priority += 1500;
        }

        candidates.push({ cx, cz, key, priority, isSleighChunk });
      }
    }

    // Sort candidates by priority descending
    candidates.sort((a, b) => b.priority - a.priority);

    // The top 5 candidates form our ideal desired set
    const desiredChunks = candidates.slice(0, this.maxChunks);
    desiredChunks.forEach(c => neededKeySet.add(c.key));

    // Ensure sleigh chunk is ALWAYS included in desired chunks
    if (!neededKeySet.has(currentSleighKey)) {
      const sleighCand = candidates.find(c => c.key === currentSleighKey);
      if (sleighCand) {
        desiredChunks[desiredChunks.length - 1] = sleighCand;
        neededKeySet.add(currentSleighKey);
      }
    }

    const loadedKeys = new Set(cs.chunks.keys());
    const fogFar = mobileFog ? mobileFog.fogFar : 25.0;

    // 5. Eviction: If more than maxChunks or an unloaded slot is needed
    // Evict lowest priority chunk: never sleigh chunk, never younger than 1.5 s
    // Generate or unload only while AABB (+10%) is outside camera frustum when possible
    if (cs.chunks.size >= this.maxChunks) {
      // Find loaded chunks not in desiredChunks
      let evictionCandidate = null;
      let lowestPriority = Infinity;

      for (const [key, chunk] of cs.chunks.entries()) {
        if (key === currentSleighKey) continue; // Never evict sleigh chunk
        const ageMs = now - (chunk.createdAt || 0);
        if (ageMs < 1500) continue; // Never younger than 1.5s

        // Determine if chunk is outside frustum
        const outsideFrustum = !this._isBoxInFrustum(chunk.cx, chunk.cz, 1.10);

        // Find candidate priority
        const cand = candidates.find(c => c.key === key);
        let prio = cand ? cand.priority : 0;
        // Chunks outside frustum get lower priority (favored for eviction)
        if (outsideFrustum) prio -= 50000;

        if (prio < lowestPriority) {
          lowestPriority = prio;
          evictionCandidate = { key, chunk, outsideFrustum };
        }
      }

      // If we found an eviction candidate and a desired chunk needs to be loaded
      const needsSlot = desiredChunks.some(dc => !loadedKeys.has(dc.key));
      if (needsSlot && evictionCandidate) {
        this._checkPop(evictionCandidate.chunk.cx, evictionCandidate.chunk.cz, camera, fogFar);
        cs.destroyChunk(evictionCandidate.key);
        loadedKeys.delete(evictionCandidate.key);
      }
    }

    // 6. Smooth Generation Scheduling:
    // Generate at most 1 chunk per frame (~2 ms budget)
    // Only if not skipped due to long frame (>20 ms)
    if (!wasOver20ms && cs.chunks.size < this.maxChunks) {
      // Find highest priority desired chunk not yet loaded
      for (const candidate of desiredChunks) {
        if (loadedKeys.has(candidate.key)) continue;

        const isSleighChunk = (candidate.key === currentSleighKey);
        // Exemption: Sleigh's own chunk and its nearest neighbor are exempt from view delay
        const chebyshevToSleigh = Math.max(Math.abs(candidate.cx - currentCx), Math.abs(candidate.cz - currentCz));
        const isExempt = isSleighChunk || (chebyshevToSleigh <= 1 && candidate.priority >= 8000);

        const inFrustum = this._isBoxInFrustum(candidate.cx, candidate.cz, 1.10);

        let canGenerate = false;

        if (!inFrustum) {
          // Rule 1: AABB is outside camera frustum -> Generate immediately!
          canGenerate = true;
          this.delayedRequests.delete(candidate.key);
        } else if (isExempt) {
          // Exempt from waiting
          canGenerate = true;
          this.delayedRequests.delete(candidate.key);
        } else {
          // Rule 2: In view -> allow only when nearest visible part is beyond ~85% of fogFar (wait up to 300 ms)
          const nearestDist = this._nearestPointDistanceToCamera(candidate.cx, candidate.cz, camera.position);
          const isBeyond85Fog = nearestDist >= (fogFar * 0.85);

          let req = this.delayedRequests.get(candidate.key);
          if (!req) {
            req = { requestTime: now, candidate, visibleSince: now };
            this.delayedRequests.set(candidate.key, req);
          }

          const waitedMs = now - req.visibleSince;
          if (isBeyond85Fog || waitedMs >= 300) {
            canGenerate = true;
            this.delayedRequests.delete(candidate.key);
          }
        }

        if (canGenerate) {
          const tStart = performance.now();
          this._checkPop(candidate.cx, candidate.cz, camera, fogFar);
          cs.generateChunk(candidate.cx, candidate.cz);
          const genDuration = performance.now() - tStart;
          this.telemetry.lastGenMs = genDuration;
          break; // At most 1 chunk per frame!
        }
      }
    }

    // Clean up stale delayed requests
    for (const [key, req] of this.delayedRequests.entries()) {
      if (loadedKeys.has(key) || !neededKeySet.has(key)) {
        this.delayedRequests.delete(key);
      }
    }

    // Safety fallback: if loaded set becomes empty while sleigh is moving
    if (cs.chunks.size === 0) {
      this._triggerFallback('Loaded chunk set became empty');
      cs.generateChunk(currentCx, currentCz);
      return false;
    }

    // Update Telemetry
    this.telemetry.queueLength = desiredChunks.filter(c => !loadedKeys.has(c.key)).length;
    this.telemetry.delayedRequestsCount = this.delayedRequests.size;
    this.telemetry.loadedChunksCount = cs.chunks.size;
    this.telemetry.maxChunks = this.maxChunks;

    // Update debug wireframes if enabled
    if (this.showAABBs) {
      this._updateDebugAABBs(cs);
    }

    return true; // Successfully managed by ChunkScheduler
  }

  _updateDebugAABBs(cs) {
    const activeKeys = new Set(cs.chunks.keys());

    // Remove old helpers
    for (const [key, helper] of this.debugBoxes.entries()) {
      if (!activeKeys.has(key)) {
        this.debugGroup.remove(helper);
        if (helper.dispose) helper.dispose();
        this.debugBoxes.delete(key);
      }
    }

    // Add or update helpers
    const half = cs.chunkSize * 0.5;
    for (const [key, chunk] of cs.chunks.entries()) {
      let helper = this.debugBoxes.get(key);
      if (!helper) {
        const box = new THREE.Box3();
        const wx = chunk.cx * cs.chunkSize;
        const wz = chunk.cz * cs.chunkSize;
        box.min.set(wx - half, -2, wz - half);
        box.max.set(wx + half, 18, wz + half);
        helper = new THREE.Box3Helper(box, 0x00ff88);
        this.debugGroup.add(helper);
        this.debugBoxes.set(key, helper);
      }
    }
  }
}
