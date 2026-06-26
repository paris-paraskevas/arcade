# Pong

The classic. Two paddles, one ball, first to **11** wins. Play **1P vs CPU** or **2P** local.

## Controls
- **Left paddle:** `W` / `S`
- **Right paddle:** `↑` / `↓`
- **Space** (or click/tap): serve / start, and restart after a win
- **Title screen:** press `1` for 1P (vs CPU) or `2` for 2P

## How it works
The ball bounces off the top and bottom walls and off the paddles. Its bounce angle depends on *where* it strikes the paddle — hit it dead-center for a flat return, catch it near an edge for a steep one — and a moving paddle adds a little spin. Each paddle hit nudges the ball slightly faster (capped), so rallies escalate; a point is scored when the ball gets past a paddle, and the next serve goes to the player who was scored on. The CPU tracks the ball with a capped speed and a deliberate aim wobble that tightens as the ball speeds up, so it's beatable early but fierce in long rallies.

## Tweak ideas
- Change `WIN_SCORE` for shorter/longer matches, or `MAX_BOUNCE` for flatter/steeper returns.
- Make the CPU easier or harder via `CPU_BASE_SPEED` / `CPU_MAX_SPEED` and the `errorAmp` wobble in `updateCPU`.
- Adjust `BASE_SPEED`, `SPEEDUP` and `MAX_SPEED` to retune how fast rallies heat up.
