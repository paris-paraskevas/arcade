# Status

_Updated 2026-06-26._

## Built

- **Static arcade**, zero-install (open `index.html`): portal (`index.html` + `games.js` + `portal.js`) with tag filters + roadmap cards, dark theme, per-game `‹ arcade` back-links.
- **18 playable games** (vanilla Canvas + JS, self-contained folders), all Wave-1 audited — load + render + start verified in a real browser, console clean:
  `weekend-racer`, `snake`, `breakout`, `asteroids`, `tetris`, `pong` ★, `space-invaders`, `flappy`, `2048`, `minesweeper`, `memory`, `tic-tac-toe` ★, `connect-four` ★, `simon`, `lights-out`, `whack-a-mole`, `dino-runner`, `snake-duel` ★.  (★ = local 2-player.)
- **Build spec** `_spec/HOUSE_RULES.md`; **project docs** `CLAUDE.md` / `IDEAS.md` / `README.md` / `knowledge/`.
- **Live on Cloudflare** — static arcade deployed as a Worker with static assets at **https://arcade.businessofzeus.workers.dev** (`wrangler.jsonc`, assets from `./.cf-dist`). Production-verified (routing + shelf + a game in-browser).
- **Supabase backend — built + verified, LOCAL and HOSTED.** 4 RLS-first migrations: `profile` (auto-created on signup), `score` + `leaderboard` view, `friendship`, `grants`. Verified end-to-end on both: signup → auto-profile trigger → authenticated score insert → leaderboard aggregation (`best`/`plays`) → anon writes denied. Hosted = project `arcade` (ref `drkqjfcejhffwpbptzmv`, eu-west-1) at **https://drkqjfcejhffwpbptzmv.supabase.co**. Ops in `supabase/README.md`.

## In progress

- Platform foundation. Cloudflare deploy live (static); Supabase fully provisioned + verified (local + hosted). **Remaining: scaffold the Astro app and wire it to Supabase + Durable Objects.**

## Blocked / pending

- **Scaffold the Astro app** — then migrate the games in as static assets (replacing the `.cf-dist` staging), wire Supabase auth + the anon key, and store the service key as a Cloudflare secret. Awaiting go-ahead.
- **Git:** still not a repo; `git init` + first commit land with the foundation. `.gitignore` must include `.cf-dist/`, `supabase/.branches/`, `supabase/.temp/`, `.env*`.

## Backend (Supabase)

- **Hosted:** project `arcade` · ref `drkqjfcejhffwpbptzmv` · eu-west-1 · org "Paris Dev Motorsport" · URL `https://drkqjfcejhffwpbptzmv.supabase.co`. Migrations pushed + verified live. Keys via `supabase projects api-keys --project-ref drkqjfcejhffwpbptzmv` (anon + publishable are public/client-safe; service_role + secret are server-only → Cloudflare secret). DB password set at creation (resettable in dashboard; the app uses API keys, not it). Update schema via `supabase db push`.
- **Local:** remapped ports **5442x** (API 54421 / db 54422 / Studio 54423 / mail 54424) to coexist with Motorsport's 5432x stack. `supabase start|stop|status|db reset`. Local keys = shared demo defaults (not secret). Currently running — `supabase stop` to free it.

## Deploy (current, static)

- Re-stage + redeploy: copy the public files into `./.cf-dist` (the 18 game folders + `index.html` / `games.js` / `portal.js`, no docs), then `wrangler deploy`. This staging step goes away once the Astro build produces the deploy output.

## Known minor items (from the Wave-1 audit — not blocking)

- `2048` persists a stray `BEST 4` from a build-agent test run (harmless localStorage value).
- `snake-duel` instant-draws if neither player provides input (both snakes run straight into a wall) — add a 3-2-1 countdown / safer spawns in the polish pass.

## Next 12 games (Wave 2 → 30)

Frogger, Missile Command, Doodle Jump, Tron ★, Helicopter, Sokoban, 15-Puzzle, Match-3, Bubble Shooter, Air Hockey ★, Artillery ★, Stack Tower.
