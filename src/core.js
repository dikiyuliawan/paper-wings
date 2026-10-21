/**
 * Pure game simulation.
 *
 * This module must never touch the DOM, the canvas, timers or `window`.
 * Everything it needs comes in through the constructor, which makes the whole
 * game testable in plain Node (see tests/unit/core.test.js).
 */

import { CONFIG } from './config.js';

export const STATE = Object.freeze({
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAMEOVER: 'gameover',
});

/** Deterministic PRNG (mulberry32) so tests can reproduce exact runs. */
export function createRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Storage adapter that never throws (Safari private mode, disabled cookies...).
 * `backend` defaults to localStorage when it is available.
 */
export function createStorage(backend) {
  let store = backend;
  if (store === undefined) {
    try {
      store = typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      store = null;
    }
  }
  return {
    getItem(key) {
      try {
        return store ? store.getItem(key) : null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        if (!store) return false;
        store.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Circle vs axis aligned rectangle overlap test. */
export function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nearestX = clamp(cx, rx, rx + rw);
  const nearestY = clamp(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < r * r;
}

export function createGame(options = {}) {
  const config = options.config ?? CONFIG;
  const rng = options.rng ?? Math.random;
  const storage = options.storage ?? createStorage(options.storageBackend);

  const game = {
    config,
    state: STATE.READY,
    /** Simulation clock, in seconds. Only advances while the game is running. */
    time: 0,
    /** Accumulated real time not yet consumed by the fixed timestep. */
    accumulator: 0,
    /** Wall-clock time at which the last simulation step happened. */
    lastFrameAt: 0,
    score: 0,
    best: 0,
    pipesPassed: 0,
    /** Total distance the world has scrolled (uw). Drives the parallax. */
    scroll: 0,
    speed: config.speed.min,
    difficulty: 0,
    currentGap: config.pipes.gapMax,
    pipes: [],
    nextPipeX: 0,
    lastGapCenter: null,
    birdX: 0,
    groundY: config.world.designHeight - config.world.groundThickness,
    viewWidth: 360,
    viewHeight: config.world.designHeight,
    deathReason: null,
    shake: 0,
    feathers: [],
    /** When true the crash effects (shake, feathers) are skipped entirely. */
    reducedMotion: false,
    /** How many times the bird has flapped in this session. */
    flaps: 0,
    /** Event hook: (type, payload) => void. Used for audio + effects. */
    onEvent: options.onEvent ?? null,
    bird: { x: 0, y: 0, vy: 0, rotation: 0, flapAt: -99, alive: true },
  };

  game.best = readBest();

  function readBest() {
    if (typeof options.best === 'number') return options.best;
    const raw = storage.getItem(config.storage.best);
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  game.saveBest = function saveBest() {
    storage.setItem(config.storage.best, String(game.best));
  };

  // ---------------------------------------------------------------- viewport

  game.setViewport = function setViewport(width, height) {
    game.viewWidth = width;
    game.viewHeight = height;
    game.groundY = height - config.world.groundThickness;
    game.birdX = Math.min(width * config.bird.screenRatio, config.bird.maxScreenX);
    game.bird.x = game.birdX;

    if (game.pipes.length) {
      // Columns further right than the screen are irrelevant now: drop them so
      // a resize cannot leave a long empty stretch in front of the bird.
      const limit = width + config.pipes.spawnMargin;
      let last = null;
      let kept = 0;
      for (let i = 0; i < game.pipes.length; i += 1) {
        const pipe = game.pipes[i];
        if (pipe.x <= limit) {
          game.pipes[kept] = pipe;
          kept += 1;
          last = pipe;
        }
      }
      game.pipes.length = kept;
      game.lastGapCenter = last ? last.center : null;
      game.nextPipeX = last ? last.x + config.pipes.spacing : game.birdX + 300;
      if (game.state === STATE.PLAYING) game.ensurePipes();
    } else {
      game.nextPipeX = game.birdX + 300;
    }
  };

  // ------------------------------------------------------------------ state

  game.reset = function reset() {
    game.state = STATE.READY;
    game.time = 0;
    game.accumulator = 0;
    game.score = 0;
    game.pipesPassed = 0;
    game.scroll = 0;
    game.pipes = [];
    game.speed = config.speed.min;
    game.difficulty = 0;
    game.currentGap = config.pipes.gapMax;
    game.deathReason = null;
    game.shake = 0;
    game.feathers = [];
    game.flaps = 0;
    game.lastGapCenter = null;
    game.nextPipeX = game.birdX + 300;
    game.bird.vy = 0;
    game.bird.rotation = 0;
    game.bird.alive = true;
    game.bird.flapAt = -99;
    game.bird.y = game.startY();
    game.bird.x = game.birdX;
  };

  game.startY = function startY() {
    return game.groundY - 260;
  };

  /** Jump straight into a fresh run (used by the instant restart). */
  game.restart = function restart() {
    game.reset();
    game.beginRun();
  };

  game.pause = function pause() {
    if (game.state !== STATE.PLAYING) return false;
    game.state = STATE.PAUSED;
    game.accumulator = 0;
    game.emit('pause');
    return true;
  };

  game.resume = function resume() {
    if (game.state !== STATE.PAUSED) return false;
    game.state = STATE.PLAYING;
    game.accumulator = 0;
    game.emit('resume');
    return true;
  };

  game.togglePause = function togglePause() {
    if (game.state === STATE.PLAYING) return game.pause();
    if (game.state === STATE.PAUSED) return game.resume();
    return false;
  };

  // ------------------------------------------------------------------ input

  /** The one button. Works from every state. */
  game.flap = function flap() {
    if (game.state === STATE.GAMEOVER) {
      game.restart();
      game.doFlap();
      return true;
    }
    if (game.state === STATE.READY) {
      game.beginRun();
      game.doFlap();
      return true;
    }
    if (game.state === STATE.PAUSED) {
      game.resume();
      return true;
    }
    game.doFlap();
    return true;
  };

  game.doFlap = function doFlap() {
    game.bird.vy = config.bird.flapVelocity;
    game.bird.flapAt = game.time;
    game.flaps += 1;
    game.emit('flap');
  };

  // ------------------------------------------------------------------ pipes

  game.currentGapForDifficulty = function currentGapForDifficulty() {
    const diff = Math.min(1, game.pipesPassed / config.speed.rampPipes);
    return config.pipes.gapMax - (config.pipes.gapMax - config.pipes.gapMin) * diff;
  };

  game.spawnPipe = function spawnPipe() {
    const gap = game.currentGapForDifficulty();
    const half = gap / 2;
    const lo = config.world.topMargin + half;
    const hi = game.groundY - config.pipes.bottomMargin - half;

    let center;
    if (game.lastGapCenter === null) {
      center = lo + rng() * (hi - lo);
    } else {
      // Randomise, but never move the opening more than `maxCenterDelta`.
      // Consecutive openings therefore always overlap vertically, which is what
      // guarantees that every generated course can actually be flown.
      const delta = (rng() * 2 - 1) * config.pipes.maxCenterDelta;
      let candidate = game.lastGapCenter + delta;
      if (candidate < lo || candidate > hi) {
        const mirrored = game.lastGapCenter - delta;
        candidate = mirrored >= lo && mirrored <= hi ? mirrored : clamp(candidate, lo, hi);
      }
      center = candidate;
    }
    game.lastGapCenter = center;

    const x = game.nextPipeX;
    game.nextPipeX = x + config.pipes.spacing;
    game.pipes.push({ x, width: config.pipes.width, gap, center, scored: false });
  };

  /**
   * Spawn columns while the cursor sits off the right edge.
   * The cursor scrolls left at exactly the same speed as the columns, so the
   * distance between two columns is always `spacing` world units.
   */
  game.ensurePipes = function ensurePipes() {
    const limit = game.viewWidth + config.pipes.spawnMargin;
    let guard = 0;
    while (game.nextPipeX <= limit && guard < 32) {
      game.spawnPipe();
      guard += 1;
    }
  };

  /** Put the first column on the board and start the run. */
  game.beginRun = function beginRun() {
    game.state = STATE.PLAYING;
    game.nextPipeX = game.birdX + 300;
    game.spawnPipe();
  };

  // --------------------------------------------------------------- collision

  game.hitTest = function hitTest() {
    const r = config.bird.radius;
    const bx = game.birdX;
    const by = game.bird.y;
    for (let i = 0; i < game.pipes.length; i += 1) {
      const pipe = game.pipes[i];
      if (pipe.x > bx + r + 2 || pipe.x + pipe.width < bx - r - 2) continue;
      const topBottom = pipe.center - pipe.gap / 2;
      const bottomTop = pipe.center + pipe.gap / 2;
      if (circleHitsRect(bx, by, r, pipe.x, -400, pipe.width, topBottom + 400)) return true;
      if (circleHitsRect(bx, by, r, pipe.x, bottomTop, pipe.width, game.groundY - bottomTop)) return true;
    }
    return by + r >= game.groundY;
  };

  // ------------------------------------------------------------------- loop

  game.emit = function emit(type, payload) {
    if (game.onEvent) game.onEvent(type, payload);
  };

  /** One fixed simulation step. */
  game.update = function update(dt) {
    if (game.state === STATE.PAUSED) return;

    game.time += dt;

    if (game.state === STATE.READY) {
      // Gentle hover while waiting for the first press.
      game.bird.y = game.startY() + Math.sin(game.time * 2.6) * 9;
      game.bird.vy = 0;
      game.bird.rotation = Math.sin(game.time * 2.6) * 0.04;
      game.updateEffects(dt);
      return;
    }

    if (game.state === STATE.GAMEOVER) {
      // The bird keeps falling until it reaches the ground, then rests.
      const b = game.bird;
      if (b.y + config.bird.radius < game.groundY) {
        b.vy = Math.min(b.vy + config.bird.gravity * dt, config.bird.maxFall);
        b.y += b.vy * dt;
        b.rotation = Math.min(b.rotation + 4 * dt, 1.5);
      } else {
        b.y = game.groundY - config.bird.radius;
        b.vy = 0;
      }
      game.updateEffects(dt);
      return;
    }

    // ---- playing -------------------------------------------------------
    const diff = Math.min(1, game.pipesPassed / config.speed.rampPipes);
    game.difficulty = diff;
    game.speed = config.speed.min + (config.speed.max - config.speed.min) * diff;
    game.currentGap = game.currentGapForDifficulty();

    const b = game.bird;
    b.vy = Math.min(b.vy + config.bird.gravity * dt, config.bird.maxFall);
    b.y += b.vy * dt;
    if (b.y < config.bird.ceilingY) {
      b.y = config.bird.ceilingY;
      if (b.vy < 0) b.vy = 0;
    }

    // Rotation follows the vertical velocity, smoothed so it never snaps.
    const target = b.vy < 0
      ? config.bird.rotLevel + (config.bird.rotUp - config.bird.rotLevel) * (b.vy / config.bird.flapVelocity)
      : config.bird.rotLevel + (config.bird.rotDown - config.bird.rotLevel) * (b.vy / config.bird.maxFall);
    const blend = 1 - Math.exp(-config.bird.rotSmooth * dt);
    b.rotation += (target - b.rotation) * blend;

    // Move and cull the columns.
    game.scroll += game.speed * dt;
    let write = 0;
    for (let i = 0; i < game.pipes.length; i += 1) {
      const pipe = game.pipes[i];
      pipe.x -= game.speed * dt;
      if (pipe.x + pipe.width > -100) {
        game.pipes[write] = pipe;
        write += 1;
      }
    }
    game.pipes.length = write;

    // The spawn cursor scrolls with the world, so columns keep a constant
    // distance from each other no matter how the speed changes.
    game.nextPipeX -= game.speed * dt;
    game.ensurePipes();

    // Score: every column counts exactly once.
    for (let i = 0; i < game.pipes.length; i += 1) {
      const pipe = game.pipes[i];
      if (!pipe.scored && pipe.x + pipe.width <= game.birdX) {
        pipe.scored = true;
        game.score += 1;
        game.pipesPassed += 1;
        if (game.score > game.best) {
          game.best = game.score;
          game.saveBest();
        }
        game.emit('score', { score: game.score, best: game.best });
      }
    }

    if (game.hitTest()) {
      game.endGame(game.bird.y + config.bird.radius >= game.groundY ? 'ground' : 'pipe');
    }

    game.updateEffects(dt);
  };

  game.updateEffects = function updateEffects(dt) {
    if (game.shake > 0) {
      game.shake = Math.max(0, game.shake - dt / config.effects.shakeDuration);
    }
    const feathers = game.feathers;
    let write = 0;
    for (let i = 0; i < feathers.length; i += 1) {
      const f = feathers[i];
      f.life -= dt;
      if (f.life > 0) {
        f.vy += f.gravity * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rotation += f.spin * dt;
        feathers[write] = f;
        write += 1;
      }
    }
    feathers.length = write;
  };

  game.endGame = function endGame(reason) {
    if (game.state !== STATE.PLAYING) return;
    game.state = STATE.GAMEOVER;
    game.deathReason = reason;
    game.bird.alive = false;
    game.shake = game.reducedMotion ? 0 : 1;
    game.emit('hit', { reason });
    if (!game.reducedMotion) game.spawnFeathers();
    game.emit('gameover', { score: game.score, best: game.best });
  };

  game.spawnFeathers = function spawnFeathers() {
    for (let i = 0; i < config.effects.featherCount; i += 1) {
      const angle = (i / config.effects.featherCount) * Math.PI * 2 + rng() * 0.6;
      const speed = 90 + rng() * 150;
      game.feathers.push({
        x: game.birdX + (rng() - 0.5) * 10,
        y: game.bird.y + (rng() - 0.5) * 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        gravity: 620,
        rotation: rng() * Math.PI * 2,
        spin: (rng() - 0.5) * 9,
        size: 5 + rng() * 4,
        life: config.effects.featherLife * (0.7 + rng() * 0.5),
        maxLife: config.effects.featherLife,
      });
    }
  };

  /**
   * Advance the simulation by a real elapsed time.
   * Uses a fixed timestep so the outcome does not depend on the frame rate, and
   * discards long stalls (tab switches) instead of teleporting the bird.
   */
  game.advance = function advance(frameDt) {
    if (!Number.isFinite(frameDt) || frameDt <= 0) return;
    if (frameDt > config.loop.maxFrameDt) {
      game.accumulator = 0;
      return;
    }
    if (game.state === STATE.PAUSED) {
      game.accumulator = 0;
      return;
    }
    game.accumulator += frameDt;
    const { fixedDt, maxSteps } = config.loop;
    let steps = 0;
    while (game.accumulator >= fixedDt && steps < maxSteps) {
      game.update(fixedDt);
      game.accumulator -= fixedDt;
      steps += 1;
    }
    if (steps >= maxSteps) game.accumulator = 0;
  };

  game.setViewport(options.viewWidth ?? 360, options.viewHeight ?? CONFIG.world.designHeight);
  game.reset();
  return game;
}
