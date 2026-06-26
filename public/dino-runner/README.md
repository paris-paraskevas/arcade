# Dino Runner

A Chrome-dino-style endless runner. The character auto-runs while the world scrolls left and steadily speeds up. Jump over cacti, duck under birds, survive as long as you can.

## Controls
- **Space** / **↑** — jump (hold longer for a higher jump)
- **↓** — duck (also fast-falls in the air)
- **Space** / **↑** — start the game and restart after a crash

## How it works
The world scrolls left at a speed that creeps up the longer you survive, so it starts gentle and gets genuinely hard. Obstacles spawn ahead with a gap that shrinks as you speed up (but never closer than you can clear); ground cacti come in 1–3 stalk clusters, and flying birds appear once you're fast enough — the low ones must be ducked. Collision is a tight AABB check; your distance becomes the score, and the best run is saved in `localStorage`. A slow day/night cycle drifts behind everything, and audio (jump blip, milestone beep, death thud) is built with WebAudio on first input.

## Tweak ideas
- Tune the feel via the constants near the top: `START_SPEED`, `MAX_SPEED`, `SPEED_RAMP` (difficulty curve), `JUMP_V` / `GRAVITY` / `JUMP_CUT` (jump arc), and `FLYER_SPEED` (when birds appear).
- Adjust `scheduleNextSpawn()` to change how tightly obstacles are packed, or the cluster-size odds in `spawnObstacle()`.
- Speed up the day/night flip by raising the `state.dayNight` increment in `update()`.
