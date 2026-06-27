# 15 Puzzle

The classic sliding-tile puzzle. A 4x4 grid holds tiles numbered 1–15 plus one
empty space. Slide tiles into the blank until they read 1–15 in order with the
blank in the bottom-right corner.

## Controls
- **Click** a tile next to the blank to slide it in.
- **Arrow keys** (or WASD) slide the neighbouring tile into the blank.
- **Space / Enter / R** — new shuffle / start (R also reshuffles mid-game).

## How it works
The board is a flat array of 16 numbers (0 is the blank); a move is just
swapping the blank with an adjacent tile. The shuffle does ~250 random *legal*
slides from the solved board — that guarantees the puzzle is always solvable
(a fully random permutation of 1–15 is only solvable half the time). Each tile
remembers the cell it came from and glides there with a short ease, and your
fewest-moves / fastest-time records are kept in `localStorage`.

## Tweak ideas
- Change `N` for a 3x3 (8-puzzle) or 5x5 challenge — geometry adapts automatically.
- Raise or lower `SLIDE_SPEED` to taste, or `STEPS` in `shuffle()` for an easier/harder scramble.
- Swap `TILE_BG_OK` for a different "correct spot" tint, or add a move-limit mode.
