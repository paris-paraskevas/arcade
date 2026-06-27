# Handoff — Arcade

_Last session: 2026-06-27. Read this + `CLAUDE.md` + `knowledge/STATUS.md` + `IDEAS.md` at session start._

## What this is
A browser games arcade (30 mini-games) → now a real platform. **Live: https://arcade.businessofzeus.workers.dev**
Astro static site on Cloudflare Workers (static assets) + Supabase (auth/scores/leaderboards). Repo: `C:\Dev\Personal\news`.

> ⚠️ The live URL still serves the **pre-2026-06-27 baseline**. This session's work is committed on branch `feat/platform-v2` but **unpushed + undeployed** — see "Open / next" #1.

## What's LIVE (shipped + verified; on `feat/platform-v2`, not yet deployed)
- **30 games** — vanilla Canvas/JS, static in `public/<slug>/`. All start on Space/Enter/click.
- **Astro shell** — `/` shelf, `/sign-in`, `/leaderboard`, **`/friends`**. Client-side Supabase auth works (sign up/in; email confirmation disabled on hosted). **Header now reflects signed-in state across reload/navigation** (the "sign-in doesn't stick" bug is fixed — see Landmines).
- **Visual redesign** — neobrutalist arcade (marquee + INSERT COIN, flat cartridge cards, Press Start 2P + Space Grotesk). Tokens in `src/layouts/Base.astro` global `<style>`.
- **vs-CPU difficulty** — tic-tac-toe / connect-four / pong / air-hockey have Easy/Medium/Hard/**Unbeatable** (default Medium).
- **Mobile** — Phase 0 (canvas fits any orientation via `public/arcade-fit.js` + `public/game.css`), Phase 1 touch (`public/arcade-touch.js`: slug→scheme registry → synthetic key+mouse), and **Phase 2 (2-player on one phone)**: tron / snake-duel / air-hockey get split P1(left WASD)/P2(right arrows) dpads; pong shows both paddles. Force overlay on desktop with `?touch=1`.
- **Leaderboard score submission** — `public/arcade-client.js` exposes `window.Arcade.submitScore(slug, value)`: a classic script (no supabase-js) that raw-`fetch`es PostgREST with the session token from localStorage; **silent no-op for guests/offline** so games still run from `file://`. Loaded on all 30 game pages; **23 scorable games POST at game-over**. Lower-is-better metrics (time/moves) are stored encoded as `BASE - value` (`public/arcade-metrics.js` is the metric registry) so the existing higher-is-better `leaderboard` view ranks every game with **no schema change**; the board decodes + formats (pts/rounds/moves/time). The 7 win-lose/couch-2P games (tic-tac-toe, connect-four, pong, air-hockey, tron, snake-duel, artillery) are intentionally not scored. Verified live.
- **Friends** — `/friends`: add by username, incoming requests (accept/decline), friends (remove), outgoing (cancel); auto-accepts a reverse-pending request. On the existing `friendship` table + RLS. Verified live across two accounts.
- **Account customization** — `/account` username editor (3–24, unique; taken/invalid errors), reached by clicking your name in the header. New players get a game-character handle like `MsPacman#5234` instead of `player_<hex>` (signup trigger; `#` now allowed in handles). Migration `20260627140000`. Verified live.

## Infra ledger
- **Cloudflare:** account **businessofzeus@gmail.com** (id `7c6ad4c414f1e87c28048a09af6b7dc5`), Worker name `arcade`. ⚠️ The user ALSO has `pparaskevas.dev@gmail.com` — do NOT deploy there (changes the URL). Deploy must run while wrangler is authed as businessofzeus.
- **Supabase hosted:** project `arcade`, ref `drkqjfcejhffwpbptzmv`, region `eu-west-1`, org "Paris Dev Motorsport". URL `https://drkqjfcejhffwpbptzmv.supabase.co`. Keys: `supabase projects api-keys --project-ref drkqjfcejhffwpbptzmv`. Anon key in `.env` (`PUBLIC_SUPABASE_ANON_KEY`) AND inlined in `public/arcade-client.js` (public by design; **two places to update if rotated**). 5 RLS-first migrations in `supabase/migrations/`.
- **Supabase local:** ports **5442x** (API 54421) to coexist with the sibling Motorsport stack. `supabase start|stop|db reset`.
- **Test data on hosted (clean up):** `claude-qa@example.com` (renamed to username `ArcadeBoss`), `claude-qa2@example.com`, `claude-qa3@example.com` (all pw `arcadetest123`) — seeded scores + a friendship, used to verify the auth/scores/friends/account loops live.

## Build / deploy / verify
- Build: `npm run build` (Astro static → `dist/`).
- Deploy: `wrangler deploy --config wrangler.jsonc` (serves `./dist`).
- Local preview: `npm run preview` (→ `:4321`). Talks to **hosted** Supabase (env is the hosted URL+anon).
- Browser verify: the **Playwright MCP blocks `file://`** — use the preview/live URL over http. Force the mobile touch overlay on desktop with **`?touch=1`**. Always remove `.playwright-mcp/` + screenshots and kill bg servers when done.
- Add a shared script/style to all 30 games: `sed -i '/<meta name="viewport"/a <TAG>' public/*/index.html` (how favicon, game.css, arcade-fit/touch, arcade-metrics/client were injected).

## Landmines
- **supabase-js (2.108) auth-lock deadlock.** NEVER `await` a supabase call (especially `getSession`) **inside an `onAuthStateChange` callback** — the callback runs while supabase holds its non-reentrant auth lock, so the await hangs forever (this was the "sign-in shows the account but doesn't stick" bug: header stuck on SIGN IN). Fix pattern (in `Base.astro`): drive UI from the callback's `session` arg, paint synchronously, and defer any supabase call with `setTimeout(0)`. A standalone `getSession()` at page load (not in a callback) is fine (see `friends.astro`).
- **wrangler OAuth expires mid-session repeatedly.** Symptom: "not logged in" / "Authentication error [code: 10000]" (may target the cached old account). Fix: `wrangler login` (as businessofzeus) in a real terminal, or set `CLOUDFLARE_API_TOKEN` (durable — recommended).
- **Game init bug class:** every game must initialize ALL state at module load (not only on Start) or the title is blank. Spec: `_spec/HOUSE_RULES.md`.
- **Subagents occasionally return empty (0 tool calls)** — just re-dispatch.

## Open / next (pick up here)
1. **Push + deploy.** `feat/platform-v2` has 11 commits (the whole session) but is **unpushed + undeployed**; the live URL is still the old baseline. Get the user's OK, then push, open a PR (or merge), `wrangler deploy`, and verify on the **CF URL** (not just localhost). The anon key is inlined in `arcade-client.js` — confirm it ships.
2. **Google OAuth** (user asked for it). I can scaffold the code (a "Continue with Google" button + callback) + the Supabase `config.toml` + a setup guide, but it needs the user to create a Google Cloud OAuth client (ID/secret), enable the Google provider in Supabase, and allowlist the site/redirect URLs. Hard external deps. (The username editor it was paired with shipped 2026-06-27.)
3. **Anti-cheat (scores).** Any signed-in client can currently POST any score (RLS insert-own + `>=0` only). Add server-authoritative validation / per-game bounds / rate limits (IDEAS). Then clean the test-account rows.
4. **Score metric nuances.** lights-out submits per-puzzle moves (board ranks "fewest moves on a single solved puzzle" — a bit luck-driven); consider levels-cleared instead. air-hockey 2P touch uses button dpads; a per-half drag would feel better but needs game-side multitouch.
5. **Online multiplayer** — Durable Objects rooms (D4). The big deferred feature; turn-based first.
6. **Game-page chrome** — theme the 30 games to match the neobrutalist shell (via `game.css`).
7. **Deeper challenge/balance playtest** — the "fun for hours" pass.

## Key files
`src/layouts/Base.astro` (shell + design tokens + auth header) · `src/pages/{index,leaderboard,sign-in,friends}.astro` · `src/lib/{games.ts,supabase.ts}` · `public/<slug>/` (the 30 games) · `public/{arcade-fit.js,arcade-touch.js,arcade-client.js,arcade-metrics.js,game.css,favicon.svg}` · `supabase/migrations/` · `wrangler.jsonc` · `_spec/HOUSE_RULES.md`.
