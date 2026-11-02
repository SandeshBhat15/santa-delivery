import * as THREE from 'three';

/**
 * MobileFog - Distance Fog and Horizon Edge Management
 *
 * Implements Requirement 2:
 * - fog color = the sky's horizon color (kept in sync, 0x0e1b2f).
 * - smooth falloff: uses THREE.Fog with smoothstep in custom fragment shader or native Three.js Fog.
 * - Each frame, smoothed over ~1 s (exp factor / lerp dt), sets fogFar = distance from the CAMERA
 *   to the nearest unloaded edge ahead and to the sides, minus 4 m, clamped to [22, 55] m.
 * - fogNear ~35% of fogFar (0.35 * fogFar).
 * - Exempt from fog: sky, moon, stars, aurora, delivery markers, guide arrow (all configured with fog: false or custom shader).
 * - Keyboard toggle for fog ('F' key) for debugging/inspection.
 */
export class MobileFog {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.isMobile = options.isMobile ?? false;
    this.enabled = true; // active fog state (can be toggled with F)
    
    // Horizon color (#0e1b2f = 0x0e1b2f)
    this.horizonColor = new THREE.Color(0x0e1b2f);
    
    // Target and smoothed values (Ultra-dense fog on mobile: 5m near, 20m far)
    this.fogNear = this.isMobile ? 5.0 : 12.25;
    this.fogFar = this.isMobile ? 20.0 : 35.0;
    this.targetFogFar = this.fogFar;
    this.targetFogNear = this.fogNear;
    this._warnedFog = false;
    
    // Smoothing half-life or time constant ~ 1.0s
    this.smoothingTimeConstant = 1.0;

    // Nearest edge distance metric
    this.nearestEdgeDist = 26.0;

    // Item 4: Edge calculation throttle & preallocated resources
    this._lastEdgeCheckTime = 0;
    this._cachedMinEdgeDist = 26.0;
    this._camDir = new THREE.Vector3();
    this._neighborOffsets = [
      { dx: -1, dz: 0, edgeAxis: 'x', sign: -1 },
      { dx: 1,  dz: 0, edgeAxis: 'x', sign: 1 },
      { dx: 0,  dz: -1, edgeAxis: 'z', sign: -1 },
      { dx: 0,  dz: 1,  edgeAxis: 'z', sign: 1 }
    ];

    // Store reference to scene fog or create it
    if (!this.scene.fog) {
      this.scene.fog = new THREE.Fog(this.horizonColor.getHex(), this.fogNear, this.fogFar);
    } else {
      this.scene.fog.color.copy(this.horizonColor);
      this.scene.fog.near = this.fogNear;
      this.scene.fog.far = this.fogFar;
    }

    // Expose on window for telemetry
    window.mobileFog = this;
  }

  toggleFog() {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      if (this.scene.fog) {
        this.savedFogFar = this.scene.fog.far;
        this.scene.fog.far = 10000.0;
        this.scene.fog.near = 9000.0;
      }
    } else {
      if (this.scene.fog) {
        this.scene.fog.near = this.fogNear;
        this.scene.fog.far = this.fogFar;
      }
    }
    return this.enabled;
  }

  /**
   * Computes the distance from the CAMERA to the nearest unloaded chunk edge ahead and to the sides.
   * Throttled to run at most every 100 ms, reuses preallocated vector and offset table, reads cx/cz directly.
   */
  _computeNearestUnloadedEdge(camera, loadedChunks, chunkSize = 20.0) {
    if (!loadedChunks || loadedChunks.size === 0) {
      return 26.0;
    }

    const now = performance.now();
    if (now - this._lastEdgeCheckTime < 100) {
      return this._cachedMinEdgeDist;
    }
    this._lastEdgeCheckTime = now;

    const camPos = camera.position;
    const camDir = this._camDir;
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() > 0.0001) camDir.normalize();

    let minEdgeDist = Infinity;
    const half = chunkSize * 0.5;

    // Check loaded chunk records directly (avoid string splitting and parseInt)
    for (const chunk of loadedChunks.values()) {
      const cx = (chunk.cx !== undefined) ? chunk.cx : parseInt(chunk.key?.split(',')[0] || 0, 10);
      const cz = (chunk.cz !== undefined) ? chunk.cz : parseInt(chunk.key?.split(',')[1] || 0, 10);

      const chunkMinX = cx * chunkSize - half;
      const chunkMaxX = cx * chunkSize + half;
      const chunkMinZ = cz * chunkSize - half;
      const chunkMaxZ = cz * chunkSize + half;

      for (let i = 0; i < 4; i++) {
        const nb = this._neighborOffsets[i];
        const nbCx = cx + nb.dx;
        const nbCz = cz + nb.dz;
        const nbKey = `${nbCx},${nbCz}`;

        if (!loadedChunks.has(nbKey)) {
          let closestPtX, closestPtZ;
          if (nb.edgeAxis === 'x') {
            closestPtX = (nb.sign < 0) ? chunkMinX : chunkMaxX;
            closestPtZ = THREE.MathUtils.clamp(camPos.z, chunkMinZ, chunkMaxZ);
          } else {
            closestPtX = THREE.MathUtils.clamp(camPos.x, chunkMinX, chunkMaxX);
            closestPtZ = (nb.sign < 0) ? chunkMinZ : chunkMaxZ;
          }

          const toEdgeX = closestPtX - camPos.x;
          const toEdgeZ = closestPtZ - camPos.z;
          const dist = Math.hypot(toEdgeX, toEdgeZ);

          const dot = dist > 0.0001 ? (toEdgeX * camDir.x + toEdgeZ * camDir.z) / dist : 1.0;
          if (dot >= -0.2) {
            if (dist < minEdgeDist) {
              minEdgeDist = dist;
            }
          }
        }
      }
    }

    if (!isFinite(minEdgeDist)) {
      minEdgeDist = 55.0 + 4.0;
    }

    this._cachedMinEdgeDist = minEdgeDist;
    return minEdgeDist;
  }

  update(delta, camera, loadedChunks, chunkSize = 20.0) {
    if (!this.scene.fog || !camera) return;

    // Synchronize fog color with sky horizon
    this.scene.fog.color.copy(this.horizonColor);

    // Compute raw nearest unloaded edge distance ahead and to the sides
    const rawEdgeDist = this._computeNearestUnloadedEdge(camera, loadedChunks, chunkSize);
    this.nearestEdgeDist = rawEdgeDist;

    // fogFar = distance from the CAMERA to the nearest unloaded edge ahead and to the sides, minus 4 m
    // For mobile: ultra-dense fog capped to 20m max, near at 5m
    let targetFar, targetNear;
    if (this.isMobile) {
      targetFar = THREE.MathUtils.clamp(rawEdgeDist - 3.0, 15.0, 20.0);
      targetNear = 5.0;
    } else {
      targetFar = THREE.MathUtils.clamp(rawEdgeDist - 4.0, 28.0, 55.0);
      targetNear = Math.max(targetFar * 0.35, 12.0);
    }

    // Smooth over ~1 s: exponential smoothing lerp factor alpha = 1.0 - Math.exp(-delta / 1.0)
    const dt = Math.min(delta, 0.1);
    const lerpAlpha = 1.0 - Math.exp(-dt / this.smoothingTimeConstant);

    this.fogFar += (targetFar - this.fogFar) * lerpAlpha;
    this.fogNear += (targetNear - this.fogNear) * lerpAlpha;

    if (!this.isMobile && this.fogFar < 28.0 && !this._warnedFog) {
      console.warn('[MobileFog] fogFar below 28m:', this.fogFar);
      this._warnedFog = true;
    }

    if (this.enabled) {
      this.scene.fog.near = this.fogNear;
      this.scene.fog.far = this.fogFar;
    }
  }
}
