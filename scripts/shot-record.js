/**
 * Dev helper: screenshots the start screen with a record on it.
 *   node scripts/shot-record.js
 */
import { chromium } from '@playwright/test';
import { CONFIG } from '../src/config.js';

const url = process.env.URL || 'http://localhost:47821/';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean(window.__flappy));

// Pretend a record was set a few hours ago.
await page.evaluate(() => {
  const game = window.__flappy.game;
  game.best = 27;
  game.recordAt = Date.now() - 3 * 60 * 60 * 1000;
  localStorage.setItem(CONFIG.storage.best, JSON.stringify({ score: 27, at: game.recordAt }));
});
await page.reload();
await page.waitForFunction(() => Boolean(window.__flappy));
await page.waitForTimeout(300);
await page.screenshot({ path: process.argv[2] || 'shot-record.png' });
console.log('saved');
await browser.close();
