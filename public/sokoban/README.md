# Sokoban

A classic box-pushing puzzle. Push every crate onto a glowing target to clear the level; clear all 8 hand-designed levels (escalating difficulty) to win.

## Controls
- **Arrow keys / WASD** — move and push
- **U** — undo last move
- **R** — restart the level
- **Space / Enter** (or click) — start the game and advance after a solve

## How it works
The map is split into a static grid (walls + targets) and a live list of box positions plus the player, so a box can sit "on" a target without erasing the goal. A move tries to step the player by one tile; if a box is in the way it's pushed only when the cell beyond it is empty — you can never pull a box or shove it into a wall or another box. A level is solved the instant every box rests on a target. Levels are authored as ASCII maps (`#` wall, `@` player, `$` box, `.` target, `*` box-on-target, `+` player-on-target) and each is verified winnable by a small built-in BFS solver (with dead-corner pruning) that runs once at load.

## Tweak ideas
- Add your own ASCII maps to the `LEVELS` array — they'll be auto-checked for solvability.
- Track and display "pushes" alongside "moves" for a tighter scoring challenge.
- Add a per-level par (minimum pushes) and a star rating for beating it.
