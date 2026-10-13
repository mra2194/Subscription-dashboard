import { describe, expect, it } from 'vitest';
import { checkNewPassword } from './password';

describe('checkNewPassword', () => {
  it('accepts a strong password', () => {
    expect(checkNewPassword('Kopi-Susu-2026', 'Kopi-Susu-2026', 'Sementara123', 'ridho@example.com').ok).toBe(true);
  });
  it('rejects short, weak, reused, mismatched and email-based passwords', () => {
    expect(checkNewPassword('Ab1', 'Ab1', 'x', 'a@b.c').problems).toContain('Minimal 12 karakter.');
    expect(checkNewPassword('alllowercase123', 'alllowercase123', 'x', 'a@b.c').problems).toContain('Harus ada huruf besar.');
    expect(checkNewPassword('Sementara12345', 'Sementara12345', 'Sementara12345', 'a@b.c').problems).toContain('Tidak boleh sama dengan password lama.');
    expect(checkNewPassword('Kopi-Susu-2026', 'Kopi-Susu-2027', 'x', 'a@b.c').problems).toContain('Konfirmasi password tidak sama.');
    expect(checkNewPassword('Ridho-Admin-2026', 'Ridho-Admin-2026', 'x', 'ridho@example.com').problems).toContain('Tidak boleh memuat nama email.');
  });
});
