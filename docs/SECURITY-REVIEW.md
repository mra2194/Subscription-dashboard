# Security Review v0.1.0 (Shadow)

Tanggal: 13/10/2026. Cakupan: migrasi Supabase, frontend, workflow CI. Ini review internal (bukan pentest independen).

**Hasil gerbang: lulus. Tidak ada temuan High/Critical.**

## Kontrol yang sudah ada
| Area | Kontrol |
|---|---|
| Rahasia | Frontend hanya memakai anon key (publik by design). Tidak ada service role key, token, atau pepper di repo. |
| Otorisasi | RLS di semua tabel. Klien tidak punya hak INSERT/UPDATE/DELETE. Semua tulis lewat RPC `SECURITY DEFINER` dengan `search_path = ''` dan cek role. |
| View | `security_invoker = true` sehingga RLS tabel dasar tetap berlaku (default view PostgreSQL melewati RLS). |
| Ganti password wajib | Ditegakkan di DB (`has_admin_role` menolak bila flag aktif). Flag hanya turun lewat trigger saat `encrypted_password` benar-benar berubah. |
| License key | 100 bit acak dari `gen_random_bytes`, disimpan sebagai SHA-256, kolom hash tidak bisa dibaca klien, tampil sekali. |
| Audit | Semua RPC tulis mencatat audit; tabel audit append-only via trigger. |
| Sesi | `sessionStorage`, logout otomatis 30 menit idle, verifikasi password lama sebelum ganti. |
| Header | CSP via meta, `noindex`, `no-referrer`. |
| Dependensi | `npm audit` 0 kerentanan; dicek di CI. |

## Temuan terbuka
| ID | Tingkat | Temuan | Tindakan |
|---|---|---|---|
| S-01 | Medium | Belum ada 2FA untuk admin. | Tambah Supabase MFA (TOTP) dan wajibkan `aal2` di RLS pada rilis berikutnya. |
| S-02 | Medium (konfigurasi) | Bila *Allow new users to sign up* tidak dimatikan, orang luar bisa membuat akun Auth. Mereka tetap tidak bisa membaca data (tidak ada baris `platform_admins`), tetapi akun liar tetap tercipta. | Wajib dimatikan saat setup (README langkah 1.3). |
| S-03 | Low | GitHub Pages tidak bisa mengirim header HTTP; `frame-ancestors` di meta CSP diabaikan browser (risiko clickjacking). | Terima untuk MVP; pindah ke hosting yang mendukung header bila diperlukan. |
| S-04 | Low | Brute force login bergantung pada rate limit bawaan Supabase Auth. | Pantau log Auth; tambah CAPTCHA bila ada serangan. |
| S-05 | Info | Region Supabase terdekat adalah Singapura; data customer (nama, no HP owner) disimpan di luar Indonesia. | Cantumkan di perjanjian layanan/kebijakan privasi (UU PDP). |
| S-06 | Info | Reset password via email juga menurunkan flag wajib-ganti (user tetap memilih password sendiri). | Diterima. |
