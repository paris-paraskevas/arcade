# Status

_Updated 2026-06-26._

## Built

- **Live platform** — Astro (static) on Cloudflare at **https://arcade.businessofzeus.workers.dev**. Shelf (`src/pages/index.astro` from `src/lib/games.ts`), `/sign-in`, `/leaderboard`, dark theme, auth-aware header, **favicon** (`public/favicon.svg`).
- **30 playable games** (vanilla Canvas + JS, served static from `public/<slug>/`):
  - Wave 0/1 (18): weekend-racer, snake, breakout, asteroids, tetris, pong ★, space-invaders, flappy, 2048, minesweeper, memory, tic-tac-toe ★, connect-four ★, simon, lights-out, whack-a-mole, dino-runner, snake-duel ★.
  - Wave 2 (12): frogger, missile-command, doodle-jump, tron ★, helicopter, sokoban, fifteen-puzzle, match-three, bubble-shooter, air-hockey ★, artillery ★, stack-tower. (★ = local 2-player.)
  - All start on Space/Enter/click (the mode-select games connect-four/tic-tac-toe were fixed to start that way too, not only 1/2). Spot-verified live across waves.
- **Supabase** — local + hosted (`drkqjfcejhffwpbptzmv`, eu-west-1) with 4 RLS-first migrations. **Client-side auth works** (sign-up/in; email-confirmation disabled on hosted). Leaderboard page reads the `leaderboard` view.
- **Git** — initialized; foundation baseline committed. (Wave 2 + favicon + start-fixes are currently **uncommitted** in the working tree.)
- **Build/deploy:** `npm run build` (Astro → `dist/`) then `wrangler deploy` (account: **businessofzeus@gmail.com**).
- **Mobile — Phase 0 (layout): LIVE.** Shared `public/arcade-fit.js` (fits every game's canvas to both viewport axes, any orientation, no per-game config) + `public/game.css` (no-scroll/zoom, notch-safe, shrunk chrome) injected into all 30 game pages; responsive Astro shell. Verified live on phone viewports.
- **Mobile — Phase 1 (touch controls): LIVE.** Shared `public/arcade-touch.js` (a registry keyed by URL slug) injected into all 30 game pages — on touch devices it shows an on-screen overlay (D-pad / action buttons / tap / swipe) and bridges to the keydown + mouse the games already handle (synthetic events), zero per-game rewrites. Force it on desktop for testing with `?touch=1`. **Phase 2 (pending):** 2-player-on-one-phone (tron / snake-duel / air-hockey / pong) + polish.
- **vs-CPU difficulty: LIVE.** tic-tac-toe, connect-four, pong, air-hockey each have Easy / Medium / Hard / **Unbeatable** (default Medium), pickable by keys 1–4 or tap; the old always-perfect AI is now the "Unbeatable" tier.
- **Visual redesign: LIVE.** Shell reskinned to a disciplined **neobrutalist arcade** — deep indigo dotted bg, a lit marquee (bulbs + blinking INSERT COIN + scanlines), flat-color cartridge cards with hard offset shadows that depress on press, Press Start 2P + Space Grotesk type. Replaces the generic gradient-on-near-black look. Files: `src/layouts/Base.astro`, `src/pages/{index,leaderboard,sign-in}.astro` (design tokens in Base's global style).

## In progress / next

- **Per-game score submission** — the games don't yet POST scores to Supabase, so leaderboards read correctly but stay empty. Plan: a tiny shared `public/arcade-client.js` exposing `window.Arcade.submitScore(game, score)` (anon key + RLS), called on each game's game-over. One include + one call per game.
- **Online 2-player** — Durable Objects realtime Worker (not started). Start turn-based (connect-four, tic-tac-toe) → action.
- **Friends UI** — table + RLS exist; no UI yet.

## Backend (Supabase)

- **Hosted:** project `arcade` · ref `drkqjfcejhffwpbptzmv` · eu-west-1. Keys via `supabase projects api-keys --project-ref drkqjfcejhffwpbptzmv`. Anon key lives in `.env` (`PUBLIC_SUPABASE_ANON_KEY`) and is inlined into the client bundle at build.
- **Local:** ports 5442x (API 54421) to coexist with Motorsport. `supabase start|stop|db reset`.

## Known minor items

- `2048` / others may carry a stray `BEST` from build-agent test runs (harmless localStorage).
- `snake-duel` instant-draws with zero input (both snakes hit a wall) — add a countdown in a polish pass.
- Deeper per-game "is it challenging / balanced for hours of play" tuning is still a pending pass (separate from "does it start", which is verified).
