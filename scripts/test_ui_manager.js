/**
 * Verification test for UIManager and Festive Component Architecture
 */
import { UIManager } from '../src/ui/UIManager.js';
import { FestiveIcons } from '../src/ui/components/FestiveIcons.js';

// Setup minimal DOM mock if running in Node
class MockElement {
  constructor(tag, id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList._classes.has(c)) this.classList._classes.delete(c);
          else this.classList._classes.add(c);
        } else if (force) {
          this.classList._classes.add(c);
        } else {
          this.classList._classes.delete(c);
        }
      },
      contains: (c) => this.classList._classes.has(c)
    };
    this.children = [];
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this._listeners = {};
  }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  dispatchEvent(event) {
    if (this._listeners[event.type]) {
      this._listeners[event.type].forEach(fn => fn(event));
    }
  }
  remove() {
    this._removed = true;
  }
  querySelector(sel) {
    return null;
  }
}

// Minimal mock document
const elementsById = new Map();
global.document = {
  createElement: (tag) => {
    return new MockElement(tag);
  },
  getElementById: (id) => {
    return elementsById.get(id) || null;
  },
  body: new MockElement('body')
};

global.window = {
  document: global.document,
  addEventListener: () => {}
};

console.log('--- Testing FestiveIcons SVGs ---');
const giftSvg = FestiveIcons.giftCrest(48);
const starSvg = FestiveIcons.star(32, true);
const clockSvg = FestiveIcons.clock(24);
const snowCapSvg = FestiveIcons.snowCapTop();

if (!giftSvg.includes('<svg') || !starSvg.includes('<svg') || !clockSvg.includes('<svg') || !snowCapSvg.includes('<svg')) {
  throw new Error('FestiveIcons failed to generate SVG strings!');
}
console.log('✓ FestiveIcons generated valid SVG markup');

console.log('--- Testing UIManager Class & Lifecycle ---');
const ui = new UIManager();

// Test event emitter
let playFired = false;
ui.on('play', () => { playFired = true; });
ui.emit('play');
if (!playFired) throw new Error('UIManager event emitter failed for "play"');
console.log('✓ UIManager event emitter on("play") verified');

let pauseVal = null;
ui.on('pauseToggle', (v) => { pauseVal = v; });
ui.emit('pauseToggle', true);
if (pauseVal !== true) throw new Error('UIManager event emitter failed for "pauseToggle"');
console.log('✓ UIManager event emitter on("pauseToggle") verified');

// Test updateHUD contract
let hudUpdated = false;
ui.elements = {
  deliveries: { textContent: '' },
  maxDeliveries: { textContent: '' },
  deliveriesFill: { style: {} },
  timer: { textContent: '' },
  timerPill: { classList: { toggle: (cls, force) => { if (cls === 'urgent') hudUpdated = force; } } },
  stars: { textContent: '' },
  maxStars: { textContent: '' },
  starsFill: { style: {} },
  score: { textContent: '' }
};

ui.updateHUD({
  deliveries: 3,
  maxDeliveries: 5,
  timeRemaining: 12,
  stars: 4,
  maxStars: 6,
  score: 1850,
  urgency: true
});

if (ui.elements.deliveries.textContent !== '3') throw new Error('Deliveries text failed');
if (ui.elements.timer.textContent !== '12') throw new Error('Timer text failed');
if (!hudUpdated) throw new Error('Urgency state not set on timer');
if (ui.elements.score.textContent !== '1,850') throw new Error('Score format failed');
console.log('✓ UIManager.updateHUD contract verified');

// Test showResults contract
let resultsShown = false;
ui.elements.resTitle = { textContent: '' };
ui.elements.resDeliveries = { textContent: '' };
ui.elements.resDeliveryPts = { textContent: '' };
ui.elements.resTime = { textContent: '' };
ui.elements.resTimePts = { textContent: '' };
ui.elements.resStars = { textContent: '' };
ui.elements.resStarsPts = { textContent: '' };
ui.elements.resTotalScore = { textContent: '' };
ui.elements.resStar1 = { classList: { toggle: () => {} }, querySelector: () => ({ style: {} }) };
ui.elements.resStar2 = { classList: { toggle: () => {} }, querySelector: () => ({ style: {} }) };
ui.elements.resStar3 = { classList: { toggle: () => {} }, querySelector: () => ({ style: {} }) };

ui.showScreen = (screen) => { if (screen === 'results') resultsShown = true; };

ui.showResults({
  deliveries: 5,
  maxDeliveries: 5,
  stars: 5,
  maxStars: 6,
  deliveryScore: 2500,
  comboScore: 200,
  timeBonus: 320,
  totalScore: 3270,
  starRating: 3,
  reason: 'complete'
});

if (!resultsShown) throw new Error('showResults did not transition to results screen');
if (ui.elements.resTitle.textContent !== 'DELIVERIES COMPLETE!') throw new Error('resTitle mismatch');
if (ui.elements.resDeliveries.textContent !== '5 / 5') throw new Error('resDeliveries mismatch');
if (ui.elements.resTotalScore.textContent !== '3,270') throw new Error('resTotalScore mismatch');
console.log('✓ UIManager.showResults contract verified');

console.log('All UIManager checks PASSED successfully!');
