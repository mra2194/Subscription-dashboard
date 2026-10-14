import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { priceFor, usePlans } from '../lib/usePlans';
import { formatRupiah } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { LicenseKeyDialog } from '../components/LicenseKeyDialog';

const todayIso = () => new Date().toISOString().slice(0, 10);

export function TenantNewPage() {
  const navigate = useNavigate();
  const plans = usePlans();
  const [form, setForm] = useState({
    business_name: '', owner_name: '', owner_phone: '', owner_email: '', address: '',
    plan_code: '', start: todayIso(), months: 1, billing_cycle: 'monthly', price: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; code: string; key: string } | null>(null);

  const plan = plans.find((p) => p.code === form.plan_code);
  useEffect(() => {
    if (!form.plan_code && plans[0]) setForm((f) => ({ ...f, plan_code: plans[0].code }));
  }, [plans, form.plan_code]);
  useEffect(() => {
    setForm((f) => ({ ...f, price: priceFor(plan, f.billing_cycle, f.months) }));
  }, [plan, form.billing_cycle, form.months]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: k === 'months' || k === 'price' ? Number(e.target.value) : e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tenant = await api<{ id: string; customer_code: string }>('createTenant', {
        business_name: form.business_name,
        owner_name: form.owner_name,
        owner_phone: form.owner_phone,
        owner_email: form.owner_email,
        address: form.address,
        plan_code: form.plan_code,
        starts_at: new Date(`${form.start}T00:00:00+07:00`).toISOString(),
        months: form.months,
        billing_cycle: form.billing_cycle,
        price: form.price,
      });
      try {
        const res = await api<{ license_key: string }>('issueLicenseKey', { tenant_id: tenant.id });
        setCreated({ id: tenant.id, code: tenant.customer_code, key: res.license_key });
      } catch {
        // Customer sudah dibuat; key bisa diterbitkan dari halaman detail oleh superadmin.
        navigate(`/customer/${tenant.id}`);
      }
    } catch (e2) {
      setError(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Customer baru</h1>
      <form className="card form-grid" onSubmit={submit}>
        {error && <div className="alert span2">{error}</div>}
        <label>Nama toko<input required value={form.business_name} onChange={set('business_name')} /></label>
        <label>Nama owner<input required value={form.owner_name} onChange={set('owner_name')} /></label>
        <label>No HP owner<input required inputMode="tel" value={form.owner_phone} onChange={set('owner_phone')} /></label>
        <label>Email owner<input type="email" value={form.owner_email} onChange={set('owner_email')} /></label>
        <label className="span2">Alamat<input value={form.address} onChange={set('address')} /></label>
        <label>Paket
          <select value={form.plan_code} onChange={set('plan_code')}>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.max_pos_devices} kasir, {p.max_users} user)</option>)}
          </select>
        </label>
        <label>Siklus tagihan
          <select value={form.billing_cycle} onChange={set('billing_cycle')}>
            <option value="monthly">Bulanan</option>
            <option value="yearly">Tahunan</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>Mulai<input type="date" required value={form.start} onChange={set('start')} /></label>
        <label>Durasi (bulan)<input type="number" min={1} max={36} required value={form.months} onChange={set('months')} /></label>
        <label>Harga disepakati (Rp)<input type="number" min={0} required value={form.price} onChange={set('price')} /></label>
        <div className="muted self-end">Harga paket: {formatRupiah(priceFor(plan, form.billing_cycle, form.months))}</div>
        <div className="span2 row">
          <button type="submit" disabled={busy || !form.plan_code}>{busy ? 'Menyimpan…' : 'Simpan & terbitkan license key'}</button>
          <button type="button" className="ghost" onClick={() => navigate('/')}>Batal</button>
        </div>
      </form>
      {created && (
        <LicenseKeyDialog licenseKey={created.key} customerCode={created.code} onClose={() => navigate(`/customer/${created.id}`)} />
      )}
    </>
  );
}
