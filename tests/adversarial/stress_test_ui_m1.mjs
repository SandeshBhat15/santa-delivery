// tests/adversarial/stress_test_ui_m1.mjs
// Adversarial Stress Harness for Milestone 1 UI Architecture
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserEnvironment } from '../fixtures/browser_environment.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
  } else {
    failedTests++;
    failures.push(message);
    console.error(`  FAIL: ${message}`);
  }
}

async function runAdversarialSuite() {
  console.log('========================================================================');
  console.log('   ADVERSARIAL STRESS TEST SUITE — MILESTONE 1 UI ARCHITECTURE         ');
  console.log('========================================================================\n');

  // Install headless browser globals
  createBrowserEnvironment({ installGlobals: true, width: 1280, height: 720 });
  const { UIManager } = await import('../../src/ui/UIManager.js');

  // -------------------------------------------------------------------------
  // SECTION 1: RAPID SCREEN TRANSITIONS & OVERLAY STATE INVARIANTS
  // -------------------------------------------------------------------------
  console.log('--- Challenge 1: Rapid Screen Transitions & Overlay State Invariants ---');

  const container = document.getElementById('ui-container');
  const ui = new UIManager();
  ui.init(container);

  const screens = ['menu', 'instructions', 'loading', 'hud', 'results'];

  function verifyScreenState(activeScreen) {
    const isPlaying = activeScreen === 'hud' || activeScreen === 'playing';

    // Menu overlay check
    const menuEl = ui.elements.screenMenu;
    if (activeScreen === 'menu') {
      if (!menuEl.classList.contains('visible') || menuEl.classList.contains('hidden')) {
        return `Menu overlay invalid for screen 'menu': visible=${menuEl.classList.contains('visible')}, hidden=${menuEl.classList.contains('hidden')}`;
      }
    } else {
      if (menuEl.classList.contains('visible') || !menuEl.classList.contains('hidden')) {
        return `Menu overlay leaked during screen '${activeScreen}'`;
      }
    }

    // Instructions overlay check
    const instEl = ui.elements.screenInstructions;
    if (activeScreen === 'instructions') {
      if (!instEl.classList.contains('visible') || instEl.classList.contains('hidden')) {
        return `Instructions overlay invalid for screen 'instructions'`;
      }
    } else {
      if (instEl.classList.contains('visible') || !instEl.classList.contains('hidden')) {
        return `Instructions overlay leaked during screen '${activeScreen}'`;
      }
    }

    // Results overlay check
    const resEl = ui.elements.screenResults;
    if (activeScreen === 'results') {
      if (!resEl.classList.contains('visible') || resEl.classList.contains('hidden')) {
        return `Results overlay invalid for screen 'results'`;
      }
    } else {
      if (resEl.classList.contains('visible') || !resEl.classList.contains('hidden')) {
        return `Results overlay leaked during screen '${activeScreen}'`;
      }
    }

    // HUD top bar check
    const hudBar = ui.elements.hudBar;
    if (isPlaying) {
      if (hudBar.classList.contains('hidden')) {
        return `HUD bar hidden when playing`;
      }
    } else {
      if (!hudBar.classList.contains('hidden')) {
        return `HUD bar visible when not playing (screen=${activeScreen})`;
      }
    }

    // Loader check
    const loader = ui.elements.loader;
    if (loader) {
      if (activeScreen === 'loading') {
        if (loader.classList.contains('hidden')) {
          return `Loader marked hidden during screen 'loading'`;
        }
      } else {
        if (!loader.classList.contains('hidden')) {
          return `Loader leaked during screen '${activeScreen}'`;
        }
      }
    }

    return null; // All invariants pass
  }

  // 1. Sequential Screen Transitions
  let seqError = null;
  for (const s of screens) {
    ui.showScreen(s);
    seqError = verifyScreenState(s);
    if (seqError) break;
  }
  assert(!seqError, `Sequential screen transition invariant: ${seqError}`);

  // 2. Rapid Alternating Switching (500 cycles = 1000 transitions)
  let altError = null;
  for (let i = 0; i < 500; i++) {
    ui.showScreen('menu');
    altError = verifyScreenState('menu');
    if (altError) break;

    ui.showScreen('instructions');
    altError = verifyScreenState('instructions');
    if (altError) break;
  }
  assert(!altError, `Rapid menu/instructions alternation (1000 transitions): ${altError}`);

  // 3. High-Frequency Random Screen Jumping (1000 iterations)
  let randError = null;
  for (let i = 0; i < 1000; i++) {
    const target = screens[Math.floor(Math.random() * screens.length)];
    ui.showScreen(target);
    randError = verifyScreenState(target);
    if (randError) break;
  }
  assert(!randError, `1,000 random rapid screen hops: ${randError}`);

  // 4. Repeated Re-initialization Check (DOM Duplication & Leak Prevention)
  const initialChildCount = container.children.length;
  for (let i = 0; i < 10; i++) {
    ui.init(container);
  }
  const finalChildCount = container.children.length;
  assert(
    finalChildCount === initialChildCount,
    `uiManager.init() idempotence: expected ${initialChildCount} child nodes, got ${finalChildCount} (no DOM leaks on re-init)`
  );

  // 5. Rapid Transient Toasts (100 rapid calls)
  let toastError = null;
  try {
    for (let i = 0; i < 100; i++) {
      ui.showDeliveryToast({ points: 500 + i, combo: (i % 5) + 1 });
      ui.showStarToast({ points: 50 });
    }
  } catch (err) {
    toastError = err.message;
  }
  assert(!toastError, `100 rapid delivery & star toast bursts execute without error`);

  console.log(`  Passed ${passedTests} / ${totalTests} transition and overlay invariant tests.\n`);

  // -------------------------------------------------------------------------
  // SECTION 2: RESULTS SCREEN STAR RATINGS, POINT FORMATTING & TRIGGERS
  // -------------------------------------------------------------------------
  console.log('--- Challenge 2: Results Screen Ratings, Formatting & Triggers ---');

  // A. 1-Star Rating Verification
  ui.showResults({
    deliveries: 1,
    maxDeliveries: 5,
    stars: 1,
    deliveryScore: 500,
    comboScore: 0,
    timeBonus: 0,
    totalScore: 550,
    reason: 'timeout'
  });
  assert(ui.elements.resTitle.textContent === "TIME'S UP!", '1-Star timeout title is "TIME\'S UP!"');
  assert(ui.elements.resStar1.classList.contains('earned'), 'Star 1 is earned for 1-star rating');
  assert(!ui.elements.resStar2.classList.contains('earned'), 'Star 2 is unearned for 1-star rating');
  assert(!ui.elements.resStar3.classList.contains('earned'), 'Star 3 is unearned for 1-star rating');
  assert(ui.elements.resStar1.querySelector('.icon-star').style.opacity === '1.0', 'Star 1 opacity is 1.0');
  assert(ui.elements.resStar2.querySelector('.icon-star').style.opacity === '0.22', 'Star 2 opacity is 0.22');
  assert(ui.elements.resStar3.querySelector('.icon-star').style.opacity === '0.22', 'Star 3 opacity is 0.22');

  // B. 2-Star Rating Verification
  ui.showResults({
    deliveries: 3,
    maxDeliveries: 5,
    stars: 3,
    deliveryScore: 1500,
    comboScore: 100,
    timeBonus: 100,
    totalScore: 1850,
    starRating: 2,
    reason: 'complete'
  });
  assert(ui.elements.resStar1.classList.contains('earned'), 'Star 1 is earned for 2-star rating');
  assert(ui.elements.resStar2.classList.contains('earned'), 'Star 2 is earned for 2-star rating');
  assert(!ui.elements.resStar3.classList.contains('earned'), 'Star 3 is unearned for 2-star rating');
  assert(ui.elements.resStar2.querySelector('.icon-star').style.opacity === '1.0', 'Star 2 opacity is 1.0');
  assert(ui.elements.resStar3.querySelector('.icon-star').style.opacity === '0.22', 'Star 3 opacity is 0.22');

  // C. 3-Star Rating Verification
  ui.showResults({
    deliveries: 5,
    maxDeliveries: 5,
    stars: 6,
    deliveryScore: 2500,
    comboScore: 500,
    timeBonus: 400,
    totalScore: 3700,
    reason: 'complete'
  });
  assert(ui.elements.resTitle.textContent === 'DELIVERIES COMPLETE!', '3-Star completion title is "DELIVERIES COMPLETE!"');
  assert(ui.elements.resStar1.classList.contains('earned'), 'Star 1 is earned for 3-star rating');
  assert(ui.elements.resStar2.classList.contains('earned'), 'Star 2 is earned for 3-star rating');
  assert(ui.elements.resStar3.classList.contains('earned'), 'Star 3 is earned for 3-star rating');
  assert(ui.elements.resStar3.querySelector('.icon-star').style.opacity === '1.0', 'Star 3 opacity is 1.0');

  // D. Sleigh Crash Title
  ui.showResults({ deliveries: 0, reason: 'crash' });
  assert(ui.elements.resTitle.textContent === 'SLEIGH CRASH!', 'Crash title is "SLEIGH CRASH!"');

  // E. Rating Boundary Clamping
  ui.showResults({ starRating: 0 });
  assert(ui.elements.resStar1.classList.contains('earned') && !ui.elements.resStar2.classList.contains('earned'), 'starRating 0 clamped to 1');

  ui.showResults({ starRating: 10 });
  assert(ui.elements.resStar3.classList.contains('earned'), 'starRating 10 clamped to 3');

  ui.showResults({ starRating: -5 });
  assert(ui.elements.resStar1.classList.contains('earned') && !ui.elements.resStar2.classList.contains('earned'), 'starRating -5 clamped to 1');

  // F. Point and Comma Formatting
  ui.showResults({
    deliveries: 5,
    maxDeliveries: 5,
    stars: 6,
    maxStars: 6,
    deliveryScore: 2500,
    comboScore: 750,
    timeBonus: 1250,
    totalScore: 4800
  });
  assert(ui.elements.resDeliveries.textContent === '5 / 5', 'Deliveries formatted as "5 / 5"');
  assert(ui.elements.resDeliveryPts.textContent === '(+2,500)', 'Delivery points formatted with comma as "(+2,500)"');
  assert(ui.elements.resTimePts.textContent === '(+1,250)', 'Time points formatted with comma as "(+1,250)"');
  assert(ui.elements.resStars.textContent === '6 / 6', 'Stars formatted as "6 / 6"');
  assert(ui.elements.resStarsPts.textContent === '(+300)', 'Star points formatted as "(+300)" (6 * 50)');
  assert(ui.elements.resTotalScore.textContent === '4,800', 'Total score formatted with comma as "4,800"');

  // G. Large and Zero Numbers
  ui.showResults({ totalScore: 1250000 });
  assert(ui.elements.resTotalScore.textContent === '1,250,000', 'Large score formatted as "1,250,000"');

  ui.showResults({ deliveryScore: 0, timeBonus: 0, stars: 0, totalScore: 0 });
  assert(ui.elements.resDeliveryPts.textContent === '(+0)', 'Zero delivery score formatted as "(+0)"');
  assert(ui.elements.resTimePts.textContent === '(+0)', 'Zero time bonus formatted as "(+0)"');
  assert(ui.elements.resStarsPts.textContent === '(+0)', 'Zero star points formatted as "(+0)"');
  assert(ui.elements.resTotalScore.textContent === '0', 'Zero total score formatted as "0"');

  // H. Action Button Triggers: Home & Replay
  let homeFired = 0;
  let replayFired = 0;
  ui.on('home', () => { homeFired++; });
  ui.on('replay', () => { replayFired++; });

  // 1. Click Home button
  ui.showScreen('results');
  ui.elements.btnHome.click();
  assert(homeFired === 1, 'Home button click fired "home" event emitter');
  assert(ui.currentScreen === 'menu', 'Home button transitioned screen to "menu"');
  assert(!ui.elements.screenMenu.classList.contains('hidden'), 'Screen "menu" is now visible');

  // 2. Click Replay button without window.deliverySystem
  window.deliverySystem = null;
  ui.showScreen('results');
  let replayNoCrash = true;
  try {
    ui.elements.btnReplay.click();
  } catch (err) {
    replayNoCrash = false;
  }
  assert(replayNoCrash, 'Replay button does not throw when window.deliverySystem is absent');
  assert(replayFired === 1, 'Replay button click fired "replay" event emitter');
  assert(ui.currentScreen === 'hud', 'Replay button transitioned screen to "hud"');

  // 3. Click Replay button with mock window.deliverySystem
  let startRunCalledWithRestart = false;
  window.deliverySystem = {
    startRun: (isRestart) => {
      startRunCalledWithRestart = isRestart;
    }
  };
  ui.showScreen('results');
  ui.elements.btnReplay.click();
  assert(replayFired === 2, 'Replay fired on second replay click');
  assert(startRunCalledWithRestart === true, 'window.deliverySystem.startRun(true) called by Replay button');
  assert(ui.currentScreen === 'hud', 'Screen transitioned to "hud" on replay');

  // I. Event Emitter Resilience (Subscriber throws error)
  let healthySubscriberCalled = false;
  ui.on('play', () => {
    throw new Error('Adversarial subscriber deliberate error!');
  });
  ui.on('play', () => {
    healthySubscriberCalled = true;
  });

  let emitDidNotCrash = true;
  try {
    ui.emit('play');
  } catch (e) {
    emitDidNotCrash = false;
  }
  assert(emitDidNotCrash, 'uiManager.emit() isolates listener errors without crashing');
  assert(healthySubscriberCalled, 'Subsequent listeners still execute when prior listener throws');

  console.log(`  Passed ${passedTests} / ${totalTests} results and button trigger tests.\n`);

  // -------------------------------------------------------------------------
  // SECTION 3: CSS ARCHITECTURE, IMPORTS, SPECIFICITY & PALETTE INTEGRITY
  // -------------------------------------------------------------------------
  console.log('--- Challenge 3: CSS Architecture, Imports, Specificity & Cascade ---');

  const styleCssPath = resolve(PROJECT_ROOT, 'src/style.css');
  assert(existsSync(styleCssPath), 'src/style.css exists');

  const styleCssContent = readFileSync(styleCssPath, 'utf8');

  // 1. Verify @import rules are at top of style.css
  const importLines = styleCssContent
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('@import'));

  assert(importLines.length === 5, `Expected 5 @import lines, found ${importLines.length}`);
  const expectedImports = [
    "./ui/styles/theme.css",
    "./ui/styles/hud.css",
    "./ui/styles/screens.css",
    "./ui/styles/results.css",
    "./ui/styles/responsive.css"
  ];
  for (const exp of expectedImports) {
    assert(
      importLines.some(l => l.includes(exp)),
      `style.css imports ${exp}`
    );
  }

  // Verify all imported files exist on disk
  for (const exp of expectedImports) {
    const fullPath = resolve(PROJECT_ROOT, 'src', exp);
    assert(existsSync(fullPath), `Target file exists: ${exp}`);
  }

  // 2. Syntax check: Balanced braces in all CSS files
  const cssFiles = [
    'src/style.css',
    'src/ui/styles/theme.css',
    'src/ui/styles/hud.css',
    'src/ui/styles/screens.css',
    'src/ui/styles/results.css',
    'src/ui/styles/responsive.css'
  ];

  for (const relPath of cssFiles) {
    const content = readFileSync(resolve(PROJECT_ROOT, relPath), 'utf8');
    // Check balanced curly braces
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    assert(openBraces === closeBraces, `${relPath} balanced braces: {=${openBraces}, }=${closeBraces}`);
  }

  // 3. Check for HUD suppression bug in style.css
  const hudTopLeftSuppression = styleCssContent.includes('#santa-hud .hud-top-left') && styleCssContent.includes('display: none !important');
  // Specifically make sure #santa-hud .hud-top-left is NOT in the display: none !important block
  const suppressedBlockMatch = styleCssContent.match(/#santa-hud[^{]*\{[^}]*display:\s*none\s*!important/gs);
  let hasHudTopLeftSuppressed = false;
  if (suppressedBlockMatch) {
    for (const block of suppressedBlockMatch) {
      if (block.includes('.hud-top-left')) {
        hasHudTopLeftSuppressed = true;
      }
    }
  }
  assert(!hasHudTopLeftSuppressed, 'HUD top-left progress is NOT suppressed by display:none !important');

  // 4. Check Palette Tokens in theme.css
  const themeCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/theme.css'), 'utf8');
  assert(themeCss.includes('#D61F33'), 'Theme includes festive crimson #D61F33');
  assert(themeCss.includes('#FFC727'), 'Theme includes metallic gold #FFC727');
  assert(themeCss.includes('#FDF1D6'), 'Theme includes cream parchment #FDF1D6');
  assert(themeCss.includes('#081735') || themeCss.includes('#061226'), 'Theme includes midnight navy #081735 or #061226');
  assert(themeCss.includes('#FFFFFF'), 'Theme includes snow white #FFFFFF');

  // 5. Check Tabular Numerals Enforcement
  assert(
    themeCss.includes('tabular-nums') && themeCss.includes('font-variant-numeric'),
    'theme.css enforces tabular-nums across numerical elements'
  );

  // 6. Check Safe Area Insets in responsive.css
  const responsiveCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/responsive.css'), 'utf8');
  assert(
    responsiveCss.includes('env(safe-area-inset-top') && responsiveCss.includes('env(safe-area-inset-bottom'),
    'responsive.css incorporates env(safe-area-inset-*) for notched mobile devices'
  );

  // 7. Check Joystick Scoping (Virtual joystick constrained to lower thumb zone)
  assert(
    responsiveCss.includes('#joystick-zone') && (responsiveCss.includes('45vh') || responsiveCss.includes('50vh')),
    'responsive.css constrains #joystick-zone to lower viewport height'
  );

  // 8. Check Z-Index Layering Order
  const hudCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/hud.css'), 'utf8');
  const screensCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/screens.css'), 'utf8');
  const resultsCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/results.css'), 'utf8');

  const hudZ = parseInt((hudCss.match(/\.hud-top-bar[^{]*\{[^}]*z-index:\s*(\d+)/s) || [])[1], 10);
  const screensZ = parseInt((screensCss.match(/\.screen-overlay[^{]*\{[^}]*z-index:\s*(\d+)/s) || [])[1], 10);
  const resultsZ = parseInt((resultsCss.match(/#screen-results[^{]*\{[^}]*z-index:\s*(\d+)/s) || [])[1], 10);

  assert(hudZ === 50, `HUD z-index is 50 (actual: ${hudZ})`);
  assert(screensZ === 70, `Screen overlay z-index is 70 (actual: ${screensZ})`);
  assert(resultsZ === 80, `Results screen z-index is 80 (actual: ${resultsZ})`);
  assert(hudZ < screensZ && screensZ <= resultsZ, 'Z-index hierarchy: HUD (50) < Screen Overlays (70) <= Results (80)');

  // -------------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log('                        CHALLENGE SUMMARY                               ');
  console.log('========================================================================');
  console.log(`  Total Invariant & Stress Tests: ${totalTests}`);
  console.log(`  Passed:                         ${passedTests} (${((passedTests/totalTests)*100).toFixed(1)}%)`);
  console.log(`  Failed:                         ${failedTests}`);

  if (failedTests > 0) {
    console.error('\nFAILURES DETECTED:');
    failures.forEach((f, idx) => console.error(`  ${idx + 1}. ${f}`));
    process.exit(1);
  } else {
    console.log('\n🌟 ALL ADVERSARIAL STRESS CHALLENGES PASSED EMPIRICALLY!');
    process.exit(0);
  }
}

runAdversarialSuite().catch(err => {
  console.error('Unhandled fatal error in stress test harness:', err);
  process.exit(1);
});
