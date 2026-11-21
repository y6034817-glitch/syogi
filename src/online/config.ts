// Supabase の接続設定。
// URL と publishable キーは公開前提の値です（フロントに入れて問題ありません。守っているのは RLS と関数の権限）。
// ※ service_role キーは絶対にここへ書かないでください。
//
// 上書きしたいときは .env に書きます:
//   VITE_SUPABASE_URL=...
//   VITE_SUPABASE_PUBLISHABLE_KEY=...
//   VITE_AUTH_EMAIL_DOMAIN=...

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<
  string,
  string | undefined
>;

export const SUPABASE_URL = (env.VITE_SUPABASE_URL || 'https://btfiubzoalctnbdszwpo.supabase.co').replace(/\/$/, '');
export const SUPABASE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_UkaClm8DOyZJLegqycvAnw_oLAK_BGi';

/**
 * ユーザー名ログイン用の疑似メールのドメイン。実際にメールは送りません（メール確認は OFF）。
 * 登録時に「メールアドレスが不正」と言われる場合は、ここを変えてください。
 */
export const AUTH_EMAIL_DOMAIN = env.VITE_AUTH_EMAIL_DOMAIN || 'shogi.local';
