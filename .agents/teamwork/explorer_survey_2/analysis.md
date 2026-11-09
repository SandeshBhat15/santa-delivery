# Comprehensive Visual Design System & UI Deconstruction Report
**Project:** Santa's Gift Delivery — 5 Delivery Dash  
**Author:** UI Reference & Visual Design Explorer (teamwork_explorer)  
**Investigation Target:** UI Reference Image (`media_1794114967133_ffcac50a.jpg`) and Requirements R4 & R5  
**Working Directory:** `d:\Sandesh\Personal Work\Antigravity Projects\Santa Delivery\.agents\teamwork\explorer_survey_2\`

---

## 1. Executive Summary

Based on rigorous visual and pixel analysis of the authoritative UI reference sheet (`media_1794114967133_ffcac50a.jpg`) and the gameplay specifications in `ORIGINAL_REQUEST.md` (R1 through R5), this document defines the complete visual design system, modular component specifications, and responsive layout architecture for the redesigned Santa Delivery game UI.

The current codebase features a dark, sci-fi glassmorphic HUD with Unicode emojis and minimal styling, and directly starts flight upon loading without a main title screen or a festive theme. The reference image establishes a premium, holiday arcade aesthetic featuring:
- **Rich, layered color palette:** Festive crimson red, multi-stop metallic gold, warm aged parchment, midnight navy blue, and frosty snow white with cyan undertones.
- **Iconic holiday motifs:** Snow-capped crimson ribbon banners, 3D gift boxes with gold ribbons and holly leaves, candy cane striped meters, golden celestial stars, and circular red/gold action buttons.
- **Modular, editable DOM components:** No flattened full-screen UI images. Every title, label, counter, timer, and score value is rendered as editable, accessible text while decorative frames, ribbons, badges, and snow caps are modular CSS/SVG layers.
- **Dual layout modes:** Desktop 16:9 widescreen layout with an unobstructed central flight view and pure keyboard flight controls, and a Mobile portrait-first layout with safe-area insets and an unobtrusive dual-axis touch joystick.

---

## 2. Complete Visual Design System

### 2.1 Color Palette & Token Architecture

Pixel sampling from the reference image reveals a cohesive, saturated, high-contrast palette calibrated for night-sky winter environments:

| Palette Name | Token Key | Hex Code | RGB | Visual Role & Usage in Reference |
| :--- | :--- | :--- | :--- | :--- |
| **Festive Red** | `--c-red-primary` | `#D61F33` | `rgb(214, 31, 51)` | Primary crimson midtone for Play button, banners, ribbons |
| Festive Red | `--c-red-highlight` | `#E52E42` | `rgb(229, 46, 66)` | Top specular rim on buttons and ribbon folds |
| Festive Red | `--c-red-deep` | `#A31126` | `rgb(163, 17, 38)` | Shadow gradient stop on buttons and ribbon lower curves |
| Festive Red | `--c-red-dark` | `#5C0713` | `rgb(92, 7, 19)` | Outermost stroke and drop-shadow under red elements |
| **Metallic Gold**| `--c-gold-core` | `#FFC727` | `rgb(255, 199, 39)` | Classic golden yellow for stars, borders, and icons |
| Metallic Gold | `--c-gold-light` | `#FFE680` | `rgb(255, 230, 128)` | Light highlight on star tips, bevels, and ribbon edges |
| Metallic Gold | `--c-gold-dark` | `#B87B08` | `rgb(184, 123, 8)` | Deep shadow on carved bevels and button frames |
| Metallic Gold | `--c-gold-glow` | `#FFDF66` | `rgb(255, 223, 102)` | Emissive halo / particle dust glow color |
| **Parchment** | `--c-parchment-base` | `#FDF1D6` | `rgb(253, 241, 214)`| Cream/parchment center fill for results cards & dialogs |
| Parchment | `--c-parchment-edge` | `#E7C38B` | `rgb(231, 195, 139)`| Aged vignette border along parchment card margins |
| Parchment | `--c-parchment-shadow`| `#B88B4C` | `rgb(184, 139, 76)` | Carved wood/parchment rim shadow |
| **Midnight Navy**| `--c-navy-deep` | `#061226` | `rgb(6, 18, 38)` | Deepest backdrop tint for modals and vignette overlays |
| Midnight Navy | `--c-navy-track` | `#0B1E40` | `rgb(11, 30, 64)` | Well / background for HUD pill tracks and meters |
| Midnight Navy | `--c-navy-btn` | `#1A3B7A` | `rgb(26, 59, 122)` | Midtone for secondary "Instructions / Book" button |
| Midnight Navy | `--c-navy-light` | `#2855A6` | `rgb(40, 85, 166)` | Highlight rim on secondary navy button |
| **Snow & Frost** | `--c-snow-white` | `#FFFFFF` | `rgb(255, 255, 255)`| Pure white crest on snow caps and snowflake glyphs |
| Snow & Frost | `--c-snow-shadow`| `#C5DCF4` | `rgb(197, 220, 244)`| Soft cyan/blue shadow on underside of snow drifts |
| **Candy Cane** | `--c-candy-red` | `#D61F33` | `rgb(214, 31, 51)` | Candy cane 45° stripe red |
| Candy Cane | `--c-candy-white` | `#FFF8ED` | `rgb(255, 248, 237)`| Candy cane 45° stripe warm cream/white |

#### Primary Gradient Recipes:
```css
/* Festive Primary Red Button (Play, Home, Replay, Circular HUD Buttons) */
--grad-btn-red: linear-gradient(180deg, #E52E42 0%, #D61F33 38%, #A31126 82%, #7A0B1A 100%);

/* Secondary Midnight Navy Button (Instructions / Book) */
--grad-btn-navy: linear-gradient(180deg, #2855A6 0%, #1A3B7A 42%, #0F2652 82%, #081735 100%);

/* Multi-Stop Metallic Gold Trim Border */
--grad-gold-trim: linear-gradient(180deg, #FFF0A3 0%, #FFC727 40%, #B87B08 82%, #6B4202 100%);

/* Parchment Results Card Texture */
--grad-parchment: radial-gradient(circle at 50% 30%, #FFF8EA 0%, #FDF1D6 45%, #F4D7A5 85%, #E2BE82 100%);

/* HUD Pill Meter Well Track */
--grad-hud-track: linear-gradient(180deg, #06142E 0%, #0B1E40 50%, #040E20 100%);

/* Candy Cane Stripe Meter Fill */
--grad-candy-cane: repeating-linear-gradient(
  45deg,
  #D61F33,
  #D61F33 12px,
  #FFF9EE 12px,
  #FFF9EE 24px
);
```

---

### 2.2 Typography & Font Treatment System

The visual reference demonstrates clear typographic hierarchy:
1. **Title / Ribbon Display Typography:**
   - **Recommended Font Families:** `'Cinzel Decorative', 'Berkshire Swash', 'Mountains of Christmas', 'Cinzel', Georgia, serif`
   - **Characteristics:** Uppercase or stylized title-casing, bold 800 weight, `letter-spacing: 1.5px`.
   - **Styling on Red Ribbons:** Cream-white text (`#FFF9E8`) with a subtle golden glow and deep burgundy drop shadow:
     ```css
     color: #FFF9E8;
     text-shadow: 0 2px 4px rgba(78, 4, 14, 0.85), 0 0 8px rgba(255, 215, 0, 0.4);
     ```
   - **Styling on Parchment:** Rich carved mahogany (`#3E120B`):
     ```css
     color: #3E120B;
     text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
     ```

2. **HUD & Results Numerals (Counters, Timer, Score):**
   - **Font Families:** `'Cinzel', 'Trebuchet MS', -apple-system, sans-serif`
   - **Characteristics:** `font-variant-numeric: tabular-nums` (prevents horizontal jittering during 75s countdown and score increments).
   - **Styling:** Golden amber (`#FFEAA7` to `#FFD152`) with crisp dark stroke:
     ```css
     color: #FFD152;
     font-weight: 900;
     text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 5px rgba(0, 0, 0, 0.7);
     ```

3. **Subtitles & Badges:**
   - **Font Families:** `'Cinzel', 'Segoe UI', sans-serif`
   - **Size / Weight:** 10px–12px, font-weight 700, `letter-spacing: 1.2px`, uppercase.
   - **Color:** Soft ice blue (`#A0C4E8`) on navy; warm sepia (`#6A4E32`) on parchment.

---

### 2.3 Textures, Borders, and Holiday Motifs

1. **Red Ribbon Banners:**
   - Arched ribbon banner crowning the Title Screen and Results Screen.
   - Symmetrical curved crimson ribbon with double gold trim borders, 3D folded underside, and fishtail ends.
   - Crowned with a fluffy snow cap along its upper arc.
2. **Gift Box & Holly Crest:**
   - Red cubic gift box with shiny yellow gold cross-ribbon and bow.
   - Flanked by deep green holly leaves with gold edge highlights.
   - Placed atop the title ribbon or centered at the crest of modal cards.
3. **Snow Caps & Frost Drifts:**
   - Organic, puffy white snow mounds that drape naturally over:
     - The top edge of ribbon banners.
     - The top shoulder corners of the Candy Cane Loading Bar.
     - The upper arched frame and lower corners of the Parchment Results Panel.
   - Highlighted in `#FFFFFF` with soft ambient underside shadow `#C5DCF4`.
4. **Snowflake Ornaments:**
   - Crisp 6-pointed white snowflake ornaments flanking the Candy Cane Loading Bar.
5. **Gold Trim Borders:**
   - Double-line bevel: outer gold rim (`2px solid #FFC727`), dark inner crease (`1px solid #4A2E02`), and inner glossy bevel (`inset 0 1px 1px rgba(255, 255, 255, 0.6)`).
6. **Golden Sparkles & Beacon Motif:**
   - Arcs of warm golden stardust particles trailing behind Santa's sleigh and guiding the player off-course.
   - Vertical golden light beam emanating from the target cottage chimney, capped by a floating glowing gift emblem.

---

## 3. Component Deconstruction (Requirements R4 & R5)

### 3.1 Top HUD Bar
The Top HUD must occupy minimal vertical space, leaving the central flight corridor 100% unobstructed.

```
+---------------------------------------------------------------------------------------------------+
|  [🎁  0 / 5  ====]                 [⏱️ 75s]     [⭐ 0 / 6]     [🏆 0 PTS]               [⏸️]   |
|  (Deliveries Pill)                 (Timer Pill) (Stars Pill)   (Score Pill)           (Pause Btn) |
+---------------------------------------------------------------------------------------------------+
```

1. **Deliveries Counter Pill (X / 5):**
   - **Icon Badge:** 3D red gift box with gold ribbon inside a circular golden badge.
   - **Meter Track:** Navy capsule track (`#081735`) with golden outer border trim.
   - **Progress Fill:** Candy cane diagonal striped bar (or 5 distinct segmented pips).
   - **Counter Text:** Editable text: `<span id="hud-deliveries">0</span> / 5`.
2. **Countdown Timer Pill (Starting at 75s):**
   - **Icon Badge:** Circular red stopwatch/clock with golden rim and hands.
   - **Counter Text:** `<span id="hud-timer">75s</span>` (or `01:15`).
   - **Urgency Visual States (Requirement R4):**
     - *Normal (>15s):* Calm gold text (`#FFEAA7`), soft dark navy well, subtle gold border.
     - *Urgent (<15s):* Pill border shifts to glowing warning red/amber (`#FF4757`), timer text flashes bright white-red, and the pill applies a gentle heartbeat pulse animation (`transform: scale(1.05)` at 1.0Hz).
3. **Collected Bonus Stars Pill:**
   - **Icon Badge:** 5-pointed glowing celestial star in solid gold.
   - **Counter Text:** `<span id="hud-stars">0</span> / 6`.
   - **Visual Feedback on Pickup:** Pulsing pop animation (`transform: scale(1.35)`) with an emissive star burst whenever a route star is gathered.
4. **Total Score Counter:**
   - Live editable score readout: `<span id="hud-score">0</span>`.
5. **Action Controls (Pause / Audio):**
   - Circular crimson button (`40px x 40px`) with double gold border trim and centered gold icon (Pause `⏸️` or Sound `🔊`).

---

### 3.2 Main Menu / Title Screen
When the player loads the game or returns home from the results screen, the Main Menu overlay presents a festive title view without obscuring the 3D winter village scene behind it.

1. **Top Title Crest:**
   - Arched crimson ribbon banner with golden trim and snow mantle.
   - Crowned with a red gift box and holly leaves.
   - Editable Title Text: `SANTA'S DELIVERY` (or `SANTA'S SLEIGH RUN`).
2. **Action Buttons (Lower Center):**
   - **Primary "PLAY" Button:**
     - Wide elongated pill button (`220px x 64px` on desktop, `200px x 56px` on mobile).
     - Deep festive red gradient with gold border trim.
     - Centered metallic gold play triangle (`▶`).
     - Hover/Focus state: Gentle brightness increase (`filter: brightness(1.08)`), subtle scale (`transform: scale(1.03)`), golden box-shadow flare.
   - **Secondary "INSTRUCTIONS" Button:**
     - Sleek navy pill button (`170px x 46px`).
     - Deep royal navy gradient with gold border trim.
     - Centered metallic gold open book icon (`📖`).
     - Opens the parchment instructions modal overlay.

---

### 3.3 Loading Screen & Instructions Overlay

1. **Loading Screen:**
   - Background: 3D winter landscape with soft aurora borealis in the distance.
   - **Candy Cane Loading Bar:**
     - Dark navy capsule container with a warm gold border trim.
     - Puffy white snow caps resting on top of the left and right shoulders.
     - Flanked on both sides by crisp white snowflake emblems.
     - Bar Fill: 45° alternating diagonal red and vanilla candy cane stripes.
     - Progress: Smooth CSS transition on width: `width: 0%` to `width: 100%`.
     - Editable Status Text below: `<p id="loader-status">Loading Village... 0%</p>`.
2. **Instructions Modal Card ("How to Play"):**
   - Styled as a warm cream parchment card with golden trim and snow crest.
   - Red ribbon banner title: `FLIGHT GUIDE`.
   - **Key Instructions:**
     - **Goal:** Deliver gifts to 5 cottages before the 75-second timer runs out.
     - **Delivery Mechanic:** Fly directly through the tall golden sky beacon above the target chimney — gifts drop automatically!
     - **Bonus Stars:** Collect glowing golden stars along the flight path for bonus points.
     - **Controls (Dynamic by device):**
       - *Desktop:* `[W] / [S]` Climb & Dive, `[A] / [D]` Steer Left & Right.
       - *Mobile:* Dual-axis virtual joystick on the lower screen for steering and altitude.
   - **Dismiss Button:** Festive red pill button: `LET'S FLY! ▶`.

---

### 3.4 Transient In-Game Feedback (Requirement R4)

All feedback must be ephemeral and restrained, never obstructing Santa or the landing beacon:

1. **Delivery Celebration Toast / Banner:**
   - Triggered upon successful delivery through the cottage beacon.
   - Compact red ribbon toast sliding down from below the top HUD.
   - Text: `GIFT DELIVERED! +500` (with festive chime).
   - Visible for 1.4 seconds, smoothly fades and slides upward.
2. **Combo Score Popup:**
   - Appears near Santa's sleigh in world/screen space: `+250 COMBO x2!`.
   - Golden text with dark shadow, floats upward 30px over 0.8s while scaling and fading.
3. **Subtle Bonus-Star Pickup Toast:**
   - When Santa collects a route star, a brief sparkle pulse plays on the HUD star counter with `+100 ★`.
4. **Target Beacon Proximity Glow:**
   - When Santa is within 25 meters of the active chimney beacon, a warm golden aura glows along the perimeter of the deliveries HUD meter, signaling delivery readiness.
   - Completely preserves R1 and R4: *No permanent navigation arrows, compass needles, or minimaps.*

---

### 3.5 Parchment-Style Results Screen (Requirement R5)

The results screen is a centerpiece of the redesign, accurately modeled on the reference image (middle-right panel 2):

```
                       ⭐⭐⭐
             +-----------------------+
             | [🎀 SANTA'S RUN 🎀]   |
       /\    +-----------------------+    /\
      /  \  +-------------------------+  /  \
     /    \ | [🎁] 5 / 5 Deliveries   | /    \
    / PINE \| [⏱️] 32s Time Bonus     |/ PINE \
    | TREE  | [⭐] 4 / 6 Bonus Stars  |  TREE |
    +-------+-------------------------+-------+
    |           TOTAL SCORE: 3,420            |
    |                                         |
    |        (⌂ Home)      (↻ Replay)         |
    +-----------------------------------------+
```

1. **Top Arched Crest & Rating:**
   - Three 3D golden celestial stars arched above the card.
   - Rating logic:
     - 5 deliveries completed with high time/combo: **3 Stars (★★★)**.
     - 4–5 deliveries completed: **2 Stars (★★☆)**.
     - 1–3 deliveries or timeout: **1 Star (★☆☆)**.
   - Red curved ribbon banner across the top: `DELIVERIES COMPLETE!` (or `TIME'S UP!`).
2. **Parchment Body & Winter Framing:**
   - Warm golden-cream parchment texture with aged edges and gold bevel border.
   - Flanked at the bottom corners by snow-dusted evergreen pine trees and snow banks.
3. **Row-by-Row Score Breakdown:**
   - **Row 1 (Deliveries):** Red gift box icon + navy capsule track + editable readout: `<span class="res-label">Deliveries:</span> <strong>5 / 5</strong> (+2,500 pts)`.
   - **Row 2 (Remaining Time):** Stopwatch icon + navy capsule track + editable readout: `<span class="res-label">Time Remaining:</span> <strong>28s</strong> (+280 pts)`.
   - **Row 3 (Bonus Stars):** Golden star icon + navy capsule track + editable readout: `<span class="res-label">Bonus Stars:</span> <strong>4 / 6</strong> (+400 pts)`.
   - **Row 4 (Combo & Delivery Points):** Clean summary badge of combo performance.
4. **Total Score Display:**
   - Large embossed gold numerals: `<h3 id="res-total-score">3,180 PTS</h3>`.
5. **Action Controls:**
   - **Home Button (Left):** Circular red button (`56px x 56px`) with concentric double gold rims and white/gold cottage/home icon (`⌂`). Returns to Main Menu.
   - **Play Again Button (Right):** Circular red button (`56px x 56px`) with concentric double gold rims and white/gold circular replay icon (`↻`). Starts a fresh 5-delivery run immediately.

---

## 4. Modular UI Architecture & Implementation Blueprint

### 4.1 Asset Modularity & Editable Text Guarantee

To fulfill the strict requirement that **no flattened full-screen UI image is used and all text/numbers remain editable**:
- **SVG / Vector Masks:** Used for scalable decorative assets (Ribbon banner path, snow cap curves, gold frame borders, snowflake icons, and button glyphs).
- **CSS Styling:** Gradients, drop-shadows, candy cane striped progress bars, and animations are handled entirely via CSS.
- **Editable HTML Elements:** Every heading, label, counter, timer, and score uses standard semantic HTML tags (`<h1>`, `<span>`, `<strong id="...">`).

### 4.2 DOM Hierarchy Specification

```html
<!-- Root UI Overlay Container (Pointer-events: none; passes flight interactions) -->
<div id="ui-container">

  <!-- ================= TOP HUD (Playing State) ================= -->
  <header id="hud-top-bar" class="hud-top-bar" role="banner">
    <!-- Deliveries Counter -->
    <div class="hud-pill hud-deliveries-pill">
      <div class="badge-icon badge-gift"></div>
      <div class="pill-track">
        <div id="hud-deliveries-fill" class="pill-fill candy-cane-fill" style="width: 0%"></div>
        <span class="pill-text"><strong id="hud-deliveries">0</strong> / 5</span>
      </div>
    </div>

    <!-- Countdown Timer (75s with Urgency State) -->
    <div id="hud-timer-pill" class="hud-pill hud-timer-pill">
      <div class="badge-icon badge-clock"></div>
      <div class="pill-track">
        <span class="pill-text"><strong id="hud-timer">75</strong>s</span>
      </div>
    </div>

    <!-- Collected Bonus Stars -->
    <div class="hud-pill hud-stars-pill">
      <div class="badge-icon badge-star"></div>
      <div class="pill-track">
        <div id="hud-stars-fill" class="pill-fill gold-fill" style="width: 0%"></div>
        <span class="pill-text"><strong id="hud-stars">0</strong> / 6</span>
      </div>
    </div>

    <!-- Live Total Score -->
    <div class="hud-pill hud-score-pill">
      <div class="badge-icon badge-trophy"></div>
      <div class="pill-track">
        <span class="pill-text"><strong id="hud-score">0</strong></span>
      </div>
    </div>

    <!-- Pause / Audio Control -->
    <button id="btn-hud-pause" class="btn-circle-red" aria-label="Pause Game">
      <span class="icon-glyph">⏸️</span>
    </button>
  </header>

  <!-- ================= TRANSIENT TOASTS ================= -->
  <div id="toast-container" class="toast-container" aria-live="polite">
    <div id="delivery-toast" class="ribbon-toast hidden">
      <span id="delivery-toast-text">GIFT DELIVERED! +500</span>
    </div>
  </div>

  <!-- ================= MOBILE CONTROLS (Mobile Only) ================= -->
  <div id="mobile-controls-wrapper" class="mobile-controls-wrapper">
    <div id="joystick-zone">
      <div id="joystick-base">
        <div id="joystick-thumb"></div>
        <div class="joystick-arrows">▲ ▼ ◀ ▶</div>
      </div>
    </div>
  </div>

  <!-- ================= MAIN MENU SCREEN ================= -->
  <div id="screen-menu" class="screen-overlay visible">
    <div class="menu-crest">
      <div class="gift-topper"></div>
      <div class="ribbon-banner">
        <span class="snow-cap-top"></span>
        <h1 class="ribbon-title">SANTA'S DELIVERY</h1>
      </div>
    </div>
    <div class="menu-actions">
      <button id="btn-menu-play" class="btn-pill-red btn-play">
        <span class="btn-icon">▶</span>
      </button>
      <button id="btn-menu-instructions" class="btn-pill-navy btn-instructions">
        <span class="btn-icon">📖</span>
      </button>
    </div>
  </div>

  <!-- ================= INSTRUCTIONS OVERLAY ================= -->
  <div id="screen-instructions" class="screen-overlay hidden">
    <div class="card-parchment instructions-card">
      <div class="ribbon-banner sm">
        <h2 class="ribbon-title">FLIGHT GUIDE</h2>
      </div>
      <div class="instructions-body">
        <div class="instruction-row">
          <span class="inst-icon">✨</span>
          <p>Fly through the <strong>tall golden sky beacon</strong> above cottages to deliver gifts automatically.</p>
        </div>
        <div class="instruction-row">
          <span class="inst-icon">⭐</span>
          <p>Collect <strong>golden stars</strong> along your path for score bonuses.</p>
        </div>
        <div class="instruction-row desktop-only">
          <span class="inst-icon">⌨️</span>
          <p><strong>[W] / [S]</strong> Climb &amp; Dive &nbsp;|&nbsp; <strong>[A] / [D]</strong> Steer</p>
        </div>
        <div class="instruction-row mobile-only">
          <span class="inst-icon">🕹️</span>
          <p>Use the <strong>virtual flight joystick</strong> to steer and adjust altitude.</p>
        </div>
      </div>
      <button id="btn-close-instructions" class="btn-pill-red">GOT IT! ▶</button>
    </div>
  </div>

  <!-- ================= PARCHMENT RESULTS SCREEN ================= -->
  <div id="screen-results" class="screen-overlay hidden">
    <div class="card-parchment results-card">
      <div class="results-stars-crest" id="res-star-rating">
        <span class="star-star star-1">★</span>
        <span class="star-star star-2 center">★</span>
        <span class="star-star star-3">★</span>
      </div>
      <div class="ribbon-banner">
        <span class="snow-cap-top"></span>
        <h2 id="res-title" class="ribbon-title">DELIVERIES COMPLETE!</h2>
      </div>
      <div class="results-stats-list">
        <div class="stat-row">
          <span class="stat-badge badge-gift"></span>
          <span class="stat-label">Deliveries</span>
          <strong id="res-deliveries" class="stat-value">5 / 5</strong>
        </div>
        <div class="stat-row">
          <span class="stat-badge badge-clock"></span>
          <span class="stat-label">Time Remaining</span>
          <strong id="res-time" class="stat-value">28s (+280)</strong>
        </div>
        <div class="stat-row">
          <span class="stat-badge badge-star"></span>
          <span class="stat-label">Bonus Stars</span>
          <strong id="res-stars" class="stat-value">4 / 6 (+400)</strong>
        </div>
        <div class="stat-row stat-row-score">
          <span class="stat-badge badge-trophy"></span>
          <span class="stat-label">Final Score</span>
          <strong id="res-total-score" class="stat-value gold">3,180</strong>
        </div>
      </div>
      <div class="results-actions">
        <button id="btn-results-home" class="btn-circle-red" aria-label="Main Menu" title="Home">
          <span class="icon-glyph">⌂</span>
        </button>
        <button id="btn-results-replay" class="btn-circle-red" aria-label="Play Again" title="Play Again">
          <span class="icon-glyph">↻</span>
        </button>
      </div>
    </div>
  </div>

</div>
```

---

## 5. Responsive Adaptation Rules

### 5.1 Desktop Layout (16:9 Landscape)
- **Viewport Target:** 1920x1080, 1440x900, 1280x720 (and ultrawide 21:9).
- **Central Flight Clearance:** The center 65% width and 70% height of the screen is kept 100% free of UI chrome.
- **HUD Placement:**
  - `hud-top-bar`: Distributed along the top edge (`top: 18px`, `left: 24px`, `right: 24px`).
  - Flight controls: Handled exclusively via keyboard (`W`/`S`, `A`/`D`, `Space`/`G`).
  - Mobile touch joystick is hidden: `display: none !important`.
- **Modals & Results Card:**
  - Anchored centrally with `width: min(85vw, 440px)`.
  - Backdrop blur (`backdrop-filter: blur(8px)`) keeps the 3D village background softly visible.

### 5.2 Mobile Layout (Portrait-First with Safe Area Insets)
- **Viewport Target:** Modern mobile viewports (`390x844`, `414x896`, `360x780`) and dynamic heights (`height: 100dvh`).
- **Safe Area Inset Handling:**
  ```css
  .hud-top-bar {
    padding-top: calc(env(safe-area-inset-top, 0px) + 8px);
    padding-left: calc(env(safe-area-inset-left, 0px) + 12px);
    padding-right: calc(env(safe-area-inset-right, 0px) + 12px);
  }
  .mobile-controls-wrapper {
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
  }
  ```
- **HUD Scaling & Arrangement:**
  - On narrow viewports (`<480px`), HUD pills flex-wrap or scale to `0.88x` to prevent horizontal clipping.
  - Labels are condensed (icon + value).
- **Touch Flight Joystick:**
  - Anchored in the lower quarter of the screen.
  - Transparent dark slate base with glowing directional indicators and metallic thumbstick.
  - **No manual gift drop button** (gifts drop automatically when flying through beacon per R1 & R3).
  - Center 55% of portrait screen remains completely unobstructed for cottage beacon alignment.

---

## 6. Implementation Guidance & Handover Points

For the developer agent implementing this system:
1. **Clean Decoupling with `UIManager.js`:**
   - Create a dedicated `UIManager` class in `src/ui/UIManager.js` (or `src/gameplay/UIManager.js`).
   - `DeliverySystem.js` already contains hook points (`this.uiManager.updateHUD`, `this.uiManager.showResults`, `this.uiManager.showDeliveryToast`, `this.uiManager.setGuidance`).
   - Wire the 75s countdown timer inside `UIManager` or `DeliverySystem` so that when `timeRemaining <= 0`, it triggers `_finishRun(false, 'timeout')`.
2. **Timer Urgency Trigger:**
   - Add a listener/check at 15 seconds remaining to toggle the `.urgent` class on `#hud-timer-pill`.
3. **Sound Triggers:**
   - Connect button clicks and celebration banners to existing `soundManager` methods (`soundManager.play('delivery_success')`, `star_collect`, etc.).
4. **Preserve R1 Gameplay Rules:**
   - Do NOT modify `SleighController.js` flight physics.
   - Do NOT modify `DeliverySystem.js` beacon collision detection or 5-delivery logic.
   - Only replace the legacy UI rendering and bind the new festive components to the existing game events.
