# Technical Architecture Survey & Codebase Analysis: Santa's Gift Delivery

**Survey Date**: 2026-11-08  
**Investigator**: `explorer_survey_1` (Teamwork Explorer)  
**Target Codebase**: `d:\Sandesh\Personal Work\Antigravity Projects\Santa Delivery`  
**Reference Visual**: `C:/Users/Sandesh Bhat/.gemini/antigravity/brain/ea500835-4374-408c-99be-9747de125064/.user_uploaded/media_1794114967133_ffcac50a.jpg`

---

## 1. Project Overview & Build Environment

| File / Component | Details / Configuration | Observations |
|---|---|---|
| **`package.json`** | Vite 6.0.0, Three.js ^0.170.0, Meshoptimizer ^1.3.0, draco3d ^1.5.9 | Pure vanilla JavaScript (ES modules) + Three.js. No React/Vue/Svelte framework. All UI is native DOM/CSS. |
| **`vite.config.js`** | Port 5173, `host: true` (allows Wi-Fi mobile testing), `build.target: 'esnext'`, `assetsInlineLimit: 0` (preserves external binary assets) | Standard Vite bundler. Very fast HMR. |
| **`index.html`** | Single page entry. Viewport configured with `viewport-fit=cover`, `maximum-scale=1.0`, `user-scalable=no`. Roots: `#app` (canvas container), `#ui-container`, `#loader`. | Loads `/src/main.js` and `/src/style.css`. |
| **`public/` Assets** | 3D models: `santa&deer.glb`, `terrain.glb`, `terrain-mobile.glb`. Draco decoders in `/libs/draco/gltf/`. Audio files: 9 MP3 tracks (`bgm_morning_frost.mp3`, `bgm_jingle_bells.mp3`, `delivery_success.mp3`, `star_collect.mp3`, `beacon_burst.mp3`, `level_complete.mp3`, `crash.mp3`, `gift_drop.mp3`, `sleigh_bells.mp3`, `wind_loop.mp3`). | All 3D and audio assets are locally hosted in `public/`. |

---

## 2. Core Architecture Mapping

```
                                  +-------------------+
                                  |     index.html    |
                                  +---------+---------+
                                            |
                                            v
                                   +-----------------+
                                   |   src/main.js   | <---+ (rAF Loop)
                                   +--------+--------+
                                            |
         +-------------------+--------------+-------------+--------------------+
         |                   |                            |                    |
         v                   v                            v                    v
+------------------+ +-----------------+        +-------------------+ +-------------------+
| Three.js Pipeline| | SleighController|        |   DeliverySystem  | |    SoundManager   |
| - Renderer (PCF) | | - Flight Phys   |        | - Run: 5 stops    | | - Web Audio Busses|
| - KawaseBloomPass| | - Inputs (Kbd)  |        | - Auto-Delivery   | | - BGM Loop        |
| - BakedSky/Aurora| | - Dual-axis Joy | <----+ | - Target Beacons  | | - SFX Triggers    |
| - BatchedChunks  | | - Collision/Alt |        | - 6 Route Stars   | | - Dynamic Wind/Bell|
+------------------+ +-----------------+        +---------+---------+ +-------------------+
                                                          |
                               +--------------------------+--------------------------+
                               |                                                     |
                               v                                                     v
                    +----------------------+                              +----------------------+
                    |  GiftDropMarker.js   |                              | TargetGuidanceFlow.js|
                    |  - Tall Gold Beacon  |                              | - Off-Course Wind    |
                    |  - Chimney Star Icon |                              | - 3D Bézier Stream   |
                    |  - Pulse / Burst     |                              | - Proximity Dissolve |
                    +----------------------+                              +----------------------+
```

### 2.1 Game Engine & Animation Loop (`src/main.js`)
- **Main Loop**: Managed by `animate(currentTime)` calling `requestAnimationFrame(animate)` (lines 3115–3423).
- **Time Delta**: `clock.getDelta()` and `clock.getElapsedTime()` drive all sub-systems.
- **FPS Supervisor**: Evaluates 2-second moving averages (lines 3141–3168). If FPS drops below 48, DPR dynamically steps down to maintain smooth frame rates.
- **Execution Order per Frame**:
  1. `sleighController.update(delta, elapsedTime)`
  2. `soundManager.updateFlight(speed, altitude, pitch, isSkimming, weatherIntensity)`
  3. `deliverySystem.update(delta, elapsedTime)`
  4. `chunkSystem.update(streamFocus, camera)`
  5. `mobileOptimizer.update(delta, focusPos, fps)`
  6. Environment shaders & particle anchors (Sky, Snow, Hearth flicker, Lighting)
  7. Directional shadow snapping to prevent sub-pixel texel crawling
  8. `composer.render()` (or `renderer.render()` if bloom/composer disabled)
  9. FPS counter DOM update (`#fps-counter`)

### 2.2 Three.js & Rendering Pipeline
- **Renderer**: `THREE.WebGLRenderer` configured with `antialias: true`, `powerPreference: 'high-performance'`, `ACESFilmicToneMapping`, `toneMappingExposure: 0.95`.
- **Shadow System**: Directional `moonLight` using `THREE.PCFSoftShadowMap` with a custom shader patch on `shadowmap_pars_fragment` applying 16% edge feathering to eliminate harsh shadow boundaries (`main.js:24-37`).
- **Post-Processing**: `EffectComposer` -> `RenderPass` -> `KawaseBloomPass` (res scaled, strength 1.4, threshold 0.32, radius 2.2) -> `OutputPass`.
- **Procedural Sky & Atmosphere**: `BakedSky.js` and unified procedural winter night sky shader with 3D volumetric raymarched aurora borealis and Milky Way.
- **Terrain Streaming**: `BatchedChunkSystem.js` dynamically streams chunks within load radius 2 around Santa's position.

### 2.3 Flight Physics & Controls (`src/gameplay/SleighController.js`)
- **3D Rig**: `MasterSantaRig` contains Santa, sledge, and 4 pairs of animated reindeer with continuous running animations.
- **Velocity & Heading**: Sleigh maintains forward cruising velocity (base 1.8, boost 2.8) in local `-Z` heading.
- **Steering**:
  - `turnSpeed`: 1.75 (desktop), 1.45 (mobile).
  - Exponential spring responsiveness (`this.turnVelocity`) with aerodynamic banking roll (`this.bank` up to 0.32 rad).
  - Inputs: Keyboard A/D or Left/Right arrows, OR analog `joystick.x` [-1..1].
- **Altitude Control**:
  - Pure manual vertical flight with no automatic terrain pulling (`climbRate`: 1.85, `diveRate`: 2.45).
  - Maximum ceiling clamp: 3.2m above terrain with smooth damping.
  - Inputs: Keyboard W/S or Up/Down arrows, OR analog `joystick.y` [-1..1] (push forward climbs, pull back dives).
- **Collision Detection**:
  - Terrain collision: Checks terrain height via `chunkSystem.getHeight(x, z)`. If sleigh altitude $\le$ 0.05m above ground, triggers `deliverySystem.handleCrash('terrain')`.
  - House collision: Detects bounding intersections with cottage rooftops/structures. Triggers `deliverySystem.handleCrash('house')`.

### 2.4 Delivery Detection & Auto-Delivery (`src/gameplay/DeliverySystem.js`)
- **Run Definition**: Exactly 5 deliveries per run (`this.deliveriesRequired = 5`).
- **Continuous Collision Detection (CCD)** (`_checkFlyThroughDelivery`, lines 1056–1130):
  - Checks if the 3D line segment between `_prevSleighPos` and `currentPos` intersects the active cottage's floating beacon volume (horizontal radius 0.16m–0.22m, altitude centered at `targetBase.y + iconHeight`).
  - Completely automatic; requires NO manual drop button.
- **Auto Drop & Delivery Sequence**:
  1. Once beacon volume is entered, `_triggerFlyThroughDelivery()` is invoked.
  2. Santa performs an athletic forward throw animation (`sleighController.triggerThrow()`).
  3. A 3D gift box with ribbon is launched from Santa's drop origin (`getDropOrigin()`) along a parabolic gravity arc into the chimney (`_spawnChimneyTouchdown()`).
  4. On chimney impact: `_handleSuccessfulDelivery()` is triggered.
  5. Celebration: Sparkle burst (`_spawnSparkleBurst()`), chimney hearth embers flare, and chime audio (`soundManager.playSuccess()` or `playCombo(combo)`).
  6. Next target activated after 350ms (`_setNextTarget()`).
  7. On 5th delivery: `_finishRun(true)` triggered after 900ms.

### 2.5 Cottage Beacons & Chimney Stars (`src/gameplay/GiftDropMarker.js`)
- **Beacon Visual**: Tall golden cylinder (height 12.0m–45.0m, radius 0.055m–0.085m) with soft additive shader fading into the night sky (`_createBeamMaterial()`).
- **Chimney Star / Emblem**:
  - 3D faceted celestial diamond star geometry (`_createFacetedStarGeometry()`) or luminous circular neon snowflake badge (`_buildIcon()`).
  - Floats above the chimney ridge (`iconHeight: 0.48m`).
  - Animates hover bobbing and gentle rotation.
  - State changes: `'default'` (golden glow) to `'inrange'` (emerald green with checkmark badge) when Santa approaches.

### 2.6 Bonus Route Stars (`src/gameplay/DeliverySystem.js`)
- **Spawning**: `_spawnRouteStars()` places 6 optional collectible golden stars along the route between target stops.
- **Animation**: Serene multi-axis rotation, celestial flare pulse, and floating hover bob (`_updateStars()`).
- **Collection**:
  - Triggered when Santa flies within 0.35m radius.
  - Spawns expanding horizontal shockwave ring (`_spawnShockwaveRing()`), diamond stardust burst, and floating world-space score popup (`+50 🌟`).
  - Audio: `soundManager.playStar()`.
  - State: `this.starsCollected++`, `this.starScore += 50`, `this.score = this.deliveryScore + this.starScore`.

### 2.7 Off-Course Particle Guidance (`src/gameplay/TargetGuidanceFlow.js`)
- **Concept**: Ghost of Tsushima-inspired golden stardust stream ("Guiding Wind").
- **Mechanism**: Emits directly in front of the lead reindeer (+0.85m) and flows along a dynamic 3D cubic Bézier curve towards the active chimney.
- **Trigger Conditions**:
  - Auto-summoned when the player heads away from the target for $> 3.5$ seconds (`this.lostTimer >= this.lostThreshold`).
  - Periodic gentle breeze every 5.0 seconds (`this.restDuration`).
  - Instant summon via 'G' key or `deliverySystem.summonGuidingWind()`.
- **Proximity Dissolve**: Dissolves cleanly within 2.5m of the chimney. No 2D HUD minimaps, compass needles, or permanent screen arrows are used.

### 2.8 Sound & Audio Engine (`src/gameplay/SoundManager.js`)
- **Architecture**: Web Audio API `AudioContext` with 4 dedicated gain sub-busses:
  - `masterGain` (0.80) -> destination
  - `musicGain` (0.28) -> master
  - `ambientGain` (0.18) -> master
  - `sfxGain` (0.65) -> master
- **BGM**: HTML5 audio streaming `/audio/bgm_morning_frost.mp3` with seamless loop.
- **Real-time Flight Audio**: Rhythmic brass sleigh bells triggered at galloping intervals (0.68s–1.05s) and dynamic lowpass-filtered wind loop modulated by pitch and weather.
- **Mute / Persistence**: Controlled by `#btn-audio-toggle` and persisted in `localStorage.getItem('santa_audio_enabled')`.

### 2.9 Scoring & Combo System
- **Delivery Points**: Base 100 points + precision bonus (up to 100) + perfect drop bonus (50) per chimney.
- **Combo Multiplier**: Increments with consecutive successful deliveries; plays pitch-scaled chime (`playCombo(this.combo)`).
- **Bonus Stars**: +50 points each (up to $6 \times 50 = 300$).
- **End-of-Run Bonus**: Accuracy bonus $\text{accPct} \times 300$.
- **Timer Bonus**: Required by R5 (points awarded per second remaining).

---

## 3. Current UI Elements & DOM Structure

### 3.1 Existing DOM Layout
All UI is rendered in the DOM above the WebGL `<canvas>`:

```html
<!-- index.html -->
<div id="app"><canvas></div>

<div id="ui-container">
  <button id="btn-audio-toggle" class="audio-btn">🔊</button>
  <div id="debug-info"><span id="fps-counter">FPS: --</span></div>
  <div id="hint-info"><span>A / D: Steer | W / S: Climb & Dive ...</span></div>

  <!-- Injected dynamically by DeliverySystem._createHUD() -->
  <div id="santa-hud">
    <!-- Top-left glassmorphism card -->
    <div class="hud-card hud-top-left hud-run-card">
      <div class="hud-row">🎁 DELIVERIES <span id="hud-deliveries">0 / 5</span></div>
      <div id="hud-progress-track"><span class="progress-pip"></span>...</div>
      <div class="hud-row">⭐ STARS <span id="hud-stars">0 / 6</span></div>
      <div class="hud-row">💎 SCORE <span id="hud-score">0</span></div>
      <div class="hud-row">🎯 ACCURACY <span id="hud-accuracy">--</span></div>
    </div>

    <!-- Notification banner -->
    <div id="hud-banner" class="hud-banner hidden"><span id="hud-banner-text"></span></div>

    <!-- Mobile controls -->
    <div id="mobile-controls-wrapper">
      <div id="joystick-zone">
        <div id="joystick-base"><div id="joystick-thumb"></div></div>
      </div>
      <div id="drop-zone">
        <div id="drop-status" class="drop-status far">FLY THROUGH BEACON</div>
      </div>
    </div>

    <!-- Crash vignette -->
    <div id="crash-flash" class="crash-flash"></div>

    <!-- Results overlay -->
    <div id="results-overlay" class="results-overlay hidden">
      <div class="results-card">
        <div class="results-glow"></div>
        <span class="results-kicker">SANTA'S SLEIGH RUN</span>
        <h2 id="results-title">DELIVERIES COMPLETE!</h2>
        <p id="results-subtitle">The village is warm and bright.</p>
        <div id="results-rating">★★★</div>
        <div class="results-grid">...</div>
        <button id="btn-replay" class="btn-replay">🎄 FLY AGAIN</button>
      </div>
    </div>
  </div>
</div>

<!-- Loading Screen -->
<div id="loader">
  <div class="loader-content">
    <h2>Loading Winter World...</h2>
    <div class="progress-bar-bg"><div id="progress-bar"></div></div>
    <p id="loader-status">0%</p>
  </div>
</div>
```

### 3.2 Evaluation of Current UI Against Requirements

| Feature | Current State | Requirement (R1–R5) & Reference Image | Status / Gap |
|---|---|---|---|
| **Main Menu** | **Missing completely**. Game starts immediately upon load (`deliverySystem.startRun(false)`). | Required: Desktop 16:9 & Mobile portrait main menu with festive ribbon banner, Play button, Instructions button, and decorative Santa/sleigh vignette. | **Major Gap** |
| **Instructions Overlay** | **Missing**. Only a tiny `#hint-info` keyboard text snippet at screen bottom. | Required: Instructions overlay/modal explaining flight controls (desktop keyboard, mobile joystick), delivery objective (5 beacons), bonus stars, and guiding wind. | **Major Gap** |
| **75-Second Countdown Timer** | **Missing from HUD & active loop**. Only a placeholder reference in `DeliverySystem.js:2039`. | Required: 75-second countdown timer in top HUD. Visual urgency pulsing when $< 15$ seconds remaining. Run timeout ends game if time expires. Remaining-time bonus on results screen. | **Critical Gap** |
| **Top HUD Layout** | Basic dark glassmorphism card huddled in the top-left corner (`.hud-card.hud-top-left`). | Required: Centered/balanced top HUD with festive pill containers: Deliveries (out of 5 with candy cane gauge), Timer (75s countdown), Bonus Stars/Score, and Pause/Mute. Unobstructed flight view. | **Major Redesign Needed** |
| **Mobile Joystick** | Existing `#joystick-zone`, `#joystick-base`, `#joystick-thumb` works on touch. | Required: Maintain existing dual-axis flight steering/altitude joystick without interfering with camera or gestures; portrait-first safe area positioning. | **Preserve & Re-skin** |
| **Results Screen** | Generic dark blue card (`.results-card`) with basic monospace numbers. Only has "Fly Again" button. | Required: Parchment-style festive panel (`#fdf6e2` cream parchment, snow-capped header, red ribbon title, 1–3 star glowing badges), breakdown (deliveries, stars, delivery score, remaining-time bonus, total score), and **both Play Again and Home** controls. | **Major Redesign Needed** |
| **Visual Style & Assets** | Dark navy semi-transparent boxes with generic emoji icons (🎁, ⭐, 💎, 🎯). | Required: Festive palette (rich red, gold, cream, snowy blue, navy) per reference image `media_1794114967133_ffcac50a.jpg`. Reusable modular DOM/SVG/CSS components. No flattened raster layouts; editable text/numbers. | **Major Visual Upgrade** |

---

## 4. State & Event Interfaces

### 4.1 Existing Hook Points in `DeliverySystem.js`
The existing codebase already contains placeholder calls anticipating a centralized `uiManager`:
- `this.uiManager.updateHUD({ deliveries, maxDeliveries, stars, totalStars, score })` (line 1994)
- `this.uiManager.showResults({ deliveries, maxDeliveries, stars, totalStars, deliveryScore, timeRemaining, reason })` (line 2033)
- `this.uiManager.showDeliveryToast(500)` (line 2622)
- `this.uiManager.setGuidance(guidanceText, state)` (line 2797)
- `this.uiManager.showScreen('playing')` (line 2097)
- `this.uiManager.timeRemaining` (read at line 2039)

### 4.2 Complete Interface Mapping for UI Redesign

```typescript
interface GameStateInterface {
  // Progression
  deliveriesMade: number;       // 0 to 5
  deliveriesRequired: number;   // 5
  starsCollected: number;       // 0 to 6
  starsTotal: number;           // 6
  timeRemaining: number;        // 75.0 down to 0.0 seconds
  score: number;                // Current total score
  combo: number;                // Consecutive delivery streak
  
  // Status & Guidance
  beaconProximityState: 'far' | 'approaching' | 'ready'; // Based on distance to active target
  isLowTime: boolean;           // timeRemaining < 15.0 seconds
  isGameOver: boolean;
  gameResult: 'win' | 'timeout' | 'crash';
  
  // Scoring Details for Results
  deliveryScore: number;
  starScore: number;
  timeBonus: number;            // Math.round(timeRemaining * 20)
  accuracyBonus: number;
  finalScore: number;
  starRating: 1 | 2 | 3;
}
```

### 4.3 Screen Flow State Machine
```
[Page Load] ---> [Loader / Warmup (0% - 100%)]
                         |
                         v (Assets warm)
                 [Main Menu Screen] <-----------------------+
                   |             |                          |
       (Play Click)|             |(Instructions Click)      |
                   v             v                          |
             [Playing HUD]   [Instructions Modal]           |
                   |                                        |
       +-----------+-----------+                            |
       | (5 Deliveries Win)    | (Timer Expire / Crash)     |
       v                       v                            |
  [Results Screen] <-----------+                            |
       |                                                    |
       +--(Play Again Click: startRun)----------------------+
       |                                                    |
       +--(Home Click: showScreen('menu'))------------------+
```

---

## 5. R1 Preservation Constraints & Invariant Rules

To ensure strict compliance with **Requirement R1 (Gameplay Rules and Core System Preservation)**, the UI redesign must respect the following invariant boundaries:

| System / Subsystem | Invariant Rules (DO NOT MODIFY) | Allowed UI Extensions |
|---|---|---|
| **Flight Physics (`SleighController.js`)** | DO NOT modify speed (1.8/2.8), turn momentum, bank angle calculation, climb/dive rates, ceiling/ground boundaries, or terrain collision logic. | Wire pause state (`isPaused = true`) when menus/results are active; listen to joystick inputs without changing math. |
| **Delivery Logic (`DeliverySystem.js`)** | DO NOT modify `_checkFlyThroughDelivery()`, `_triggerFlyThroughDelivery()`, throw physics, gift drop parabolic trajectory, or touchdown embers. DO NOT reintroduce manual gift-drop buttons. | Read `deliveriesMade`, `combo`, `score`, and invoke `startRun(true)`. Add the 75s countdown timer tick in game loop. |
| **Target Beacons & Stars (`GiftDropMarker.js`)** | DO NOT alter the 3D golden beam cylinder, beacon height (12m/45m), beam shader, or chimney star icon geometry. | Trigger minimal proximity state feedback in the HUD when entering beacon range. |
| **Bonus Route Stars** | Spawning positions, 0.35m collection radius, spinning/bobbing animations, and collection shockwave rings must remain untouched. | Display collected star count in HUD and results screen; play celebratory UI pickup toast. |
| **Off-Course Guidance (`TargetGuidanceFlow.js`)** | DO NOT add permanent HUD minimaps, compass arrows, or persistent 2D target markers. Guiding wind must remain a 3D stardust particle stream. | Support manual wind summon from key 'G' or subtle UI button if desired. |
| **Audio Engine (`SoundManager.js`)** | DO NOT modify Web Audio busses, volume balance, or SFX assets. | Wire audio mute/unmute to the top HUD audio button; trigger existing audio cues for menu clicks. |
| **Camera & Visual Atmosphere** | DO NOT alter camera field of view logic (50 desktop, 65 mobile), post-processing bloom, procedural sky/aurora, or chunk streaming. | Ensure DOM UI elements sit in `#ui-container` with transparent pass-through pointer events (`pointer-events: none` on container, `pointer-events: auto` on interactive buttons). |
| **Debug & Performance Tools** | `PerformanceDebugger.js`, `QualityPanel.js`, and `HardwareProfiler.js` must continue functioning via `?debug=1`. | Ensure `#debug-info` / FPS counter remains visible and uncorrupted. |

---

## 6. Synthesis & Recommendations for Downstream Work

1. **Architecture**: Implement a clean, modular UI layer (`src/ui/UIManager.js` and modular components) that cleanly decouples UI rendering from Three.js rendering.
2. **Visual Reference Fidelity**:
   - Utilize SVG vector badges and CSS styling to reproduce the festive red ribbons, scalloped snow caps, candy-cane progress gauges, and warm parchment results cards from `media_1794114967133_ffcac50a.jpg`.
   - Keep all text and numbers editable DOM elements for crisp rendering across all screen resolutions.
3. **Responsive Breakpoints**:
   - **Desktop (16:9)**: Horizontal layout, centered flight view, minimal top HUD pills, keyboard controls only.
   - **Mobile (Portrait)**: Safe area insets (`env(safe-area-inset-top)`), compact top HUD, existing dual-axis joystick positioned cleanly in bottom zone, center screen completely open.
4. **Timer Implementation**:
   - Inject the 75-second countdown timer into `DeliverySystem` / `UIManager` state loop.
   - Add `<15s` urgency visual pulse (warm red/gold pulsing glow).
   - Hook timer expiration to `_finishRun(false, 'timeout')`.

---
*Report compiled and verified against codebase on 2026-11-08.*
