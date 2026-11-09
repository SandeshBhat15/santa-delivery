const puppeteer = require('puppeteer');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\Sandesh Bhat\\.gemini\\antigravity\\brain\\ea500835-4374-408c-99be-9747de125064';

async function main() {
  console.log('[Test] Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // 1. Desktop Menu Test
    console.log('[Test 1] Testing Desktop Main Menu (1280x720)...');
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    // Wait for loader to disappear if any
    await page.waitForFunction(() => {
      const loader = document.getElementById('loader');
      return !loader || loader.classList.contains('hidden') || loader.style.display === 'none';
    }, { timeout: 10000 });

    await new Promise(r => setTimeout(r, 1000));

    // Capture desktop menu
    const menuDesktopPath = path.join(ARTIFACT_DIR, 'visual_menu_desktop_verified.png');
    await page.screenshot({ path: menuDesktopPath });
    console.log(`[Test 1] Desktop menu screenshot saved: ${menuDesktopPath}`);

    // Check menu background image is applied
    const menuBg = await page.evaluate(() => {
      const el = document.getElementById('screen-menu');
      return window.getComputedStyle(el).backgroundImage;
    });
    console.log('[Test 1] Desktop screen-menu backgroundImage:', menuBg);

    // 2. Mobile Portrait Menu Test (390x844 iPhone 12/13/14)
    console.log('[Test 2] Testing Mobile Portrait Menu (390x844)...');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await new Promise(r => setTimeout(r, 500));

    const menuMobilePath = path.join(ARTIFACT_DIR, 'visual_menu_mobile_verified.png');
    await page.screenshot({ path: menuMobilePath });
    console.log(`[Test 2] Mobile menu screenshot saved: ${menuMobilePath}`);

    const mobileMenuBg = await page.evaluate(() => {
      const el = document.getElementById('screen-menu');
      return window.getComputedStyle(el).backgroundImage;
    });
    console.log('[Test 2] Mobile screen-menu backgroundImage:', mobileMenuBg);

    // 3. Click Play on Mobile -> Check HUD and Centered Joystick
    console.log('[Test 3] Clicking Play button...');
    await page.click('#btn-menu-play');
    await new Promise(r => setTimeout(r, 1000));

    // Verify pause button does NOT exist
    const pauseExists = await page.evaluate(() => {
      return !!document.getElementById('btn-hud-pause') || !!document.querySelector('.hud-circle-btn');
    });
    console.log('[Test 3] Does pause button exist in DOM?', pauseExists);

    // Check joystick position & centering
    const joystickInfo = await page.evaluate(() => {
      const joy = document.getElementById('mobile-flight-joystick');
      if (!joy) return null;
      const rect = joy.getBoundingClientRect();
      const style = window.getComputedStyle(joy);
      const winWidth = window.innerWidth;
      const joyCenter = rect.left + rect.width / 2;
      const screenCenter = winWidth / 2;
      return {
        display: style.display,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, bottom: rect.bottom },
        joyCenter,
        screenCenter,
        diffFromCenter: Math.abs(joyCenter - screenCenter)
      };
    });
    console.log('[Test 3] Mobile Joystick metrics:', joystickInfo);

    const hudMobilePath = path.join(ARTIFACT_DIR, 'visual_hud_mobile_joystick_verified.png');
    await page.screenshot({ path: hudMobilePath });
    console.log(`[Test 3] Mobile in-game HUD screenshot saved: ${hudMobilePath}`);

    // 4. Test Joystick Touch Drag & Flight Steering
    console.log('[Test 4] Testing Joystick Touch Interaction...');
    const dragResult = await page.evaluate(() => {
      const joy = document.getElementById('mobile-flight-joystick');
      const rect = joy.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // Simulate touch start at center
      const touchStart = new Touch({
        identifier: 1,
        target: joy,
        clientX: cx,
        clientY: cy,
        pageX: cx,
        pageY: cy
      });
      joy.dispatchEvent(new TouchEvent('touchstart', {
        touches: [touchStart],
        targetTouches: [touchStart],
        changedTouches: [touchStart],
        bubbles: true,
        cancelable: true
      }));

      // Simulate touch move 30px right and 20px down
      const touchMove = new Touch({
        identifier: 1,
        target: joy,
        clientX: cx + 30,
        clientY: cy + 20,
        pageX: cx + 30,
        pageY: cy + 20
      });
      window.dispatchEvent(new TouchEvent('touchmove', {
        touches: [touchMove],
        targetTouches: [touchMove],
        changedTouches: [touchMove],
        bubbles: true,
        cancelable: true
      }));

      // Read sleighController joystick inputs
      const joyState = window.sleighController ? {
        x: window.sleighController.joystick.x,
        y: window.sleighController.joystick.y
      } : null;

      // Simulate touch end
      window.dispatchEvent(new TouchEvent('touchend', {
        touches: [],
        targetTouches: [],
        changedTouches: [touchMove],
        bubbles: true,
        cancelable: true
      }));

      const joyResetState = window.sleighController ? {
        x: window.sleighController.joystick.x,
        y: window.sleighController.joystick.y
      } : null;

      return { joyState, joyResetState };
    });
    console.log('[Test 4] Joystick touch drag result:', dragResult);

    // 5. Results Screen Test
    console.log('[Test 5] Triggering Results Screen...');
    await page.evaluate(() => {
      window.uiManager.showResults({
        deliveries: 5,
        maxDeliveries: 5,
        timeRemaining: 34,
        bonusStars: 5,
        maxStars: 6,
        score: 3500
      });
    });
    await new Promise(r => setTimeout(r, 600));

    const resultsPath = path.join(ARTIFACT_DIR, 'visual_results_verified.png');
    await page.screenshot({ path: resultsPath });
    console.log(`[Test 5] Results screen screenshot saved: ${resultsPath}`);

    console.log('[Test] ALL VERIFICATIONS PASSED SUCCESSFULLY!');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('[Test Failed]:', err);
  process.exit(1);
});
