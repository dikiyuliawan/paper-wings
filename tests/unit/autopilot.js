/**
 * A simple autopilot used by the fuzz test.
 *
 * It hovers inside the current opening: after a flap the bird rises
 * `v^2 / 2g` units and sinks back, so it keeps flapping at a fixed height and
 * the whole cycle stays inside the gap. When the opening moves, the hover
 * height follows it.
 *
 * If this bot can fly a course, a human can too.
 */

export function createAutopilot(game) {
  const cfg = game.config;
  const gravity = cfg.bird.gravity;
  const flapVelocity = cfg.bird.flapVelocity;
  const lift = (flapVelocity * flapVelocity) / (2 * gravity);

  return function autopilotStep() {
    const bird = game.bird;

    // The opening we are heading for.
    let target = game.startY();
    let gap = cfg.pipes.gapMax;
    for (const pipe of game.pipes) {
      if (!pipe.scored && pipe.x + pipe.width > game.birdX - 2) {
        target = pipe.center;
        gap = pipe.gap;
        break;
      }
    }

    // Height at which the bird tops out its arc: centred on the opening.
    const flapHeight = target + lift / 2;

    // Never let the bird sink into the ground.
    if (bird.y > game.groundY - 60) {
      game.flap();
      return;
    }

    // Highest point of the arc the bird is currently on.
    const peak = bird.vy < 0 ? bird.y - (bird.vy * bird.vy) / (2 * gravity) : bird.y;

    if (peak > flapHeight + 4) {
      // The arc tops out too low: add lift right away.
      game.flap();
      return;
    }
    if (bird.vy >= 0 && bird.y >= flapHeight - 4) {
      // Back at the flap height with the arc spent: start the next cycle.
      game.flap();
      return;
    }
    // Otherwise the bird is on its way up or still above the flap height:
    // glide.
  };
}
