-- Player profiles, 1:1 with auth.users.
-- Public-readable (leaderboards + profile pages show usernames), owner-writable.
-- A new auth user automatically gets a profile via a trigger.

create table public.profile (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint username_len   check (char_length(username) between 3 and 24),
  constraint username_chars check (username ~ '^[A-Za-z0-9_]+$')
);

-- Case-insensitive uniqueness: "Bob" and "bob" can't both exist.
create unique index profile_username_lower_idx on public.profile (lower(username));

alter table public.profile enable row level security;

create policy "profiles are public read"
  on public.profile for select using (true);

create policy "users insert own profile"
  on public.profile for insert with check (auth.uid() = id);

create policy "users update own profile"
  on public.profile for update using (auth.uid() = id) with check (auth.uid() = id);

-- Keep updated_at fresh (reused by other tables).
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create trigger profile_touch_updated_at
  before update on public.profile
  for each row execute function public.touch_updated_at();

-- Auto-create a profile when a new auth user signs up. The username defaults to
-- a safe placeholder the player changes later. SECURITY DEFINER so the insert
-- runs regardless of the calling session.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile (id, username)
  values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 10));
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
