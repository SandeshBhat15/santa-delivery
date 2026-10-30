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
    
    // Target and smoothed values
    this.fogNear = 7.7; // ~35% of 22
    this.fogFar = 22.0;
    this.targetFogFar = 22.0;
    this.targetFogNear = 7.7;
    
    // Smoothing half-life or time constant ~ 1.0s
    this.smoothingTimeConstant = 1.0;

    // Nearest edge distance metric
    this.nearestEdgeDist = 26.0;

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
   * A chunk is loaded if it is present in loadedChunkKeys (Set of "cx,cz").
   * For the grid of loaded chunks, an edge is any perimeter boundary (x = minX or maxX, z = minZ or maxZ of the chunk)
   * that borders an unloaded chunk.
   */
  _computeNearestUnloadedEdge(camera, loadedChunkKeys, chunkSize = 20.0) {
    if (!loadedChunkKeys || loadedChunkKeys.size === 0) {
      return 26.0; // clamp min 22 + 4m margin
    }

    const camPos = camera.position;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() > 0.0001) camDir.normalize();

    let minEdgeDist = Infinity;
    const half = chunkSize * 0.5;

    // Check every loaded chunk
    for (const key of loadedChunkKeys) {
      const parts = key.split(',');
      const cx = parseInt(parts[0], 10);
      const cz = parseInt(parts[1], 10);

      const chunkMinX = cx * chunkSize - half;
      const chunkMaxX = cx * chunkSize + half;
      const chunkMinZ = cz * chunkSize - half;
      const chunkMaxZ = cz * chunkSize + half;

      // 4 boundaries:
      // West: cx - 1, cz
      // East: cx + 1, cz
      // North: cx, cz - 1
      // South: cx, cz + 1
      const neighbors = [
        { nx: cx - 1, nz: cz, edgeAxis: 'x', edgeVal: chunkMinX, minCoord: chunkMinZ, maxCoord: chunkMaxZ },
        { nx: cx + 1, nz: cz, edgeAxis: 'x', edgeVal: chunkMaxX, minCoord: chunkMinZ, maxCoord: chunkMaxZ },
        { nx: cx, nz: cz - 1, edgeAxis: 'z', edgeVal: chunkMinZ, minCoord: chunkMinX, maxCoord: chunkMaxX },
        { nx: cx, nz: cz + 1, edgeAxis: 'z', edgeVal: chunkMaxZ, minCoord: chunkMinX, maxCoord: chunkMaxX }
      ];

      for (let i = 0; i < 4; i++) {
        const nb = neighbors[i];
        const nbKey = `${nb.nx},${nb.nz}`;
        if (!loadedChunkKeys.has(nbKey)) {
          // This boundary is an unloaded edge segment
          let closestPtX, closestPtZ;
          if (nb.edgeAxis === 'x') {
            closestPtX = nb.edgeVal;
            closestPtZ = THREE.MathUtils.clamp(camPos.z, nb.minCoord, nb.maxCoord);
          } else {
            closestPtX = THREE.MathUtils.clamp(camPos.x, nb.minCoord, nb.maxCoord);
            closestPtZ = nb.edgeVal;
          }

          const toEdgeX = closestPtX - camPos.x;
          const toEdgeZ = closestPtZ - camPos.z;
          const dist = Math.hypot(toEdgeX, toEdgeZ);

          // Test if edge is ahead or to the sides: dot product with camera direction >= -0.2 (ahead and sides)
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

    return minEdgeDist;
  }

  update(delta, camera, loadedChunkKeys, chunkSize = 20.0) {
    if (!this.scene.fog || !camera) return;

    // Synchronize fog color with sky horizon
    this.scene.fog.color.copy(this.horizonColor);

    // Compute raw nearest unloaded edge distance ahead and to the sides
    const rawEdgeDist = this._computeNearestUnloadedEdge(camera, loadedChunkKeys, chunkSize);
    this.nearestEdgeDist = rawEdgeDist;

    // fogFar = distance from the CAMERA to the nearest unloaded edge ahead and to the sides, minus 4 m, clamped to [22, 55] m
    const targetFar = THREE.MathUtils.clamp(rawEdgeDist - 4.0, 22.0, 55.0);
    const targetNear = targetFar * 0.35; // fogNear ~35% of fogFar

    // Smooth over ~1 s: exponential smoothing lerp factor alpha = 1.0 - Math.exp(-delta / 1.0)
    const dt = Math.min(delta, 0.1);
    const lerpAlpha = 1.0 - Math.exp(-dt / this.smoothingTimeConstant);

    this.fogFar += (targetFar - this.fogFar) * lerpAlpha;
    this.fogNear += (targetNear - this.fogNear) * lerpAlpha;

    if (this.enabled) {
      this.scene.fog.near = this.fogNear;
      this.scene.fog.far = this.fogFar;
    }
  }
}
