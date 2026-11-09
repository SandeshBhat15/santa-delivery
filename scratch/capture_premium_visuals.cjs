const puppeteer = require('puppeteer');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\Sandesh Bhat\\.gemini\\antigravity\\brain\\ea500835-4374-408c-99be-9747de125064';

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // 1. DESKTOP 16:9 VIEWPORT (1280x720)
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5173/?perf=0', { waitUntil: 'networkidle2' });

  // Wait for loader to disappear and menu to appear
  await page.waitForFunction(() => {
    const menu = document.getElementById('screen-menu');
    return menu && menu.classList.contains('visible') && !menu.classList.contains('hidden');
  }, { timeout: 15000 });

  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_desktop_menu_premium.png') });
  console.log('Captured visual_desktop_menu_premium.png');

  // 2. INSTRUCTIONS SCREEN
  await page.evaluate(() => {
    window.uiManager.showScreen('instructions');
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_instructions_premium.png') });
  console.log('Captured visual_instructions_premium.png');

  // 3. IN-FLIGHT HUD (DESKTOP)
  await page.evaluate(() => {
    window.uiManager.showScreen('hud');
    window.uiManager.updateHUD({
      deliveries: 3,
      maxDeliveries: 5,
      stars: 4,
      maxStars: 6,
      score: 1850
    });
    window.uiManager.updateTimerDisplay(48);
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_desktop_hud_premium.png') });
  console.log('Captured visual_desktop_hud_premium.png');

  // 4. RESULTS SCREEN (3-STAR COMPLETION)
  await page.evaluate(() => {
    window.uiManager.showResults({
      deliveries: 5,
      stars: 5,
      score: 3450,
      timeRemaining: 32,
      reason: 'complete'
    });
  });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_results_premium.png') });
  console.log('Captured visual_results_premium.png');

  // 5. MOBILE PORTRAIT (390x844 - iPhone 14 / modern Android)
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluate(() => {
    window.uiManager.showScreen('menu');
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_mobile_menu_premium.png') });
  console.log('Captured visual_mobile_menu_premium.png');

  // 6. MOBILE PORTRAIT FLIGHT HUD WITH JOYSTICK
  await page.evaluate(() => {
    window.uiManager.showScreen('hud');
    window.uiManager.updateHUD({
      deliveries: 2,
      maxDeliveries: 5,
      stars: 3,
      maxStars: 6,
      score: 1200
    });
    window.uiManager.updateTimerDisplay(14); // Trigger urgent timer pulse
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_mobile_hud_premium.png') });
  console.log('Captured visual_mobile_hud_premium.png');

  await browser.close();
  console.log('All visual screenshots captured successfully!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
