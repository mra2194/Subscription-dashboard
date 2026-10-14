# AAL Subscription Dashboard

Dashboard admin untuk mengelola customer, langganan, license key, dan kuota device kasir produk AAL (pertama: POS Waroeng).

- **Frontend:** React + Vite, statis, di-deploy ke GitHub Pages.
- **Backend:** Google Apps Script (`apps-script/`) sebagai satu-satunya pintu ke data.
- **Data:** Google Sheet **private** milik Anda. Dashboard dan aplikasi kasir tidak pernah membaca Sheet langsung.
- Desain lisensi: [`docs/04-lisensi-langganan.md`](docs/04-lisensi-langganan.md).

## Fitur versi ini

- Login email + password, dikunci 15 menit setelah 5 kali gagal, sesi berakhir setelah 30 menit tanpa aktivitas.
- **Wajib ganti password saat login pertama.** Ditegakkan di server: sebelum password diganti, semua aksi data ditolak.
- Daftar customer: status, paket, aktif sampai, sisa hari, kasir & user terpakai dibanding kuota, terakhir online, MRR.
- Tambah customer → Customer ID otomatis (`CUST-00001`) + license key (`AAL-XXXXX-XXXXX-XXXXX-XXXXX`) ditampilkan sekali.
- Detail customer: perpanjang/ganti paket, suspend/aktifkan, reset license key, nonaktifkan device kasir, riwayat, audit log.
- Role admin: `superadmin`, `sales`, `support`, `viewer`.
- **License API untuk aplikasi kasir**: aktivasi device dengan kuota dan token lisensi bertanda tangan yang bisa diverifikasi offline. Kontrak: [`docs/LICENSE-API.md`](docs/LICENSE-API.md).

## Setup (sekali, sekitar 15 menit)

### 1. Google Sheet
1. Buat Google Sheet baru di Drive Anda, misalnya `AAL Subscription DB`. **Jangan dibagikan ke siapa pun.**
2. Salin ID Sheet dari URL: `https://docs.google.com/spreadsheets/d/<ID_INI>/edit`.

### 2. Apps Script
1. Buka <https://script.google.com> → **New project**, beri nama `AAL Subscription API`.
2. Buat file sesuai isi folder `apps-script/`: `Code.gs`, `Db.gs`, `Auth.gs`, `Tenants.gs`, `License.gs`, `Setup.gs` (salin isi masing-masing `.js`). Di **Project Settings** centang *Show "appsscript.json" manifest file in editor*, lalu ganti isinya dengan `apps-script/appsscript.json`.
3. **Project Settings → Script Properties**, tambahkan:
   - `SHEET_ID` = ID Sheet dari langkah 1.2
   - `ADMIN_EMAIL` = email login Anda
   - `ADMIN_TEMP_PASSWORD` = password sementara (min. 12 karakter); otomatis dihapus setelah setup
   - `LICENSE_SIGNING_KEY` = private key dari `node scripts/generate-license-keypair.mjs` (simpan public key-nya untuk aplikasi kasir). Boleh diisi belakangan, sebelum aplikasi kasir dipakai.
4. Pilih fungsi `setup` → **Run** → izinkan akses. Sheet akan terisi tab tabel, paket contoh, dan akun superadmin Anda.
5. **Deploy → New deployment → Web app**: *Execute as*: **Me**, *Who has access*: **Anyone**. Salin URL yang berakhiran `/exec`.

> "Anyone" artinya siapa pun bisa mengirim permintaan ke URL itu, tetapi setiap aksi tetap butuh login. Sheet tetap private karena skrip berjalan sebagai Anda.

### 3. GitHub
1. **Settings → Secrets and variables → Actions → Variables:** tambahkan `VITE_API_URL` = URL `/exec` tadi.
2. **Settings → Pages → Build and deployment → Source:** GitHub Actions.
3. Merge ke `main`. Workflow `CI & Deploy` menjalankan tes lalu men-deploy ke `https://mra2194.github.io/Subscription-dashboard/`.

### 4. Login pertama
Buka URL Pages → login dengan password sementara → Anda diarahkan ke halaman ganti password. Setelah diganti, dashboard terbuka.

**Menambah admin lain:** di editor Apps Script buat fungsi sementara, misalnya
`function tambah() { addAdmin('sales@contoh.com', 'Nama', 'sales', 'Password-Sementara-1'); }`, jalankan, lalu hapus fungsinya. Admin baru wajib ganti password saat login pertama.

**Mengubah kode Apps Script:** setelah mengedit, **Deploy → Manage deployments → Edit → Version: New version**. URL tetap sama.

## Pengembangan

```bash
cp .env.example .env.local   # isi VITE_API_URL
npm install
npm run dev
npm test   # unit test frontend + tes backend Apps Script di lingkungan Sheets tiruan
```
