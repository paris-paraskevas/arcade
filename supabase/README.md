# Supabase

Local dev backend for the arcade — auth, profiles, scores, leaderboards, friends.
Schema lives in `migrations/` (timestamped, RLS-first). Rationale in `../knowledge/DECISIONS.md`.

## Local stack

Runs on a **non-default port range (5442x)** so it doesn't collide with the sibling
Motorsport Supabase (which owns the default 5432x ports). Both stacks coexist.

| Service | URL |
|---|---|
| API / REST | http://127.0.0.1:54421 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54422/postgres` |
| Studio | http://127.0.0.1:54423 |
| Mailpit (email testing) | http://127.0.0.1:54424 |

Local anon/service keys are Supabase's shared **demo defaults** (print them with
`supabase status`) — fine for local, NEVER for production.

## Commands (from the repo root)

- `supabase start` — boot the local stack (applies migrations).
- `supabase stop` — stop it / free the containers.
- `supabase status` — show URLs + keys.
- `supabase db reset` — drop + re-apply all migrations to local.
- `supabase migration new <name>` — create a new timestamped migration.

## Schema (`migrations/`)

- `…_profiles.sql` — `profile`, 1:1 with `auth.users`, auto-created on signup (trigger); public-read / owner-write.
- `…_scores.sql` — `score` (insert-own, immutable) + the `leaderboard` view (best + plays per player per game).
- `…_friends.sql` — `friendship` (requester→addressee; pending/accepted/blocked), visible only to the two parties.
- `…_grants.sql` — table privileges for `anon`/`authenticated`. RLS gates *rows*; grants gate *access* (required by Supabase's new "tables not auto-exposed" default).

Verified end-to-end locally (2026-06-26): signup → auto-profile → authenticated score insert → leaderboard aggregation; anon writes denied.

## Production (hosted) — provisioned

Project **`arcade`** · ref `drkqjfcejhffwpbptzmv` · region **eu-west-1** · org "Paris Dev Motorsport".
URL: **https://drkqjfcejhffwpbptzmv.supabase.co** · dashboard: https://supabase.com/dashboard/project/drkqjfcejhffwpbptzmv

- All four migrations are pushed and verified live (anon read = `[]`, anon write = RLS-denied).
- Keys: `supabase projects api-keys --project-ref drkqjfcejhffwpbptzmv`. The `anon` (legacy JWT) and `publishable` (`sb_publishable_…`) keys are public — safe in the client. The `service_role` / `secret` keys are server-only → store as a Cloudflare secret, never commit.
- DB password was set at creation; reset it in the dashboard (Settings → Database) if you need direct DB / pooler access. The app uses the API keys, not the raw password.
- Update the schema later with `supabase db push` (after `supabase link --project-ref drkqjfcejhffwpbptzmv`).
