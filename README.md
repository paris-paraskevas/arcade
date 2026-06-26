# Arcade

A browser games arcade — a Friv-style hub of small games — growing toward a solo, story-driven adventure game (the north star).

## Current state

A **static, zero-install** site: open `index.html` and play. Pure HTML5 Canvas + vanilla JS, no build step. **18 games** so far, each a self-contained folder. The portal (`index.html` + `games.js` + `portal.js`) renders the shelf with tag filters.

## Where it's going

Becoming a real platform on **Cloudflare + Supabase**: accounts, friends, scores, global/friends/daily leaderboards, and online 2-player matches (authoritative **Cloudflare Durable Objects** rooms). The 18 games migrate in **unchanged** as static assets — the build system wraps them, it doesn't replace them.

- **The plan:** `IDEAS.md` (Now / Next / Inbox ledger).
- **How we work + the architecture:** `CLAUDE.md`.
- **Why each big call was made:** `knowledge/DECISIONS.md`. **What's built vs pending:** `knowledge/STATUS.md`.
- **The contract every game follows:** `_spec/HOUSE_RULES.md`.

Architecture decided 2026-06-26: **Astro on Cloudflare · Supabase auth + Postgres · Durable Objects realtime.** Not yet scaffolded — the static arcade stays the working version until the new shell serves the games end-to-end.

## Structure (today)

```
arcade/
├─ index.html        the portal (the "Friv" shelf)
├─ games.js          the catalog — one entry per game
├─ portal.js         renders the shelf from games.js
├─ CLAUDE.md         operating manual + target architecture
├─ IDEAS.md          the idea ledger
├─ knowledge/        DECISIONS.md + STATUS.md (persist across sessions)
├─ _spec/            HOUSE_RULES.md — the game build spec
└─ <slug>/           each game: index.html + game.js + README.md
```

## Run it

- **Play:** double-click `index.html` (or any `<slug>/index.html`).
- **Test properly:** serve over HTTP — `node scratchpad/serve.js` → `http://localhost:8765/` — needed for browser automation (which blocks `file://`).

## Add a game

1. Make a `<slug>/` folder with its own `index.html` + `game.js`, following `_spec/HOUSE_RULES.md`.
2. Add one entry to `games.js`:
   ```js
   {
     id: 'snake', title: 'Snake', path: 'snake/index.html', emoji: '🐍',
     blurb: 'The classic.', tags: ['arcade'],
     gradient: 'linear-gradient(160deg, #2bb673, #0f2747)',
     status: 'playable',   // playable | planned | dream
   }
   ```
3. Reload the portal. Each game links back with `‹ arcade`.

## Roadmap

1. **Platform foundation** — Astro + Cloudflare + Supabase (auth → scores → friends → leaderboards).
2. **30 games** — Wave 2 adds the remaining 12 (Frogger, Missile Command, Tron, Air Hockey, …).
3. **Online play** — Durable Objects rooms for the 2-player games.
4. **The Adventure** — the real goal, years out. That's the point.
