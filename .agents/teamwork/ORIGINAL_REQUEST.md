# Original User Request

## Approved Task Prompt — 2026-11-08T05:21:52Z

Redesign the existing Santa's Gift Delivery game UI for desktop and mobile devices following the authoritative gameplay specifications and festive visual style reference.

Working directory: d:\Sandesh\Personal Work\Antigravity Projects\Santa Delivery
Integrity mode: development

Attached UI reference: C:/Users/Sandesh Bhat/.gemini/antigravity/brain/ea500835-4374-408c-99be-9747de125064/.user_uploaded/media_1794114967133_ffcac50a.jpg

## Requirements

### R1. Gameplay Rules and Core System Preservation
Preserve the existing flight physics, automatic delivery logic, environment, camera, target beacon, chimney star, particle guidance, automatic gift dropping, scoring, and performance debug statistics.
- 5 successful chimney deliveries per run.
- 75-second countdown timer.
- Gifts automatically drop when Santa flies through the active target beacon; no manual gift-drop button.
- The active target cottage displays a tall golden sky beacon and a floating star emblem above its chimney.
- Optional golden bonus stars appear along the route and can be collected for extra points.
- A subtle golden particle flow guides the player when off-course.
- Do not rebuild gameplay or introduce new mechanics.

### R2. Desktop UI Layout
Implement a responsive 16:9 layout tailored for desktop keyboard flight controls.
- Keyboard flight controls only; no on-screen joystick or manual drop button.
- Minimal top HUD displaying deliveries (out of 5), countdown timer (starting at 75s), collected bonus stars, and score.
- Keep the central flight and gameplay view unobstructed.
- Include main menu, loading screen, instructions overlay, delivery feedback, and results screen.

### R3. Mobile UI Layout
Implement a portrait-first responsive layout with safe area handling.
- Compact HUD at the top positioned within device safe areas.
- Dual-axis flight joystick for steering and altitude control following the existing mobile control implementation and positioning.
- No manual gift-drop button.
- Screen center remains clear for flying and target visibility.
- Ensure the joystick does not interfere with camera tracking or browser gestures.

### R4. Visual Design and Feedback Components
Apply the festive red, gold, cream, snowy blue, and navy visual style from the reference image.
- Create separate reusable UI components and assets; do not flatten the reference into a single image. Keep all text and numbers editable, using text-free decorative assets where possible.
- Show a brief delivery celebration when a chimney delivery succeeds.
- Display delivery score and combo feedback without obscuring gameplay.
- Display subtle bonus-star pickup feedback.
- Provide restrained visual urgency feedback on the timer when under 15 seconds.
- Provide minimal proximity feedback when approaching the target beacon.
- Do not add permanent navigation arrows, minimaps, or extra target markers.

### R5. Results Screen
Create a parchment-style results panel displaying:
- Successful deliveries out of 5.
- Bonus stars collected.
- Delivery points and combo score.
- Remaining-time bonus.
- Total score.
- Final 1–3 star rating.
- Play Again and Home controls.

## Acceptance Criteria

### Desktop Layout & Flight Controls
- [ ] Responsive 16:9 layout displays correctly across standard desktop resolutions with an unobstructed central flight view.
- [ ] Keyboard controls handle steering and altitude without displaying touch controls or manual gift-drop buttons.
- [ ] Main menu, loading screen, instructions overlay, top HUD, and results screen are fully functional and accessible on desktop.
- [ ] Desktop HUD displays delivery progress (X/5), countdown timer (starting at 75s), collected bonus stars, and current score.

### Mobile Layout & Flight Controls
- [ ] Portrait-first responsive layout renders cleanly within mobile viewport and device safe areas.
- [ ] Dual-axis touch joystick enables steering and altitude adjustment without triggering page scrolls, gesture conflicts, or camera tracking hitches.
- [ ] No manual gift-drop button is rendered on mobile.
- [ ] Center of the mobile screen remains unobstructed for target identification and navigation.

### Gameplay Delivery Loop & Feedback
- [ ] Run completes when 5 successful deliveries are achieved or when the 75-second countdown expires.
- [ ] Flying through the active target cottage beacon automatically drops a gift and registers a successful delivery.
- [ ] Active target cottage displays both the tall golden sky beacon and the chimney floating star emblem.
- [ ] Bonus stars along the flight path are collectable and update star count and score.
- [ ] Off-course particle flow guides the player without permanent HUD minimaps, compass needles, or permanent navigation arrows.
- [ ] Successful delivery celebration, combo score notifications, and bonus-star pickups appear briefly without obstructing flight.
- [ ] Countdown timer visually signals urgency when remaining time drops below 15 seconds.

### Visual Styling & Component Modularity
- [ ] Color scheme strictly reflects the reference palette (festive red, gold, cream, snowy blue, navy).
- [ ] UI elements are built as separate reusable DOM/component modules; no full-screen flattened graphic asset is used for UI layouts.
- [ ] All UI labels, counters, timers, and scores are rendered as editable text/numbers.
- [ ] Parchment-style results screen displays: deliveries (out of 5), bonus stars, delivery/combo points, time bonus, total score, 1–3 star rating, and functioning Play Again and Home buttons.

## Verification Resources
- Local Vite/web development server in the repository for interactive testing across desktop and mobile viewport emulations.
- Validation walkthrough: full 5-delivery run, timer countdown expiration, off-course guidance check, and results screen score calculation review.
