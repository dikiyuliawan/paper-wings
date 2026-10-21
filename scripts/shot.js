/**
 * Dev helper: takes a screenshot of the running game.
 *   node scripts/shot.js [outfile] [width] [height] [state]
 * state: ready | playing | over
 */
import { chromium, devices } from '@playwright/test';

const out = process.argv[2] || 'shot.png';
const width = Number(process.argv[3] || 390);
const height = Number(process.argv[4] || 844);
const state = process.argv[5] || 'ready';
const url = process.env.URL || 'http://localhost:5188/';

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: width < 600,
});
const page = await context.newPage();
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

if (state !== 'ready') {
  await page.evaluate(() => {
    // A tiny bot so the screenshots show a realistic game in progress.
    const g = window.__flappy.game;
    const cfg = g.config;
    const lift = (cfg.bird.flapVelocity ** 2) / (2 * cfg.bird.gravity);
    window.__bot = setInterval(() => {
      const bird = g.bird;
      let target = g.startY();
      for (const p of g.pipes) {
        if (!p.scored && p.x + p.width > g.birdX - 2) {
          target = p.center;
          break;
        }
      }
      const flapHeight = target + lift / 2;
      if (bird.y > g.groundY - 60) {
        window.__flappy.flap();
        return;
      }
      const peak = bird.vy < 0 ? bird.y - (bird.vy * bird.vy) / (2 * cfg.bird.gravity) : bird.y;
      if (peak > flapHeight + 4 || (bird.vy >= 0 && bird.y >= flapHeight - 4)) {
        window.__flappy.flap();
      }
    }, 16);
    window.__flappy.restart();
  });
  await page.waitForTimeout(Number(process.env.WAIT || 2500));
  if (state === 'over') {
    await page.evaluate(() => {
      clearInterval(window.__bot);
      window.__flappy.kill();
    });
    await page.waitForTimeout(400);
  }
}

await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
