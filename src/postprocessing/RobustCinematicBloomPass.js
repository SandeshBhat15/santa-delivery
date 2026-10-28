import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { LuminosityHighPassShader } from 'three/addons/shaders/LuminosityHighPassShader.js';

/**
 * RobustCinematicBloomPass
 *
 * Implements the full multi-tier Gaussian blur bloom pipeline (identical to UnrealBloomPass)
 * with crucial anti-NaN and precision protections:
 *
 * 1. Safe bright extraction: Replaces NaN or Infinity samples with 0.0, avoiding NaN contagion
 *    in the blur mips (which causes flickering black squares on Windows ANGLE / mobile WebGL).
 * 2. Safe separable blur: Guarantees weightSum > 0 and guards sample values.
 * 3. Additive blending onto readBuffer without clearing or corrupting the input texture.
 */
export class RobustCinematicBloomPass extends Pass {
  constructor(resolution, strength = 0.85, radius = 0.75, threshold = 0.55) {
    super();

    this.strength = strength;
    this.radius = radius;
    this.threshold = threshold;
    this.resolution = resolution !== undefined
      ? new THREE.Vector2(resolution.x, resolution.y)
      : new THREE.Vector2(256, 256);

    this.clearColor = new THREE.Color(0, 0, 0);

    // Use HalfFloatType for high dynamic range bloom glow
    const pars = {
      type: THREE.HalfFloatType
    };

    let resx = Math.max(1, Math.round(this.resolution.x / 2));
    let resy = Math.max(1, Math.round(this.resolution.y / 2));

    this.renderTargetBright = new THREE.WebGLRenderTarget(resx, resy, pars);
    this.renderTargetBright.texture.name = 'RobustCinematicBloom.bright';
    this.renderTargetBright.texture.generateMipmaps = false;

    this.nMips = 5;
    this.renderTargetsHorizontal = [];
    this.renderTargetsVertical = [];

    for (let i = 0; i < this.nMips; i++) {
      const rtH = new THREE.WebGLRenderTarget(resx, resy, pars);
      rtH.texture.name = 'RobustCinematicBloom.h' + i;
      rtH.texture.generateMipmaps = false;
      this.renderTargetsHorizontal.push(rtH);

      const rtV = new THREE.WebGLRenderTarget(resx, resy, pars);
      rtV.texture.name = 'RobustCinematicBloom.v' + i;
      rtV.texture.generateMipmaps = false;
      this.renderTargetsVertical.push(rtV);

      resx = Math.max(1, Math.round(resx / 2));
      resy = Math.max(1, Math.round(resy / 2));
    }

    // High pass filter shader with NaN protection & clamp
    this.highPassUniforms = THREE.UniformsUtils.clone(LuminosityHighPassShader.uniforms);
    this.highPassUniforms['luminosityThreshold'].value = threshold;
    this.highPassUniforms['smoothWidth'].value = 0.05;

    this.materialHighPassFilter = new THREE.ShaderMaterial({
      uniforms: this.highPassUniforms,
      vertexShader: LuminosityHighPassShader.vertexShader,
      fragmentShader: `
        #include <common>
        uniform sampler2D tDiffuse;
        uniform vec3 defaultColor;
        uniform float defaultOpacity;
        uniform float luminosityThreshold;
        uniform float smoothWidth;
        varying vec2 vUv;

        // Anti-NaN check
        bool isBadVal(float f) {
          return !(f >= 0.0 || f < 0.0);
        }

        void main() {
          vec4 texel = texture2D(tDiffuse, vUv);

          // If texel contains NaN or Inf, kill it to prevent black tile blur propagation
          if (isBadVal(texel.r) || isBadVal(texel.g) || isBadVal(texel.b) || isBadVal(texel.a)) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, defaultOpacity);
            return;
          }

          vec3 safeRgb = clamp(texel.rgb, 0.0, 64.0);
          float v = luminance(safeRgb);
          float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);

          vec3 outCol = mix(defaultColor.rgb, safeRgb, alpha);
          gl_FragColor = vec4(outCol, defaultOpacity);
        }
      `
    });

    // Gaussian blur materials
    this.separableBlurMaterials = [];
    const kernelSizeArray = [3, 5, 7, 9, 11];
    resx = Math.max(1, Math.round(this.resolution.x / 2));
    resy = Math.max(1, Math.round(this.resolution.y / 2));

    for (let i = 0; i < this.nMips; i++) {
      this.separableBlurMaterials.push(this._getSeparableBlurMaterial(kernelSizeArray[i]));
      this.separableBlurMaterials[i].uniforms['invSize'].value = new THREE.Vector2(1 / resx, 1 / resy);
      resx = Math.max(1, Math.round(resx / 2));
      resy = Math.max(1, Math.round(resy / 2));
    }

    // Composite material to combine the 5 blur mips
    this.compositeMaterial = this._getCompositeMaterial(this.nMips);
    this.compositeMaterial.uniforms['blurTexture1'].value = this.renderTargetsVertical[0].texture;
    this.compositeMaterial.uniforms['blurTexture2'].value = this.renderTargetsVertical[1].texture;
    this.compositeMaterial.uniforms['blurTexture3'].value = this.renderTargetsVertical[2].texture;
    this.compositeMaterial.uniforms['blurTexture4'].value = this.renderTargetsVertical[3].texture;
    this.compositeMaterial.uniforms['blurTexture5'].value = this.renderTargetsVertical[4].texture;
    this.compositeMaterial.uniforms['bloomStrength'].value = strength;
    this.compositeMaterial.uniforms['bloomRadius'].value = radius;

    const bloomFactors = [1.0, 0.8, 0.6, 0.4, 0.2];
    this.compositeMaterial.uniforms['bloomFactors'].value = bloomFactors;
    this.compositeMaterial.uniforms['bloomTintColors'].value = [
      new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(1, 1, 1)
    ];

    // Final additive blend pass back onto the scene (matches UnrealBloomPass)
    const copyShader = CopyShader;
    this.copyUniforms = THREE.UniformsUtils.clone(copyShader.uniforms);
    this.blendMaterial = new THREE.ShaderMaterial({
      uniforms: this.copyUniforms,
      vertexShader: copyShader.vertexShader,
      fragmentShader: copyShader.fragmentShader,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });

    this.enabled = true;
    this.needsSwap = false;
    this._oldClearColor = new THREE.Color();
    this.oldClearAlpha = 1;
    this.basic = new THREE.MeshBasicMaterial();
    this.fsQuad = new FullScreenQuad(null);
  }

  dispose() {
    for (let i = 0; i < this.renderTargetsHorizontal.length; i++) {
      this.renderTargetsHorizontal[i].dispose();
    }
    for (let i = 0; i < this.renderTargetsVertical.length; i++) {
      this.renderTargetsVertical[i].dispose();
    }
    this.renderTargetBright.dispose();
    for (let i = 0; i < this.separableBlurMaterials.length; i++) {
      this.separableBlurMaterials[i].dispose();
    }
    this.compositeMaterial.dispose();
    this.blendMaterial.dispose();
    this.materialHighPassFilter.dispose();
    this.basic.dispose();
    this.fsQuad.dispose();
  }

  setSize(width, height) {
    let resx = Math.max(1, Math.round(width / 2));
    let resy = Math.max(1, Math.round(height / 2));
    this.renderTargetBright.setSize(resx, resy);

    for (let i = 0; i < this.nMips; i++) {
      this.renderTargetsHorizontal[i].setSize(resx, resy);
      this.renderTargetsVertical[i].setSize(resx, resy);
      this.separableBlurMaterials[i].uniforms['invSize'].value = new THREE.Vector2(1 / resx, 1 / resy);
      resx = Math.max(1, Math.round(resx / 2));
      resy = Math.max(1, Math.round(resy / 2));
    }
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    renderer.getClearColor(this._oldClearColor);
    this.oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    renderer.setClearColor(this.clearColor, 0);

    if (maskActive) renderer.state.buffers.stencil.setTest(false);

    // If renderToScreen, render input first
    if (this.renderToScreen) {
      this.fsQuad.material = this.basic;
      this.basic.map = readBuffer.texture;
      renderer.setRenderTarget(null);
      renderer.clear();
      this.fsQuad.render(renderer);
    }

    // 1. Extract bright areas with high-pass threshold
    this.highPassUniforms['tDiffuse'].value = readBuffer.texture;
    this.highPassUniforms['luminosityThreshold'].value = this.threshold;
    this.fsQuad.material = this.materialHighPassFilter;

    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.fsQuad.render(renderer);

    // 2. Blur all mips progressively
    let inputRenderTarget = this.renderTargetBright;

    for (let i = 0; i < this.nMips; i++) {
      this.fsQuad.material = this.separableBlurMaterials[i];
      this.separableBlurMaterials[i].uniforms['colorTexture'].value = inputRenderTarget.texture;
      this.separableBlurMaterials[i].uniforms['direction'].value = new THREE.Vector2(1.0, 0.0);

      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this.fsQuad.render(renderer);

      this.separableBlurMaterials[i].uniforms['colorTexture'].value = this.renderTargetsHorizontal[i].texture;
      this.separableBlurMaterials[i].uniforms['direction'].value = new THREE.Vector2(0.0, 1.0);

      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this.fsQuad.render(renderer);

      inputRenderTarget = this.renderTargetsVertical[i];
    }

    // 3. Composite all mips together
    this.fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms['bloomStrength'].value = this.strength;
    this.compositeMaterial.uniforms['bloomRadius'].value = this.radius;

    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.fsQuad.render(renderer);

    // 4. Blend additive bloom over readBuffer or write directly to target
    this.fsQuad.material = this.blendMaterial;
    this.copyUniforms['tDiffuse'].value = this.renderTargetsHorizontal[0].texture;

    if (maskActive) renderer.state.buffers.stencil.setTest(true);

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(readBuffer);
      this.fsQuad.render(renderer);
    }

    // Restore renderer state
    renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }

  _getSeparableBlurMaterial(kernelRadius) {
    const coefficients = [];
    for (let i = 0; i < kernelRadius; i++) {
      coefficients.push(0.39894 * Math.exp(-0.5 * i * i / (kernelRadius * kernelRadius)) / kernelRadius);
    }

    return new THREE.ShaderMaterial({
      defines: { 'KERNEL_RADIUS': kernelRadius },
      uniforms: {
        'colorTexture': { value: null },
        'invSize': { value: new THREE.Vector2(0.5, 0.5) },
        'direction': { value: new THREE.Vector2(0.5, 0.5) },
        'gaussianCoefficients': { value: coefficients }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        #include <common>
        uniform sampler2D colorTexture;
        uniform vec2 invSize;
        uniform vec2 direction;
        uniform float gaussianCoefficients[KERNEL_RADIUS];
        varying vec2 vUv;

        bool isBadVal(float f) {
          return !(f >= 0.0 || f < 0.0);
        }

        void main() {
          float weightSum = gaussianCoefficients[0];
          vec3 diffuseSum = texture2D(colorTexture, vUv).rgb * weightSum;
          if (isBadVal(diffuseSum.r) || isBadVal(diffuseSum.g) || isBadVal(diffuseSum.b)) {
            diffuseSum = vec3(0.0);
          }

          for (int i = 1; i < KERNEL_RADIUS; i++) {
            float x = float(i);
            float w = gaussianCoefficients[i];
            vec2 uvOffset = direction * invSize * x;
            vec3 s1 = texture2D(colorTexture, vUv + uvOffset).rgb;
            vec3 s2 = texture2D(colorTexture, vUv - uvOffset).rgb;
            if (isBadVal(s1.r) || isBadVal(s1.g) || isBadVal(s1.b)) s1 = vec3(0.0);
            if (isBadVal(s2.r) || isBadVal(s2.g) || isBadVal(s2.b)) s2 = vec3(0.0);
            diffuseSum += (s1 + s2) * w;
            weightSum += 2.0 * w;
          }
          gl_FragColor = vec4(diffuseSum / max(weightSum, 0.0001), 1.0);
        }
      `
    });
  }

  _getCompositeMaterial(nMips) {
    return new THREE.ShaderMaterial({
      defines: { 'NUM_MIPS': nMips },
      uniforms: {
        'blurTexture1': { value: null },
        'blurTexture2': { value: null },
        'blurTexture3': { value: null },
        'blurTexture4': { value: null },
        'blurTexture5': { value: null },
        'bloomStrength': { value: 1.0 },
        'bloomRadius': { value: 0.0 },
        'bloomFactors': { value: null },
        'bloomTintColors': { value: null }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D blurTexture1;
        uniform sampler2D blurTexture2;
        uniform sampler2D blurTexture3;
        uniform sampler2D blurTexture4;
        uniform sampler2D blurTexture5;
        uniform float bloomStrength;
        uniform float bloomRadius;
        uniform float bloomFactors[NUM_MIPS];
        uniform vec3 bloomTintColors[NUM_MIPS];

        float lerpBloomFactor(const in float factor) {
          float mirrorFactor = 1.2 - factor;
          return mix(factor, mirrorFactor, bloomRadius);
        }

        void main() {
          gl_FragColor = bloomStrength * (
            lerpBloomFactor(bloomFactors[0]) * vec4(bloomTintColors[0], 1.0) * texture2D(blurTexture1, vUv) +
            lerpBloomFactor(bloomFactors[1]) * vec4(bloomTintColors[1], 1.0) * texture2D(blurTexture2, vUv) +
            lerpBloomFactor(bloomFactors[2]) * vec4(bloomTintColors[2], 1.0) * texture2D(blurTexture3, vUv) +
            lerpBloomFactor(bloomFactors[3]) * vec4(bloomTintColors[3], 1.0) * texture2D(blurTexture4, vUv) +
            lerpBloomFactor(bloomFactors[4]) * vec4(bloomTintColors[4], 1.0) * texture2D(blurTexture5, vUv)
          );
        }
      `
    });
  }
}
