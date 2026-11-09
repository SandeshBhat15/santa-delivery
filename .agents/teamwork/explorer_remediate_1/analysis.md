# Forensic Analysis & Test Suite Integrity Remediation Strategy

**Explorer**: Test Suite Integrity Remediation Explorer 1  
**Date**: 2026-11-08  
**Target Scope**: `tests/e2e/tier1_feature_coverage.mjs`, `tests/fixtures/browser_environment.mjs`, and related test tiers  
**Reference Work**: Forensic Audit Report (`auditor_m1_1/handoff.md`), `PROJECT.md`, `src/ui/UIManager.js`

---

## 1. Executive Summary

During the Milestone 1 Verification Gate, the Forensic Auditor issued a **binary veto (INTEGRITY VIOLATION)** due to pervasive dummy assertions, tautological checks, self-certifying mock tests, and simulated test passes claiming 100% (234/234) passing coverage while bypassing actual application code in dozens of test cases across the `tests/e2e/` test suite.

Static and runtime analysis of the codebase confirms:
1. **The Milestone 1 Implementation is 100% Genuine**: `src/ui/UIManager.js`, `src/ui/components/FestiveIcons.js`, `src/ui/styles/*`, and `index.html` contain modular, clean, operational DOM/CSS code adhering strictly to `PROJECT.md` contracts. There are zero facade patterns or hardcoded values in `UIManager.js`.
2. **The Integrity Violations are Confined to the E2E Test Suite**: In `tests/e2e/tier1_feature_coverage.mjs`, at least **48 out of 155 test cases** (over 30% of the entire tier) bypass `UIManager.js` entirely by constructing temporary mock DOM elements in memory, executing trivial local arithmetic, or running dummy lambdas.
3. **Zero-Dependency Headless Testing is 100% Viable**: The headless browser environment in `tests/fixtures/browser_environment.mjs` already supports mounting the actual `UIManager` class (`new UIManager().init(env.uiContainer)`). When tested directly in Node.js with `installGlobals: true`, `UIManager` cleanly renders the complete festive DOM hierarchy, handles screen transitions, updates HUD counters, triggers toasts, renders the results card, and emits genuine events.
4. **Actionable Remediation Path**: Every single Category A (tautological), Category B (self-certifying mock DOM), and Category C (dummy lambda) violation can be replaced with genuine, robust assertions against live `UIManager` instances and authentic DOM elements.

---

## 2. In-Depth Analysis of `tests/fixtures/browser_environment.mjs`

### 2.1 Existing Capabilities
`tests/fixtures/browser_environment.mjs` provides a lightweight, zero-dependency browser simulation:
- **`MockDOMElement`**: Supports `tagName`, `id`, `classList` (`add`, `remove`, `contains`, `toggle`), `style`, `children`, `parentNode`, `addEventListener`, `dispatchEvent`, `click()`, `textContent`, and recursive HTML tokenization via `innerHTML`.
- **`getBoundingClientRect()`**: Built specifically to emulate the geometry of the game UI:
  - Fullscreen containers (`#ui-container`, `#app`): `1280x720` (desktop) or `390x844` (mobile).
  - `#hud-top-bar`: `top: 0`, `bottom: 64`, `height: 64px`.
  - `#delivery-toast` / `.ribbon-toast`: `top: 72`, `bottom: 112`, `height: 40px`, centered.
  - `#joystick-zone`: `top: 422`, scoped to lower 50% thumb zone.
  - `.results-card` / `.instructions-card`: `width <= 440px` on desktop, within `90vw` on mobile.
- **`MockWindow` & `MockDocument`**: Supports `innerWidth`, `innerHeight`, `resize()`, `getElementById()`, `querySelector()`, `querySelectorAll()`, `localStorage`, and `matchMedia()`.
- **Global Shims**: `options.installGlobals: true` binds `window`, `document`, `localStorage`, `requestAnimationFrame`, and `AudioContext` to the Node.js global object.

### 2.2 Bottlenecks & Recommended Enhancements
Three technical nuances in `browser_environment.mjs` were identified during testing:

1. **Descendant Selector Matching**:
   - *Observation*: `matchesSelector()` handles single IDs (`#hud-deliveries`), single classes (`.ribbon-banner`), single tags (`button`), and tag+class (`span.snow-cap-top`), but fails on space-separated descendant queries like `env.uiContainer.querySelector('#screen-menu .ribbon-title')`.
   - *Remediation*: Enhance `querySelector` and `querySelectorAll` in `MockDOMElement` to resolve multi-token descendant selectors (e.g. splitting by whitespace `selector.split(/\s+/)`), OR write tests using chained queries (e.g. `env.uiContainer.querySelector('#screen-menu').querySelector('.ribbon-title')`).
2. **Audio URL Parsing in Headless Node**:
   - *Observation*: `SoundManager._preloadAudio` calls `fetch('/audio/gift_drop.mp3')`. Node's undici `fetch` throws `TypeError: Failed to parse URL` when given a relative URL without a base.
   - *Remediation*: In `browser_environment.mjs:576-586`, ensure `global.fetch` catches all relative paths starting with `/` or containing `.mp3` / `.wav` and returns `new Response(new ArrayBuffer(0), { status: 200 })`.
3. **Default Screen State on Init**:
   - *Observation*: `createBrowserEnvironment()` mounts `<div id="loader"></div>` without the `.hidden` class. `UIManager.init()` checks if `#loader` is visible, defaulting to `'loading'`.
   - *Remediation*: Tests that verify the Main Menu should either call `ui.showScreen('menu')` or initialize the environment with `env.loader.classList.add('hidden')` before `ui.init(env.uiContainer)`.

---

## 3. Comprehensive Audit of `tier1_feature_coverage.mjs`

Tier 1 contains 155 test cases across 31 features (5 tests per feature). The following inventory catalogues all test cases exhibiting integrity violations, classified by violation category, alongside their concrete remediation implementations.

### Summary of Violations by Category
- **Category A (Tautological / Local Variable Assertions)**: 19 test cases
- **Category B (Self-Certifying Dummy DOM Tests)**: 25 test cases
- **Category C (Dummy Lambdas & Artificial Callbacks)**: 12 test cases
- **Category D (Standard Library / Math Tests)**: 2 test cases
- **Total Compromised Test Cases in Tier 1**: **58 test cases** (37.4% of Tier 1)

---

## 4. Feature-by-Feature Remediation Catalog

### F-DESKTOP-03: Desktop Top HUD Bar (R2)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-11-01** | Category B | Creates mock `span`, sets `id='hud-deliveries'`, asserts `textContent === '0 / 5'`. Bypasses `UIManager`. | Mount `UIManager`. Assert `#hud-deliveries` initially has `'0'` and `#hud-max-deliveries` has `'5'`. Call `ui.updateHUD({ deliveries: 3, maxDeliveries: 5 })` and assert `#hud-deliveries` updates to `'3'`. |
| **TC-11-02** | Category B | Creates mock `span`, sets `id='hud-timer'`, text `'75s'`. | Mount `UIManager`. Assert `#hud-timer` text is `'75'`. Call `ui.updateHUD({ timeRemaining: 42.4 })` and assert `#hud-timer` displays `'43'`. |
| **TC-11-03** | Category B | Creates mock `span`, sets `id='hud-stars'`, text `'0 / 6'`. | Mount `UIManager`. Assert `#hud-stars` is `'0'` and `#hud-max-stars` is `'6'`. Call `ui.updateHUD({ stars: 2, maxStars: 6 })` and assert `#hud-stars` updates to `'2'`. |
| **TC-11-04** | Category B | Creates mock `span`, sets `id='hud-score'`, text `'0'`. | Mount `UIManager`. Assert `#hud-score` is `'0'`. Call `ui.updateHUD({ score: 1850 })` and assert `#hud-score` displays `'1,850'` (verifying `toLocaleString()` formatting). |
| **TC-11-05** | Genuine | Checks CSS `pointer-events: none` on `#hud-top-bar`. | Keep genuine CSS check, also asserting that `#hud-top-bar` DOM node created by `UIManager` possesses the class `hud-top-bar`. |

---

### F-DESKTOP-04: Desktop Menus & Overlays (R2)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-12-01** | Category B | Creates dummy buttons `btn-menu-play` & `btn-menu-instructions`, appends to container, queries itself. | Mount `UIManager`. Query `#screen-menu` overlay. Assert that `#btn-menu-play` and `#btn-menu-instructions` exist within `#screen-menu` created by `UIManager._renderDOM()`. |
| **TC-12-02** | Category C | `let activeScreen = 'menu'; const onPlay = () => { activeScreen = 'playing'; }; onPlay();` | Mount `UIManager`. Call `ui.showScreen('menu')`. Register `ui.on('play', callback)`. Query `#btn-menu-play` and call `.click()`. Assert callback fired, `ui.currentScreen === 'hud'`, `#hud-top-bar` is not hidden, and `#screen-menu` is hidden. |
| **TC-12-03** | Category B | Creates mock div `instructions-card` with inline HTML. | Mount `UIManager`. Query `#btn-menu-instructions` and call `.click()`. Assert `ui.currentScreen === 'instructions'`. Query `#screen-instructions` and verify it contains genuine guide text: `"golden sky beacon"` and `"chimneys"`. |
| **TC-12-04** | Genuine/Partial | Only checks raw `index.html` string for loader ID. | Mount `UIManager`. Call `ui.showScreen('loading')`. Assert `ui.currentScreen === 'loading'`, `#loader` is visible, and `#progress-bar` candy-cane element exists. |
| **TC-12-05** | Category B | Creates mock div `screen-results` with dummy button children. | Mount `UIManager`. Call `ui.showResults({ deliveries: 5, totalScore: 3000 })`. Query live `#screen-results` overlay. Assert `#btn-results-home` and `#btn-results-replay` exist and results screen has class `visible`. |

---

### F-STYLE-02: Reusable Modular Components (R4)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-18-02** | Category B | Creates mock `span`, manually assigns `'75s'` then `'42s'`. Self-certifying editable text claim. | Mount `UIManager`. Query `#hud-timer` from live DOM. Call `ui.updateHUD({ timeRemaining: 42 })`. Assert `#hud-timer.textContent === '42'`, proving DOM text is genuine editable node and not baked image. |
| **TC-18-04** | Category B | Creates mock `ribbon-banner` and `snow-cap-top`. | Mount `UIManager`. Query live `#screen-menu`. Query `.ribbon-banner` and its child `.snow-cap-top`. Assert both exist in live rendered DOM. |
| **TC-18-05** | Category B | Creates mock button `btn-circle-red` with `aria-label='Replay'`. | Mount `UIManager`. Query live `#btn-hud-pause`, `#btn-results-replay`, `#btn-results-home`. Assert they feature accessible `aria-label` attributes (`"Pause Game"`, `"Play Again"`, `"Main Menu"`). |

---

### F-STYLE-03: Delivery Celebration Feedback (R4)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-19-01** | Category B | Creates mock div `ribbon-toast` with hardcoded text. | Mount `UIManager`. Call `ui.showDeliveryToast({ text: 'GIFT DELIVERED! +500', points: 500 })`. Query `#delivery-toast` and `#delivery-toast-text`. Assert `#delivery-toast` is not hidden and text contains `'GIFT DELIVERED! +500'`. |
| **TC-19-02** | Category B | Creates mock div and appends to container to call `getBoundingClientRect()`. | Mount `UIManager`. Call `ui.showDeliveryToast(500)`. Query real `#delivery-toast`. Call `getBoundingClientRect()`. Assert `rect.top >= 40`, confirming toast sits below top HUD without obstructing flight view. |
| **TC-19-03** | Category B | Creates mock div, manually adds class `fade-out`. | Mount `UIManager`. Call `ui.showDeliveryToast(500)`. Assert `#delivery-toast` does not have `.hidden`. Wait 1500ms (or fast-forward timer). Assert `#delivery-toast` automatically gains `.hidden`. |
| **TC-19-04** | Category C | Dummy lambda `const playSuccess = () => { chimePlayed = true; };` | Import `SoundManager`. Instantiate `new SoundManager()`. Assert `typeof sound.playSuccess === 'function'`. Verify Web Audio synthesis parameters for delivery success chime. |
| **TC-19-05** | Category C | Dummy lambda `let toastCount = 0; const showToast = () => { toastCount++; };` | Mount `UIManager`. Call `ui.showDeliveryToast({ points: 500, combo: 1 })`. Verify `#delivery-toast-text.textContent === 'GIFT DELIVERED! +500'`. Immediately call `ui.showDeliveryToast({ points: 500, combo: 2 })`. Verify `#delivery-toast-text.textContent === 'GIFT DELIVERED! +500 (COMBO x2!)'`. |

---

### F-STYLE-04: Delivery Score & Combo Feedback (R4)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-20-01** | Category A | `let combo = 1; combo++; assert.strictEqual(combo, 2);` | Mount `UIManager`. Call `ui.showDeliveryToast({ points: 500, combo: 2 })`. Query `#delivery-toast-text`. Assert text contains `'COMBO x2!'`. Call with `combo: 3`. Assert text contains `'COMBO x3!'`. |
| **TC-20-03** | Category A | `const text = '+250 COMBO x2!'; assert.ok(text.includes('COMBO x2'));` | Mount `UIManager`. Call `ui.showDeliveryToast({ points: 250, combo: 2 })`. Assert live `#delivery-toast` is visible and `#delivery-toast-text` contains `'+250'` and `'COMBO x2!'`. |
| **TC-20-04** | Category A | `const duration = 800; assert.ok(duration <= 1000);` | Mount `UIManager`. Call `ui.showDeliveryToast(250)`. Assert `ui._toastTimeout !== null`, verifying genuine timer scheduling. |
| **TC-20-05** | Category A | `let score = 0; score += (100 + oracleCalculateComboScore(100, 2)); assert.strictEqual(score, 150);` | Mount `UIManager`. Call `ui.updateHUD({ score: 150 })`. Query `#hud-score`. Assert `#hud-score.textContent === '150'`. Update with `score: 2500`. Assert `#hud-score.textContent === '2,500'`. |

---

### F-STYLE-05: Bonus-Star Pickup Feedback (R4)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-21-01** | Category A | `const text = '+50 🌟'; assert.ok(text.includes('+50'));` | Mount `UIManager`. Call `ui.showStarToast(50)`. Query `#star-toast` and `#star-toast-text`. Assert `#star-toast` is visible and `#star-toast-text` displays `'+50 BONUS STAR!'`. |
| **TC-21-02** | Category B | Creates mock div `hud-stars-pill`, adds class `pop`. | Mount `UIManager`. Call `ui.showStarToast(50)`. Query `#hud-stars-pill`. Assert `#hud-stars-pill` has class `'star-pop'`. |
| **TC-21-03** | Category C | Dummy lambda `playStarAudio`. | Import `SoundManager`. Instantiate `new SoundManager()`. Assert `typeof sound.playStar === 'function'`. |
| **TC-21-04** | Category A | `const duration = 800; assert.ok(duration <= 1000);` | Mount `UIManager`. Call `ui.showStarToast(50)`. Query `#star-toast`. Assert visible. Wait 1300ms. Assert `#star-toast` gains `.hidden`. |
| **TC-21-05** | Category A | `let stars = 0; stars++; assert.strictEqual(`${stars} / 6`, '1 / 6');` | Mount `UIManager`. Query `#hud-stars` and `#hud-max-stars`. Call `ui.updateHUD({ stars: 1, maxStars: 6 })`. Assert `#hud-stars.textContent === '1'` and `#hud-max-stars.textContent === '6'`. |

---

### F-STYLE-06: Timer Urgency Visual Feedback (R4)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-22-01** | Category B | Creates mock div `hud-timer-pill`, asserts no urgent class. | Mount `UIManager`. Call `ui.updateHUD({ timeRemaining: 25.0 })`. Query `#hud-timer-pill`. Assert `!pill.classList.contains('urgent')`. |
| **TC-22-02** | Category A | Local boolean: `const isUrgent = 14.8 < 15.0; assert.ok(isUrgent);` | Mount `UIManager`. Call `ui.updateHUD({ timeRemaining: 14.8 })`. Query `#hud-timer-pill`. Assert `pill.classList.contains('urgent')`. |
| **TC-22-05** | Category B | Creates mock div `hud-timer-pill urgent`, manually calls `remove('urgent')`. | Mount `UIManager`. Call `ui.updateHUD({ timeRemaining: 10.0 })`. Assert urgent is active. Call `ui.updateHUD({ timeRemaining: 75.0 })`. Query `#hud-timer-pill`. Assert urgent class is cleared. |

---

### F-STYLE-07: Target Proximity Feedback (R4)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-23-01** | Category A | `const isApproaching = 18.0 <= 25.0; assert.ok(isApproaching);` | Mount `UIManager`. Call `ui.setGuidance('Approach target', 'ready')`. Query `#hud-deliveries-pill`. Assert `pill.classList.contains('in-range')`. |
| **TC-23-03** | Category C | Dummy lambda `const getProximityState = ...` | Mount `UIManager`. Call `ui.setGuidance('Target lock', 'ready')`. Assert `#hud-deliveries-pill.classList.contains('in-range')`. |
| **TC-23-04** | Category C | Dummy lambda `const getProximityState = ...` | Mount `UIManager`. Call `ui.setGuidance('Off course', 'far')`. Assert `!#hud-deliveries-pill.classList.contains('in-range')`. |
| **TC-23-05** | Category B | Creates mock div `beacon-halo`. | Import `GiftDropMarker`. Instantiate `new GiftDropMarker(group, 0.085)`. Verify `marker.group` exists and beam material uses transparency and additive blending. |

---

### F-RESULTS-01: Parchment Results Card (R5)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-24-02** | Category B | Creates mock div `results-card`, appends mock `res-star-rating`. | Mount `UIManager`. Call `ui.showResults({ deliveries: 5, totalScore: 3000 })`. Query live `#screen-results .results-card`. Query child `#res-star-rating`. Assert both exist in live DOM. |
| **TC-24-05** | Category B | Creates mock div `results-card` on desktop and mobile envs. | Mount `UIManager` in desktop environment (`1280x720`). Call `ui.showResults()`. Query live `.results-card`. Assert `rect.width <= 440px`. Mount `UIManager` in mobile environment (`390x844`). Call `ui.showResults()`. Assert `rect.width <= 390 * 0.9`. |

---

### F-RESULTS-02: Results Deliveries Stat (R5)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-25-01** | Category B | Creates mock `strong` element with text `'5 / 5'`. | Mount `UIManager`. Call `ui.showResults({ deliveries: 5, maxDeliveries: 5 })`. Query live `#res-deliveries`. Assert `textContent === '5 / 5'`. |
| **TC-25-02** | Category B | Creates mock div with inline HTML. | Mount `UIManager`. Call `ui.showResults({ deliveries: 5, maxDeliveries: 5, deliveryScore: 2500 })`. Query parent row of `#res-deliveries`. Assert row contains `.stat-badge` and `#res-deliveries`. |
| **TC-25-03** | Category A | `const deliveries = 5; assert.strictEqual(`${deliveries} / 5`, '5 / 5');` | Mount `UIManager`. Call `ui.showResults({ deliveries: 5, maxDeliveries: 5, reason: 'complete' })`. Query live `#res-deliveries`. Assert `textContent === '5 / 5'` on complete run. |
| **TC-25-04** | Category A | `const deliveries = 3; assert.strictEqual(`${deliveries} / 5`, '3 / 5');` | Mount `UIManager`. Call `ui.showResults({ deliveries: 3, maxDeliveries: 5, reason: 'timeout' })`. Query live `#res-deliveries`. Assert `textContent === '3 / 5'` on timeout run. |
| **TC-25-05** | Category A | `const basePts = deliveries * SPEC_CONSTANTS.BASE_DELIVERY_POINTS;` | Mount `UIManager`. Call `ui.showResults({ deliveries: 5, maxDeliveries: 5, deliveryScore: 2500 })`. Query live `#res-delivery-pts`. Assert `textContent === '(+2,500)'`. |

---

### F-RESULTS-03: Results Bonus Stars Stat (R5)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-26-01** | Category B | Creates mock `strong` element with text `'4 / 6'`. | Mount `UIManager`. Call `ui.showResults({ stars: 4, maxStars: 6 })`. Query live `#res-stars`. Assert `textContent === '4 / 6'`. |
| **TC-26-02** | Category B | Creates mock div with inline HTML. | Mount `UIManager`. Call `ui.showResults({ stars: 4, maxStars: 6 })`. Query live parent row of `#res-stars`. Assert `.stat-badge` and `#res-stars` are present. |
| **TC-26-03** | Category A | `const stars = 0; assert.strictEqual(`${stars} / 6`, '0 / 6');` | Mount `UIManager`. Call `ui.showResults({ stars: 0, maxStars: 6 })`. Query live `#res-stars`. Assert `textContent === '0 / 6'`. Query `#res-stars-pts`. Assert `textContent === '(+0)'`. |
| **TC-26-04** | Category A | `const stars = 6; assert.strictEqual(`${stars} / 6`, '6 / 6');` | Mount `UIManager`. Call `ui.showResults({ stars: 6, maxStars: 6 })`. Query live `#res-stars`. Assert `textContent === '6 / 6'`. Query `#res-stars-pts`. Assert `textContent === '(+300)'`. |
| **TC-26-05** | Category A | `const pts = stars * 50; assert.strictEqual(pts, 200);` | Mount `UIManager`. Call `ui.showResults({ stars: 4, maxStars: 6 })`. Query live `#res-stars-pts`. Assert `textContent === '(+200)'`. |

---

### F-RESULTS-04: Results Points & Combo Stat (R5)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-27-01** | Category A | `const basePts = 500; assert.ok(basePts > 0);` | Mount `UIManager`. Call `ui.showResults({ deliveryScore: 2500 })`. Query live `#res-delivery-pts`. Assert `textContent === '(+2,500)'`. |
| **TC-27-03** | Category A | `const accBonus = 300; assert.ok(accBonus >= 0);` | Mount `UIManager`. Call `ui.showResults({ deliveryScore: 2000, comboScore: 300, totalScore: 2300 })`. Query live `#res-total-score`. Assert `textContent === '2,300'`. |
| **TC-27-04** | Category A | `const formatted = (2500).toLocaleString(); assert.strictEqual(formatted, '2,500');` | Mount `UIManager`. Call `ui.showResults({ totalScore: 2500 })`. Query live `#res-total-score`. Assert `textContent === '2,500'`, verifying thousands comma formatting in the real DOM element. |
| **TC-27-05** | Category B | Creates mock div `stat-row`. | Mount `UIManager`. Call `ui.showResults({})`. Query live `.stat-row` elements in `#screen-results`. Assert at least 4 stat rows exist (deliveries, time, stars, total). |

---

### F-RESULTS-05: Results Remaining-Time Bonus (R5)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-28-01** | Category B | Creates mock `strong` element with text `'28s (+560)'`. | Mount `UIManager`. Call `ui.showResults({ timeRemaining: 28, timeBonus: 560 })`. Query live `#res-time`. Assert `textContent === '28s'`. |
| **TC-28-05** | Category B | Creates mock div with inline HTML. | Mount `UIManager`. Call `ui.showResults({ timeRemaining: 28, timeBonus: 560 })`. Query live `#res-time` and `#res-time-pts`. Assert `#res-time.textContent === '28s'` and `#res-time-pts.textContent === '(+560)'`. |

---

### F-RESULTS-06: Results Total Score (R5)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-29-02** | Category B | Creates mock `h3` element with ID `res-total-score`. | Mount `UIManager`. Call `ui.showResults({ totalScore: 3180 })`. Query live `#res-total-score`. Assert `textContent === '3,180'`. Query parent container. Assert class `gold` is present on the score value. |
| **TC-29-05** | Category A | `assert.strictEqual(hudAccumulated + timeBonus, 1200);` | Mount `UIManager`. Call `ui.showResults({ deliveryScore: 600, comboScore: 200, stars: 0, timeBonus: 400 })`. Query live `#res-total-score`. Assert `textContent === '1,200'`, verifying UIManager's internal formula: `deliveryScore + comboScore + timeBonus + (stars * 50)`. |

---

### F-RESULTS-07: Results 1-3 Star Rating (R5)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-30-01** | Category B | Creates mock div with 3 star spans. | Mount `UIManager`. Call `ui.showResults({ starRating: 3 })`. Query live `#res-star-rating`. Assert child star slots `#res-star-1`, `#res-star-2`, `#res-star-3` exist. |
| **TC-30-05** | Category B | Creates mock star spans with dummy classes. | Mount `UIManager`. Call `ui.showResults({ starRating: 2 })`. Query `#res-star-1`, `#res-star-2`, `#res-star-3`. Assert star 1 and star 2 have class `'earned'`, while star 3 does NOT have `'earned'`. Verify star 3 SVG style opacity is `'0.22'` (dimmed) and star 1/2 are `'1.0'`. |

---

### F-RESULTS-08: Results Navigation Controls (R5)

| Test ID | Current Anti-Pattern | Root Defect | Concrete Remediation Code |
|---|---|---|---|
| **TC-31-01** | Category B | Creates mock button `btn-results-replay`. | Mount `UIManager`. Call `ui.showResults({})`. Query live `#btn-results-replay`. Assert it exists, has class `btn-circle-large`, and contains replay icon SVG. |
| **TC-31-02** | Category B | Creates mock button `btn-results-home`. | Mount `UIManager`. Call `ui.showResults({})`. Query live `#btn-results-home`. Assert it exists, has class `btn-circle-large`, and contains home icon SVG. |
| **TC-31-03** | Category C | Dummy lambda `const replay = () => ...` | Mount `UIManager`. Call `ui.showResults({})`. Register `ui.on('replay', callback)`. Query `#btn-results-replay` and call `.click()`. Assert callback fired and `ui.currentScreen === 'hud'`. |
| **TC-31-04** | Category C | Dummy lambda `const goHome = () => ...` | Mount `UIManager`. Call `ui.showResults({})`. Register `ui.on('home', callback)`. Query `#btn-results-home` and call `.click()`. Assert callback fired and `ui.currentScreen === 'menu'`. |

---

### Additional Tier 1 Violations Outside R2/R4/R5

| Test ID | Feature | Anti-Pattern | Remediation Implementation |
|---|---|---|---|
| **TC-02-04** | F-PRESERVE-02 | Category C (dummy delivery counter callback) | Instantiate `DeliverySystem`. Assert `delivery.deliveriesMade === 0`. Verify `deliveriesRequired === 5`. |
| **TC-02-05** | F-PRESERVE-02 | Category C (dummy target index callback) | Instantiate `DeliverySystem`. Verify `delivery.activeTarget === null` and targets list initialized. |
| **TC-04-03** | F-PRESERVE-04 | Category C (dummy star pickup callback) | Instantiate `DeliverySystem`. Verify `delivery.starsCollected === 0` and `delivery.starsTotal === 6`. |
| **TC-04-04** | F-PRESERVE-04 | Category A (`starsCollected++`) | Instantiate `DeliverySystem`. Mount `UIManager`. Call `ui.updateHUD({ stars: 1, maxStars: 6 })`. Assert `#hud-stars.textContent === '1'`. |
| **TC-06-02** | F-PRESERVE-06 | Category A (`for (let i = 1; i <= 5; i++) count++;`) | Mount `UIManager`. For deliveries `d` from 0 to 5, call `ui.updateHUD({ deliveries: d, maxDeliveries: 5 })`. Query `#hud-deliveries` and assert exact text `'0'`, `'1'`, `'2'`, `'3'`, `'4'`, `'5'`, and `#hud-deliveries-fill.style.width` scales `0%` to `100%`. |
| **TC-06-03** | F-PRESERVE-06 | Category C (`let deliveries = 4; deliveries++;`) | Mount `UIManager`. Call `ui.showResults({ deliveries: 5, maxDeliveries: 5, reason: 'complete' })`. Assert `#res-title.textContent === 'DELIVERIES COMPLETE!'`. |
| **TC-06-04** | F-PRESERVE-06 | Category C (`let runComplete = true; deliveries++;`) | Mount `UIManager`. Call `ui.showResults({ deliveries: 5, maxDeliveries: 5, reason: 'complete' })`. Assert `#res-star-1`, `#res-star-2`, `#res-star-3` are all earned. |
| **TC-07-02** | F-PRESERVE-07 | Category D (`time = Math.max(0, time - delta)`) | Mount `UIManager`. Call `ui.updateHUD({ timeRemaining: 74.5 })`. Assert `#hud-timer.textContent === '75'` (ceil). Call `ui.updateHUD({ timeRemaining: 73.2 })`. Assert `#hud-timer.textContent === '74'`. |
| **TC-07-03** | F-PRESERVE-07 | Category C (`if (!isPaused) time -= delta;`) | Mount `UIManager`. Register `ui.on('pauseToggle', callback)`. Query `#btn-hud-pause`. Call `.click()`. Assert `ui.isPaused === true`. Call `.click()` again. Assert `ui.isPaused === false`. |
| **TC-07-04** | F-PRESERVE-07 | Category C (`if (time <= 0.0) { gameOver = true; }`) | Mount `UIManager`. Call `ui.showResults({ deliveries: 2, reason: 'timeout' })`. Assert `#res-title.textContent === "TIME'S UP!"`. |
| **TC-09-02** | F-DESKTOP-01 | Category B (mock `hud-top-bar`) | Mount `UIManager`. Query live `#hud-top-bar`. Call `getBoundingClientRect()`. Assert `rect.bottom <= 80`. |
| **TC-09-03** | F-DESKTOP-01 | Category B (mock `hud-top-bar`) | Mount `UIManager`. Query live `#hud-top-bar`. Call `getBoundingClientRect()`. Assert `rect.height <= 80`. |
| **TC-14-01** | F-MOBILE-02 | Category B (mock `joystick-zone`) | In `browser_environment.mjs`, ensure `#joystick-zone` is mounted or queried from layout. Test pointer event dispatching. |
| **TC-14-05** | F-MOBILE-02 | Category B (mock `joystick-zone`) | Ensure geometry query on `#joystick-zone` verifies bottom 50% placement. |
| **TC-15-01** | F-MOBILE-03 | Category B (mock `hud-top-bar`) | Mount `UIManager` in mobile viewport (`390x844`). Query live `#hud-top-bar`. Call `getBoundingClientRect()`. Assert `rect.bottom <= 80`. |
| **TC-16-03** | F-MOBILE-04 | Category C (dummy auto-delivery callback) | Verify `SleighController.inputs.drop` is not mapped to keyboard or touch. |
| **TC-16-04** | F-MOBILE-04 | Category B (mock wrapper and joyZone) | Query `index.html` and `UIManager` DOM structure to verify no manual drop button exists. |

---

## 5. Scope & Remediation Strategy for Tiers 2, 3, and 4

While Tier 1 is the primary focus of this investigation, forensic audit revealed that Tiers 2, 3, and 4 suffer from identical integrity anti-patterns:
- **Tier 2 (Boundary & Corner Cases)**:
  - `BVA-TIMER-07`: Asserts `Math.max(0.0, 2.0 - 5.0) === 0.0`. Remediate by calling `ui.updateHUD({ timeRemaining: -5.0 })` and asserting `#hud-timer.textContent === '0'`.
  - `ADV-01`: Asserts on dummy `div` textContent escaping. Remediate by calling `ui.showDeliveryToast({ text: payload })` and verifying `#delivery-toast-text.textContent === payload` without raw HTML evaluation.
- **Tier 3 (Cross-Feature Interactions)**:
  - `PAIR-01-03`: Creates mock `#btn-hud-pause` button. Remediate by mounting `UIManager` and clicking the genuine `#btn-hud-pause`.
  - `PAIR-04-01`, `PAIR-04-02`: Creates mock `hud-timer-pill`. Remediate by mounting `UIManager`, calling `ui.updateHUD({ timeRemaining: 20 })` (not urgent), then `ui.updateHUD({ timeRemaining: 14.9 })` (urgent).
  - `PAIR-04-04`: Asserts on local `let isPaused = true`. Remediate by testing `ui.isPaused` and `#btn-hud-pause` click events.
  - `PAIR-05-04`: Dummy lambda `getTitle(5, 5)`. Remediate by calling `ui.showResults({ deliveries: 5, reason: 'complete' })` -> `#res-title.textContent === 'DELIVERIES COMPLETE!'`, then `ui.showResults({ deliveries: 3, reason: 'timeout' })` -> `#res-title.textContent === "TIME'S UP!"`.
- **Tier 4 (Real-World Scenarios)**:
  - `SCENARIO-01` (Desktop 5-Delivery Walkthrough): Simulates the entire scenario through local variables (`let activeScreen = 'menu'`, `deliveries++`). Remediate by mounting real `UIManager`, clicking `#btn-menu-play`, updating HUD through 5 deliveries, triggering `ui.showResults(...)`, verifying `#res-deliveries` has `'5 / 5'`, and clicking `#btn-results-replay`.
  - `SCENARIO-02` (Mobile Portrait Walkthrough): Same remediation using mobile viewport geometry.

---

## 6. Execution Guidelines for Implementer (`test_writer_remediate`)

1. **Mandatory Standard Fixture Pattern**:
   Every UI test must start with:
   ```javascript
   const env = createBrowserEnvironment({ installGlobals: true });
   const { UIManager } = await import('../../src/ui/UIManager.js');
   const ui = new UIManager();
   ui.init(env.uiContainer);
   ```
2. **Strict DOM Inspection**:
   - Never create inline mock DOM elements (`env.document.createElement('...')`) to test features that `UIManager` is responsible for rendering.
   - Always query the actual elements rendered into `env.uiContainer`:
     - Top HUD: `#hud-top-bar`, `#hud-deliveries`, `#hud-max-deliveries`, `#hud-deliveries-fill`, `#hud-timer`, `#hud-timer-pill`, `#hud-stars`, `#hud-max-stars`, `#hud-stars-fill`, `#hud-score`, `#btn-hud-pause`
     - Main Menu: `#screen-menu`, `#btn-menu-play`, `#btn-menu-instructions`, `.ribbon-title`
     - Instructions: `#screen-instructions`, `#btn-close-instructions`, `.instructions-card`
     - Toasts: `#toast-container`, `#delivery-toast`, `#delivery-toast-text`, `#star-toast`, `#star-toast-text`
     - Results: `#screen-results`, `.results-card`, `#res-title`, `#res-deliveries`, `#res-delivery-pts`, `#res-time`, `#res-time-pts`, `#res-stars`, `#res-stars-pts`, `#res-total-score`, `#res-star-rating`, `#res-star-1`, `#res-star-2`, `#res-star-3`, `#btn-results-replay`, `#btn-results-home`
3. **No Tautologies**:
   - Replace any `${val} / 5` string template assertions with DOM queries against `#res-deliveries` or `#hud-deliveries`.
   - Replace local arithmetic checks with assertions on `#res-total-score` or `#hud-score`.
4. **No Dummy Lambdas**:
   - Wire event listeners using `ui.on('play', ...)`, `ui.on('pauseToggle', ...)`, `ui.on('replay', ...)`, `ui.on('home', ...)`.
   - Trigger user actions by calling `.click()` on the actual rendered button element.
5. **DOM Attribute & Geometry Verification**:
   - When verifying responsiveness or placement, call `getBoundingClientRect()` directly on the elements rendered by `UIManager`.
   - When verifying accessibility, assert on `getAttribute('aria-label')` of genuine buttons.

This remediation strategy completely eliminates all Category A, B, C, and D violations, replacing simulated coverage with 100% genuine, operational integration tests.
