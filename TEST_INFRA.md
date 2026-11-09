# E2E Test Infra: Santa's Gift Delivery UI Redesign

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation design.
- Derived strictly from `ORIGINAL_REQUEST.md` (Requirements R1 through R5).
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing across Desktop (16:9) and Mobile (Portrait 390x844).

## Feature Inventory & Test Coverage Matrix
Every feature from `PROJECT.md § Feature Inventory` is mapped to test tiers:

| # | Feature ID | Feature Name | Source | Tier 1 (Feature) | Tier 2 (Boundary) | Tier 3 (Cross) |
|---|---|---|---|:---:|:---:|:---:|
| 1 | F-PRESERVE-01 | Flight Physics & Aerodynamics | R1 | 5 | 5 | ✓ |
| 2 | F-PRESERVE-02 | Fly-Through Auto Delivery | R1, R2, R3 | 5 | 5 | ✓ |
| 3 | F-PRESERVE-03 | Target Beacon & Chimney Star | R1 | 5 | 5 | ✓ |
| 4 | F-PRESERVE-04 | Route Bonus Stars | R1 | 5 | 5 | ✓ |
| 5 | F-PRESERVE-05 | Off-Course Guiding Wind | R1, R4 | 5 | 5 | ✓ |
| 6 | F-PRESERVE-06 | 5-Delivery Run Goal | R1 | 5 | 5 | ✓ |
| 7 | F-PRESERVE-07 | 75s Countdown Timer | R1, R2 | 5 | 5 | ✓ |
| 8 | F-PRESERVE-08 | Audio & Debug Stats | R1 | 5 | 5 | ✓ |
| 9 | F-DESKTOP-01 | Desktop 16:9 Viewport Layout | R2 | 5 | 5 | ✓ |
| 10 | F-DESKTOP-02 | Desktop Keyboard Flight Controls | R2 | 5 | 5 | ✓ |
| 11 | F-DESKTOP-03 | Desktop Top HUD Bar | R2 | 5 | 5 | ✓ |
| 12 | F-DESKTOP-04 | Desktop Menus & Overlays | R2 | 5 | 5 | ✓ |
| 13 | F-MOBILE-01 | Mobile Portrait-First Layout | R3 | 5 | 5 | ✓ |
| 14 | F-MOBILE-02 | Mobile Dual-Axis Flight Joystick | R3 | 5 | 5 | ✓ |
| 15 | F-MOBILE-03 | Mobile Unobstructed Flight Center | R3 | 5 | 5 | ✓ |
| 16 | F-MOBILE-04 | No Mobile Manual Drop Button | R3 | 5 | 5 | ✓ |
| 17 | F-STYLE-01 | Festive Color System | R4 | 5 | 5 | ✓ |
| 18 | F-STYLE-02 | Reusable Modular Components | R4 | 5 | 5 | ✓ |
| 19 | F-STYLE-03 | Delivery Celebration Feedback | R4 | 5 | 5 | ✓ |
| 20 | F-STYLE-04 | Delivery Score & Combo Feedback | R4 | 5 | 5 | ✓ |
| 21 | F-STYLE-05 | Bonus-Star Pickup Feedback | R4 | 5 | 5 | ✓ |
| 22 | F-STYLE-06 | Timer Urgency Visual Feedback | R4 | 5 | 5 | ✓ |
| 23 | F-STYLE-07 | Target Proximity Feedback | R4 | 5 | 5 | ✓ |
| 24 | F-RESULTS-01 | Parchment Results Card | R5 | 5 | 5 | ✓ |
| 25 | F-RESULTS-02 | Results Deliveries Stat | R5 | 5 | 5 | ✓ |
| 26 | F-RESULTS-03 | Results Bonus Stars Stat | R5 | 5 | 5 | ✓ |
| 27 | F-RESULTS-04 | Results Points & Combo Stat | R5 | 5 | 5 | ✓ |
| 28 | F-RESULTS-05 | Results Remaining-Time Bonus | R5 | 5 | 5 | ✓ |
| 29 | F-RESULTS-06 | Results Total Score | R5 | 5 | 5 | ✓ |
| 30 | F-RESULTS-07 | Results 1-3 Star Rating | R5 | 5 | 5 | ✓ |
| 31 | F-RESULTS-08 | Results Navigation Controls | R5 | 5 | 5 | ✓ |

## Test Architecture
- **Location**: `tests/e2e/`
- **Execution Engine**: Headless browser automation script utilizing Node.js or `chrome-devtools-mcp` commands.
- **Test Runner Command**: `node tests/e2e/run_all_tests.mjs`
- **Pass/Fail Semantics**: Process exits with 0 on 100% pass, non-zero on any failure.
- **Artifacts**: Publishes `TEST_READY.md` upon completion.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|---|---|---|
| 1 | Full Desktop 5-Delivery Run | Desktop 16:9, Keyboard controls, Top HUD, fly-through auto-drop, 5 deliveries, Parchment Results, Play Again | High |
| 2 | Full Mobile Portrait Run | Mobile portrait safe areas, dual-axis joystick, unobstructed view, 5 deliveries, Parchment Results, Home | High |
| 3 | Countdown Timer Expiration Run | 75s countdown, <15s urgency pulsation, timeout game over, results display with 0 remaining-time bonus | Medium |
| 4 | Off-Course Guidance & Recovery | Sleigh steered off-course for >3.5s, stardust guiding wind emits, recovery to beacon, successful delivery | Medium |
| 5 | Bonus Stars & Combo Stacking | Rapid successive fly-through deliveries, combo multiplier stacking, bonus star pickup, score verification | High |

## Coverage Thresholds
- Tier 1: ≥5 per feature
- Tier 2: ≥5 per feature (where boundaries exist)
- Tier 3: Pairwise coverage of major feature interactions
- Tier 4: ≥5 realistic application scenarios
