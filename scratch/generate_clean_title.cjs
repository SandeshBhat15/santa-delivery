const fs = require('fs');
const path = require('path');

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 270" width="100%" height="auto">
  <defs>
    <!-- Gradients -->
    <linearGradient id="puffyWhite" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="55%" stop-color="#FFFFFF" />
      <stop offset="85%" stop-color="#F0F6FF" />
      <stop offset="100%" stop-color="#D2E3F8" />
    </linearGradient>

    <linearGradient id="redRibbon" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FF3850" />
      <stop offset="25%" stop-color="#E8172E" />
      <stop offset="70%" stop-color="#B30B1E" />
      <stop offset="100%" stop-color="#6E040E" />
    </linearGradient>

    <linearGradient id="ribbonTailGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#BF0F22" />
      <stop offset="100%" stop-color="#4F030B" />
    </linearGradient>

    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFAD9" />
      <stop offset="25%" stop-color="#FFD747" />
      <stop offset="65%" stop-color="#F29E02" />
      <stop offset="100%" stop-color="#B36F00" />
    </linearGradient>

    <linearGradient id="goldTextGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFDF2" />
      <stop offset="30%" stop-color="#FFE76B" />
      <stop offset="65%" stop-color="#FFAE11" />
      <stop offset="100%" stop-color="#D47300" />
    </linearGradient>

    <linearGradient id="giftRed" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF4D63" />
      <stop offset="60%" stop-color="#D6152B" />
      <stop offset="100%" stop-color="#800613" />
    </linearGradient>

    <linearGradient id="santaHatRed" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF4055" />
      <stop offset="50%" stop-color="#DB1228" />
      <stop offset="100%" stop-color="#840614" />
    </linearGradient>

    <filter id="titleShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#000000" flood-opacity="0.7" />
    </filter>

    <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="14" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <g filter="url(#titleShadow)">
    <!-- Golden Warm Backlight Halo -->
    <ellipse cx="270" cy="135" rx="210" ry="85" fill="#FFC827" opacity="0.16" />

    <!-- ==================== 1. RIBBON TAILS (BEHIND) ==================== -->
    <!-- Left Tail -->
    <path d="M 72 170 L 18 206 L 72 220 L 22 250 L 110 220 Z" fill="url(#ribbonTailGrad)" stroke="#B87B08" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M 72 170 L 110 220 L 98 174 Z" fill="#380206" opacity="0.85" />

    <!-- Right Tail -->
    <path d="M 468 170 L 522 206 L 468 220 L 518 250 L 430 220 Z" fill="url(#ribbonTailGrad)" stroke="#B87B08" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M 468 170 L 430 220 L 442 174 Z" fill="#380206" opacity="0.85" />

    <!-- ==================== 2. MAIN CURVED RIBBON BODY ==================== -->
    <!-- Outer Gold Border of Main Ribbon -->
    <path d="M 76 172 Q 270 142 464 172 C 476 195 464 232 452 236 Q 270 206 88 236 C 76 232 64 195 76 172 Z"
          fill="url(#redRibbon)" stroke="url(#goldGrad)" stroke-width="5" stroke-linejoin="round" />

    <!-- Inner Gold Inset Lines -->
    <path d="M 82 178 Q 270 148 458 178" fill="none" stroke="#FFE97D" stroke-width="2" opacity="0.9" />
    <path d="M 94 230 Q 270 200 446 230" fill="none" stroke="#FFE97D" stroke-width="2" opacity="0.9" />

    <!-- Snow Drifts on Ribbon Top -->
    <!-- Left snow bank -->
    <path d="M 70 174 Q 80 160 96 163 Q 112 157 130 165 Q 148 159 164 167 Q 120 174 76 174 Z" fill="#FFFFFF" opacity="0.96" />
    <!-- Right snow bank -->
    <path d="M 470 174 Q 460 160 444 163 Q 428 157 410 165 Q 392 159 376 167 Q 420 174 464 174 Z" fill="#FFFFFF" opacity="0.96" />

    <!-- ==================== 3. "SANTA'S" 3D PUFFY TEXT ==================== -->
    <g>
      <!-- Deep 3D Shadow -->
      <text x="270" y="116" text-anchor="middle"
            font-family="'Lilita One', 'Fredoka', cursive, sans-serif" font-size="86" font-weight="900"
            letter-spacing="2" fill="#380206" stroke="#380206" stroke-width="16" stroke-linejoin="round">SANTA'S</text>

      <!-- Crimson Outer Stroke -->
      <text x="270" y="112" text-anchor="middle"
            font-family="'Lilita One', 'Fredoka', cursive, sans-serif" font-size="86" font-weight="900"
            letter-spacing="2" fill="#840A18" stroke="#840A18" stroke-width="12" stroke-linejoin="round">SANTA'S</text>

      <!-- Golden Border -->
      <text x="270" y="110" text-anchor="middle"
            font-family="'Lilita One', 'Fredoka', cursive, sans-serif" font-size="86" font-weight="900"
            letter-spacing="2" fill="#FFD747" stroke="#FFD747" stroke-width="6" stroke-linejoin="round">SANTA'S</text>

      <!-- White Puffy Face with Ice Shading -->
      <text x="270" y="108" text-anchor="middle"
            font-family="'Lilita One', 'Fredoka', cursive, sans-serif" font-size="86" font-weight="900"
            letter-spacing="2" fill="url(#puffyWhite)">SANTA'S</text>
    </g>

    <!-- ==================== 4. SANTA HAT ON 'S' ==================== -->
    <g transform="translate(68, 22) rotate(-16)">
      <!-- Hat Red Body -->
      <path d="M 16 58 C 22 30 48 12 76 8 C 92 24 82 48 54 60 Z" fill="url(#santaHatRed)" stroke="#52030B" stroke-width="2.5" />
      <path d="M 28 54 C 36 34 56 22 72 15" fill="none" stroke="#FF7E8F" stroke-width="2.5" opacity="0.75" />
      <!-- Pompom -->
      <circle cx="82" cy="9" r="11" fill="#FFFFFF" stroke="#CCD8E8" stroke-width="2" />
      <circle cx="80" cy="7" r="4" fill="#FFFFFF" />
      <!-- White Fur Trim Band -->
      <rect x="10" y="56" width="54" height="17" rx="8.5" fill="#FFFFFF" stroke="#C4D6EB" stroke-width="2" />
      <!-- Puffs -->
      <circle cx="18" cy="64" r="7" fill="#FFFFFF" />
      <circle cx="32" cy="65" r="8" fill="#FFFFFF" />
      <circle cx="48" cy="64" r="7" fill="#FFFFFF" />
    </g>

    <!-- Starlight Twinkles on "SANTA'S" -->
    <path d="M 124 58 Q 124 72 110 72 Q 124 72 124 86 Q 124 72 138 72 Q 124 72 124 58 Z" fill="#FFFCE6" />
    <path d="M 400 50 Q 400 62 388 62 Q 400 62 400 74 Q 400 62 412 62 Q 400 62 400 50 Z" fill="#FFFCE6" />

    <!-- ==================== 5. "GIFT DELIVERY" RIBBON TEXT ==================== -->
    <g>
      <!-- Ribbon Text 3D Cast Shadow -->
      <text x="270" y="210" text-anchor="middle"
            font-family="'Lilita One', 'Fredoka', cursive, sans-serif" font-size="38" font-weight="900"
            letter-spacing="2.5" fill="#3D0308" stroke="#3D0308" stroke-width="5" stroke-linejoin="round">GIFT DELIVERY</text>

      <!-- Ribbon Text Dark Rim -->
      <text x="270" y="208" text-anchor="middle"
            font-family="'Lilita One', 'Fredoka', cursive, sans-serif" font-size="38" font-weight="900"
            letter-spacing="2.5" fill="#6B0610" stroke="#6B0610" stroke-width="3" stroke-linejoin="round">GIFT DELIVERY</text>

      <!-- Ribbon Text Golden Face -->
      <text x="270" y="207" text-anchor="middle"
            font-family="'Lilita One', 'Fredoka', cursive, sans-serif" font-size="38" font-weight="900"
            letter-spacing="2.5" fill="url(#goldTextGrad)">GIFT DELIVERY</text>
    </g>

    <!-- Little Gold Starlight Pin at Ribbon Center Bottom -->
    <polygon points="270,230 274,239 284,240 276,247 278,256 270,251 262,256 264,247 256,240 266,239" fill="#FFE875" stroke="#B87B08" stroke-width="1.2" />

  </g>
</svg>`;

const outPath = path.join(__dirname, '..', 'public', 'assets', 'ui', 'title_santa_delivery.svg');
fs.writeFileSync(outPath, svgContent.trim());
console.log('Saved enhanced title emblem at:', outPath);
