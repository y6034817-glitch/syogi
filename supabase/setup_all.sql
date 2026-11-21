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
-- ============================================================
-- 将棋 ONLINE — 0002: 関数（マッチング・対局・切断・時計・レーティング）
-- 0001 のあとに実行します（再実行しても壊れません）。
-- ・private.* : 内部用。クライアントからは呼べない
-- ・public.*  : クライアントから呼ぶ入口（security definer）
-- ============================================================

-- ---------- 内部: 対局の確定（レーティング更新を含む） ----------
-- p_kind: checkmate | resign | timeout | repetition | perpetual | disconnect | void
create or replace function private.finalize_game(p_game uuid, p_kind text, p_winner text)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  g public.games;
  pb public.profiles;
  pw public.profiles;
  sb numeric;
  sw numeric;
  eb numeric;
  ew numeric;
  db int;
  dw int;
  nb int;
  nw int;
begin
  select * into g from public.games where id = p_game for update;
  if not found or g.status in ('finished', 'void') then
    return;
  end if;

  if p_kind = 'void' then
    update public.games set status = 'void', result_kind = 'void', winner = null, finished_at = now()
      where id = p_game;
    return;
  end if;

  -- 2人のプロフィールを id 順にロック（デッドロック防止）
  perform 1 from public.profiles where id in (g.black, g.white) order by id for update;
  select * into pb from public.profiles where id = g.black;
  select * into pw from public.profiles where id = g.white;

  sb := case p_winner when 'b' then 1 when 'w' then 0 else 0.5 end;
  sw := 1 - sb;
  eb := 1 / (1 + power(10, (pw.rating - pb.rating) / 400.0));
  ew := 1 - eb;
  db := round(32 * (sb - eb))::int;
  dw := round(32 * (sw - ew))::int;
  nb := greatest(100, pb.rating + db);
  nw := greatest(100, pw.rating + dw);

  update public.profiles set
    rating = nb,
    wins = wins + (sb = 1)::int,
    losses = losses + (sb = 0)::int,
    draws = draws + (sb = 0.5)::int,
    streak = case when sb = 1 then streak + 1 else 0 end,
    best_streak = greatest(best_streak, case when sb = 1 then streak + 1 else 0 end)
  where id = g.black;

  update public.profiles set
    rating = nw,
    wins = wins + (sw = 1)::int,
    losses = losses + (sw = 0)::int,
    draws = draws + (sw = 0.5)::int,
    streak = case when sw = 1 then streak + 1 else 0 end,
    best_streak = greatest(best_streak, case when sw = 1 then streak + 1 else 0 end)
  where id = g.white;

  insert into public.rating_history (game_id, user_id, rating_before, rating_after, delta) values
    (p_game, g.black, pb.rating, nb, nb - pb.rating),
    (p_game, g.white, pw.rating, nw, nw - pw.rating);

  update public.games set
    status = 'finished',
    result_kind = p_kind,
    winner = p_winner,
    rating_black_before = pb.rating,
    rating_white_before = pw.rating,
    rating_black_after = nb,
    rating_white_after = nw,
    finished_at = now()
  where id = p_game;
end $$;

-- ---------- 内部: 1局の状態を点検して、必要なら確定させる ----------
create or replace function private.resolve_game(p_game uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  g public.games;
  noshow_b boolean;
  noshow_w boolean;
  silent_b interval;
  silent_w interval;
  lost interval := private.cfg_stale() + private.cfg_grace();
  elapsed_ms numeric;
  remain_ms numeric;
begin
  select * into g from public.games where id = p_game for update skip locked;
  if not found then
    return;
  end if;

  if g.status = 'confirming' then
    -- 準備OKを押していない側が、時間切れ or 無信号なら「ドタキャン」
    noshow_b := not g.black_ready and (
      now() > g.confirm_deadline
      or coalesce((select last_seen from public.matchmaking_queue where user_id = g.black), '-infinity') < now() - private.cfg_stale());
    noshow_w := not g.white_ready and (
      now() > g.confirm_deadline
      or coalesce((select last_seen from public.matchmaking_queue where user_id = g.white), '-infinity') < now() - private.cfg_stale());
    if noshow_b or noshow_w then
      update public.games set status = 'void', result_kind = 'void', finished_at = now() where id = g.id;
      -- ドタキャンした側は外れ、もう一方は自動で待機に戻る（待ち時間は新しく数え直す）
      if noshow_b then
        update public.matchmaking_queue set game_id = null, notice = 'declined' where user_id = g.black;
      else
        update public.matchmaking_queue set game_id = null, notice = null, joined_at = now() where user_id = g.black;
      end if;
      if noshow_w then
        update public.matchmaking_queue set game_id = null, notice = 'declined' where user_id = g.white;
      else
        update public.matchmaking_queue set game_id = null, notice = null, joined_at = now() where user_id = g.white;
      end if;
    end if;
    return;
  end if;

  if g.status <> 'playing' then
    return;
  end if;

  silent_b := now() - g.last_seen_b;
  silent_w := now() - g.last_seen_w;

  -- 両者が切断: 無効試合
  if silent_b > lost and silent_w > lost then
    perform private.finalize_game(g.id, 'void', null);
    return;
  end if;

  -- 時間切れ（サーバー時刻で判定。切断中も時計は進む）
  elapsed_ms := extract(epoch from (now() - g.turn_started_at)) * 1000;
  remain_ms := (case g.turn when 'b' then g.left_main_b else g.left_main_w end) + g.byo_ms - elapsed_ms;
  if remain_ms <= 0 then
    perform private.finalize_game(g.id, 'timeout', case g.turn when 'b' then 'w' else 'b' end);
    return;
  end if;

  -- 切断負け（序盤2手以内は無効試合）
  if silent_b > lost then
    if g.moves_count <= 2 then
      perform private.finalize_game(g.id, 'void', null);
    else
      perform private.finalize_game(g.id, 'disconnect', 'w');
    end if;
  elsif silent_w > lost then
    if g.moves_count <= 2 then
      perform private.finalize_game(g.id, 'void', null);
    else
      perform private.finalize_game(g.id, 'disconnect', 'b');
    end if;
  end if;
end $$;

-- ---------- 内部: 全体の掃除（pg_cron が10秒ごとに呼ぶ。入口の関数からも呼ぶ） ----------
create or replace function private.resolve_stale()
returns void language plpgsql security definer set search_path = public, private as $$
declare
  r record;
begin
  delete from public.matchmaking_queue where game_id is null and last_seen < now() - private.cfg_stale();
  for r in select id from public.games where status in ('confirming', 'playing') loop
    perform private.resolve_game(r.id);
  end loop;
end $$;

-- ---------- 内部: 同条件の待機者とペアにする ----------
create or replace function private.try_pair(p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  q public.matchmaking_queue;
  opp uuid;
  gid uuid;
  b uuid;
  w uuid;
begin
  select * into q from public.matchmaking_queue where user_id = p_user;
  if not found or q.game_id is not null or q.notice is not null then
    return;
  end if;

  -- 同じ条件の人の参加を1人ずつ直列に処理する（同時参加ですれ違わないように）
  perform pg_advisory_xact_lock(hashtextextended(q.mode || ':' || coalesce(q.word, ''), 0));

  select * into q from public.matchmaking_queue where user_id = p_user for update;
  if not found or q.game_id is not null or q.notice is not null then
    return;
  end if;

  select user_id into opp from public.matchmaking_queue
    where game_id is null
      and notice is null
      and mode = q.mode
      and word is not distinct from q.word
      and user_id <> p_user
      and last_seen > now() - private.cfg_stale()
    order by joined_at
    limit 1
    for update skip locked;
  if opp is null then
    return;
  end if;

  if random() < 0.5 then b := p_user; w := opp; else b := opp; w := p_user; end if;

  insert into public.games (black, white, match_mode, word, main_ms, byo_ms, left_main_b, left_main_w, confirm_deadline)
  values (b, w, q.mode, q.word, private.cfg_main_ms(), private.cfg_byo_ms(), private.cfg_main_ms(), private.cfg_main_ms(),
          now() + private.cfg_confirm_timeout())
  returning id into gid;

  update public.matchmaking_queue set game_id = gid, notice = null where user_id in (p_user, opp);
end $$;

-- ---------- 内部: マッチングの現在の状態 ----------
create or replace function private.match_state(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  q public.matchmaking_queue;
  g public.games;
  opp uuid;
  opp_name text;
  me_ready boolean;
  opp_ready boolean;
begin
  select * into q from public.matchmaking_queue where user_id = p_user;

  if not found then
    select * into g from public.games
      where status = 'playing' and p_user in (black, white)
      order by created_at desc limit 1;
    if found then
      return jsonb_build_object('phase', 'playing', 'game_id', g.id);
    end if;
    return jsonb_build_object('phase', 'none');
  end if;

  if q.notice is not null then
    delete from public.matchmaking_queue where user_id = p_user;
    return jsonb_build_object('phase', 'failed', 'reason', q.notice,
      'message', '準備OKが間に合わなかったため、マッチングを終了しました');
  end if;

  if q.game_id is null then
    if now() - q.joined_at > private.cfg_match_timeout() then
      delete from public.matchmaking_queue where user_id = p_user;
      return jsonb_build_object('phase', 'failed', 'reason', 'timeout', 'message', '対戦相手が見つかりませんでした');
    end if;
    return jsonb_build_object('phase', 'searching',
      'elapsed_ms', (extract(epoch from (now() - q.joined_at)) * 1000)::bigint,
      'mode', q.mode, 'word', q.word);
  end if;

  select * into g from public.games where id = q.game_id;
  if g.status = 'confirming' then
    opp := case when g.black = p_user then g.white else g.black end;
    select display_name into opp_name from public.profiles where id = opp;
    me_ready := case when g.black = p_user then g.black_ready else g.white_ready end;
    opp_ready := case when g.black = p_user then g.white_ready else g.black_ready end;
    return jsonb_build_object('phase', 'found', 'game_id', g.id, 'opponent_name', opp_name,
      'confirm_ms_left', greatest(0, (extract(epoch from (g.confirm_deadline - now())) * 1000)::bigint),
      'you_ready', me_ready, 'opponent_ready', opp_ready);
  elsif g.status = 'playing' then
    return jsonb_build_object('phase', 'playing', 'game_id', g.id);
  end if;

  -- 無効になった対局を指している（競合）。待機に戻す
  update public.matchmaking_queue set game_id = null where user_id = p_user;
  return jsonb_build_object('phase', 'searching', 'elapsed_ms', 0, 'mode', q.mode, 'word', q.word);
end $$;

-- ============================================================
-- 公開関数（クライアントから呼ぶ）
-- ============================================================

-- ユーザー名が使えるか（ログイン前の新規登録画面で使う）
create or replace function public.username_available(p_username text)
returns boolean language sql security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(btrim(p_username)));
$$;

-- マッチング開始。p_mode = 'random' | 'word'
create or replace function public.join_queue(p_mode text, p_word text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  uid uuid := auth.uid();
  w text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_mode not in ('random', 'word') then raise exception 'invalid_mode'; end if;

  if p_mode = 'word' then
    w := lower(btrim(regexp_replace(normalize(coalesce(p_word, ''), NFKC), '\s+', ' ', 'g')));
    if char_length(w) < 2 or char_length(w) > 20 then raise exception 'invalid_word'; end if;
  else
    w := null;
  end if;

  perform private.resolve_stale();

  if exists (select 1 from public.games where status in ('confirming', 'playing') and uid in (black, white)) then
    -- 準備確認中・対局中に新しく探すことはできない
    if not exists (select 1 from public.matchmaking_queue where user_id = uid) then
      raise exception 'already_in_game';
    end if;
  end if;

  delete from public.matchmaking_queue where user_id = uid;
  insert into public.matchmaking_queue (user_id, mode, word) values (uid, p_mode, w);
  perform private.try_pair(uid);
  return private.match_state(uid);
end $$;

-- 生存信号 + 状態の取得（待機中は2秒ごとに呼ぶ）
create or replace function public.match_poll()
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.matchmaking_queue set last_seen = now() where user_id = uid;
  perform private.resolve_stale();
  perform private.try_pair(uid);
  return private.match_state(uid);
end $$;

-- 「準備OK」
create or replace function public.confirm_ready(p_game uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  uid uuid := auth.uid();
  g public.games;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into g from public.games where id = p_game for update;
  if not found or uid not in (g.black, g.white) then raise exception 'forbidden' using errcode = '42501'; end if;

  if g.status = 'confirming' and now() <= g.confirm_deadline then
    if g.black = uid then
      update public.games set black_ready = true where id = g.id;
    else
      update public.games set white_ready = true where id = g.id;
    end if;
    select * into g from public.games where id = g.id;
    if g.black_ready and g.white_ready then
      update public.games set status = 'playing', started_at = now(), turn_started_at = now(),
        last_seen_b = now(), last_seen_w = now()
        where id = g.id;
      delete from public.matchmaking_queue where user_id in (g.black, g.white);
    end if;
  end if;
  return private.match_state(uid);
end $$;

-- マッチングをやめる（準備確認中なら、相手は待機に戻る）
create or replace function public.cancel_match()
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  uid uuid := auth.uid();
  q public.matchmaking_queue;
  g public.games;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into q from public.matchmaking_queue where user_id = uid;
  if found and q.game_id is not null then
    select * into g from public.games where id = q.game_id for update;
    if g.status = 'confirming' then
      update public.games set status = 'void', result_kind = 'void', finished_at = now() where id = g.id;
      update public.matchmaking_queue set game_id = null, notice = null, joined_at = now()
        where user_id = case when g.black = uid then g.white else g.black end;
    end if;
  end if;
  delete from public.matchmaking_queue where user_id = uid;
  return jsonb_build_object('phase', 'none');
end $$;

-- 対局の状態（生存信号を兼ねる。2秒ごとに呼ぶ）
create or replace function public.game_snapshot(p_game uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  uid uuid := auth.uid();
  g public.games;
  side text;
  opp_silent numeric;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into g from public.games where id = p_game;
  if not found or uid not in (g.black, g.white) then raise exception 'forbidden' using errcode = '42501'; end if;
  side := case when g.black = uid then 'b' else 'w' end;

  if g.status = 'playing' then
    if side = 'b' then
      update public.games set last_seen_b = now() where id = p_game;
    else
      update public.games set last_seen_w = now() where id = p_game;
    end if;
    perform private.resolve_game(p_game);
    select * into g from public.games where id = p_game;
  end if;

  opp_silent := extract(epoch from (now() - case when side = 'b' then g.last_seen_w else g.last_seen_b end)) * 1000;

  return jsonb_build_object(
    'id', g.id,
    'status', g.status,
    'my_side', side,
    'names', jsonb_build_object(
      'b', (select display_name from public.profiles where id = g.black),
      'w', (select display_name from public.profiles where id = g.white)),
    'turn', g.turn,
    'moves_count', g.moves_count,
    'moves', (select coalesce(jsonb_agg(usi order by ply), '[]'::jsonb) from public.moves where game_id = g.id),
    'main_ms', g.main_ms,
    'byo_ms', g.byo_ms,
    'left_main', jsonb_build_object('b', g.left_main_b, 'w', g.left_main_w),
    'elapsed_ms', case when g.turn_started_at is null or g.status <> 'playing' then 0
                       else (extract(epoch from (now() - g.turn_started_at)) * 1000)::bigint end,
    'opp_silent_ms', (opp_silent)::bigint,
    'result', case when g.status in ('finished', 'void')
                   then jsonb_build_object('kind', g.result_kind, 'winner', g.winner) end,
    'ratings', case when g.status = 'finished' then jsonb_build_object(
                      'b', jsonb_build_object('before', g.rating_black_before, 'after', g.rating_black_after),
                      'w', jsonb_build_object('before', g.rating_white_before, 'after', g.rating_white_after)) end
  );
end $$;

-- 投了
create or replace function public.resign_game(p_game uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  uid uuid := auth.uid();
  g public.games;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into g from public.games where id = p_game for update;
  if not found or uid not in (g.black, g.white) then raise exception 'forbidden' using errcode = '42501'; end if;
  if g.status = 'playing' then
    perform private.finalize_game(g.id, 'resign', case when g.black = uid then 'w' else 'b' end);
  end if;
  return public.game_snapshot(p_game);
end $$;

-- 対局中の対局があれば、そのID（再接続用）
create or replace function public.my_active_game()
returns uuid language sql security definer set search_path = public, private as $$
  select id from public.games where status = 'playing' and auth.uid() in (black, white)
  order by created_at desc limit 1;
$$;

-- 自分のプロフィール（ユーザー名つき。他人のユーザー名は返さない）
create or replace function public.my_profile()
returns jsonb language sql security definer set search_path = public as $$
  select to_jsonb(p) - 'created_at' from (
    select id, username, display_name, rating, wins, losses, draws, streak, best_streak
    from public.profiles where id = auth.uid()
  ) p;
$$;

-- 表示名の変更（ユーザー名は変更できない）
create or replace function public.set_display_name(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if char_length(n) < 1 or char_length(n) > 12 then raise exception 'invalid_display_name'; end if;
  update public.profiles set display_name = n where id = auth.uid();
  return public.my_profile();
end $$;

-- ランキング（公開。ユーザー名は返さない）
create or replace function public.ranking_top(p_limit int default 50)
returns table (rank bigint, display_name text, rating int, wins int, losses int, draws int, streak int, is_me boolean)
language sql security definer set search_path = public as $$
  select row_number() over (order by p.rating desc, p.wins desc, p.created_at) as rank,
         p.display_name, p.rating, p.wins, p.losses, p.draws, p.streak,
         (p.id = auth.uid()) as is_me
  from public.profiles p
  where p.wins + p.losses + p.draws > 0
  order by rank
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

-- ============================================================
-- Edge Function（service_role）専用: 検証済みの手を記録する
-- 手の合法性・詰み・千日手の判定は Edge Function がルールエンジンで行う。
-- ============================================================
create or replace function public.record_move(
  p_game uuid, p_user uuid, p_ply int, p_usi text, p_result_kind text default null, p_winner text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  g public.games;
  mover text;
  elapsed_ms int;
  main_left int;
  new_main int;
begin
  select * into g from public.games where id = p_game for update;
  if not found or g.status <> 'playing' then
    return jsonb_build_object('ok', false, 'reason', 'game_not_playing');
  end if;
  mover := case when g.black = p_user then 'b' when g.white = p_user then 'w' end;
  if mover is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if mover <> g.turn then return jsonb_build_object('ok', false, 'reason', 'not_your_turn'); end if;
  if p_ply <> g.moves_count + 1 then return jsonb_build_object('ok', false, 'reason', 'bad_ply'); end if;

  elapsed_ms := (extract(epoch from (now() - g.turn_started_at)) * 1000)::int;
  main_left := case mover when 'b' then g.left_main_b else g.left_main_w end;
  if elapsed_ms > main_left + g.byo_ms then
    perform private.finalize_game(g.id, 'timeout', case mover when 'b' then 'w' else 'b' end);
    return jsonb_build_object('ok', false, 'reason', 'timeout');
  end if;
  new_main := greatest(main_left - elapsed_ms, 0);

  insert into public.moves (game_id, ply, usi) values (g.id, p_ply, p_usi);
  update public.games set
    moves_count = p_ply,
    turn = case mover when 'b' then 'w' else 'b' end,
    turn_started_at = now(),
    left_main_b = case when mover = 'b' then new_main else left_main_b end,
    left_main_w = case when mover = 'w' then new_main else left_main_w end,
    last_seen_b = case when mover = 'b' then now() else last_seen_b end,
    last_seen_w = case when mover = 'w' then now() else last_seen_w end
  where id = g.id;

  if p_result_kind is not null then
    perform private.finalize_game(g.id, p_result_kind, p_winner);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- 実行権限（既定では誰でも呼べてしまうので、明示的に絞る）
-- ============================================================
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.ranking_top(int) to anon, authenticated;
grant execute on function public.join_queue(text, text) to authenticated;
grant execute on function public.match_poll() to authenticated;
grant execute on function public.confirm_ready(uuid) to authenticated;
grant execute on function public.cancel_match() to authenticated;
grant execute on function public.game_snapshot(uuid) to authenticated;
grant execute on function public.resign_game(uuid) to authenticated;
grant execute on function public.my_active_game() to authenticated;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.set_display_name(text) to authenticated;
grant execute on function public.record_move(uuid, uuid, int, text, text, text) to service_role;
-- ============================================================
-- 将棋 ONLINE — 0003: 定期実行（掃除係）
-- 事前に Database → Extensions で pg_cron を有効にしてください。
-- 10秒ごとに、切断負け・時間切れ・準備確認の期限切れ・待機列の掃除を行います。
-- （pg_cron が無くても、クライアントの生存信号のたびに該当の対局は点検されます。
--   ただし両者が落ちた対局は、cron がないと確定が遅れます。）
-- ============================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'shogi-resolve-stale';
    perform cron.schedule('shogi-resolve-stale', '10 seconds', 'select private.resolve_stale()');
    raise notice 'pg_cron: shogi-resolve-stale を登録しました';
  else
    raise notice 'pg_cron が無効です。Database → Extensions で有効にして、このファイルをもう一度実行してください';
  end if;
end $$;
