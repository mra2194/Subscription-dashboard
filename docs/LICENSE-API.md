# License API untuk Aplikasi Kasir (POS)

Kontrak antara aplikasi kasir dan backend lisensi (`apps-script/License.js`). Semua panggilan: `POST <URL Web App /exec>`, body JSON, header `Content-Type: text/plain;charset=utf-8`. Respon selalu `{ "ok": true, "data": ... }` atau `{ "ok": false, "error": "KODE" }`.

**Redirect:** Apps Script membalas POST dengan `302` ke `script.googleusercontent.com`. Browser mengikutinya otomatis, tetapi klien HTTP aplikasi (mis. `dio`/`http` di Flutter) umumnya **tidak** mengikuti redirect untuk POST. Klien wajib membaca header `Location` lalu mengirim `GET` ke URL itu untuk mengambil JSON-nya.

## 1. Aktivasi device (sekali per device)

Dipanggil saat setup awal di toko. Owner memasukkan Customer ID dan license key di aplikasi kasir.

```json
{ "action": "activateDevice", "customer_code": "CUST-00001", "license_key": "AAL-XXXXX-XXXXX-XXXXX-XXXXX",
  "device_fingerprint": "<hash stabil per device>", "device_name": "Kasir 1", "app_version": "1.0.0", "kind": "pos" }
```

Respon `data`: `device_id`, `device_token`, `expires_at`, `status`, `paid_until`.

- Device yang sama (sidik jari sama) yang aktivasi ulang memakai slot yang sama; tidak memakan kuota.
- Error: `INVALID_LICENSE`, `LOCKED_OUT` (10 kali salah per Customer ID, tunggu 15 menit), `DEVICE_QUOTA_EXCEEDED: n of m`, `LICENSE_INACTIVE: <status>`, `VALIDATION: ...`.

## 2. Refresh token (tiap 1 jam saat online)

```json
{ "action": "refreshDevice", "device_token": "<token terakhir>", "app_version": "1.0.1",
  "usage": { "active_users": 3, "sales_30d": 420 } }
```

Respon sama seperti aktivasi (`device_id` + token baru). Simpan token baru; token lama masih diterima **satu kali** bila respon sebelumnya hilang di jaringan.

- Error: `INVALID_TOKEN`, `DEVICE_REVOKED` (dinonaktifkan dari dashboard), `LICENSE_INACTIVE: suspended|terminated|expired|none`.

## 3. Format token

`base64url(payload JSON) + "." + base64url(tanda tangan RSA-SHA256)`

Payload: `v`, `cc` (Customer ID), `tid`, `did` (device id), `plan`, `max_pos`, `max_users`, `status`, `paid_until`, `iat`, `exp` (detik epoch), `jti`.

`exp` = paling lama 72 jam setelah terbit, dan tidak pernah melewati akhir masa tenggang langganan.

## 4. Aturan wajib di aplikasi kasir

1. **Verifikasi tanda tangan** token dengan public key yang ditanam di aplikasi, setiap buka aplikasi, buka shift, dan tiap 1 jam. Token yang gagal verifikasi = tidak berlisensi.
2. **Cek `exp` dengan jam yang dikoreksi.** Saat menerima token, simpan `iat` dan jam device saat itu (`received_at`). Waktu efektif = jam device sekarang + (`iat` − `received_at`); token kedaluwarsa bila waktu efektif ≥ `exp`. Bila jam device sekarang lebih kecil dari `received_at` terakhir dikurangi 5 menit, jam dimundurkan: anggap kedaluwarsa dan wajib online. Jangan membandingkan jam device langsung dengan `iat`: device yang jamnya terlambat beberapa menit akan terkunci terus walau baru refresh.
3. **Saat offline**: tetap jualan selama `exp` belum lewat. Tampilkan peringatan bila sisa < 24 jam.
4. **Saat `LICENSE_INACTIVE` atau `DEVICE_REVOKED`**: hentikan transaksi baru, tetapi laporan dan ekspor data tetap bisa dibuka.
5. **Saat error jaringan atau `SERVER_ERROR`**: jangan hapus token; coba lagi nanti.
6. `max_users` dan `plan` dipakai untuk membatasi jumlah akun dan fitur di aplikasi.

## 5. Kunci penandatangan

Buat sekali dengan `node scripts/generate-license-keypair.mjs`.
- Private key → Script Properties `LICENSE_SIGNING_KEY`. Jangan di-commit, jangan dibagikan.
- Public key → ditanam di aplikasi kasir.

Bila private key bocor: rilis dulu aplikasi kasir yang menerima public key lama **dan** baru, tunggu semua device ter-update, baru ganti Script Property. Kalau urutannya terbalik, semua kasir dengan aplikasi lama akan menolak token baru dan terkunci. Server tidak memeriksa tanda tangan saat refresh (hanya hash token), jadi token lama tetap bisa di-refresh dan langsung mendapat token bertanda tangan kunci baru.
