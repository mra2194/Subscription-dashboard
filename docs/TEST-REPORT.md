# Test Report v0.1.0 (Sentinel)

Tanggal: 13/10/2026. Dijalankan di PostgreSQL 16 lokal + Node 22.

| Suite | Hasil |
|---|---|
| TypeScript `tsc -b` (strict) | Lulus, 0 error |
| Unit test (Vitest) | 5/5 lulus: kebijakan password, MRR, harga paket |
| Uji database (`supabase/tests/rls_and_rpc_test.sql`) | 8/8 lulus |
| Build produksi (`vite build`) | Lulus |
| `npm audit --omit=dev` | 0 kerentanan |
| Render halaman login (Chromium headless) | Tampil benar |

Uji database mencakup:
1. Anon tidak bisa membaca tabel atau memanggil RPC.
2. Admin yang belum ganti password tidak bisa membaca data atau memanggil RPC tulis.
3. Admin tidak bisa menurunkan flag wajib-ganti-password sendiri.
4. Ganti password di `auth.users` membuka akses.
5. Buat customer, Customer ID & nama schema, format license key, hanya satu key aktif, perpanjangan berantai (paket & kuota tetap mengikuti periode berjalan, sisa hari bertambah).
6. Device ke-3 pada paket 2 kasir ditolak `DEVICE_QUOTA_EXCEEDED`.
7. Viewer hanya baca: tidak bisa suspend, terbitkan key, membaca audit, atau memanggil fungsi internal; `key_hash` tidak bisa dibaca klien.
8. Suspend tercatat di audit; audit log tidak bisa dihapus.

Belum diuji: alur end-to-end di project Supabase sungguhan (GoTrue asli) dan di browser dengan data nyata. Lingkungan tes memakai stub `auth.users`/`auth.uid()` yang meniru Supabase.
