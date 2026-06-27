# Bubble Shooter

A Puzzle-Bobble style arcade game. Aim the launcher at the bottom, fire colored
bubbles up the screen, and clear the field by matching colors.

## Controls
- **Mouse** — aim the launcher
- **Click** or **Space** — shoot
- **Space / Enter** (or click) — start, continue, and restart

## How it works
Bubbles fly upward, bounce off the side walls, and snap onto an offset (hex-style)
grid when they hit the ceiling or another bubble. Land a bubble so it forms a
connected group of **3 or more of the same color** and that group pops; any
bubbles left dangling (no longer connected to the ceiling) drop for bonus points.
The whole field descends a row every few shots — clear it to advance a level,
but if the bubbles cross the dashed danger line it's game over.

## Tweak ideas
- Change `shotsPerDescend` (and its level scaling in `startNextLevel`) to make
  the field push down faster or slower.
- Adjust `BASE_COLORS` / `MAX_COLORS` for an easier or harder color mix.
- Bump `SHOT_SPEED` for snappier shots, or tune the per-pop / per-drop score in
  `resolveMatches`.
