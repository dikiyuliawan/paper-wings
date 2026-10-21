# Paper Wings

A one-button arcade flyer through a paper-cut sunset forest. Flap the little
paper bird between bamboo columns, chase a high score, and try not to hit the
ground.

Everything in this repository is original: the art is drawn with Canvas paths
and the sounds are synthesised with the Web Audio API, so the game ships
without a single image or audio file.

```
Space / click / tap  flap
P or Esc            pause
```

## Running it

The game is a static site, so any web server will do. The repository ships
with a tiny zero-dependency one:

```bash
npm start                 # http://localhost:5173
npm start -- 8080         # or pick another port
```

If the port is taken the server tells you and stops, so you can simply try
the next one.

There is no build step and no runtime dependency. `npm install` is only
needed for the tests.

## How to play

* Press **Space**, click or tap to flap. Holding the button does not help:
  every press is one flap.
* The bird rises when you flap and sinks the rest of the time. Its nose tilts
  with its speed, so you can read the arc at a glance.
* You get one point for every column you pass. Your best score is stored in
  the browser and survives a reload, a restart of the browser and coming back
  hours later. The start screen shows the record and when you set it
  ("27 - set 3 hours ago").
* The columns speed up and the openings get tighter the further you get, up
  to a hard cap (see *Difficulty* below). There are no sudden spikes: the
  curve is continuous.
* Press **P**, **Esc** or the pause button to pause. Leaving the tab pauses
  the game automatically.
* After a crash, press anything to start a new run straight away.

## How it is built

```
index.html            markup, HUD and the state panels
styles.css            layout, safe areas, high contrast
src/config.js         every tunable number in the game
src/core.js           the simulation (no DOM, no timers, no canvas)
src/render.js         canvas drawing and the pre-rendered scenery
src/audio.js          synthesised sound effects
src/input.js          keyboard, mouse and touch handling
src/main.js           wiring, the animation loop and the options
scripts/serve.js      the static file server
tests/unit            node:test suite for the simulation
tests/e2e             Playwright suite for the browser behaviour
```

`src/core.js` is a pure module: it never touches the DOM. That is what makes
the game testable in plain Node and what keeps the rules in one place.

### The animation loop

The simulation runs on a **fixed timestep** of 1/120 s. Real elapsed time is
collected in an accumulator and consumed in whole steps, so the game plays
identically at 30, 60 or 144 frames per second - a Playwright test asserts
that the bird is in the exact same place after the same amount of game time at
30 fps and at 144 fps.

A frame longer than 0.25 s (a tab switch, a breakpoint, a phone call) is
discarded instead of being simulated, so the bird never teleports and the run
never ends because you looked away.

### Scaling and high-DPI screens

The world is measured in abstract units and scaled to the window. The world is
always at least 360 units wide and 640 units tall; a tall phone gets extra
sky and ground instead of a squashed playfield, and a wide desktop simply
shows more of the forest. The canvas backing store is sized to
`css size x devicePixelRatio` (capped at 3x, and at 2x on very large
surfaces), so the picture is sharp on retina screens and never stretched.

If a frame ever costs more than 11 ms the renderer quietly lowers the pixel
density (3x, 2.25x, 1.5x) and raises it again when there is headroom.

### Difficulty

| value | |
| --- | --- |
| flap lift | 80 units (`v^2 / 2g`) |
| gravity | 2100 units/s^2 |
| column spacing | 245 units |
| gap | 205 units at the start, down to 150 units |
| speed | 170 units/s, up to 270 units/s |
| ramp | the maximum is reached after 18 columns |

The opening of the next column never moves more than 85 units away from the
current one, and the gap is never smaller than 150 units. Because a flap
lifts the bird 80 units, the openings always overlap vertically, which means
**every generated course can be flown**. The unit test suite proves it: an
autopilot flies 120 randomly generated courses without a single crash.

### The record

The best score is written to `localStorage` the moment it is beaten, together
with the time it was set, so the start screen can say how long ago the record
was made. There is no expiry: a record from this morning is still there
tonight.

If the browser refuses to store anything (private mode, blocked cookies), the
storage layer falls back to `sessionStorage` and then to memory, so the
record is never lost silently. Older versions that stored a plain number are
still read.

### Fair hitboxes

The bird is drawn about 34 x 26 units but collides as a circle with a radius
of 11 units, so grazing a column does not kill you. The columns are rounded
at the edges and the ground is one straight line.

### Parallax

Clouds, three mountain ridges with trees, and the soil are pre-rendered into
offscreen canvases and blitted as tiles. Each tile is built from sines with
whole periods, so the left and the right edge match and the scenery loops
without a jump or a drift. The static sky is a CSS layer, so the canvas only
paints what actually moves.

### Effects

A crash shakes the screen for about a third of a second and scatters a few
feathers. Both are skipped entirely when **reduced motion** is on, which
defaults to your `prefers-reduced-motion` setting and can be toggled with the
button in the corner. The effects never delay the restart: the new run starts
on the very next tap.

### Accessibility

* Everything is reachable with a keyboard, and the game announces the state
  changes to screen readers.
* The buttons are at least 44 x 44 px, have visible focus rings and say what
  they do.
* The colours are chosen for contrast, and the score has a dark outline so it
  stays readable over any part of the sky.
* `prefers-reduced-motion` is respected, and zoom is not disabled.

## Tests

```bash
npm install          # only needed for the tests
npm test             # unit tests, then the browser tests
npm run test:unit    # node:test
npm run test:e2e     # Playwright
```

The unit suite covers the simulation: physics, rotation, the rules for the
generated openings, the solvability fuzz test, scoring, collisions, the state
machine, restarts, frame-rate independence, long stalls and the storage
(including the fallback chain and the record timestamp).

The browser suite (Playwright, driving your installed Chrome) covers the real
thing on a desktop, a Pixel 5 and an iPhone 13 profile: keyboard, mouse and
touch input, page scrolling, repeated restarts, pause and resume, the tab
losing focus, score persistence (including a real browser restart with the
same profile), the record appearing in the corner as soon as you score, the
start screen showing the record and its age, collision boundaries, narrow
screens, resizing, high-DPI screens, reduced motion, the simulation at 30 and
144 fps, and the frame cost on a CPU-throttled phone.

Two helper scripts are handy while working on the game:

```bash
npm run shot -- shot.png 390 844 playing   # screenshot a mobile viewport
npm run perf                                  # frame cost on several profiles
```

## Browser support

Any current browser with Canvas 2D, ES modules and the Web Audio API:
Chrome, Edge, Firefox and Safari on desktop and on phones.
