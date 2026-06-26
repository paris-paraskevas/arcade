# Whack-a-Mole

A 60-second arcade reflex game on a 3x3 grid. Moles pop up from random holes
for a brief window — click them before they duck back down. Pure HTML5 Canvas
and vanilla JS, no libraries or asset files. Just double-click `index.html`.

## Controls
- **Mouse / touch** — click (or tap) a mole to whack it.
- **1–9** — number keys map to the nine holes (top-left to bottom-right).
- **Space / Enter** — start, and restart after the timer runs out.

## How it works
Each of the nine holes runs a tiny state machine (`empty → rising → up →
falling`) and the mole is clipped to its hole so it looks like it's climbing
out of the ground. A scheduler pops moles from random empty holes; as the clock
ticks down, `progress` (0→1) ramps the difficulty — spawns come faster, the
"up" window shrinks, double pop-ups appear, and **bombs** (don't hit them!)
start mixing in. Whacking moles in a row builds a combo that boosts the score
multiplier; a miss or a bomb resets it. Best score is saved to `localStorage`.

## Tweak ideas
- Change `GAME_TIME`, `BOMB_CHANCE`, or `HIT_PENALTY` at the top of `game.js`
  to retune length and risk.
- Adjust `SPAWN_MIN`, `UP_MAX`/`UP_MIN`, and `DOUBLE_AT` to reshape the
  difficulty curve.
- Grow the board to 4x4 by bumping `COLS`/`ROWS` (the geometry derives from them).
