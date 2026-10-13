# Changelog

## [0.1.0] - 2026-10-13
### Added
- Skema control plane Supabase: paket, customer, langganan berantai, license key (hash), aktivasi device dengan kuota, audit log append-only.
- RLS di semua tabel; perubahan data hanya lewat RPC yang memeriksa role admin.
- Login admin dan wajib ganti password saat login pertama, ditegakkan di database.
- Dashboard customer, form customer baru dengan penerbitan license key sekali tampil, halaman detail dengan perpanjang, suspend, reset key, nonaktifkan device.
- Workflow CI (typecheck, unit test, tes database, npm audit) dan deploy GitHub Pages.
