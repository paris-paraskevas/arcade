# Helicopter

A one-button cave flyer. Your chopper auto-scrolls right through a winding cave that breathes, narrows, and throws floating blocks at you. Fly as far as you can.

## Controls
- **Hold** `Space` / mouse / touch — fly up. **Release** — drop under gravity.
- `Space` / `Enter` / click — start & restart.

## How it works
Gravity pulls the helicopter down constantly; holding the button applies a stronger upward thrust, so it climbs while held and falls when released — with momentum, so it stays floaty-but-fair. The cave walls are built from rolling segments whose gap drifts smoothly and shrinks with distance, while metal blocks spawn hugging one wall so there's always a lane to slip through. The world speeds up the further you go; your score is the distance travelled (best is saved in `localStorage`).

## Tweak ideas
- Feel too twitchy or too floaty? Adjust `GRAVITY` and `LIFT` (keep `LIFT > GRAVITY`), and the `MAX_UP` / `MAX_DOWN` velocity clamps.
- Make it harder: lower `GAP_MIN`, raise `MAX_SCROLL` / `SCROLL_RAMP`, or shorten `OBSTACLE_MIN_GAP` / `OBSTACLE_MAX_GAP`.
- Change the cave's character with `MAX_GAP_DRIFT` (jagged vs. gentle) and `SEG_W` (chunky vs. smooth walls).
