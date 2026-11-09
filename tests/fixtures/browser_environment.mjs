// tests/fixtures/browser_environment.mjs
// Lightweight, zero-dependency browser and DOM simulation for headless Node.js E2E testing

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../');

class ClassList {
  constructor(element) {
    this.element = element;
    this._classes = new Set();
  }

  add(...classes) {
    for (const c of classes) {
      if (c && typeof c === 'string') {
        const parts = c.split(/\s+/).filter(Boolean);
        for (const p of parts) this._classes.add(p);
      }
    }
    this._sync();
  }

  remove(...classes) {
    for (const c of classes) {
      if (c && typeof c === 'string') {
        const parts = c.split(/\s+/).filter(Boolean);
        for (const p of parts) this._classes.delete(p);
      }
    }
    this._sync();
  }

  contains(cls) {
    return this._classes.has(cls);
  }

  toggle(cls, force) {
    if (typeof force === 'boolean') {
      if (force) this.add(cls);
      else this.remove(cls);
      return force;
    }
    if (this.contains(cls)) {
      this.remove(cls);
      return false;
    } else {
      this.add(cls);
      return true;
    }
  }

  _sync() {
    this.element._attributes['class'] = Array.from(this._classes).join(' ');
  }

  _fromAttr(attrVal) {
    this._classes.clear();
    if (attrVal) {
      attrVal.split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    }
  }

  toString() {
    return Array.from(this._classes).join(' ');
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class MockDOMElement {
  constructor(tagName = 'div', doc = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
    this._attributes = {};
    this.classList = new ClassList(this);
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this._listeners = new Map();
    this._textContent = '';
    this.dataset = {};
    this.id = '';
    this._rawHTML = undefined;
  }

  get className() {
    return this.classList.toString();
  }

  set className(val) {
    this.classList._fromAttr(val);
  }

  get textContent() {
    if (this._rawHTML !== undefined) {
      return this._rawHTML.replace(/<[^>]*>/g, '').trim();
    }
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
  }

  set textContent(val) {
    this._rawHTML = undefined;
    this.children = [];
    this._textContent = String(val);
  }

  get innerHTML() {
    if (this._rawHTML !== undefined) return this._rawHTML;
    if (this.children.length === 0) return escapeHTML(this._textContent);
    return this.children.map(c => (typeof c === 'string' ? escapeHTML(c) : c.outerHTML || escapeHTML(c.textContent))).join('');
  }

  set innerHTML(htmlString) {
    this._rawHTML = typeof htmlString === 'string' ? htmlString : '';
    this.children = [];
    this._textContent = '';
    if (!htmlString || typeof htmlString !== 'string') return;

    // Tokenize tags and child blocks with depth tracking
    const tagRegex = /<!--[\s\S]*?-->|<([a-zA-Z0-9\-]+)((?:\s+[^>]*?)?)(\/?)>|<\/([a-zA-Z0-9\-]+)>/g;
    let match;

    while ((match = tagRegex.exec(htmlString)) !== null) {
      if (match[0].startsWith('<!--')) continue;

      if (match[1]) {
        const tag = match[1];
        const attrs = match[2] || '';
        const isSelfClosing = match[3] === '/' || ['br', 'hr', 'img', 'input', 'link', 'meta'].includes(tag.toLowerCase());
        const child = this.ownerDocument ? this.ownerDocument.createElement(tag) : new MockDOMElement(tag);
        child.parentNode = this;

        // Parse attributes
        const attrRegex = /([a-zA-Z0-9\-_:]+)(?:=["']([^"']*)["'])?/g;
        let aMatch;
        while ((aMatch = attrRegex.exec(attrs)) !== null) {
          const attrName = aMatch[1];
          const attrVal = aMatch[2] !== undefined ? aMatch[2] : '';
          child.setAttribute(attrName, attrVal);
        }

        if (isSelfClosing) {
          this.children.push(child);
        } else {
          // Find matching closing tag with depth tracking
          const startBodyIndex = tagRegex.lastIndex;
          let depth = 1;
          const innerRegex = new RegExp(`<(/?)${tag}(?:\\s+[^>]*?|/?)>`, 'gi');
          innerRegex.lastIndex = startBodyIndex;
          let innerMatch;
          let endBodyIndex = -1;

          while ((innerMatch = innerRegex.exec(htmlString)) !== null) {
            if (innerMatch[1] === '/') {
              depth--;
              if (depth === 0) {
                endBodyIndex = innerMatch.index;
                tagRegex.lastIndex = innerRegex.lastIndex;
                break;
              }
            } else if (!innerMatch[0].endsWith('/>')) {
              depth++;
            }
          }

          if (endBodyIndex !== -1) {
            const body = htmlString.slice(startBodyIndex, endBodyIndex);
            child.innerHTML = body;
          }
          this.children.push(child);
        }
      }
    }

    if (this.children.length === 0) {
      this._textContent = htmlString.replace(/<[^>]*>/g, '').trim();
    }
  }

  get outerHTML() {
    const attrs = Object.entries(this._attributes)
      .map(([k, v]) => ` ${k}="${v}"`)
      .join('');
    const idAttr = this.id ? ` id="${this.id}"` : '';
    return `<${this.tagName.toLowerCase()}${idAttr}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }

  setAttribute(name, value) {
    const strVal = String(value);
    this._attributes[name] = strVal;
    if (name === 'id') this.id = strVal;
    if (name === 'class') this.classList._fromAttr(strVal);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[key] = strVal;
    }
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.classList.toString() || null;
    return this._attributes[name] ?? null;
  }

  removeAttribute(name) {
    delete this._attributes[name];
    if (name === 'id') this.id = '';
    if (name === 'class') this.classList._fromAttr('');
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  appendChild(child) {
    this._rawHTML = undefined;
    if (typeof child === 'string') {
      this._textContent += child;
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this._rawHTML = undefined;
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      child.parentNode = null;
      return this.children.splice(idx, 1)[0];
    }
    return null;
  }

  remove() {
    if (this.parentNode && typeof this.parentNode.removeChild === 'function') {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
  }

  removeEventListener(event, callback) {
    if (!this._listeners.has(event)) return;
    const list = this._listeners.get(event);
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event?.type;
    const callbacks = this._listeners.get(type) || [];
    const eventObj = typeof event === 'string' ? { type: event, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } } : event;
    for (const cb of callbacks) {
      cb.call(this, eventObj);
    }
    return !eventObj.defaultPrevented;
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
  }

  querySelector(selector) {
    const results = this.querySelectorAll(selector);
    return results.length > 0 ? results[0] : null;
  }

  querySelectorAll(selector) {
    if (!selector || typeof selector !== 'string') return [];
    selector = selector.trim();

    // Multi-selector (comma-separated): e.g. "a, b"
    if (selector.includes(',')) {
      const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
      const set = new Set();
      for (const part of parts) {
        for (const el of this.querySelectorAll(part)) {
          set.add(el);
        }
      }
      return Array.from(set);
    }

    // Descendant selector (space-separated): e.g. "#screen-menu .ribbon-title"
    const tokens = selector.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      let currentSet = this.querySelectorAll(tokens[0]);
      for (let i = 1; i < tokens.length; i++) {
        const nextSet = [];
        for (const parent of currentSet) {
          nextSet.push(...parent.querySelectorAll(tokens[i]));
        }
        currentSet = Array.from(new Set(nextSet));
      }
      return currentSet;
    }

    const matches = [];
    const checkElement = (el) => {
      if (matchesSelector(el, selector)) {
        matches.push(el);
      }
      for (const child of el.children) {
        if (child instanceof MockDOMElement) {
          checkElement(child);
        }
      }
    };
    for (const child of this.children) {
      if (child instanceof MockDOMElement) {
        checkElement(child);
      }
    }
    return matches;
  }

  getContext(contextType) {
    return {
      canvas: this,
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      lineCap: 'butt',
      shadowColor: 'transparent',
      shadowBlur: 0,
      globalAlpha: 1.0,
      createRadialGradient() {
        return { addColorStop() {} };
      },
      createLinearGradient() {
        return { addColorStop() {} };
      },
      fillRect() {},
      clearRect() {},
      strokeRect() {},
      beginPath() {},
      closePath() {},
      arc() {},
      arcTo() {},
      moveTo() {},
      lineTo() {},
      bezierCurveTo() {},
      quadraticCurveTo() {},
      fill() {},
      stroke() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      fillText() {},
      strokeText() {},
      measureText() {
        return { width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
      },
      drawImage() {},
      getImageData() {
        return { data: new Uint8ClampedArray(4) };
      },
      putImageData() {}
    };
  }

  getBoundingClientRect() {
    // Provide simulated geometry based on classes and dimensions
    const isFull = this.classList.contains('fullscreen') || this.id === 'ui-container' || this.id === 'app';
    const isHUD = this.classList.contains('hud-top-bar') || this.id === 'hud-top-bar';
    const isJoystick = this.id === 'joystick-zone';
    const isCenter = this.classList.contains('results-card') || this.classList.contains('instructions-card');
    const isToast = this.classList.contains('ribbon-toast') || this.id === 'delivery-toast' || this.id === 'star-toast';
    
    const docWidth = this.ownerDocument?.defaultView?.innerWidth || 1280;
    const docHeight = this.ownerDocument?.defaultView?.innerHeight || 720;

    if (isFull) {
      return { top: 0, left: 0, right: docWidth, bottom: docHeight, width: docWidth, height: docHeight };
    }
    if (isHUD) {
      return { top: 0, left: 0, right: docWidth, bottom: 64, width: docWidth, height: 64 };
    }
    if (isToast) {
      return { top: 72, left: (docWidth - 300) / 2, right: (docWidth + 300) / 2, bottom: 112, width: 300, height: 40 };
    }
    if (isJoystick) {
      // Joystick scoped to lower thumb zone
      const top = docHeight * 0.5;
      return { top, left: 0, right: docWidth, bottom: docHeight, width: docWidth, height: docHeight * 0.5 };
    }
    if (isCenter) {
      const w = Math.min(440, docWidth * 0.9);
      const h = Math.min(500, docHeight * 0.8);
      const top = (docHeight - h) / 2;
      const left = (docWidth - w) / 2;
      return { top, left, right: left + w, bottom: top + h, width: w, height: h };
    }
    return { top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 };
  }
}

function matchesSelector(el, selector) {
  if (!selector) return false;
  selector = selector.trim();

  // Multi-selector: e.g. "a, b"
  if (selector.includes(',')) {
    return selector.split(',').some(s => matchesSelector(el, s));
  }

  // Id selector: e.g. "#santa-hud"
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    return el.id === id;
  }

  // Class selector: e.g. ".btn-play"
  if (selector.startsWith('.')) {
    const cls = selector.slice(1);
    return el.classList.contains(cls);
  }

  // Tag selector: e.g. "button"
  if (/^[a-zA-Z0-9\-]+$/.test(selector)) {
    return el.tagName.toLowerCase() === selector.toLowerCase();
  }

  // Tag with class: e.g. "div.hud-pill"
  const tagClassMatch = selector.match(/^([a-zA-Z0-9\-]+)\.([a-zA-Z0-9\-_]+)$/);
  if (tagClassMatch) {
    return el.tagName.toLowerCase() === tagClassMatch[1].toLowerCase() && el.classList.contains(tagClassMatch[2]);
  }

  // Attribute selector: e.g. "[data-action='play']"
  const attrMatch = selector.match(/\[([a-zA-Z0-9\-_]+)(?:=['"]([^'"]+)['"])?\]/);
  if (attrMatch) {
    const attrName = attrMatch[1];
    const attrVal = attrMatch[2];
    if (attrVal !== undefined) {
      return el.getAttribute(attrName) === attrVal;
    }
    return el.hasAttribute(attrName);
  }

  return false;
}

export class MockDocument {
  constructor(view) {
    this.defaultView = view;
    this.documentElement = new MockDOMElement('html', this);
    this.head = new MockDOMElement('head', this);
    this.body = new MockDOMElement('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new MockDOMElement(tagName, this);
  }

  getElementById(id) {
    return this.documentElement.querySelector(`#${id}`);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  addEventListener(event, cb) {
    this.documentElement.addEventListener(event, cb);
  }

  removeEventListener(event, cb) {
    this.documentElement.removeEventListener(event, cb);
  }

  dispatchEvent(event) {
    return this.documentElement.dispatchEvent(event);
  }
}

export class MockWindow {
  constructor(width = 1280, height = 720) {
    this.innerWidth = width;
    this.innerHeight = height;
    this.devicePixelRatio = 1.0;
    this.document = new MockDocument(this);
    this.localStorage = new Map();
    this._listeners = new Map();
    this.matchMedia = (query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    });
    this.getComputedStyle = (el) => el?.style || {};
  }

  resize(width, height) {
    this.innerWidth = width;
    this.innerHeight = height;
    this.dispatchEvent({ type: 'resize' });
  }

  addEventListener(event, cb) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(cb);
  }

  removeEventListener(event, cb) {
    if (!this._listeners.has(event)) return;
    const list = this._listeners.get(event);
    const idx = list.indexOf(cb);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event?.type;
    const callbacks = this._listeners.get(type) || [];
    const eventObj = typeof event === 'string' ? { type: event, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } } : event;
    for (const cb of callbacks) {
      cb.call(this, eventObj);
    }
    return !eventObj.defaultPrevented;
  }
}

/**
 * Creates and initializes a simulated browser DOM environment for tests.
 */
export function createBrowserEnvironment(options = {}) {
  const width = options.width || 1280;
  const height = options.height || 720;
  const win = new MockWindow(width, height);
  const doc = win.document;

  // Mount standard layout anchors
  const app = doc.createElement('div');
  app.id = 'app';
  doc.body.appendChild(app);

  const uiContainer = doc.createElement('div');
  uiContainer.id = 'ui-container';
  doc.body.appendChild(uiContainer);

  const loader = doc.createElement('div');
  loader.id = 'loader';
  loader.classList.add('hidden'); // Default to hidden so UIManager.init() starts on menu
  doc.body.appendChild(loader);

  // Setup global shims if requested (default to true for standalone test files)
  const installGlobals = options.installGlobals !== false;
  if (installGlobals) {
    global.window = win;
    global.document = doc;
    global.getComputedStyle = win.getComputedStyle;
    global.localStorage = {
      getItem: (k) => win.localStorage.get(k) || null,
      setItem: (k, v) => win.localStorage.set(k, String(v)),
      removeItem: (k) => win.localStorage.delete(k),
      clear: () => win.localStorage.clear()
    };
    global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
    global.cancelAnimationFrame = (id) => clearTimeout(id);
    global.AudioContext = class MockAudioContext {
      constructor() {
        this.destination = {};
        this.state = 'running';
      }
      createGain() {
        return {
          gain: { value: 1.0, setTargetAtTime() {} },
          connect() {}
        };
      }
      createBufferSource() {
        return {
          connect() {},
          start() {},
          stop() {}
        };
      }
      decodeAudioData(buffer, success) {
        const dummyAudio = {};
        if (success) success(dummyAudio);
        return Promise.resolve(dummyAudio);
      }
    };
    const OriginalRequest = global.Request;
    if (OriginalRequest) {
      global.Request = class MockRequest extends OriginalRequest {
        constructor(input, init) {
          if (typeof input === 'string' && (input.startsWith('/') || input.startsWith('.'))) {
            super('http://localhost:5173' + (input.startsWith('/') ? input : '/' + input), init);
          } else {
            super(input, init);
          }
        }
      };
    }
    const originalFetch = global.fetch;
    global.fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : input?.url || '';
      if (
        urlStr.startsWith('/') ||
        urlStr.startsWith('.') ||
        urlStr.includes('/assets/') ||
        urlStr.includes('.glb') ||
        urlStr.includes('.mp3') ||
        urlStr.includes('.wav') ||
        urlStr.includes('/audio/') ||
        urlStr.includes('localhost:5173')
      ) {
        return new Response(new ArrayBuffer(0), {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' }
        });
      }
      try {
        return originalFetch ? await originalFetch(input, init) : new Response(new ArrayBuffer(0), { status: 200 });
      } catch (e) {
        return new Response(new ArrayBuffer(0), { status: 200 });
      }
    };
  }

  return { window: win, document: doc, app, uiContainer, loader };
}

/**
 * Reads project index.html file raw content
 */
export function readProjectHTML() {
  const htmlPath = resolve(PROJECT_ROOT, 'index.html');
  if (existsSync(htmlPath)) {
    return readFileSync(htmlPath, 'utf-8');
  }
  return '';
}

/**
 * Reads all project CSS files raw content
 */
export function readProjectCSS() {
  const cssPaths = [
    resolve(PROJECT_ROOT, 'src/style.css'),
    resolve(PROJECT_ROOT, 'src/ui/styles/theme.css'),
    resolve(PROJECT_ROOT, 'src/ui/styles/hud.css'),
    resolve(PROJECT_ROOT, 'src/ui/styles/screens.css'),
    resolve(PROJECT_ROOT, 'src/ui/styles/results.css'),
    resolve(PROJECT_ROOT, 'src/ui/styles/responsive.css')
  ];

  let combined = '';
  for (const p of cssPaths) {
    if (existsSync(p)) {
      combined += `\n/* ${p} */\n` + readFileSync(p, 'utf-8');
    }
  }
  return combined;
}
