# Connect Four

Drop colored discs into a 7-wide, 6-tall grid. The disc falls to the lowest
empty slot in the column. First player to line up four of their color —
horizontal, vertical, or diagonal — wins, and the four discs get a glowing
highlight plus a little fanfare. Fill the board with no winner and it's a draw.

Two modes, chosen on the title screen:
- **1** — one player vs a CPU (you are RED, the CPU is YELLOW)
- **2** — two-player hotseat (RED and YELLOW take turns at one keyboard)

## Controls
- **← →** — move the column cursor
- **Space / ↓** — drop a disc in the current column
- **Click** — drop directly into the column you click (hover to preview)
- **R** — reset / next round (the starting player alternates each round)
- **1 / 2** — pick or switch mode (works on the title and after a result)

## How it works
The board is a 6×7 array; dropping into a column scans upward for the lowest
empty cell, plays a falling-disc animation, then commits the move. Win
detection runs from the disc that was just placed, counting same-colored discs
in each of the four line directions. The CPU uses a depth-limited **minimax
search with alpha-beta pruning**: it looks several moves ahead, scores
positions by counting open 2-/3-in-a-rows for itself and the opponent (and
favoring central columns), and always grabs an immediate win or blocks one.
Scores persist between rounds via `localStorage`.

## Tweak ideas
- Change `SEARCH_DEPTH` in `game.js` to make the CPU weaker (lower) or
  stronger but slower (higher).
- Adjust the gravity constant in `update()`'s falling-disc block to make discs
  drop faster or slower.
- Retune `scoreWindow` weights to change the CPU's personality (e.g. value
  blocking even more, or play more aggressively for its own threats).
