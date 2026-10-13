import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { friendlyError } from '../lib/errors';

export function LoginPage() {
  const { profile, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (profile) {
    return <Navigate to={profile.must_change_password ? '/ganti-password' : '/'} replace />;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(friendlyError(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>Masuk</h1>
        <p className="muted">AAL Subscription Dashboard</p>
        {error && <div className="alert">{error}</div>}
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
