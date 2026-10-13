const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Akun Anda tidak punya izin untuk aksi ini.',
  PLAN_NOT_FOUND: 'Paket tidak ditemukan.',
  TENANT_NOT_FOUND: 'Customer tidak ditemukan.',
  DEVICE_NOT_FOUND: 'Device tidak ditemukan atau sudah nonaktif.',
  INVALID_MONTHS: 'Durasi harus 1 sampai 36 bulan.',
  'Invalid login credentials': 'Email atau password salah.',
};

export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  for (const [code, text] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return text;
  }
  return raw || 'Terjadi kesalahan.';
}
