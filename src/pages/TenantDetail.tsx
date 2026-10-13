import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import { StatusPill } from '../components/Layout';
import { LicenseKeyDialog } from '../components/LicenseKeyDialog';
import { canManageDevices, canWrite, isSuperadmin, type TenantOverview } from '../lib/types';
import { formatDate, formatDateTime, formatRupiah, STATUS_LABEL } from '../lib/format';
import { priceFor, usePlans } from '../lib/usePlans';
import { friendlyError } from '../lib/errors';

interface SubscriptionRow { id: string; starts_at: string; ends_at: string; billing_cycle: string; price: number; status: string; plans: { name: string } | null }
interface DeviceRow { id: string; device_name: string; kind: string; app_version: string | null; activated_at: string; last_seen_at: string | null; deactivated_at: string | null; deactivate_reason: string | null }
interface KeyRow { id: string; key_prefix: string; issued_at: string; revoked_at: string | null; revoke_reason: string | null }
interface AuditRow { id: number; occurred_at: string; action: string }

export function TenantDetailPage() {
  const { id = '' } = useParams();
  const { profile } = useAuth();
  const role = profile?.role;
  const plans = usePlans();
  const [tenant, setTenant] = useState<TenantOverview | null>(null);
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [ext, setExt] = useState({ plan_code: '', months: 1, billing_cycle: 'monthly', price: 0 });

  const load = useCallback(async () => {
    const [t, s, d, k, a] = await Promise.all([
      supabase.from('v_admin_tenant_overview').select('*').eq('id', id).maybeSingle(),
      supabase.from('subscriptions').select('id, starts_at, ends_at, billing_cycle, price, status, plans(name)').eq('tenant_id', id).order('starts_at', { ascending: false }),
      supabase.from('device_activations').select('id, device_name, kind, app_version, activated_at, last_seen_at, deactivated_at, deactivate_reason').eq('tenant_id', id).order('activated_at', { ascending: false }),
      supabase.from('license_keys').select('id, key_prefix, issued_at, revoked_at, revoke_reason').eq('tenant_id', id).order('issued_at', { ascending: false }),
      supabase.from('platform_audit_logs').select('id, occurred_at, action').eq('tenant_id', id).order('occurred_at', { ascending: false }).limit(50),
    ]);
    const firstError = [t, s, d, k].find((r) => r.error)?.error;
    if (firstError) setError(friendlyError(firstError));
    setTenant(t.data as TenantOverview | null);
    setSubs((s.data ?? []) as unknown as SubscriptionRow[]);
    setDevices((d.data ?? []) as DeviceRow[]);
    setKeys((k.data ?? []) as KeyRow[]);
    setAudit((a.data ?? []) as AuditRow[]);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tenant?.plan_code && !ext.plan_code) setExt((e) => ({ ...e, plan_code: tenant.plan_code ?? '' }));
  }, [tenant, ext.plan_code]);
  useEffect(() => {
    const plan = plans.find((p) => p.code === ext.plan_code);
    setExt((e) => ({ ...e, price: priceFor(plan, e.billing_cycle, e.months) }));
  }, [plans, ext.plan_code, ext.billing_cycle, ext.months]);

  async function run(action: () => PromiseLike<{ error: unknown }>, success: string) {
    setError(null);
    setNotice(null);
    const { error: err } = await action();
    if (err) setError(friendlyError(err));
    else setNotice(success);
    await load();
  }

  async function extend(e: FormEvent) {
    e.preventDefault();
    await run(() => supabase.rpc('extend_subscription', {
      p_tenant_id: id, p_plan_code: ext.plan_code, p_months: ext.months, p_billing_cycle: ext.billing_cycle, p_price: ext.price,
    }), `Langganan diperpanjang ${ext.months} bulan.`);
  }

  async function setStatus(status: 'active' | 'suspended') {
    const note = window.prompt(status === 'suspended' ? 'Alasan suspend:' : 'Catatan aktivasi ulang (opsional):') ;
    if (note === null) return;
    await run(() => supabase.rpc('set_tenant_status', { p_tenant_id: id, p_status: status, p_note: note }),
      status === 'suspended' ? 'Customer disuspend.' : 'Customer diaktifkan.');
  }

  async function resetKey() {
    if (!window.confirm('Key lama langsung tidak berlaku. Device yang sudah aktif tetap jalan, tetapi setup baru butuh key baru. Lanjutkan?')) return;
    const { data, error: err } = await supabase.rpc('issue_license_key', { p_tenant_id: id });
    if (err) setError(friendlyError(err));
    else setNewKey(data as string);
    await load();
  }

  async function deactivate(device: DeviceRow) {
    const reason = window.prompt(`Nonaktifkan "${device.device_name}"? Alasan:`);
    if (reason === null) return;
    await run(() => supabase.rpc('deactivate_device', { p_device_id: device.id, p_reason: reason }), 'Device dinonaktifkan, kuota kasir bertambah 1.');
  }

  if (!tenant) return <p className="muted">{error ?? 'Memuat…'}</p>;
  const activeDevices = devices.filter((d) => !d.deactivated_at);

  return (
    <>
      <p><Link to="/">← Semua customer</Link></p>
      <div className="row between">
        <div>
          <h1>{tenant.business_name}</h1>
          <p className="muted"><code>{tenant.customer_code}</code> · {tenant.owner_name} · {tenant.owner_phone}</p>
        </div>
        <StatusPill status={tenant.access_status} label={STATUS_LABEL[tenant.access_status] ?? tenant.access_status} />
      </div>
      {error && <div className="alert">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <section className="tiles">
        <div className="tile"><div className="tile-label">Paket</div><div className="tile-value">{tenant.plan_name ?? '-'}</div></div>
        <div className="tile"><div className="tile-label">Aktif sampai</div><div className="tile-value">{formatDate(tenant.ends_at)}</div><div className="muted small">Tenggang s/d {formatDate(tenant.grace_until)}</div></div>
        <div className="tile"><div className="tile-label">Kasir aktif</div><div className="tile-value">{tenant.pos_devices_used}/{tenant.max_pos_devices ?? '-'}</div></div>
        <div className="tile"><div className="tile-label">User aktif</div><div className="tile-value">{tenant.users_used}/{tenant.max_users ?? '-'}</div></div>
        <div className="tile"><div className="tile-label">License key</div><div className="tile-value"><code>{tenant.license_key_prefix ? `${tenant.license_key_prefix}…` : 'belum ada'}</code></div></div>
      </section>

      <div className="two-col">
        {canWrite(role) && (
          <form className="card" onSubmit={extend}>
            <h2>Perpanjang / ganti paket</h2>
            <p className="muted small">Periode baru dimulai saat periode sekarang berakhir.</p>
            <label>Paket
              <select value={ext.plan_code} onChange={(e) => setExt({ ...ext, plan_code: e.target.value })}>
                {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </label>
            <label>Siklus
              <select value={ext.billing_cycle} onChange={(e) => setExt({ ...ext, billing_cycle: e.target.value })}>
                <option value="monthly">Bulanan</option><option value="yearly">Tahunan</option><option value="custom">Custom</option>
              </select>
            </label>
            <label>Durasi (bulan)<input type="number" min={1} max={36} value={ext.months} onChange={(e) => setExt({ ...ext, months: Number(e.target.value) })} /></label>
            <label>Harga (Rp)<input type="number" min={0} value={ext.price} onChange={(e) => setExt({ ...ext, price: Number(e.target.value) })} /></label>
            <button type="submit">Perpanjang</button>
          </form>
        )}

        {isSuperadmin(role) && (
          <div className="card">
            <h2>Tindakan</h2>
            {tenant.tenant_status === 'suspended'
              ? <button onClick={() => setStatus('active')}>Aktifkan kembali</button>
              : <button className="danger" onClick={() => setStatus('suspended')}>Suspend customer</button>}
            <button className="ghost" onClick={resetKey}>{keys.some((k) => !k.revoked_at) ? 'Reset license key' : 'Terbitkan license key'}</button>
          </div>
        )}
      </div>

      <h2>Device kasir ({activeDevices.length} aktif)</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nama</th><th>Jenis</th><th>Versi</th><th>Aktivasi</th><th>Terakhir online</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {devices.length === 0 && <tr><td colSpan={7} className="muted">Belum ada device diaktifkan.</td></tr>}
            {devices.map((d) => (
              <tr key={d.id}>
                <td>{d.device_name}</td><td>{d.kind}</td><td>{d.app_version ?? '-'}</td>
                <td>{formatDateTime(d.activated_at)}</td><td>{formatDateTime(d.last_seen_at)}</td>
                <td>{d.deactivated_at ? `Nonaktif (${d.deactivate_reason ?? '-'})` : 'Aktif'}</td>
                <td>{!d.deactivated_at && canManageDevices(role) && <button className="ghost small" onClick={() => deactivate(d)}>Nonaktifkan</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Riwayat langganan</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Paket</th><th>Mulai</th><th>Berakhir</th><th>Siklus</th><th className="num">Harga</th></tr></thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.id}><td>{s.plans?.name ?? '-'}</td><td>{formatDate(s.starts_at)}</td><td>{formatDate(s.ends_at)}</td><td>{s.billing_cycle}</td><td className="num">{formatRupiah(s.price)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Riwayat license key</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Prefix</th><th>Diterbitkan</th><th>Status</th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}><td><code>{k.key_prefix}…</code></td><td>{formatDateTime(k.issued_at)}</td><td>{k.revoked_at ? `Dicabut ${formatDateTime(k.revoked_at)} (${k.revoke_reason ?? '-'})` : 'Aktif'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {isSuperadmin(role) && audit.length > 0 && (
        <>
          <h2>Audit log</h2>
          <ul className="audit">{audit.map((a) => <li key={a.id}><span className="muted">{formatDateTime(a.occurred_at)}</span> {a.action}</li>)}</ul>
        </>
      )}

      {newKey && <LicenseKeyDialog licenseKey={newKey} customerCode={tenant.customer_code} onClose={() => setNewKey(null)} />}
    </>
  );
}
