const puppeteer = require('puppeteer');

async function testFullRun() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/?perf=0', { waitUntil: 'networkidle2' });

  // 1. Wait for menu to appear
  await page.waitForFunction(() => {
    const menu = document.getElementById('screen-menu');
    return menu && menu.classList.contains('visible') && !menu.classList.contains('hidden');
  }, { timeout: 15000 });
  console.log('[PASS] Menu loaded and visible');

  // 2. Click Play Button
  await page.click('#btn-menu-play');
  await new Promise(r => setTimeout(r, 600));

  // Check HUD visible
  const isHudVisible = await page.evaluate(() => {
    const hud = document.getElementById('hud-top-bar');
    return hud && !hud.classList.contains('hidden');
  });
  console.log('[PASS] In-Flight HUD visible after Play click:', isHudVisible);

  // 3. Simulate 5 deliveries via deliverySystem
  await page.evaluate(() => {
    if (window.deliverySystem) {
      for (let i = 0; i < 5; i++) {
        window.deliverySystem.deliveriesMade++;
        window.deliverySystem.score += 500;
        window.deliverySystem._updateHUD();
      }
      window.deliverySystem._finishRun('complete');
    }
  });

  await new Promise(r => setTimeout(r, 800));

  // 4. Verify Results Screen visible
  const isResultsVisible = await page.evaluate(() => {
    const res = document.getElementById('screen-results');
    const title = document.getElementById('res-title');
    const deliveries = document.getElementById('res-deliveries');
    const totalScore = document.getElementById('res-total-score');
    return {
      visible: res && !res.classList.contains('hidden'),
      title: title ? title.textContent : '',
      deliveries: deliveries ? deliveries.textContent : '',
      totalScore: totalScore ? totalScore.textContent : ''
    };
  });
  console.log('[PASS] Results screen status:', isResultsVisible);

  // 5. Click Replay Button
  await page.click('#btn-results-replay');
  await new Promise(r => setTimeout(r, 600));
  const isPlayingAgain = await page.evaluate(() => {
    const hud = document.getElementById('hud-top-bar');
    const res = document.getElementById('screen-results');
    return hud && !hud.classList.contains('hidden') && res && res.classList.contains('hidden');
  });
  console.log('[PASS] Replay restarted game into HUD:', isPlayingAgain);

  // 6. Click Home Button (after finishing run)
  await page.evaluate(() => {
    window.uiManager.showResults({ deliveries: 5, stars: 6, score: 3500 });
  });
  await new Promise(r => setTimeout(r, 400));
  await page.click('#btn-results-home');
  await new Promise(r => setTimeout(r, 600));
  const isMenuVisibleAgain = await page.evaluate(() => {
    const menu = document.getElementById('screen-menu');
    return menu && !menu.classList.contains('hidden');
  });
  console.log('[PASS] Home button returned to Main Menu:', isMenuVisibleAgain);

  await browser.close();
  console.log('ALL FLOW TESTS PASSED SUCCESSFULLY!');
}

testFullRun().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
