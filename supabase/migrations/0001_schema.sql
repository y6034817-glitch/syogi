-- ============================================================
-- 将棋 ONLINE — 0001: テーブル・RLS・認証トリガー
-- Supabase の SQL Editor に貼って実行します（再実行しても壊れません）。
-- ============================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- 設定値（変更はここだけ） ----------
create or replace function private.cfg_match_timeout() returns interval language sql immutable as $$ select interval '60 seconds' $$;
create or replace function private.cfg_confirm_timeout() returns interval language sql immutable as $$ select interval '10 seconds' $$;
-- この時間、信号が途絶えたら「切断中」とみなす
create or replace function private.cfg_stale() returns interval language sql immutable as $$ select interval '15 seconds' $$;
-- 切断中になってから、負けが確定するまでの猶予
create or replace function private.cfg_grace() returns interval language sql immutable as $$ select interval '60 seconds' $$;
-- 持ち時間（ミリ秒）と秒読み（ミリ秒）。オンライン対戦は固定
create or replace function private.cfg_main_ms() returns int language sql immutable as $$ select 600000 $$;
create or replace function private.cfg_byo_ms() returns int language sql immutable as $$ select 30000 $$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null,
  rating int not null default 1500,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  streak int not null default 0,
  best_streak int not null default 0,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,16}$'),
  constraint profiles_display_name_len check (char_length(display_name) between 1 and 12 and display_name = btrim(display_name))
);
create unique index if not exists profiles_username_key on public.profiles (username);
create index if not exists profiles_rating_idx on public.profiles (rating desc);

-- ユーザー名は変更できない（フロントだけでは破れるため DB で強制）
create or replace function private.profiles_lock_username() returns trigger
language plpgsql as $$
begin
  if new.username is distinct from old.username then
    raise exception 'username_immutable' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'id_immutable' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists profiles_lock_username on public.profiles;
create trigger profiles_lock_username before update on public.profiles
  for each row execute function private.profiles_lock_username();

-- 新規登録時にプロフィールを作る（ユーザー名は疑似メールの @ より前と一致している必要がある）
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  u text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  d text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if u !~ '^[a-z0-9_]{3,16}$' then
    raise exception 'invalid_username';
  end if;
  if split_part(coalesce(new.email, ''), '@', 1) <> u then
    raise exception 'username_email_mismatch';
  end if;
  if d = '' then d := u; end if;
  if char_length(d) > 12 then
    raise exception 'invalid_display_name';
  end if;
  insert into public.profiles (id, username, display_name) values (new.id, u, d);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------- games ----------
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  black uuid not null references public.profiles (id),
  white uuid not null references public.profiles (id),
  status text not null default 'confirming'
    check (status in ('confirming', 'playing', 'finished', 'void')),
  match_mode text not null check (match_mode in ('random', 'word')),
  word text,
  main_ms int not null,
  byo_ms int not null,
  -- 手番側の持ち時間は turn_started_at 時点の値。経過分は参照時に引く
  left_main_b int not null,
  left_main_w int not null,
  turn char(1) not null default 'b' check (turn in ('b', 'w')),
  turn_started_at timestamptz,
  moves_count int not null default 0,
  black_ready boolean not null default false,
  white_ready boolean not null default false,
  confirm_deadline timestamptz not null,
  last_seen_b timestamptz not null default now(),
  last_seen_w timestamptz not null default now(),
  result_kind text,
  winner char(1) check (winner in ('b', 'w')),
  rating_black_before int,
  rating_white_before int,
  rating_black_after int,
  rating_white_after int,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint games_distinct_players check (black <> white)
);
create index if not exists games_black_idx on public.games (black, status);
create index if not exists games_white_idx on public.games (white, status);
create index if not exists games_active_idx on public.games (status) where status in ('confirming', 'playing');

-- ---------- moves ----------
create table if not exists public.moves (
  game_id uuid not null references public.games (id) on delete cascade,
  ply int not null check (ply >= 1),
  usi text not null,
  created_at timestamptz not null default now(),
  primary key (game_id, ply)
);

-- ---------- matchmaking_queue ----------
-- game_id が null なら待機中。成立すると game_id が入る（準備確認中）。
-- notice は「準備OKが間に合わなかった」などを本人の次の poll で伝えるためのもの。
create table if not exists public.matchmaking_queue (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('random', 'word')),
  word text,
  game_id uuid references public.games (id) on delete set null,
  notice text,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  constraint queue_word_rule check ((mode = 'word') = (word is not null))
);
create index if not exists queue_pair_idx on public.matchmaking_queue (mode, word, joined_at) where game_id is null;

-- ---------- rating_history ----------
create table if not exists public.rating_history (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rating_before int not null,
  rating_after int not null,
  delta int not null,
  created_at timestamptz not null default now()
);
create index if not exists rating_history_user_idx on public.rating_history (user_id, created_at desc);

-- ============================================================
-- 権限と RLS
--   ・クライアントはテーブルへ直接書き込めない（表示名の変更だけ例外）
--   ・書き込みはすべて security definer の関数（0002）を通す
-- ============================================================

revoke all on public.profiles, public.games, public.moves, public.matchmaking_queue, public.rating_history
  from anon, authenticated;

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.moves enable row level security;
alter table public.matchmaking_queue enable row level security;
alter table public.rating_history enable row level security;

-- profiles: 自分の行だけ読める（ユーザー名は非公開。公開情報は ranking_top 関数で返す）
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- games / moves: 対局者だけ読める（Realtime もこのポリシーに従う）
grant select on public.games to authenticated;
drop policy if exists games_select_players on public.games;
create policy games_select_players on public.games for select to authenticated
  using (auth.uid() in (black, white));

grant select on public.moves to authenticated;
drop policy if exists moves_select_players on public.moves;
create policy moves_select_players on public.moves for select to authenticated
  using (exists (select 1 from public.games g where g.id = moves.game_id and auth.uid() in (g.black, g.white)));

-- rating_history: 自分の分だけ
grant select on public.rating_history to authenticated;
drop policy if exists rating_history_select_own on public.rating_history;
create policy rating_history_select_own on public.rating_history for select to authenticated using (user_id = auth.uid());

-- matchmaking_queue: 直接は読み書きさせない（関数経由のみ）。ポリシーなし = 全拒否

-- Realtime（対局中の手の同期に使う）
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.moves; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.games; exception when duplicate_object then null; end;
  end if;
end $$;
