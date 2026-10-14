const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const TOKEN_KEY = 'aal.session';

export const apiConfigured = Boolean(API_URL);

export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function getToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // sessionStorage tidak tersedia: sesi hanya hidup selama halaman terbuka
  }
}

type Listener = () => void;
const unauthenticatedListeners = new Set<Listener>();
export function onUnauthenticated(fn: Listener) {
  unauthenticatedListeners.add(fn);
  return () => unauthenticatedListeners.delete(fn);
}

/** Satu pintu ke Apps Script. text/plain agar tidak ada preflight CORS. */
export async function api<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!API_URL) throw new ApiError('CONFIG');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: getToken(), ...params }),
    redirect: 'follow',
  });
  if (!res.ok) throw new ApiError('NETWORK');
  const out = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!out.ok) {
    const code = out.error ?? 'SERVER_ERROR';
    if (code === 'UNAUTHENTICATED') {
      setToken(null);
      unauthenticatedListeners.forEach((fn) => fn());
    }
    throw new ApiError(code);
  }
  return out.data as T;
}
