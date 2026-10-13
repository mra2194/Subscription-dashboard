const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Sesi berakhir. Silakan masuk lagi.',
  PASSWORD_CHANGE_REQUIRED: 'Ganti password dulu sebelum melanjutkan.',
  FORBIDDEN: 'Akun Anda tidak punya izin untuk aksi ini.',
  INVALID_LOGIN: 'Email atau password salah.',
  LOCKED_OUT: 'Terlalu banyak percobaan gagal. Coba lagi 15 menit lagi.',
  WRONG_CURRENT_PASSWORD: 'Password lama salah.',
  PLAN_NOT_FOUND: 'Paket tidak ditemukan.',
  TENANT_NOT_FOUND: 'Customer tidak ditemukan.',
  DEVICE_NOT_FOUND: 'Device tidak ditemukan atau sudah nonaktif.',
  INVALID_MONTHS: 'Durasi harus 1 sampai 36 bulan.',
  NETWORK: 'Tidak bisa menghubungi server. Periksa koneksi.',
  CONFIG: 'Aplikasi belum dikonfigurasi.',
  SERVER_ERROR: 'Terjadi kesalahan di server.',
};

export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.startsWith('WEAK_PASSWORD:')) return raw.slice('WEAK_PASSWORD:'.length).trim();
  if (raw.startsWith('VALIDATION:')) return raw.slice('VALIDATION:'.length).trim();
  for (const [code, text] of Object.entries(MESSAGES)) {
    if (raw === code || raw.startsWith(code)) return text;
  }
  if (err instanceof TypeError) return MESSAGES.NETWORK;
  return raw || 'Terjadi kesalahan.';
}
