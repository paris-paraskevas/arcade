# Breakout

A self-contained brick-breaker built with pure HTML5 Canvas and vanilla JavaScript. No libraries, no build step, no server — just double-click `index.html`.

## Controls

- **Move paddle:** Mouse, or `←` / `→` (also `A` / `D`)
- **Launch ball:** `Space` or click/tap
- **Pause:** `P`
- **Back to hub:** the `‹ arcade` link under the canvas

## How it works

A delta-time `requestAnimationFrame` loop updates the ball with sub-stepped motion (so a fast ball never tunnels through bricks) and resolves brick hits via AABB collision, reflecting off whichever face has the shallower overlap. The paddle bounce angle is derived from where the ball strikes — dead center sends it straight up, the edges kick it out at up to 60°, giving the classic feel. Clear every brick to advance a level (faster ball, more rows); lose all 3 lives and it's game over. High score persists in `localStorage`.

## Tweak ideas

- Change `BASE_SPEED`, `MAX_SPEED`, or the per-level ramp in `buildLevel()` to make it easier or more frantic.
- Add brick durability: give each brick a `hits` count, draw it darker per hit, and only destroy it at zero.
- Drop occasional power-ups from broken bricks (wider paddle, multi-ball, sticky paddle) for extra spice.
