import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import { friendlyError } from '../lib/errors';

export function LoginPage() {
  const { session, profile, denied, refreshProfile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session && profile) {
    return <Navigate to={profile.must_change_password ? '/ganti-password' : '/'} replace />;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      setError(friendlyError(err));
      setBusy(false);
      return;
    }
    try {
      await refreshProfile();
    } catch (e2) {
      setError(friendlyError(e2));
    }
    setPassword('');
    setBusy(false);
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>Masuk</h1>
        <p className="muted">AAL Subscription Dashboard</p>
        {(error || denied) && <div className="alert">{error ?? denied}</div>}
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Memeriksa…' : 'Masuk'}</button>
      </form>
    </div>
  );
}
