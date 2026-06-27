# Artillery Duel

Local 2-player, turn-based tank artillery. Two tanks sit on a randomly
generated hilly battlefield and lob shells at each other. Double-click
`index.html` to play — no server, no build.

## Controls
- **← →** — adjust angle
- **↑ ↓** — adjust power
- **Space** — fire (and **Space / Enter** to start & advance rounds)
- **R** — rematch
- Hold the arrow keys to adjust faster
- A **click** on the canvas also starts the game / fires

## How it works
Players alternate turns. On your turn you set angle and power, then fire a
shell that arcs under gravity while a per-round **wind** (shown by the arrow
indicator) pushes it sideways. A direct hit or close blast damages the enemy;
reduce their health to zero to win the round. Shells carve craters into the
terrain, so the ground keeps changing. First to 3 round wins takes the match.

## Tweak ideas
- Change `GRAVITY`, `POWER_TO_SPEED`, or the wind range in `newRound()` for a
  different ballistic feel.
- Bump `BLAST_R` / `HIT_DMG` for deadlier shells, or `ROUNDS_TO_WIN` for a
  longer match.
- Add a third sine term or more amplitude in `generateTerrain()` for wilder hills.
