# Match Three

A Bejeweled-style gem swapper. An 8x8 board of seven distinctly-shaped,
distinctly-coloured gems. Swap two adjacent gems to line up three or more of a
kind; matches clear, gems above fall to fill the gaps, fresh gems drop in from
the top, and any new lines formed by the fall chain into **combos** worth
escalating points. You get 25 moves to score as high as you can.

## Controls
- **Click** a gem, then click an adjacent gem to swap them.
- Or **click-drag** a gem toward the neighbour you want to swap with.
- **Space / Enter** — start, and restart after game over (**R** also restarts mid-game).

## How it works
Each frame runs a small phase state machine (`idle → swap → pop → fall → …`)
that locks input while gems slide, shrink-pop, and fall under gravity. A swap is
only accepted if it produces a match (otherwise the gems slide back and no move
is spent). After gems settle, the board is re-scanned: if the fall created new
matches the `combo` multiplier climbs and the match pitch rises with it. The
starting board is seeded with no pre-existing matches, and if a refill ever
leaves no legal move the board reshuffles itself.

## Tweak ideas
- Swap the move limit for a countdown timer (replace `moves` with a `timeLeft`
  that ticks down in `update`).
- Change `START_MOVES`, `BASE_MATCH`, or `TYPES` (fewer gem types = easier).
- Add a special "line clear" gem when you match 4+ in a row.
