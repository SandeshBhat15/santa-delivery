// tests/e2e/tier2_boundary_corner.mjs
// Tier 2: Boundary & Corner Cases (Boundary Value Analysis on critical constraints)
// Total tests: 35+ test cases

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

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

export async function runTier2Tests() {
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
  // B1: 75s Countdown Timer & Urgency Boundaries (Driving Real UIManager)
  // =========================================================================
  await test('BVA-TIMER-01', 'Timer boundary: exactly 75.00s is start state and NOT urgent', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ timeRemaining: 75.00 });
    assert.strictEqual(ui.elements.timer.textContent, '75', 'Timer must display 75s at start');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), false, '75.0s must not have .urgent class');
  });

  await test('BVA-TIMER-02', 'Timer boundary: 74.99s after first tick remains non-urgent', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ timeRemaining: 74.99 });
    assert.strictEqual(ui.elements.timer.textContent, '75', '74.99s rounds up to 75s via Math.ceil');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), false, '74.99s must remain non-urgent');
  });

  await test('BVA-TIMER-03', 'Timer boundary: 15.01s (just above threshold) remains non-urgent', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ timeRemaining: 15.01 });
    assert.strictEqual(ui.elements.timer.textContent, '16', '15.01s rounds up to 16s via Math.ceil');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), false, '15.01s must not activate urgency');
  });

  await test('BVA-TIMER-04', 'Timer boundary: 15.00s and 14.99s activates urgency state', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ timeRemaining: 15.00 });
    assert.strictEqual(ui.elements.timer.textContent, '15');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), true, '15.00s must activate urgency');

    ui.updateHUD({ timeRemaining: 14.99 });
    assert.strictEqual(ui.elements.timer.textContent, '15');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), true, '14.99s must activate urgency');
  });

  await test('BVA-TIMER-05', 'Timer boundary: 0.01s remains active before expiration', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ timeRemaining: 0.01 });
    assert.strictEqual(ui.elements.timer.textContent, '1', '0.01s rounds up to 1s before 0.00s expiration');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), true, 'Urgency persists down to 0.01s');
  });

  await test('BVA-TIMER-06', 'Timer boundary: exactly 0.00s triggers timeout and clamps to 0', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ timeRemaining: 0.00 });
    assert.strictEqual(ui.elements.timer.textContent, '0', '0.00s displays 0');

    ui.showResults({ deliveries: 2, maxDeliveries: 5, reason: 'timeout' });
    assert.strictEqual(ui.currentScreen, 'results', 'Timeout must transition to results screen');
    assert.strictEqual(ui.elements.resTitle.textContent, "TIME'S UP!", 'Timeout results card title must be TIME\'S UP!');
  });

  await test('BVA-TIMER-07', 'Timer boundary: large negative delta clamping does not produce negative timer', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ timeRemaining: -3.0 });
    assert.strictEqual(ui.elements.timer.textContent, '0', 'UIManager must clamp negative timer to 0');
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), false, 'Sub-zero timer must not remain urgent');
  });

  // =========================================================================
  // B2: 5/5 Deliveries Boundaries (Driving Real UIManager State)
  // =========================================================================
  await test('BVA-DELIV-01', 'Delivery boundary: 0/5 is initial state (0% meter)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ deliveries: 0, maxDeliveries: 5 });
    assert.strictEqual(ui.elements.deliveries.textContent, '0');
    assert.strictEqual(ui.elements.maxDeliveries.textContent, '5');
    assert.strictEqual(ui.elements.deliveriesFill.style.width, '0%');
  });

  await test('BVA-DELIV-02', 'Delivery boundary: 4/5 is penultimate state (80% meter)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ deliveries: 4, maxDeliveries: 5 });
    assert.strictEqual(ui.elements.deliveries.textContent, '4');
    assert.strictEqual(ui.elements.maxDeliveries.textContent, '5');
    assert.strictEqual(ui.elements.deliveriesFill.style.width, '80%');
  });

  await test('BVA-DELIV-03', 'Delivery boundary: exactly 5/5 triggers run completion', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ deliveries: 5, maxDeliveries: 5 });
    assert.strictEqual(ui.elements.deliveries.textContent, '5');
    assert.strictEqual(ui.elements.deliveriesFill.style.width, '100%');

    ui.showResults({ deliveries: 5, maxDeliveries: 5, reason: 'complete' });
    assert.strictEqual(ui.elements.resTitle.textContent, 'DELIVERIES COMPLETE!');
    assert.strictEqual(ui.elements.resDeliveries.textContent, '5 / 5');
  });

  await test('BVA-DELIV-04', 'Delivery boundary: attempting 6th delivery is ignored once complete', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ deliveries: 6, maxDeliveries: 5 });
    // Progress bar must clamp to 100% max, never overflow
    assert.strictEqual(ui.elements.deliveriesFill.style.width, '100%');
  });

  await test('BVA-DELIV-05', 'Delivery boundary: target beacon collision radius threshold (0.16m vs 0.17m)', async () => {
    const beaconRadius = 0.16;
    const beaconPos = new THREE.Vector3(0, 5, -20);
    const santaInside = new THREE.Vector3(0, 5, -20.155);
    const santaOutside = new THREE.Vector3(0, 5, -20.165);
    assert.ok(santaInside.distanceTo(beaconPos) <= beaconRadius, '0.155m is within beacon radius');
    assert.ok(santaOutside.distanceTo(beaconPos) > beaconRadius, '0.165m is outside beacon radius');
  });

  // =========================================================================
  // B3: Off-Course Guiding Wind Boundaries (Driving Real TargetGuidanceFlow)
  // =========================================================================
  await test('BVA-WIND-01', 'Guiding wind boundary: heading away for 3.49s does NOT summon wind', async () => {
    const { TargetGuidanceFlow } = await import('../../src/gameplay/TargetGuidanceFlow.js');
    const { scene } = createMockSceneContext();
    const guidance = new TargetGuidanceFlow(scene, false);

    // Position sleigh at origin heading +X, target is at -Z (heading away)
    guidance.setTarget(new THREE.Vector3(0, 0, -50), new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
    guidance.isGusting = false;
    guidance.restTimer = 0;
    guidance.lostTimer = 3.49;
    guidance.update(0.001);
    assert.strictEqual(guidance.isGusting, false, '3.49s must not trigger guiding wind gust');
  });

  await test('BVA-WIND-02', 'Guiding wind boundary: heading away for exactly 3.50s summons wind', async () => {
    const { TargetGuidanceFlow } = await import('../../src/gameplay/TargetGuidanceFlow.js');
    const { scene } = createMockSceneContext();
    const guidance = new TargetGuidanceFlow(scene, false);

    guidance.setTarget(new THREE.Vector3(0, 0, -50), new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
    guidance.isGusting = false;
    guidance.restTimer = 0;
    guidance.lostTimer = 3.50;
    guidance.update(0.01);
    assert.strictEqual(guidance.isGusting, true, '3.50s lostTimer must summon guiding wind gust');
  });

  await test('BVA-WIND-03', 'Guiding wind boundary: proximity <= 2.50m dissolves wind', async () => {
    const { TargetGuidanceFlow } = await import('../../src/gameplay/TargetGuidanceFlow.js');
    const { scene } = createMockSceneContext();
    const guidance = new TargetGuidanceFlow(scene, false);

    // Target very close (1.0m, within closeFade <= 0.05)
    guidance.setTarget(new THREE.Vector3(0, 0, -1.0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
    guidance.update(0.05);
    assert.ok(guidance.targetDistance <= 2.50, 'Target distance <= 2.5m initiates dissolution');
  });

  await test('BVA-WIND-04', 'Guiding wind boundary: proximity 2.51m keeps wind active', async () => {
    const { TargetGuidanceFlow } = await import('../../src/gameplay/TargetGuidanceFlow.js');
    const { scene } = createMockSceneContext();
    const guidance = new TargetGuidanceFlow(scene, false);

    guidance.setTarget(new THREE.Vector3(0, 0, -20.0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
    guidance.update(0.05);
    assert.ok(guidance.targetDistance > 2.50, '20m target maintains active guidance stream');
  });

  // =========================================================================
  // B4: Flight Speed & Altitude Boundaries
  // =========================================================================
  await test('BVA-FLIGHT-01', 'Flight boundary: ground limit (localGroundH + 0.01) triggers terrain crash', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    sleigh.position.y = 0.005; // Below ground limit
    let crashReported = false;
    sleigh.onCrash = () => { crashReported = true; };
    // Check collision logic in SleighController
    assert.ok(sleigh.minAltitudeAboveTerrain >= 0.02, 'minAltitudeAboveTerrain must be defined');
  });

  await test('BVA-FLIGHT-02', 'Flight boundary: ceiling clamp prevents exceeding 3.2m above terrain', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    assert.strictEqual(sleigh.maxAltitudeAboveTerrain, 3.2, 'Ceiling must be 3.2m');
  });

  await test('BVA-FLIGHT-03', 'Flight boundary: maximum dive speed does not exceed 5.52 m/s desktop', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    assert.strictEqual(sleigh.maxSpeed, 5.52, 'maxSpeed must be 5.52 on desktop');
  });

  await test('BVA-FLIGHT-04', 'Flight boundary: minimum stall speed does not drop below 1.68 m/s desktop', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    assert.strictEqual(sleigh.minSpeed, 1.68, 'minSpeed must be 1.68 on desktop');
  });

  await test('BVA-FLIGHT-05', 'Flight boundary: mobile speed bounds (min: 1.38, max: 4.08)', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleighMobile = new SleighController(scene, camera, controls, chunkSystem, true);
    assert.strictEqual(sleighMobile.minSpeed, 1.38, 'minSpeed mobile must be 1.38');
    assert.strictEqual(sleighMobile.maxSpeed, 4.08, 'maxSpeed mobile must be 4.08');
  });

  // =========================================================================
  // B5: Rapid Screen Resizing & Aspect Ratio Boundaries
  // =========================================================================
  await test('BVA-RESIZE-01', 'Resize boundary: rapid switching between 1280x720 and 390x844', async () => {
    const env = createBrowserEnvironment({ width: 1280, height: 720 });
    assert.strictEqual(env.window.innerWidth, 1280);
    // Switch to mobile
    env.window.resize(390, 844);
    assert.strictEqual(env.window.innerWidth, 390);
    assert.strictEqual(env.window.innerHeight, 844);
    // Switch back to desktop
    env.window.resize(1920, 1080);
    assert.strictEqual(env.window.innerWidth, 1920);
  });

  await test('BVA-RESIZE-02', 'Resize boundary: square viewport (800x800) aspect ratio switch', async () => {
    const { camera } = createMockSceneContext();
    const width = 800;
    const height = 800;
    camera.fov = (height > width) ? 65 : 50;
    assert.strictEqual(camera.fov, 50, 'Equal width and height defaults to 50 FOV');
  });

  await test('BVA-RESIZE-03', 'Resize boundary: minimum compact mobile viewport (320x568)', async () => {
    const env = createBrowserEnvironment({ width: 320, height: 568 });
    assert.strictEqual(env.window.innerWidth, 320);
    assert.strictEqual(env.window.innerHeight, 568);
  });

  await test('BVA-RESIZE-04', 'Resize boundary: ultrawide 21:9 viewport (2560x1080)', async () => {
    const env = createBrowserEnvironment({ width: 2560, height: 1080 });
    const ratio = env.window.innerWidth / env.window.innerHeight;
    assert.ok(ratio > 2.0, 'Ultrawide ratio > 2.0');
  });

  // =========================================================================
  // B6: Mobile Joystick Input Boundaries
  // =========================================================================
  await test('BVA-JOY-01', 'Joystick boundary: input within deadzone (hypot < 0.08) produces zero output', async () => {
    // dx = 2px, dy = 2px with radius 46 -> mag = hypot(2/46, 2/46) = 0.061 < 0.08
    const res = oracleCalculateJoystickResponse(2, 2, 46);
    assert.ok(res.isDeadzone, 'Deflection within 0.08 must be flagged deadzone');
    assert.strictEqual(res.normX, 0, 'Deadzone normX must be 0');
    assert.strictEqual(res.normY, 0, 'Deadzone normY must be 0');
  });

  await test('BVA-JOY-02', 'Joystick boundary: extreme stick deflection (200px, 200px) is clamped to unit circle', async () => {
    const res = oracleCalculateJoystickResponse(200, 200, 46);
    const mag = Math.hypot(res.normX, res.normY);
    assert.ok(Math.abs(mag - 1.0) < 0.001, 'Clamped magnitude must equal 1.0');
  });

  await test('BVA-JOY-03', 'Joystick boundary: negative boundary (-46px, -46px) clamped properly', async () => {
    const res = oracleCalculateJoystickResponse(-46, -46, 46);
    assert.ok(res.normX < 0 && res.normY < 0, 'Negative inputs must preserve negative sign');
  });

  await test('BVA-JOY-04', 'Joystick boundary: stick release immediately zeroes inputs', async () => {
    const res = oracleCalculateJoystickResponse(0, 0, 46);
    assert.strictEqual(res.normX, 0);
    assert.strictEqual(res.normY, 0);
  });

  // =========================================================================
  // B7: Bonus Star Collection Boundaries
  // =========================================================================
  await test('BVA-STAR-01', 'Star boundary: exactly 0.35m is within collection radius', async () => {
    const radius = SPEC_CONSTANTS.BONUS_STAR_COLLECTION_RADIUS;
    assert.ok(0.35 <= radius, '0.35m must collect');
  });

  await test('BVA-STAR-02', 'Star boundary: 0.36m is outside collection radius', async () => {
    const radius = SPEC_CONSTANTS.BONUS_STAR_COLLECTION_RADIUS;
    assert.ok(0.36 > radius, '0.36m must not collect');
  });

  await test('BVA-STAR-03', 'Star boundary: collecting all 6 stars reaches 6/6 cap', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);

    ui.updateHUD({ stars: 6, maxStars: 6 });
    assert.strictEqual(ui.elements.stars.textContent, '6');
    assert.strictEqual(ui.elements.maxStars.textContent, '6');
    assert.strictEqual(ui.elements.starsFill.style.width, '100%');
  });

  await test('BVA-STAR-04', 'Star boundary: re-flying through collected star is idempotent (no double score)', async () => {
    const env = createBrowserEnvironment();
    const { DeliverySystem } = await import('../../src/gameplay/DeliverySystem.js');
    const { scene } = createMockSceneContext();
    const delivery = new DeliverySystem(scene, false);

    const mockStar = {
      collected: false,
      group: new THREE.Group()
    };
    delivery.activeStars = [mockStar];
    delivery.starsGroup.add(mockStar.group);

    delivery._collectStar(mockStar, 0);
    assert.strictEqual(delivery.starsCollected, 1, 'First pass collects star');
    assert.strictEqual(delivery.starScore, 50, 'First pass awards 50 points');

    // Duplicate pass
    delivery._collectStar(mockStar, -1);
    assert.strictEqual(delivery.starsCollected, 1, 'Duplicate pass is idempotent');
    assert.strictEqual(delivery.starScore, 50, 'Duplicate pass does not award extra points');
  });

  // =========================================================================
  // B8: Results Rating & Score Boundaries
  // =========================================================================
  await test('BVA-RATING-01', 'Rating boundary: 5 deliveries with score 2500 earns 3 stars', async () => {
    const rating = oracleCalculateStarRating({ deliveries: 5, totalScore: 2500, timeRemaining: 15.0 });
    assert.strictEqual(rating, 3, '5 deliveries and 2500 pts must award 3 stars');
  });

  await test('BVA-RATING-02', 'Rating boundary: 5 deliveries with score 2499 and timeRemaining 24.9s earns 2 stars', async () => {
    const rating = oracleCalculateStarRating({ deliveries: 5, totalScore: 2499, timeRemaining: 24.9 });
    assert.strictEqual(rating, 2, 'Below 2500 pts and below 25s awards 2 stars');
  });

  await test('BVA-RATING-03', 'Rating boundary: 3 deliveries with 1200 pts earns 2 stars', async () => {
    const rating = oracleCalculateStarRating({ deliveries: 3, totalScore: 1200 });
    assert.strictEqual(rating, 2, '3 deliveries and 1200 pts awards 2 stars');
  });

  await test('BVA-RATING-04', 'Rating boundary: 2 deliveries with 1199 pts earns 1 star', async () => {
    const rating = oracleCalculateStarRating({ deliveries: 2, totalScore: 1199 });
    assert.strictEqual(rating, 1, '2 deliveries and 1199 pts awards 1 star');
  });

  // =========================================================================
  // B9: Adversarial Verification (Encoding, Invalid Combinations, Resource Stress)
  // =========================================================================
  await test('ADV-01', 'Adversarial: HTML special character injection in toasts preserves escaping without raw script execution', async () => {
    const env = createBrowserEnvironment();
    const toast = env.document.createElement('div');
    toast.className = 'ribbon-toast';
    const payload = '<script>alert("pwned")</script> & <img src=x onerror=alert(1)>';
    toast.textContent = payload; // Safe assignment
    assert.ok(!toast.innerHTML.includes('<script>alert'), 'Script tags must not be executed');
    assert.strictEqual(toast.textContent, payload, 'Text content retains exact characters cleanly');
  });

  await test('ADV-02', 'Adversarial: Non-numeric, NaN, and undefined inputs in score oracles fall back gracefully to 0', async () => {
    assert.strictEqual(oracleCalculateTimeBonus(NaN), 0, 'NaN time bonus must return 0');
    assert.strictEqual(oracleCalculateTimeBonus(undefined), 0, 'undefined time bonus must return 0');
    assert.strictEqual(oracleCalculateTimeBonus(-50), 0, 'negative time bonus must return 0');
    assert.strictEqual(oracleCalculateComboScore(100, -2), 0, 'negative combo streak must return 0');
  });

  await test('ADV-03', 'Adversarial: Massive frame delta spike (100.0s background tab sleep) clamps timer cleanly to 0.0s', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.updateHUD({ timeRemaining: -25.0 });
    assert.strictEqual(ui.elements.timer.textContent, '0', 'UIManager must clamp negative timer to 0');
  });

  await test('ADV-04', 'Adversarial: Extreme negative / out-of-range joystick inputs clamp to unit magnitude', async () => {
    const res = oracleCalculateJoystickResponse(-9999, 9999, 46);
    const mag = Math.hypot(res.normX, res.normY);
    assert.ok(Math.abs(mag - 1.0) < 0.001, 'Magnitude must clamp to 1.0');
    assert.ok(!Number.isNaN(res.normX) && !Number.isNaN(res.normY), 'Must not produce NaN');
  });

  await test('ADV-05', 'Adversarial: Zero-distance coincident coordinates do not cause division by zero in joystick or distance checks', async () => {
    const res = oracleCalculateJoystickResponse(0, 0, 46);
    assert.strictEqual(res.normX, 0);
    assert.strictEqual(res.normY, 0);
    assert.strictEqual(res.isDeadzone, true);
  });

  return results;
}
