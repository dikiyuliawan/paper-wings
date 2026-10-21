/**
 * Canvas renderer for Paper Wings.
 *
 * Everything that does not move (sky, ridges, trees, clouds, soil) is drawn
 * once into offscreen canvases and then blitted. A frame therefore only
 * re-draws the columns, the bird and a handful of particles, which keeps the
 * game at a steady frame rate on a phone.
 */

import { CONFIG } from './config.js';

const PALETTE = {
  skyTop: '#201442',
  skyUpper: '#4b2765',
  skyMid: '#8c3a6e',
  skyLow: '#d4614f',
  skyHorizon: '#ffc987',
  sun: '#ffe9c2',
  sunGlow: 'rgba(255, 208, 138, 0.5)',
  ridgeFar: '#8a5684',
  ridgeFarShade: '#74456f',
  ridgeMid: '#563a6f',
  ridgeMidShade: '#47305e',
  ridgeNear: '#332650',
  ridgeNearShade: '#281f43',
  tree: '#1c1633',
  cloud: '#f8c9a6',
  cloudShade: '#e2a483',
  soil: '#241c39',
  soilDark: '#1b1530',
  grass: '#3f8a63',
  grassDark: '#2d6b4c',
  stalk: '#2f7d68',
  stalkLight: '#47a287',
  stalkDark: '#1f5a4b',
  leaf: '#3f9e74',
  birdBody: '#ff8f5e',
  birdShade: '#e2643f',
  birdBelly: '#ffe3c4',
  birdWing: '#ffd7a8',
};

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

/** Deterministic pseudo random so the scenery looks the same on every reload. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Renderer {
  constructor(canvas, skyElement) {
    this.canvas = canvas;
    this.skyElement = skyElement;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.viewWidth = CONFIG.world.designHeight;
    this.viewHeight = CONFIG.world.designHeight;
    this.pxPerUnit = 1;
    this.layers = null;
  }

  /**
   * Resize the backing store for the current device pixel ratio.
   * The backing store is scaled by the DPR so the canvas is never blurry.
   */
  resize(cssWidth, cssHeight, dpr, viewWidth, viewHeight) {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.pxPerUnit = dpr;
    this.buildLayers();
  }

  buildLayers() {
    const viewW = this.viewWidth;
    const viewH = this.viewHeight;
    const groundY = viewH - CONFIG.world.groundThickness;

    // --- sky ------------------------------------------------------------
    // The sky never moves, so it lives in a CSS layer instead of being
    // repainted on the canvas every frame.
    this.applySky(viewW, viewH, groundY);

    // --- far ridge ------------------------------------------------------
    const farHeight = 340;
    const far = this.buildRidge(640, farHeight, PALETTE.ridgeFar, PALETTE.ridgeFarShade, 165, 48, 2, 11);

    // --- mid ridge ------------------------------------------------------
    const midHeight = 260;
    const mid = this.buildRidge(480, midHeight, PALETTE.ridgeMid, PALETTE.ridgeMidShade, 112, 34, 3, 29);

    // --- near ridge with trees -----------------------------------------
    const nearHeight = 170;
    const near = this.buildRidge(360, nearHeight, PALETTE.ridgeNear, PALETTE.ridgeNearShade, 68, 20, 4, 47, true);

    // --- clouds ---------------------------------------------------------
    const clouds = this.buildClouds(600, 250, 71);

    // --- soil -----------------------------------------------------------
    const soil = this.buildSoil(200, CONFIG.world.groundThickness, 83);

    this.layers = { far, mid, near, clouds, soil, groundY };
  }

  /** Paints the static sky into a plain CSS background. */
  applySky(viewW, viewH, groundY) {
    if (!this.skyElement) return;
    const horizon = (groundY / viewH) * 100;
    const sunX = ((viewW * 0.72) / viewW) * 100;
    const sunY = ((groundY - 190) / viewH) * 100;
    const sky = this.skyElement.style;
    sky.background = [
      `radial-gradient(circle at ${sunX.toFixed(2)}% ${sunY.toFixed(2)}%, rgba(255, 214, 150, 0.5) 0%, rgba(255, 170, 120, 0.16) 32%, rgba(255, 150, 110, 0) 62%)`,
      `linear-gradient(to bottom, ${PALETTE.skyTop} 0%, ${PALETTE.skyUpper} ${(horizon * 0.24).toFixed(2)}%, ${PALETTE.skyMid} ${(horizon * 0.5).toFixed(2)}%, ${PALETTE.skyLow} ${(horizon * 0.76).toFixed(2)}%, ${PALETTE.skyHorizon} ${horizon.toFixed(2)}%, ${PALETTE.skyHorizon} 100%)`,
    ].join(', ');
  }

  /**
   * A paper-cut ridge. The silhouette is a sum of sines with whole periods,
   * so the left and the right edge match and the tile repeats seamlessly.
   *
   * @param midline  height of the ridge above the ground (world units)
   * @param amplitude how much the silhouette waves up and down
   */
  buildRidge(tileWidth, height, color, shadeColor, midline, amplitude, periods, seed, withTrees = false) {
    const unit = this.pxPerUnit;
    const canvas = makeCanvas(tileWidth * unit, height * unit);
    const ctx = canvas.getContext('2d');
    const random = seededRandom(seed);

    const points = [];
    const steps = 96;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = t * tileWidth;
      const wave =
        Math.sin(t * Math.PI * 2 * periods + seed) * amplitude +
        Math.sin(t * Math.PI * 2 * (periods * 2 + 1) + seed * 0.7) * amplitude * 0.32 +
        Math.sin(t * Math.PI * 2 * (periods * 3 + 2) + seed * 1.3) * amplitude * 0.16;
      points.push([x, height - midline - wave]);
    }

    const draw = (fill, offset) => {
      ctx.beginPath();
      ctx.moveTo(0, height * unit + offset);
      for (const [x, y] of points) ctx.lineTo(x * unit, y * unit + offset);
      ctx.lineTo(tileWidth * unit, height * unit + offset);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    // A darker copy a little lower fakes the paper shadow.
    draw(shadeColor, 7 * unit);
    draw(color, 0);

    if (withTrees) {
      const count = 7;
      for (let i = 0; i < count; i += 1) {
        const t = (i + 0.5) / count + (random() - 0.5) * 0.04;
        const x = ((t % 1) + 1) % 1 * tileWidth;
        const index = Math.min(points.length - 1, Math.floor(t * steps));
        const baseY = points[index][1];
        const size = 26 + random() * 22;
        this.drawTree(ctx, x * unit, baseY * unit, size * unit, unit);
      }
    }
    return canvas;
  }

  drawTree(ctx, x, y, size, unit) {
    const layers = 3;
    ctx.fillStyle = PALETTE.tree;
    for (let i = 0; i < layers; i += 1) {
      const t = i / layers;
      const halfWidth = size * (0.42 - t * 0.24);
      const top = y - size * (1 - t * 0.28);
      const bottom = y - size * 0.22 * (layers - i);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + halfWidth, bottom);
      ctx.lineTo(x - halfWidth, bottom);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(x - size * 0.06, y - size * 0.3, size * 0.12, size * 0.32);
  }

  buildClouds(tileWidth, height, seed) {
    const unit = this.pxPerUnit;
    const canvas = makeCanvas(tileWidth * unit, height * unit);
    const ctx = canvas.getContext('2d');
    const random = seededRandom(seed);

    const count = 5;
    for (let i = 0; i < count; i += 1) {
      const cx = ((i + 0.25 + random() * 0.5) % 1) * tileWidth;
      const cy = 18 + random() * (height - 60);
      const scale = 0.55 + random() * 0.6;
      this.drawCloud(ctx, cx * unit, cy * unit, 24 * scale * unit, unit, random);
    }
    return canvas;
  }

  drawCloud(ctx, x, y, size, unit, random) {
    const puffs = 4 + Math.floor(random() * 3);
    const shade = PALETTE.cloudShade;
    const fill = PALETTE.cloud;

    const puff = (cx, cy, r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    };

    ctx.fillStyle = shade;
    const offset = size * 0.1;
    for (let i = 0; i < puffs; i += 1) {
      const px = x + (i - (puffs - 1) / 2) * size * 0.42;
      const py = y + offset + Math.sin(i * 1.7) * size * 0.07;
      puff(px, py, size * (0.3 + random() * 0.1));
    }
    ctx.fillStyle = fill;
    for (let i = 0; i < puffs; i += 1) {
      const px = x + (i - (puffs - 1) / 2) * size * 0.42;
      const py = y + Math.sin(i * 1.7) * size * 0.07;
      puff(px, py, size * (0.3 + random() * 0.1));
    }
  }

  buildSoil(tileWidth, height, seed) {
    const unit = this.pxPerUnit;
    const canvas = makeCanvas(tileWidth * unit, height * unit);
    const ctx = canvas.getContext('2d');
    const random = seededRandom(seed);

    ctx.fillStyle = PALETTE.soil;
    ctx.fillRect(0, 0, tileWidth * unit, height * unit);

    // grass on top
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, tileWidth * unit, 9 * unit);
    ctx.fillStyle = PALETTE.grassDark;
    ctx.fillRect(0, 9 * unit, tileWidth * unit, 4 * unit);

    // little tufts of grass
    ctx.strokeStyle = PALETTE.grass;
    ctx.lineWidth = Math.max(1, 1.6 * unit);
    ctx.lineCap = 'round';
    for (let i = 0; i < 22; i += 1) {
      const x = random() * tileWidth * unit;
      const h = (5 + random() * 7) * unit;
      ctx.beginPath();
      ctx.moveTo(x, 9 * unit);
      ctx.quadraticCurveTo(x + 2 * unit, 9 * unit - h * 0.6, x + (random() - 0.5) * 6 * unit, 9 * unit - h);
      ctx.stroke();
    }

    // pebbles in the soil
    for (let i = 0; i < 26; i += 1) {
      const x = random() * tileWidth * unit;
      const y = 18 * unit + random() * (height - 24) * unit;
      const r = (1 + random() * 2.2) * unit;
      ctx.fillStyle = random() > 0.5 ? PALETTE.soilDark : '#2e2447';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas;
  }

  // --------------------------------------------------------------- drawing

  drawTile(tile, tileWidth, worldY, worldHeight, offset) {
    const ctx = this.ctx;
    let start = offset % tileWidth;
    if (start > 0) start -= tileWidth;
    for (let x = start; x < this.viewWidth; x += tileWidth) {
      ctx.drawImage(tile, x, worldY, tileWidth, worldHeight);
    }
  }

  render(game, view, options = {}) {
    const ctx = this.ctx;
    const viewW = view.viewWidth;
    const viewH = view.viewHeight;
    const scale = view.scale;
    const groundY = viewH - CONFIG.world.groundThickness;
    const layers = this.layers;
    if (!layers) return;

    const shake = options.reducedMotion ? 0 : game.shake;
    const amount = shake * CONFIG.effects.shakeMagnitude;
    const offsetX = amount ? (Math.random() * 2 - 1) * amount : 0;
    const offsetY = amount ? (Math.random() * 2 - 1) * amount : 0;

    ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);

    ctx.setTransform(
      this.dpr * scale,
      0,
      0,
      this.dpr * scale,
      offsetX * this.dpr * scale,
      offsetY * this.dpr * scale,
    );

    // sun
    this.drawSun(ctx, viewW, viewH, groundY);

    // clouds (far)
    this.drawTile(layers.clouds, 600, groundY - 520, 250, game.scroll * 0.08);

    // far ridge
    this.drawTile(layers.far, 640, groundY - 340, 340, game.scroll * 0.12);

    // mid ridge
    this.drawTile(layers.mid, 480, groundY - 260, 260, game.scroll * 0.22);

    // near ridge
    this.drawTile(layers.near, 360, groundY - 170, 170, game.scroll * 0.38);

    // soil
    this.drawTile(layers.soil, 200, groundY, CONFIG.world.groundThickness, game.scroll);

    // columns
    for (const pipe of game.pipes) {
      const topEnd = pipe.center - pipe.gap / 2;
      const bottomStart = pipe.center + pipe.gap / 2;
      this.drawStalk(ctx, pipe.x, pipe.width, -60, topEnd, true);
      this.drawStalk(ctx, pipe.x, pipe.width, bottomStart, groundY, false);
    }

    // feathers
    if (!options.reducedMotion) {
      for (const feather of game.feathers) {
        this.drawFeather(ctx, feather);
      }
    }

    // bird
    this.drawBird(ctx, game);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawSun(ctx, viewW, viewH, groundY) {
    const cx = viewW * 0.72;
    const cy = groundY - 190;
    const r = 52;
    ctx.save();
    for (let i = 4; i >= 1; i -= 1) {
      ctx.globalAlpha = 0.07 * i;
      ctx.fillStyle = PALETTE.sunGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (1 + i * 0.42), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.sun;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawStalk(ctx, x, width, yTop, yBottom, isTop) {
    if (yBottom <= yTop) return;
    const radius = width * 0.22;

    // shadow side
    ctx.fillStyle = PALETTE.stalkDark;
    this.roundedRect(ctx, x, yTop, width, yBottom - yTop, radius);
    ctx.fill();

    // body
    ctx.fillStyle = PALETTE.stalk;
    this.roundedRect(ctx, x + width * 0.1, yTop, width * 0.78, yBottom - yTop, radius);
    ctx.fill();

    // highlight
    ctx.fillStyle = PALETTE.stalkLight;
    this.roundedRect(ctx, x + width * 0.22, yTop, width * 0.2, yBottom - yTop, radius * 0.6);
    ctx.fill();

    // nodes
    ctx.fillStyle = PALETTE.stalkDark;
    const nodeHeight = Math.max(3, width * 0.07);
    const first = isTop ? yBottom - 26 : yBottom - 26;
    for (let y = first; y > yTop; y -= 52) {
      ctx.fillRect(x + width * 0.08, y, width * 0.82, nodeHeight);
    }

    // a couple of leaves on the top column
    if (isTop) {
      ctx.fillStyle = PALETTE.leaf;
      const leafY = yBottom - 34;
      ctx.beginPath();
      ctx.moveTo(x + width * 0.06, leafY);
      ctx.quadraticCurveTo(x - width * 0.55, leafY - 16, x - width * 0.5, leafY - 4);
      ctx.quadraticCurveTo(x - width * 0.3, leafY + 8, x + width * 0.06, leafY + 6);
      ctx.closePath();
      ctx.fill();
    }
  }

  roundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  drawFeather(ctx, feather) {
    ctx.save();
    ctx.translate(feather.x, feather.y);
    ctx.rotate(feather.rotation);
    ctx.globalAlpha = Math.max(0, Math.min(1, feather.life / (feather.maxLife * 0.6)));
    ctx.fillStyle = PALETTE.birdBody;
    ctx.beginPath();
    ctx.ellipse(0, 0, feather.size, feather.size * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawBird(ctx, game) {
    const bird = game.bird;
    const x = game.birdX;
    const y = bird.y;

    // Wing angle: up right after a flap, then slowly back down.
    const since = game.time - bird.flapAt;
    const flap = since >= 0 && since < CONFIG.bird.wingDuration
      ? 1 - since / CONFIG.bird.wingDuration
      : 0;
    const wingAngle = -0.9 + (1 - flap) * 1.5;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bird.rotation);

    // tail
    ctx.fillStyle = PALETTE.birdShade;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-26, -8);
    ctx.lineTo(-22, 4);
    ctx.closePath();
    ctx.fill();

    // body
    ctx.fillStyle = PALETTE.birdBody;
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // belly
    ctx.fillStyle = PALETTE.birdBelly;
    ctx.beginPath();
    ctx.ellipse(2, 6, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // wing
    ctx.save();
    ctx.translate(-1, 1);
    ctx.rotate(wingAngle);
    ctx.fillStyle = PALETTE.birdWing;
    ctx.beginPath();
    ctx.moveTo(2, -2);
    ctx.quadraticCurveTo(-6, -16, -16, -8);
    ctx.quadraticCurveTo(-10, -2, -4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // beak
    ctx.fillStyle = '#ffcf5c';
    ctx.beginPath();
    ctx.moveTo(13, -2);
    ctx.lineTo(26, 1);
    ctx.lineTo(13, 5);
    ctx.closePath();
    ctx.fill();

    // eye
    ctx.fillStyle = '#fffaf2';
    ctx.beginPath();
    ctx.arc(7, -5, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a1b3d';
    ctx.beginPath();
    ctx.arc(8.6, -5, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
