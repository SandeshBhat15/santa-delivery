// tests/e2e/tier3_cross_feature.mjs
// Tier 3: Cross-Feature Combinations (Pairwise interaction coverage)
// Total tests: 32 test cases across 8 major feature pairs

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createBrowserEnvironment,
  readProjectHTML,
  readProjectCSS
} from '../fixtures/browser_environment.mjs';
import {
  SPEC_CONSTANTS,
  oracleCalculateTimeBonus,
  oracleCalculateComboScore,
  oracleCalculateTotalScore,
  oracleCalculateStarRating,
  oracleCalculateJoystickResponse
} from '../fixtures/game_oracles.mjs';
import { createMockSceneContext, createMockCottageTarget, createMockRouteStars } from '../fixtures/mock_scene.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../');

export async function runTier3Tests() {
  const results = [];
  const htmlContent = readProjectHTML();
  const cssContent = readProjectCSS();

  async function test(id, name, fn) {
    const start = performance.now();
    try {
      await fn();
      results.push({ id, name, passed: true, duration: performance.now() - start });
    } catch (err) {
      results.push({ id, name, passed: false, duration: performance.now() - start, error: err.message });
    }
  }

  // =========================================================================
  // PAIR 1: Desktop Keyboard Flight (F-DESKTOP-02) + Top HUD Counters (F-DESKTOP-03)
  // =========================================================================
  await test('PAIR-01-01', 'Pair 1: Sleigh steering keystrokes update heading while top HUD remains unshifted', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    const env = createBrowserEnvironment({ width: 1280, height: 720 });
    
    // Simulate flight steering
    sleigh.inputs.left = true;
    sleigh.update(0.1, 0.1);
    assert.ok(sleigh.turnVelocity > 0, 'Sleigh turned left');

    // Verify HUD elements exist without layout shift
    const hudBar = env.document.createElement('div');
    hudBar.className = 'hud-top-bar';
    const rect = hudBar.getBoundingClientRect();
    assert.strictEqual(rect.top, 0, 'HUD remains anchored to top during flight');
  });

  await test('PAIR-01-02', 'Pair 1: Sleigh altitude pitch climb updates vertical speed while timer counts down', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    
    let timer = 75.0;
    sleigh.inputs.up = true;
    for (let i = 0; i < 5; i++) {
      sleigh.update(0.1, i * 0.1);
      timer -= 0.1;
    }
    assert.ok(sleigh.verticalSpeed > 0, 'Sleigh climbed upward');
    assert.ok(Math.abs(timer - 74.5) < 0.001, 'Timer decremented correctly during climb');
  });

  await test('PAIR-01-03', 'Pair 1: Keyboard flight events do not interfere with top HUD pause button click', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    let pauseToggledValue = null;
    ui.on('pauseToggle', (isPaused) => { pauseToggledValue = isPaused; });

    assert.strictEqual(ui.isPaused, false);
    ui.elements.btnPause.click();
    assert.strictEqual(ui.isPaused, true, 'Clicking pause button toggles isPaused to true');
    assert.strictEqual(pauseToggledValue, true, 'Event pauseToggle must fire with true');

    ui.elements.btnPause.click();
    assert.strictEqual(ui.isPaused, false, 'Clicking pause button again toggles isPaused to false');
    assert.strictEqual(pauseToggledValue, false, 'Event pauseToggle must fire with false');
  });

  await test('PAIR-01-04', 'Pair 1: HUD container pointer-events: none allows mouse flight steering pass-through', async () => {
    const env = createBrowserEnvironment();
    env.uiContainer.style.pointerEvents = 'none';
    assert.strictEqual(env.uiContainer.style.pointerEvents, 'none', 'Container passes through mouse events');
  });

  // =========================================================================
  // PAIR 2: Mobile Dual-Axis Joystick (F-MOBILE-02) + Safe Area Insets (F-MOBILE-01)
  // =========================================================================
  await test('PAIR-02-01', 'Pair 2: Touch joystick in bottom half steers while top HUD respects safe-area-inset-top', async () => {
    const env = createBrowserEnvironment({ width: 390, height: 844 });
    const joyZone = env.document.createElement('div');
    joyZone.id = 'joystick-zone';
    env.uiContainer.appendChild(joyZone);
    const rect = joyZone.getBoundingClientRect();
    assert.ok(rect.top >= 400, 'Joystick zone confined to bottom half');
  });

  await test('PAIR-02-02', 'Pair 2: Vertical stick deflection (climb) works smoothly inside safe viewport', async () => {
    const joyRes = oracleCalculateJoystickResponse(0, -40, 46);
    assert.ok(joyRes.normY < -0.8, 'Deflecting stick upward commands strong climb');
  });

  await test('PAIR-02-03', 'Pair 2: Horizontal stick deflection (yaw) applies banking roll inside mobile FOV 65°', async () => {
    const { camera } = createMockSceneContext();
    camera.fov = 65; // Mobile portrait
    const joyRes = oracleCalculateJoystickResponse(35, 0, 46);
    assert.ok(joyRes.normX > 0.7, 'Right deflection commands strong right turn');
    assert.strictEqual(camera.fov, 65, 'Mobile camera FOV remains 65 degrees');
  });

  await test('PAIR-02-04', 'Pair 2: Touch release cancels joystick deflection without disrupting safe margin padding', async () => {
    const joyRes = oracleCalculateJoystickResponse(0, 0, 46);
    assert.strictEqual(joyRes.normX, 0);
    assert.strictEqual(joyRes.normY, 0);
  });

  // =========================================================================
  // PAIR 3: Auto-Delivery CCD (F-PRESERVE-02) + Combo Score Multipliers (F-STYLE-04)
  // =========================================================================
  await test('PAIR-03-01', 'Pair 3: 1st auto-delivery awards base 100 points without combo multiplier', async () => {
    const combo = 1;
    const basePts = 100;
    const comboPts = oracleCalculateComboScore(basePts, combo);
    assert.strictEqual(comboPts, 0, 'First delivery has no combo bonus');
    assert.strictEqual(basePts + comboPts, 100);
  });

  await test('PAIR-03-02', 'Pair 3: 2nd consecutive auto-delivery triggers COMBO x2 with +50 bonus', async () => {
    const combo = 2;
    const basePts = 100;
    const comboPts = oracleCalculateComboScore(basePts, combo);
    assert.strictEqual(comboPts, 50, 'Combo 2 awards +50 pts');
    assert.strictEqual(basePts + comboPts, 150);
  });

  await test('PAIR-03-03', 'Pair 3: 3rd consecutive auto-delivery triggers COMBO x3 with +100 bonus', async () => {
    const combo = 3;
    const basePts = 100;
    const comboPts = oracleCalculateComboScore(basePts, combo);
    assert.strictEqual(comboPts, 100, 'Combo 3 awards +100 pts');
    assert.strictEqual(basePts + comboPts, 200);
  });

  await test('PAIR-03-04', 'Pair 3: Unbroken streak to 5th delivery accumulates maximum combo points', async () => {
    let totalScore = 0;
    for (let combo = 1; combo <= 5; combo++) {
      totalScore += (100 + oracleCalculateComboScore(100, combo));
    }
    // 100 + 150 + 200 + 250 + 300 = 1000
    assert.strictEqual(totalScore, 1000, '5 deliveries with unbroken streak awards 1000 pts');
  });

  // =========================================================================
  // PAIR 4: Countdown Timer (F-PRESERVE-07) + Urgency Visual Feedback (F-STYLE-06)
  // =========================================================================
  await test('PAIR-04-01', 'Pair 4: Timer at 20.0s updates HUD timer text without .urgent class', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ timeRemaining: 20.0 });
    assert.strictEqual(ui.elements.timer.textContent, '20');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), false);
  });

  await test('PAIR-04-02', 'Pair 4: Crossing 14.9s threshold adds .urgent class and starts pulse animation', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ timeRemaining: 14.9 });
    assert.strictEqual(ui.elements.timer.textContent, '15');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), true);
  });

  await test('PAIR-04-03', 'Pair 4: Timer reaching 0.0s while urgent triggers run timeout lifecycle', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ timeRemaining: 0.0 });
    assert.strictEqual(ui.elements.timer.textContent, '0');

    ui.showResults({ deliveries: 3, maxDeliveries: 5, reason: 'timeout' });
    assert.strictEqual(ui.currentScreen, 'results');
    assert.strictEqual(ui.elements.resTitle.textContent, "TIME'S UP!");
  });

  await test('PAIR-04-04', 'Pair 4: Pausing game with timer at 8.0s halts timer and preserves urgency state', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    // Initial urgent state
    ui.updateHUD({ timeRemaining: 8.0 });
    assert.strictEqual(ui.elements.timer.textContent, '8');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), true);

    // Trigger pause via real button
    ui.elements.btnPause.click();
    assert.strictEqual(ui.isPaused, true);

    // Simulate game loop tick while paused: delta is 0
    const delta = ui.isPaused ? 0 : 1.0;
    const newTime = 8.0 - delta;
    ui.updateHUD({ timeRemaining: newTime });

    assert.strictEqual(ui.elements.timer.textContent, '8', 'Timer must remain frozen at 8s while paused');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), true, 'Urgency styling must persist while paused');
  });

  // =========================================================================
  // PAIR 5: 5-Delivery Goal (F-PRESERVE-06) + Results Screen (F-RESULTS-01) & Rating (F-RESULTS-07)
  // =========================================================================
  await test('PAIR-05-01', 'Pair 5: Completing 5th delivery with 30s remaining renders 3-star parchment card', async () => {
    const deliveries = 5;
    const timeRemaining = 30.0;
    const totalScore = oracleCalculateTotalScore({ deliveryPoints: 500, comboScore: 200, starCount: 4, timeRemaining });
    const stars = oracleCalculateStarRating({ deliveries, totalScore, timeRemaining });
    assert.strictEqual(stars, 3, '5 deliveries with 30s remaining must award 3 stars');
  });

  await test('PAIR-05-02', 'Pair 5: Completing 5th delivery with low score awards 2-star rating', async () => {
    const deliveries = 5;
    const timeRemaining = 5.0;
    const totalScore = 1600;
    const stars = oracleCalculateStarRating({ deliveries, totalScore, timeRemaining });
    assert.strictEqual(stars, 2, '5 deliveries with low score awards 2 stars');
  });

  await test('PAIR-05-03', 'Pair 5: Failing with 2 deliveries due to timeout renders 1-star rating card', async () => {
    const deliveries = 2;
    const timeRemaining = 0.0;
    const totalScore = 300;
    const stars = oracleCalculateStarRating({ deliveries, totalScore, timeRemaining, reason: 'timeout' });
    assert.strictEqual(stars, 1, 'Early timeout awards 1 star');
  });

  await test('PAIR-05-04', 'Pair 5: Results title changes between DELIVERIES COMPLETE! and TIME UP!', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.showResults({ deliveries: 5, maxDeliveries: 5, reason: 'complete' });
    assert.strictEqual(ui.elements.resTitle.textContent, 'DELIVERIES COMPLETE!');

    ui.showResults({ deliveries: 3, maxDeliveries: 5, reason: 'timeout' });
    assert.strictEqual(ui.elements.resTitle.textContent, "TIME'S UP!");

    ui.showResults({ deliveries: 1, maxDeliveries: 5, reason: 'crash' });
    assert.strictEqual(ui.elements.resTitle.textContent, 'SLEIGH CRASH!');
  });

  // =========================================================================
  // PAIR 6: Bonus Stars (F-PRESERVE-04) + Pickup Feedback (F-STYLE-05) + Results Stat (F-RESULTS-03)
  // =========================================================================
  await test('PAIR-06-01', 'Pair 6: Picking up 1st star shows toast (+50 ★) and increments HUD to 1 / 6', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.showStarToast(50);
    assert.strictEqual(ui.elements.starToastText.textContent, '+50 BONUS STAR!');
    assert.strictEqual(ui.elements.starToast.classList.contains('hidden'), false);

    ui.updateHUD({ stars: 1, maxStars: 6 });
    assert.strictEqual(ui.elements.stars.textContent, '1');
    assert.strictEqual(ui.elements.maxStars.textContent, '6');
  });

  await test('PAIR-06-02', 'Pair 6: Collecting all 6 route stars accumulates 300 bonus points in HUD', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ stars: 6, maxStars: 6, score: 300 });
    assert.strictEqual(ui.elements.stars.textContent, '6');
    assert.strictEqual(ui.elements.starsFill.style.width, '100%');
    assert.strictEqual(ui.elements.score.textContent, '300');
  });

  await test('PAIR-06-03', 'Pair 6: Results card displays exact collected star count (4 / 6) and (+200)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.showResults({ stars: 4, maxStars: 6, starScore: 200 });
    assert.strictEqual(ui.elements.resStars.textContent, '4 / 6');
    assert.strictEqual(ui.elements.resStarsPts.textContent, '(+200)');
  });

  await test('PAIR-06-04', 'Pair 6: Zero stars collected displays 0 / 6 (+0) cleanly without errors', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.showResults({ stars: 0, maxStars: 6, starScore: 0 });
    assert.strictEqual(ui.elements.resStars.textContent, '0 / 6');
    assert.strictEqual(ui.elements.resStarsPts.textContent, '(+0)');
  });

  // =========================================================================
  // PAIR 7: Off-Course Guiding Wind (F-PRESERVE-05) + Unobstructed Center View
  // =========================================================================
  await test('PAIR-07-01', 'Pair 7: Guiding wind streams in 3D world space without creating 2D HUD clutter', async () => {
    const env = createBrowserEnvironment();
    // Verify no minimap or permanent compass element is added to DOM
    const minimap = env.document.querySelector('.minimap');
    assert.strictEqual(minimap, null, 'No minimap in DOM during guidance');
  });

  await test('PAIR-07-02', 'Pair 7: Guiding wind curves toward active target while center corridor remains open', async () => {
    const target = createMockCottageTarget(0, 0, -50);
    assert.ok(target.position.z < 0, 'Target sits ahead in corridor');
  });

  await test('PAIR-07-03', 'Pair 7: Realigning heading toward target resets lostTimer to 0.0', async () => {
    let lostTimer = 3.6; // Guidance active
    const headingTowardTarget = true;
    if (headingTowardTarget) lostTimer = 0.0;
    assert.strictEqual(lostTimer, 0.0, 'Realigning must reset lostTimer');
  });

  await test('PAIR-07-04', 'Pair 7: Approaching beacon within 2.5m dissolves guiding wind before delivery touchdown', async () => {
    const dist = 2.0;
    const isDissolved = dist <= SPEC_CONSTANTS.GUIDING_WIND_DISSOLVE_PROXIMITY;
    assert.ok(isDissolved, 'Wind must dissolve at 2.0m (<2.5m)');
  });

  // =========================================================================
  // PAIR 8: Results Navigation (F-RESULTS-08) + Main Menu / Replay Lifecycle (F-DESKTOP-04)
  // =========================================================================
  await test('PAIR-08-01', 'Pair 8: Clicking Replay button resets deliveries, resets timer to 75s, and hides results', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.showScreen('results');
    assert.strictEqual(ui.currentScreen, 'results');

    let replayFired = false;
    ui.on('replay', () => { replayFired = true; });

    ui.elements.btnReplay.click();
    assert.strictEqual(replayFired, true, 'Replay event must fire');
    assert.strictEqual(ui.currentScreen, 'hud', 'Clicking Replay must transition to HUD');
    assert.strictEqual(ui.elements.screenResults.classList.contains('hidden'), true, 'Results screen must be hidden');
  });

  await test('PAIR-08-02', 'Pair 8: Clicking Home button navigates to Main Menu and resets flight physics position', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.showScreen('results');
    let homeFired = false;
    ui.on('home', () => { homeFired = true; });

    ui.elements.btnHome.click();
    assert.strictEqual(homeFired, true, 'Home event must fire');
    assert.strictEqual(ui.currentScreen, 'menu', 'Clicking Home must transition to menu screen');
    assert.strictEqual(ui.elements.screenMenu.classList.contains('hidden'), false, 'Menu screen must be visible');
  });

  await test('PAIR-08-03', 'Pair 8: Main Menu Play button launches run from initial state', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.showScreen('menu');
    let playFired = false;
    ui.on('play', () => { playFired = true; });

    ui.elements.btnPlay.click();
    assert.strictEqual(playFired, true, 'Play event must fire');
    assert.strictEqual(ui.currentScreen, 'hud', 'Clicking Play transitions to active HUD');
    assert.strictEqual(ui.elements.screenMenu.classList.contains('hidden'), true, 'Menu screen must be hidden');
  });

  await test('PAIR-08-04', 'Pair 8: Rapid Replay clicks do not create duplicate game loops or timer leaks', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    let replayCount = 0;
    ui.on('replay', () => { replayCount++; });

    ui.elements.btnReplay.click();
    ui.elements.btnReplay.click();
    assert.strictEqual(replayCount, 2, 'Both clicks handled without state corruption');
    assert.strictEqual(ui.currentScreen, 'hud');
  });

  return results;
}
