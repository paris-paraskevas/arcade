# Flappy

A one-button Flappy-Bird-style game. Tap to keep the bird airborne and thread it
through an endless run of scrolling pipes. +1 for every pair you clear; your best
score is saved.

## Controls
- **Space** / **↑** / **Click** (or **tap**) — flap
- Same input starts the game and restarts after a crash

## How it works
The bird falls under constant gravity; each flap snaps its vertical velocity to a
fixed upward impulse, so timing taps is everything. Pipes scroll in from the right
with a gap at a random (but fair) height, and you score the instant the bird passes
a pair. Touching a pipe, the ground, or the ceiling ends the run — with a screen
flash, debris particles, and a little screen-shake. Scroll speed creeps up with your
score for escalating pressure. Everything is drawn procedurally on a 480x640 canvas;
audio is synthesized with WebAudio.

## Tweak ideas
- Make it easier/harder by editing `PIPE_GAP`, `PIPE_SPACING`, or `BASE_SCROLL` at
  the top of `game.js`.
- Change the feel of the flap with `GRAVITY` and `FLAP_VELOCITY`.
- Raise `SCROLL_RAMP` / `MAX_SCROLL` for a steeper difficulty curve.
