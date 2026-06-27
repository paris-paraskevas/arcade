# Arcade — operating manual for Claude

Read this whole file at the start of every session, then `IDEAS.md` (what we're building) and `knowledge/STATUS.md` (what exists right now).

## Quick context

- **What this is:** a browser games arcade — a Friv-style hub of small games — growing toward a solo, story-driven adventure game (the north star). See the `arcade-journey` memory.
- **Current state (the truth today):** a **static, zero-install** site. Plain HTML5 Canvas + vanilla JS. The root `index.html` portal reads `games.js` and renders the shelf via `portal.js`; each game is a self-contained folder (`<slug>/index.html` + `game.js` + `README.md`). **18 games**, no build step — you open `index.html` directly. Not yet a git repo.
- **Target (decided 2026-06-26 — see `knowledge/DECISIONS.md`):** an **Astro app on Cloudflare** (Pages/Workers) with **Supabase** for auth + accounts + friends + scores + leaderboards, and **Cloudflare Durable Objects** for authoritative realtime 2-player matches. The 18 games migrate in as static assets — they are NOT rewritten.
- **Auth model:** public-with-account. Anyone can play; an account unlocks scores, friends, leaderboards, and online play.

## Read these before doing anything

1. This file — operating manual + working agreement.
2. **`docs/HANDOFF.md`** — running session handoff: what's live, infra ledger, landmines, what to pick up next. Read at every session start.
3. `IDEAS.md` — Now / Next / Inbox ledger; what we're building.
3. `knowledge/STATUS.md` — what's actually built vs in-progress vs blocked.
4. `knowledge/DECISIONS.md` — the architecture decisions + why (so we don't relitigate them).
5. `_spec/HOUSE_RULES.md` — the build spec EVERY game must follow.
6. Memory — the `arcade-journey` project memory (the multi-year north star).

## ESPA — before every non-trivial action

Adopted from Paddock. Apply to anything that isn't an obviously trivial edit.

1. **E — Evaluate** the ask: intent + context.
2. **S — Scrutinize**: is this the best approach, even if explicitly instructed? Push back on a concrete flaw, risk, or inefficiency.
3. **P — Present** a step-by-step plan, with a one-line **pre-mortem** (most likely failure mode) and a one-line **"won't touch this session"**.
4. **A — Await** explicit approval ("yes" / "go" / "do it"). Never infer approval from silence or from a follow-up question.

If a plan fails mid-execution: STOP, re-evaluate from step 1 with what you now know, present a revised plan.

## Mode awareness

- **Plan first** when: 3+ files, architectural decisions, ambiguity, multiple valid approaches, or the user says "build / redesign / restructure / plan".
- **Just execute** when: single-file edit, clear instruction, known-location bug fix, read-only research.
- Unsure → ask (`AskUserQuestion`). 30s of asking beats hours of wrong work.

## Working agreement

- **Browser-verify before "shipped".** `node --check` and a passing build prove it compiles, not that it plays. Load the actual game/flow in a browser and click through it (see Verification below).
- **Never create files without permission** — state filename + purpose, await — except files the user explicitly asked for. Prefer editing existing files.
- **Always re-Read a file immediately before each Edit.** The tool tracks a per-file read checksum; in-context memory of the file is not enough. If Edit says "modified since read", Read first, then Edit — don't retry blind.
- **Push back when you see a concrete flaw, risk, or inefficiency.** Expected and valued — the S in ESPA — even when explicitly instructed.
- **Flag mistakes inline immediately ("Correction: …").** Never silently rewrite history.
- **State your sources** (file:line, memory path, web search, prior turn) so claims are verifiable.
- **No new abstraction without a real second consumer.** Three similar lines beats a premature helper.
- **Scope discipline.** A new idea mid-session → one sentence to `IDEAS.md` Inbox, then back to the task. Triage only at session end.
- **Format discipline** (the user's global style): conclusion-first, terse; no preamble/filler/sign-off; tables only when comparing 5+ items; markdown only when it aids comprehension.
- **Never trust the client for scores or outcomes** once Supabase/online lands — validate server-side (see Supabase).

## Where things live

**Now — the static arcade:**

| Path | Purpose |
|---|---|
| `index.html` | The arcade portal (the shelf). |
| `games.js` | The catalog — one entry per game (`window.GAMES`). |
| `portal.js` | Renders the shelf + tag filters from `games.js`. |
| `<slug>/` | One self-contained game: `index.html` + `game.js` + `README.md`. |
| `_spec/HOUSE_RULES.md` | The build spec every game follows. |
| `knowledge/` | `DECISIONS.md` + `STATUS.md` — persist across sessions. |
| `IDEAS.md` | The idea ledger. Read at session start. |

**Target — Astro + Cloudflare + Supabase + Durable Objects (planned; see `IDEAS.md` §Now):**

| Path | Purpose |
|---|---|
| `src/pages/` | Astro routes (shelf, `play/[slug]`, profile, leaderboards, sign-in). |
| `src/components/` | UI islands (auth, profile, leaderboard, friends). |
| `src/lib/` | Pure modules + server helpers (supabase client, scores, friends, leaderboards). |
| `public/games/<slug>/` | The vanilla games, served as static assets — unchanged. |
| `supabase/migrations/*.sql` | Timestamped schema migrations (RLS-first). |
| `workers/realtime/` | Durable Objects Worker — one authoritative match-room per game. |
| `wrangler.jsonc` | Cloudflare config (Pages + DO bindings + secrets). |
| `docs/` | Design notes / research / handoff. |

## Building a game

Every game obeys `_spec/HOUSE_RULES.md`: self-contained folder; classic `<script>` (no modules/fetch — must run from `file://`); pure Canvas + vanilla JS; WebAudio built in code; **initialize ALL state at module load** (the #1 bug — a blank/frozen title screen is an automatic fail); dark theme; the `‹ arcade` back-link; `node --check` clean. A game joins the shelf via one entry in `games.js`.

## Verification (how we audit games)

- **Static gate:** `node --check <slug>/game.js`.
- **Runtime:** the Playwright MCP **blocks `file://`**, so serve over HTTP first — `node scratchpad/serve.js` (static server on `:8765`) — then navigate to `http://localhost:8765/<slug>/index.html`, check the console (a lone `favicon.ico` 404 is fine), screenshot the title, and press start to confirm gameplay renders.
- Always **kill the server and remove `.playwright-mcp/` + any screenshots** afterward. Don't leave audit artifacts in the repo.

## Realtime (online 2-player) — Durable Objects

- One **authoritative** DO instance per match: the room owns game state; clients send inputs and receive state. Cheat-resistant; handles sync.
- A WebSocket per player; handle join / leave / reconnect + a room code. Turn-based games first (simpler), then action games.
- The server tick is authoritative. The client renders and may predict — it never decides outcomes.

## Supabase (auth + data)

- Migrations are **timestamped SQL** in `supabase/migrations/` (mimic Paddock). **RLS on every table from day one** — default deny, explicit policies.
- **Scores are server-validated.** Treat all client-submitted scores/outcomes as hostile: bound-check, rate-limit, prefer server-derived results for online games.
- Secrets via `wrangler` + `.env` (never commit). `.env.example` documents the required keys.

## Cloudflare / deploy

- `wrangler` for Pages + Workers + Durable Objects. A preview deploy per branch; promote to production explicitly.
- Verify on a Cloudflare **preview**, not just localhost, before "shipped" — the runtime differs.

## Commit & branch conventions

- The repo is born with the platform foundation. Branch before changes; never commit to `main` directly; never `git add -A` / `git add .` (stage named files); never push or merge a PR without explicit approval.
- Conventional commits (`feat(scope):`, `fix(scope):`, `docs:`, `chore:`). The body explains the *why*.
- Commit-message attribution follows the user's global `~/.claude/CLAUDE.md`.

## Knowledge system

`knowledge/DECISIONS.md` (architectural/business decisions + rationale + rejected alternatives) and `knowledge/STATUS.md` (built / in-progress / blocked) persist across sessions. Record a decision before session end; update STATUS when something ships or a blocker appears/resolves.

## When in doubt

- `AskUserQuestion` to confirm scope or a design fork.
- If a memory and the code disagree, trust the code and update the memory.
