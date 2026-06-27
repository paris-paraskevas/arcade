# Air Hockey

Local 2-player (or 1-player vs a simple CPU) air hockey on a portrait table. Pure HTML5 Canvas + vanilla JS — no libraries, no asset files. Just double-click `index.html`.

## Controls
- **Player 1** (bottom mallet): `W` `A` `S` `D` to move in 2D
- **Player 2** (top mallet): arrow keys `← ↑ ↓ →`
- **Space** / **Enter** (or a click): start match · serve the puck · rematch
- On the title: `1` = vs CPU, `2` = two-player. On game-over: `T` returns to title.

## How it works
The puck slides on near-frictionless "ice", capped to a max speed so rallies stay fast but controllable, and bounces off the side rails. Each mallet is confined to its own half; when it touches the puck the puck is pushed out along the line between their centres and gains a share of the mallet's velocity — so a moving mallet (and the contact point) decides the puck's new angle and speed. Knock the puck through the opponent's goal mouth to score; first to **7** wins and the puck re-centres after every goal, served back toward whoever conceded.

## Tweak ideas
- Change `TARGET_SCORE` for shorter/longer matches, or `PUCK_MAX` / `FRICTION` to make the ice faster or stickier.
- Bump `HIT_TRANSFER` and `RESTITUTION` for harder, more chaotic hits, or raise `MALLET_SPEED` for twitchier mallets.
- Make the CPU tougher by raising its speed multiplier in `driveCPU()` (currently `0.92`).
