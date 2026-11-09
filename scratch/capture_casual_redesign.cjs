const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  console.log('Navigating to http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
  await page.waitForTimeout ? page.waitForTimeout(2000) : new Promise(r => setTimeout(r, 2000));

  // 1. Desktop Main Menu
  const artDir = 'C:/Users/Sandesh Bhat/.gemini/antigravity/brain/ea500835-4374-408c-99be-9747de125064';
  await page.screenshot({ path: path.join(artDir, 'visual_casual_desktop_menu.png') });
  console.log('Desktop menu captured.');

  // 2. Open Instructions Modal
  await page.click('#btn-menu-instructions');
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artDir, 'visual_casual_instructions.png') });
  console.log('Instructions captured.');

  // Close Instructions and Click Play
  await page.click('#btn-instructions-close');
  await new Promise(r => setTimeout(r, 1500));

  // 3. Desktop Flight HUD
  await page.screenshot({ path: path.join(artDir, 'visual_casual_desktop_flight.png') });
  console.log('Desktop flight HUD captured.');

  // 4. Trigger Toast to test Toast design
  await page.evaluate(() => {
    if (window.uiManager) {
      window.uiManager.showDeliveryToast(750);
    }
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artDir, 'visual_casual_desktop_toast.png') });
  console.log('Desktop toast captured.');

  // 5. Results Screen
  await page.evaluate(() => {
    if (window.uiManager) {
      window.uiManager.showResults({
        deliveries: 5,
        targetDeliveries: 5,
        timeRemaining: 35,
        stars: 6,
        targetStars: 6,
        score: 8750
      });
    }
  });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(artDir, 'visual_casual_results.png') });
  console.log('Results captured.');

  // 6. Mobile Portrait
  const mobilePage = await browser.newPage();
  await mobilePage.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
  await mobilePage.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  await mobilePage.screenshot({ path: path.join(artDir, 'visual_casual_mobile_menu.png') });
  console.log('Mobile menu captured.');

  // Start mobile flight
  await mobilePage.click('#btn-menu-play');
  await new Promise(r => setTimeout(r, 1500));

  await mobilePage.screenshot({ path: path.join(artDir, 'visual_casual_mobile_flight.png') });
  console.log('Mobile flight captured.');

  await browser.close();
  console.log('All casual UI captures completed successfully.');
})();
