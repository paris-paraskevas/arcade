# Handoff — Arcade

_Last session: 2026-06-27. Read this + `CLAUDE.md` + `knowledge/STATUS.md` + `IDEAS.md` at session start._

## What this is
A browser games arcade (30 mini-games) → now a real platform. **Live: https://arcade.businessofzeus.workers.dev**
Astro static site on Cloudflare Workers (static assets) + Supabase (auth/scores/leaderboards). Repo: `C:\Dev\Personal\news`.

## What's LIVE (all shipped + verified)
- **30 games** — vanilla Canvas/JS, static in `public/<slug>/`. All start on Space/Enter/click.
- **Astro shell** — `/` shelf, `/sign-in`, `/leaderboard`. Client-side Supabase auth works (sign up/in; email confirmation disabled on hosted).
- **Visual redesign** — neobrutalist arcade (marquee + INSERT COIN, flat cartridge cards, Press Start 2P + Space Grotesk). Tokens in `src/layouts/Base.astro` global `<style>`.
- **vs-CPU difficulty** — tic-tac-toe / connect-four / pong / air-hockey have Easy/Medium/Hard/**Unbeatable** (default Medium).
- **Mobile** — Phase 0 (canvas fits any orientation via `public/arcade-fit.js` + `public/game.css`) AND Phase 1 touch (`public/arcade-touch.js`: slug→scheme registry, on-screen D-pad/buttons/tap/swipe bridged to synthetic key+mouse events).

## Infra ledger
- **Cloudflare:** account **businessofzeus@gmail.com** (id `7c6ad4c414f1e87c28048a09af6b7dc5`), Worker name `arcade`. ⚠️ The user ALSO has `pparaskevas.dev@gmail.com` — do NOT deploy there (changes the URL). Deploy must run while wrangler is authed as businessofzeus.
- **Supabase hosted:** project `arcade`, ref `drkqjfcejhffwpbptzmv`, region `eu-west-1`, org "Paris Dev Motorsport". URL `https://drkqjfcejhffwpbptzmv.supabase.co`. Keys: `supabase projects api-keys --project-ref drkqjfcejhffwpbptzmv`. Anon key is in `.env` (`PUBLIC_SUPABASE_ANON_KEY`, inlined at build). 4 RLS-first migrations in `supabase/migrations/`.
- **Supabase local:** ports **5442x** (API 54421) to coexist with the sibling Motorsport stack. `supabase start|stop|db reset`.

## Build / deploy / verify
- Build: `npm run build` (Astro static → `dist/`).
- Deploy: `wrangler deploy --config wrangler.jsonc` (serves `./dist`).
- Local preview: `npm run preview` (→ `:4321`).
- Browser verify: the **Playwright MCP blocks `file://`** — use the preview/live URL over http. Force the mobile touch overlay on desktop with **`?touch=1`**. Always remove `.playwright-mcp/` + screenshots and kill bg servers when done.
- Add a shared script/style to all 30 games: `sed -i '/<meta name="viewport"/a <TAG>' public/*/index.html` (how favicon, game.css, arcade-fit.js, arcade-touch.js were injected).

## Landmines
- **wrangler OAuth expires mid-session repeatedly.** Symptom: "not logged in" or "Authentication error [code: 10000]" (it may target the cached old account). Fix: user runs `wrangler login` (as businessofzeus) in a real terminal, or set `CLOUDFLARE_API_TOKEN` (durable — recommended).
- **Game init bug class:** every game must initialize ALL state at module load (not only on Start) or the title screen is blank. Spec: `_spec/HOUSE_RULES.md`.
- **Mode-select games** (connect-four/tic-tac-toe) must start on Space/Enter/click, not only 1/2.
- **Subagents occasionally return empty (0 tool calls)** — just re-dispatch (hit sokoban + two difficulty agents this run).

## Open / next (pick up here)
1. **Git:** large UNCOMMITTED diff (redesign + difficulty + touch + mobile + Astro foundation). Repo is git-init'd with one baseline commit only. Committing is overdue — user hasn't asked, so confirm first.
2. **Touch Phase 2:** 2-player-on-one-phone for `tron`, `snake-duel`, `air-hockey`, `pong` (split-screen touch zones). They currently show a "best on a keyboard" hint on phones. Config lives in `arcade-touch.js` REG (`twoPlayer:true`).
3. **Per-game score submission:** games don't POST scores yet → leaderboards read correctly but stay empty. Plan: a shared `public/arcade-client.js` exposing `window.Arcade.submitScore(game, score)` (anon key + RLS), called on each game's game-over. One include + one call per game.
4. **Friends UI** — `friendship` table + RLS exist; no UI.
5. **Online multiplayer** — the big deferred feature: Cloudflare Durable Objects rooms (separate Worker). Decision D4 in `knowledge/DECISIONS.md`.
6. **Game-page chrome** — the 30 games keep their own dark theme; could be themed to match the new neobrutalist shell (via `game.css`).
7. **Deeper challenge/balance playtest** — the "fun for hours" pass; games start + render but haven't been tuned for difficulty/engagement.

## Key files
`src/layouts/Base.astro` (shell + design tokens) · `src/pages/{index,leaderboard,sign-in}.astro` · `src/lib/{games.ts,supabase.ts}` · `public/<slug>/` (the 30 games) · `public/{arcade-fit.js,arcade-touch.js,game.css,favicon.svg}` · `supabase/migrations/` · `wrangler.jsonc` · `_spec/HOUSE_RULES.md`.
