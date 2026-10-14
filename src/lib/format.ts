export type AccessStatus = 'trial' | 'active' | 'grace' | 'scheduled' | 'expired' | 'suspended' | 'terminated' | 'none';

export const STATUS_LABEL: Record<AccessStatus, string> = {
  trial: 'Trial',
  active: 'Aktif',
  grace: 'Masa tenggang',
  scheduled: 'Terjadwal',
  expired: 'Habis',
  suspended: 'Suspend',
  terminated: 'Berhenti',
  none: 'Tanpa langganan',
};

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const tanggal = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
const waktu = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });

export const formatRupiah = (n: number | null | undefined) => (n == null ? '-' : rupiah.format(Number(n)));
export const formatDate = (iso: string | null | undefined) => (iso ? tanggal.format(new Date(iso)) : '-');
export const formatDateTime = (iso: string | null | undefined) => (iso ? waktu.format(new Date(iso)) : '-');

/** Pendapatan bulanan berulang dari satu langganan. */
export function monthlyValue(price: number | null, cycle: string | null): number {
  if (price == null) return 0;
  return cycle === 'yearly' ? Number(price) / 12 : Number(price);
}

export function isCountedAsRevenue(status: AccessStatus): boolean {
  return status === 'active' || status === 'grace';
}
