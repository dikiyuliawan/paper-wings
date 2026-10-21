/**
 * Shared helpers for the browser tests.
 */

/**
 * Starts the same hover-bot the unit tests use, so the game can be played
 * from a test without a human. Returns a function that stops it.
 */
export async function startBot(page) {
  await page.evaluate(() => {
    const g = window.__flappy.game;
    const cfg = g.config;
    const lift = (cfg.bird.flapVelocity ** 2) / (2 * cfg.bird.gravity);

    const step = () => {
      const bird = g.bird;
      if (g.state === 'ready') {
        window.__flappy.flap();
        return;
      }
      // Do not fight the player while paused or after a crash.
      if (g.state !== 'playing') return;
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
    };

    // Run the bot on the fixed timestep instead of a timer, so it keeps up
    // even when the browser is busy.
    const original = g.update.bind(g);
    g.update = (dt) => {
      original(dt);
      step();
    };
    window.__bot = { stop: () => { g.update = original; } };
  });
  return () => page.evaluate(() => window.__bot && window.__bot.stop());
}

/** Reads the current state without waiting. */
export async function readState(page) {
  return page.evaluate(() => window.__flappy.state);
}

/**
 * Records the game state at the moment of every flap.
 *
 * The bird dies quickly when nobody plays, so checking the state "a moment
 * later" is racy. Recording it inside the flap itself is exact.
 */
export async function recordFlaps(page) {
  await page.evaluate(() => {
    const game = window.__flappy.game;
    window.__flapStates = [];
    const original = game.flap.bind(game);
    game.flap = () => {
      const result = original();
      window.__flapStates.push(game.state);
      return result;
    };
  });
  return () => page.evaluate(() => window.__flapStates);
}

/** Waits until the game reports at least `target` points. */
export async function waitForScore(page, target, timeout = 20_000) {
  await page.waitForFunction(
    (t) => window.__flappy && window.__flappy.score >= t,
    target,
    { timeout },
  );
}

/** Fakes the browser losing focus. */
export async function simulateHidden(page, hidden) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => value,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/**
 * Replaces requestAnimationFrame and performance.now with a virtual clock so
 * the game can be run at a fixed frame rate.
 */
export async function useVirtualClock(page, fps, withBot = false) {
  await page.addInitScript(
    ({ fps: rate, withBot: bot }) => {
      const interval = 1000 / rate;
      let virtualNow = 0;
      const realNow = performance.now.bind(performance);
      performance.now = () => (virtualNow === 0 ? realNow() : virtualNow);
      virtualNow = realNow();

      const runBot = () => {
        const g = window.__flappy?.game;
        if (!g) return;
        if (g.state === 'ready') {
          window.__flappy.flap();
          return;
        }
        if (g.state !== 'playing') return;
        const cfg = g.config;
        const lift = (cfg.bird.flapVelocity ** 2) / (2 * cfg.bird.gravity);
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
      };

      const timers = new Map();
      let nextId = 1;
      window.requestAnimationFrame = (callback) => {
        const id = nextId++;
        timers.set(id, setTimeout(() => {
          timers.delete(id);
          virtualNow += interval;
          if (bot) runBot();
          callback(virtualNow);
        }, interval));
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        const timer = timers.get(id);
        if (timer) clearTimeout(timer);
        timers.delete(id);
      };
    },
    { fps, withBot },
  );
}

/**
 * Stops the game as soon as the given amount of game time has passed.
 * The simulation runs on a fixed timestep, so the state is exactly the same
 * no matter how many frames it took to get there.
 */
export async function stopAtGameTime(page, seconds, restart = true) {
  await page.evaluate(
    ({ target, doRestart }) => {
      const game = window.__flappy.game;
      const original = game.update.bind(game);
      // Hooking into the fixed timestep makes the stop point exact: the same
      // number of steps, no matter how many frames it took.
      game.update = (dt) => {
        original(dt);
        if (game.time >= target - 1e-9 && game.state === 'playing') game.pause();
      };
      if (doRestart) game.restart();
    },
    { target: seconds, doRestart: restart },
  );
  await page.waitForFunction(() => window.__flappy.game.state === 'paused', null, { timeout: 20_000 });
}

/** Measures frame times inside the page for `duration` milliseconds. */
export async function measureFrames(page, duration = 3000) {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const deltas = [];
        let last = performance.now();
        const start = last;
        function tick(now) {
          deltas.push(now - last);
          last = now;
          if (now - start < ms) {
            requestAnimationFrame(tick);
          } else {
            resolve(deltas);
          }
        }
        requestAnimationFrame(tick);
      }),
    duration,
  );
}

export function summarise(deltas) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const average = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return {
    frames: deltas.length,
    averageFps: 1000 / average,
    p95,
    worst: sorted[sorted.length - 1],
  };
}
