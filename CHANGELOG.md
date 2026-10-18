# Changelog

## [0.1.1] - 2026-10-18
### Fixed
- Semua teks ditulis ke Sheet sebagai teks literal: no HP berawalan `0` tidak lagi berubah menjadi angka, tanggal tidak lagi dikonversi otomatis.
- `refreshDevice` mengembalikan `device_id` seperti aktivasi; error kuota saat masa tenggang kini `LICENSE_INACTIVE: grace`.
- Dokumen lisensi: aturan jam device yang mengunci kasir berjam terlambat, urutan rotasi kunci, catatan redirect 302 Apps Script, sisa rujukan Ed25519 dan 2FA.

## [0.1.0] - 2026-10-13
### Added
- Backend Google Apps Script di atas Google Sheet private: paket, customer, langganan berantai, license key (hash), device kasir dengan kuota, audit log.
- Login admin dengan hash password ber-salt + pepper, penguncian setelah 5 kali gagal, sesi 30 menit, dan wajib ganti password saat login pertama (ditegakkan di server).
- Pencegahan formula injection saat menulis ke Sheet.
- Dashboard customer, form customer baru dengan license key sekali tampil, halaman detail dengan perpanjang, suspend, reset key, nonaktifkan device.
- License API untuk aplikasi kasir: aktivasi device dengan kuota, token RSA-SHA256 berlaku maks. 72 jam untuk mode offline, rotasi token, pencabutan device, laporan pemakaian, kontrak di `docs/LICENSE-API.md`.
- Workflow CI (typecheck, unit test, tes backend, npm audit) dan deploy GitHub Pages.
