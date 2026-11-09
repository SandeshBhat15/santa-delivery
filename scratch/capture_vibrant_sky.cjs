const puppeteer = require('puppeteer');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\Sandesh Bhat\\.gemini\\antigravity\\brain\\ea500835-4374-408c-99be-9747de125064';

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // 1. Desktop Menu
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    await page.waitForFunction(() => {
      const loader = document.getElementById('loader');
      return !loader || loader.classList.contains('hidden') || loader.style.display === 'none';
    }, { timeout: 15000 });

    await new Promise(r => setTimeout(r, 1200));

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_vibrant_sky_desktop_menu.png') });
    console.log('Saved visual_vibrant_sky_desktop_menu.png');

    // 2. Click Play -> In-Flight HUD Desktop
    await page.click('#btn-menu-play');
    await new Promise(r => setTimeout(r, 1500));

    // Tilt camera slightly up to showcase vibrant purple sky and aurora
    await page.evaluate(() => {
      if (window.sleighController) {
        window.sleighController.setJoystickInput(0, -0.6); // pitch up to look higher into the purple sky
      }
    });
    await new Promise(r => setTimeout(r, 800));

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_vibrant_sky_desktop_flight.png') });
    console.log('Saved visual_vibrant_sky_desktop_flight.png');

    // Reset joystick
    await page.evaluate(() => {
      if (window.sleighController) window.sleighController.setJoystickInput(0, 0);
    });

    // 3. Mobile Portrait (390x844)
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await mobilePage.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    await mobilePage.waitForFunction(() => {
      const loader = document.getElementById('loader');
      return !loader || loader.classList.contains('hidden') || loader.style.display === 'none';
    }, { timeout: 15000 });

    await new Promise(r => setTimeout(r, 1200));

    await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_vibrant_sky_mobile_menu.png') });
    console.log('Saved visual_vibrant_sky_mobile_menu.png');

    // 4. Mobile Play -> In-Flight HUD
    await mobilePage.click('#btn-menu-play');
    await new Promise(r => setTimeout(r, 1500));

    await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_vibrant_sky_mobile_flight.png') });
    console.log('Saved visual_vibrant_sky_mobile_flight.png');

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
