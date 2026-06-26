# Weekend Racer

A pseudo-3D arcade racer (OutRun-style) in pure HTML5 Canvas + vanilla JS.
No build step, no libraries, no asset files.

## Play
Double-click `index.html` (or open it in any browser).

- **↑ / W** accelerate · **↓ / S** brake · **← → / A D** steer
- **Space** start / restart
- Goal: keep racing before the clock hits zero. Each completed **lap = +25s**.
  Hitting traffic or driving on the grass bleeds your speed (and time).

## How the fake 3D works
There is no 3D engine. The road is a list of flat **segments** at increasing
depth `z` (see `addSegment` / `addRoad`). Every frame, `render()` walks the
segments near-to-far and `project()` maps each to the screen with plain
perspective (`scale = cameraDepth / cameraZ`). Curves are an illusion — we shift
each segment sideways by an accumulating `dx`; hills come from varying each
segment's world `y`. Cars are flat images scaled by the same `scale`.

That's the whole trick, and it's the same one Pole Position and OutRun used.

## Tweak it
Everything is in `game.js`. Good first edits:
- `CONFIG.roadWidth`, `fov`, `cameraHeight` — the look of the road.
- `MAX_SPEED`, `ACCEL`, `CONFIG.centrifugal` — the handling.
- `buildTrack()` — design your own course via `addRoad(enter, hold, leave, curve, height)`.
- `buildTraffic(60)` — more or less traffic.

## Ideas to grow it (later)
Opponents you actually race, multiple tracks, a real finish line, roadside
scenery, gear-shifting, a nitro boost, touch controls.
