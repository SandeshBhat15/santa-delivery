const fs = require('fs');

let js = fs.readFileSync('src/ui/UIManager.js', 'utf8');
js = js.replace(/\r\n/g, '\n');

// 1. In _renderDOM, update HUD timer and gift icons to use the custom 3D icons:
const oldHudTimer = `<div id="hud-timer-pill" class="hud-pill hud-pill-timer">
        <div class="hud-badge-icon badge-watch">
          <svg viewBox="0 0 24 24">
            <path d="M15.07 1.01h-6.14v2h6.14v-2zm-3.07 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7zm1-11h-2v5l4.28 2.54.72-1.21-3-1.77V10.01z"/>
          </svg>
        </div>
        <span class="timer-text-val"><span id="hud-timer">75</span>s</span>
      </div>`;

const newHudTimer = `<div id="hud-timer-pill" class="hud-pill hud-pill-timer">
        <div class="hud-badge-icon badge-watch">
          <img src="/assets/custom_ui/icon_timer.png" alt="Timer" class="hud-custom-icon" />
        </div>
        <span class="timer-text-val"><span id="hud-timer">75</span>s</span>
      </div>`;

if (js.includes(oldHudTimer)) {
  js = js.replace(oldHudTimer, newHudTimer);
  console.log('Replaced oldHudTimer');
}

// Update HUD gift badge icon
const oldHudGift = `<div class="hud-badge-icon badge-gift">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.05 0-1.96.54-2.5 1.35l-.5.65-.5-.65C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1h-2V5c0-.55.45-1 1-1zM9 4c.55 0 1 .45 1 1v1H8c-.55 0-1-.45-1-1s.45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76V14h2V8.76L15.38 12 17 10.83 14.92 8H20v6z"/>
          </svg>
        </div>`;

const newHudGift = `<div class="hud-badge-icon badge-gift">
          <img src="/assets/custom_ui/icon_gift_box.png" alt="Gifts" class="hud-custom-icon" />
        </div>`;

if (js.includes(oldHudGift)) {
  js = js.replace(oldHudGift, newHudGift);
  console.log('Replaced oldHudGift');
}

// 2. Main Menu: Replace title banner and buttons with custom graphic assets!
const oldMainMenuHeader = `        <!-- 3D Title Banner on Curved Snow Ribbon -->
        <header class="title-banner-wrapper">
          <svg class="snow-caps" viewBox="0 0 380 32" preserveAspectRatio="none">
            <path d="M0,20 Q20,32 40,20 Q60,30 80,18 Q105,32 130,20 Q160,34 190,20 Q220,32 250,18 Q280,32 310,20 Q340,32 380,20 L380,0 L0,0 Z" fill="url(#snow-grad)" />
          </svg>
          <div class="ribbon-banner">
            <div class="title-sub">Holiday Flight Quest</div>
            <h1 class="title-main">Santa's Gift<br/>Delivery</h1>
            <div class="title-gold-badge">5 DASH CHALLENGE</div>
          </div>
        </header>`;

const newMainMenuHeader = `        <!-- High-Fidelity 3D Holiday Logo Asset -->
        <header class="title-banner-wrapper custom-logo-wrapper">
          <img src="/assets/custom_ui/logo_holiday.png" alt="Santa's Gift Run" class="menu-custom-title-logo" />
        </header>`;

if (js.includes(oldMainMenuHeader)) {
  js = js.replace(oldMainMenuHeader, newMainMenuHeader);
  console.log('Replaced oldMainMenuHeader');
}

// Replace menu action buttons
const oldMenuButtons = `        <!-- Action Group: Glossy Red Play Pill & Navy How To Play Pill -->
        <footer class="menu-actions-group">
          <button id="btn-menu-play" class="btn-pill btn-red" aria-label="Play">
            <span class="play-icon-triangle"></span>
            <span>Play</span>
          </button>
          <button id="btn-menu-instructions" class="btn-pill btn-navy" aria-label="How to Play">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
            <span>How to Play</span>
          </button>
        </footer>`;

const newMenuButtons = `        <!-- Action Group: High-Polish Custom Enamel Buttons -->
        <footer class="menu-actions-group custom-menu-actions">
          <button id="btn-menu-play" class="btn-image-action" aria-label="Play">
            <img src="/assets/custom_ui/btn_play.png" alt="Play" class="btn-image-asset" />
          </button>
          <button id="btn-menu-instructions" class="btn-image-action" aria-label="How to Play">
            <img src="/assets/custom_ui/btn_how_to_play.png" alt="How to Play" class="btn-image-asset" />
          </button>
        </footer>`;

if (js.includes(oldMenuButtons)) {
  js = js.replace(oldMenuButtons, newMenuButtons);
  console.log('Replaced oldMenuButtons');
}

// 3. Instructions Screen: Device-responsive graphic cards with Play Now and Back buttons!
const oldInstructions = `    // 3. INSTRUCTIONS MODAL
    const instructionsScreen = document.createElement('div');
    instructionsScreen.id = 'screen-instructions';
    instructionsScreen.className = 'screen-overlay screen-instructions hidden';
    instructionsScreen.innerHTML = \`
      <div class="victory-card instructions-card">
        <svg class="modal-snow-topper" viewBox="0 0 440 44" preserveAspectRatio="none">
          <path d="M0,24 Q25,44 50,26 Q80,42 110,24 Q140,40 170,22 Q210,44 245,26 Q280,44 320,24 Q360,42 395,24 Q420,38 440,24 L440,0 L0,0 Z" fill="url(#snow-grad)" />
        </svg>

        <div class="modal-ribbon-title">
          <h2>How to Play</h2>
        </div>

        <div class="stats-card-group" style="margin-top: 24px; text-align: left;">
          <div class="stat-row">
            <div class="stat-label-wrap">
              <svg viewBox="0 0 24 24"><path d="M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.05 0-1.96.54-2.5 1.35l-.5.65-.5-.65C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1h-2V5c0-.55.45-1 1-1zM9 4c.55 0 1 .45 1 1v1H8c-.55 0-1-.45-1-1s.45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76V14h2V8.76L15.38 12 17 10.83 14.92 8H20v6z"/></svg>
              <span>TARGET BEACONS</span>
            </div>
            <span style="font-size: 0.82rem; color: #E6F0FF; max-width: 55%; text-align: right;">Fly through beacons over roofs to drop 5 gifts!</span>
          </div>

          <div class="stat-row">
            <div class="stat-label-wrap">
              <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
              <span>BONUS STARS</span>
            </div>
            <span style="font-size: 0.82rem; color: #E6F0FF; max-width: 55%; text-align: right;">Collect up to 6 stars floating in the sky.</span>
          </div>

          <div class="stat-row">
            <div class="stat-label-wrap">
              <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2z"/></svg>
              <span>CONTROLS</span>
            </div>
            <span style="font-size: 0.82rem; color: #E6F0FF; max-width: 55%; text-align: right;">[W/S] Pitch, [A/D] Turn or Mobile Flight Joystick.</span>
          </div>
        </div>

        <button id="btn-instructions-close" class="btn-pill btn-red" style="margin-top: 24px; padding: 12px 36px; font-size: 1.25rem;">
          <span class="play-icon-triangle"></span>
          <span>Play Now</span>
        </button>
      </div>
    \`;`;

const newInstructions = `    // 3. INSTRUCTIONS MODAL (Responsive Graphic Cards for Desktop & Mobile)
    const instructionsScreen = document.createElement('div');
    instructionsScreen.id = 'screen-instructions';
    instructionsScreen.className = 'screen-overlay screen-instructions hidden';
    instructionsScreen.innerHTML = \`
      <div class="instructions-card-wrapper">
        <!-- Instructions Visual Showcase: Desktop & Mobile Switching Image -->
        <div class="instructions-poster-container">
          <picture>
            <source media="(max-width: 768px)" srcset="/assets/custom_ui/instructions_mobile.png" />
            <img src="/assets/custom_ui/instructions_desktop.png" alt="How to Play" class="instructions-poster-img" />
          </picture>
        </div>

        <!-- Action Buttons: Play Now & Back -->
        <footer class="instructions-actions-bar">
          <button id="btn-instructions-back" class="btn-image-action btn-sm" aria-label="Back">
            <img src="/assets/custom_ui/btn_back.png" alt="Back" class="btn-image-asset" />
          </button>
          <button id="btn-instructions-close" class="btn-image-action" aria-label="Play Now">
            <img src="/assets/custom_ui/btn_play.png" alt="Play Now" class="btn-image-asset" />
          </button>
        </footer>
      </div>
    \`;`;

if (js.includes(oldInstructions)) {
  js = js.replace(oldInstructions, newInstructions);
  console.log('Replaced oldInstructions');
}

// 4. Results Screen Actions: Integrate Play Again & Back buttons
const oldResultsActions = `        <!-- Circular Red Enamel Action Buttons: Home & Replay -->
        <div class="modal-action-footer">
          <div class="btn-action-label">
            <button id="btn-results-home" class="btn-circle" title="Main Menu" aria-label="Main Menu">
              <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
            </button>
            <span class="btn-label-text">Home</span>
          </div>

          <div class="btn-action-label">
            <button id="btn-results-replay" class="btn-circle" title="Play Again" aria-label="Play Again">
              <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6 0 2.97-2.17 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93 0-4.42-3.58-8-8-8zm-6 8c0-1.65.67-3.15 1.76-4.24L6.34 7.34C4.9 8.79 4 10.79 4 13c0 4.08 3.05 7.44 7 7.93v-2.02C8.17 18.43 6 15.97 6 13z"/></svg>
            </button>
            <span class="btn-label-text">Replay</span>
          </div>
        </div>`;

const newResultsActions = `        <!-- Results Action Buttons: High-Polish Play Again & Home/Retry -->
        <div class="modal-action-footer custom-results-actions">
          <button id="btn-results-home" class="btn-image-action btn-sm" title="Back / Home" aria-label="Main Menu">
            <img src="/assets/custom_ui/btn_back.png" alt="Home" class="btn-image-asset" />
          </button>
          <button id="btn-results-replay" class="btn-image-action" title="Play Again" aria-label="Play Again">
            <img src="/assets/custom_ui/btn_play_again.png" alt="Play Again" class="btn-image-asset" />
          </button>
        </div>`;

if (js.includes(oldResultsActions)) {
  js = js.replace(oldResultsActions, newResultsActions);
  console.log('Replaced oldResultsActions');
}

// 5. In-Game Toast: Replace gift SVG with custom icon_gift_box.png
const oldToastBadge = `        <div class="toast-gift-badge">
          <svg viewBox="0 0 24 24" fill="#6A3B00">
            <path d="M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.05 0-1.96.54-2.5 1.35l-.5.65-.5-.65C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1h-2V5c0-.55.45-1 1-1zM9 4c.55 0 1 .45 1 1v1H8c-.55 0-1-.45-1-1s.45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76V14h2V8.76L15.38 12 17 10.83 14.92 8H20v6z"/>
          </svg>
        </div>`;

const newToastBadge = `        <div class="toast-gift-badge">
          <img src="/assets/custom_ui/icon_gift_box.png" alt="Gift" class="toast-custom-gift-img" />
        </div>`;

if (js.includes(oldToastBadge)) {
  js = js.replace(oldToastBadge, newToastBadge);
  console.log('Replaced oldToastBadge');
}

// 6. Cache btnBack & bind back event in _cacheElements and _bindEvents:
const oldCache = `      screenInstructions: document.getElementById('screen-instructions'),
      btnCloseInstructions: document.getElementById('btn-instructions-close'),`;

const newCache = `      screenInstructions: document.getElementById('screen-instructions'),
      btnCloseInstructions: document.getElementById('btn-instructions-close'),
      btnBackInstructions: document.getElementById('btn-instructions-back'),`;

if (js.includes(oldCache)) {
  js = js.replace(oldCache, newCache);
  console.log('Replaced oldCache');
}

const oldBind = `    const { btnPlay, btnInstructions, btnCloseInstructions, btnHome, btnReplay } = this.elements;`;
const newBind = `    const { btnPlay, btnInstructions, btnCloseInstructions, btnBackInstructions, btnHome, btnReplay } = this.elements;

    if (btnBackInstructions) {
      btnBackInstructions.addEventListener('click', () => {
        this.showScreen('menu');
      });
    }`;

if (js.includes(oldBind)) {
  js = js.replace(oldBind, newBind);
  console.log('Replaced oldBind');
}

fs.writeFileSync('src/ui/UIManager.js', js.replace(/\n/g, '\r\n'), 'utf8');
console.log('Done updating UIManager.js');
