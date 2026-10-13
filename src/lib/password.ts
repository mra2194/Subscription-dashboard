export interface PasswordCheck {
  ok: boolean;
  problems: string[];
}

export const MIN_PASSWORD_LENGTH = 12;

export function checkNewPassword(next: string, confirm: string, current: string, email: string): PasswordCheck {
  const problems: string[] = [];
  if (next.length < MIN_PASSWORD_LENGTH) problems.push(`Minimal ${MIN_PASSWORD_LENGTH} karakter.`);
  if (!/[a-z]/.test(next)) problems.push('Harus ada huruf kecil.');
  if (!/[A-Z]/.test(next)) problems.push('Harus ada huruf besar.');
  if (!/[0-9]/.test(next)) problems.push('Harus ada angka.');
  if (next === current) problems.push('Tidak boleh sama dengan password lama.');
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 3 && next.toLowerCase().includes(local)) problems.push('Tidak boleh memuat nama email.');
  if (next !== confirm) problems.push('Konfirmasi password tidak sama.');
  return { ok: problems.length === 0, problems };
}
