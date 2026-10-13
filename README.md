# AAL Subscription Dashboard

Dashboard admin untuk mengelola customer, langganan, license key, dan kuota device kasir produk AAL (pertama: POS Waroeng).

- **Frontend:** React + Vite, statis, di-deploy ke GitHub Pages.
- **Backend:** Supabase (PostgreSQL + Auth). Semua aturan keamanan ada di database: RLS, fungsi RPC, dan trigger. Frontend tidak memegang rahasia apa pun.
- Desain lengkap: [`docs/04-lisensi-langganan.md`](docs/04-lisensi-langganan.md).

## Fitur versi ini

- Login email + password (Supabase Auth), sesi hilang saat tab ditutup, logout otomatis 30 menit tanpa aktivitas.
- **Wajib ganti password saat login pertama.** Ditegakkan di database: sebelum password diganti, akun tidak bisa membaca data apa pun walaupun memanggil API langsung.
- Daftar customer: status, paket, aktif sampai, sisa hari, kasir & user terpakai dibanding kuota, terakhir online, MRR.
- Tambah customer → Customer ID otomatis (`CUST-00001`) + license key (`AAL-XXXXX-XXXXX-XXXXX-XXXXX`) ditampilkan sekali.
- Detail customer: perpanjang/ganti paket, suspend/aktifkan, reset license key, nonaktifkan device kasir, riwayat langganan, riwayat key, audit log.
- Role admin: `superadmin`, `sales`, `support`, `viewer`.

## Setup (sekali)

### 1. Supabase
1. Buat project di <https://supabase.com> (region terdekat: Southeast Asia/Singapore).
2. **SQL Editor** → tempel isi `supabase/migrations/20261013000000_init.sql` → Run.
3. **Authentication → Sign In / Providers → Email:** matikan **Allow new users to sign up**. Set minimum password length 12.
4. **Authentication → Users → Add user → Create new user:** isi email Anda dan password sementara, centang *Auto Confirm User*.
5. **SQL Editor**, jadikan akun tadi superadmin:
   ```sql
   insert into public.platform_admins (id, email, full_name, role)
   select id, email, 'Ridho', 'superadmin' from auth.users where email = 'EMAIL_ANDA';
   ```
6. **Project Settings → API:** catat *Project URL* dan *anon public key*.
7. **Authentication → URL Configuration:** Site URL = `https://mra2194.github.io/Subscription-dashboard/`.

### 2. GitHub
1. **Settings → Secrets and variables → Actions → Variables:** tambahkan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` (anon key memang publik; bukan service role key).
2. **Settings → Pages → Build and deployment → Source:** GitHub Actions.
3. Merge ke `main`. Workflow `CI & Deploy` menjalankan tes lalu men-deploy ke `https://mra2194.github.io/Subscription-dashboard/`.

> Jangan pernah menaruh **service_role key** Supabase di repo, variable GitHub, atau frontend.

### 3. Login pertama
Buka URL Pages → login dengan password sementara → Anda diarahkan ke halaman ganti password. Setelah diganti, dashboard terbuka.

Menambah admin lain: ulangi langkah 1.4 dan 1.5 dengan role yang sesuai. Mereka juga wajib ganti password saat login pertama.

## Pengembangan

```bash
cp .env.example .env.local   # isi URL & anon key
npm install
npm run dev
npm test          # unit test
npm run test:db   # migrasi + uji RLS/RPC di PostgreSQL lokal (butuh initdb/psql 15+)
```
