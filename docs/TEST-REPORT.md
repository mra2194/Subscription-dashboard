# Test Report v0.1.0 (Sentinel)

Tanggal: 13/10/2026. Node 22, Chromium headless.

| Suite | Hasil |
|---|---|
| TypeScript `tsc -b` (strict) | Lulus, 0 error |
| Unit test frontend (Vitest) | 5/5 lulus: kebijakan password, MRR, harga paket |
| Tes backend Apps Script (`tests/appsScript.test.ts`) | 10/10 lulus |
| End-to-end di browser (Chromium + backend tiruan) | Lulus: login → dipaksa ganti password (akses langsung ke dashboard tetap dialihkan) → dashboard → customer baru → license key tampil sekali → detail → logout |
| Build produksi | Lulus |
| `npm audit --omit=dev` | 0 kerentanan |

Tes backend menjalankan file `apps-script/*.js` apa adanya di atas tiruan `SpreadsheetApp`, `CacheService`, `PropertiesService`, `LockService`, dan `Utilities`, mencakup:
1. `setup()` membuat tabel, paket, superadmin; password sementara tidak tersimpan; idempoten.
2. Penguncian setelah 5 login gagal, terbuka lagi setelah 15 menit.
3. Semua aksi data ditolak `PASSWORD_CHANGE_REQUIRED` sebelum ganti password.
4. Validasi password lama & aturan password baru; password lama tidak berlaku lagi.
5. Sesi berakhir 30 menit tanpa aktivitas (sliding), logout mengakhiri sesi.
6. Token kosong/palsu dan aksi tak dikenal ditolak.
7. Customer baru, formula injection dicegah (diverifikasi dengan uji mutasi), satu key aktif, hash key tidak pernah dikirim ke klien, perpanjangan berantai, suspend memblok aktivasi device, audit tercatat.
8. Kuota device: device ke-3 pada paket 2 kasir ditolak; menonaktifkan device membebaskan kuota.
9. Role: viewer hanya baca dan tidak melihat audit; sales tidak bisa suspend atau menerbitkan key.
10. Validasi input; error internal disamarkan menjadi `SERVER_ERROR`.

**Belum diuji:** deployment Apps Script sungguhan di akun Google (perilaku redirect & CORS Web App, kuota Google, kecepatan). Ini harus dicek saat setup pertama.
