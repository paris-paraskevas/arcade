-- Table privileges for the Data API roles.
-- RLS (enabled in the earlier migrations) is necessary but NOT sufficient under
-- Supabase's "new public tables are not auto-exposed" default — the anon /
-- authenticated roles also need explicit GRANTs. The grants decide which
-- operations are even attempted; RLS then filters which rows each role sees.

-- profile: everyone reads (leaderboards + profile pages); owners write (RLS-gated).
grant select on public.profile to anon, authenticated;
grant insert, update on public.profile to authenticated;

-- score: public read; signed-in users insert their own (RLS-gated); rows immutable.
grant select on public.score to anon, authenticated;
grant insert on public.score to authenticated;

-- leaderboard view: public read.
grant select on public.leaderboard to anon, authenticated;

-- friendship: signed-in only; RLS restricts every row to its two involved users.
grant select, insert, update, delete on public.friendship to authenticated;
