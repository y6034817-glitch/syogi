// Edge Function: submit-move
// クライアントが指した手をサーバーで検証してから記録する。
//   1. JWT からユーザーを確認
//   2. 対局・手番・手数を確認
//   3. ルールエンジン（_shared/game）で合法手か判定し、詰み・千日手も判定
//   4. DB 関数 record_move（service_role 専用）で記録。持ち時間はそこでサーバー時刻から計算
//
// デプロイ: supabase functions deploy submit-move --no-verify-jwt
// （JWT はこの関数の中で auth.getUser() により検証する）

import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateMove } from '../_shared/game/replay.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USI = /^(?:[1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json({ ok: false, reason: 'server_misconfigured' }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1. ユーザー確認
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ ok: false, reason: 'unauthorized' }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ ok: false, reason: 'unauthorized' }, 401);
    const userId = userData.user.id;

    // 入力の検証
    let body: { game_id?: unknown; ply?: unknown; usi?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, reason: 'bad_request' }, 400);
    }
    const { game_id: gameId, ply, usi } = body;
    if (typeof gameId !== 'string' || !UUID.test(gameId)) return json({ ok: false, reason: 'bad_request' }, 400);
    if (typeof ply !== 'number' || !Number.isInteger(ply) || ply < 1 || ply > 1000) return json({ ok: false, reason: 'bad_request' }, 400);
    if (typeof usi !== 'string' || !USI.test(usi)) return json({ ok: false, reason: 'bad_request' }, 400);

    // 2. 対局・手番・手数の確認
    const { data: game, error: gameErr } = await admin
      .from('games')
      .select('id, black, white, status, turn, moves_count')
      .eq('id', gameId)
      .maybeSingle();
    if (gameErr) {
      console.error('[submit-move] games select failed', { code: gameErr.code, message: gameErr.message, details: gameErr.details, hint: gameErr.hint });
      return json({ ok: false, reason: 'db_error' }, 500);
    }
    if (!game || (game.black !== userId && game.white !== userId)) return json({ ok: false, reason: 'forbidden' }, 403);
    if (game.status !== 'playing') return json({ ok: false, reason: 'game_not_playing' });
    const side = game.black === userId ? 'b' : 'w';
    if (game.turn !== side) return json({ ok: false, reason: 'not_your_turn' });
    if (ply !== game.moves_count + 1) return json({ ok: false, reason: 'bad_ply' });

    // 3. これまでの手を再生して、この手が合法か判定する
    const { data: rows, error: movesErr } = await admin
      .from('moves')
      .select('ply, usi')
      .eq('game_id', gameId)
      .order('ply', { ascending: true });
    if (movesErr) {
      console.error('[submit-move] moves select failed', { code: movesErr.code, message: movesErr.message, details: movesErr.details, hint: movesErr.hint });
      return json({ ok: false, reason: 'db_error' }, 500);
    }
    const history = (rows ?? []).map((r: { usi: string }) => r.usi);
    if (history.length !== game.moves_count) return json({ ok: false, reason: 'history_mismatch' }, 500);

    const v = validateMove(history, usi);
    if (!v.ok) return json({ ok: false, reason: v.reason === 'illegal' ? 'illegal_move' : 'bad_history' });

    // 4. 記録（持ち時間の計算・終局時のレーティング更新は DB 側）
    const { data: rec, error: recErr } = await admin.rpc('record_move', {
      p_game: gameId,
      p_user: userId,
      p_ply: ply,
      p_usi: usi,
      p_result_kind: v.result ? v.result.kind : null,
      p_winner: v.result ? v.result.winner : null,
    });
    if (recErr) {
      console.error('[submit-move] record_move RPC failed', { code: recErr.code, message: recErr.message, details: recErr.details, hint: recErr.hint });
      return json({ ok: false, reason: 'db_error' }, 500);
    }
    return json(rec);
  } catch (e) {
    console.error('[submit-move] unexpected error', e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e);
    return json({ ok: false, reason: 'internal_error' }, 500);
  }
});
