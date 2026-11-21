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
