# Minesweeper

The classic logic puzzle: clear every cell that isn't hiding a mine. A 12×14 board with 27 mines (~16%), drawn entirely on an HTML5 Canvas with no libraries or assets. Double-click `index.html` to play — no server or build step.

## Controls
- **Left-click** — reveal a cell
- **Right-click** — plant / remove a flag
- **R** — new game (or click the face in the header)

## How it works
Mines are seeded only *after* your first click, excluding that cell and its eight neighbors, so the opening move can never blow up. Revealing a cell with no adjacent mines triggers a flood fill that opens its whole empty region plus the bordering numbers; each number tells you how many mines touch that cell. You win when every safe cell is revealed and lose the moment you uncover a mine — the board then reveals itself and marks the one you hit. The header shows mines remaining (mines minus flags) and an elapsed timer that starts on your first reveal; your best winning time is saved in `localStorage`.

## Tweak ideas
- Change `COLS`, `ROWS`, and `MINE_RATIO` near the top of `game.js` for an easier or harder board (cell size auto-fits the canvas).
- Edit `NUM_COLORS` to recolor the adjacency numbers, or tweak `drawCovered` / `drawOpen` for a different tile bevel.
