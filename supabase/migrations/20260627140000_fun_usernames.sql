-- Fun default usernames + allow '#' in handles.
-- New players get a game-character handle like "MsPacman#5234" instead of the
-- old "player_<hex>" placeholder. The '#' discriminator lets popular character
-- names repeat — uniqueness is still enforced on the full (lowercased) handle.
-- Existing usernames are untouched. The /account editor lets players pick a
-- custom handle (it restricts itself to [A-Za-z0-9_]; '#' is reserved for the tag).

-- 1) Allow '#' in usernames (was [A-Za-z0-9_]).
alter table public.profile drop constraint username_chars;
alter table public.profile add constraint username_chars
  check (username ~ '^[A-Za-z0-9_#]+$');

-- 2) New-user trigger: pick a random character handle + 4-digit tag, retry on the
--    rare collision, and fall back to the old player_<hex> scheme if we can't.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  names text[] := array[
    'SuperMario','MsPacman','PacMan','Sonic','Kirby','Link','Zelda','Samus',
    'Pikachu','Yoshi','Bowser','DonkeyKong','Luigi','Megaman','Ryu','Crash',
    'Spyro','Lara','MasterChief','Kratos','Cloud','Sephiroth','Toad','Wario',
    'Birdo','Scorpion','SubZero','Frogger','Qbert','Galaga','Pitfall','Steve'
  ];
  handle text;
  attempt int := 0;
begin
  loop
    attempt := attempt + 1;
    handle := names[1 + floor(random() * array_length(names, 1))::int]
              || '#' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    begin
      insert into public.profile (id, username) values (new.id, handle);
      return new;
    exception when unique_violation then
      if attempt >= 25 then
        insert into public.profile (id, username)
        values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 10));
        return new;
      end if;
      -- else: loop and try another handle
    end;
  end loop;
end; $$;
