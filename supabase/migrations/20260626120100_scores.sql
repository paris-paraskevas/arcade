-- Score submissions + the leaderboard view.
-- Scores are public-read; a player may only insert their OWN scores; rows are
-- immutable (no update/delete policy).
-- NOTE: real anti-cheat (server-authoritative scoring, per-game bounds, rate
-- limits) is tracked in IDEAS.md. Foundation = insert-own + non-negative.

create table public.score (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  game       text not null,
  score      integer not null check (score >= 0),
  created_at timestamptz not null default now()
);

create index score_game_value_idx on public.score (game, score desc);
create index score_user_game_idx  on public.score (user_id, game);

alter table public.score enable row level security;

create policy "scores are public read"
  on public.score for select using (true);

create policy "users insert own scores"
  on public.score for insert with check (auth.uid() = user_id);

-- Best score per player per game, joined to profile — the leaderboard source.
-- security_invoker so it respects the querying user's RLS; both underlying
-- tables are public-read, so the board is visible to everyone (incl. guests).
-- Query e.g.:  select * from leaderboard where game = 'snake' order by best desc limit 50;
create view public.leaderboard
  with (security_invoker = true) as
  select
    s.game,
    s.user_id,
    p.username,
    p.avatar_url,
    max(s.score)      as best,
    count(*)          as plays,
    max(s.created_at) as last_played
  from public.score s
  join public.profile p on p.id = s.user_id
  group by s.game, s.user_id, p.username, p.avatar_url;
