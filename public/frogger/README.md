# Frogger

The arcade classic, in pure HTML5 Canvas + vanilla JS. No libraries, no asset
files — just double-click `index.html`.

## Controls
- **Arrow keys** or **W A S D** — hop one tile (up / down / left / right)
- **Space** or **Enter** (or a click) — start, restart, and advance to the next level

## How it works
Guide the frog from the bottom bank to the five home slots at the top. The lower
half is a **road**: lanes of cars and trucks scroll at different speeds and
directions, and touching one is instant death. The upper half is a **river**:
logs and turtles drift past, and you must ride them — stepping into open water
(or being carried off-screen) drowns you. Some turtles periodically **dive**
(shown as a ripple ring), so don't linger on them. A grass median sits safely in
between. Fill all five homes to clear the level; each new level speeds everything
up. You get **3 lives** and a per-trip **timer** (the bar at the bottom) that
ends your trip if it runs out. Best score is saved in `localStorage`.

Each lane is one row carrying "movers" that wrap around seamlessly; the frog hops
on a grid and eases between tiles. See `buildLevel()` for the lane layout and
`update()` for the ride-or-drown / collision logic.

## Tweak ideas
- Change `TRIP_TIME` for a tighter or more relaxed clock, or `START_LIVES`.
- Edit the speed multiplier in `buildLevel()` (`1 + (level-1)*0.18`) to ramp
  difficulty faster or slower, or retune individual lane speeds/gaps.
- Add a fly/bonus bug that occasionally appears in a home slot for extra points.
