import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, onUnauthenticated, setToken } from './api';
import type { AdminProfile } from './lib/types';

interface AuthState {
  loading: boolean;
  profile: AdminProfile | null;
  login: (email: string, password: string) => Promise<AdminProfile>;
  changePassword: (current: string, next: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Server juga mengakhiri sesi setelah 30 menit tanpa permintaan.
const IDLE_LIMIT_MS = 30 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<AdminProfile | null>(null);

  const signOut = useCallback(async () => {
    try {
      await api('logout');
    } catch {
      // tetap keluar di sisi klien
    }
    setToken(null);
    setProfile(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; profile: AdminProfile }>('login', { email, password });
    setToken(res.token);
    setProfile(res.profile);
    return res.profile;
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    const res = await api<{ profile: AdminProfile }>('changePassword', { current_password: current, new_password: next });
    setProfile(res.profile);
  }, []);

  useEffect(() => {
    const off = onUnauthenticated(() => setProfile(null));
    if (!getToken()) {
      setLoading(false);
      return () => { off(); };
    }
    api<{ profile: AdminProfile }>('me')
      .then((res) => setProfile(res.profile))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
    return () => { off(); };
  }, []);

  useEffect(() => {
    if (!profile) return;
    let timer = window.setTimeout(signOut, IDLE_LIMIT_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(signOut, IDLE_LIMIT_MS);
    };
    const events = ['mousemove', 'keydown', 'click', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [profile, signOut]);

  return (
    <AuthContext.Provider value={{ loading, profile, login, changePassword, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
