/**
 * Dev helper: measures the frame rate under different conditions.
 *   node scripts/perf.js
 */
import { chromium } from '@playwright/test';

const url = process.env.URL || 'http://localhost:47821/';
const browser = await chromium.launch({ channel: 'chrome' });

async function measure(label, { width, height, dsf, throttle, mute, bot }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__flappy));

  if (mute) {
    await page.evaluate(() => {
      window.__flappy.game.onEvent = null;
      document.getElementById('btn-sound').click();
    });
  }
  if (bot) {
    await page.evaluate(() => {
      const g = window.__flappy.game;
      const cfg = g.config;
      const lift = (cfg.bird.flapVelocity ** 2) / (2 * cfg.bird.gravity);
      window.__bot = setInterval(() => {
        const bird = g.bird;
        if (g.state === 'ready') { window.__flappy.flap(); return; }
        if (g.state !== 'playing') return;
        let target = g.startY();
        for (const p of g.pipes) {
          if (!p.scored && p.x + p.width > g.birdX - 2) { target = p.center; break; }
        }
        const flapHeight = target + lift / 2;
        if (bird.y > g.groundY - 60) { window.__flappy.flap(); return; }
        const peak = bird.vy < 0 ? bird.y - (bird.vy * bird.vy) / (2 * cfg.bird.gravity) : bird.y;
        if (peak > flapHeight + 4 || (bird.vy >= 0 && bird.y >= flapHeight - 4)) window.__flappy.flap();
      }, 16);
    });
  } else {
    await page.evaluate(() => window.__flappy.restart());
  }

  if (throttle) {
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }

  const stats = await page.evaluate(() => new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const start = last;
    function tick(now) {
      deltas.push(now - last);
      last = now;
      if (now - start < 2500) requestAnimationFrame(tick);
      else {
        const sorted = [...deltas].sort((a, b) => a - b);
        resolve({
          fps: 1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length),
          p95: sorted[Math.floor(sorted.length * 0.95)],
          worst: sorted[sorted.length - 1],
          work: window.__flappy.perf().work,
          avgWork: window.__flappy.perf().averageWork,
          quality: window.__flappy.perf().qualityFactor,
          dpr: window.__flappy.perf().dpr,
        });
      }
    }
    requestAnimationFrame(tick);
  }));

  console.log(label, JSON.stringify(stats));
  await context.close();
}

await measure('desktop 1280x720 dpr1      ', { width: 1280, height: 720, dsf: 1 });
await measure('desktop 1280x720 dpr1 bot  ', { width: 1280, height: 720, dsf: 1, bot: true });
await measure('mobile  390x844  dpr3      ', { width: 390, height: 844, dsf: 3 });
await measure('mobile  390x844  dpr3 bot  ', { width: 390, height: 844, dsf: 3, bot: true });
await measure('mobile  390x844  dpr3 t4   ', { width: 390, height: 844, dsf: 3, throttle: 4, bot: true });
await measure('mobile  390x844  dpr3 t6   ', { width: 390, height: 844, dsf: 3, throttle: 6, bot: true });
await measure('desktop 1280x720 dpr1 t4   ', { width: 1280, height: 720, dsf: 1, throttle: 4, bot: true });

await browser.close();
