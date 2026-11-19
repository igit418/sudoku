-- =====================================================================
--  Sudoku – konfiguracja bazy w Supabase
--  Wklej CAŁOŚĆ w: Supabase → SQL Editor → New query → Run
--  Skrypt można uruchomić ponownie – nic się nie zdubluje.
-- =====================================================================

-- 1) Tabela profili graczy (jeden wiersz na każde konto)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  nick        text not null check (char_length(nick) between 2 and 20),
  role        text not null default 'user' check (role in ('user','admin')),
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  started     integer not null default 0,
  won         integer not null default 0,
  lost        integer not null default 0,
  points      integer not null default 0,
  best        jsonb   not null default '{}'::jsonb,
  wins        jsonb   not null default '{}'::jsonb,   -- wygrane na każdym poziomie (GOD: 5× Ekstremalny)
  accepted_terms_at timestamptz,
  confirmed   boolean not null default false
);
alter table public.profiles add column if not exists confirmed boolean not null default false;
alter table public.profiles add column if not exists wins jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists settings jsonb not null default '{}'::jsonb;  -- motyw i opcje gracza

-- 2) Czy zalogowany użytkownik jest adminem?
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 3) Po rejestracji automatycznie tworzy profil.
--    Konto właściciela (igor.kudlaty@gmail.com) od razu dostaje rolę admina.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, nick, role, accepted_terms_at, confirmed)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data->>'nick'), ''), split_part(new.email, '@', 1)),
    case when lower(new.email) in ('igor.kudlaty@gmail.com', 'rogi.kudlaty@gmail.com') then 'admin' else 'user' end,
    case when (new.raw_user_meta_data->>'accepted_terms') = 'true' then now() else null end,
    new.email_confirmed_at is not null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3b) Gdy ktoś potwierdzi e-mail albo zmieni adres – aktualizuj profil
create or replace function public.handle_user_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
     set email = lower(new.email),
         confirmed = new.email_confirmed_at is not null
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email, email_confirmed_at on auth.users
  for each row execute function public.handle_user_update();

-- 4) Zabezpieczenia (RLS): każdy widzi i zmienia tylko swój profil, admin widzi wszystkie
alter table public.profiles enable row level security;

drop policy if exists "profil: odczyt własny lub admin" on public.profiles;
create policy "profil: odczyt własny lub admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profil: zmiana własnego" on public.profiles;
create policy "profil: zmiana własnego" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Gracz może zmieniać tylko te kolumny (NIE może nadać sobie roli admina ani zmienić e-maila)
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (nick, last_seen, started, won, lost, points, best, wins, settings) on public.profiles to authenticated;

-- 5) Funkcje dla admina
create or replace function public.admin_set_role(target uuid, new_role text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień'; end if;
  if new_role not in ('user','admin') then raise exception 'Zła rola'; end if;
  if target = auth.uid() and new_role <> 'admin' then raise exception 'Nie możesz odebrać roli sobie'; end if;
  update public.profiles set role = new_role where id = target;
end;
$$;

create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień'; end if;
  if target = auth.uid() then raise exception 'Nie możesz usunąć własnego konta z panelu admina'; end if;
  delete from auth.users where id = target;   -- profil usuwa się sam (on delete cascade)
end;
$$;

-- 6) Gracz może sam usunąć swoje konto (prawo do usunięcia danych – RODO)
create or replace function public.delete_own_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'Nie jesteś zalogowany'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.admin_set_role(uuid, text)  from public, anon;
revoke all on function public.admin_delete_user(uuid)     from public, anon;
revoke all on function public.delete_own_account()         from public, anon;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_delete_user(uuid)    to authenticated;
grant execute on function public.delete_own_account()        to authenticated;
grant execute on function public.is_admin()                  to authenticated;

-- 7) Jeśli założyłeś już konto przed uruchomieniem skryptu – utwórz brakujące profile
insert into public.profiles (id, email, nick, role, confirmed)
select u.id, lower(u.email), split_part(u.email, '@', 1),
       case when lower(u.email) in ('igor.kudlaty@gmail.com', 'rogi.kudlaty@gmail.com') then 'admin' else 'user' end,
       u.email_confirmed_at is not null
from auth.users u
on conflict (id) do nothing;

update public.profiles p set confirmed = (u.email_confirmed_at is not null)
from auth.users u where u.id = p.id;
