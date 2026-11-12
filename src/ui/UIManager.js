/**
 * UIManager — High-Polish Casual 3D Mobile Game UI
 * Supercell / Clash / Candy Crush 3D Aesthetic
 *
 * 1. Main Menu: 3D title logo on a curved snow-capped red ribbon with gold trim,
 *    glossy red "Play" pill button (yellow play triangle) and navy blue "How to Play" pill button.
 * 2. In-Game HUD: Top-bar dark navy capsule pills containing deliveries candy-cane
 *    progress bar (0/5), gold pocket-watch countdown timer (75s), and star counter (0/6). No pause button.
 * 3. Mobile Flight Joystick: Centered at bottom. Frosted glass round base with gold trim & star knob.
 * 4. "Gift Delivered!" In-Game Toast: Centered glowing red ribbon pill with 3D gift box icon and "+500" tag.
 * 5. Victory / Results Modal: Golden picture-frame card with snow on top, 3 golden stars (1-3 rating),
 *    stat rows (Deliveries, Time Left, Stars Collected, Total Score), and circular red enamel Home/Replay buttons.
 */

import { assetUrl } from '../utils/assetUrl.js';

// UI artwork lives in the zip, so every reference must be relative to the page.
const uiAsset = (file) => assetUrl('assets/custom_ui/' + file);

export class UIManager {
  constructor() {
    this.container = null;
    this.currentScreen = 'loading';
    this.deliveries = 0;
    this.maxDeliveries = 5;
    this.timeRemaining = 75;
    this.timerInterval = null;
    this.stars = 0;
    this.maxStars = 6;
    this.score = 0;
    this.isPaused = false;
    this.guidanceText = '';
    this.guidanceState = 'normal';

    this.elements = {};
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
    return this;
  }

  emit(event, ...args) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(fn => {
        try { fn(...args); } catch (e) { console.error(`[UIManager] Error in '${event}' handler:`, e); }
      });
    }
  }

  init(containerElement) {
    if (typeof containerElement === 'string') {
      this.container = document.querySelector(containerElement);
    } else {
      this.container = containerElement || document.getElementById('ui-container');
    }

    if (!this.container) {
      console.warn('[UIManager] No container found to mount UI');
      return this;
    }

    this._renderDOM();
    this._cacheElements();
    this._bindEvents();

    // Check loader state
    const loader = document.getElementById('loader');
    if (loader && !loader.classList.contains('hidden') && loader.style.display !== 'none') {
      this.showScreen('loading');
      const observer = new MutationObserver(() => {
        if (loader.classList.contains('hidden') || loader.style.display === 'none') {
          observer.disconnect();
          if (this.currentScreen === 'loading') {
            this.showScreen('menu');
          }
        }
      });
      observer.observe(loader, { attributes: true, attributeFilter: ['class', 'style'] });
    } else {
      this.showScreen('menu');
    }

    this._bindDeliverySystem();
    return this;
  }

  _renderDOM() {
    [
      'hud-top-bar',
      'screen-menu',
      'screen-instructions',
      'screen-results',
      'toast-delivery',
      'ui-svg-defs'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });

    // Hidden SVG Defs for Golden Gradients
    const svgDefs = document.createElement('div');
    svgDefs.id = 'ui-svg-defs';
    svgDefs.innerHTML = `
      <svg style="position: absolute; width: 0; height: 0; overflow: hidden;" aria-hidden="true">
        <defs>
          <linearGradient id="star-gold-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#FFF3A8" />
            <stop offset="45%" stop-color="#FFC727" />
            <stop offset="100%" stop-color="#C28600" />
          </linearGradient>
          <linearGradient id="snow-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#FFFFFF" />
            <stop offset="100%" stop-color="#D6E8FA" />
          </linearGradient>
        </defs>
      </svg>
    `;
    this.container.appendChild(svgDefs);

    // 1. TOP HUD BAR (Dark Navy Capsules, Deliveries Candy Bar, Watch Timer, Star Counter, No Pause)
    const hudBar = document.createElement('header');
    hudBar.id = 'hud-top-bar';
    hudBar.className = 'hud-top-bar hidden';
    hudBar.innerHTML = `
      <!-- Deliveries Candy-Cane Progress Capsule -->
      <div class="hud-pill hud-pill-deliveries">
        <div class="hud-badge-icon badge-gift">
          <img src="${uiAsset('icon_gift_box.png')}" alt="Gifts" class="hud-custom-icon" />
        </div>
        <div class="delivery-content">
          <div class="delivery-label-row">
            <span class="delivery-counter-text" id="hud-deliveries">0 / 5</span>
          </div>
          <div class="candy-progress-track">
            <div id="hud-deliveries-fill" class="candy-progress-fill" style="width: 0%;"></div>
          </div>
        </div>
      </div>

      <!-- Gold Pocket-Watch Countdown Timer -->
      <div id="hud-timer-pill" class="hud-pill hud-pill-timer">
        <div class="hud-badge-icon badge-watch">
          <img src="${uiAsset('icon_timer.png')}" alt="Timer" class="hud-custom-icon" />
        </div>
        <span class="timer-text-val"><span id="hud-timer">75</span>s</span>
      </div>

      <!-- Star Counter Capsule -->
      <div class="hud-pill hud-pill-stars">
        <div class="hud-badge-icon badge-star">
          <svg viewBox="0 0 24 24">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
          </svg>
        </div>
        <div class="star-value-wrap">
          <span class="star-current" id="hud-stars">0 / 6</span>
        </div>
      </div>
    `;

    // 2. MAIN MENU SCREEN (Curved Snow-Capped Ribbon Banner + Glossy Pill Buttons)
    const menuScreen = document.createElement('div');
    menuScreen.id = 'screen-menu';
    menuScreen.className = 'screen-overlay screen-menu visible';
    menuScreen.innerHTML = `
      <div class="menu-view">
        <!-- High-Fidelity 3D Holiday Logo Asset -->
        <header class="title-banner-wrapper custom-logo-wrapper">
          <img src="${uiAsset('logo_holiday.png')}" alt="Santa's Gift Run" class="menu-custom-title-logo" />
        </header>

        <!-- Action Group: High-Polish Custom Enamel Buttons -->
        <footer class="menu-actions-group custom-menu-actions">
          <button id="btn-menu-play" class="btn-image-action" aria-label="Play">
            <img src="${uiAsset('btn_play.png')}" alt="Play" class="btn-image-asset" />
          </button>
        </footer>
      </div>
    `;

    // 3. INSTRUCTIONS MODAL (Responsive Graphic Cards for Desktop & Mobile)
    const instructionsScreen = document.createElement("div");
    instructionsScreen.id = "screen-instructions";
    instructionsScreen.className = "screen-overlay screen-instructions hidden";
    instructionsScreen.innerHTML = `
      <div class="instructions-card-wrapper">
        <!-- Instructions Visual Showcase: Desktop & Mobile Switching Image -->
        <div class="instructions-poster-container">
          <picture>
            <source media="(max-width: 768px)" srcset="${uiAsset('instructions_mobile.png')}" />
            <img src="${uiAsset('instructions_desktop.png')}" alt="How to Play" class="instructions-poster-img" />
          </picture>
        </div>

        <!-- Action Buttons: Play Now & Back -->
        <footer class="instructions-actions-bar">
          <button id="btn-instructions-back" class="btn-image-action" aria-label="Back">
            <img src="${uiAsset('btn_back.png')}" alt="Back" class="btn-image-asset" />
          </button>
          <button id="btn-instructions-close" class="btn-image-action" aria-label="Play Now">
            <img src="${uiAsset('btn_play.png')}" alt="Play Now" class="btn-image-asset" />
          </button>
        </footer>
      </div>
    `;

    // 5. VICTORY / RESULTS MODAL (Golden Picture-Frame Card, Snow Topper, 3 Golden Stars, Stat Rows, Circular Home & Replay)
    const resultsScreen = document.createElement('div');
    resultsScreen.id = 'screen-results';
    resultsScreen.className = 'screen-overlay screen-results hidden';
    resultsScreen.innerHTML = `
      <div class="game-over-modal-wrapper">
        <!-- 3D Enamel Game Over Frame Artwork -->
        <div class="game-over-card-container">
          <img src="${uiAsset('game_over.png')}" alt="Game Over" class="game-over-frame-bg" />

          <!-- Dynamic Stars Overlay (matches 3 stars on the board) -->
          

          <!-- Score & Stats Inside Parchment Board -->
          <div class="game-over-inner-content">
            <div class="game-over-score-hero">
              <span class="game-over-score-num" id="res-total-score">0</span>
            </div>

            <div class="game-over-mini-stats">
              <div class="mini-stat-item">
                <span class="mini-stat-label">Deliveries</span>
                <span class="mini-stat-val" id="res-deliveries">0 / 5</span>
              </div>
              <div class="mini-stat-item">
                <span class="mini-stat-label">Time Left</span>
                <span class="mini-stat-val" id="res-time">0s</span>
              </div>
              <div class="mini-stat-item">
                <span class="mini-stat-label">Stars</span>
                <span class="mini-stat-val" id="res-stars">0 / 6</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Custom Buttons: Retry / Play Again & Home -->
        <footer class="game-over-actions-bar">
          <button id="btn-results-home" class="btn-image-action" aria-label="Main Menu">
            <img src="${uiAsset('btn_back.png')}" alt="Home" class="btn-image-asset" />
          </button>
          <button id="btn-results-replay" class="btn-image-action" aria-label="Retry">
            <img src="${uiAsset('btn_retry.png')}" alt="Retry" class="btn-image-asset" />
          </button>
        </footer>
      </div>
    `;

    // 5. IN-GAME TOAST (Glowing Red Ribbon Pill, 3D Gift Box Icon, +500 Tag)
    const toast = document.createElement('div');
    toast.id = 'toast-delivery';
    toast.className = 'toast-container';
    toast.innerHTML = `
      <div class="toast-ribbon-pill">
        <div class="toast-gift-badge">
          <img src="${uiAsset('icon_gift_box.png')}" alt="Gift" class="toast-custom-gift-img" />
        </div>
        <span class="toast-headline" id="toast-text">Gift Delivered!</span>
        <span class="points-tag" id="toast-points-tag">+500</span>
      </div>
    `;


    this.container.appendChild(hudBar);
    this.container.appendChild(menuScreen);
    this.container.appendChild(instructionsScreen);
    this.container.appendChild(resultsScreen);
    this.container.appendChild(toast);
  }

  _cacheElements() {
    this.elements = {
      hudBar: document.getElementById('hud-top-bar'),
      deliveriesVal: document.getElementById('hud-deliveries'),
      deliveriesFill: document.getElementById('hud-deliveries-fill'),
      timerVal: document.getElementById('hud-timer'),
      timerPill: document.getElementById('hud-timer-pill'),
      starsVal: document.getElementById('hud-stars'),

      screenMenu: document.getElementById('screen-menu'),
      btnPlay: document.getElementById('btn-menu-play'),
      btnInstructions: document.getElementById('btn-menu-instructions'),

      screenInstructions: document.getElementById('screen-instructions'),
      btnCloseInstructions: document.getElementById('btn-instructions-close'),
      btnBackInstructions: document.getElementById('btn-instructions-back'),

      screenResults: document.getElementById('screen-results'),
      resTitle: document.getElementById('res-title'),
      resDeliveries: document.getElementById('res-deliveries'),
      resDeliveryPts: document.getElementById('res-delivery-pts'),
      resTime: document.getElementById('res-time'),
      resTimePts: document.getElementById('res-time-pts'),
      resStars: document.getElementById('res-stars'),
      resStarsPts: document.getElementById('res-stars-pts'),
      resTotalScore: document.getElementById('res-total-score'),
      btnHome: document.getElementById('btn-results-home'),
      btnReplay: document.getElementById('btn-results-replay'),

      toast: document.getElementById('toast-delivery'),
      toastText: document.getElementById('toast-text'),
      toastPointsTag: document.getElementById('toast-points-tag')
    };
  }

  _bindEvents() {
    const { btnPlay, btnInstructions, btnCloseInstructions, btnBackInstructions, btnHome, btnReplay } = this.elements;

    if (btnBackInstructions) {
      btnBackInstructions.addEventListener('click', () => {
        this.showScreen('menu');
      });
    }

        if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        this.showScreen('instructions');
      });
    }

    if (btnInstructions) {
      btnInstructions.addEventListener('click', () => {
        this.showScreen('instructions');
      });
    }

    if (btnCloseInstructions) {
      btnCloseInstructions.addEventListener('click', () => {
        this.showScreen('hud');
        const mobileControls = document.getElementById('mobile-controls-wrapper');
        if (mobileControls) mobileControls.style.display = 'block';

        this.startCountdown(75);
        if (window.sleighController) {
          window.sleighController.isPaused = false;
          if (typeof window.sleighController.resetFlight === 'function') {
            window.sleighController.resetFlight();
          }
        }
        if (window.deliverySystem && typeof window.deliverySystem.startRun === 'function') {
          window.deliverySystem.startRun();
        }
      });
    }

    if (btnHome) {
      btnHome.addEventListener('click', () => {
        this.showScreen('menu');
        if (window.deliverySystem && typeof window.deliverySystem.resetRun === 'function') {
          window.deliverySystem.resetRun();
        }
      });
    }

    if (btnReplay) {
      btnReplay.addEventListener('click', () => {
        this.showScreen('hud');
        const mobileControls = document.getElementById('mobile-controls-wrapper');
        if (mobileControls) mobileControls.style.display = 'block';

        this.startCountdown(75);
        if (window.sleighController) {
          window.sleighController.isPaused = false;
          if (typeof window.sleighController.setVisible === 'function') {
            window.sleighController.setVisible(true);
          }
          if (typeof window.sleighController.resetFlight === 'function') {
            window.sleighController.resetFlight();
          }
        }
        if (window.deliverySystem && typeof window.deliverySystem.startRun === 'function') {
          window.deliverySystem.startRun(true);
        }
      });
    }

    window.addEventListener('resize', () => {
      // no-op: joystick handling moved to legacy DeliverySystem
    });
  }
  showScreen(screenName) {
    this.currentScreen = (screenName === 'playing') ? 'hud' : screenName;
    const { screenMenu, screenInstructions, screenResults, hudBar } = this.elements;
    const loader = document.getElementById('loader');

    if (screenMenu) screenMenu.classList.toggle('hidden', screenName !== 'menu');
    if (screenInstructions) screenInstructions.classList.toggle('hidden', screenName !== 'instructions');
    if (screenResults) screenResults.classList.toggle('hidden', screenName !== 'results');

    const isPlaying = screenName === 'hud' || screenName === 'playing';
    if (hudBar) hudBar.classList.toggle('hidden', !isPlaying);

    // Mobile controls: only visible while in active gameplay
    const mobileControls = document.getElementById('mobile-controls-wrapper');
    if (mobileControls) {
      mobileControls.style.display = isPlaying ? 'block' : 'none';
    }

    // Hide Santa on title, instructions, game over/results, and loading screens to avoid rendering overhead
    const shouldHideSanta = (screenName === 'menu' || screenName === 'instructions' || screenName === 'results' || screenName === 'loading');
    if (window.sleighController && typeof window.sleighController.setVisible === 'function') {
      window.sleighController.setVisible(!shouldHideSanta);
    }

    if (loader) {
      if (screenName === 'loading') {
        loader.classList.remove('hidden');
        loader.style.display = 'flex';
      } else {
        loader.classList.add('hidden');
        setTimeout(() => { if (loader.classList.contains('hidden')) loader.style.display = 'none'; }, 600);
      }
    }
  }

  startCountdown(seconds = 75) {
    clearInterval(this.timerInterval);
    this.timeRemaining = seconds;
    this.updateTimerDisplay(this.timeRemaining);

    this.timerInterval = setInterval(() => {
      if (this.isPaused || this.currentScreen !== 'hud') return;
      this.timeRemaining--;
      this.updateTimerDisplay(this.timeRemaining);

      if (this.timeRemaining <= 0) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
        if (window.deliverySystem && typeof window.deliverySystem._finishRun === 'function') {
          window.deliverySystem._finishRun('timeout');
        }
      }
    }, 1000);
  }

  updateTimerDisplay(time) {
    const { timerVal, timerPill } = this.elements;
    if (timerVal) timerVal.textContent = Math.max(0, time);
    if (timerPill) {
      timerPill.classList.toggle('warning', time <= 15);
    }
  }

  updateHUD(state = {}) {
    const {
      deliveries = this.deliveries,
      maxDeliveries = this.maxDeliveries,
      stars = this.stars,
      maxStars = this.maxStars,
      score = this.score
    } = state;

    this.deliveries = deliveries;
    this.maxDeliveries = maxDeliveries;
    this.stars = stars;
    this.maxStars = maxStars;
    this.score = score;

    const { deliveriesVal, deliveriesFill, starsVal } = this.elements;
    if (deliveriesVal) deliveriesVal.textContent = `${deliveries} / ${maxDeliveries}`;
    if (deliveriesFill) {
      const pct = Math.min(100, Math.max(0, (deliveries / maxDeliveries) * 100));
      deliveriesFill.style.width = `${pct}%`;
    }
    if (starsVal) starsVal.textContent = `${stars} / ${maxStars}`;
  }

  setGuidance(text, state = 'normal') {
    this.guidanceText = text;
    this.guidanceState = state;
  }

  showDeliveryToast(points = 500, label = null) {
    const { toast, toastText, toastPointsTag } = this.elements;
    if (!toast) return;

    let defaultLabel = 'Gift Delivered!';
    if (points >= 1000) defaultLabel = 'Bullseye! Perfect!';
    else if (points <= 200) defaultLabel = 'Nice Drop!';
    else defaultLabel = 'Great Delivery!';

    if (toastText) toastText.textContent = label || defaultLabel;
    if (toastPointsTag) toastPointsTag.textContent = `+${points}`;

    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  showResults(results = {}) {
    clearInterval(this.timerInterval);
    this.showScreen('results');

    const {
      deliveries = this.deliveries,
      stars = this.stars,
      score = this.score,
      timeRemaining = this.timeRemaining,
      reason = 'complete'
    } = results;

    const {
      resTitle, resDeliveries, resDeliveryPts, resTime, resTimePts,
      resStars, resStarsPts, resTotalScore
    } = this.elements;

    const deliveryPts = (typeof results.deliveryScore === 'number' && results.deliveryScore > 0)
      ? results.deliveryScore
      : (deliveries * 500);
    const timePts = Math.max(0, timeRemaining) * 10;
    const starPts = stars * 50;
    const total = score > 0 ? score : (deliveryPts + timePts + starPts);

    if (resTitle) resTitle.textContent = reason === 'crash' ? 'RUN ENDED' : (deliveries >= 5 ? 'MISSION COMPLETE!' : 'TIME EXPIRED');
    if (resDeliveries) resDeliveries.textContent = `${deliveries} / 5`;
    if (resDeliveryPts) resDeliveryPts.textContent = `+${deliveryPts.toLocaleString()}`;
    if (resTime) resTime.textContent = `${Math.max(0, timeRemaining)}s`;
    if (resTimePts) resTimePts.textContent = `+${timePts.toLocaleString()}`;
    if (resStars) resStars.textContent = `${stars} / 6`;
    if (resStarsPts) resStarsPts.textContent = `+${starPts.toLocaleString()}`;
    if (resTotalScore) resTotalScore.textContent = total.toLocaleString();

    const starCount = deliveries >= 5 ? (timeRemaining >= 25 ? 3 : 2) : (deliveries >= 3 ? 1 : 0);
    for (let i = 1; i <= 3; i++) {
      const starEl = document.getElementById(`res-star-${i}`);
      if (starEl) {
        starEl.classList.toggle('achieved', i <= starCount);
        starEl.classList.toggle('empty', i > starCount);
      }
    }
  }

  _bindDeliverySystem() {
    if (typeof window !== 'undefined') {
      window.uiManager = this;
      if (window.deliverySystem) window.deliverySystem.uiManager = this;

      let delSys = window.deliverySystem;
      try {
        Object.defineProperty(window, 'deliverySystem', {
          get() { return delSys; },
          set: (val) => {
            delSys = val;
            if (val) val.uiManager = this;
          },
          configurable: true,
          enumerable: true
        });
      } catch (e) {
        setInterval(() => {
          if (window.deliverySystem && window.deliverySystem.uiManager !== this) {
            window.deliverySystem.uiManager = this;
          }
        }, 100);
      }
    }
  }
}

export const uiManager = new UIManager();
