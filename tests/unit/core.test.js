import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../../src/config.js';
import { STATE, createGame, createRng, createStorage } from '../../src/core.js';
import { createAutopilot } from './autopilot.js';

const VIEW = { viewWidth: 360, viewHeight: 640 };

function makeGame(overrides = {}) {
  return createGame({ ...VIEW, ...overrides });
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

// ---------------------------------------------------------------- lifecycle

test('starts in the ready state with a zero score', () => {
  const game = makeGame();
  assert.equal(game.state, STATE.READY);
  assert.equal(game.score, 0);
  assert.equal(game.pipes.length, 0);
});

test('the first flap starts the run and gives the bird an upward impulse', () => {
  const game = makeGame();
  game.flap();
  assert.equal(game.state, STATE.PLAYING);
  assert.equal(game.bird.vy, CONFIG.bird.flapVelocity);
  assert.ok(game.pipes.length > 0, 'columns should spawn when the run starts');
});

test('gravity pulls the bird down between flaps', () => {
  const game = makeGame();
  game.restart();
  const before = game.bird.y;
  for (let i = 0; i < 30; i += 1) game.update(1 / 120);
  assert.ok(game.bird.y > before, 'the bird should fall');
  assert.ok(game.bird.vy > 0);
});

test('the bird never falls faster than the terminal velocity', () => {
  const game = makeGame();
  game.flap();
  for (let i = 0; i < 600; i += 1) game.update(1 / 120);
  assert.ok(game.bird.vy <= CONFIG.bird.maxFall + 1e-6);
});

test('the bird cannot fly out of the top of the screen', () => {
  const game = makeGame();
  game.flap();
  for (let i = 0; i < 30; i += 1) game.update(1 / 120);
  assert.ok(game.bird.y >= CONFIG.bird.ceilingY - 1e-9);
});

test('rotation follows the vertical velocity', () => {
  const game = makeGame();
  game.flap();
  game.update(1 / 120);
  assert.ok(game.bird.rotation < 0, 'rising -> nose up (negative)');

  const falling = makeGame();
  falling.flap();
  for (let i = 0; i < 120; i += 1) falling.update(1 / 120);
  assert.ok(falling.bird.rotation > 0, 'falling -> nose down (positive)');
});

test('rotation is smoothed and never snaps', () => {
  const game = makeGame();
  game.flap();
  const before = game.bird.rotation;
  game.update(1 / 120);
  assert.ok(Math.abs(game.bird.rotation - before) < 0.2, 'rotation should ease in');
});

// ------------------------------------------------------------------- pipes

test('columns are spaced evenly and scroll left', () => {
  const game = makeGame();
  game.flap();
  const autopilot = createAutopilot(game);
  // the second column spawns once the first one has scrolled in
  for (let i = 0; i < 220 && game.pipes.length < 2; i += 1) {
    autopilot();
    game.update(1 / 120);
  }
  assert.ok(game.pipes.length >= 2, 'a second column should appear');
  const first = game.pipes[0].x;
  const second = game.pipes[1].x;
  assert.ok(Math.abs(second - first - CONFIG.pipes.spacing) < 1e-6, 'columns are evenly spaced');
  const before = game.pipes[0].x;
  game.update(1 / 60);
  assert.ok(game.pipes[0].x < before, 'columns move left');
});

test('generated gaps respect every boundary', () => {
  for (let seed = 0; seed < 400; seed += 1) {
    const game = makeGame({ rng: createRng(seed) });
    game.restart();
    for (let i = 0; i < 200; i += 1) {
      game.update(1 / 120);
      for (const pipe of game.pipes) {
        const half = pipe.gap / 2;
        assert.ok(pipe.gap >= CONFIG.pipes.gapMin - 1e-6, 'gap never smaller than the minimum');
        assert.ok(pipe.gap <= CONFIG.pipes.gapMax + 1e-6);
        assert.ok(pipe.center - half >= CONFIG.world.topMargin - 1e-6, 'gap stays below the HUD');
        assert.ok(pipe.center + half <= game.groundY - CONFIG.pipes.bottomMargin + 1e-6, 'gap stays above the ground');
      }
    }
  }
});

test('consecutive openings always overlap, so the course is always flyable', () => {
  for (let seed = 0; seed < 400; seed += 1) {
    const game = makeGame({ rng: createRng(seed) });
    game.restart();
    let previous = null;
    for (let i = 0; i < 400; i += 1) {
      game.update(1 / 120);
      for (const pipe of game.pipes) {
        if (previous && previous !== pipe) {
          const delta = Math.abs(pipe.center - previous.center);
          assert.ok(delta <= CONFIG.pipes.maxCenterDelta + 1e-6, 'the opening never jumps too far');
          const overlap = Math.min(previous.gap, pipe.gap) - delta;
          assert.ok(overlap > 0, 'openings must overlap to be flyable');
        }
        previous = pipe;
      }
    }
  }
});

test('an autopilot can fly every generated course', () => {
  const seeds = 120;
  for (let seed = 0; seed < seeds; seed += 1) {
    const game = makeGame({ rng: createRng(seed) });
    game.restart();
    const autopilot = createAutopilot(game);
    let died = false;
    for (let frame = 0; frame < 60 * 90; frame += 1) {
      if (game.state === STATE.GAMEOVER) {
        died = true;
        break;
      }
      autopilot();
      game.advance(1 / 60);
    }
    assert.ok(!died, `seed ${seed} should be survivable`);
    assert.ok(game.score >= 15, `seed ${seed} should score points (got ${game.score})`);
  }
});

// ------------------------------------------------------------------ scoring

test('every column scores exactly once', () => {
  const game = makeGame();
  game.restart();
  const autopilot = createAutopilot(game);
  let previous = 0;
  let points = 0;
  for (let frame = 0; frame < 60 * 40; frame += 1) {
    if (game.state === STATE.GAMEOVER) break;
    autopilot();
    game.advance(1 / 60);
    const delta = game.score - previous;
    assert.ok(delta >= 0, 'the score never goes down');
    assert.ok(delta <= 1, 'at most one point per step, so no column scores twice');
    if (delta === 1) points += 1;
    previous = game.score;
  }
  assert.ok(game.score > 0, 'the bot should have scored');
  assert.equal(points, game.score, 'every point came from exactly one column');
  const scoredOnScreen = game.pipes.filter((p) => p.scored).length;
  assert.ok(scoredOnScreen <= game.score);
});

test('passing a column exactly once adds exactly one point', () => {
  const game = makeGame();
  game.restart();
  game.pipes = [{ x: game.birdX - 100, width: CONFIG.pipes.width, gap: 200, center: 300, scored: false }];
  game.update(1 / 120);
  assert.equal(game.score, 1);
  game.update(1 / 120);
  game.update(1 / 120);
  assert.equal(game.score, 1, 'the same column never scores twice');
});

// ---------------------------------------------------------------- collision

test('hitting a column ends the run', () => {
  const game = makeGame();
  game.restart();
  game.pipes = [{
    x: game.birdX - 5,
    width: CONFIG.pipes.width,
    gap: 60,
    center: game.bird.y - 200,
    scored: false,
  }];
  game.update(1 / 120);
  assert.equal(game.state, STATE.GAMEOVER);
  assert.equal(game.deathReason, 'pipe');
});

test('hitting the ground ends the run', () => {
  const game = makeGame();
  game.restart();
  game.bird.y = game.groundY - CONFIG.bird.radius + 1;
  game.update(1 / 120);
  assert.equal(game.state, STATE.GAMEOVER);
  assert.equal(game.deathReason, 'ground');
});

test('the hitbox is forgiving: brushing a column is not a crash', () => {
  const game = makeGame();
  game.restart();
  const edge = game.birdX + CONFIG.bird.radius - 2;
  game.pipes = [{
    x: edge,
    width: CONFIG.pipes.width,
    gap: 200,
    center: game.bird.y + 60,
    scored: false,
  }];
  game.update(1 / 120);
  assert.equal(game.state, STATE.PLAYING, 'a near miss must not kill the bird');
});

test('flying through the middle of an opening survives', () => {
  const game = makeGame();
  game.restart();
  game.pipes = [{
    x: game.birdX - 5,
    width: CONFIG.pipes.width,
    gap: 200,
    center: game.bird.y,
    scored: false,
  }];
  game.update(1 / 120);
  assert.equal(game.state, STATE.PLAYING);
});

// ------------------------------------------------------------------- states

test('pause freezes the simulation and resume continues it', () => {
  const game = makeGame();
  game.restart();
  game.update(1 / 120);
  const y = game.bird.y;
  const time = game.time;

  assert.ok(game.pause());
  assert.equal(game.state, STATE.PAUSED);
  for (let i = 0; i < 60; i += 1) game.advance(1 / 60);
  assert.equal(game.bird.y, y, 'nothing moves while paused');
  assert.equal(game.time, time);

  assert.ok(game.resume());
  assert.equal(game.state, STATE.PLAYING);
  game.advance(1 / 60);
  assert.notEqual(game.bird.y, y, 'the bird moves again after resuming');
});

test('flapping while paused resumes the game', () => {
  const game = makeGame();
  game.restart();
  game.pause();
  game.flap();
  assert.equal(game.state, STATE.PLAYING);
});

test('restart is instant and resets the run', () => {
  const game = makeGame();
  game.restart();
  const autopilot = createAutopilot(game);
  for (let i = 0; i < 600; i += 1) {
    autopilot();
    game.update(1 / 120);
  }
  assert.ok(game.score > 0, 'the bot should have scored');

  game.restart();
  assert.equal(game.state, STATE.PLAYING);
  assert.equal(game.score, 0);
  assert.equal(game.pipesPassed, 0);
  assert.equal(game.bird.y, game.startY());
  assert.ok(game.pipes.length > 0);
});

test('restarting after a crash starts a brand new run immediately', () => {
  const game = makeGame();
  game.restart();
  game.bird.y = game.groundY;
  game.update(1 / 120);
  assert.equal(game.state, STATE.GAMEOVER);
  game.flap();
  assert.equal(game.state, STATE.PLAYING);
  assert.equal(game.score, 0);
});

test('repeated restarts keep the game consistent', () => {
  const game = makeGame();
  for (let i = 0; i < 25; i += 1) {
    game.restart();
    assert.equal(game.state, STATE.PLAYING);
    assert.equal(game.score, 0);
    for (let f = 0; f < 30; f += 1) game.update(1 / 120);
    game.bird.y = game.groundY;
    game.update(1 / 120);
    assert.equal(game.state, STATE.GAMEOVER);
    game.flap();
  }
  assert.equal(game.state, STATE.PLAYING);
  assert.equal(game.score, 0);
});

// -------------------------------------------------------------- frame timing

test('the simulation is frame rate independent', () => {
  const run = (frameDt) => {
    const game = makeGame({ rng: createRng(7) });
    game.restart();
    for (let i = 0; i < 600; i += 1) game.advance(frameDt);
    return {
      score: game.score,
      y: game.bird.y,
      x: game.birdX,
      pipes: game.pipes.length,
    };
  };
  const slow = run(1 / 30);
  const fast = run(1 / 144);
  const medium = run(1 / 60);
  assert.equal(slow.score, fast.score);
  assert.equal(slow.score, medium.score);
  assert.ok(Math.abs(slow.y - fast.y) < 1e-6, 'the bird ends up in the same place');
});

test('a long stall (tab switch) does not teleport or kill the bird', () => {
  const game = makeGame();
  game.restart();
  for (let i = 0; i < 30; i += 1) game.update(1 / 120);
  const y = game.bird.y;
  game.advance(5);
  assert.equal(game.bird.y, y, 'the simulation is skipped entirely');
  assert.equal(game.state, STATE.PLAYING);
});

test('a stall during play does not swallow the score', () => {
  const game = makeGame();
  game.restart();
  game.update(1 / 120);
  game.advance(30);
  assert.equal(game.score, 0);
  assert.equal(game.state, STATE.PLAYING);
});

// ---------------------------------------------------------------- difficulty

test('difficulty ramps gradually and is capped', () => {
  const game = makeGame();
  game.restart();
  let previousSpeed = game.speed;
  let previousGap = game.currentGap;
  for (let i = 0; i < 60 * 200; i += 1) {
    game.pipesPassed += 1;
    game.update(1 / 120);
    if (game.speed < previousSpeed) assert.fail('speed must never drop');
    if (game.currentGap > previousGap) assert.fail('the opening must never grow');
    previousSpeed = game.speed;
    previousGap = game.currentGap;
    if (game.pipesPassed > CONFIG.speed.rampPipes + 5) break;
  }
  assert.ok(game.speed <= CONFIG.speed.max + 1e-9, 'speed is capped');
  assert.ok(game.currentGap >= CONFIG.pipes.gapMin - 1e-9, 'the opening is capped');
});

// ------------------------------------------------------------------ storage

test('the best score is saved and reloaded', () => {
  const backing = memoryStorage();
  const storage = createStorage(backing);
  const game = makeGame({ storage });
  game.restart();
  for (let i = 0; i < 12; i += 1) {
    // A column that is already behind the bird scores exactly one point.
    game.pipes = [{
      x: game.birdX - 100,
      width: CONFIG.pipes.width,
      gap: 200,
      center: game.bird.y,
      scored: false,
    }];
    game.update(1 / 120);
  }
  assert.equal(game.score, 12);
  assert.equal(game.best, 12);
  assert.equal(backing.data[CONFIG.storage.best], '12');

  const reloaded = makeGame({ storage });
  assert.equal(reloaded.best, game.best, 'the best score survives a reload');
});

test('a broken storage backend never crashes the game', () => {
  const broken = {
    getItem() {
      throw new Error('nope');
    },
    setItem() {
      throw new Error('nope');
    },
  };
  const game = makeGame({ storage: createStorage(broken) });
  assert.equal(game.best, 0);
  game.restart();
  game.update(1 / 120);
  assert.equal(game.state, STATE.PLAYING);
});

test('a missing storage backend behaves like an empty one', () => {
  const game = makeGame({ storage: createStorage(null) });
  assert.equal(game.best, 0);
  game.restart();
  assert.doesNotThrow(() => game.update(1 / 120));
});

// ------------------------------------------------------------------ effects

test('a crash scatters feathers and shakes the screen', () => {
  const game = makeGame();
  game.restart();
  game.bird.y = game.groundY;
  game.update(1 / 120);
  assert.equal(game.feathers.length, CONFIG.effects.featherCount);
  assert.ok(game.shake > 0);

  for (let i = 0; i < 200; i += 1) game.update(1 / 120);
  assert.equal(game.feathers.length, 0, 'feathers are cleaned up');
  assert.equal(game.shake, 0, 'the shake decays');
});

// ---------------------------------------------------------------- viewport

test('resizing keeps the game playable and does not duplicate columns', () => {
  const game = makeGame();
  game.restart();
  for (let i = 0; i < 120; i += 1) game.update(1 / 120);
  const scoredBefore = game.score;

  game.setViewport(1138, 640);
  game.update(1 / 120);
  assert.equal(game.score, scoredBefore, 'resizing never awards points');
  for (const pipe of game.pipes) {
    assert.ok(pipe.x <= 1138 + CONFIG.pipes.spawnMargin + 1e-6);
  }
  assert.ok(game.pipes.every((p, i, arr) => i === 0 || arr[i - 1].x < p.x), 'columns stay ordered');
});

test('the bird stays on screen for every viewport', () => {
  const viewports = [
    [320, 568],
    [360, 640],
    [390, 844],
    [768, 1024],
    [1138, 640],
    [1920, 1080],
  ];
  for (const [w, h] of viewports) {
    const game = makeGame({ viewWidth: w, viewHeight: h });
    game.restart();
    assert.ok(game.birdX > 0 && game.birdX < w, `bird x in range for ${w}x${h}`);
    assert.ok(game.groundY < h && game.groundY > h - 200, `ground near the bottom for ${w}x${h}`);
  }
});
