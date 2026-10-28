import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * DualFilterBloomPass
 * 
 * High-performance, silky-smooth dual-filter bloom (Downsample + Tent Upsample).
 * Eliminates sampling banding/striping lines and is 100% immune to black-square corruption.
 */

// 1. Luminance Isolation Shader (with smooth knee threshold & safety clamping)
const LuminosityShader = {
  uniforms: {
    tDiffuse: { value: null },
    threshold: { value: 0.30 },
    smoothWidth: { value: 0.25 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float threshold;
    uniform float smoothWidth;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      
      // Strict anti-NaN/Inf clamp
      texel.rgb = clamp(texel.rgb, 0.0, 16.0);

      // Perceptual luma
      float luma = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
      float factor = smoothstep(threshold, threshold + smoothWidth, luma);

      gl_FragColor = vec4(texel.rgb * factor, 1.0);
    }
  `
};

// 2. Dual-Filter Downsample Shader (13-tap box-tent cross filter)
// Eliminates discrete stripes and ensures continuous, seamless blur
const DownsampleShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexelSize: { value: new THREE.Vector2() }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexelSize;
    varying vec2 vUv;

    void main() {
      vec2 d = uTexelSize;

      // 13-tap anti-aliased downsample
      vec3 a = texture2D(tDiffuse, vUv + vec2(-2.0 * d.x,  2.0 * d.y)).rgb;
      vec3 b = texture2D(tDiffuse, vUv + vec2( 0.0,        2.0 * d.y)).rgb;
      vec3 c = texture2D(tDiffuse, vUv + vec2( 2.0 * d.x,  2.0 * d.y)).rgb;

      vec3 d0 = texture2D(tDiffuse, vUv + vec2(-2.0 * d.x,  0.0)).rgb;
      vec3 e  = texture2D(tDiffuse, vUv).rgb;
      vec3 f  = texture2D(tDiffuse, vUv + vec2( 2.0 * d.x,  0.0)).rgb;

      vec3 g = texture2D(tDiffuse, vUv + vec2(-2.0 * d.x, -2.0 * d.y)).rgb;
      vec3 h = texture2D(tDiffuse, vUv + vec2( 0.0,       -2.0 * d.y)).rgb;
      vec3 i = texture2D(tDiffuse, vUv + vec2( 2.0 * d.x, -2.0 * d.y)).rgb;

      vec3 j = texture2D(tDiffuse, vUv + vec2(-d.x,  d.y)).rgb;
      vec3 k = texture2D(tDiffuse, vUv + vec2( d.x,  d.y)).rgb;
      vec3 l = texture2D(tDiffuse, vUv + vec2(-d.x, -d.y)).rgb;
      vec3 m = texture2D(tDiffuse, vUv + vec2( d.x, -d.y)).rgb;

      vec3 col = (a + c + g + i) * 0.03125;
      col += (b + d0 + f + h) * 0.0625;
      col += (e) * 0.125;
      col += (j + k + l + m) * 0.125;

      col = clamp(col, 0.0, 16.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `
};

// 3. Dual-Filter Upsample Shader (3x3 tent filter with radius scale)
const UpsampleShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexelSize: { value: new THREE.Vector2() },
    uRadius: { value: 1.0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexelSize;
    uniform float uRadius;
    varying vec2 vUv;

    void main() {
      vec2 d = uTexelSize * uRadius;

      // 9-tap 3x3 tent filter
      vec3 a = texture2D(tDiffuse, vUv + vec2(-d.x,  d.y)).rgb;
      vec3 b = texture2D(tDiffuse, vUv + vec2( 0.0,  d.y)).rgb;
      vec3 c = texture2D(tDiffuse, vUv + vec2( d.x,  d.y)).rgb;

      vec3 d0 = texture2D(tDiffuse, vUv + vec2(-d.x,  0.0)).rgb;
      vec3 e  = texture2D(tDiffuse, vUv).rgb;
      vec3 f  = texture2D(tDiffuse, vUv + vec2( d.x,  0.0)).rgb;

      vec3 g = texture2D(tDiffuse, vUv + vec2(-d.x, -d.y)).rgb;
      vec3 h = texture2D(tDiffuse, vUv + vec2( 0.0, -d.y)).rgb;
      vec3 i = texture2D(tDiffuse, vUv + vec2( d.x, -d.y)).rgb;

      vec3 col = (a + c + g + i) * (1.0 / 16.0);
      col += (b + d0 + f + h) * (2.0 / 16.0);
      col += e * (4.0 / 16.0);

      col = clamp(col, 0.0, 16.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `
};

// 4. Composite Shader (additive blend with base frame)
const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    bloomIntensity: { value: 1.25 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float bloomIntensity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 bloom = texture2D(tBloom, vUv);

      vec3 finalCol = base.rgb + bloom.rgb * bloomIntensity;
      finalCol = max(vec3(0.0), finalCol);

      gl_FragColor = vec4(finalCol, base.a);
    }
  `
};

export class KawaseBloomPass extends Pass {
  constructor(resolution, intensity = 1.35, threshold = 0.30, radius = 1.1) {
    super();

    this.resolution = resolution ? resolution.clone() : new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.intensity = intensity;
    this.threshold = threshold;
    this.radius = radius;
    this.numLevels = 4; // Down to 1/16 resolution for rich broad soft falloff

    this.renderTargetsHorizontal = [];
    this.renderTargetsVertical = [];

    this.initRenderTargets();

    // Shader materials
    this.luminosityMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(LuminosityShader.uniforms),
      vertexShader: LuminosityShader.vertexShader,
      fragmentShader: LuminosityShader.fragmentShader
    });

    this.downsampleMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(DownsampleShader.uniforms),
      vertexShader: DownsampleShader.vertexShader,
      fragmentShader: DownsampleShader.fragmentShader
    });

    this.upsampleMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(UpsampleShader.uniforms),
      vertexShader: UpsampleShader.vertexShader,
      fragmentShader: UpsampleShader.fragmentShader,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(CompositeShader.uniforms),
      vertexShader: CompositeShader.vertexShader,
      fragmentShader: CompositeShader.fragmentShader
    });

    this.fsQuad = new FullScreenQuad();
  }

  initRenderTargets() {
    this.disposeRenderTargets();

    let resX = Math.max(1, Math.floor(this.resolution.x * 0.5));
    let resY = Math.max(1, Math.floor(this.resolution.y * 0.5));

    const rtParams = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      stencilBuffer: false,
      depthBuffer: false
    };

    for (let i = 0; i < this.numLevels; i++) {
      const rtDown = new THREE.WebGLRenderTarget(resX, resY, rtParams);
      const rtUp = new THREE.WebGLRenderTarget(resX, resY, rtParams);
      this.renderTargetsHorizontal.push(rtDown);
      this.renderTargetsVertical.push(rtUp);

      resX = Math.max(1, Math.floor(resX * 0.5));
      resY = Math.max(1, Math.floor(resY * 0.5));
    }
  }

  disposeRenderTargets() {
    for (const rt of this.renderTargetsHorizontal) rt.dispose();
    for (const rt of this.renderTargetsVertical) rt.dispose();
    this.renderTargetsHorizontal = [];
    this.renderTargetsVertical = [];
  }

  setSize(width, height) {
    this.resolution.set(width, height);
    this.initRenderTargets();
  }

  render(renderer, writeBuffer, readBuffer) {
    const originalClearColor = renderer.getClearColor(new THREE.Color());
    const originalClearAlpha = renderer.getClearAlpha();
    const originalAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // Step 1: Extract bright areas into top-level mip (1/2 res)
    this.luminosityMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.luminosityMaterial.uniforms.threshold.value = this.threshold;
    this.fsQuad.material = this.luminosityMaterial;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.fsQuad.render(renderer);

    // Step 2: Downsample chain with 13-tap box-tent filter
    let currentSource = this.renderTargetsHorizontal[0];
    this.fsQuad.material = this.downsampleMaterial;

    for (let i = 1; i < this.numLevels; i++) {
      const target = this.renderTargetsHorizontal[i];
      this.downsampleMaterial.uniforms.tDiffuse.value = currentSource.texture;
      this.downsampleMaterial.uniforms.uTexelSize.value.set(1.0 / currentSource.width, 1.0 / currentSource.height);

      renderer.setRenderTarget(target);
      renderer.clear();
      this.fsQuad.render(renderer);

      currentSource = target;
    }

    // Step 3: Upsample chain with 3x3 tent filter and progressive additive blending
    this.fsQuad.material = this.upsampleMaterial;

    for (let i = this.numLevels - 2; i >= 0; i--) {
      const source = this.renderTargetsHorizontal[i + 1];
      const target = this.renderTargetsHorizontal[i];

      this.upsampleMaterial.uniforms.tDiffuse.value = source.texture;
      this.upsampleMaterial.uniforms.uTexelSize.value.set(1.0 / source.width, 1.0 / source.height);
      this.upsampleMaterial.uniforms.uRadius.value = this.radius;

      // Additive blend onto the higher-resolution target
      renderer.setRenderTarget(target);
      // NOTE: Do not clear target so upsampled light smoothly accumulates
      this.fsQuad.render(renderer);
    }

    // Step 4: Composite back with readBuffer into writeBuffer
    this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.compositeMaterial.uniforms.tBloom.value = this.renderTargetsHorizontal[0].texture;
    this.compositeMaterial.uniforms.bloomIntensity.value = this.intensity;

    this.fsQuad.material = this.compositeMaterial;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
    }
    this.fsQuad.render(renderer);

    // Restore renderer state
    renderer.setClearColor(originalClearColor, originalClearAlpha);
    renderer.autoClear = originalAutoClear;
  }

  dispose() {
    this.disposeRenderTargets();
    this.luminosityMaterial.dispose();
    this.downsampleMaterial.dispose();
    this.upsampleMaterial.dispose();
    this.compositeMaterial.dispose();
    this.fsQuad.dispose();
  }
}
