/**
 * HardwareProfiler.js — Automatic Device Hardware Capability Detection & Profiling
 *
 * Inspects:
 * - Unmasked GPU Vendor & Renderer via WEBGL_debug_renderer_info
 * - CPU Concurrency (navigator.hardwareConcurrency)
 * - Device Memory RAM (navigator.deviceMemory)
 * - Mobile / Touchscreen form factor
 *
 * Classifies into tiers: TIER_LOW, TIER_MID, TIER_HIGH, TIER_ULTRA
 * Provides recommended defaults for DPR, shadow map size, particle budgets, and chunk streaming limits.
 */

export const DEVICE_TIER = {
  LOW: 'low',
  MID: 'mid',
  HIGH: 'high',
  ULTRA: 'ultra'
};

export class HardwareProfiler {
  constructor(renderer) {
    this.renderer = renderer;
    this.profile = this._detectHardware();
    console.log(`[HardwareProfiler] Detected Tier: ${this.profile.tier.toUpperCase()} | GPU: ${this.profile.unmaskedRenderer} | CPU: ${this.profile.cores} cores | RAM: ~${this.profile.ram}GB`);
  }

  _detectHardware() {
    let unmaskedVendor = 'Unknown';
    let unmaskedRenderer = 'Unknown';

    if (this.renderer) {
      try {
        const gl = this.renderer.getContext();
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          unmaskedVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'Unknown';
          unmaskedRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Unknown';
        }
      } catch (e) {
        console.warn('[HardwareProfiler] Failed to query WebGL debug info:', e);
      }
    }

    const cores = navigator.hardwareConcurrency || 4;
    const ram = navigator.deviceMemory || 4;
    const isMobile = (new URLSearchParams(window.location.search).get('mobile') === '1') ||
                     /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     (window.innerWidth <= 840) ||
                     ('ontouchstart' in window && window.innerWidth <= 1024);

    const gpuLower = unmaskedRenderer.toLowerCase();

    // Check for high-end discrete GPUs and flagship Apple Silicon
    const isUltraGpu = gpuLower.includes('rtx 30') || gpuLower.includes('rtx 40') ||
                       gpuLower.includes('rtx 50') || gpuLower.includes('radeon rx 6') ||
                       gpuLower.includes('radeon rx 7') || gpuLower.includes('apple m2 max') ||
                       gpuLower.includes('apple m3') || gpuLower.includes('apple m4');

    const isHighGpu = isUltraGpu ||
                      gpuLower.includes('gtx 10') || gpuLower.includes('gtx 16') ||
                      gpuLower.includes('rtx 20') || gpuLower.includes('radeon rx 5') ||
                      gpuLower.includes('apple m1') || gpuLower.includes('apple m2') ||
                      gpuLower.includes('adreno 740') || gpuLower.includes('adreno 750') ||
                      gpuLower.includes('adreno 830') || gpuLower.includes('mali-g715') ||
                      gpuLower.includes('mali-g720');

    const isMidMobileGpu = gpuLower.includes('mali-g68') || gpuLower.includes('mali-g77') ||
                           gpuLower.includes('mali-g78') || gpuLower.includes('mali-g710') ||
                           gpuLower.includes('adreno 640') || gpuLower.includes('adreno 650') ||
                           gpuLower.includes('adreno 660') || gpuLower.includes('adreno 710') ||
                           gpuLower.includes('adreno 720') || gpuLower.includes('adreno 725') ||
                           gpuLower.includes('adreno 730') || gpuLower.includes('apple');

    const isFirefoxSpoofedGpu = gpuLower.includes(', or similar') || gpuLower === 'mozilla' || gpuLower === 'gecko';

    const isLowGpu = !isFirefoxSpoofedGpu && (
                     gpuLower.includes('intel hd') || gpuLower.includes('intel uhd') ||
                     gpuLower.includes('mali-400') || gpuLower.includes('mali-450') ||
                     gpuLower.includes('mali-t') || gpuLower.includes('mali-g51') ||
                     gpuLower.includes('mali-g52') || gpuLower.includes('mali-g57') ||
                     gpuLower.includes('adreno 3') || gpuLower.includes('adreno 4') ||
                     gpuLower.includes('adreno 5') || gpuLower.includes('adreno (tm) 5') ||
                     gpuLower.includes('adreno 61') || gpuLower.includes('powervr') ||
                     (ram <= 3 && isMobile) ||
                     (cores <= 4 && isMobile && !isHighGpu)
    );

    let tier = DEVICE_TIER.MID;
    if (isUltraGpu && !isMobile) {
      tier = DEVICE_TIER.ULTRA;
    } else if (isHighGpu) {
      tier = isMobile ? DEVICE_TIER.HIGH : DEVICE_TIER.HIGH;
    } else if (isLowGpu) {
      tier = DEVICE_TIER.LOW;
    } else {
      if (isMobile) {
        tier = (isMidMobileGpu || (cores >= 6 && ram >= 4) || isFirefoxSpoofedGpu) ? DEVICE_TIER.MID : DEVICE_TIER.LOW;
      } else {
        tier = DEVICE_TIER.MID;
      }
    }

    // Determine target settings based on tier
    let targetDpr = 1.5;
    let shadowMapSize = 1024;
    let baseSnowCount = 1800;
    let largeSnowCount = 180;
    let maxLoadedChunks = 5;

    switch (tier) {
      case DEVICE_TIER.ULTRA:
        targetDpr = Math.min(window.devicePixelRatio || 1, 2.5);
        shadowMapSize = 2048;
        baseSnowCount = 3600;
        largeSnowCount = 420;
        maxLoadedChunks = 8;
        break;
      case DEVICE_TIER.HIGH:
        targetDpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.6 : 2.0);
        shadowMapSize = 2048;
        baseSnowCount = 2800;
        largeSnowCount = 320;
        maxLoadedChunks = isMobile ? 5 : 6;
        break;
      case DEVICE_TIER.MID:
        targetDpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.4 : 1.75);
        shadowMapSize = isMobile ? 1024 : 2048;
        baseSnowCount = 2200;
        largeSnowCount = 240;
        maxLoadedChunks = 5;
        break;
      case DEVICE_TIER.LOW:
      default:
        targetDpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.05 : 1.25);
        shadowMapSize = 1024;
        baseSnowCount = 850;
        largeSnowCount = 90;
        maxLoadedChunks = 4;
        break;
    }

    return {
      tier,
      isMobile,
      cores,
      ram,
      unmaskedVendor,
      unmaskedRenderer,
      targetDpr,
      shadowMapSize,
      baseSnowCount,
      largeSnowCount,
      maxLoadedChunks
    };
  }
}
