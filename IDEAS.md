# Arcade — ideas ledger

Single source of truth for everything we might build. Triaged at the end of every session. What exists *right now* lives in `knowledge/STATUS.md`; the *why* behind architecture lives in `knowledge/DECISIONS.md`.

**Rules** (borrowed from Paddock/Motorsport):
1. Every new idea forces you to pick one to drop or park. There is no infinite capacity.
2. Inbox is append-only during a session. Triage at session end only — never mid-task.
3. Caps: Now ≤ 3, Next ≤ 5. Inbox uncapped. Parked + Killed unbounded — they're the ledger.
4. Inbox entries are one sentence, no formatting. Triaged entries get a one-line "why" appended.

Architecture is **decided** (2026-06-26): Astro on Cloudflare · Supabase auth + Postgres · Durable Objects realtime. See `knowledge/DECISIONS.md`.

---

## Now (≤ 3, in flight)

1. **Platform foundation — Astro on Cloudflare + Supabase.** Scaffold the Astro app, wire Cloudflare Pages/Workers + `wrangler`, link a Supabase project, and migrate the 18 static games in as static assets behind the existing shelf — nothing currently working breaks. _Decided 2026-06-26; scaffolding is gated on your green-light + provisioning (CF account, Supabase keys)._
2. **Auth + accounts.** Supabase Auth (magic-link email + OAuth), a `profile` table (username, avatar, created_at), session handling, Row-Level Security. Sign-in/up/account UI as Astro islands. Guests can still play; prompt to save scores.
3. **Scores + single-player leaderboards.** Server-validated score submission (never trust the client), per-game personal bests, and leaderboards: global + friends-only + daily / weekly / all-time windows. — ✅ submission + global per-game board DONE (2026-06-27): 23 games POST at game-over via `arcade-client.js`; lower-is-better encoded; board decodes/formats. TODO: server-side validation (client-trusted today), friends-only + time-window boards, personal-best surfacing.

## Next (≤ 5, queued)

1. **Friends graph.** Requests → accept/decline, friends list, shareable invite links (mimic Paddock's `friendship` + invite pattern; `navigator.share` on mobile). — ✅ core DONE (2026-06-27): `/friends` add-by-username, requests accept/decline, friends list + remove. TODO: shareable invite links + `navigator.share`.
2. **Online 2-player via Durable Objects.** One authoritative match-room DO per game over WebSockets. Turn-based first (Connect Four, Tic-Tac-Toe), then action (Pong, Air Hockey, Tron, Snake Duel, Artillery). Reconnect + room codes; server owns state.
3. **Matchmaking, lobbies & presence.** Invite-a-friend-to-play, quick-match queue, "who's online", join-by-code.
4. **Wave 2 games → 30.** ✅ DONE (2026-06-26) — all 12 built + deployed (Frogger, Missile Command, Doodle Jump, Tron ★, Helicopter, Sokoban, 15-Puzzle, Match-3, Bubble Shooter, Air Hockey ★, Artillery ★, Stack Tower). Arcade is at **30 games**. Next on games: per-game score submission to Supabase + a deeper challenge/balance playtest.
5. **Public profiles + stats.** Per-user page: games played, personal bests, badges, friends, recent matches.

## Inbox (unfiltered, append-only)

- ELO / skill rating for competitive online games, with rank tiers.
- Achievements + badges (per-game and meta), surfaced on the profile.
- Daily challenge — one seeded run shared by everyone, with its own 24h leaderboard.
- Spectate live online matches.
- In-match chat + quick emotes.
- Match replays — record inputs, play them back (also feeds anti-cheat verification).
- Anti-cheat hardening — server-authoritative scoring, submission rate limits, replay/input validation, per-game sanity bounds.
- Avatars / cosmetics / selectable arcade themes.
- PWA install + offline single-player.
- Tournaments / brackets + seasonal events.
- Guest play with a "create an account to keep this score" upsell.
- OAuth providers: Google, GitHub, Discord (alongside magic-link email).
- Cloud saves / "continue where you left off" for the longer games.
- Mobile touch controls across every game; a full mobile-first pass.
- Accessibility pass (WCAG 2.2): keyboard nav, contrast, reduced-motion, screen-reader labels on the shell.
- Privacy-friendly analytics + error monitoring.
- CI — GitHub Actions: build + Playwright e2e on PRs (Paddock parked CI on flakiness; pair-debug a green workflow first).
- CHANGELOG.md + RELEASES.md discipline once we deploy (Paddock's two-audience split: engineering log vs public notes).
- AGENTS.md / CONTRIBUTING.md / ONBOARDING.md once the repo has collaborators.
- Friend leagues / private leaderboards (mimic Paddock leagues).
- Global sound/music settings — master mute, per-game volume.
- Username editor — let players set a display username (default is `player_<hex>`); needed so friend-by-name is usable and fixes the long-username overflow in the mobile header. — ✅ shipped 2026-06-27 (`/account` editor + fun `Character#NNNN` defaults).
- Friends-only leaderboards + daily/weekly/all-time windows (the boards are global all-time only today).
- The long-term solo **Adventure** game — the north star, story-driven, likely Godot, years out (see the `arcade-journey` memory).

## Parked (might do, with a revisit trigger)

- **Monetization / cosmetics store.** Revisit only with real, sustained traffic + a demand signal. No paid path before that.
- **Native iOS/Android wrappers.** Revisit after a PWA proves install demand (Paddock's TWA-wrapper path is the cheap route).
- **Voice chat in matches.** Revisit only after text chat + real online usage exist.

## Killed (won't do — with one-line why)

_(empty — promote items here when we explicitly decide to drop them, so they don't get relitigated.)_
