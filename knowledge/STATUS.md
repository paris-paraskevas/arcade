# Status

_Updated 2026-06-27._

## Built

- **Live platform** — Astro (static) on Cloudflare at **https://arcade.businessofzeus.workers.dev**. Shelf (`src/pages/index.astro` from `src/lib/games.ts`), `/sign-in`, `/leaderboard`, `/friends`, dark neobrutalist theme, auth-aware header, **favicon**. _(Live URL serves the pre-2026-06-27 baseline until `feat/platform-v2` is deployed.)_
- **30 playable games** (vanilla Canvas + JS, served static from `public/<slug>/`):
  - Wave 0/1 (18): weekend-racer, snake, breakout, asteroids, tetris, pong ★, space-invaders, flappy, 2048, minesweeper, memory, tic-tac-toe ★, connect-four ★, simon, lights-out, whack-a-mole, dino-runner, snake-duel ★.
  - Wave 2 (12): frogger, missile-command, doodle-jump, tron ★, helicopter, sokoban, fifteen-puzzle, match-three, bubble-shooter, air-hockey ★, artillery ★, stack-tower. (★ = local 2-player.)
  - All start on Space/Enter/click. Spot-verified live across waves.
- **Auth** — client-side Supabase (sign-up/in; email confirmation disabled on hosted). **Header reflects signed-in state across reload + navigation** — fixed the supabase-js `onAuthStateChange` lock deadlock that left `getSession()` hanging (the "sign-in doesn't stick" bug). See `knowledge/DECISIONS.md` D12.
- **Leaderboard score submission: LIVE.** `public/arcade-client.js` → `window.Arcade.submitScore(slug, value)` (classic script, raw `fetch` → PostgREST with the localStorage session token; guest/offline no-op). On all 30 game pages; **23 scorable games POST at game-over**. `public/arcade-metrics.js` is the per-game metric registry (dir hi/lo, unit pts/rounds/moves/cs); lower-is-better stored as `BASE - value` so the existing `leaderboard` view ranks all with no schema change; the board decodes + formats. 7 win-lose/2P games excluded (tic-tac-toe, connect-four, pong, air-hockey, tron, snake-duel, artillery). Verified end-to-end on the live DB (hi/pts, lo/cs, lo/moves, hi/rounds).
- **Friends: LIVE.** `/friends` — add by username, requests (accept/decline), friends (remove), outgoing (cancel); auto-accepts a reverse-pending request. On the `friendship` table + RLS. Verified across two accounts.
- **Supabase** — local + hosted (`drkqjfcejhffwpbptzmv`, eu-west-1) with 4 RLS-first migrations. Leaderboard reads the `leaderboard` view.
- **Mobile — Phase 0 (layout) + Phase 1 (touch) + Phase 2 (2-player on one phone): LIVE.** `public/arcade-fit.js` (canvas fit) + `public/game.css` + `public/arcade-touch.js` (slug→scheme registry → synthetic key/mouse) on all 30 pages. Phase 2: tron/snake-duel/air-hockey get split P1(WASD)/P2(arrows) dpads, pong both paddles. `?touch=1` forces the overlay on desktop.
- **vs-CPU difficulty: LIVE.** tic-tac-toe, connect-four, pong, air-hockey: Easy/Medium/Hard/**Unbeatable** (default Medium).
- **Visual redesign: LIVE.** Neobrutalist arcade shell (marquee, INSERT COIN, cartridge cards, Press Start 2P + Space Grotesk). Files: `src/layouts/Base.astro`, `src/pages/{index,leaderboard,sign-in,friends}.astro`.
- **Git** — branch `feat/platform-v2` holds the whole 2026-06-27 session (foundation checkpoint + sign-in fix + touch P2 + scores + friends), 11 commits. **Unpushed + undeployed.**

## In progress / next

- **Push + deploy** `feat/platform-v2` and verify on the Cloudflare URL (live still = baseline).
- **Username editor** — set a friendly name (profile update RLS exists; no UI); also fixes mobile-header username overflow.
- **Anti-cheat** — scores are client-trusted (RLS insert-own + `>=0`); add server-authoritative validation / bounds / rate limits. Then clean the `claude-qa*@example.com` test rows on hosted.
- **Online 2-player** — Durable Objects realtime Worker (not started). Turn-based first.

## Backend (Supabase)

- **Hosted:** project `arcade` · ref `drkqjfcejhffwpbptzmv` · eu-west-1. Keys via `supabase projects api-keys --project-ref drkqjfcejhffwpbptzmv`. Anon key in `.env` (`PUBLIC_SUPABASE_ANON_KEY`, inlined at build) AND in `public/arcade-client.js` (public; two places if rotated).
- **Local:** ports 5442x (API 54421) to coexist with Motorsport. `supabase start|stop|db reset`.

## Known minor items

- lights-out leaderboard = fewest moves on any single solved puzzle (a bit luck-driven); consider levels-cleared.
- air-hockey 2-player touch uses button dpads (a per-half drag would feel better; needs game-side multitouch).
- Long auto-username (`player_xxxxxxxxxx`) overflows the header on ~390px-wide screens (fixed by a username editor).
- `snake-duel` instant-draws with zero input — add a countdown in a polish pass.
- Deeper per-game challenge/balance tuning is still a pending pass (separate from "does it start").
