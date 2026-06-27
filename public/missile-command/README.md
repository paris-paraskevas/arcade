# Missile Command

A classic arcade missile-defense game. Six cities sit along the bottom, guarded by three ammo bases. Enemy missiles rain down from the top — shoot them out of the sky before they level your cities. Open by double-clicking `index.html` (no server, no build).

## Controls
- **Mouse** — aim the crosshair
- **Left click** — launch an interceptor from the nearest base; it flies to the cursor and detonates into an expanding blast
- **Space / Enter** (or a click) — start the game and restart after game over

## How it works
Each click launches an interceptor from whichever ammo base is closest to your cursor (each base holds a limited number, refilled every wave). When the interceptor reaches the cursor it bursts into a growing blast ring; any enemy missile the ring touches is destroyed — and spawns its own blast, so well-placed shots set off chain reactions. Waves escalate in count and speed, and from wave 4 some missiles become MIRVs that split into a fan of warheads on the way down. You score per missile killed plus an end-of-wave bonus for surviving cities and leftover ammo; the game ends when all six cities are gone.

## Tweak ideas
- Change `BASE_AMMO`, `INTERCEPT_SPEED`, or `BLAST_MAX_R` near the top of `game.js` to make defending easier or harder.
- Raise `ENEMY_SPD_STEP` or lower the spawn interval in `updatePlaying()` for a steeper difficulty curve.
- Adjust the MIRV split chance/threshold in `spawnEnemy()` to make splitting warheads appear sooner or more often.
