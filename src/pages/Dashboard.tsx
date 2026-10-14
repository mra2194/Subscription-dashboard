import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { StatusPill } from '../components/Layout';
import { canWrite, type TenantOverview } from '../lib/types';
import { formatDate, formatDateTime, formatRupiah, isCountedAsRevenue, monthlyValue, STATUS_LABEL } from '../lib/format';
import { friendlyError } from '../lib/errors';

export function DashboardPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<TenantOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api<TenantOverview[]>('overview')
      .then(setRows)
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const by = (s: string) => rows.filter((r) => r.access_status === s).length;
    return {
      total: rows.length,
      active: by('active') + by('trial'),
      grace: by('grace'),
      blocked: by('suspended') + by('expired') + by('terminated'),
      expiring: rows.filter((r) => r.access_status === 'active' && r.days_left != null && r.days_left <= 30).length,
      mrr: rows.filter((r) => isCountedAsRevenue(r.access_status)).reduce((sum, r) => sum + monthlyValue(r.price, r.billing_cycle), 0),
    };
  }, [rows]);

  const filtered = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [r.customer_code, r.business_name, r.owner_name, r.owner_phone].some((v) => v?.toLowerCase().includes(q));
  });

  return (
    <>
      <div className="row between">
        <h1>Customer</h1>
        {canWrite(profile?.role) && <Link className="button" to="/customer/baru">+ Customer baru</Link>}
      </div>

      <section className="tiles">
        <Tile label="Total customer" value={stats.total} />
        <Tile label="Aktif" value={stats.active} />
        <Tile label="Habis ≤ 30 hari" value={stats.expiring} tone="warn" />
        <Tile label="Masa tenggang" value={stats.grace} tone="warn" />
        <Tile label="Suspend / habis" value={stats.blocked} tone="bad" />
        <Tile label="MRR" value={formatRupiah(stats.mrr)} />
      </section>

      <input className="search" placeholder="Cari kode, nama toko, owner, no HP…" value={query} onChange={(e) => setQuery(e.target.value)} />

      {error && <div className="alert">{error}</div>}
      {loading ? (
        <p className="muted">Memuat…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">Belum ada customer.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer ID</th><th>Toko</th><th>Paket</th><th>Status</th><th>Aktif sampai</th>
                <th className="num">Sisa hari</th><th className="num">Kasir</th><th className="num">User</th><th>Terakhir online</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/customer/${r.id}`}>{r.customer_code}</Link></td>
                  <td>{r.business_name}<div className="muted small">{r.owner_name} · {r.owner_phone}</div></td>
                  <td>{r.plan_name ?? '-'}</td>
                  <td><StatusPill status={r.access_status} label={STATUS_LABEL[r.access_status] ?? r.access_status} /></td>
                  <td>{formatDate(r.ends_at)}</td>
                  <td className="num">{r.days_left ?? '-'}</td>
                  <td className="num">{r.pos_devices_used}/{r.max_pos_devices ?? '-'}</td>
                  <td className="num">{r.users_used}/{r.max_users ?? '-'}</td>
                  <td>{formatDateTime(r.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`tile ${tone ?? ''}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  );
}
