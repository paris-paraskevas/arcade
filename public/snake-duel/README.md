# Snake Duel

Local 2-player Snake in pure HTML5 Canvas + vanilla JS. No build step,
no libraries, no asset files — just double-click `index.html`.

## Controls
- **Player 1** — `W A S D` to turn
- **Player 2** — Arrow keys to turn
- **Space** (or **Enter**) — start the match, advance to the next round, or rematch

## How it works
Two snakes share one 32×32 grid and both advance on the same fixed tick.
A snake is eliminated if its head leaves the board or lands on any
snake's body (its own or the rival's); a head-on swap or a tie for the
same cell kills both. The last snake alive takes the round (both dying
on the same tick is a draw), and the first player to 3 round wins takes
the match. Eating a pellet grows that snake, scores a point, and nudges
the tick a touch faster, so each round speeds up the longer it runs.

## Tweak ideas
- Change the feel: edit `START_TICK`, `MIN_TICK`, and `SPEEDUP` near the top of `game.js`.
- Longer or shorter matches: change `TARGET_WINS`.
- Busier board: bump `FOOD_COUNT`, or resize the arena via `COLS` / `ROWS`.
- Recolor a player: edit the `PLAYERS` palette objects (head / body / glow / eye).
- Wrap-around walls: in `step()`, replace the wall-death check with `(h.x + COLS) % COLS` / `(h.y + ROWS) % ROWS`.
