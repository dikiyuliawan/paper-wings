import { chromium, expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  measureFrames,
  readState,
  recordFlaps,
  simulateHidden,
  startBot,
  stopAtGameTime,
  summarise,
  useVirtualClock,
  waitForScore,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__flappy));
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#game')).toBeVisible();
  // make sure the canvas has been laid out before any input is sent
  await page.waitForFunction(() => {
    const canvas = document.getElementById('game');
    return canvas.width > 0 && canvas.height > 0;
  });
});

// ------------------------------------------------------------------ input

test('space starts the game and never scrolls the page', async ({ page }) => {
  const states = await recordFlaps(page);
  await page.keyboard.press('Space');
  expect(await states()).toContain('playing');

  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Space');
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.body.scrollHeight <= window.innerHeight + 1)).toBe(true);
});

test('space lifts the bird', async ({ page }) => {
  const before = await page.evaluate(() => window.__flappy.game.flaps);
  const states = await recordFlaps(page);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__flappy.game.flaps)).toBe(before + 1);
  expect(await states()).toContain('playing');
});

test('a mouse click lifts the bird', async ({ page }) => {
  const before = await page.evaluate(() => window.__flappy.game.flaps);
  const states = await recordFlaps(page);
  await page.mouse.click(120, 300);
  expect(await page.evaluate(() => window.__flappy.game.flaps)).toBe(before + 1);
  expect(await states()).toContain('playing');
});

test('a tap lifts the bird', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, 'this project has no touch support');
  const before = await page.evaluate(() => window.__flappy.game.flaps);
  const states = await recordFlaps(page);
  await page.touchscreen.tap(160, 320);
  expect(await page.evaluate(() => window.__flappy.game.flaps)).toBe(before + 1);
  expect(await states()).toContain('playing');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

// -------------------------------------------------------------- game flow

test('the game over screen appears and restarts instantly', async ({ page }) => {
  const states = await recordFlaps(page);
  await page.keyboard.press('Space');
  expect(await states()).toContain('playing');

  await page.evaluate(() => window.__flappy.kill());
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'gameover');
  await expect(page.locator('[data-panel="gameover"]')).toBeVisible();
  await expect(page.locator('#final-score')).toHaveText('0');

  const started = Date.now();
  await page.keyboard.press('Space');
  // the restart happens inside the key press, so the game is already running
  // again by the time the browser tells us about it
  expect(await states()).toContain('playing');
  expect(Date.now() - started).toBeLessThan(5000);
  expect(await page.evaluate(() => window.__flappy.score)).toBe(0);
});

test('ten restarts in a row all work', async ({ page }) => {
  const states = await recordFlaps(page);
  for (let round = 0; round < 10; round += 1) {
    await page.keyboard.press('Space');
    expect(await states()).toContain('playing');
    await page.evaluate(() => window.__flappy.kill());
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'gameover');
  }
  await page.keyboard.press('Space');
  expect(await states()).toContain('playing');
  expect(await page.evaluate(() => window.__flappy.score)).toBe(0);
  expect(await page.evaluate(() => window.__flappy.game.pipesPassed)).toBe(0);
});

test('the pause button pauses and resumes', async ({ page }) => {
  const stop = await startBot(page);
  await page.waitForFunction(() => window.__flappy.state === 'playing');

  await page.locator('#btn-pause').click();
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('[data-panel="paused"]')).toBeVisible();

  const y = await page.evaluate(() => window.__flappy.game.bird.y);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__flappy.game.bird.y)).toBe(y);

  await page.keyboard.press('Space');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'playing');
  await stop();
});

test('losing focus pauses the game and the clock stops', async ({ page }) => {
  const stop = await startBot(page);
  await page.waitForFunction(() => window.__flappy.state === 'playing');

  await simulateHidden(page, true);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'paused');

  const time = await page.evaluate(() => window.__flappy.game.time);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__flappy.game.time)).toBe(time);

  await simulateHidden(page, false);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'paused');
  await page.keyboard.press('Space');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'playing');
  await stop();
});

test('a long stall does not kill the bird', async ({ page }) => {
  const stop = await startBot(page);
  await page.waitForFunction(() => window.__flappy.state === 'playing', null, { timeout: 20_000 });

  const result = await page.evaluate(() => {
    const game = window.__flappy.game;
    const before = { time: game.time, y: game.bird.y };
    // pretend the tab was in the background for half a minute
    game.advance(30);
    return {
      before,
      after: { time: game.time, y: game.bird.y },
      state: game.state,
    };
  });
  // the simulation must not jump forward by the length of the stall
  expect(result.after.time - result.before.time).toBeLessThan(0.3);
  expect(result.after.y - result.before.y).toBeLessThan(60);
  expect(result.state).toBe('playing');
  await stop();
});

// ------------------------------------------------------------------ score

test('the score goes up and the best score is remembered', async ({ page }) => {
  const stop = await startBot(page);
  await waitForScore(page, 2, 45_000);
  // freeze the run so the score cannot change while we read it
  const score = await page.evaluate(() => {
    window.__flappy.game.pause();
    return Number(document.getElementById('score').textContent);
  });
  await stop();
  expect(score).toBeGreaterThanOrEqual(2);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__flappy));
  await expect(page.locator('#best')).toHaveText(String(score));
  expect(await page.evaluate(() => window.__flappy.best)).toBe(score);
});

test('every column only ever scores once', async ({ page }) => {
  const stop = await startBot(page);
  await waitForScore(page, 3, 45_000);
  const result = await page.evaluate(() => {
    const game = window.__flappy.game;
    const scored = game.pipes.filter((p) => p.scored).length;
    return { score: game.score, scored, passed: game.pipesPassed };
  });
  await stop();
  expect(result.score).toBe(result.passed);
  expect(result.scored).toBeLessThanOrEqual(result.score);
});

test('a new best is announced', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__flappy));

  const stop = await startBot(page);
  await waitForScore(page, 1, 45_000);
  await page.evaluate(() => window.__flappy.kill());
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'gameover');
  await expect(page.locator('#new-best')).toBeVisible();
  await stop();
});

test('the best score in the corner updates as soon as you score', async ({ page }) => {
  await expect(page.locator('#best')).toHaveText('0');

  const stop = await startBot(page);
  await waitForScore(page, 1, 45_000);

  // The corner has to show the new record straight away, without a reload.
  await expect(page.locator('#best')).toHaveText('1');
  await stop();
});

test('the start screen shows the record and when it was set', async ({ page }) => {
  const stop = await startBot(page);
  await waitForScore(page, 1, 45_000);
  await page.evaluate(() => window.__flappy.game.pause());
  await stop();

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__flappy));
  await expect(page.locator('#record-note')).toBeVisible();
  await expect(page.locator('#record-score')).toHaveText('1');
  await expect(page.locator('#record-age')).toContainText(/just now|ago/);
});

test('the record survives closing the browser', async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperwings-'));
  try {
    const first = await chromium.launchPersistentContext(userDataDir, { channel: 'chrome' });
    const page = first.pages()[0] ?? (await first.newPage());
    await page.goto(baseURL);
    await page.waitForFunction(() => Boolean(window.__flappy));
    await page.evaluate(() => {
      const game = window.__flappy.game;
      game.restart();
      game.pipes = [{
        x: game.birdX - 100,
        width: game.config.pipes.width,
        gap: 200,
        center: game.bird.y,
        scored: false,
      }];
      game.update(1 / 120);
    });
    await page.waitForFunction(() => window.__flappy.best === 1);
    await first.close();

    // Reopen the browser with the same profile: the record has to be there.
    const second = await chromium.launchPersistentContext(userDataDir, { channel: 'chrome' });
    const reopened = second.pages()[0] ?? (await second.newPage());
    await reopened.goto(baseURL);
    await reopened.waitForFunction(() => Boolean(window.__flappy));
    expect(await reopened.evaluate(() => window.__flappy.best)).toBe(1);
    expect(await reopened.evaluate(() => window.__flappy.game.recordAt)).toBeGreaterThan(0);
    await second.close();
  } finally {
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------- collision

test('hitting the ground ends the run', async ({ page }) => {
  const state = await page.evaluate(() => {
    const game = window.__flappy.game;
    game.restart();
    game.bird.y = game.groundY + 5;
    game.update(1 / 120);
    return game.state;
  });
  expect(state).toBe('gameover');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'gameover');
});

test('hitting a column ends the run', async ({ page }) => {
  const state = await page.evaluate(() => {
    const game = window.__flappy.game;
    game.restart();
    game.pipes = [{
      x: game.birdX - 4,
      width: game.config.pipes.width,
      gap: 60,
      center: game.bird.y - 200,
      scored: false,
    }];
    game.update(1 / 120);
    return game.state;
  });
  expect(state).toBe('gameover');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'gameover');
});

test('the hitbox is forgiving', async ({ page }) => {
  const alive = await page.evaluate(() => {
    const game = window.__flappy.game;
    game.restart();
    game.pipes = [{
      x: game.birdX + game.config.bird.radius - 2,
      width: game.config.pipes.width,
      gap: 200,
      center: game.bird.y + 60,
      scored: false,
    }];
    game.update(1 / 120);
    return game.state;
  });
  expect(alive).toBe('playing');
});

// --------------------------------------------------------------- options

test('the sound can be muted and the choice is remembered', async ({ page }) => {
  await page.locator('#btn-sound').click();
  await expect(page.locator('#btn-sound')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__flappy));
  await expect(page.locator('#btn-sound')).toHaveAttribute('aria-pressed', 'true');
});

test('reduced motion removes the screen shake and the feathers', async ({ page }) => {
  await page.locator('#btn-motion').click();
  await expect(page.locator('#btn-motion')).toHaveAttribute('aria-pressed', 'true');

  const result = await page.evaluate(() => {
    const game = window.__flappy.game;
    game.restart();
    game.bird.y = game.groundY;
    game.update(1 / 120);
    return { state: game.state, feathers: game.feathers.length };
  });
  expect(result.state).toBe('gameover');
  expect(result.feathers).toBe(0);
});

test('a crash without reduced motion scatters feathers', async ({ page }) => {
  const result = await page.evaluate(() => {
    const game = window.__flappy.game;
    game.restart();
    game.bird.y = game.groundY;
    game.update(1 / 120);
    return { state: game.state, feathers: game.feathers.length };
  });
  expect(result.state).toBe('gameover');
  expect(result.feathers).toBeGreaterThan(0);
});

// ----------------------------------------------------------------- layout

test('the canvas fills the window and stays sharp on high dpi screens', async ({ page }) => {
  const info = await page.evaluate(() => {
    const canvas = document.getElementById('game');
    const rect = canvas.getBoundingClientRect();
    return {
      cssWidth: rect.width,
      cssHeight: rect.height,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      dpr: window.devicePixelRatio,
    };
  });
  expect(info.cssWidth).toBeGreaterThan(100);
  expect(Math.abs(info.cssWidth - info.bufferWidth / info.dpr)).toBeLessThanOrEqual(1);
  expect(Math.abs(info.cssHeight - info.bufferHeight / info.dpr)).toBeLessThanOrEqual(1);
});

test('the game survives a resize in the middle of a run', async ({ page }) => {
  const stop = await startBot(page);
  await page.waitForFunction(() => window.__flappy.state === 'playing');

  await page.setViewportSize({ width: 900, height: 500 });
  await page.waitForTimeout(400);
  expect(await readState(page)).toBe('playing');

  const info = await page.evaluate(() => {
    const canvas = document.getElementById('game');
    const rect = canvas.getBoundingClientRect();
    return {
      cssWidth: rect.width,
      cssHeight: rect.height,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      dpr: window.devicePixelRatio,
    };
  });
  expect(Math.abs(info.cssWidth - info.bufferWidth / info.dpr)).toBeLessThanOrEqual(1);
  expect(Math.abs(info.cssHeight - info.bufferHeight / info.dpr)).toBeLessThanOrEqual(1);
  await stop();
});

test('there is no horizontal overflow on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  await page.keyboard.press('Space');
  expect(await readState(page)).toBe('playing');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__flappy.game.pipes.length)).toBeGreaterThan(0);
});

// ------------------------------------------------------------ frame rates

test('the simulation is identical at 30 and 144 frames per second', async ({ page }) => {
  // No input: the bird simply falls. After the same amount of game time the
  // bird has to be in exactly the same place, whatever the frame rate is.
  const run = async (fps, frameCount) => {
    const fresh = await page.context().newPage();
    await useVirtualClock(fresh, fps, false);
    await fresh.goto('/');
    await fresh.waitForFunction(() => Boolean(window.__flappy));
    await stopAtGameTime(fresh, 0.3);
    const state = await fresh.evaluate(() => ({
      score: window.__flappy.score,
      time: window.__flappy.game.time,
      y: window.__flappy.game.bird.y,
      vy: window.__flappy.game.bird.vy,
      pipes: window.__flappy.game.pipesPassed,
      frames: window.__flappy.perf().frames,
    }));
    await fresh.close();
    return state;
  };

  const slow = await run(30, 10);
  const fast = await run(144, 48);
  // eslint-disable-next-line no-console
  console.log('30fps:', JSON.stringify(slow), '144fps:', JSON.stringify(fast));

  expect(Math.abs(slow.time - fast.time)).toBeLessThan(0.01);
  expect(Math.abs(slow.y - fast.y)).toBeLessThan(0.001);
  expect(Math.abs(slow.vy - fast.vy)).toBeLessThan(0.001);
  expect(slow.score).toBe(fast.score);
  expect(slow.pipes).toBe(fast.pipes);
});
// ------------------------------------------------------------ performance

test('the game stays smooth on a slow phone', async ({ page }) => {
  const stop = await startBot(page);
  await page.waitForFunction(() => window.__flappy.state === 'playing');

  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // let the average settle, then look at the cost of a game frame
  await page.waitForTimeout(1500);
  const perf = await page.evaluate(() => window.__flappy.perf());
  const frames = summarise(await measureFrames(page, 2000));
  // eslint-disable-next-line no-console
  console.log('4x throttle:', JSON.stringify({ ...perf, ...frames }));

  // The game must fit inside a 60fps budget even on a throttled phone.
  // The median is used because a busy machine can produce a few slow frames.
  // In practice this sits around 0.5-2ms.
  expect(perf.medianWork).toBeLessThan(16);
  // ... and it must still be playable.
  expect(await page.evaluate(() => window.__flappy.game.pipesPassed)).toBeGreaterThan(0);
  await stop();
});

test('the frame cost stays low on a high dpi phone', async ({ page }) => {
  const stop = await startBot(page);
  await page.waitForFunction(() => window.__flappy.state === 'playing');
  await page.waitForTimeout(1200);
  const perf = await page.evaluate(() => window.__flappy.perf());
  // eslint-disable-next-line no-console
  console.log('mobile frame cost:', JSON.stringify(perf));
  expect(perf.medianWork).toBeLessThan(8);
  await stop();
});