# Decisions

Architectural + business decisions, with rationale and rejected alternatives. Newest at the bottom. Don't relitigate what's here without a new entry that supersedes it.

## 2026-06-26 — Platform architecture (the "make it Cloudflare + Supabase" pivot)

**D1 — Host on Cloudflare (Pages + Workers).** User directive. *Rejected:* Vercel (where the sibling Motorsport/Paddock lives) — the user explicitly wants Cloudflare for this project.

**D2 — Framework: Astro.** The arcade is mostly-static (a shelf + self-contained canvas games) with a few dynamic surfaces (auth, profile, leaderboards). Astro serves the 18 vanilla games **unchanged** as static assets, adds islands only where needed, and has first-class Cloudflare support. *Rejected:* Next.js-on-Cloudflare (OpenNext) — heavier and rougher than on Vercel, overkill for static games (it would mimic Paddock's framework most closely, but that's not worth the cost here); SvelteKit — fine, but diverges further from the React/Next patterns we can borrow; static-only + Workers — too bare, we'd hand-roll routing and the account UI.

**D3 — Auth + database: Supabase.** User directive. Supabase Auth (magic-link + OAuth) for accounts; Postgres + Row-Level Security for profiles, friends, scores, leaderboards; timestamped SQL migrations. *Rejected:* Clerk (Paddock uses it, but the user chose Supabase here); Cloudflare Access (org/SSO gate, not consumer accounts).

**D4 — Realtime 2-player: Cloudflare Durable Objects.** One authoritative match-room instance per game over WebSockets — the server owns game state, so it's cheat-resistant and handles physics sync. *Rejected:* Supabase Realtime — presence/broadcast only, peer-trusting (not authoritative), weak for fast action games. (May still use Supabase Realtime later for non-authoritative presence / "who's online".)

**D5 — Games stay vanilla + static; migrate as assets, don't rewrite.** Preserves working, audited code and the zero-install feel; the build system wraps them, it doesn't replace them.

**D6 — Mimic Motorsport's *organization*, not its stack.** Borrow the doc suite (CLAUDE.md, the IDEAS.md ledger, knowledge/DECISIONS+STATUS), the `lib / components / supabase(migrations)` layout, timestamped migrations, and the ESPA + browser-verify discipline. Framework / host / auth differ by the user's explicit choice.

**D7 — Incremental migration; never break the working arcade.** Keep the static arcade functional until the Astro shell serves the games end-to-end. No deletion of working code ahead of a working replacement.

**D8 — Online multiplayer deferred until the platform foundation + 30 games exist.** Build the foundation (auth → scores → friends), reach 30 games, then layer online play. (User: "before we add more games, fix up the site" — foundation first; games resume after.)

## 2026-06-26 — First deploy

**D9 — Ship the static arcade now as a Cloudflare Worker with static assets (not Pages).** Guaranteed by the token's `workers:write` scope (the Pages scope was uncertain in `wrangler whoami`); the Worker name is per-account so there's no global `.pages.dev` name collision; and it's the same target the Astro Cloudflare adapter + Durable Objects use later, so `wrangler.jsonc` grows into the platform instead of being thrown away. Public assets are staged to `./.cf-dist` (docs/knowledge/specs excluded) and served at `arcade.businessofzeus.workers.dev`. *Rejected:* Cloudflare Pages direct upload (uncertain token scope, global name contention); deploying the repo root (would expose CLAUDE.md/IDEAS.md publicly). The `.cf-dist` staging step is temporary — the Astro build output replaces it.

**D10 — Local Supabase on a remapped port range (5442x); grants are explicit.** The sibling Motorsport Supabase owns the default 5432x ports, so `news` uses 54421 (API) / 54422 (db) / 54423 (Studio) / 54424 (mail) — both stacks coexist, Motorsport untouched (chosen over `supabase stop`-ing Motorsport, which is the user's other live work). Also learned: under Supabase's new "public tables are not auto-exposed" default, RLS alone is insufficient — every table needs explicit `GRANT`s to `anon`/`authenticated` (migration `…_grants.sql`). Verified end-to-end locally: signup → auto-profile trigger → authenticated score insert → leaderboard aggregation, anon writes denied. *Hosted project deferred* — it needs the user's `supabase login` (cloud infra on their account).

## 2026-06-26 — Hosted Supabase provisioned

**D11 — Hosted Supabase project created in eu-west-1, same org as Paddock.** After the user's `supabase login`, created project `arcade` (ref `drkqjfcejhffwpbptzmv`) under org "Paris Dev Motorsport", region **eu-west-1** to match the existing Paddock project (consistent ops; likely lower latency for the user/audience). All 4 migrations pushed and verified on the live DB (anon read = `[]`, anon write = RLS-denied). Region chosen over the earlier "East US" placeholder because the user's existing Supabase + likely audience are EU; an empty project is trivially recreatable if that changes. Note: `supabase db push` logged a benign pg-delta catalog-cache cert warning — the migrations applied regardless.

## 2026-06-27 — Scores, friends, and the auth-lock fix

**D12 — Lower-is-better scores are encoded, not schema'd.** The `leaderboard` view ranks `max(score) desc`. Rather than add a sort-direction column + recreate the hosted view, time/moves games store `score = BASE - value` (BASE = 1e9) so one higher-is-better view ranks every game unchanged; `public/arcade-metrics.js` is the single registry of each game's `{dir, unit}`, shared by the submitter (`arcade-client.js`) and the leaderboard page (which decodes + formats pts/rounds/moves/time). *Rejected:* a `direction` column + view migration on hosted (more honest storage but a prod DDL + more query logic for no user-visible gain now); storing raw + per-direction ordering in the page (needs the view to expose both min and max). Revisit if server-side validation or analytics need honest raw values.

**D13 — Score submission is a classic-script raw fetch, not supabase-js.** `arcade-client.js` posts straight to PostgREST with the localStorage session token, so game pages don't each pull ~200 KB of supabase-js and still run from `file://` (guest/offline = silent no-op). Scores stay **client-trusted** for now (RLS insert-own + `>=0`); server-authoritative anti-cheat is deferred (IDEAS), matching the note in `…_scores.sql`. The 7 win-lose/couch-2P games (tic-tac-toe, connect-four, pong, air-hockey, tron, snake-duel, artillery) have no single-player score and are excluded.

**D14 — Never call awaitable supabase methods inside `onAuthStateChange`.** The callback runs while supabase-js (2.108) holds its non-reentrant auth lock, so `await getSession()` there deadlocks — this was the "sign-in shows the account but doesn't persist" bug (header stuck on SIGN IN with a valid stored session, `getSession()` hung forever). Pattern (`Base.astro`): paint from the callback's `session` arg synchronously; defer any further supabase call with `setTimeout(0)`. A standalone `getSession()` at page load (not in a callback) is fine (`friends.astro`).
