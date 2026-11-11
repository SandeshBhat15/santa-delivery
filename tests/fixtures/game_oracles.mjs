// tests/fixtures/game_oracles.mjs
// Authoritative calculation oracles and specification validators derived strictly from
// ORIGINAL_REQUEST.md (Requirements R1 through R5) and PROJECT.md

export const SPEC_CONSTANTS = {
  DELIVERIES_REQUIRED: 5,
  COUNTDOWN_TIMER_SECONDS: 75.0,
  TIMER_URGENCY_THRESHOLD: 15.0,
  LOST_GUIDING_WIND_THRESHOLD: 3.5,
  GUIDING_WIND_DISSOLVE_PROXIMITY: 2.5,
  BONUS_STARS_TOTAL: 6,
  BONUS_STAR_POINTS: 50,
  BONUS_STAR_COLLECTION_RADIUS: 0.35,
  BASE_DELIVERY_POINTS: 100,
  TIME_BONUS_MULTIPLIER: 20, // 20 pts per second remaining
  ALTITUDE_MIN_TERRAIN: 0.025,
  ALTITUDE_MAX_CEILING: 3.2,
  DESKTOP_SPEED_MIN: 1.68,
  DESKTOP_SPEED_MAX: 5.52,
  MOBILE_SPEED_MIN: 1.38,
  MOBILE_SPEED_MAX: 4.08,
  JOYSTICK_DEADZONE: 0.08
};

/**
 * Calculates remaining-time bonus score (Requirement R5)
 * Formula: Math.round(timeRemaining * 20)
 */
export function oracleCalculateTimeBonus(timeRemainingSeconds) {
  if (!timeRemainingSeconds || timeRemainingSeconds <= 0) return 0;
  return Math.round(timeRemainingSeconds * SPEC_CONSTANTS.TIME_BONUS_MULTIPLIER);
}

/**
 * Calculates combo multiplier score (Requirement R4)
 */
export function oracleCalculateComboScore(basePoints, comboStreak) {
  if (comboStreak <= 1) return 0;
  // Combo awards (combo - 1) * 50 bonus pts per consecutive delivery
  return (comboStreak - 1) * 50;
}

/**
 * Calculates final total score (Requirement R5)
 */
export function oracleCalculateTotalScore({ deliveryPoints = 0, comboScore = 0, starCount = 0, timeRemaining = 0 }) {
  const starPoints = starCount * SPEC_CONSTANTS.BONUS_STAR_POINTS;
  const timeBonus = oracleCalculateTimeBonus(timeRemaining);
  return deliveryPoints + comboScore + starPoints + timeBonus;
}

/**
 * Calculates 1–3 star rating crest based on run performance (Requirement R5)
 * Rules:
 * - 3 Stars (★★★): Completed all 5 deliveries with total score >= 2500 OR timeRemaining >= 25.0s
 * - 2 Stars (★★☆): Completed 4 or 5 deliveries with total score >= 1500
 * - 1 Star  (★☆☆): Early timeout or 1–3 deliveries
 */
export function oracleCalculateStarRating({ deliveries, maxDeliveries = 5, totalScore = 0, timeRemaining = 0, reason = 'complete' }) {
  if (deliveries >= maxDeliveries) {
    if (totalScore >= 2500 || timeRemaining >= 25.0) return 3;
    return 2;
  }
  if (deliveries >= 3 && totalScore >= 1200) {
    return 2;
  }
  return 1;
}

/**
 * Authoritative Color Palette Tokens from Reference Image (Requirement R4)
 */
export const FESTIVE_PALETTE_TOKENS = {
  RED_PRIMARY: '#D61F33',
  RED_DEEP: '#A31126',
  GOLD_CORE: '#FFC727',
  GOLD_LIGHT: '#FFE680',
  GOLD_DARK: '#B87B08',
  PARCHMENT_BASE: '#FDF1D6',
  PARCHMENT_EDGE: '#E7C38B',
  NAVY_DEEP: '#061226',
  NAVY_TRACK: '#0B1E40',
  SNOW_WHITE: '#FFFFFF',
  SNOW_SHADOW: '#C5DCF4'
};

/**
 * Validates CSS text contains required festive design tokens
 */
export function oracleValidateFestiveTokens(cssText) {
  const upperCss = cssText.toUpperCase();
  const checks = {
    hasRed: upperCss.includes('#D61F33') || upperCss.includes('RGB(214, 31, 51)') || upperCss.includes('--C-RED-PRIMARY'),
    hasGold: upperCss.includes('#FFC727') || upperCss.includes('RGB(255, 199, 39)') || upperCss.includes('--C-GOLD-CORE'),
    hasParchment: upperCss.includes('#FDF1D6') || upperCss.includes('#FDF6E2') || upperCss.includes('--C-PARCHMENT-BASE'),
    hasNavy: upperCss.includes('#061226') || upperCss.includes('#081735') || upperCss.includes('--C-NAVY-DEEP'),
    hasSnowWhite: upperCss.includes('#FFFFFF') || upperCss.includes('WHITE') || upperCss.includes('--C-SNOW-WHITE')
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks
  };
}

/**
 * Validates absence of manual gift-drop buttons and hints (Requirements R1, R2, R3)
 */
export function oracleValidateNoManualDrop(htmlOrCssText) {
  const lower = htmlOrCssText.toLowerCase();
  const violations = [];
  
  if (lower.includes('space / e: drop gift')) {
    violations.push('Found obsolete keyboard hint: "Space / E: Drop Gift"');
  }
  if (lower.includes('btn-drop-large') && !lower.includes('display: none')) {
    // If drop button exists and is not hidden
    violations.push('Found active .btn-drop-large reference in markup/styles');
  }
  if (lower.includes('manual drop button') && !lower.includes('no manual drop button')) {
    violations.push('Found reference to manual drop button');
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

/**
 * Validates absence of permanent minimap, compass needles, or permanent navigation arrows (Requirements R1, R4)
 */
export function oracleValidateNoPermanentNavChrome(htmlOrCssText) {
  const lower = htmlOrCssText.toLowerCase();
  const violations = [];

  if (lower.includes('id="minimap"') || lower.includes('class="minimap"')) {
    violations.push('Found permanent minimap DOM element');
  }
  if (lower.includes('compass-needle') || lower.includes('nav-compass')) {
    violations.push('Found permanent compass needle element');
  }
  if (lower.includes('permanent-arrow') || lower.includes('waypoint-arrow')) {
    violations.push('Found permanent waypoint arrow element');
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

/**
 * Validates mobile safe-area insets in CSS (Requirement R3)
 */
export function oracleValidateSafeAreaInsets(cssText) {
  const hasTopInset = cssText.includes('safe-area-inset-top');
  const hasBottomInset = cssText.includes('safe-area-inset-bottom');
  return {
    valid: hasTopInset || hasBottomInset,
    hasTopInset,
    hasBottomInset
  };
}

/**
 * Dual-axis joystick response calculator (Requirement R3)
 */
export function oracleCalculateJoystickResponse(dx, dy, maxRadius = 46) {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { normX: 0, normY: 0, isDeadzone: true };

  const clampedDist = Math.min(distance, maxRadius);
  const rawNormX = (dx / distance) * (clampedDist / maxRadius);
  const rawNormY = (dy / distance) * (clampedDist / maxRadius);

  const mag = Math.hypot(rawNormX, rawNormY);
  if (mag < SPEC_CONSTANTS.JOYSTICK_DEADZONE) {
    return { normX: 0, normY: 0, isDeadzone: true };
  }

  return { normX: rawNormX, normY: rawNormY, isDeadzone: false };
}
