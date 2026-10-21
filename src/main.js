/**
 * Paper Wings - wiring.
 *
 * Connects the pure simulation (core.js) to the canvas (render.js), the
 * synthesised sounds (audio.js) and the browser events (input.js).
 */

import { CONFIG, computeViewport } from './config.js';
import { STATE, createGame, createStorage } from './core.js';
import { Renderer } from './render.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { formatRecordAge } from './format.js';

const app = document.getElementById('app');
const canvas = document.getElementById('game');
const sky = document.getElementById('sky');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const finalScoreEl = document.getElementById('final-score');
const newBestEl = document.getElementById('new-best');
const recordNoteEl = document.getElementById('record-note');
const recordScoreEl = document.getElementById('record-score');
const recordAgeEl = document.getElementById('record-age');
const liveEl = document.getElementById('live');
const btnPause = document.getElementById('btn-pause');
const btnSound = document.getElementById('btn-sound');
const btnMotion = document.getElementById('btn-motion');
const btnAgain = document.getElementById('btn-again');
const panels = {
  [STATE.READY]: document.querySelector('[data-panel="ready"]'),
  [STATE.PAUSED]: document.querySelector('[data-panel="paused"]'),
  [STATE.GAMEOVER]: document.querySelector('[data-panel="gameover"]'),
};

const storage = createStorage();
const audio = createAudio(storage);
const renderer = new Renderer(canvas, sky);

let reducedMotion = readSetting(CONFIG.storage.reducedMotion, prefersReducedMotion());
let qualityFactor = 1;
let view = computeViewport(window.innerWidth, window.innerHeight);
let lastState = null;
let bestAtRunStart = 0;
let wakeLock = null;

const game = createGame({
  storage,
  onEvent: handleEvent,
});
bestAtRunStart = game.best;
updateBest();

function prefersReducedMotion() {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readSetting(key, fallback) {
  try {
    const value = storage.getItem(key);
    if (value === null) return fallback;
    return value === '1';
  } catch {
    return fallback;
  }
}

function writeSetting(key, value) {
  try {
    storage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------- events

function handleEvent(type) {
  switch (type) {
    case 'flap':
      audio.flap();
      break;
    case 'score':
      audio.score();
      updateScore();
      break;
    case 'hit':
      audio.hit();
      vibrate(18);
      break;
    case 'gameover':
      audio.gameOver();
      break;
    default:
      break;
  }
}

function vibrate(ms) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------------- HUD

function updateScore() {
  if (scoreEl.textContent !== String(game.score)) {
    scoreEl.textContent = String(game.score);
  }
}

function updateBest() {
  const text = String(game.best);
  if (bestEl.textContent !== text) {
    bestEl.textContent = text;
  }
}

/** "Best 12 - set 3 hours ago" on the start screen. */
function updateRecordNote() {
  if (!game.best || !game.recordAt) {
    recordNoteEl.hidden = true;
    return;
  }
  recordNoteEl.hidden = false;
  recordScoreEl.textContent = String(game.best);
  recordAgeEl.textContent = `set ${formatRecordAge(game.recordAt)}`;
}

function syncState() {
  if (lastState === game.state) return;
  lastState = game.state;
  app.dataset.state = game.state;

  for (const [name, panel] of Object.entries(panels)) {
    panel.hidden = name !== game.state;
  }

  const paused = game.state === STATE.PAUSED;
  btnPause.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  btnPause.disabled = game.state !== STATE.PLAYING && !paused;

  if (game.state === STATE.GAMEOVER) {
    finalScoreEl.textContent = String(game.score);
    newBestEl.hidden = game.score <= bestAtRunStart || game.score === 0;
  }

  if (game.state === STATE.READY) {
    updateRecordNote();
  }

  if (game.state === STATE.PLAYING) {
    // Remember the record from before this run so the game over screen can
    // tell whether the player just beat it.
    bestAtRunStart = game.best;
  }

  const messages = {
    [STATE.READY]: 'Press to start',
    [STATE.PLAYING]: `Score ${game.score}`,
    [STATE.PAUSED]: 'Paused',
    [STATE.GAMEOVER]: `Game over. Score ${game.score}, best ${game.best}.`,
  };
  liveEl.textContent = messages[game.state] ?? '';

  updateWakeLock();
}

// ------------------------------------------------------------------ layout

function pixelRatio() {
  const rect = app.getBoundingClientRect();
  const area = Math.max(1, rect.width * rect.height);
  const device = window.devicePixelRatio || 1;
  // Very large surfaces get a smaller ratio so the frame budget stays healthy.
  const cap = area > 1_100_000 ? 2 : 3;
  return Math.max(1, Math.min(device, cap) * qualityFactor);
}

function layout() {
  const rect = app.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  view = computeViewport(cssWidth, cssHeight);
  renderer.resize(cssWidth, cssHeight, pixelRatio(), view.viewWidth, view.viewHeight);
  game.setViewport(view.viewWidth, view.viewHeight);
}

let resizeTimer = 0;
function scheduleLayout() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(layout, 90);
}

// -------------------------------------------------------------- game loop

let lastTime = performance.now();
let workTotal = 0;
let workFrames = 0;
let lastWork = 0;
let averageWork = 0;
let frames = 0;
let audioReady = false;
const workSamples = [];

function medianWork() {
  if (workSamples.length === 0) return 0;
  const sorted = [...workSamples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function frame(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  frames += 1;

  const started = performance.now();
  game.advance(dt);
  renderer.render(game, view, { reducedMotion });
  syncState();
  updateScore();
  updateBest();
  const work = performance.now() - started;
  lastWork = work;
  averageWork = averageWork === 0 ? work : averageWork * 0.9 + work * 0.1;
  workSamples.push(work);
  if (workSamples.length > 60) workSamples.shift();

  workTotal += work;
  workFrames += 1;
  if (workFrames >= 45) {
    const average = workTotal / workFrames;
    workTotal = 0;
    workFrames = 0;
    if (average > 11 && qualityFactor > 0.5) {
      qualityFactor = Math.max(0.5, qualityFactor - 0.25);
      layout();
    } else if (average < 5.5 && qualityFactor < 1) {
      qualityFactor = Math.min(1, qualityFactor + 0.25);
      layout();
    }
  }

  requestAnimationFrame(frame);

  // Setting up the audio can take a moment, so it happens once the first
  // frame is on screen instead of while the player is tapping.
  if (!audioReady) {
    audioReady = true;
    setTimeout(() => audio.prepare(), 0);
  }
}

// ------------------------------------------------------------------ input

function flap() {
  audio.unlock();
  game.flap();
}

function togglePause() {
  if (game.state === STATE.PLAYING) {
    game.pause();
  } else if (game.state === STATE.PAUSED) {
    game.resume();
    audio.unlock();
  }
}

createInput(canvas, {
  onFlap: flap,
  onPause: togglePause,
  onFocus: (visible) => {
    if (!visible && game.state === STATE.PLAYING) {
      game.pause();
    }
    if (visible) {
      audio.resume();
    }
  },
});

btnPause.addEventListener('click', (event) => {
  event.stopPropagation();
  togglePause();
});

btnAgain.addEventListener('click', (event) => {
  event.stopPropagation();
  audio.unlock();
  game.restart();
  bestAtRunStart = game.best;
});

btnSound.addEventListener('click', (event) => {
  event.stopPropagation();
  const muted = !audio.muted;
  audio.setMuted(muted);
  btnSound.setAttribute('aria-pressed', String(muted));
  btnSound.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  if (!muted) audio.flap();
});

btnMotion.addEventListener('click', (event) => {
  event.stopPropagation();
  reducedMotion = !reducedMotion;
  writeSetting(CONFIG.storage.reducedMotion, reducedMotion);
  btnMotion.setAttribute('aria-pressed', String(reducedMotion));
  game.reducedMotion = reducedMotion;
});

// Keep the audio context alive when the player comes back to the tab.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    audio.resume();
    updateRecordNote();
  }
});

// "set 3 hours ago" has to keep up with the clock.
setInterval(() => {
  if (game.state === STATE.READY) updateRecordNote();
}, 30_000);

// ------------------------------------------------------------- wake lock

async function updateWakeLock() {
  const wanted = game.state === STATE.PLAYING;
  try {
    if (wanted && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    } else if (!wanted && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

// ------------------------------------------------------------------- boot

btnSound.setAttribute('aria-pressed', String(audio.muted));
btnSound.setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
btnMotion.setAttribute('aria-pressed', String(reducedMotion));
game.reducedMotion = reducedMotion;

layout();
syncState();
updateBest();

if ('ResizeObserver' in window) {
  new ResizeObserver(scheduleLayout).observe(app);
}
window.addEventListener('resize', scheduleLayout);
window.addEventListener('orientationchange', scheduleLayout);

requestAnimationFrame(frame);

// A small hook so the automated tests can drive the game deterministically.
window.__flappy = {
  game,
  get state() {
    return game.state;
  },
  get score() {
    return game.score;
  },
  get best() {
    return game.best;
  },
  get reducedMotion() {
    return reducedMotion;
  },
  flap,
  togglePause,
  restart: () => game.restart(),
  kill: () => {
    game.bird.y = game.groundY;
    game.update(1 / 120);
  },
  setReducedMotion(value) {
    reducedMotion = Boolean(value);
    writeSetting(CONFIG.storage.reducedMotion, reducedMotion);
    btnMotion.setAttribute('aria-pressed', String(reducedMotion));
    game.reducedMotion = reducedMotion;
  },
  perf() {
    return {
      work: lastWork,
      averageWork,
      medianWork: medianWork(),
      qualityFactor,
      dpr: pixelRatio(),
      frames,
    };
  },
  version: '1.0.0',
};
