# Project: Santa's Gift Delivery UI Redesign (Desktop & Mobile)

## Architecture
A vanilla ES module and Three.js 0.170.0 web application running on Vite 6.0.0. The architecture cleanly separates the core 3D simulation and physics from a modular DOM/CSS UI layer:

- **Core Engine & Simulation Layer**:
  - `src/main.js`: Render loop (`requestAnimationFrame`), Three.js scene, camera, lighting, post-processing (`EffectComposer`, `KawaseBloomPass`), and chunk management.
  - `src/gameplay/SleighController.js`: Sleigh aerodynamics, keyboard input (A/D yaw+bank, W/S altitude+pitch), dual-axis joystick input (`joyX`, `joyY`), and 3D trailing follow camera.
  - `src/gameplay/DeliverySystem.js`: Target cottage beacon management (golden beam + chimney star), continuous collision detection (CCD) fly-through delivery, stardust guiding wind, route bonus stars, scoring, and run lifecycle events.
  - `src/gameplay/SoundManager.js`: Web Audio API sound effects and ambient audio.

- **Modular UI Presentation Layer**:
  - `src/ui/UIManager.js`: Central UI orchestrator managing all screen transitions, top HUD updates, countdown timer, delivery celebrations, and the parchment results modal.
  - `src/ui/components/`: Reusable DOM/SVG components for Top HUD, Main Menu, Instructions Modal, Loading Bar, Delivery Toasts, and Results Screen.
  - `src/ui/styles/`: Festive holiday design tokens (red, gold, cream, navy, snow white), typography, candy-cane progress bars, and responsive media queries (desktop 16:9 vs mobile portrait safe areas).

## Feature Inventory
Every requirement from `ORIGINAL_REQUEST.md` (R1 through R5) is inventoried and assigned to an authoritative milestone:

| # | Feature ID | Feature Name | Description | Assigned Milestone | Source |
|---|---|---|---|---|---|
| 1 | F-PRESERVE-01 | Flight Physics & Aerodynamics | Preserve 3D keyboard steering, climb/dive, banking roll, pitch, speed variations, and trailing follow camera | M2 | R1 |
| 2 | F-PRESERVE-02 | Fly-Through Auto Delivery | Gifts drop automatically when flying through cottage beacon volume; no manual drop button | M3 | R1, R2, R3 |
| 3 | F-PRESERVE-03 | Target Beacon & Chimney Star | Golden vertical sky beam and floating star emblem at active cottage chimney | M3 | R1 |
| 4 | F-PRESERVE-04 | Route Bonus Stars | 6 collectible golden stars along flight path awarding +50 pts and planar shockwaves | M3 | R1 |
| 5 | F-PRESERVE-05 | Off-Course Guiding Wind | Stardust particle flow guides player toward active target when off-course without permanent arrows/minimaps | M3 | R1, R4 |
| 6 | F-PRESERVE-06 | 5-Delivery Run Goal | Run completes successfully when 5 chimney deliveries are achieved | M3 | R1 |
| 7 | F-PRESERVE-07 | 75s Countdown Timer | Run countdown starts at 75 seconds; run terminates on expiration | M3 | R1, R2 |
| 8 | F-PRESERVE-08 | Audio & Debug Stats | Preserve sound toggle, Web Audio effects, and FPS debug readout | M1 | R1 |
| 9 | F-DESKTOP-01 | Desktop 16:9 Viewport Layout | Centered responsive 16:9 layout maintaining unobstructed central flight corridor | M2 | R2 |
| 10 | F-DESKTOP-02 | Desktop Keyboard Flight Controls | Pure keyboard flight (A/D yaw+bank, W/S climb+dive); hide all touch joysticks & remove manual drop hints | M2 | R2 |
| 11 | F-DESKTOP-03 | Desktop Top HUD Bar | Top HUD displaying 5-delivery progress, 75s timer, collected bonus stars, and score | M1 | R2 |
| 12 | F-DESKTOP-04 | Desktop Menus & Overlays | Festive Main Menu, Loading Screen, Instructions Overlay, Delivery Feedback, and Results Screen | M1 | R2 |
| 13 | F-MOBILE-01 | Mobile Portrait-First Layout | Responsive portrait layout handling device safe areas (`env(safe-area-inset-*)`) | M2 | R3 |
| 14 | F-MOBILE-02 | Mobile Dual-Axis Flight Joystick | Touch joystick for steering and altitude in lower thumb zone; no gesture conflicts or scroll hitches | M2 | R3 |
| 15 | F-MOBILE-03 | Mobile Unobstructed Flight Center | Clear screen center for target identification and beacon navigation; compact top HUD | M2 | R3 |
| 16 | F-MOBILE-04 | No Mobile Manual Drop Button | Ensure no manual drop button is rendered or overlaid on mobile | M2 | R3 |
| 17 | F-STYLE-01 | Festive Color System | Palette tokens: Festive Red (`#D61F33`), Metallic Gold (`#FFC727`), Cream Parchment (`#FDF1D6`), Midnight Navy (`#081735`), Snow White (`#FFFFFF`) | M1 | R4 |
| 18 | F-STYLE-02 | Reusable Modular Components | Separate DOM/CSS/SVG component modules; no flattened raster images; 100% editable text and numbers | M1 | R4 |
| 19 | F-STYLE-03 | Delivery Celebration Feedback | Brief festive celebration banner/toast on successful chimney delivery without obscuring flight | M1 | R4 |
| 20 | F-STYLE-04 | Delivery Score & Combo Feedback | Dynamic delivery points and combo multiplier popups | M1 | R4 |
| 21 | F-STYLE-05 | Bonus-Star Pickup Feedback | Subtle golden star pickup notification | M1 | R4 |
| 22 | F-STYLE-06 | Timer Urgency Visual Feedback | Restrained visual urgency pulsation when remaining countdown timer is <15 seconds | M1, M3 | R4 |
| 23 | F-STYLE-07 | Target Proximity Feedback | Subtle golden halo/glow feedback when approaching target beacon without permanent compass/minimap | M1, M3 | R4 |
| 24 | F-RESULTS-01 | Parchment Results Card | Warm parchment texture panel with gold borders, ribbon banner, and 3-star rating crest | M1 | R5 |
| 25 | F-RESULTS-02 | Results Deliveries Stat | Displays successful deliveries out of 5 | M1, M3 | R5 |
| 26 | F-RESULTS-03 | Results Bonus Stars Stat | Displays collected bonus stars count | M1, M3 | R5 |
| 27 | F-RESULTS-04 | Results Points & Combo Stat | Displays delivery base points and combo bonus score | M1, M3 | R5 |
| 28 | F-RESULTS-05 | Results Remaining-Time Bonus | Calculates and awards remaining-time bonus | M3 | R5 |
| 29 | F-RESULTS-06 | Results Total Score | Calculates final aggregated score | M3 | R5 |
| 30 | F-RESULTS-07 | Results 1-3 Star Rating | Computes and displays 1, 2, or 3 golden star rating based on performance | M1, M3 | R5 |
| 31 | F-RESULTS-08 | Results Navigation Controls | Functional circular Play Again and Home navigation buttons | M1, M3 | R5 |

## Milestones

### Implementation Track

| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M1 | Festive UI Component Architecture & Modular Screens | Palette tokens (`theme.css`), typography, candy-cane meters, modular SVG ornaments/ribbons/snow-caps, and `UIManager.js` implementing Main Menu, Loading Screen, Instructions Modal, Top HUD capsule meters, Delivery Toasts, and Parchment Results Screen with 100% editable text | none | DONE |
| M2 | Controls, Responsive 16:9 Desktop & Mobile Safe Areas | Desktop centered 16:9 layout boundary with unobstructed flight view, keyboard-only flight controls, mobile portrait layout with safe-area insets (`env(safe-area-inset-*)`), scoping `#joystick-zone` to lower thumb zone with dual-axis touch joystick, removing obsolete drop hints | M1 | PLANNED |
| M3 | Game Lifecycle & 75s Countdown Timer Integration | 75s countdown timer loop in `DeliverySystem.js`, <15s urgency pulsation, timeout handling, fly-through auto-drop preservation, golden sky beacon & chimney star preservation, route bonus stars, off-course stardust guiding wind, remaining-time bonus computation, results total score calculation, and smooth transitions (Main Menu -> Flight -> Results -> Replay/Home) | M1, M2 | PLANNED |
| M4 | Final Milestone: E2E Verification & Adversarial Hardening | Phase 1: Pass 100% of E2E test suite (Tiers 1-4). Phase 2: Adversarial edge-case hardening (Tier 5) | M3, E2E Track | PLANNED |

### E2E Testing Track

| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| T1 | Opaque-Box E2E Test Suite (Tiers 1-4) | Automated test suite derived strictly from user requirements covering Tiers 1-4 across all 31 features (Desktop 16:9, Mobile portrait safe areas, Keyboard vs Touch joystick, 75s timer, 5 deliveries, parchment results, editable text) -> Publishes `TEST_READY.md` | none | DONE |

## Interface Contracts

### Game Loop ↔ UIManager (`src/ui/UIManager.js`)
- `uiManager.init(containerElement)`: Mounts DOM structure, binds buttons, initializes state.
- `uiManager.showScreen('menu' | 'instructions' | 'loading' | 'hud' | 'results')`: Handles active overlay visibility.
- `uiManager.updateHUD({ deliveries, maxDeliveries, timeRemaining, stars, maxStars, score, urgency })`: Updates top HUD capsule values and timer urgency class.
- `uiManager.showDeliveryToast({ text, points, combo })`: Triggers transient delivery celebration toast.
- `uiManager.showStarToast({ text, points })`: Triggers transient bonus star pickup feedback.
- `uiManager.showResults({ deliveries, maxDeliveries, stars, maxStars, deliveryScore, comboScore, timeBonus, totalScore, starRating, reason })`: Renders parchment results card with stats and star emblems.
- `uiManager.on('play', callback)`: Triggered when player presses Play on Main Menu.
- `uiManager.on('replay', callback)`: Triggered when player presses Play Again on Results screen.
- `uiManager.on('home', callback)`: Triggered when player presses Home on Results screen.
- `uiManager.on('pauseToggle', callback)`: Triggered when player clicks pause button.

### SleighController ↔ Input / Controls
- `sleighController.setJoystickInput(normX, normY)`:
  - `normX` [-1.0 .. 1.0]: horizontal yaw steering & banking roll.
  - `normY` [-1.0 .. 1.0]: vertical altitude & pitch tilt (negative = climb, positive = dive).
- `sleighController.inputs`:
  - `left`, `right`: boolean steering flags.
  - `up`, `down`: boolean climb/dive flags.
  - `drop`: empty array (auto-delivery).

### DeliverySystem ↔ Game Lifecycle
- `deliverySystem.startRun(isRestart)`: Initializes cottage sequence, resets 75s timer, clears deliveries, spawns stars.
- `deliverySystem.update(delta)`: Advances 75s countdown timer; triggers `_finishRun(false, 'timeout')` on expiration; updates beacons & fly-through CCD.
- `deliverySystem.timeRemaining`: Number of seconds remaining in countdown (starts at 75).

## Code Layout
- `index.html`: Entry point, semantic `#ui-container` mount point, viewport metadata with `viewport-fit=cover`.
- `src/style.css`: Base styles, theme variables, reset.
- `src/ui/`:
  - `src/ui/UIManager.js`: Main UI coordinator.
  - `src/ui/styles/theme.css`: Palette tokens, typography, gradients, animations.
  - `src/ui/styles/hud.css`: Top HUD capsule meters, candy-cane progress, urgency states.
  - `src/ui/styles/screens.css`: Main menu, instructions modal, loading screen.
  - `src/ui/styles/results.css`: Parchment results card, star ratings, action buttons.
  - `src/ui/styles/responsive.css`: Desktop 16:9 boundary vs Mobile portrait safe area handling.
  - `src/ui/components/`: Reusable SVG and DOM component templates (ribbons, snow-caps, badges).
- `src/gameplay/`:
  - `src/gameplay/DeliverySystem.js`: Core delivery mechanics, 75s countdown timer loop, scoring.
  - `src/gameplay/SleighController.js`: Flight physics, keyboard & touch joystick inputs, camera follow.
  - `src/gameplay/SoundManager.js`: Web Audio API sound effects.
  - `src/gameplay/TargetGuidanceFlow.js`: Off-course stardust guiding wind.
  - `src/gameplay/GiftDropMarker.js`: Target cottage golden sky beacon and chimney star emblem.
- `src/main.js`: Three.js scene setup, render loop, UIManager binding.
