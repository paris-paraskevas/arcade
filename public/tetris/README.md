# Tetris

Classic falling-block puzzle in pure HTML5 Canvas + vanilla JS. No build step,
no libraries, no asset files. Just double-click `index.html`.

## Controls
- **← →** move · **↓** soft drop · **↑ / X** rotate (cw) · **Z** rotate (ccw)
- **Space** hard drop · **P** pause · **Enter** start / restart

## How it works
Each frame a gravity timer pushes the active piece down one row; when it can't
fall it locks into the grid, full rows are cleared (everything above shifts
down), and the next piece spawns. Pieces come from a **7-bag** randomizer
(all 7 shapes shuffled and dealt before reshuffling) so the order stays fair,
and rotation uses a small **wall-kick** table so spins work flush against walls.

## Tweak ideas
- Change the speed curve in `intervalForLevel()` (lower floor = harder).
- Recolor pieces in the `COLORS` map, or retheme the panel via `ACCENT` / `MUTED`.
- Add a hold-piece slot, or bump line-clear scoring in `clearLines()`.
