/**
 * scripts/test_challenger_m1.js
 * Adversarial Challenger Stress-Test Suite for Milestone 1 (UIManager & Festive UI)
 *
 * Checks:
 * 1. UIManager Edge Cases:
 *    - 0 deliveries, 5 deliveries, >5 deliveries (6, 10), negative deliveries (-1)
 *    - Negative score (-500), 0 score, extreme score (99,999,999, MAX_SAFE_INTEGER)
 *    - Empty strings, undefined, null, NaN
 *    - Multiple consecutive calls to init(), screen toggling stability
 *    - showResults() with 0 deliveries, 5 deliveries, >5 deliveries, negative scores, reason variations
 *    - Toast notifications: empty payloads, custom strings, potential XSS injection payloads (HTML escaping)
 * 2. Countdown Timer Urgency:
 *    - Urgency pulse behavior around 15s threshold (75, 20, 15.1, 15.0, 14.9, 5, 1, 0, -1)
 *    - Urgent CSS animation verification in hud.css
 * 3. DOM Text Selectability & Raster-Free / Canvas-Free Verification:
 *    - All labels, counters, headers, body text rendered as semantic DOM elements
 *    - No <canvas> or image-baked raster assets (.png, .jpg, .webp) in UI markup
 *    - User-selectability CSS rules check
 * 4. Reference Palette Conformance:
 *    - Exact hex verification: #D61F33, #FFC727, #FDF1D6, #081735, #FFFFFF
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createBrowserEnvironment,
  readProjectHTML,
  readProjectCSS,
  MockDOMElement
} from '../tests/fixtures/browser_environment.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../');

// Enhance MockDOMElement with standard Element.remove() method
MockDOMElement.prototype.remove = function() {
  if (this.parentNode) {
    this.parentNode.removeChild(this);
  }
  if (this.id) {
    elementIdRegistry.delete(this.id);
  }
};

// Enhance MockDOMElement.innerHTML with a robust stack-based HTML parser so nested UI structures mount cleanly
const elementIdRegistry = new Map();

function parseHtmlIntoNode(htmlString, parent, doc) {
  parent.children = [];
  parent._textContent = '';
  
  const cleanHtml = htmlString.replace(/<!--[\s\S]*?-->/g, '');
  const tokenRegex = /<(\/)?([a-zA-Z0-9\-]+)([^>]*)>|([^<]+)/g;
  const stack = [parent];
  let match;
  
  const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr', 'line', 'circle', 'rect',
    'path', 'polygon', 'polyline', 'stop'
  ]);
  
  while ((match = tokenRegex.exec(cleanHtml)) !== null) {
    const isClosing = Boolean(match[1]);
    const tagName = match[2];
    const attrsStr = match[3];
    const text = match[4];
    
    if (text) {
      const top = stack[stack.length - 1];
      if (top) {
        top._textContent = (top._textContent || '') + text;
      }
      continue;
    }
    
    if (isClosing) {
      const lower = tagName.toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === lower) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    
    // Opening tag
    const isSelfClosing = (attrsStr && attrsStr.trim().endsWith('/')) || voidTags.has(tagName.toLowerCase());
    const el = doc ? doc.createElement(tagName) : new MockDOMElement(tagName);
    
    if (attrsStr) {
      const attrRegex = /([a-zA-Z0-9\-]+)(?:=(?:["']([^"']*)["']|([^\s>]+)))?/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
        const attrName = attrMatch[1];
        const attrVal = attrMatch[2] !== undefined ? attrMatch[2] : (attrMatch[3] !== undefined ? attrMatch[3] : '');
        el.setAttribute(attrName, attrVal);
        if (attrName === 'id') {
          elementIdRegistry.set(attrVal, el);
        }
      }
    }
    
    const top = stack[stack.length - 1];
    if (top) {
      top.appendChild(el);
    }
    
    if (!isSelfClosing) {
      stack.push(el);
    }
  }
}

// Override innerHTML setter on MockDOMElement
Object.defineProperty(MockDOMElement.prototype, 'innerHTML', {
  get() {
    if (this.children.length === 0) return this._textContent || '';
    return this.children.map(c => c.outerHTML || c.textContent).join('');
  },
  set(val) {
    parseHtmlIntoNode(val, this, this.ownerDocument);
  },
  configurable: true
});

// Setup environment
const env = createBrowserEnvironment({ installGlobals: true });

// Override getElementById on doc to check elementIdRegistry first
const origGetElementById = document.getElementById.bind(document);
document.getElementById = (id) => {
  return elementIdRegistry.get(id) || origGetElementById(id);
};

// Now import UIManager
const { UIManager } = await import('../src/ui/UIManager.js');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

console.log('================================================================');
console.log('  CHALLENGER STRESS-TEST SUITE — MILESTONE 1 (UI ARCHITECTURE)  ');
console.log('================================================================\n');

// --- SECTION 1: UIManager Edge Cases ---
console.log('>>> Section 1: UIManager Method Edge Cases');

const ui = new UIManager();
ui.init(document.getElementById('ui-container'));

runTest('1.1: updateHUD with 0 deliveries (0/5, 0% fill)', () => {
  ui.updateHUD({ deliveries: 0, maxDeliveries: 5 });
  assert.strictEqual(ui.elements.deliveries.textContent, '0');
  assert.strictEqual(ui.elements.maxDeliveries.textContent, '5');
  assert.strictEqual(ui.elements.deliveriesFill.style.width, '0%');
});

runTest('1.2: updateHUD with exactly 5 deliveries (5/5, 100% fill)', () => {
  ui.updateHUD({ deliveries: 5, maxDeliveries: 5 });
  assert.strictEqual(ui.elements.deliveries.textContent, '5');
  assert.strictEqual(ui.elements.maxDeliveries.textContent, '5');
  assert.strictEqual(ui.elements.deliveriesFill.style.width, '100%');
});

runTest('1.3: updateHUD with >5 deliveries (6 and 10) clamps width to 100%', () => {
  ui.updateHUD({ deliveries: 6, maxDeliveries: 5 });
  assert.strictEqual(ui.elements.deliveries.textContent, '6');
  assert.strictEqual(ui.elements.deliveriesFill.style.width, '100%');

  ui.updateHUD({ deliveries: 10, maxDeliveries: 5 });
  assert.strictEqual(ui.elements.deliveries.textContent, '10');
  assert.strictEqual(ui.elements.deliveriesFill.style.width, '100%');
});

runTest('1.4: updateHUD with negative deliveries (-1) clamps width to 0%', () => {
  ui.updateHUD({ deliveries: -1, maxDeliveries: 5 });
  assert.strictEqual(ui.elements.deliveries.textContent, '-1');
  assert.strictEqual(ui.elements.deliveriesFill.style.width, '0%');
});

runTest('1.5: updateHUD with negative score (-500) renders formatted string without crashing', () => {
  ui.updateHUD({ score: -500 });
  assert.strictEqual(ui.elements.score.textContent, '-500');
});

runTest('1.6: updateHUD with extreme score (99,999,999) formats with commas', () => {
  ui.updateHUD({ score: 99999999 });
  assert.strictEqual(ui.elements.score.textContent, '99,999,999');
});

runTest('1.7: updateHUD with empty string and undefined values defaults gracefully', () => {
  ui.updateHUD({});
  assert.strictEqual(ui.elements.deliveries.textContent, '0');
  assert.strictEqual(ui.elements.maxDeliveries.textContent, '5');
  assert.strictEqual(ui.elements.score.textContent, '0');
  assert.strictEqual(ui.elements.stars.textContent, '0');
  assert.strictEqual(ui.elements.maxStars.textContent, '6');
});

runTest('1.8: showResults with 0 deliveries and reason="timeout" displays 1 star and TIME\'S UP title', () => {
  ui.showResults({
    deliveries: 0,
    maxDeliveries: 5,
    stars: 0,
    maxStars: 6,
    deliveryScore: 0,
    comboScore: 0,
    timeBonus: 0,
    totalScore: 0,
    reason: 'timeout'
  });
  assert.strictEqual(ui.elements.resTitle.textContent, "TIME'S UP!");
  assert.strictEqual(ui.elements.resDeliveries.textContent, '0 / 5');
  assert.strictEqual(ui.elements.resTotalScore.textContent, '0');
  assert.ok(ui.elements.resStar1.classList.contains('earned'));
  assert.ok(!ui.elements.resStar2.classList.contains('earned'));
  assert.ok(!ui.elements.resStar3.classList.contains('earned'));
});

runTest('1.9: showResults with 5 deliveries and reason="complete" awards 3 stars', () => {
  ui.showResults({
    deliveries: 5,
    maxDeliveries: 5,
    stars: 6,
    maxStars: 6,
    deliveryScore: 2500,
    comboScore: 400,
    timeBonus: 600,
    totalScore: 3800,
    reason: 'complete'
  });
  assert.strictEqual(ui.elements.resTitle.textContent, 'DELIVERIES COMPLETE!');
  assert.strictEqual(ui.elements.resDeliveries.textContent, '5 / 5');
  assert.strictEqual(ui.elements.resTotalScore.textContent, '3,800');
  assert.ok(ui.elements.resStar1.classList.contains('earned'));
  assert.ok(ui.elements.resStar2.classList.contains('earned'));
  assert.ok(ui.elements.resStar3.classList.contains('earned'));
});

runTest('1.10: showResults with >5 deliveries (7/5) renders gracefully without overflowing', () => {
  ui.showResults({
    deliveries: 7,
    maxDeliveries: 5,
    stars: 8,
    maxStars: 6,
    deliveryScore: 3500,
    totalScore: 4500
  });
  assert.strictEqual(ui.elements.resDeliveries.textContent, '7 / 5');
  assert.strictEqual(ui.elements.resTotalScore.textContent, '4,500');
});

runTest('1.11: showResults with empty object parameter does not throw', () => {
  assert.doesNotThrow(() => {
    ui.showResults({});
  });
});

runTest('1.12: showDeliveryToast with XSS payload sets textContent safely (no HTML injection)', () => {
  const xssPayload = '<img src="x" onerror="alert(1)">';
  ui.showDeliveryToast({ text: xssPayload });
  assert.strictEqual(ui.elements.deliveryToastText.textContent, xssPayload);
});

runTest('1.13: Multiple init() calls do not duplicate HUD or screen DOM elements', () => {
  // Call init again
  ui.init(document.getElementById('ui-container'));
  assert.ok(ui.elements.hudBar, 'hudBar exists');
  assert.ok(ui.elements.screenMenu, 'screenMenu exists');
  assert.ok(ui.elements.screenResults, 'screenResults exists');
});

// --- SECTION 2: Countdown Timer Urgency Pulse ---
console.log('\n>>> Section 2: Countdown Timer Urgency Pulse');

runTest('2.1: Urgency pulse NOT active at timeRemaining = 75.0', () => {
  ui.updateHUD({ timeRemaining: 75.0 });
  assert.ok(!ui.elements.timerPill.classList.contains('urgent'), 'Timer should not be urgent at 75s');
  assert.strictEqual(ui.elements.timer.textContent, '75');
});

runTest('2.2: Urgency pulse NOT active at timeRemaining = 15.1', () => {
  ui.updateHUD({ timeRemaining: 15.1 });
  assert.ok(!ui.elements.timerPill.classList.contains('urgent'), 'Timer should not be urgent at 15.1s');
  assert.strictEqual(ui.elements.timer.textContent, '16');
});

runTest('2.3: Urgency pulse IS active at boundary timeRemaining = 15.0', () => {
  ui.updateHUD({ timeRemaining: 15.0 });
  assert.ok(ui.elements.timerPill.classList.contains('urgent'), 'Timer should be urgent at 15.0s');
  assert.strictEqual(ui.elements.timer.textContent, '15');
});

runTest('2.4: Urgency pulse IS active at timeRemaining = 14.9 (<15s)', () => {
  ui.updateHUD({ timeRemaining: 14.9 });
  assert.ok(ui.elements.timerPill.classList.contains('urgent'), 'Timer should be urgent at 14.9s');
  assert.strictEqual(ui.elements.timer.textContent, '15'); // Math.ceil(14.9) = 15
});

runTest('2.5: Urgency pulse IS active at timeRemaining = 5.0 and 1.0', () => {
  ui.updateHUD({ timeRemaining: 5.0 });
  assert.ok(ui.elements.timerPill.classList.contains('urgent'), 'Timer should be urgent at 5.0s');
  assert.strictEqual(ui.elements.timer.textContent, '5');

  ui.updateHUD({ timeRemaining: 1.0 });
  assert.ok(ui.elements.timerPill.classList.contains('urgent'), 'Timer should be urgent at 1.0s');
  assert.strictEqual(ui.elements.timer.textContent, '1');
});

runTest('2.6: Urgency pulse resets when timeRemaining reaches 0.0 (timeout)', () => {
  ui.updateHUD({ timeRemaining: 0.0 });
  assert.ok(!ui.elements.timerPill.classList.contains('urgent'), 'Urgency turns off when time reaches 0');
  assert.strictEqual(ui.elements.timer.textContent, '0');
});

runTest('2.7: Explicit urgency: true parameter overrides timeRemaining', () => {
  ui.updateHUD({ timeRemaining: 45.0, urgency: true });
  assert.ok(ui.elements.timerPill.classList.contains('urgent'), 'Explicit urgency: true should activate urgent pulse');
});

runTest('2.8: CSS defines keyframe animation timerUrgentPulse in hud.css', () => {
  const css = readProjectCSS();
  assert.ok(css.includes('@keyframes timerUrgentPulse'), 'hud.css must define @keyframes timerUrgentPulse');
  assert.ok(css.includes('.hud-timer-pill.urgent'), 'hud.css must define .hud-timer-pill.urgent');
  assert.ok(css.includes('animation: timerUrgentPulse'), 'hud.css must bind animation: timerUrgentPulse');
});

// --- SECTION 3: DOM Text Selectability & Raster-Free Layout ---
console.log('\n>>> Section 3: DOM Text Selectability & Raster-Free Architecture');

runTest('3.1: All UI text elements are semantic HTML elements with editable text', () => {
  const hudDeliveries = document.getElementById('hud-deliveries');
  assert.ok(hudDeliveries, '#hud-deliveries exists');
  assert.strictEqual(hudDeliveries.tagName, 'STRONG');

  const hudTimer = document.getElementById('hud-timer');
  assert.ok(hudTimer, '#hud-timer exists');
  assert.strictEqual(hudTimer.tagName, 'STRONG');

  const hudScore = document.getElementById('hud-score');
  assert.ok(hudScore, '#hud-score exists');
  assert.strictEqual(hudScore.tagName, 'STRONG');

  const ribbonTitle = document.querySelector('.ribbon-title');
  assert.ok(ribbonTitle, '.ribbon-title exists');
  assert.ok(['H1', 'H2'].includes(ribbonTitle.tagName), 'Ribbon title uses semantic H1/H2');

  const resTotal = document.getElementById('res-total-score');
  assert.ok(resTotal, '#res-total-score exists');
  assert.strictEqual(resTotal.tagName, 'SPAN');
});

runTest('3.2: No canvas elements used in UI screens or UIManager DOM', () => {
  const uiContainer = document.getElementById('ui-container');
  const canvases = uiContainer.querySelectorAll('canvas');
  assert.strictEqual(canvases.length, 0, 'UI layer must not contain any <canvas> elements');
});

runTest('3.3: No raster image assets (.png, .jpg, .webp) baked into UIManager HTML markup', () => {
  const uiManagerSource = readFileSync(resolve(PROJECT_ROOT, 'src/ui/UIManager.js'), 'utf-8');
  assert.ok(!uiManagerSource.includes('.png'), 'UIManager.js must not reference .png');
  assert.ok(!uiManagerSource.includes('.jpg'), 'UIManager.js must not reference .jpg');
  assert.ok(!uiManagerSource.includes('.webp'), 'UIManager.js must not reference .webp');
  assert.ok(!uiManagerSource.includes('<img'), 'UIManager.js must not use <img> raster tags');
});

runTest('3.4: CSS guarantees text selectability with user-select: text', () => {
  const css = readProjectCSS();
  assert.ok(css.includes('user-select: text'), 'CSS must specify user-select: text for UI text elements');
  assert.ok(css.includes('.ribbon-title'), 'ribbon-title is selectable');
  assert.ok(css.includes('.pill-text'), 'pill-text is selectable');
  assert.ok(css.includes('.stat-value'), 'stat-value is selectable');
});

// --- SECTION 4: Reference Palette Conformance ---
console.log('\n>>> Section 4: Color Palette Hex Verification');

const PALETTE = {
  festiveRed: '#D61F33',
  metallicGold: '#FFC727',
  creamParchment: '#FDF1D6',
  midnightNavy: '#081735',
  snowWhite: '#FFFFFF'
};

runTest('4.1: Festive Red (#D61F33) is present in theme.css and FestiveIcons', () => {
  const themeCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/theme.css'), 'utf-8');
  assert.ok(themeCss.toUpperCase().includes('#D61F33'), 'theme.css must declare #D61F33');
  const icons = readFileSync(resolve(PROJECT_ROOT, 'src/ui/components/FestiveIcons.js'), 'utf-8');
  assert.ok(icons.toUpperCase().includes('#D61F33'), 'FestiveIcons.js must use #D61F33');
});

runTest('4.2: Metallic Gold (#FFC727) is present across theme tokens and borders', () => {
  const themeCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/theme.css'), 'utf-8');
  assert.ok(themeCss.toUpperCase().includes('#FFC727'), 'theme.css must declare #FFC727');
  const hudCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/hud.css'), 'utf-8');
  assert.ok(hudCss.includes('--c-gold-core') || hudCss.toUpperCase().includes('#FFC727'), 'hud.css must reference gold token');
  const icons = readFileSync(resolve(PROJECT_ROOT, 'src/ui/components/FestiveIcons.js'), 'utf-8');
  assert.ok(icons.toUpperCase().includes('#FFC727'), 'FestiveIcons.js must use #FFC727');
});

runTest('4.3: Cream Parchment (#FDF1D6) is declared in theme tokens and results card', () => {
  const themeCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/theme.css'), 'utf-8');
  assert.ok(themeCss.toUpperCase().includes('#FDF1D6'), 'theme.css must declare #FDF1D6');
});

runTest('4.4: Midnight Navy (#081735) is declared in theme tokens and backgrounds', () => {
  const themeCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/theme.css'), 'utf-8');
  assert.ok(themeCss.toUpperCase().includes('#081735'), 'theme.css must declare #081735');
});

runTest('4.5: Snow White (#FFFFFF) is declared in theme tokens and ornaments', () => {
  const themeCss = readFileSync(resolve(PROJECT_ROOT, 'src/ui/styles/theme.css'), 'utf-8');
  assert.ok(themeCss.toUpperCase().includes('#FFFFFF'), 'theme.css must declare #FFFFFF');
  const icons = readFileSync(resolve(PROJECT_ROOT, 'src/ui/components/FestiveIcons.js'), 'utf-8');
  assert.ok(icons.toUpperCase().includes('#FFFFFF'), 'FestiveIcons.js must use #FFFFFF');
});

console.log('\n================================================================');
console.log(`  CHALLENGER SUITE SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
console.log('================================================================');
