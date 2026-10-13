import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AdminProfile } from './lib/types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: AdminProfile | null;
  /** Diisi bila login berhasil di Supabase tetapi akun bukan admin aktif. */
  denied: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const IDLE_LIMIT_MS = 30 * 60 * 1000;

async function loadProfile(): Promise<AdminProfile | null> {
  const { data, error } = await supabase.rpc('my_admin_profile');
  if (error) throw error;
  const rows = (data ?? []) as AdminProfile[];
  return rows[0] ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [denied, setDenied] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const p = await loadProfile();
    if (!p) {
      setDenied('Akun ini tidak terdaftar sebagai admin.');
      await signOut();
      return;
    }
    if (!p.is_active) {
      setDenied('Akun admin ini dinonaktifkan.');
      await signOut();
      return;
    }
    setDenied(null);
    setProfile(p);
  }, [signOut]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session) await refreshProfile().catch(() => signOut());
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setProfile(null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [refreshProfile, signOut]);

  // Logout otomatis setelah 30 menit tanpa aktivitas.
  useEffect(() => {
    if (!session) return;
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
  }, [session, signOut]);

  return (
    <AuthContext.Provider value={{ loading, session, profile, denied, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
