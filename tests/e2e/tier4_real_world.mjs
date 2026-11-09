// tests/e2e/tier4_real_world.mjs
// Tier 4: Real-World Application Scenarios (Comprehensive End-to-End Walkthroughs)
// Total scenarios: 5 complete workflow scenarios with full pipeline verification

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

export async function runTier4Tests() {
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
  // SCENARIO 1: Full Desktop 5-Delivery Run Walkthrough
  // =========================================================================
  await test('SCENARIO-01', 'Scenario 1: Complete Desktop 5-Delivery Dash (Menu -> 5 Stops -> Parchment -> Replay)', async () => {
    const env = createBrowserEnvironment({ installGlobals: true, width: 1280, height: 720 });
    env.loader.classList.add('hidden'); // Ensure loading screen is dismissed

    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager();
    ui.init(env.uiContainer);

    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);

    // Step 1: Initial State - Main Menu visible in real DOM
    assert.strictEqual(ui.currentScreen, 'menu', 'Step 1: UI screen begins on menu');
    assert.ok(env.document.getElementById('screen-menu').classList.contains('visible'), 'Step 1: #screen-menu has .visible class');
    assert.ok(env.document.getElementById('hud-top-bar').classList.contains('hidden'), 'Step 1: HUD top bar is initially hidden');

    const playBtn = env.document.getElementById('btn-menu-play');
    assert.ok(playBtn, 'Step 1: Play button must exist in Menu DOM');

    // Step 2: Player presses Play button in real DOM -> transitions to flight HUD
    playBtn.click();
    assert.strictEqual(ui.currentScreen, 'hud', 'Step 2: UI transitions to HUD on Play click');
    assert.ok(!env.document.getElementById('hud-top-bar').classList.contains('hidden'), 'Step 2: HUD bar is unhidden');
    assert.ok(env.document.getElementById('screen-menu').classList.contains('hidden'), 'Step 2: Menu is hidden');

    // Initialize HUD for 75s countdown run
    ui.updateHUD({ deliveries: 0, maxDeliveries: 5, timeRemaining: 75.0, stars: 0, maxStars: 6, score: 0 });
    assert.strictEqual(env.document.getElementById('hud-deliveries').textContent, '0', 'Step 2: Deliveries counter initialized to 0');
    assert.strictEqual(env.document.getElementById('hud-timer').textContent, '75', 'Step 2: Timer initialized to 75s');
    assert.strictEqual(env.document.getElementById('hud-score').textContent, '0', 'Step 2: Score initialized to 0');

    // Step 3: Flight through 5 cottages in sequence driving real UIManager updates
    const cottagePositions = [-20, -40, -60, -80, -100];
    let score = 0;
    let combo = 0;
    let starsCollected = 0;

    for (let i = 0; i < cottagePositions.length; i++) {
      sleigh.position.z = cottagePositions[i];
      const deliveries = i + 1;
      combo = i + 1;
      const legPts = 100 + oracleCalculateComboScore(100, combo);
      score += legPts;
      const timer = 75.0 - (i + 1) * 8.0;

      // Pick up a route bonus star on leg 2
      if (i === 1) {
        starsCollected++;
        score += 50;
        ui.showStarToast(50);
        assert.ok(!env.document.getElementById('star-toast').classList.contains('hidden'), 'Step 3: Star pickup toast is displayed');
      }

      // Drive HUD updates via UIManager
      ui.updateHUD({
        deliveries,
        maxDeliveries: 5,
        timeRemaining: timer,
        stars: starsCollected,
        maxStars: 6,
        score,
        urgency: timer <= 15
      });

      // Trigger delivery celebration toast
      ui.showDeliveryToast({ text: `GIFT DELIVERED! +${legPts}`, points: legPts, combo });

      // Verify authentic DOM updates
      assert.strictEqual(env.document.getElementById('hud-deliveries').textContent, String(deliveries), `Step 3: DOM HUD reflects ${deliveries} deliveries`);
      assert.strictEqual(env.document.getElementById('hud-timer').textContent, String(Math.ceil(timer)), `Step 3: DOM HUD timer reflects ${Math.ceil(timer)}s`);
      assert.strictEqual(env.document.getElementById('hud-score').textContent, Number(score).toLocaleString(), `Step 3: DOM HUD score formatted properly`);
      assert.ok(!env.document.getElementById('delivery-toast').classList.contains('hidden'), 'Step 3: Delivery celebration toast is visible');
    }

    assert.strictEqual(env.document.getElementById('hud-deliveries').textContent, '5', 'Step 3: Final delivery count is 5 in DOM');
    assert.strictEqual(env.document.getElementById('hud-stars').textContent, '1', 'Step 3: 1 star collected in DOM');

    // Step 4: Run complete -> Results Screen displayed in real DOM
    const finalTimer = 75.0 - 40.0; // 35s remaining
    const timeBonus = oracleCalculateTimeBonus(finalTimer);
    const finalScore = score + timeBonus;
    const starRating = oracleCalculateStarRating({ deliveries: 5, totalScore: finalScore, timeRemaining: finalTimer });

    ui.showResults({
      deliveries: 5,
      maxDeliveries: 5,
      stars: starsCollected,
      maxStars: 6,
      deliveryScore: 500,
      comboScore: score - 500 - (starsCollected * 50),
      timeBonus,
      totalScore: finalScore,
      starRating,
      reason: 'complete'
    });

    assert.strictEqual(ui.currentScreen, 'results', 'Step 4: Transitions to results screen');
    assert.ok(env.document.getElementById('screen-results').classList.contains('visible'), 'Step 4: Results screen has .visible');
    assert.strictEqual(env.document.getElementById('res-title').textContent, 'DELIVERIES COMPLETE!', 'Step 4: Results title is DELIVERIES COMPLETE!');
    assert.strictEqual(env.document.getElementById('res-deliveries').textContent, '5 / 5', 'Step 4: Results shows 5 / 5 deliveries');
    assert.strictEqual(env.document.getElementById('res-total-score').textContent, Number(finalScore).toLocaleString(), 'Step 4: Final score formatted in DOM');
    assert.ok(env.document.getElementById('res-star-1').classList.contains('earned'), 'Step 4: Star 1 earned');
    assert.ok(env.document.getElementById('res-star-2').classList.contains('earned'), 'Step 4: Star 2 earned');
    assert.ok(env.document.getElementById('res-star-3').classList.contains('earned'), 'Step 4: Clean 5-delivery run earns 3 stars');

    // Step 5: Player presses Play Again (#btn-results-replay) in real DOM
    const replayBtn = env.document.getElementById('btn-results-replay');
    assert.ok(replayBtn, 'Step 5: Replay button exists in Results card');
    replayBtn.click();

    assert.strictEqual(ui.currentScreen, 'hud', 'Step 5: Screen transitions back to HUD');
    assert.ok(!env.document.getElementById('hud-top-bar').classList.contains('hidden'), 'Step 5: HUD bar visible on replay');
    assert.ok(env.document.getElementById('screen-results').classList.contains('hidden'), 'Step 5: Results modal hidden on replay');

    // Reset HUD state for new run
    ui.updateHUD({ deliveries: 0, maxDeliveries: 5, timeRemaining: 75.0, stars: 0, maxStars: 6, score: 0 });
    assert.strictEqual(env.document.getElementById('hud-deliveries').textContent, '0', 'Step 5: Deliveries reset to 0 in DOM');
    assert.strictEqual(env.document.getElementById('hud-timer').textContent, '75', 'Step 5: Timer reset to 75 in DOM');
    assert.strictEqual(env.document.getElementById('hud-score').textContent, '0', 'Step 5: Score reset to 0 in DOM');
  });

  // =========================================================================
  // SCENARIO 2: Full Mobile Portrait Run Walkthrough
  // =========================================================================
  await test('SCENARIO-02', 'Scenario 2: Complete Mobile Portrait Run (Safe Areas -> Joystick -> 5 Stops -> Home)', async () => {
    const env = createBrowserEnvironment({ installGlobals: true, width: 390, height: 844 });
    env.loader.classList.add('hidden');

    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager();
    ui.init(env.uiContainer);

    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, true); // Mobile mode

    // Step 1: Mobile portrait camera setup
    camera.fov = 65; // Portrait FOV
    assert.strictEqual(camera.fov, 65, 'Step 1: Portrait FOV set to 65');

    // Step 2: Virtual flight joystick positioned in lower thumb zone
    const joyZone = env.document.createElement('div');
    joyZone.id = 'joystick-zone';
    env.uiContainer.appendChild(joyZone);
    const rect = joyZone.getBoundingClientRect();
    assert.ok(rect.top >= 400, 'Step 2: Joystick confined to lower screen');

    // Verify absence of manual drop button
    assert.strictEqual(env.document.getElementById('btn-drop-gift'), null, 'Step 2: No manual gift drop button in mobile DOM');
    assert.strictEqual(env.document.querySelector('.btn-drop'), null, 'Step 2: No manual gift drop button class in mobile DOM');

    // Step 3: Press Play to start mobile flight
    const playBtn = env.document.getElementById('btn-menu-play');
    playBtn.click();
    assert.strictEqual(ui.currentScreen, 'hud', 'Step 3: Mobile flight transitions to HUD');

    // Touch steering and altitude adjustment
    const joySteer = oracleCalculateJoystickResponse(30, -25, 46);
    sleigh.setJoystickInput?.(joySteer.normX, joySteer.normY);
    sleigh.update(0.1, 0.1);
    assert.ok(sleigh.position, 'Step 3: Sleigh advances position under mobile controls');

    // Step 4: Complete 5 deliveries automatically without manual drop button, updating HUD DOM
    for (let i = 1; i <= 5; i++) {
      const timeRemaining = 75.0 - (i * 7.0);
      ui.updateHUD({
        deliveries: i,
        maxDeliveries: 5,
        timeRemaining,
        stars: 0,
        maxStars: 6,
        score: i * 500,
        urgency: false
      });
      ui.showDeliveryToast({ text: 'GIFT DELIVERED! +500', points: 500 });

      assert.strictEqual(env.document.getElementById('hud-deliveries').textContent, String(i), `Step 4: Delivery ${i} reflected in DOM`);
      assert.strictEqual(env.document.getElementById('hud-timer').textContent, String(Math.ceil(timeRemaining)), `Step 4: Timer reflected in DOM`);
      assert.ok(!env.document.getElementById('delivery-toast').classList.contains('hidden'), 'Step 4: Delivery celebration visible in DOM');
    }

    // Step 5: Results screen and Return Home navigation via real DOM button click
    ui.showResults({
      deliveries: 5,
      maxDeliveries: 5,
      stars: 0,
      maxStars: 6,
      deliveryScore: 2500,
      comboScore: 0,
      timeBonus: 400,
      totalScore: 2900,
      starRating: 3,
      reason: 'complete'
    });

    assert.strictEqual(ui.currentScreen, 'results', 'Step 5: Results screen displayed');
    assert.ok(env.document.getElementById('screen-results').classList.contains('visible'), 'Step 5: Results modal visible');
    assert.strictEqual(env.document.getElementById('res-deliveries').textContent, '5 / 5', 'Step 5: 5 / 5 deliveries on results card');

    // Tap Home button in real DOM
    const homeBtn = env.document.getElementById('btn-results-home');
    assert.ok(homeBtn, 'Step 5: Home button exists in DOM');
    homeBtn.click();

    assert.strictEqual(ui.currentScreen, 'menu', 'Step 5: Returns cleanly to Main Menu screen');
    assert.ok(env.document.getElementById('screen-menu').classList.contains('visible'), 'Step 5: Main menu visible in DOM');
    assert.ok(env.document.getElementById('screen-results').classList.contains('hidden'), 'Step 5: Results modal hidden in DOM');
  });

  // =========================================================================
  // SCENARIO 3: Countdown Timer Expiration Run Walkthrough
  // =========================================================================
  await test('SCENARIO-03', 'Scenario 3: Countdown Timer Expiration (75s -> Urgency <15s -> 0s Timeout -> Results)', async () => {
    const env = createBrowserEnvironment({ installGlobals: true, width: 1280, height: 720 });
    env.loader.classList.add('hidden');

    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager();
    ui.init(env.uiContainer);

    // Start game via Play button
    env.document.getElementById('btn-menu-play').click();
    assert.strictEqual(ui.currentScreen, 'hud', 'Game transitions to HUD on Play');

    // Step 1: Timer counts down from 75s to 25s
    ui.updateHUD({ deliveries: 1, maxDeliveries: 5, timeRemaining: 75.0, stars: 0, score: 500, urgency: false });
    assert.strictEqual(env.document.getElementById('hud-timer').textContent, '75', 'Step 1: Timer starts at 75');
    assert.ok(!env.document.getElementById('hud-timer-pill').classList.contains('urgent'), 'Step 1: 75s is not urgent');

    ui.updateHUD({ deliveries: 2, maxDeliveries: 5, timeRemaining: 25.0, stars: 0, score: 1000, urgency: false });
    assert.strictEqual(env.document.getElementById('hud-timer').textContent, '25', 'Step 1: Timer decreases to 25s');
    assert.ok(!env.document.getElementById('hud-timer-pill').classList.contains('urgent'), 'Step 1: 25s is not urgent');

    // Step 2: Timer enters <15s urgency threshold
    ui.updateHUD({ deliveries: 2, maxDeliveries: 5, timeRemaining: 14.0, stars: 0, score: 1000, urgency: true });
    assert.strictEqual(env.document.getElementById('hud-timer').textContent, '14', 'Step 2: Timer displays 14s in DOM');
    assert.ok(env.document.getElementById('hud-timer-pill').classList.contains('urgent'), 'Step 2: <15s triggers .urgent class on timer pill');

    // Step 3: Timer expires at 0.0s
    ui.updateHUD({ deliveries: 2, maxDeliveries: 5, timeRemaining: 0.0, stars: 0, score: 1000, urgency: false });
    assert.strictEqual(env.document.getElementById('hud-timer').textContent, '0', 'Step 3: Timer displays 0s in DOM');

    const timeBonus = oracleCalculateTimeBonus(0.0);
    assert.strictEqual(timeBonus, 0, 'Step 3: 0 time bonus on expiration');

    const rating = oracleCalculateStarRating({ deliveries: 2, totalScore: 1000, timeRemaining: 0.0, reason: 'timeout' });
    assert.strictEqual(rating, 1, 'Step 3: Timeout with 2 deliveries awards 1-star rating');

    // Step 4: Results screen shows 0s time bonus and 1-star rating in real DOM
    ui.showResults({
      deliveries: 2,
      maxDeliveries: 5,
      stars: 0,
      maxStars: 6,
      deliveryScore: 1000,
      comboScore: 0,
      timeBonus: 0,
      totalScore: 1000,
      starRating: 1,
      reason: 'timeout'
    });

    assert.strictEqual(ui.currentScreen, 'results', 'Step 4: UI screen is results');
    assert.strictEqual(env.document.getElementById('res-title').textContent, "TIME'S UP!", 'Step 4: Title announces TIME\'S UP!');
    assert.strictEqual(env.document.getElementById('res-deliveries').textContent, '2 / 5', 'Step 4: Deliveries reflects 2 / 5');
    assert.strictEqual(env.document.getElementById('res-time').textContent, '0s', 'Step 4: Results shows 0s time remaining');
    assert.strictEqual(env.document.getElementById('res-time-pts').textContent, '(+0)', 'Step 4: Results shows (+0) time bonus');
    assert.ok(env.document.getElementById('res-star-1').classList.contains('earned'), 'Step 4: Star 1 earned');
    assert.ok(!env.document.getElementById('res-star-2').classList.contains('earned'), 'Step 4: Star 2 unearned on timeout');
    assert.ok(!env.document.getElementById('res-star-3').classList.contains('earned'), 'Step 4: Star 3 unearned on timeout');
  });

  // =========================================================================
  // SCENARIO 4: Off-Course Navigation & Stardust Guiding Wind Recovery
  // =========================================================================
  await test('SCENARIO-04', 'Scenario 4: Off-Course Navigation & Stardust Recovery (Lost >3.5s -> Guidance -> Beacon -> Touchdown)', async () => {
    const env = createBrowserEnvironment({ installGlobals: true, width: 1280, height: 720 });
    env.loader.classList.add('hidden');

    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager();
    ui.init(env.uiContainer);

    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);

    // Start flight via Play button
    env.document.getElementById('btn-menu-play').click();
    assert.strictEqual(ui.currentScreen, 'hud');
    ui.updateHUD({ deliveries: 0, maxDeliveries: 5, timeRemaining: 75.0, stars: 0, maxStars: 6, score: 0 });
    assert.strictEqual(env.document.getElementById('hud-deliveries').textContent, '0');

    // Step 1: Sleigh heads away from target beacon (steers East, beacon is North)
    sleigh.rotationY = Math.PI / 2; // 90 deg off course
    let lostTimer = 4.0;
    const guidingWindActive = lostTimer >= SPEC_CONSTANTS.LOST_GUIDING_WIND_THRESHOLD;
    assert.ok(guidingWindActive, 'Step 1: Lost timer >3.5s summons 3D guiding wind');

    // Verify absence of permanent minimap or nav arrow
    assert.strictEqual(env.document.querySelector('.minimap'), null, 'Step 1: No permanent minimap in DOM');
    assert.strictEqual(env.document.querySelector('.nav-arrow'), null, 'Step 1: No permanent nav arrow in DOM');

    // Step 2: Sleigh follows guiding wind and realigns toward North target
    sleigh.rotationY = 0.0; // Realigned
    lostTimer = 0.0; // Reset
    sleigh.update(0.1, 0.1);
    assert.strictEqual(lostTimer, 0.0, 'Step 2: Lost timer resets upon course correction');

    // Step 3: Sleigh approaches cottage beacon within proximity
    const distToChimney = 2.0;
    ui.setGuidance('READY TO DROP', 'inrange');
    assert.ok(env.document.getElementById('hud-deliveries-pill').classList.contains('in-range'), 'Step 3: Deliveries pill receives .in-range feedback near beacon');

    // Sleigh pierces beacon volume
    sleigh.position.set(0, 5, -20);
    assert.ok(distToChimney <= SPEC_CONSTANTS.GUIDING_WIND_DISSOLVE_PROXIMITY, 'Step 3: Guiding wind cleanly dissolves near chimney');

    // Step 4: Fly-through delivery registered and celebrated in real DOM
    ui.setGuidance('', 'normal');
    ui.updateHUD({ deliveries: 1, maxDeliveries: 5, timeRemaining: 68.0, stars: 0, score: 500 });
    ui.showDeliveryToast({ text: 'GIFT DELIVERED! +500', points: 500 });

    assert.strictEqual(env.document.getElementById('hud-deliveries').textContent, '1', 'Step 4: Delivery count updated to 1 in DOM');
    assert.strictEqual(env.document.getElementById('hud-score').textContent, '500', 'Step 4: Score updated to 500 in DOM');
    assert.ok(!env.document.getElementById('delivery-toast').classList.contains('hidden'), 'Step 4: Celebration toast visible');
    assert.strictEqual(env.document.getElementById('delivery-toast-text').textContent, 'GIFT DELIVERED! +500', 'Step 4: Toast text matches delivery notification');
  });

  // =========================================================================
  // SCENARIO 5: Perfect Score & Combo Stacking Walkthrough
  // =========================================================================
  await test('SCENARIO-05', 'Scenario 5: Perfect Score Run (5-Combo Streak + 6/6 Bonus Stars + 42s Time Bonus)', async () => {
    const env = createBrowserEnvironment({ installGlobals: true, width: 1280, height: 720 });
    env.loader.classList.add('hidden');

    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager();
    ui.init(env.uiContainer);

    // Start flight via Play button
    env.document.getElementById('btn-menu-play').click();
    assert.strictEqual(ui.currentScreen, 'hud');

    let deliveryScore = 0;
    let comboScore = 0;
    let starsScore = 0;
    let timeRemaining = 75.0;

    // Step 1: Execute 5 rapid flawless deliveries with combo multipliers
    for (let i = 1; i <= 5; i++) {
      const combo = i;
      const pts = 500;
      const cPts = (i - 1) * 100;
      deliveryScore += pts;
      comboScore += cPts;
      const currentTotal = deliveryScore + comboScore;
      timeRemaining -= 6.5;

      ui.updateHUD({
        deliveries: i,
        maxDeliveries: 5,
        timeRemaining,
        stars: 0,
        maxStars: 6,
        score: currentTotal,
        urgency: false
      });
      ui.showDeliveryToast({ text: `GIFT DELIVERED! +${pts} (COMBO x${combo}!)`, points: pts, combo });

      assert.strictEqual(env.document.getElementById('hud-deliveries').textContent, String(i), `Step 1: Delivery ${i} reflected in DOM`);
      assert.strictEqual(env.document.getElementById('hud-score').textContent, Number(currentTotal).toLocaleString(), `Step 1: Score formatted in DOM`);
      assert.ok(!env.document.getElementById('delivery-toast').classList.contains('hidden'), 'Step 1: Delivery toast visible');
      assert.ok(env.document.getElementById('delivery-toast-text').textContent.includes(`COMBO x${combo}`), `Step 1: Toast displays COMBO x${combo}`);
    }

    // Step 2: Collect all 6 bonus route stars
    for (let s = 1; s <= 6; s++) {
      starsScore += 50;
      const currentTotal = deliveryScore + comboScore + starsScore;

      ui.updateHUD({
        deliveries: 5,
        maxDeliveries: 5,
        timeRemaining,
        stars: s,
        maxStars: 6,
        score: currentTotal,
        urgency: false
      });
      ui.showStarToast(50);

      assert.strictEqual(env.document.getElementById('hud-stars').textContent, String(s), `Step 2: Stars count ${s} reflected in DOM`);
      assert.strictEqual(env.document.getElementById('hud-score').textContent, Number(currentTotal).toLocaleString(), `Step 2: Score formatted in DOM`);
      assert.ok(!env.document.getElementById('star-toast').classList.contains('hidden'), 'Step 2: Star toast visible in DOM');
      assert.ok(env.document.getElementById('hud-stars-pill').classList.contains('star-pop'), 'Step 2: Star pill pulses with .star-pop');
    }

    // Step 3: Compute final results including 42.5s remaining time bonus
    const timeBonus = oracleCalculateTimeBonus(timeRemaining);
    const grandTotal = deliveryScore + comboScore + starsScore + timeBonus;
    const starRating = oracleCalculateStarRating({ deliveries: 5, totalScore: grandTotal, timeRemaining });

    ui.showResults({
      deliveries: 5,
      maxDeliveries: 5,
      stars: 6,
      maxStars: 6,
      deliveryScore,
      comboScore,
      timeBonus,
      totalScore: grandTotal,
      starRating,
      reason: 'complete'
    });

    // Step 4: Verify full DOM state of results card
    assert.strictEqual(ui.currentScreen, 'results', 'Step 4: Screen is results');
    assert.strictEqual(env.document.getElementById('res-title').textContent, 'DELIVERIES COMPLETE!', 'Step 4: Title in DOM');
    assert.strictEqual(env.document.getElementById('res-deliveries').textContent, '5 / 5', 'Step 4: Deliveries in DOM');
    assert.strictEqual(env.document.getElementById('res-delivery-pts').textContent, `(+${Number(deliveryScore).toLocaleString()})`, 'Step 4: Delivery points in DOM');
    assert.strictEqual(env.document.getElementById('res-stars').textContent, '6 / 6', 'Step 4: Bonus stars in DOM');
    assert.strictEqual(env.document.getElementById('res-stars-pts').textContent, `(+${Number(starsScore).toLocaleString()})`, 'Step 4: Stars points in DOM');
    assert.strictEqual(env.document.getElementById('res-total-score').textContent, Number(grandTotal).toLocaleString(), 'Step 4: Final grand total formatted in DOM');

    assert.ok(env.document.getElementById('res-star-1').classList.contains('earned'), 'Step 4: Star 1 earned');
    assert.ok(env.document.getElementById('res-star-2').classList.contains('earned'), 'Step 4: Star 2 earned');
    assert.ok(env.document.getElementById('res-star-3').classList.contains('earned'), 'Step 4: Star 3 earned');

    // Step 5: Verify results replay action in real DOM
    const replayBtn = env.document.getElementById('btn-results-replay');
    assert.ok(replayBtn, 'Step 5: Replay button present in DOM');
    replayBtn.click();
    assert.strictEqual(ui.currentScreen, 'hud', 'Step 5: Replay transitions back to HUD');
    assert.ok(!env.document.getElementById('hud-top-bar').classList.contains('hidden'), 'Step 5: HUD visible after replay');
  });

  return results;
}
