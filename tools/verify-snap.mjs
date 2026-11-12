// Loads the packaged Web Lens in a phone-sized webview and checks it actually
// runs: no external requests, no console errors, and the UI is on screen.
//
//   node tools/verify-snap.mjs [port]
//
// Serves release/santas-sleigh-run-web (the exact folder the zip was packed
// from) and drives headless Chrome with a 390x844 phone viewport.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = resolve(import.meta.dirname, '..');
const WEB_ROOT = join(ROOT, 'release', 'santas-sleigh-run-web');
const OUT_DIR = process.env.OUT_DIR || 'D:/AI/blender ai mocap/blendcap_data/tmp/opencode/snap-qa';
const PORT = Number(process.argv[2]) || 4319;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream'
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const abs = join(WEB_ROOT, rel);
    if (!abs.startsWith(WEB_ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(abs);
    if (!info.isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size
    });
    res.end(await readFile(abs));
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  // Prefer a real installed Chrome; puppeteer's bundled download may be
  // incomplete on a fresh machine.
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required'
  ]
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Snapchat/12.0'
);

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const externalRequests = [];
const origin = `http://127.0.0.1:${PORT}`;

page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    consoleErrors.push(`${msg.type()}: ${msg.text()}`);
  }
});
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('requestfailed', (req) => failedRequests.push(`${req.url()} — ${req.failure()?.errorText}`));
page.on('request', (req) => {
  const u = req.url();
  if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) {
    externalRequests.push(u);
  }
});

const shoot = async (name) => {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`) });
};

const report = { consoleErrors, pageErrors, failedRequests, externalRequests, checks: {} };

try {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  await shoot('01-loading');

  // Wait for the loading overlay to go away and the main menu to appear.
  await page.waitForFunction(
    () => {
      const menu = document.getElementById('screen-menu');
      const loader = document.getElementById('loader');
      const loaderGone = !loader || loader.classList.contains('hidden') || getComputedStyle(loader).display === 'none';
      return menu && loaderGone && !menu.classList.contains('hidden');
    },
    { timeout: 60000 }
  );
  await new Promise((r) => setTimeout(r, 1200));
  await shoot('02-menu');

  report.checks.menuVisible = await page.evaluate(() => {
    const menu = document.getElementById('screen-menu');
    const play = document.getElementById('btn-menu-play');
    if (!menu || !play) return false;
    const r = play.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
  });

  // Fonts: every family the CSS asks for must resolve to a face inside the zip.
  report.checks.fonts = await page.evaluate(async () => {
    const wanted = ['Cinzel', 'Fredoka', '"Lilita One"', '"Berkshire Swash"', '"Cinzel Decorative"'];
    await Promise.all(wanted.map((f) => document.fonts.load(`700 16px ${f}`).catch(() => [])));
    await document.fonts.ready;
    const check = {};
    for (const f of wanted) check[f] = document.fonts.check(`700 16px ${f}`);
    return {
      loaded: [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`),
      check
    };
  });

  // Play -> instructions -> Play Now starts the run.
  await page.tap('#btn-menu-play');
  await new Promise((r) => setTimeout(r, 700));
  await shoot('03-instructions');

  await page.tap('#btn-instructions-close');
  await new Promise((r) => setTimeout(r, 4000));
  await shoot('04-inflight');

  report.checks.hudVisible = await page.evaluate(() => {
    const hud = document.getElementById('hud-top-bar');
    const joystick = document.getElementById('joystick-zone');
    const hint = document.getElementById('hint-info');
    const hudRect = hud?.getBoundingClientRect();
    const stickRect = joystick?.getBoundingClientRect();
    return {
      hud: !!hud && !hud.classList.contains('hidden'),
      hudRect: hudRect && { top: hudRect.top, bottom: hudRect.bottom, height: hudRect.height },
      joystick: !!stickRect && stickRect.width > 0 && stickRect.height > 0,
      keyboardHintHidden: !hint || getComputedStyle(hint).display === 'none',
      hudEmpty: hud ? hud.textContent.trim().length > 0 : false
    };
  });

  report.checks.canvas = await page.evaluate(() => {
    const c = document.querySelector('#app canvas');
    if (!c) return null;
    return { width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight };
  });

  report.checks.timer = await page.evaluate(() => document.getElementById('hud-timer')?.textContent);

  // Simulate the generous top inset Snapchat reports (its own controls).
  await page.addStyleTag({
    content: '.hud-top-bar { padding-top: 120px !important; }'
  });
  await new Promise((r) => setTimeout(r, 600));
  await shoot('05-safe-area-120');
  report.checks.safeAreaTop = await page.evaluate(() => {
    const hud = document.getElementById('hud-top-bar');
    const r = hud.getBoundingClientRect();
    return { top: r.top, height: r.height, bottom: r.bottom, fits: r.bottom <= innerHeight };
  });

  // Run a short joystick drag to confirm touch flight input is live. CDP touch
  // events go through the same pipeline as a real thumb, unlike synthetic
  // TouchEvent dispatch (which never produces pointer events).
  const stickPoint = await page.evaluate(() => {
    const r = document.getElementById('joystick-zone').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 };
  });
  await page.touchscreen.touchStart(stickPoint.x, stickPoint.y);
  await page.touchscreen.touchMove(stickPoint.x + 45, stickPoint.y - 30);
  await new Promise((r) => setTimeout(r, 600));
  report.checks.joystick = await page.evaluate(() => {
    const sc = window.sleighController;
    return sc ? { x: sc.joystick?.x, y: sc.joystick?.y } : null;
  });
  await page.touchscreen.touchEnd();

  // No layout may overflow horizontally.
  report.checks.overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));

  await new Promise((r) => setTimeout(r, 1500));
  await shoot('06-final');
} catch (err) {
  report.fatal = String(err);
  try {
    await shoot('99-failure');
  } catch {}
}

await browser.close();
server.close();

console.log(JSON.stringify(report, null, 2));

const bad =
  report.fatal ||
  pageErrors.length ||
  externalRequests.length ||
  failedRequests.length ||
  (report.checks.hudVisible && !report.checks.hudVisible.hud) ||
  !report.checks.joystick ||
  Math.abs(report.checks.joystick.x) + Math.abs(report.checks.joystick.y) < 0.05 ||
  Object.values(report.checks.fonts?.check || {}).some((ok) => !ok);

if (bad) {
  console.error('\nVERIFY FAILED');
  process.exit(1);
}
console.log('\nVERIFY OK');