-- Friend requests / friendships. Directed request rows: requester -> addressee.
-- A pair is unique; status moves pending -> accepted (or blocked).

create table public.friendship (
  id         bigint generated always as identity primary key,
  requester  uuid not null references auth.users (id) on delete cascade,
  addressee  uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint no_self_friend check (requester <> addressee),
  unique (requester, addressee)
);

create index friendship_addressee_idx on public.friendship (addressee, status);
create index friendship_requester_idx on public.friendship (requester, status);

alter table public.friendship enable row level security;

-- Either party can see the relationship.
create policy "see own friendships"
  on public.friendship for select
  using (auth.uid() = requester or auth.uid() = addressee);

-- You send a request as yourself.
create policy "send friend request"
  on public.friendship for insert
  with check (auth.uid() = requester);

-- Either party can accept / decline / block ...
create policy "update own friendships"
  on public.friendship for update
  using (auth.uid() = requester or auth.uid() = addressee)
  with check (auth.uid() = requester or auth.uid() = addressee);

-- ... or remove the relationship entirely.
create policy "delete own friendships"
  on public.friendship for delete
  using (auth.uid() = requester or auth.uid() = addressee);

create trigger friendship_touch_updated_at
  before update on public.friendship
  for each row execute function public.touch_updated_at();
