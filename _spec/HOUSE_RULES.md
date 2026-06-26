# Arcade game build spec (house rules)

Every game in this arcade is a self-contained mini-game that runs by **double-clicking its index.html** — no server, no build step, no external files. Follow EVERY rule below.

## Files (exactly three, in your assigned folder)
- `index.html` — loads the game with a CLASSIC script tag: `<script src="game.js"></script>` (NEVER `type="module"`).
- `game.js` — all code wrapped in an IIFE: `(() => { 'use strict'; /* ... */ })();`
- `README.md` — short: what it is, controls, 2–3 sentences on how it works, a couple of tweak ideas.

## Hard technical rules
- Pure HTML5 Canvas + vanilla JS. NO libraries, NO frameworks, NO external files (no images, audio files, or web fonts). Draw everything procedurally.
- MUST run from `file://`: NO ES modules, NO `import`/`export`, NO `fetch()`, NO XHR. Inline everything; use the classic script tag.
- Audio: WebAudio only, built in code. Create the AudioContext lazily on the FIRST user input (keydown/click), and wrap every audio call in try/catch so audio can NEVER break the game.
- Main loop: `requestAnimationFrame` with delta-time (or a fixed timestep). `performance.now()` is fine. Clamp dt so a tab-switch can't teleport things across the screen.
- High score / best: use `localStorage` where it makes sense, wrapped in try/catch.

## ⚠️ The #1 bug to avoid — initialize state at LOAD, not just at game start
Initialize EVERY variable that `update()` or `render()` reads to a valid value at module load (top level), BEFORE the first `requestAnimationFrame`. Do NOT rely on a `startGame()`/`reset()` that only runs when the player presses Start — the TITLE and GAME-OVER screens run update + render too, and must never touch an `undefined` array, number, or grid. Empty arrays, zeroed scores, a valid grid, a current piece/entity if your renderer assumes one. **A blank or frozen canvas on load is an automatic fail.**

## Visual style (match the arcade's dark theme)
- Page: dark background (`#0b0e14` or a radial dark gradient), text `#cdd6e4`, `font-family: "Segoe UI", system-ui, sans-serif`. Centered column with `gap`.
- An `<h1>` title: `letter-spacing: ~4px; color: #9fb4d4; font-weight:600`.
- The `<canvas>` inside a wrapper styled `border-radius:14px; overflow:hidden; box-shadow:0 18px 60px rgba(0,0,0,.6); line-height:0`. Canvas CSS: `display:block; width: min(96vw, <W>px); height:auto;` (use YOUR assigned width for `<W>`).
- A hint line under the canvas: `font-size:12px; color:#6b7890; letter-spacing:1px; text-align:center;` — wrap key names in `<b style="color:#9fb4d4">…</b>`. It MUST list the controls and END with exactly:
  `&nbsp;·&nbsp; <a href="../index.html" style="color:#9fb4d4;text-decoration:none">‹ arcade</a>`
- In-canvas: a clean HUD (subtle text shadow), a TITLE screen, and a GAME-OVER (and/or WIN) screen with a restart prompt. Add tasteful "juice" — particles, flashes, screen-shake, sound — where it fits.

## Quality bar
It must be genuinely playable, fun, and a real challenge — not a stub or a tech demo. Tune difficulty to be approachable but engaging (escalating speed/levels, a reason to chase a high score). Comment the non-obvious parts so a learner can read the code.

## Before you finish
Run `node --check "<absolute path to your game.js>"` and fix until it passes clean.
Do NOT edit anything outside your assigned folder. Do NOT touch `games.js`, `portal.js`, or the root `index.html` — the catalog is updated separately.

## Return
Reply briefly: folder name, canvas internal resolution, the controls, and confirmation that `node --check` passed.
