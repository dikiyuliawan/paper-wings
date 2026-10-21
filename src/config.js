/**
 * Every tunable number in the game lives here.
 *
 * Units are "world units" (uw). The virtual world is `designHeight` tall and at
 * least `minViewWidth` wide; the renderer scales that world to fit the canvas so
 * the game plays identically on every screen size.
 */

export const CONFIG = {
  world: {
    /** Minimum visible world width (uw). Narrow phones are never squeezed below this. */
    minViewWidth: 360,
    /** Canonical visible world height (uw). Tall screens show more sky/ground. */
    designHeight: 640,
    /** Thickness of the scrolling ground strip (uw). */
    groundThickness: 84,
    /** Extra space kept clear at the top of the screen for the HUD (uw). */
    topMargin: 78,
  },

  bird: {
    /** Bird x as a fraction of the visible width, capped so it stays near the left. */
    screenRatio: 0.28,
    maxScreenX: 210,
    /** Collision radius (uw). The drawn bird is much larger -> forgiving hitbox. */
    radius: 11,
    gravity: 2100,
    /**
     * A flap lifts the bird by v^2 / 2g = 80 world units. That is deliberately
     * a little smaller than the tightest opening (150 units, so the bird has
     * +/-64 units of room), so a steady hover always fits inside a gap.
     */
    flapVelocity: -580,
    maxFall: 1000,
    /** How far above the top of the world the bird may fly. */
    ceilingY: -30,
    /** Rotation (radians) mapped from vertical velocity. */
    rotUp: -0.42,
    rotLevel: -0.1,
    rotDown: 1.3,
    /** Exponential smoothing rate for the rotation (higher = snappier). */
    rotSmooth: 18,
    /** Seconds the raised wing stays up after a flap. */
    wingDuration: 0.28,
  },

  pipes: {
    width: 64,
    /** Horizontal distance between two columns (uw) -> constant time gap. */
    spacing: 245,
    gapMax: 205,
    gapMin: 150,
    /**
     * Max vertical change of the gap centre between two consecutive columns (uw).
     * Kept below the flap lift (80uw) plus the hover margin so that a player
     * can always reach the next opening in time.
     */
    maxCenterDelta: 85,
    /** Keep the gap this far above the ground (uw). */
    bottomMargin: 30,
    /** Columns are spawned once they are this far off the right edge (uw). */
    spawnMargin: 80,
  },

  speed: {
    min: 170,
    max: 270,
    /** Number of columns scored before reaching the maximum difficulty. */
    rampPipes: 18,
  },

  loop: {
    /** Simulation timestep (seconds). Fixed -> identical results at any frame rate. */
    fixedDt: 1 / 120,
    /** Maximum simulation steps per animation frame (anti spiral-of-death). */
    maxSteps: 8,
    /** A frame longer than this is treated as a stall (tab switch) and skipped. */
    maxFrameDt: 0.25,
  },

  effects: {
    shakeDuration: 0.32,
    shakeMagnitude: 9,
    featherCount: 8,
    featherLife: 0.9,
  },

  storage: {
    best: 'paperwings.best.v1',
    muted: 'paperwings.muted.v1',
    reducedMotion: 'paperwings.reducedmotion.v1',
  },
};

/**
 * Map a CSS pixel size to the virtual world.
 * The world is always at least `minViewWidth` wide and `designHeight` tall, so
 * tall phones get extra sky/ground instead of a squashed playfield.
 */
export function computeViewport(cssWidth, cssHeight, config = CONFIG) {
  const w = Math.max(1, cssWidth);
  const h = Math.max(1, cssHeight);
  const scale = Math.min(w / config.world.minViewWidth, h / config.world.designHeight);
  return {
    scale,
    viewWidth: w / scale,
    viewHeight: h / scale,
  };
}
