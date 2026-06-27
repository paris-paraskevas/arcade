# Tron Light-Cycles

Local 2-player arcade duel. Two neon light-cycles race around an arena grid, each leaving a solid wall of light behind it. Box your opponent in — but don't crash into a wall or any trail (theirs *or* your own). Best of 5 (first to 3 round wins).

## Controls
- **Player 1:** `W` `A` `S` `D`
- **Player 2:** Arrow keys `← ↑ → ↓`
- **Space / Enter** (or click): start a round, advance to the next round, or rematch
- No instant 180° reversals; each player's next turn is buffered so fast taps aren't dropped.

## How it works
Both cycles share one grid and advance together on a fixed movement tick. Each tick every live cycle commits its buffered turn, then we test its target cell: stepping off the arena or into any filled cell is a crash, and both cycles aiming at the same cell is a mutual head-on. Survivors lay trail and advance; the speed ramps up slightly every move, so rounds get tenser the longer they run. Last cycle riding wins the round (both crashing the same tick is a draw), and the match tally persists in `localStorage`.

## Tweak ideas
- Change `START_TICK` / `MIN_TICK` / `SPEEDUP` for faster or more relentless rounds.
- Adjust `CELL` to make the arena finer or coarser, or `TARGET_WINS` for a longer match.
- Swap the `PLAYERS` neon colours, or widen the headlight smear in `drawHeads()`.
