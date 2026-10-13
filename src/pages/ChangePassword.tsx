import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { checkNewPassword, MIN_PASSWORD_LENGTH } from '../lib/password';
import { friendlyError } from '../lib/errors';

export function ChangePasswordPage() {
  const { profile, changePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forced = profile?.must_change_password ?? false;
  const email = profile?.email ?? '';
  const check = checkNewPassword(next, confirm, current, email);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!check.ok) return;
    setBusy(true);
    setError(null);
    try {
      // Server memverifikasi password lama dan menegakkan aturan password yang sama.
      await changePassword(current, next);
      navigate('/', { replace: true });
    } catch (e2) {
      setError(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>Ganti password</h1>
        {forced && (
          <div className="alert info">
            Ini login pertama Anda. Ganti password sementara sebelum melanjutkan. Data tidak bisa dibuka sebelum langkah ini selesai.
          </div>
        )}
        {error && <div className="alert">{error}</div>}
        <label>
          Password lama
          <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label>
          Password baru
          <input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label>
          Ulangi password baru
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {next.length > 0 && !check.ok && (
          <ul className="hints">{check.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        <button type="submit" disabled={busy || !check.ok || !current}>{busy ? 'Menyimpan…' : 'Simpan password'}</button>
        {forced ? (
          <button type="button" className="ghost" onClick={signOut}>Keluar</button>
        ) : (
          <button type="button" className="ghost" onClick={() => navigate('/')}>Batal</button>
        )}
      </form>
    </div>
  );
}
