# Security Review v0.1.0 (Shadow)

Tanggal: 13/10/2026. Cakupan: `apps-script/`, frontend, workflow CI. Review internal, bukan pentest independen.

**Hasil gerbang: lulus. Tidak ada temuan High/Critical.**

## Kontrol yang sudah ada
| Area | Kontrol |
|---|---|
| Akses data | Sheet private; hanya Apps Script (berjalan sebagai pemilik) yang membaca/menulis. Klien tidak pernah memegang kredensial Google. |
| Rahasia | Repo dan bundle frontend tidak berisi rahasia. Pepper password & ID Sheet di Script Properties. |
| Password | HMAC-SHA256 berulang 2000x dengan salt per user + pepper; perbandingan waktu-konstan; hash tetap dihitung untuk email tak dikenal. |
| Brute force | Kunci 15 menit setelah 5 kali gagal per email; percobaan gagal dicatat di audit. |
| Sesi | Token 256 bit acak, disimpan di cache sebagai hash, berakhir 30 menit idle, logout mencabut sesi. |
| Otorisasi | Setiap aksi memeriksa sesi, flag wajib-ganti-password, dan role di server. |
| Integritas | Semua tulis di bawah `LockService`; formula injection dicegah; error internal disamarkan. |
| License key | Dibuat dari 2 UUID v4 acak, disimpan sebagai SHA-256, tampil sekali, kolom hash tidak pernah dikirim ke klien. |
| Frontend | Token di `sessionStorage`, CSP meta membatasi koneksi hanya ke Google Apps Script, `noindex`, `no-referrer`. |

## Temuan terbuka
| ID | Tingkat | Temuan | Tindakan |
|---|---|---|---|
| S-01 | Medium | Belum ada 2FA untuk admin. | Tambah TOTP di rilis berikutnya. |
| S-02 | Medium | Hash password lebih lemah dari bcrypt/Argon2 (Apps Script tidak menyediakannya). Pepper di Script Properties membuat bocornya Sheet saja tidak cukup untuk menebak password secara offline. | Terima untuk MVP; pindah ke backend dengan Argon2 bila skala bertambah. |
| S-03 | Medium | Siapa pun yang punya akses edit ke Sheet atau proyek Apps Script bisa mengubah data langsung, melewati aturan dan audit. | Jangan bagikan Sheet/proyek; aktifkan 2FA akun Google pemilik. |
| S-04 | Low | Audit log disimpan di Sheet yang bisa diedit pemilik (tidak append-only secara teknis). | Proteksi sheet `audit_log`; ekspor berkala ke arsip. |
| S-05 | Low | GitHub Pages tidak bisa mengirim header HTTP (clickjacking, HSTS). | Terima untuk MVP. |
| S-06 | Info | Kuota harian Google Apps Script dan respon 1-3 detik per aksi. | Pantau; pindah backend bila customer bertambah banyak. |
