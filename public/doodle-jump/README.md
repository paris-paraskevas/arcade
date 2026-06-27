# Doodle Jump

A vertical, auto-bouncing platform jumper. Your hopper bounces upward forever — you only steer left/right and try to keep landing on platforms. The higher you climb, the higher your score; fall off the bottom of the screen and the run ends.

## Controls
- **← →** or **A D** — steer left / right (leaving one edge wraps you to the other side)
- **Space** / **Enter** / **Click** — start & restart

## How it works
The character bounces off platforms automatically with a fixed upward impulse, so every hop has the same arc; gravity pulls it back down. The camera only ever scrolls upward, holding the hopper near the upper-middle of the screen while the world slides past, and your score is the greatest height reached. Platforms come in three flavours — static (green), horizontally moving (blue), and breakable one-use (orange) — and some solid platforms carry a spring that launches you much higher; the mix gets harder the higher you climb. Best score is saved in `localStorage`.

## Tweak ideas
- Change `BOUNCE_V` / `SPRING_V` / `GRAVITY` at the top of `game.js` to make hops floatier or snappier.
- Adjust `PLAT_GAP_MIN` / `PLAT_GAP_MAX` to space platforms further apart (harder) or closer (easier).
- Edit the probabilities in `pickKind()` to change how quickly moving and breakable platforms take over.
