# 将棋 ONLINE

ブラウザで遊べるオンライン将棋。Vite + TypeScript（フレームワークなし）+ Supabase。GitHub Pages で公開できます。

- **マッチング**: 部屋なし。「ランダム」または「ワード」（同じワードを入れた人同士）で自動的につながります
- **操作**: 手番ごとに「動かす」「置く」を選ぶと、動かせる駒／置ける升がハイライトされます（`Q` / `W` キー）
- **ランキング**: Elo レーティング（K=32、初期1500）
- **ログイン**: ユーザー名（変更不可）+ パスワード + 表示名。メール不要
- **AI なし**。ルールは二歩・打ち歩詰め・千日手・連続王手の千日手まで対応

## 公平性・切断対策（サーバーが決める）

| 項目 | 内容 |
|---|---|
| マッチング | 60秒で自動終了。見つかったら10秒以内に「準備OK」。押さなければ元に戻る |
| 持ち時間 | 10分 + 秒読み30秒。時計はサーバー時刻で計算 |
| 切断 | 無通信15秒で「切断中」表示 → さらに60秒の猶予で復帰できる。超えると切断負け |
| 序盤の切断 | 最初の2手以内の切断・双方切断は**無効試合**（レート変動なし） |
| 復帰 | リロード・別端末でも「対局に戻る」で再開 |
| 不正対策 | 手は Edge Function がルールエンジンで検証してから記録。直接書き込みは RLS で禁止 |

## セットアップ

### 1. Supabase（初回のみ）

1. **Authentication → Providers → Email** で **Confirm email を OFF**
2. **Database → Extensions** で `pg_cron` を有効化（切断・時間切れの自動判定に使用）
3. **SQL Editor** で `supabase/setup_all.sql` の中身を貼り付けて実行（`supabase/migrations/` の 0001 → 0002 → 0003 をまとめたもの。再実行しても安全）
4. Edge Function をデプロイ（Supabase CLI）:
   ```bash
   npm run sync:functions            # src/game を supabase/functions/_shared/ にコピー
   supabase login
   supabase link --project-ref <プロジェクトID>
   supabase functions deploy submit-move --no-verify-jwt
   ```
   `--no-verify-jwt` は必須です（JWT は関数内で `auth.getUser()` により検証します）。

接続先は `src/online/config.ts` の既定値（公開用の publishable キー）です。別プロジェクトを使うときは `.env.example` を参照してください。
**`service_role` キーはフロントにも GitHub にも絶対に置かないでください。**

### 2. ローカルで動かす

```bash
npm install
npm run dev
npm test           # ルールエンジン(perft) と手の検証
```

### 3. GitHub Pages で公開

1. GitHub にリポジトリを作って push（ブランチは `main`）
2. **Settings → Pages → Source** を **GitHub Actions** にする
3. push すると `.github/workflows/pages.yml` が自動でビルド・公開します
   （`vite.config.ts` は `base: './'` なのでリポジトリ名の設定は不要です）

## 構成

```
src/game/        ルールエンジン（局面・合法手・SFEN/USI・千日手・手の検証）
src/online/      Supabase クライアント（認証・RPC・対局同期・マッチング）
src/ui/          画面（ホーム / マッチング / ランキング / 対局 / ログイン）とアニメーション
supabase/        SQL マイグレーション・Edge Function
scripts/         テスト・Edge Function 用コピー
```

## 既知の注意点

- ユーザー名は内部で `ユーザー名@shogi.local` というメールとして Supabase Auth に登録します。Supabase がこのドメインを拒否する（`email_address_invalid`）場合は `VITE_AUTH_EMAIL_DOMAIN` を変更してください
- パスワードを忘れた場合は復旧できません（メールがないため）
- 対局の同期は Realtime ではなく 1 秒ごとのポーリングです（無料枠で安定させるため）
- 同じ手数のうちに両者が同時に操作した場合などはサーバーが先着順で確定し、画面は自動で同期し直します
