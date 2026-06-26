# Space Invaders

A from-scratch take on the arcade classic — pure HTML5 canvas + vanilla JS, no
libraries, no build step. Just double-click `index.html`.

## Controls
- **← →** or **A D** — move the cannon
- **Space** — shoot (one shot on screen at a time, just like the original)
- **Space / Enter** — start, and restart after game over

## How it works
A 5×11 formation of aliens marches side to side; when it touches an edge it steps
down and reverses. The fewer aliens left alive, the *shorter* the time between
steps — so the swarm accelerates into a frantic finish (the core tension of the
game). Aliens drop bombs from their front-most ranks, you hide behind four
destructible shields, and an occasional bonus UFO slides across the top for
mystery points. Clear a wave and the next one starts lower and faster. You get 3
lives; it's game over when bombs hit you three times or the swarm reaches your
row. Back rows score more (30 / 20 / 10), and your best is saved in
`localStorage`.

## Tweak ideas
- Edit the speed curve in `currentStepInterval()` to make the march ramp gentler
  or more brutal.
- Raise `MAX_PLAYER_BULLETS` for a more forgiving rapid-fire feel.
- Bump `BASE_BOMB_CHANCE` or the per-wave bomb scaling for a heavier barrage,
  or change `STEP_DOWN` / `FORMATION_TOP` to alter how fast the swarm closes in.
