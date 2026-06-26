# 2048

Slide the numbered tiles around a 4x4 grid; equal tiles that bump into each other merge into their sum. Get a tile to **2048** to win — then keep going for a higher score.

## Controls
- **← ↑ → ↓** or **WASD** — slide all tiles
- **R** — restart (also starts from the title)
- **Enter** — start / restart
- **Space** — dismiss the win banner and keep playing

## How it works
Each arrow slides every tile as far as it can go in that direction, then merges equal neighbours (each tile merges at most once per move). The whole game is one "slide a row left" routine reused for all four directions by reading the grid in different orders. A move only spawns a new tile (90% a 2, 10% a 4) if the board actually changed, and it's game over when the board is full with no possible merges. Best score persists in `localStorage`.

## Tweak ideas
- Change `N` for a bigger/smaller board (5x5, 6x6) — geometry recomputes automatically.
- Adjust `ANIM_MS` / `POP_MS` for snappier or bouncier tile motion.
- Edit `TILE_STYLES` to recolor the palette or change the spawn 2-vs-4 odds in `spawnTile()`.
