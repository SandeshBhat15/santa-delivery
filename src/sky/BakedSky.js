import * as THREE from 'three';

/**
 * BakedSky - mobile-friendly version of the existing procedural sky. Same look, ~20x cheaper.
 *
 * The original dome runs a 32-step, 4-curtain volumetric aurora ray-march for EVERY sky pixel, every frame.
 * The aurora is soft and slow, so it is evaluated into a small equirectangular texture instead
 * (default 512x192, HalfFloat). Each frame only ONE horizontal band of that texture is refreshed
 * (3 bands -> ~20 Hz, evenly spread, no spikes). The dome then does a single texture fetch per pixel
 * and keeps the cheap live base sky (gradient, moon glare, milky way).
 *
 * Cost on the phone: 1 extra tiny draw call per frame, ~0.75 MB of VRAM, no new lights, no new passes.
 *
 * Usage (see main.js patch):
 *   const bakedSky = createBakedSky(renderer, WINTER_SKY_AND_AURORA_GLSL, skyUniforms);
 *   const skyDomeMat = bakedSky.material;              // instead of the full ray-march material
 *   bakedSky.warm(elapsedTime, camera.position);      // once, during the loading screen
 *   bakedSky.update(elapsedTime, camera.position);    // every frame, before composer.render()
 */
export function createBakedSky(renderer, fullGLSL, skyUniforms, options = {}) {
  const width  = options.width  ?? 512;
  const height = options.height ?? 192;
  const bands  = Math.max(1, options.bands ?? 3);
  const elMin  = options.elMin  ?? -0.12;        // lowest elevation (radians) stored in the texture
  const steps  = options.steps  ?? 32;           // ray-march steps used by the bake (same as the original)
  const EL_MIN = elMin.toFixed(5);
  const EL_MAX = (Math.PI / 2).toFixed(7);

  const glsl = steps === 32 ? fullGLSL : fullGLSL.replace('const int STEPS = 32;', `const int STEPS = ${steps | 0};`);
  const structAt = fullGLSL.indexOf('struct AuroraCurtainDef');
  if (structAt < 0) throw new Error('[BakedSky] could not find the aurora section in the sky GLSL');
  const baseGLSL = fullGLSL.slice(0, structAt);   // gradHash22, gradNoise2D, evaluateWinterNightSky

  // ---------- Bake target ----------
  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,            // azimuth wraps around
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false
  });
  rt.texture.name = 'AuroraBake';

  const bakeUniforms = { uTime: { value: 0 }, uCameraPos: { value: new THREE.Vector3() } };
  const bakeMaterial = new THREE.ShaderMaterial({
    uniforms: bakeUniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uCameraPos;
      varying vec2 vUv;
      ${glsl}
      void main() {
        float az = (vUv.x - 0.5) * 6.2831853;
        float el = mix(${EL_MIN}, ${EL_MAX}, vUv.y);
        vec3 rd = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
        gl_FragColor = raymarch3DAurora(uCameraPos, rd, uTime);
      }
    `,
    depthTest: false,
    depthWrite: false
  });

  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(tri, bakeMaterial);
  quad.frustumCulled = false;
  const bakeScene = new THREE.Scene();
  bakeScene.add(quad);
  const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---------- Dome material (cheap): live base sky + one texture fetch for the aurora ----------
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMoonDir: skyUniforms.uMoonDir,
      uWeatherOvercast: skyUniforms.uWeatherOvercast,
      tAurora: { value: rt.texture }
    },
    vertexShader: `
      varying vec3 vRayDir;
      void main() {
        vRayDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uMoonDir;
      uniform float uWeatherOvercast;
      uniform sampler2D tAurora;
      varying vec3 vRayDir;

      ${baseGLSL}

      void main() {
        vec3 rd = normalize(vRayDir);
        vec3 baseSky = evaluateWinterNightSky(rd, uMoonDir);

        vec2 auv = vec2(atan(rd.z, rd.x) * 0.15915494 + 0.5,
                        (asin(clamp(rd.y, -1.0, 1.0)) - (${EL_MIN})) / (${EL_MAX} - (${EL_MIN})));
        vec4 aurora = texture2D(tAurora, auv);

        vec3 overcastHaze = vec3(0.045, 0.065, 0.115);
        baseSky = mix(baseSky, overcastHaze, uWeatherOvercast * 0.75);
        float auroraSuppression = 1.0 - uWeatherOvercast * 0.85;

        vec3 composite = baseSky * (1.0 - aurora.a * 0.32 * auroraSuppression) + (aurora.rgb * 1.35) * auroraSuppression;
        gl_FragColor = vec4(composite, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: true,
    fog: false
  });

  // ---------- Baking ----------
  let band = 0;

  function renderBands(from, to) {
    for (let b = from; b < to; b++) {
      const y0 = Math.floor((b * height) / bands);
      const y1 = Math.floor(((b + 1) * height) / bands);
      rt.scissor.set(0, y0, width, y1 - y0);   // set BEFORE setRenderTarget, which applies it
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.render(bakeScene, bakeCamera);
    }
    rt.scissorTest = false;
  }

  function run(time, cameraPos, all) {
    bakeUniforms.uTime.value = time;
    bakeUniforms.uCameraPos.value.copy(cameraPos);
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    if (all) renderBands(0, bands);
    else { renderBands(band, band + 1); band = (band + 1) % bands; }
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  return {
    material,
    texture: rt.texture,
    bands,
    /** Bake the whole texture once (compiles the bake shader). Call during the loading screen. */
    warm(time, cameraPos) { run(time, cameraPos, true); },
    /** Refresh one band. Call every frame before the main render / composer. */
    update(time, cameraPos) { run(time, cameraPos, false); },
    dispose() { rt.dispose(); bakeMaterial.dispose(); material.dispose(); tri.dispose(); }
  };
}
