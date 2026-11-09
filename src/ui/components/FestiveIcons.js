/**
 * Festive holiday SVG and DOM markup generators.
 * All graphics are resolution-independent SVGs with editable text overlays.
 */

export const FestiveIcons = {
  /**
   * 3D Gift Box Crest with gold cross-ribbon and emerald holly leaves
   */
  giftCrest(size = 48) {
    return `
      <svg class="icon-gift-crest" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="crestGiftRed" x1="16" y1="22" x2="48" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#E52E42"/>
            <stop offset="40%" stop-color="#D61F33"/>
            <stop offset="85%" stop-color="#A31126"/>
            <stop offset="100%" stop-color="#5C0713"/>
          </linearGradient>
          <linearGradient id="crestGoldRibbon" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#FFF0A3"/>
            <stop offset="45%" stop-color="#FFC727"/>
            <stop offset="85%" stop-color="#B87B08"/>
            <stop offset="100%" stop-color="#6B4202"/>
          </linearGradient>
          <linearGradient id="crestHollyGreen" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#2ECC71"/>
            <stop offset="50%" stop-color="#1B7A43"/>
            <stop offset="100%" stop-color="#0E4726"/>
          </linearGradient>
          <filter id="crestGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.45"/>
          </filter>
        </defs>

        <!-- Holly Leaves behind gift -->
        <g class="holly-leaves">
          <!-- Left Holly Leaf -->
          <path d="M18 20 C10 14, 4 22, 10 30 C12 33, 16 32, 20 28 Z" fill="url(#crestHollyGreen)" stroke="#FFD152" stroke-width="0.75"/>
          <!-- Right Holly Leaf -->
          <path d="M46 20 C54 14, 60 22, 54 30 C52 33, 48 32, 44 28 Z" fill="url(#crestHollyGreen)" stroke="#FFD152" stroke-width="0.75"/>
        </g>

        <!-- Gift Box Body with shadow -->
        <g filter="url(#crestGlow)">
          <rect x="16" y="24" width="32" height="32" rx="4" fill="url(#crestGiftRed)" stroke="#B87B08" stroke-width="1.5"/>
          <!-- Box Lid -->
          <rect x="14" y="20" width="36" height="8" rx="2" fill="url(#crestGiftRed)" stroke="#FFE680" stroke-width="1"/>
          
          <!-- Vertical Gold Ribbon -->
          <rect x="28" y="20" width="8" height="36" fill="url(#crestGoldRibbon)"/>
          <line x1="32" y1="20" x2="32" y2="56" stroke="#FFF0A3" stroke-width="0.8"/>
          
          <!-- Horizontal Gold Ribbon on Box Body -->
          <rect x="16" y="36" width="32" height="8" fill="url(#crestGoldRibbon)"/>
          <line x1="16" y1="40" x2="48" y2="40" stroke="#FFF0A3" stroke-width="0.8"/>

          <!-- Ribbon Bow Loops -->
          <path d="M32 20 C24 8, 14 12, 22 20 C26 21, 30 20, 32 20 Z" fill="url(#crestGoldRibbon)" stroke="#FFE680" stroke-width="0.75"/>
          <path d="M32 20 C40 8, 50 12, 42 20 C38 21, 34 20, 32 20 Z" fill="url(#crestGoldRibbon)" stroke="#FFE680" stroke-width="0.75"/>
          <!-- Bow Knot -->
          <circle cx="32" cy="20" r="3.5" fill="#FFE680" stroke="#B87B08" stroke-width="1"/>
        </g>
      </svg>
    `;
  },

  /**
   * 5-Pointed Multi-Faceted Golden Star
   */
  star(size = 28, filled = true) {
    const opacity = filled ? '1.0' : '0.28';
    return `
      <svg class="icon-star ${filled ? 'filled' : 'unfilled'}" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="opacity: ${opacity};">
        <defs>
          <linearGradient id="starGoldLight" x1="16" y1="2" x2="16" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#FFF8D6"/>
            <stop offset="40%" stop-color="#FFC727"/>
            <stop offset="100%" stop-color="#B87B08"/>
          </linearGradient>
          <linearGradient id="starGoldDark" x1="16" y1="2" x2="16" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#FFC727"/>
            <stop offset="60%" stop-color="#B87B08"/>
            <stop offset="100%" stop-color="#6B4202"/>
          </linearGradient>
        </defs>
        <!-- Star Base Shadow -->
        <polygon points="16,2 20,12 31,12 22,19 25,30 16,23 7,30 10,19 1,12 12,12" fill="url(#starGoldLight)" stroke="#5C3B02" stroke-width="1" stroke-linejoin="round"/>
        <!-- Star Facet Highlights (Left halves lighter, right halves darker for 3D bevel effect) -->
        <polygon points="16,2 16,23 7,30 10,19 1,12 12,12" fill="url(#starGoldLight)" opacity="0.9"/>
        <polygon points="16,2 16,23 25,30 22,19 31,12 20,12" fill="url(#starGoldDark)" opacity="0.8"/>
      </svg>
    `;
  },

  /**
   * Stopwatch / Clock Icon
   */
  clock(size = 24) {
    return `
      <svg class="icon-clock" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="13" r="8" fill="#A31126" stroke="#FFC727" stroke-width="2"/>
        <path d="M12 9V13L15 15" stroke="#FFE680" stroke-width="2" stroke-linecap="round"/>
        <path d="M10 2H14" stroke="#FFC727" stroke-width="2" stroke-linecap="round"/>
        <line x1="12" y1="2" x2="12" y2="5" stroke="#FFC727" stroke-width="2"/>
      </svg>
    `;
  },

  /**
   * Trophy Icon for Score
   */
  trophy(size = 24) {
    return `
      <svg class="icon-trophy" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M6 4H18V9C18 12.3 15.3 15 12 15C8.7 15 6 12.3 6 9V4Z" fill="#FFC727" stroke="#FFE680" stroke-width="1.5"/>
        <path d="M6 6H3C2.4 6 2 6.4 2 7V8C2 9.7 3.3 11 5 11H6.2" stroke="#FFC727" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M18 6H21C21.6 6 22 6.4 22 7V8C22 9.7 20.7 11 19 11H17.8" stroke="#FFC727" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M10 15V19H14V15" stroke="#FFC727" stroke-width="1.5"/>
        <rect x="8" y="19" width="8" height="3" rx="1" fill="#B87B08" stroke="#FFE680" stroke-width="1"/>
      </svg>
    `;
  },

  /**
   * Pause Button Glyphs
   */
  pause(size = 20) {
    return `
      <svg class="icon-pause" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="6" y="4" width="4" height="16" rx="2" fill="#FFEAA7"/>
        <rect x="14" y="4" width="4" height="16" rx="2" fill="#FFEAA7"/>
      </svg>
    `;
  },

  /**
   * Play Triangle Glyphs
   */
  play(size = 22) {
    return `
      <svg class="icon-play" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polygon points="6,3 21,12 6,21" fill="#FFEAA7" stroke="#FFC727" stroke-width="1.2" stroke-linejoin="round"/>
      </svg>
    `;
  },

  /**
   * Replay / Refresh circular arrow glyph
   */
  replay(size = 24) {
    return `
      <svg class="icon-replay" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#FFEAA7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </svg>
    `;
  },

  /**
   * Home Cottage Glyph
   */
  home(size = 24) {
    return `
      <svg class="icon-home" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#FFEAA7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M3 10L12 3L21 10V20C21 20.6 20.6 21 20 21H4C3.4 21 3 20.6 3 20V10Z" fill="#FFEAA7" fill-opacity="0.15"/>
        <polyline points="9 21 9 13 15 13 15 21"></polyline>
      </svg>
    `;
  },

  /**
   * Open Book Instructions Glyph
   */
  book(size = 22) {
    return `
      <svg class="icon-book" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#FFEAA7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
      </svg>
    `;
  },

  /**
   * 6-Pointed Snowflake Ornament
   */
  snowflake(size = 24) {
    return `
      <svg class="icon-snowflake" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <line x1="12" y1="2" x2="12" y2="22"></line>
        <line x1="3.34" y1="7" x2="20.66" y2="17"></line>
        <line x1="3.34" y1="17" x2="20.66" y2="7"></line>
        <polyline points="10 4 12 2 14 4"></polyline>
        <polyline points="10 20 12 22 14 20"></polyline>
        <polyline points="5.5 8.5 3.34 7 4.5 4.5"></polyline>
        <polyline points="18.5 15.5 20.66 17 19.5 19.5"></polyline>
        <polyline points="5.5 15.5 3.34 17 4.5 19.5"></polyline>
        <polyline points="18.5 8.5 20.66 7 19.5 4.5"></polyline>
      </svg>
    `;
  },

  /**
   * Fluffy Snow Cap SVG that drapes over ribbon banners or card shoulders
   */
  snowCapTop() {
    return `
      <svg class="snow-cap-svg" viewBox="0 0 320 28" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="snowGrad" x1="0" y1="0" x2="0" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#FFFFFF"/>
            <stop offset="70%" stop-color="#EDF6FF"/>
            <stop offset="100%" stop-color="#C5DCF4"/>
          </linearGradient>
          <filter id="snowShadow" x="-5%" y="-5%" width="110%" height="130%">
            <feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="#081735" flood-opacity="0.35"/>
          </filter>
        </defs>
        <path d="M0 16 C 18 16, 26 24, 44 24 C 62 24, 70 17, 88 17 C 106 17, 114 26, 132 26 C 150 26, 158 15, 176 15 C 194 15, 202 24, 220 24 C 238 24, 246 16, 264 16 C 282 16, 298 25, 320 18 L 320 0 L 0 0 Z" fill="url(#snowGrad)" filter="url(#snowShadow)"/>
      </svg>
    `;
  }
};
