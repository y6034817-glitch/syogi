// Supabase への最小クライアント（fetch のみ。外部ライブラリなし）。
//   ・認証:   /auth/v1/signup, /auth/v1/token, /auth/v1/logout
//   ・DB関数: /rest/v1/rpc/<name>
//   ・手の送信: /functions/v1/submit-move

import { AUTH_EMAIL_DOMAIN, SUPABASE_KEY, SUPABASE_URL } from './config.ts';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  best_streak: number;
}

interface StoredSession {
  access_token: string;
  refresh_token: string;
  /** 有効期限（UNIX 秒） */
  expires_at: number;
  user_id: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

const SESSION_KEY = 'shogi-online:session:v1';

// ---- 入力チェック（画面とサーバーで同じ規則） --------------------------------

export function validateUsername(u: string): string | null {
  if (!/^[a-z0-9_]{3,16}$/.test(u.toLowerCase().trim())) {
    return 'ユーザー名は半角英数字とアンダースコアで、3〜16文字にしてください';
  }
  return null;
}
export function validatePassword(p: string): string | null {
  if (p.length < 8) return 'パスワードは8文字以上にしてください';
  if (p.length > 72) return 'パスワードは72文字以内にしてください';
  return null;
}
export function validateDisplayName(n: string): string | null {
  const t = n.trim();
  if (t.length < 1) return '表示名を入力してください';
  if (t.length > 12) return '表示名は12文字以内にしてください';
  return null;
}

function emailFor(username: string): string {
  return `${username.toLowerCase().trim()}@${AUTH_EMAIL_DOMAIN}`;
}

// ---- サーバーのエラーを日本語に ---------------------------------------------

const MESSAGES: Record<string, string> = {
  already_in_game: '進行中の対局があります',
  invalid_word: 'ワードは2〜20文字で入力してください',
  invalid_mode: 'マッチングの種類が不正です',
  invalid_display_name: '表示名は1〜12文字にしてください',
  not_authenticated: 'ログインが必要です',
  forbidden: 'この操作はできません',
  invalid_credentials: 'ユーザー名またはパスワードが違います',
  user_already_exists: 'このユーザー名は使われています',
  weak_password: 'パスワードが弱すぎます。別のものにしてください',
  over_request_rate_limit: '操作が多すぎます。しばらくしてからお試しください',
  over_email_send_rate_limit: '操作が多すぎます。しばらくしてからお試しください',
};

function toError(status: number, body: unknown): ApiError {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = String(b.message ?? b.msg ?? b.error_description ?? b.error ?? `HTTP ${status}`);
  const code = String(b.error_code ?? b.code ?? '');
  const known = MESSAGES[raw] ?? MESSAGES[code];
  return new ApiError(known ?? raw, status, known ? (MESSAGES[raw] ? raw : code) : code || raw);
}

// ---- セッション -------------------------------------------------------------

let session: StoredSession | null = loadSession();
let refreshing: Promise<boolean> | null = null;

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as StoredSession;
  } catch {
    /* 無視 */
  }
  return null;
}

function saveSession(s: StoredSession | null): void {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 無視 */
  }
}

interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: { id: string };
}

function sessionFrom(r: AuthResponse): StoredSession | null {
  if (!r.access_token || !r.refresh_token || !r.user?.id) return null;
  const exp = r.expires_at ?? Math.floor(Date.now() / 1000) + (r.expires_in ?? 3600);
  return { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: exp, user_id: r.user.id };
}

async function raw(path: string, init: { method?: string; body?: unknown; token?: string | null }): Promise<Response> {
  const headers: Record<string, string> = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  return fetch(`${SUPABASE_URL}${path}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function refreshSession(): Promise<boolean> {
  if (!session) return false;
  if (refreshing) return refreshing;
  const rt = session.refresh_token;
  refreshing = (async () => {
    try {
      const res = await raw('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: rt } });
      if (!res.ok) {
        // 他のタブが先に更新した場合は、保存されたセッションを使う
        const latest = loadSession();
        if (latest && latest.refresh_token !== rt) {
          session = latest;
          return true;
        }
        if (res.status >= 400 && res.status < 500) saveSession(null);
        return false;
      }
      const s = sessionFrom((await readJson(res)) as AuthResponse);
      if (!s) return false;
      saveSession(s);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function accessToken(): Promise<string | null> {
  if (!session) return null;
  if (session.expires_at - Math.floor(Date.now() / 1000) < 60) {
    await refreshSession();
  }
  return session?.access_token ?? null;
}

export function hasSession(): boolean {
  return session !== null;
}

// ---- 呼び出し ---------------------------------------------------------------

/** DB関数を呼ぶ。ログイン中なら本人として、未ログインなら anon として呼ぶ */
export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  let res = await raw(`/rest/v1/rpc/${name}`, { body: args, token: await accessToken() });
  if (res.status === 401 && session && (await refreshSession())) {
    res = await raw(`/rest/v1/rpc/${name}`, { body: args, token: session?.access_token });
  }
  const body = await readJson(res);
  if (!res.ok) throw toError(res.status, body);
  return body as T;
}

export interface SubmitResult {
  ok: boolean;
  reason?: string;
}

/** 手をサーバーに送って検証・記録してもらう */
export async function submitMove(gameId: string, ply: number, usi: string): Promise<SubmitResult> {
  const call = async (token: string | null): Promise<Response> =>
    raw('/functions/v1/submit-move', { body: { game_id: gameId, ply, usi }, token });
  let res = await call(await accessToken());
  if (res.status === 401 && session && (await refreshSession())) res = await call(session?.access_token ?? null);
  const body = (await readJson(res)) as SubmitResult | null;
  if (!body || typeof body.ok !== 'boolean') throw toError(res.status, body);
  return body;
}

// ---- アカウント -------------------------------------------------------------

type Listener = (p: Profile | null) => void;

class AuthStore {
  profile: Profile | null = null;
  ready = false;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(p: Profile | null): void {
    this.profile = p;
    this.ready = true;
    this.listeners.forEach((f) => f(p));
  }

  /** 起動時: 保存されたセッションでプロフィールを取得する */
  async init(): Promise<void> {
    if (!session) {
      this.set(null);
      return;
    }
    try {
      this.set(await rpc<Profile>('my_profile'));
    } catch (e) {
      // 通信できないだけならログイン状態は保つ（プロフィールだけ空にしない）
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        saveSession(null);
        this.set(null);
      } else if (!this.ready) {
        this.set(null);
      }
    }
  }

  async refresh(): Promise<void> {
    if (!session) return;
    try {
      this.set(await rpc<Profile>('my_profile'));
    } catch {
      /* 無視 */
    }
  }

  async signUp(username: string, password: string, displayName: string): Promise<void> {
    const u = username.toLowerCase().trim();
    const err = validateUsername(u) ?? validatePassword(password) ?? validateDisplayName(displayName);
    if (err) throw new ApiError(err, 400, 'validation');

    const free = await rpc<boolean>('username_available', { p_username: u });
    if (!free) throw new ApiError('このユーザー名は使われています', 422, 'user_already_exists');

    const res = await raw('/auth/v1/signup', {
      body: { email: emailFor(u), password, data: { username: u, display_name: displayName.trim() } },
    });
    const body = await readJson(res);
    if (!res.ok) {
      const e = toError(res.status, body);
      if (e.code === 'email_address_invalid') {
        throw new ApiError(
          'メールアドレスの形式がサーバーに拒否されました。管理者へ連絡してください（VITE_AUTH_EMAIL_DOMAIN の設定）',
          e.status,
          e.code,
        );
      }
      if (res.status >= 500) {
        throw new ApiError('登録に失敗しました。ユーザー名や表示名の条件を確認してください', res.status, e.code);
      }
      throw e;
    }
    const s = sessionFrom(body as AuthResponse);
    if (!s) {
      throw new ApiError(
        'サーバー側で「メール確認」が有効になっています。Supabase の Authentication → Providers → Email で Confirm email を OFF にしてください',
        400,
        'confirm_email_enabled',
      );
    }
    saveSession(s);
    this.set(await rpc<Profile>('my_profile'));
  }

  async signIn(username: string, password: string): Promise<void> {
    const u = username.toLowerCase().trim();
    if (!u || !password) throw new ApiError('ユーザー名とパスワードを入力してください', 400, 'validation');
    const res = await raw('/auth/v1/token?grant_type=password', { body: { email: emailFor(u), password } });
    const body = await readJson(res);
    if (!res.ok) throw toError(res.status, body);
    const s = sessionFrom(body as AuthResponse);
    if (!s) throw new ApiError('ログインに失敗しました', 500, 'no_session');
    saveSession(s);
    this.set(await rpc<Profile>('my_profile'));
  }

  async signOut(): Promise<void> {
    const token = session?.access_token ?? null;
    saveSession(null);
    this.set(null);
    if (token) {
      try {
        await raw('/auth/v1/logout', { token });
      } catch {
        /* 無視 */
      }
    }
  }

  async setDisplayName(name: string): Promise<void> {
    const err = validateDisplayName(name);
    if (err) throw new ApiError(err, 400, 'validation');
    this.set(await rpc<Profile>('set_display_name', { p_name: name.trim() }));
  }
}

export const auth = new AuthStore();

/** 画面に出すためのエラー文 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return '通信できませんでした。ネットワークを確認してください';
  return '予期しないエラーが発生しました';
}
