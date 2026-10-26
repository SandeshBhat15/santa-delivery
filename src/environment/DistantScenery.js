import * as THREE from 'three';

/**
 * Creates seamless, low-poly distant dark blue mountain silhouettes along the far horizon.
 * - Perfectly seamless 360-degree cylindrical geometry (no flat planes or horizontal seam cuts).
 * - Taller, varied mountain ridges with organic peaks, jagged saddles, and valleys.
 * - Sits strictly in the background (renderOrder = -19, depthTest: true, depthWrite: false).
 * - Base submerged safely below the horizon so no gap can appear.
 * - Colors accurately calibrated to horizon sky (vec3(0.0044, 0.0110, 0.0284)).
 * - Low-poly & mobile-optimized: 64 segments * 2 * 3 = 384 triangles total, 1 shared shader material, 3 draw calls.
 */
export function createDistantMountains(skyGroup, skyUniforms) {
  const mountainGroup = new THREE.Group();
  mountainGroup.name = 'DistantMountainBackdropGroup';
  skyGroup.add(mountainGroup);

  const mountainShaderMat = new THREE.ShaderMaterial({
    uniforms: {
      uMoonDir: skyUniforms.uMoonDir,
      uWeatherOvercast: skyUniforms.uWeatherOvercast
    },
    vertexShader: `
      attribute float aAltitude;
      attribute float aLayer;
      varying vec3 vWorldNormal;
      varying float vAltitude;
      varying float vLayer;

      void main() {
        vAltitude = aAltitude;
        vLayer = aLayer;
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uMoonDir;
      uniform float uWeatherOvercast;

      varying vec3 vWorldNormal;
      varying float vAltitude;
      varying float vLayer;

      void main() {
        // Horizon sky color exactly matching evaluateWinterNightSky at y = 0 (#0e1b2f)
        vec3 horizonNavy = vec3(0.0044, 0.0110, 0.0284);
        vec3 midNavy     = vec3(0.0024, 0.0065, 0.0194);
        vec3 darkNavy    = vec3(0.0012, 0.0030, 0.0091);

        // Dark blue mountain silhouette base tones per layer (0: Far, 1: Mid, 2: Near)
        vec3 farTone  = mix(horizonNavy, midNavy, 0.50);
        vec3 midTone  = mix(midNavy, darkNavy, 0.60);
        vec3 nearTone = mix(darkNavy, vec3(0.0008, 0.0020, 0.0065), 0.70);

        vec3 baseTone = (vLayer < 0.5) ? farTone : ((vLayer < 1.5) ? midTone : nearTone);

        // Directional facet lighting from moon direction
        float nDotL = clamp(dot(vWorldNormal, uMoonDir), 0.0, 1.0);
        vec3 litColor = baseTone * (0.86 + 0.28 * nDotL);

        // Soft cool midnight rim along highest peak crests
        float crest = smoothstep(0.40, 1.0, vAltitude);
        vec3 crestColor = mix(litColor, vec3(0.0055, 0.0135, 0.0350), crest * 0.35);

        // Base blends seamlessly into horizonNavy at the ground line
        vec3 finalRgb = mix(horizonNavy, crestColor, smoothstep(0.0, 0.45, vAltitude));

        // Weather overcast dimming during blizzards
        vec3 overcastTone = vec3(0.0018, 0.0036, 0.0095);
        finalRgb = mix(finalRgb, overcastTone, uWeatherOvercast * 0.70);

        // Antialias top peak crest smoothly into the night sky
        float topFade = 1.0 - smoothstep(0.92, 1.0, vAltitude);
        float layerAlpha = (vLayer < 0.5) ? 0.88 : ((vLayer < 1.5) ? 0.94 : 0.98);
        float alpha = topFade * layerAlpha;

        gl_FragColor = vec4(finalRgb, alpha);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: true,
    fog: false
  });

  function createMountainRibbonGeometry(radius, baseHeight, peakMin, peakMax, segments, layerIndex, seed) {
    const geo = new THREE.BufferGeometry();
    const positions = [];
    const altitudes = [];
    const layers = [];
    const indices = [];

    // Continuous circular harmonics guarantee seamless 2*PI looping without seams or repeating patterns.
    // Rich harmonic spectrum creates varied jagged mountain peaks, saddles, and deep valleys.
    const topHeights = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2.0;

      // Primary mountain clusters (broad massifs)
      const h1 = Math.sin(angle * 2.0 + seed * 1.7) * 0.38;
      // Secondary ridges
      const h2 = Math.sin(angle * 5.0 - seed * 2.3) * 0.25;
      // Jagged crags and sharp peaks
      const h3 = Math.cos(angle * 9.0 + seed * 3.9) * 0.18;
      // Fine peak irregularities
      const h4 = Math.sin(angle * 16.0 + seed * 0.7) * 0.11;
      // Deep valley cuts
      const valley = Math.sin(angle * 3.0 + seed * 0.5);
      const valleyMod = 0.85 + 0.15 * valley;

      const combined = Math.max(0.0, Math.min(1.0, ((h1 + h2 + h3 + h4 + 0.95) * 0.5) * valleyMod));
      const peakHeight = peakMin + combined * (peakMax - peakMin);
      topHeights.push(peakHeight);
    }

    // Cylinder quad strip: vertex pairs (bottom, top)
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2.0;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Bottom vertex placed well below horizon line (-80m to -50m)
      positions.push(cosA * radius, baseHeight, sinA * radius);
      altitudes.push(0.0);
      layers.push(layerIndex);

      // Top vertex (mountain crest)
      const h = topHeights[i];
      positions.push(cosA * radius, baseHeight + h, sinA * radius);
      altitudes.push(1.0);
      layers.push(layerIndex);
    }

    // Quad indices
    for (let i = 0; i < segments; i++) {
      const b0 = i * 2;
      const t0 = i * 2 + 1;
      const b1 = (i + 1) * 2;
      const t1 = (i + 1) * 2 + 1;

      indices.push(b0, b1, t0);
      indices.push(t0, b1, t1);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aAltitude', new THREE.Float32BufferAttribute(altitudes, 1));
    geo.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return geo;
  }

  // 3 Taller, varied silhouette layers:
  // Radii: 880m, 740m, 620m
  // Base at -80m to -50m keeps base submerged safely below the horizon from any camera pitch or altitude.
  // Peak heights (75m to 185m) provide prominent alpine ridges (~8°-12° elevation),
  // leaving the upper sky (>15°) and animated aurora completely clear and visible.
  // 64 segments per layer = 128 triangles * 3 = 384 triangles total.
  const mountainLayers = [
    { radius: 880, base: -80, peakMin: 105, peakMax: 185, segments: 64, layer: 0, seed: 1.42, renderOrder: -19 },
    { radius: 740, base: -65, peakMin: 75,  peakMax: 140, segments: 64, layer: 1, seed: 4.87, renderOrder: -19 },
    { radius: 620, base: -50, peakMin: 55,  peakMax: 105, segments: 64, layer: 2, seed: 8.35, renderOrder: -19 }
  ];

  mountainLayers.forEach((layerDef) => {
    const geo = createMountainRibbonGeometry(
      layerDef.radius,
      layerDef.base,
      layerDef.peakMin,
      layerDef.peakMax,
      layerDef.segments,
      layerDef.layer,
      layerDef.seed
    );
    const mesh = new THREE.Mesh(geo, mountainShaderMat);
    mesh.renderOrder = layerDef.renderOrder;
    mesh.frustumCulled = false;
    mesh.name = `DistantMountainLayer_${layerDef.layer}`;
    mountainGroup.add(mesh);
  });

  return mountainGroup;
}
