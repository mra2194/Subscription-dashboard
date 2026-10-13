# Changelog

## [0.1.0] - 2026-10-13
### Added
- Backend Google Apps Script di atas Google Sheet private: paket, customer, langganan berantai, license key (hash), device kasir dengan kuota, audit log.
- Login admin dengan hash password ber-salt + pepper, penguncian setelah 5 kali gagal, sesi 30 menit, dan wajib ganti password saat login pertama (ditegakkan di server).
- Pencegahan formula injection saat menulis ke Sheet.
- Dashboard customer, form customer baru dengan license key sekali tampil, halaman detail dengan perpanjang, suspend, reset key, nonaktifkan device.
- Workflow CI (typecheck, unit test, tes backend, npm audit) dan deploy GitHub Pages.
