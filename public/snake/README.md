# Snake

The classic arcade Snake, in pure HTML5 Canvas + vanilla JS. No build step,
no libraries, no asset files — just double-click `index.html`.

## Controls
- **Arrow keys** or **WASD** — turn
- **Space** — start from the title screen / restart after game over

## How it works
The board is a 24×24 grid and the snake is just a list of cells (head first).
On each tick the game adds a new head cell in the current direction and drops
the tail — unless it landed on food, in which case the tail stays and the snake
grows, the score ticks up, and the speed nudges up a little. Input and drawing
run every animation frame, but movement only advances on a fixed tick timer,
which is what keeps the motion grid-crisp.

## Tweak ideas
- Change the feel: edit `START_TICK`, `MIN_TICK`, and `SPEEDUP` near the top of `game.js`.
- Resize the board: change `COLS` / `ROWS` (keep them equal to the canvas size for square cells).
- Add wrap-around walls: in `step()`, replace the wall-collision `die()` with `(nx + COLS) % COLS` / `(ny + ROWS) % ROWS`.
- Recolor: tweak the `C` palette object (try a different food or snake accent).
