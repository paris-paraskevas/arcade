# Asteroids

A classic vector-style Asteroids clone — fly a little triangle ship through a wrapping
field of drifting space rocks, blast them apart, and survive as long as you can.

## Controls

- **← → / A D** — rotate
- **↑ / W** — thrust (the ship coasts; let go and you drift)
- **Space** — fire
- **Enter** — start from the title / restart after game over

## How it works

Everything is drawn procedurally on a single HTML5 canvas with vanilla JS — no images,
no audio files, no libraries — so it runs by just double-clicking `index.html`. A
delta-time `requestAnimationFrame` loop moves the ship with vector thrust (acceleration
applied along the facing angle plus light drag), wraps every object around the screen
edges, and splits each rock from large → medium → small on a bullet hit. Score, high
score (saved in `localStorage`), lives, and wave count are shown in the HUD.

## Tweak ideas

- Open `game.js` and bump `THRUST_ACCEL`, `TURN_SPEED`, or `DRAG` to change how the ship
  handles, or `BULLET_SPEED` / `FIRE_COOLDOWN` / `MAX_BULLETS` to retune the gun.
- Make later waves nastier by raising the per-wave speed scale in `spawnWave`, or change
  the per-size points and split counts in the `ROCK` table.
