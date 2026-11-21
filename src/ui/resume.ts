// 進行中の対局があれば、戻るかどうかを尋ねる（リロード・別端末・切断からの復帰）

import { auth, ApiError } from '../online/api.ts';
import { findActiveGame, openGame } from '../online/supabase-game.ts';
import { PRESETS } from '../game/clock.ts';
import { confirmDialog, toast } from './dialogs.ts';
import { navigate } from './app.ts';

let asking = false;

/** 進行中の対局へ入る（確認なし） */
export async function enterGame(gameId: string): Promise<void> {
  const net = await openGame(gameId);
  navigate('game', { preset: PRESETS[1], net });
}

/** @param inGame 対局画面にいるときは何もしない */
export async function checkResume(inGame: () => boolean): Promise<void> {
  if (asking || !auth.profile || inGame()) return;
  asking = true;
  try {
    const id = await findActiveGame();
    if (!id || inGame()) return;
    const ok = await confirmDialog('対局が続いています', '進行中の対局があります。続きから再開しますか？', '対局に戻る');
    if (!ok) return;
    await enterGame(id);
  } catch (e) {
    if (!(e instanceof ApiError)) toast('対局の確認に失敗しました');
  } finally {
    asking = false;
  }
}
