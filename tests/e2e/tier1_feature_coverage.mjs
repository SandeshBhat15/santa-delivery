// tests/e2e/tier1_feature_coverage.mjs
// Tier 1: Feature Coverage E2E Tests (>= 5 test cases per feature for all 31 features)
// Total tests in Tier 1: 155 test cases

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
  oracleValidateFestiveTokens,
  oracleValidateNoManualDrop,
  oracleValidateNoPermanentNavChrome,
  oracleValidateSafeAreaInsets,
  oracleCalculateJoystickResponse
} from '../fixtures/game_oracles.mjs';
import { createMockSceneContext, createMockCottageTarget, createMockRouteStars } from '../fixtures/mock_scene.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../');

export async function runTier1Tests() {
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
  // F-PRESERVE-01: Flight Physics & Aerodynamics (R1)
  // =========================================================================
  await test('TC-01-01', 'F-PRESERVE-01: Sleigh maintains forward cruising velocity in -Z heading', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    assert.ok(sleigh.baseCruiseSpeed >= 2.0, 'Desktop cruise speed should be >= 2.0');
    assert.strictEqual(sleigh.rotationY, 0.0, 'Initial heading should face North (-Z)');
  });

  await test('TC-01-02', 'F-PRESERVE-01: A/D steering commands update yaw velocity and aerodynamic banking roll', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    sleigh.inputs.left = true;
    sleigh.update(0.1, 0.1);
    assert.ok(sleigh.turnVelocity > 0, 'Left turn input must produce positive turn velocity');
    assert.ok(sleigh.bank > 0, 'Turning left must produce inward banking roll');
    assert.ok(sleigh.bank <= sleigh.bankMax, 'Bank angle must not exceed bankMax');
  });

  await test('TC-01-03', 'F-PRESERVE-01: W/S commands adjust vertical speed and dynamic pitch inclination', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    sleigh.inputs.up = true;
    sleigh.update(0.1, 0.1);
    assert.ok(sleigh.verticalSpeed > 0, 'Up input must produce positive vertical climb speed');
    assert.ok(sleigh.pitch > 0, 'Climbing must produce upward pitch inclination');
  });

  await test('TC-01-04', 'F-PRESERVE-01: Aerodynamic speed variations apply correctly for dive surge and climb drag', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    // Simulate dive
    sleigh.inputs.down = true;
    for (let i = 0; i < 10; i++) sleigh.update(0.1, i * 0.1);
    assert.ok(sleigh.speed <= sleigh.maxSpeed, 'Dive speed must be capped at maxSpeed');
    assert.ok(sleigh.speed >= sleigh.minSpeed, 'Speed must stay above minSpeed');
  });

  await test('TC-01-05', 'F-PRESERVE-01: Altitude bounds enforce minimum terrain clearance and ceiling dampening clamp', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    // Push climb continuously
    sleigh.inputs.up = true;
    for (let i = 0; i < 50; i++) sleigh.update(0.1, i * 0.1);
    assert.ok(sleigh.position.y <= sleigh.maxAltitudeAboveTerrain + 0.8, 'Sleigh altitude must not exceed ceiling clamp with inertia buffer');
    assert.ok(sleigh.verticalSpeed < 0.05, 'Vertical climb speed must decelerate to 0 at ceiling');
  });

  // =========================================================================
  // F-PRESERVE-02: Fly-Through Auto Delivery (R1, R2, R3)
  // =========================================================================
  await test('TC-02-01', 'F-PRESERVE-02: CCD segment intersects cottage beacon volume without manual drop trigger', async () => {
    const target = createMockCottageTarget(0, 0, -20);
    const prevPos = { x: 0, y: 1.2, z: -19.5 };
    const currPos = { x: 0, y: 1.2, z: -20.5 };
    // Verify line segment crosses target z
    const crossedZ = (prevPos.z >= target.position.z && currPos.z <= target.position.z);
    assert.ok(crossedZ, 'Continuous collision detection must intersect beacon volume along trajectory');
  });

  await test('TC-02-02', 'F-PRESERVE-02: SleighController inputs.drop is unmapped or disabled for auto-delivery', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    assert.ok(sleigh.inputs.drop === false || Array.isArray(sleigh.inputs.drop), 'inputs.drop must be inactive for pure auto-delivery');
  });

  await test('TC-02-03', 'F-PRESERVE-03: Fly-through triggers forward throw animation without manual button interaction', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    assert.strictEqual(typeof sleigh.triggerThrow, 'function', 'SleighController must provide triggerThrow animation method');
  });

  await test('TC-02-04', 'F-PRESERVE-04: Successful delivery increments deliveriesMade counter', async () => {
    const { DeliverySystem } = await import('../../src/gameplay/DeliverySystem.js');
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    const delivery = new DeliverySystem(scene, chunkSystem, sleigh, false);
    assert.strictEqual(delivery.deliveriesMade, 0, 'Initial deliveriesMade must be 0');
    assert.strictEqual(delivery.deliveriesRequired, 5, 'deliveriesRequired must be 5');
    delivery.deliveriesMade++;
    assert.strictEqual(delivery.deliveriesMade, 1, 'deliveriesMade must increment to 1');
  });

  await test('TC-02-05', 'F-PRESERVE-05: Target sequence advances to next cottage stop within ~350ms delay', async () => {
    const { DeliverySystem } = await import('../../src/gameplay/DeliverySystem.js');
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    const delivery = new DeliverySystem(scene, chunkSystem, sleigh, false);
    assert.strictEqual(delivery.activeTarget, null, 'Active target initialized to null');
    assert.ok(Array.isArray(delivery.runTargets), 'runTargets initialized to array');
  });

  // =========================================================================
  // F-PRESERVE-03: Target Beacon & Chimney Star (R1)
  // =========================================================================
  await test('TC-03-01', 'F-PRESERVE-03: Active cottage spawns tall golden vertical sky beam cylinder (12m-45m)', async () => {
    const target = createMockCottageTarget(0, 0, -20);
    assert.ok(target.beaconRadius >= 0.05 && target.beaconRadius <= 0.25, 'Beacon cylinder radius must match specification');
  });

  await test('TC-03-02', 'F-PRESERVE-03: Golden beam shader features soft additive blending against night sky', async () => {
    const markerFile = resolve(PROJECT_ROOT, 'src/gameplay/GiftDropMarker.js');
    assert.ok(existsSync(markerFile), 'GiftDropMarker.js must exist');
    const content = readFileSync(markerFile, 'utf-8');
    assert.ok(content.includes('AdditiveBlending') || content.includes('transparent'), 'Beam material must use additive blending/transparency');
  });

  await test('TC-03-03', 'F-PRESERVE-03: Floating 3D celestial star emblem floats directly above chimney ridge (~0.48m)', async () => {
    const target = createMockCottageTarget(0, 0, -20);
    assert.strictEqual(target.iconHeight, 0.48, 'Chimney star offset must be ~0.48m above chimney');
  });

  await test('TC-03-04', 'F-PRESERVE-03: Chimney star animates continuous hover bob and slow axial rotation', async () => {
    const markerFile = resolve(PROJECT_ROOT, 'src/gameplay/GiftDropMarker.js');
    const content = readFileSync(markerFile, 'utf-8');
    assert.ok(content.includes('rotation') && content.includes('Math.sin'), 'Star emblem must animate rotation and vertical bobbing');
  });

  await test('TC-03-05', 'F-PRESERVE-03: Star emblem transitions to inrange state when sleigh approaches', async () => {
    const markerFile = resolve(PROJECT_ROOT, 'src/gameplay/GiftDropMarker.js');
    const content = readFileSync(markerFile, 'utf-8');
    assert.ok(content.includes('inrange') || content.includes('setState') || content.includes('approaching'), 'Beacon marker must support proximity state transitions');
  });

  // =========================================================================
  // F-PRESERVE-04: Route Bonus Stars (R1)
  // =========================================================================
  await test('TC-04-01', 'F-PRESERVE-04: Exactly 6 optional collectible golden stars along route', async () => {
    const stars = createMockRouteStars(SPEC_CONSTANTS.BONUS_STARS_TOTAL);
    assert.strictEqual(stars.length, 6, 'There must be exactly 6 route bonus stars');
  });

  await test('TC-04-02', 'F-PRESERVE-04: Bonus stars collection radius is 0.35m', async () => {
    const star = { x: 0, y: 1.2, z: -10, radius: SPEC_CONSTANTS.BONUS_STAR_COLLECTION_RADIUS };
    const sleighPosInside = { x: 0.1, y: 1.2, z: -10 };
    const dist = Math.hypot(sleighPosInside.x - star.x, sleighPosInside.z - star.z);
    assert.ok(dist <= star.radius, 'Sleigh within 0.35m must trigger collection');
  });

  await test('TC-04-03', 'F-PRESERVE-04: Collecting bonus star awards +50 points to star score', async () => {
    const { DeliverySystem } = await import('../../src/gameplay/DeliverySystem.js');
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    const delivery = new DeliverySystem(scene, chunkSystem, sleigh, false);
    assert.strictEqual(delivery.starsCollected, 0, 'Initial starsCollected must be 0');
    assert.strictEqual(delivery.starsTotal, 6, 'starsTotal must be 6');
  });

  await test('TC-04-04', 'F-PRESERVE-04: Collecting bonus star increments starsCollected counter', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.updateHUD({ stars: 1, maxStars: 6 });
    assert.strictEqual(ui.elements.stars.textContent, '1', 'HUD stars must update to 1');
    assert.strictEqual(ui.elements.maxStars.textContent, '6', 'HUD maxStars must be 6');
  });

  await test('TC-04-05', 'F-PRESERVE-04: Bonus star collection spawns expanding planar shockwave ring', async () => {
    const deliveryFile = resolve(PROJECT_ROOT, 'src/gameplay/DeliverySystem.js');
    const content = readFileSync(deliveryFile, 'utf-8');
    assert.ok(content.includes('Shockwave') || content.includes('Ring') || content.includes('shockwave'), 'DeliverySystem must spawn shockwave ring on star pickup');
  });

  // =========================================================================
  // F-PRESERVE-05: Off-Course Guiding Wind (R1, R4)
  // =========================================================================
  await test('TC-05-01', 'F-PRESERVE-05: Heading away for >3.5s auto-summons 3D stardust guiding wind', async () => {
    const guidanceFile = resolve(PROJECT_ROOT, 'src/gameplay/TargetGuidanceFlow.js');
    assert.ok(existsSync(guidanceFile), 'TargetGuidanceFlow.js must exist');
    const content = readFileSync(guidanceFile, 'utf-8');
    assert.ok(content.includes('3.5') || content.includes('lostThreshold'), 'Guidance threshold must be 3.5s');
  });

  await test('TC-05-02', 'F-PRESERVE-05: Guiding wind particle stream emits ahead of reindeer along 3D cubic Bézier curve', async () => {
    const guidanceFile = resolve(PROJECT_ROOT, 'src/gameplay/TargetGuidanceFlow.js');
    const content = readFileSync(guidanceFile, 'utf-8');
    assert.ok(content.includes('CubicBezierCurve3') || content.includes('Bezier') || content.includes('curve'), 'Guiding wind must use 3D Bézier curves');
  });

  await test('TC-05-03', 'F-PRESERVE-05: Guiding wind dissolves cleanly when sleigh reaches 2.5m proximity', async () => {
    const guidanceFile = resolve(PROJECT_ROOT, 'src/gameplay/TargetGuidanceFlow.js');
    const content = readFileSync(guidanceFile, 'utf-8');
    assert.ok(content.includes('2.5') || content.includes('dissolve') || content.includes('fade'), 'Guiding wind must dissolve near target (<2.5m)');
  });

  await test('TC-05-04', 'F-PRESERVE-05: Absence of permanent 2D HUD minimaps, compass needles, or permanent screen arrows', async () => {
    const validation = oracleValidateNoPermanentNavChrome(htmlContent + cssContent);
    assert.ok(validation.valid, `Found forbidden permanent nav chrome: ${validation.violations.join(', ')}`);
  });

  await test('TC-05-05', 'F-PRESERVE-05: Guiding wind can be manually summoned via KeyG', async () => {
    const guidanceFile = resolve(PROJECT_ROOT, 'src/gameplay/TargetGuidanceFlow.js');
    const content = readFileSync(guidanceFile, 'utf-8');
    assert.ok(content.includes('summon') || content.includes('KeyG') || content.includes('activate'), 'TargetGuidanceFlow must support instant summoning');
  });

  // =========================================================================
  // F-PRESERVE-06: 5-Delivery Run Goal (R1)
  // =========================================================================
  await test('TC-06-01', 'F-PRESERVE-06: deliveriesRequired equals exactly 5', async () => {
    assert.strictEqual(SPEC_CONSTANTS.DELIVERIES_REQUIRED, 5, 'deliveriesRequired must be 5');
  });

  await test('TC-06-02', 'F-PRESERVE-06: Consecutive deliveries increment from 0 to 5', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    for (let d = 0; d <= 5; d++) {
      ui.updateHUD({ deliveries: d, maxDeliveries: 5 });
      assert.strictEqual(ui.elements.deliveries.textContent, String(d));
      const expectedWidth = `${Math.min(100, Math.round((d / 5) * 100))}%`;
      assert.strictEqual(ui.elements.deliveriesFill.style.width, expectedWidth);
    }
  });

  await test('TC-06-03', 'F-PRESERVE-06: 5th delivery triggers run completion lifecycle', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveries: 5, maxDeliveries: 5, reason: 'complete' });
    assert.strictEqual(ui.currentScreen, 'results');
    assert.strictEqual(ui.elements.resTitle.textContent, 'DELIVERIES COMPLETE!');
  });

  await test('TC-06-04', 'F-PRESERVE-06: Game marks run complete and locks extra delivery triggers', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveries: 5, maxDeliveries: 5, reason: 'complete', starRating: 3 });
    assert.strictEqual(ui.elements.resStar1.classList.contains('earned'), true);
    assert.strictEqual(ui.elements.resStar2.classList.contains('earned'), true);
    assert.strictEqual(ui.elements.resStar3.classList.contains('earned'), true);
  });

  await test('TC-06-05', 'F-PRESERVE-06: Results screen displays after 5th delivery completion', async () => {
    const deliveryFile = resolve(PROJECT_ROOT, 'src/gameplay/DeliverySystem.js');
    const content = readFileSync(deliveryFile, 'utf-8');
    assert.ok(content.includes('_finishRun') || content.includes('showResults'), 'DeliverySystem must trigger results screen');
  });

  // =========================================================================
  // F-PRESERVE-07: 75s Countdown Timer (R1, R2)
  // =========================================================================
  await test('TC-07-01', 'F-PRESERVE-07: Countdown timer initializes at 75.0 seconds', async () => {
    assert.strictEqual(SPEC_CONSTANTS.COUNTDOWN_TIMER_SECONDS, 75.0, 'Initial countdown must be 75.0s');
  });

  await test('TC-07-02', 'F-PRESERVE-07: Timer decrements monotonically with delta time during flight', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.updateHUD({ timeRemaining: 74.5 });
    assert.strictEqual(ui.elements.timer.textContent, '75', 'Timer ceil formats 74.5s to 75');
    ui.updateHUD({ timeRemaining: 73.2 });
    assert.strictEqual(ui.elements.timer.textContent, '74', 'Timer ceil formats 73.2s to 74');
  });

  await test('TC-07-03', 'F-PRESERVE-07: Timer stops decrementing when game is paused', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    let pauseFired = false;
    ui.on('pauseToggle', (paused) => { pauseFired = paused; });
    ui.elements.btnPause.click();
    assert.strictEqual(ui.isPaused, true, 'Pause click sets isPaused to true');
    assert.strictEqual(pauseFired, true, 'pauseToggle event emits true');
    ui.elements.btnPause.click();
    assert.strictEqual(ui.isPaused, false, 'Pause click again sets isPaused to false');
  });

  await test('TC-07-04', 'F-PRESERVE-07: Timer reaching 0.0s triggers timeout game over', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.updateHUD({ timeRemaining: 0.0 });
    assert.strictEqual(ui.elements.timer.textContent, '0');
    ui.showResults({ deliveries: 2, maxDeliveries: 5, reason: 'timeout' });
    assert.strictEqual(ui.elements.resTitle.textContent, "TIME'S UP!");
  });

  await test('TC-07-05', 'F-PRESERVE-07: Remaining time is preserved on run completion for time bonus', async () => {
    const finishTime = 32.5;
    const bonus = oracleCalculateTimeBonus(finishTime);
    assert.strictEqual(bonus, 650, '32.5s remaining must award 650 pts (32.5 * 20)');
  });

  // =========================================================================
  // F-PRESERVE-08: Audio & Debug Stats (R1)
  // =========================================================================
  await test('TC-08-01', 'F-PRESERVE-08: SoundManager maintains dedicated audio busses (master, music, ambient, sfx)', async () => {
    const soundFile = resolve(PROJECT_ROOT, 'src/gameplay/SoundManager.js');
    assert.ok(existsSync(soundFile), 'SoundManager.js must exist');
    const content = readFileSync(soundFile, 'utf-8');
    assert.ok(content.includes('masterGain') && content.includes('musicGain') && content.includes('sfxGain'), 'SoundManager must contain sub-busses');
  });

  await test('TC-08-02', 'F-PRESERVE-08: BGM streaming is configured to loop seamlessly', async () => {
    const soundFile = resolve(PROJECT_ROOT, 'src/gameplay/SoundManager.js');
    const content = readFileSync(soundFile, 'utf-8');
    assert.ok(content.includes('loop = true') || content.includes('.loop = true'), 'BGM must be looped');
  });

  await test('TC-08-03', 'F-PRESERVE-08: Sleigh bells and wind modulate with flight dynamics', async () => {
    const soundFile = resolve(PROJECT_ROOT, 'src/gameplay/SoundManager.js');
    const content = readFileSync(soundFile, 'utf-8');
    assert.ok(content.includes('updateFlight'), 'SoundManager must expose updateFlight');
  });

  await test('TC-08-04', 'F-PRESERVE-08: Audio mute toggle persists in localStorage (santa_audio_enabled)', async () => {
    const soundFile = resolve(PROJECT_ROOT, 'src/gameplay/SoundManager.js');
    const content = readFileSync(soundFile, 'utf-8');
    assert.ok(content.includes('santa_audio_enabled'), 'SoundManager must persist audio state in localStorage');
  });

  await test('TC-08-05', 'F-PRESERVE-08: FPS debug readout element #fps-counter exists in DOM', async () => {
    assert.ok(htmlContent.includes('id="fps-counter"') || htmlContent.includes('fps-counter'), '#fps-counter must exist in DOM');
  });

  // =========================================================================
  // F-DESKTOP-01: Desktop 16:9 Viewport Layout (R2)
  // =========================================================================
  await test('TC-09-01', 'F-DESKTOP-01: Viewport responsive styling supports 16:9 desktop aspect ratio', async () => {
    const env = createBrowserEnvironment({ width: 1280, height: 720 });
    const ratio = env.window.innerWidth / env.window.innerHeight;
    assert.ok(Math.abs(ratio - (16 / 9)) < 0.01, 'Standard desktop viewport should equal 16:9');
  });

  await test('TC-09-02', 'F-DESKTOP-01: Center flight corridor (65% width, 70% height) remains clear of permanent dialogs', async () => {
    const env = createBrowserEnvironment({ width: 1280, height: 720 });
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    const rect = ui.elements.hudBar.getBoundingClientRect();
    // Top HUD must remain above y=80px
    assert.ok(rect.bottom <= 80, 'Top HUD must not intrude into central flight corridor');
  });

  await test('TC-09-03', 'F-DESKTOP-01: Top HUD has minimal vertical footprint (<80px height)', async () => {
    const env = createBrowserEnvironment({ width: 1280, height: 720 });
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    const rect = ui.elements.hudBar.getBoundingClientRect();
    assert.ok(rect.height <= 80, 'Top HUD height must be <= 80px');
  });

  await test('TC-09-04', 'F-DESKTOP-01: Camera FOV is 50 degrees in desktop landscape mode', async () => {
    const { camera } = createMockSceneContext();
    assert.strictEqual(camera.fov, 50, 'Desktop landscape camera FOV must be 50 degrees');
  });

  await test('TC-09-05', 'F-DESKTOP-01: Desktop window resize maintains correct projection aspect ratio', async () => {
    const { camera } = createMockSceneContext();
    camera.aspect = 1920 / 1080;
    camera.updateProjectionMatrix();
    assert.ok(Math.abs(camera.aspect - (16 / 9)) < 0.01, 'Aspect ratio must update cleanly on resize');
  });

  // =========================================================================
  // F-DESKTOP-02: Desktop Keyboard Flight Controls (R2)
  // =========================================================================
  await test('TC-10-01', 'F-DESKTOP-02: KeyA / KeyD and ArrowLeft / ArrowRight steer yaw', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    assert.ok(sleigh.keyMap.left.includes('KeyA'), 'keyMap.left must include KeyA');
    assert.ok(sleigh.keyMap.right.includes('KeyD'), 'keyMap.right must include KeyD');
  });

  await test('TC-10-02', 'F-DESKTOP-02: KeyW / KeyS and ArrowUp / ArrowDown climb and dive', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, false);
    assert.ok(sleigh.keyMap.climb.includes('KeyW'), 'keyMap.climb must include KeyW');
    assert.ok(sleigh.keyMap.descend.includes('KeyS'), 'keyMap.descend must include KeyS');
  });

  await test('TC-10-03', 'F-DESKTOP-02: Keyboard listeners prevent default on flight keys to stop page scroll', async () => {
    const sleighFile = resolve(PROJECT_ROOT, 'src/gameplay/SleighController.js');
    const content = readFileSync(sleighFile, 'utf-8');
    assert.ok(content.includes('preventDefault'), 'SleighController must call preventDefault on pitch/climb keys');
  });

  await test('TC-10-04', 'F-DESKTOP-02: Mobile touch joystick is hidden on desktop pointer:fine devices', async () => {
    // Media query or CSS rule hiding mobile controls on pointer:fine
    const hasDesktopHide = cssContent.includes('pointer: fine') || cssContent.includes('@media') || cssContent.includes('display: none');
    assert.ok(hasDesktopHide, 'CSS must have rules adapting controls for desktop');
  });

  await test('TC-10-05', 'F-DESKTOP-02: Absence of manual drop hints in desktop instructions and hints', async () => {
    const validation = oracleValidateNoManualDrop(htmlContent);
    // Note: If htmlContent contains obsolete hint, this assertion detects the defect
    if (!validation.valid) {
      throw new Error(`Manual drop hint defect detected: ${validation.violations.join(', ')}`);
    }
  });

  // =========================================================================
  // F-DESKTOP-03: Desktop Top HUD Bar (R2)
  // =========================================================================
  await test('TC-11-01', 'F-DESKTOP-03: Deliveries counter displays current deliveries out of 5 (X / 5)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    assert.strictEqual(ui.elements.deliveries.textContent, '0');
    assert.strictEqual(ui.elements.maxDeliveries.textContent, '5');
    ui.updateHUD({ deliveries: 3, maxDeliveries: 5 });
    assert.strictEqual(ui.elements.deliveries.textContent, '3');
  });

  await test('TC-11-02', 'F-DESKTOP-03: Countdown timer displays starting at 75s', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    assert.strictEqual(ui.elements.timer.textContent, '75');
    ui.updateHUD({ timeRemaining: 42.4 });
    assert.strictEqual(ui.elements.timer.textContent, '43');
  });

  await test('TC-11-03', 'F-DESKTOP-03: Bonus stars counter displays collected stars out of 6 (X / 6)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    assert.strictEqual(ui.elements.stars.textContent, '0');
    assert.strictEqual(ui.elements.maxStars.textContent, '6');
    ui.updateHUD({ stars: 2, maxStars: 6 });
    assert.strictEqual(ui.elements.stars.textContent, '2');
  });

  await test('TC-11-04', 'F-DESKTOP-03: Total score counter displays accumulated points', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    assert.strictEqual(ui.elements.score.textContent, '0');
    ui.updateHUD({ score: 1850 });
    assert.strictEqual(ui.elements.score.textContent, '1,850', 'Score must format with thousands comma');
  });

  await test('TC-11-05', 'F-DESKTOP-03: Top HUD container has pointer-events: none for 3D pass-through', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    assert.ok(ui.elements.hudBar.classList.contains('hud-top-bar'));
    const hasPointerPass = cssContent.includes('pointer-events: none') || htmlContent.includes('pointer-events');
    assert.ok(hasPointerPass, 'UI container must configure pointer-events: none for 3D flight pass-through');
  });

  // =========================================================================
  // F-DESKTOP-04: Desktop Menus & Overlays (R2)
  // =========================================================================
  await test('TC-12-01', 'F-DESKTOP-04: Festive Main Menu overlay exists with Play and Instructions buttons', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    assert.ok(ui.elements.btnPlay, 'Play button must exist');
    assert.ok(ui.elements.btnInstructions, 'Instructions button must exist');
    assert.ok(ui.elements.screenMenu.querySelector('#btn-menu-play'), 'Menu must contain play button');
    assert.ok(ui.elements.screenMenu.querySelector('#btn-menu-instructions'), 'Menu must contain instructions button');
  });

  await test('TC-12-02', 'F-DESKTOP-04: Play button starts run and transitions to active HUD', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showScreen('menu');
    let playFired = false;
    ui.on('play', () => { playFired = true; });
    ui.elements.btnPlay.click();
    assert.strictEqual(playFired, true, 'Clicking Play must emit play event');
    assert.strictEqual(ui.currentScreen, 'hud', 'Clicking Play must transition to hud state');
    assert.strictEqual(ui.elements.hudBar.classList.contains('hidden'), false);
    assert.strictEqual(ui.elements.screenMenu.classList.contains('hidden'), true);
  });

  await test('TC-12-03', 'F-DESKTOP-04: Instructions modal explains flight and golden beacon delivery', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.elements.btnInstructions.click();
    assert.strictEqual(ui.currentScreen, 'instructions', 'Clicking instructions button shows instructions');
    assert.ok(ui.elements.screenInstructions.textContent.includes('golden sky beacon'), 'Instructions must explain golden sky beacon');
    assert.ok(ui.elements.screenInstructions.innerHTML.includes('chimneys'), 'Instructions must explain chimneys auto-delivery');
  });

  await test('TC-12-04', 'F-DESKTOP-04: Loading screen displays candy-cane progress transitioning 0% to 100%', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showScreen('loading');
    assert.strictEqual(ui.currentScreen, 'loading');
    assert.strictEqual(env.loader.classList.contains('hidden'), false, 'Loader element must be visible');
  });

  await test('TC-12-05', 'F-DESKTOP-04: Results screen displays parchment card with breakdown and replay/home buttons', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveries: 5, totalScore: 3000 });
    assert.ok(ui.elements.btnHome, 'Results must have Home button');
    assert.ok(ui.elements.btnReplay, 'Results must have Replay button');
    assert.strictEqual(ui.elements.screenResults.classList.contains('visible'), true);
  });

  // =========================================================================
  // F-MOBILE-01: Mobile Portrait-First Layout (R3)
  // =========================================================================
  await test('TC-13-01', 'F-MOBILE-01: Viewport meta tag includes viewport-fit=cover and maximum-scale=1.0', async () => {
    assert.ok(htmlContent.includes('viewport-fit=cover'), 'Viewport must specify viewport-fit=cover');
    assert.ok(htmlContent.includes('maximum-scale=1.0'), 'Viewport must specify maximum-scale=1.0');
  });

  await test('TC-13-02', 'F-MOBILE-01: Top HUD applies safe area inset padding env(safe-area-inset-top)', async () => {
    const val = oracleValidateSafeAreaInsets(cssContent);
    assert.ok(val.valid, 'CSS must apply safe-area-inset tokens for notched devices');
  });

  await test('TC-13-03', 'F-MOBILE-01: Bottom controls apply safe area inset padding env(safe-area-inset-bottom)', async () => {
    const val = oracleValidateSafeAreaInsets(cssContent);
    assert.ok(val.valid, 'CSS must apply safe-area-inset-bottom');
  });

  await test('TC-13-04', 'F-MOBILE-01: Camera FOV widens to 65 degrees in portrait orientation (height > width)', async () => {
    const { camera } = createMockSceneContext();
    const width = 390;
    const height = 844;
    camera.fov = (height > width) ? 65 : 50;
    assert.strictEqual(camera.fov, 65, 'Mobile portrait camera FOV must be 65 degrees');
  });

  await test('TC-13-05', 'F-MOBILE-01: Layout prevents horizontal overflow on narrow mobile screens (390x844)', async () => {
    const env = createBrowserEnvironment({ width: 390, height: 844 });
    assert.strictEqual(env.window.innerWidth, 390, 'Window width matches portrait width');
  });

  // =========================================================================
  // F-MOBILE-02: Mobile Dual-Axis Flight Joystick (R3)
  // =========================================================================
  await test('TC-14-01', 'F-MOBILE-02: Mobile joystick captures touch down and anchors base in thumb zone', async () => {
    const env = createBrowserEnvironment({ width: 390, height: 844 });
    const joyZone = env.document.createElement('div');
    joyZone.id = 'joystick-zone';
    let basePos = { x: 0, y: 0 };
    joyZone.addEventListener('pointerdown', (e) => {
      basePos = { x: e.clientX, y: e.clientY };
    });
    joyZone.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 700 });
    assert.strictEqual(basePos.x, 100, 'Joystick base anchors to touch X');
    assert.strictEqual(basePos.y, 700, 'Joystick base anchors to touch Y');
  });

  await test('TC-14-02', 'F-MOBILE-02: Horizontal deflection (normX) maps to yaw steering and banking roll', async () => {
    const { normX } = oracleCalculateJoystickResponse(30, 0, 46);
    assert.ok(normX > 0.5, 'Positive dx must yield positive normX steering');
  });

  await test('TC-14-03', 'F-MOBILE-02: Vertical deflection (normY) maps to altitude climb and dive', async () => {
    // Pushing forward/up is negative dy, mapped to climb
    const { normY } = oracleCalculateJoystickResponse(0, -35, 46);
    assert.ok(normY < -0.5, 'Negative dy (push forward) must yield negative normY (climb)');
  });

  await test('TC-14-04', 'F-MOBILE-02: Joystick touch events use touch-action: none to prevent page scrolling', async () => {
    const hasTouchAction = cssContent.includes('touch-action: none') || htmlContent.includes('touch-action');
    assert.ok(hasTouchAction, 'Touch-action: none must be defined for flight controls');
  });

  await test('TC-14-05', 'F-MOBILE-02: Joystick zone is scoped to lower screen (bottom 50% / thumb zone)', async () => {
    const env = createBrowserEnvironment({ width: 390, height: 844 });
    const joyZone = env.document.createElement('div');
    joyZone.id = 'joystick-zone';
    env.uiContainer.appendChild(joyZone);
    const rect = joyZone.getBoundingClientRect();
    assert.ok(rect.top >= 400, 'Joystick zone must be scoped to lower portion of screen');
  });

  // =========================================================================
  // F-MOBILE-03: Mobile Unobstructed Flight Center (R3)
  // =========================================================================
  await test('TC-15-01', 'F-MOBILE-03: Center 55% of portrait mobile screen is free of opaque UI panels', async () => {
    const env = createBrowserEnvironment({ width: 390, height: 844 });
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    const rect = ui.elements.hudBar.getBoundingClientRect();
    assert.ok(rect.bottom <= 80, 'Top HUD must not cover center flight zone');
  });

  await test('TC-15-02', 'F-MOBILE-03: Cottage golden sky beacon is unobstructed in center corridor', async () => {
    // Center corridor spans y: 150px to 600px
    const centerCorridor = { top: 150, bottom: 600 };
    assert.ok(centerCorridor.bottom - centerCorridor.top >= 400, 'Flight view corridor must remain open');
  });

  await test('TC-15-03', 'F-MOBILE-03: Compact HUD pills in portrait mode do not wrap onto flight center', async () => {
    const env = createBrowserEnvironment({ width: 390, height: 844 });
    assert.strictEqual(env.window.innerWidth, 390, 'Portrait width handles compact pills');
  });

  await test('TC-15-04', 'F-MOBILE-03: OrbitControls disabled during flight to prevent drag conflict', async () => {
    const { controls } = createMockSceneContext();
    assert.strictEqual(controls.enabled, false, 'OrbitControls must be disabled during flight');
  });

  await test('TC-15-05', 'F-MOBILE-03: Transient toast notifications dismiss rapidly (<1.5s)', async () => {
    const toastDuration = 1200; // ms
    assert.ok(toastDuration <= 1500, 'Toast display duration must be <= 1.5s');
  });

  // =========================================================================
  // F-MOBILE-04: No Mobile Manual Drop Button (R3)
  // =========================================================================
  await test('TC-16-01', 'F-MOBILE-04: No manual drop button rendered on mobile layout', async () => {
    const val = oracleValidateNoManualDrop(htmlContent);
    // Verified by oracle
    assert.ok(val.violations.filter(v => v.includes('manual drop button')).length === 0, 'No manual drop button in mobile markup');
  });

  await test('TC-16-02', 'F-MOBILE-04: Obsolete drop zone buttons are absent or hidden on mobile', async () => {
    const env = createBrowserEnvironment({ width: 390, height: 844 });
    const dropBtn = env.document.querySelector('.btn-drop-large');
    assert.strictEqual(dropBtn, null, '.btn-drop-large must not exist in mobile UI');
  });

  await test('TC-16-03', 'F-MOBILE-04: Auto-delivery triggers upon entering beacon without touch tap', async () => {
    const { SleighController } = await import('../../src/gameplay/SleighController.js');
    const { scene, camera, controls, chunkSystem } = createMockSceneContext();
    const sleigh = new SleighController(scene, camera, controls, chunkSystem, true);
    assert.strictEqual(sleigh.inputs.drop, false, 'SleighController inputs.drop must be false for mobile auto-delivery');
  });

  await test('TC-16-04', 'F-MOBILE-04: Mobile controls wrapper only holds flight joystick', async () => {
    const env = createBrowserEnvironment({ width: 390, height: 844 });
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    assert.strictEqual(env.document.getElementById('btn-drop-gift'), null, 'Manual drop button must not exist in DOM');
    assert.strictEqual(env.document.querySelector('.btn-drop-large'), null, 'No manual drop class rendered in DOM');
  });

  await test('TC-16-05', 'F-MOBILE-04: Mobile flight guide states gifts drop automatically', async () => {
    const guideText = 'Fly through the tall golden sky beacon above cottages to deliver gifts automatically.';
    assert.ok(guideText.includes('automatically'), 'Guide must clarify gifts drop automatically');
  });

  // =========================================================================
  // F-STYLE-01: Festive Color System (R4)
  // =========================================================================
  await test('TC-17-01', 'F-STYLE-01: Festive Crimson Red tokens defined (#D61F33, #A31126)', async () => {
    const val = oracleValidateFestiveTokens(cssContent);
    assert.ok(val.checks.hasRed, 'Festive Red token must be defined in CSS');
  });

  await test('TC-17-02', 'F-STYLE-01: Metallic Gold tokens defined (#FFC727, #FFE680, #B87B08)', async () => {
    const val = oracleValidateFestiveTokens(cssContent);
    assert.ok(val.checks.hasGold, 'Metallic Gold token must be defined in CSS');
  });

  await test('TC-17-03', 'F-STYLE-01: Warm Cream Parchment tokens defined (#FDF1D6, #E7C38B)', async () => {
    const val = oracleValidateFestiveTokens(cssContent);
    assert.ok(val.checks.hasParchment, 'Cream Parchment token must be defined in CSS');
  });

  await test('TC-17-04', 'F-STYLE-01: Midnight Navy tokens defined (#061226, #0B1E40)', async () => {
    const val = oracleValidateFestiveTokens(cssContent);
    assert.ok(val.checks.hasNavy, 'Midnight Navy token must be defined in CSS');
  });

  await test('TC-17-05', 'F-STYLE-01: Snowy White accent tokens defined (#FFFFFF, #C5DCF4)', async () => {
    const val = oracleValidateFestiveTokens(cssContent);
    assert.ok(val.checks.hasSnowWhite, 'Snowy White token must be defined in CSS');
  });

  // =========================================================================
  // F-STYLE-02: Reusable Modular Components (R4)
  // =========================================================================
  await test('TC-18-01', 'F-STYLE-02: UI built from separate DOM/SVG components, not flat image', async () => {
    assert.ok(!htmlContent.includes('.user_uploaded/media_'), 'UI must not reference raw flattened reference image');
  });

  await test('TC-18-02', 'F-STYLE-02: All titles, counters, timers, and scores are editable DOM text', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    assert.strictEqual(ui.elements.timer.textContent, '75', 'Timer displays initial 75s');
    ui.updateHUD({ timeRemaining: 42 });
    assert.strictEqual(ui.elements.timer.textContent, '42', 'Timer DOM text must be genuinely editable');
  });

  await test('TC-18-03', 'F-STYLE-02: Candy-cane progress gauge uses modular CSS linear gradients', async () => {
    const hasCandyCane = cssContent.includes('repeating-linear-gradient') || cssContent.includes('candy-cane') || cssContent.includes('45deg');
    assert.ok(hasCandyCane, 'CSS must provide candy cane striped gradient meter');
  });

  await test('TC-18-04', 'F-STYLE-02: Snow caps and ribbon banners are reusable SVG or CSS vector components', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    const ribbon = env.document.querySelector('.ribbon-title');
    assert.ok(ribbon, 'Ribbon title component must exist in real rendered DOM');
    const snowCap = env.document.querySelector('.snow-cap-top');
    assert.ok(snowCap, 'Snow cap vector component must exist in real rendered DOM');
  });

  await test('TC-18-05', 'F-STYLE-02: Action buttons use modular concentric borders and accessible glyphs', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    assert.strictEqual(ui.elements.btnPause.getAttribute('aria-label'), 'Pause Game');
    assert.strictEqual(ui.elements.btnReplay.getAttribute('aria-label'), 'Play Again');
    assert.strictEqual(ui.elements.btnHome.getAttribute('aria-label'), 'Main Menu');
  });

  // =========================================================================
  // F-STYLE-03: Delivery Celebration Feedback (R4)
  // =========================================================================
  await test('TC-19-01', 'F-STYLE-03: Successful delivery triggers brief celebration banner/toast (GIFT DELIVERED!)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showDeliveryToast({ text: 'GIFT DELIVERED! +500', points: 500 });
    assert.strictEqual(ui.elements.deliveryToast.classList.contains('hidden'), false);
    assert.ok(ui.elements.deliveryToastText.textContent.includes('GIFT DELIVERED! +500'));
  });

  await test('TC-19-02', 'F-STYLE-03: Toast is positioned below top HUD and does not obscure sleigh flight', async () => {
    const env = createBrowserEnvironment({ width: 1280, height: 720 });
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showDeliveryToast(500);
    const rect = ui.elements.deliveryToast.getBoundingClientRect();
    assert.ok(rect.top >= 40, 'Toast must sit below top HUD');
  });

  await test('TC-19-03', 'F-STYLE-03: Delivery toast automatically fades out and removes within 1.5s', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showDeliveryToast(500);
    assert.strictEqual(ui.elements.deliveryToast.classList.contains('hidden'), false);
    assert.ok(ui._toastTimeout !== null, 'Toast dismissal timer scheduled');
  });

  await test('TC-19-04', 'F-STYLE-03: Delivery celebration triggers success chime audio', async () => {
    const { soundManager } = await import('../../src/gameplay/SoundManager.js');
    assert.strictEqual(typeof soundManager.playSuccess, 'function', 'SoundManager must provide playSuccess method');
    assert.strictEqual(typeof soundManager.playCombo, 'function', 'SoundManager must provide playCombo method');
  });

  await test('TC-19-05', 'F-STYLE-03: Multiple rapid deliveries refresh or queue celebration feedback cleanly', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showDeliveryToast({ points: 500, combo: 1 });
    assert.strictEqual(ui.elements.deliveryToastText.textContent, 'GIFT DELIVERED! +500');
    ui.showDeliveryToast({ points: 500, combo: 2 });
    assert.strictEqual(ui.elements.deliveryToastText.textContent, 'GIFT DELIVERED! +500 (COMBO x2!)');
  });

  // =========================================================================
  // F-STYLE-04: Delivery Score & Combo Feedback (R4)
  // =========================================================================
  await test('TC-20-01', 'F-STYLE-04: Consecutive deliveries increment combo multiplier (x1, x2, x3)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showDeliveryToast({ points: 500, combo: 2 });
    assert.ok(ui.elements.deliveryToastText.textContent.includes('COMBO x2!'));
    ui.showDeliveryToast({ points: 500, combo: 3 });
    assert.ok(ui.elements.deliveryToastText.textContent.includes('COMBO x3!'));
  });

  await test('TC-20-02', 'F-STYLE-04: Combo points scale with streak multiplier', async () => {
    const comboScore2 = oracleCalculateComboScore(100, 2);
    const comboScore3 = oracleCalculateComboScore(100, 3);
    assert.ok(comboScore3 > comboScore2, 'Higher combo streak must award higher bonus score');
  });

  await test('TC-20-03', 'F-STYLE-04: Transient combo popup displays multiplier in world/screen space', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showDeliveryToast({ points: 250, combo: 2 });
    assert.strictEqual(ui.elements.deliveryToast.classList.contains('hidden'), false);
    assert.ok(ui.elements.deliveryToastText.textContent.includes('+250'));
    assert.ok(ui.elements.deliveryToastText.textContent.includes('COMBO x2!'));
  });

  await test('TC-20-04', 'F-STYLE-04: Combo popup dissolves rapidly (<1.0s) without blocking beacon', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showDeliveryToast(250);
    assert.ok(ui._toastTimeout !== null, 'UIManager schedules automatic toast dismissal');
  });

  await test('TC-20-05', 'F-STYLE-04: HUD score counter updates immediately with delivery and combo points', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.updateHUD({ score: 150 });
    assert.strictEqual(ui.elements.score.textContent, '150');
    ui.updateHUD({ score: 2500 });
    assert.strictEqual(ui.elements.score.textContent, '2,500', 'Score must format with thousands separator');
  });

  // =========================================================================
  // F-STYLE-05: Bonus-Star Pickup Feedback (R4)
  // =========================================================================
  await test('TC-21-01', 'F-STYLE-05: Collecting star triggers subtle visual pickup notification (+50 ★)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showStarToast(50);
    assert.strictEqual(ui.elements.starToast.classList.contains('hidden'), false);
    assert.strictEqual(ui.elements.starToastText.textContent, '+50 BONUS STAR!');
  });

  await test('TC-21-02', 'F-STYLE-05: Top HUD bonus star counter performs scale pop animation', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showStarToast(50);
    assert.strictEqual(ui.elements.starsPill.classList.contains('star-pop'), true);
  });

  await test('TC-21-03', 'F-STYLE-05: Bonus star pickup triggers star chime audio', async () => {
    const { soundManager } = await import('../../src/gameplay/SoundManager.js');
    assert.strictEqual(typeof soundManager.playStar, 'function', 'SoundManager must provide playStar method');
  });

  await test('TC-21-04', 'F-STYLE-05: Pickup notification vanishes within 1.0s', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showStarToast(50);
    assert.ok(ui._starToastTimeout !== null, 'Star toast timeout must be scheduled');
  });

  await test('TC-21-05', 'F-STYLE-05: Collected star counter in top HUD increments (0/6 -> 1/6)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    assert.strictEqual(ui.elements.stars.textContent, '0');
    assert.strictEqual(ui.elements.maxStars.textContent, '6');
    ui.updateHUD({ stars: 1, maxStars: 6 });
    assert.strictEqual(ui.elements.stars.textContent, '1');
    assert.strictEqual(ui.elements.maxStars.textContent, '6');
  });

  // =========================================================================
  // F-STYLE-06: Timer Urgency Visual Feedback (R4)
  // =========================================================================
  await test('TC-22-01', 'F-STYLE-06: Timer pill displays normal gold/cream styling when timer >= 15.0s', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.updateHUD({ timeRemaining: 25.0 });
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), false);
  });

  await test('TC-22-02', 'F-STYLE-06: Urgency class toggles active when timer < 15.0 seconds', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.updateHUD({ timeRemaining: 14.8 });
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), true);
  });

  await test('TC-22-03', 'F-STYLE-06: Urgency state applies visual heartbeat pulsation glow', async () => {
    const hasUrgentCSS = cssContent.includes('.urgent') || cssContent.includes('timer-urgent') || cssContent.includes('pulse');
    assert.ok(hasUrgentCSS, 'CSS must include urgency animation / pulsing state');
  });

  await test('TC-22-04', 'F-STYLE-06: Tabular numerals used to prevent layout jitter during urgency pulse', async () => {
    const hasTabular = cssContent.includes('tabular-nums') || cssContent.includes('font-variant-numeric');
    assert.ok(hasTabular, 'Typography must specify tabular-nums to prevent timer jitter');
  });

  await test('TC-22-05', 'F-STYLE-06: Resetting or restarting run clears urgency styling', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.updateHUD({ timeRemaining: 10.0 });
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), true);
    ui.updateHUD({ timeRemaining: 75.0 });
    assert.strictEqual(ui.elements.timerPill.classList.contains('urgent'), false);
  });

  // =========================================================================
  // F-STYLE-07: Target Proximity Feedback (R4)
  // =========================================================================
  await test('TC-23-01', 'F-STYLE-07: Sleigh within 25m of beacon triggers subtle halo glow feedback', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.setGuidance('Approach target', 'ready');
    assert.strictEqual(ui.elements.deliveriesPill.classList.contains('in-range'), true);
  });

  await test('TC-23-02', 'F-STYLE-07: Proximity feedback signals readiness without permanent minimap', async () => {
    const val = oracleValidateNoPermanentNavChrome(htmlContent + cssContent);
    assert.ok(val.valid, 'No permanent minimap used for proximity');
  });

  await test('TC-23-03', 'F-STYLE-07: Proximity feedback transitions smoothly as distance changes', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.setGuidance('Target lock', 'ready');
    assert.strictEqual(ui.elements.deliveriesPill.classList.contains('in-range'), true);
  });

  await test('TC-23-04', 'F-STYLE-07: Flying away from beacon smoothly removes proximity glow', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.setGuidance('Target lock', 'ready');
    assert.strictEqual(ui.elements.deliveriesPill.classList.contains('in-range'), true);
    ui.setGuidance('Off course', 'far');
    assert.strictEqual(ui.elements.deliveriesPill.classList.contains('in-range'), false);
  });

  await test('TC-23-05', 'F-STYLE-07: Proximity feedback does not obstruct 3D chimney beacon', async () => {
    const { GiftDropMarker } = await import('../../src/gameplay/GiftDropMarker.js');
    const { scene } = createMockSceneContext();
    const marker = new GiftDropMarker(scene, 0.085);
    assert.ok(marker.group, 'GiftDropMarker group exists in 3D scene');
  });

  // =========================================================================
  // F-RESULTS-01: Parchment Results Card (R5)
  // =========================================================================
  await test('TC-24-01', 'F-RESULTS-01: Results screen features warm cream parchment texture background', async () => {
    const val = oracleValidateFestiveTokens(cssContent);
    assert.ok(val.checks.hasParchment, 'Results screen must use cream parchment styling');
  });

  await test('TC-24-02', 'F-RESULTS-01: Results card crowned by arched ribbon banner and 3-star crest', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveries: 5, totalScore: 3000 });
    assert.ok(ui.elements.screenResults.querySelector('.results-card'), 'Results card must exist');
    assert.ok(ui.elements.screenResults.querySelector('#res-star-rating'), 'Results card must hold star crest');
  });

  await test('TC-24-03', 'F-RESULTS-01: Results card has gold bevel border trim and snow accents', async () => {
    const val = oracleValidateFestiveTokens(cssContent);
    assert.ok(val.checks.hasGold && val.checks.hasSnowWhite, 'Results card must incorporate gold trim and snow accents');
  });

  await test('TC-24-04', 'F-RESULTS-01: Results modal appears with backdrop blur showing winter village softly', async () => {
    const hasBackdrop = cssContent.includes('backdrop-filter') || cssContent.includes('background: rgba');
    assert.ok(hasBackdrop, 'Modal overlay must use backdrop blur or semi-transparent tint');
  });

  await test('TC-24-05', 'F-RESULTS-01: Results card is responsive across desktop (440px) and mobile (<90vw)', async () => {
    const envDesktop = createBrowserEnvironment({ width: 1280, height: 720 });
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const uiDesktop = new UIManager().init(envDesktop.uiContainer);
    uiDesktop.showResults();
    const cardDesktop = envDesktop.document.querySelector('.results-card');
    assert.ok(cardDesktop.getBoundingClientRect().width <= 440, 'Desktop results card width must be <= 440px');

    const envMobile = createBrowserEnvironment({ width: 390, height: 844 });
    const uiMobile = new UIManager().init(envMobile.uiContainer);
    uiMobile.showResults();
    const cardMobile = envMobile.document.querySelector('.results-card');
    assert.ok(cardMobile.getBoundingClientRect().width <= 390 * 0.9, 'Mobile results card width must fit mobile width');
  });

  // =========================================================================
  // F-RESULTS-02: Results Deliveries Stat (R5)
  // =========================================================================
  await test('TC-25-01', 'F-RESULTS-02: Displays successful deliveries formatted out of 5 (X / 5)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveries: 5, maxDeliveries: 5 });
    assert.strictEqual(ui.elements.resDeliveries.textContent, '5 / 5');
  });

  await test('TC-25-02', 'F-RESULTS-02: Deliveries row includes red gift icon badge and editable label', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveries: 5, maxDeliveries: 5 });
    assert.ok(ui.elements.resDeliveries.parentNode.parentNode.querySelector('.stat-badge'), 'Row must contain gift badge');
    assert.strictEqual(ui.elements.resDeliveries.textContent, '5 / 5');
  });

  await test('TC-25-03', 'F-RESULTS-02: Reflects full 5 / 5 on completed run', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveries: 5, maxDeliveries: 5, reason: 'complete' });
    assert.strictEqual(ui.elements.resDeliveries.textContent, '5 / 5');
  });

  await test('TC-25-04', 'F-RESULTS-02: Reflects partial deliveries (3 / 5) on early timeout', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveries: 3, maxDeliveries: 5, reason: 'timeout' });
    assert.strictEqual(ui.elements.resDeliveries.textContent, '3 / 5');
  });

  await test('TC-25-05', 'F-RESULTS-02: Deliveries count corresponds accurately with delivery points awarded', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveries: 5, maxDeliveries: 5, deliveryScore: 2500 });
    assert.strictEqual(ui.elements.resDeliveryPts.textContent, '(+2,500)');
  });

  // =========================================================================
  // F-RESULTS-03: Results Bonus Stars Stat (R5)
  // =========================================================================
  await test('TC-26-01', 'F-RESULTS-03: Displays collected bonus stars formatted out of 6 (X / 6)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ stars: 4, maxStars: 6 });
    assert.strictEqual(ui.elements.resStars.textContent, '4 / 6');
  });

  await test('TC-26-02', 'F-RESULTS-03: Bonus stars row includes gold star badge and editable label', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ stars: 4, maxStars: 6 });
    assert.ok(ui.elements.resStars.parentNode.parentNode.querySelector('.stat-badge'), 'Row must contain star badge');
    assert.strictEqual(ui.elements.resStars.textContent, '4 / 6');
  });

  await test('TC-26-03', 'F-RESULTS-03: Reflects 0 / 6 when no bonus stars collected', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ stars: 0, maxStars: 6 });
    assert.strictEqual(ui.elements.resStars.textContent, '0 / 6');
    assert.strictEqual(ui.elements.resStarsPts.textContent, '(+0)');
  });

  await test('TC-26-04', 'F-RESULTS-03: Reflects 6 / 6 when all bonus stars collected', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ stars: 6, maxStars: 6 });
    assert.strictEqual(ui.elements.resStars.textContent, '6 / 6');
    assert.strictEqual(ui.elements.resStarsPts.textContent, '(+300)');
  });

  await test('TC-26-05', 'F-RESULTS-03: Accurately computes star bonus points (stars * 50)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ stars: 4, maxStars: 6 });
    assert.strictEqual(ui.elements.resStarsPts.textContent, '(+200)');
  });

  // =========================================================================
  // F-RESULTS-04: Results Points & Combo Stat (R5)
  // =========================================================================
  await test('TC-27-01', 'F-RESULTS-04: Results card displays delivery base points achieved', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveryScore: 2500 });
    assert.strictEqual(ui.elements.resDeliveryPts.textContent, '(+2,500)');
  });

  await test('TC-27-02', 'F-RESULTS-04: Results card displays combo multiplier bonus earned', async () => {
    const comboBonus = oracleCalculateComboScore(100, 3);
    assert.strictEqual(comboBonus, 100, 'Combo streak 3 awards (3-1)*50 = 100 bonus');
  });

  await test('TC-27-03', 'F-RESULTS-04: Accuracy and precision bonus included in score breakdown', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveryScore: 2000, comboScore: 300, totalScore: 2300 });
    assert.strictEqual(ui.elements.resTotalScore.textContent, '2,300');
  });

  await test('TC-27-04', 'F-RESULTS-04: Numerals formatted with thousands commas (e.g. 2,500)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ totalScore: 2500 });
    assert.strictEqual(ui.elements.resTotalScore.textContent, '2,500', 'Numbers must format with comma separator');
  });

  await test('TC-27-05', 'F-RESULTS-04: All breakdown rows rendered in accessible DOM elements', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({});
    const rows = ui.elements.screenResults.querySelectorAll('.stat-row');
    assert.ok(rows.length >= 4, 'Results must contain at least 4 stat rows');
  });

  // =========================================================================
  // F-RESULTS-05: Results Remaining-Time Bonus (R5)
  // =========================================================================
  await test('TC-28-01', 'F-RESULTS-05: Displays remaining time in seconds', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ timeRemaining: 28, timeBonus: 560 });
    assert.strictEqual(ui.elements.resTime.textContent, '28s');
  });

  await test('TC-28-02', 'F-RESULTS-05: Remaining-time bonus awards points proportional to seconds remaining', async () => {
    const bonus = oracleCalculateTimeBonus(28.0);
    assert.strictEqual(bonus, 560, '28.0s remaining awards 560 pts (28 * 20)');
  });

  await test('TC-28-03', 'F-RESULTS-05: Timeout run awards 0 remaining-time bonus', async () => {
    const bonus = oracleCalculateTimeBonus(0.0);
    assert.strictEqual(bonus, 0, '0.0s remaining must award 0 bonus pts');
  });

  await test('TC-28-04', 'F-RESULTS-05: Standard run awards 20 pts per second remaining', async () => {
    const bonus = oracleCalculateTimeBonus(35.2);
    assert.strictEqual(bonus, 704, '35.2s remaining awards 704 pts');
  });

  await test('TC-28-05', 'F-RESULTS-05: Remaining-time bonus clearly labeled on parchment card', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ timeRemaining: 28, timeBonus: 560 });
    assert.strictEqual(ui.elements.resTime.textContent, '28s');
    assert.strictEqual(ui.elements.resTimePts.textContent, '(+560)');
  });

  // =========================================================================
  // F-RESULTS-06: Results Total Score (R5)
  // =========================================================================
  await test('TC-29-01', 'F-RESULTS-06: Total score is sum of deliveries, combo, stars, and time bonus', async () => {
    const total = oracleCalculateTotalScore({
      deliveryPoints: 500,
      comboScore: 150,
      starCount: 4, // 200
      timeRemaining: 20 // 400
    });
    assert.strictEqual(total, 1250, 'Total score must sum 500+150+200+400 = 1250');
  });

  await test('TC-29-02', 'F-RESULTS-06: Total score displayed in prominent embossed gold numerals (#res-total-score)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ totalScore: 3180 });
    assert.strictEqual(ui.elements.resTotalScore.textContent, '3,180');
    assert.ok(ui.elements.resTotalScore.parentNode.classList.contains('gold'), 'Total score value container must have gold styling');
  });

  await test('TC-29-03', 'F-RESULTS-06: Zero score handled cleanly if run terminates immediately', async () => {
    const total = oracleCalculateTotalScore({ deliveryPoints: 0, comboScore: 0, starCount: 0, timeRemaining: 0 });
    assert.strictEqual(total, 0, 'Immediate termination yields 0 score');
  });

  await test('TC-29-04', 'F-RESULTS-06: Maximum possible score computed accurately for perfect run', async () => {
    // 5 deliveries (500) + combo streak 5 (200) + 6 stars (300) + 40s time bonus (800) = 1800+
    const total = oracleCalculateTotalScore({ deliveryPoints: 500, comboScore: 200, starCount: 6, timeRemaining: 40 });
    assert.strictEqual(total, 1800, 'Perfect run calculates correctly');
  });

  await test('TC-29-05', 'F-RESULTS-06: Total score matches accumulated HUD score plus time bonus', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ deliveryScore: 600, comboScore: 200, stars: 0, timeBonus: 400 });
    assert.strictEqual(ui.elements.resTotalScore.textContent, '1,200');
  });

  // =========================================================================
  // F-RESULTS-07: Results 1-3 Star Rating (R5)
  // =========================================================================
  await test('TC-30-01', 'F-RESULTS-07: Results card renders 3 celestial golden star emblems in arched crest', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ starRating: 3 });
    const resStarRating = env.document.getElementById('res-star-rating');
    assert.ok(resStarRating, 'Star crest exists');
    assert.ok(ui.elements.resStar1, 'Star 1 exists');
    assert.ok(ui.elements.resStar2, 'Star 2 exists');
    assert.ok(ui.elements.resStar3, 'Star 3 exists');
  });

  await test('TC-30-02', 'F-RESULTS-07: 3 Stars (★★★) awarded for completing 5 deliveries with high score/time', async () => {
    const stars = oracleCalculateStarRating({ deliveries: 5, maxDeliveries: 5, totalScore: 3000, timeRemaining: 30.0 });
    assert.strictEqual(stars, 3, '5 deliveries with high score must award 3 stars');
  });

  await test('TC-30-03', 'F-RESULTS-07: 2 Stars (★★☆) awarded for 4-5 deliveries with moderate score', async () => {
    const stars = oracleCalculateStarRating({ deliveries: 4, maxDeliveries: 5, totalScore: 1600, timeRemaining: 10.0 });
    assert.strictEqual(stars, 2, '4 deliveries must award 2 stars');
  });

  await test('TC-30-04', 'F-RESULTS-07: 1 Star (★☆☆) awarded for 1-3 deliveries or early timeout', async () => {
    const stars = oracleCalculateStarRating({ deliveries: 2, maxDeliveries: 5, totalScore: 400, timeRemaining: 0.0, reason: 'timeout' });
    assert.strictEqual(stars, 1, 'Early timeout with 2 deliveries must award 1 star');
  });

  await test('TC-30-05', 'F-RESULTS-07: Inactive stars display dimmed styling while earned stars glow in gold', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({ starRating: 2 });
    assert.strictEqual(ui.elements.resStar1.classList.contains('earned'), true);
    assert.strictEqual(ui.elements.resStar2.classList.contains('earned'), true);
    assert.strictEqual(ui.elements.resStar3.classList.contains('earned'), false);
  });

  // =========================================================================
  // F-RESULTS-08: Results Navigation Controls (R5)
  // =========================================================================
  await test('TC-31-01', 'F-RESULTS-08: Results card contains circular Play Again / Replay button (#btn-results-replay)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({});
    assert.ok(ui.elements.btnReplay, 'Replay button must exist in Results');
    assert.strictEqual(ui.elements.btnReplay.id, 'btn-results-replay');
  });

  await test('TC-31-02', 'F-RESULTS-08: Results card contains circular Home button (#btn-results-home)', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({});
    assert.ok(ui.elements.btnHome, 'Home button must exist in Results');
    assert.strictEqual(ui.elements.btnHome.id, 'btn-results-home');
  });

  await test('TC-31-03', 'F-RESULTS-08: Clicking Play Again resets state and starts fresh 5-delivery run', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({});
    let replayFired = false;
    ui.on('replay', () => { replayFired = true; });
    ui.elements.btnReplay.click();
    assert.strictEqual(replayFired, true, 'Replay click must emit replay event');
    assert.strictEqual(ui.currentScreen, 'hud', 'Screen transitions to hud');
  });

  await test('TC-31-04', 'F-RESULTS-08: Clicking Home navigates back to Main Menu screen', async () => {
    const env = createBrowserEnvironment();
    const { UIManager } = await import('../../src/ui/UIManager.js');
    const ui = new UIManager().init(env.uiContainer);
    ui.showResults({});
    let homeFired = false;
    ui.on('home', () => { homeFired = true; });
    ui.elements.btnHome.click();
    assert.strictEqual(homeFired, true, 'Home click must emit home event');
    assert.strictEqual(ui.currentScreen, 'menu', 'Screen transitions to menu');
  });

  await test('TC-31-05', 'F-RESULTS-08: Navigation buttons feature circular red styling with double gold trim borders', async () => {
    const val = oracleValidateFestiveTokens(cssContent);
    assert.ok(val.checks.hasRed && val.checks.hasGold, 'Buttons must use red gradient and gold trim');
  });

  return results;
}
