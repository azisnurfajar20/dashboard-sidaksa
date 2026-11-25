# SIDAKSA

Dashboard internal akses kerja dan alumni. Implementasi MVP baca-saja berdasarkan `docs/PRD.md` v0.3.

## Teknologi

- UI React + TypeScript + **Bootstrap 5.3.8**.
- Palet: **#06509B**, **#FF9001**, **#FFFFFF**.
- Backend Node.js 22.12+ dan Express.
- Login Supabase Auth; sumber operasional Google Sheets privat.
- Snapshot, mapping, review, dan audit tersimpan privat di `.private/data`, bukan Supabase Database secara otomatis.

## Menjalankan di Windows

Folder proyek: `D:\sidaksa`. Node/npm sudah tersedia pada komputer saat proyek dibuat.

Pemilik menjalankan server operasional sendiri. Buka PowerShell, lalu:

```powershell
cd D:\sidaksa
npm run start
```

Tidak ada autostart/service yang diperlukan. Biarkan terminal tersebut terbuka; Ctrl+C menghentikan server. Asisten tidak mempertahankan server operasional di background.

Buka alamat yang dicetak server; default:

```text
http://127.0.0.1:3080
```

Setelah source diubah, jalankan `npm run build` sebelum `npm run start`; `start-sidaksa.cmd` merupakan alternatif build-dan-start yang juga harus dibuka sendiri. Untuk pengembangan gunakan `start-dev.cmd`. Jangan menghapus cache, mapping, kredensial atau Excel untuk mengatasi error startup. Lihat `docs/STARTUP.md`.

## Perbaikan Google Auth 21 November 2026

Pemanggilan deprecated `keyFile`/`keyFilename` diganti objek JWT service-account tervalidasi dengan scope Sheets baca-saja. Seluruh 16 tes auth/transport terfokus, typecheck, build, scan bundle dan 6 skenario browser lulus; pembacaan Google Sheets nyata menghasilkan **0 warning**, tanpa mengubah kredensial atau data sumber. Pengujian penuh menemukan penolakan lock intermittent yang dicatat terpisah; status lengkap dan batasnya berada di `docs/GOOGLE-AUTH-20261121.md`.

Untuk memakai build baru saat server lama masih aktif, hentikan dengan **Ctrl+C di terminal server tersebut**, lalu jalankan `npm run start`. Start duplikat di terminal lain tidak memuat ulang backend. Asisten tidak menghentikan/restart proses pemilik.

## Perbaikan dan verifikasi 20 November 2026

Build terbaru telah lulus `npm run verify`: **307 tes / 47 file**, 6 tes tools, 6 skenario browser, build/scanner, benchmark, backup/restore, serta startup manual cold/warm/crash dan cache lama pada lingkungan terisolasi. Excel dan cache operasional tidak berubah; port 3080 dibiarkan bebas. Gerbang review auth akhir masih terpisah dari hasil pipeline ini; rincian berada di `docs/AUDIT-20261120.md`.

## Status konfigurasi terakhir (13 November 2026)

**Dashboard lokal telah diverifikasi memakai Google Sheets nyata dan Supabase Auth nyata.** Akun admin pertama telah dibuat melalui jalur admin tepercaya; password hanya tersimpan di `D:\sidaksa\.private\credentials\LOGIN-SIDAKSA-ADMIN.txt`, tidak di dokumen atau frontend.

Pembacaan segar, cache, API berizin dan browser direkonsiliasi: 416 kandidat, 626 lamaran, 21 agen, 78 baris company (77 ID berbeda). Empat tab utama aktif; dua tab referensi belum disetujui/diaktifkan. Login, ekspor agregat, detail, refresh manual, mobile dan logout nyata berhasil. Ini verifikasi lokal, bukan deployment internet atau UAT pemilik. Review kode independen final lulus; dua blocker lama telah ditutup dan tidak ada temuan keamanan/logika pada cakupan yang diperiksa. Lihat `docs/VERIFICATION.md`.

## Menghubungkan layanan

Edit `.env` secara lokal. Jangan menempel password, secret key, atau private key di chat.

```dotenv
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
GOOGLE_SPREADSHEET_ID=1TrkKzadHZyMmc0ZfMe8CUic66s5-96XZ4vdBpsEuEes
GOOGLE_APPLICATION_CREDENTIALS=
```

- Isi URL project dan **publishable key** Supabase. Jangan menggunakan secret/service key sebagai key browser.
- Siapkan akun pengguna di Supabase Auth. Aplikasi tidak menyediakan pendaftaran publik.
- Akun diizinkan hanya bila `app_metadata.sidaksa_approved` adalah boolean `true` dan `app_metadata.sidaksa_role` salah satu `admin`, `recruiter`, `leader`. Metadata ini harus diatur oleh admin tepercaya melalui Admin API, bukan `user_metadata` yang dapat diubah pengguna.
- Default login email/password. Aktifkan Google OAuth hanya setelah provider dan redirect URL di Supabase benar; ubah `AUTH_GOOGLE_ENABLED=true` jika digunakan. URL redirect harus mengikuti origin aplikasi yang benar, bukan port yang ditebak.
- Beri email service account akses **Viewer** pada file sumber dan aktifkan Google Sheets API pada project Google. Isi **lokasi file kredensial** di server, bukan isi JSON pada frontend. Alternatif ADC memerlukan konfigurasi kredensial yang sesuai.
- Restart server setelah perubahan environment. Periksa `npm run config:check`; output tidak boleh berisi rahasia.
- Jalankan pemeriksaan login, otorisasi, sumber, API, browser, dan jadwal refresh secara terpisah. Jangan menganggap satu pembacaan file sebagai koneksi website.

Jika menggunakan email undangan/reset password untuk produksi, siapkan custom SMTP yang sesuai. Penyedia/anggaran belum dipilih.

## Login di Vercel

Build Vercel menayangkan `dist/client` dan menjalankan dua fungsi autentikasi dari `api/`: `GET /api/public-config` membaca konfigurasi Supabase dari environment runtime, dan `GET /api/me` memverifikasi token serta persetujuan akun di Supabase Auth. Rewrite halaman React tidak meneruskan jalur API ke `index.html`.

- Deploy ulang dari **commit yang memuat perubahan**, dengan `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` pada environment deployment yang diuji. Tidak perlu menyalin `.env` ke Git.
- Cek bahwa `/api/public-config` mengembalikan JSON `200` dengan `authConfigured: true`, dan `/api/me` tanpa token mengembalikan JSON `401`. Setelah itu, uji masuk memakai akun yang telah disetujui, tanpa menyalin token atau kata sandi ke laporan.
- Fungsi ini menangani **login saja**. API Google Sheets, snapshot, sinkronisasi, mapping, dan audit tetap membutuhkan backend Express dengan penyimpanan privat yang persisten. Jangan memindahkan penyimpanan operasional ke `/tmp` Vercel.

## Sumber dan ketepatan data

Empat tab wajib:

- `Data Kandidat`
- `Data Mitra Agent`
- `Data Company`
- `Proses Rekrutment`

Dua tab pembanding (`Crew List Departure`, `Funnel Rekap`) tidak diaktifkan otomatis. Admin dapat menyetujuinya secara eksplisit melalui konfigurasi/pengaturan. Data referensi yang belum dibaca bukan angka nol.

- Satu kandidat dapat mempunyai banyak lamaran.
- Status kosong tidak disamakan dengan In Progress.
- Lolos seleksi akhir dan Completed bukan bukti sudah bekerja atau berangkat.
- Nama/ID tidak diperbaiki dengan pencocokan samar atau menambah/menghapus angka nol.
- Tanggal bulan-tahun tetap berpresisi bulan; tidak dibuat menjadi tanggal 1 untuk menghitung durasi.
- Snapshot terakhir yang berhasil dipertahankan saat sumber gagal, dengan indikator kegagalan/kedaluwarsa.
- File Excel tidak pernah menjadi fallback aplikasi normal.

## Pengujian

```bash
npm run verify
npm audit
# Atau jalankan sebagian setelah build:
npm run test:e2e
npm run test:performance
npm run test:smoke
npm run test:recovery
```

`npm run verify` menjalankan typecheck, seluruh tes, build, scan bundle, browser, uji beban, dan smoke test hasil build. `npm run test:e2e` memerlukan hasil build, lalu menyalakan dua server sementara sendiri pada port 4180 dan 4181; tidak memerlukan server operasional 3080. Tes menolak port yang sudah dipakai, tidak menggunakan kredensial live, dan menutup server setelah selesai. QA browser memakai Chrome yang terpasang; Python diperlukan untuk alat fixture dan tes tools, bukan untuk runtime dashboard.

Untuk fixture nyata yang diberikan pemilik, jalankan secara eksplisit:

```bash
python tools/read_workbook.py "C:/Users/Acer/Downloads/Data Akses Kerja & Alumni.xlsx" --output .private/fixtures/source.json
npm run test:fixture
```

Output mengandung data pengguna: tetap di folder `.private`, tidak di-upload atau di-commit. Converter memakai nilai cache formula, tidak menghitung ulang, tidak mengeksekusi formula, tidak mengubah workbook asli.

## Keamanan dan operasional

- Server hanya melayani bundle `dist/client`, bukan seluruh folder proyek.
- `.env`, kredensial, fixture, snapshot, dan file audit tidak boleh ada di `web`, `public`, atau bundle frontend.
- API memverifikasi token Supabase dan izin pada server. Pimpinan tidak menerima kontak/foto/catatan sensitif pada payload.
- Jangan memublikasikan server lokal dengan port forwarding sebelum konfigurasi produksi, HTTPS, kontrol akun, retensi, backup, dan audit disetujui.
- Folder `.private` pada mesin ini diset ACL Windows untuk pengguna saat ini dan SYSTEM. Periksa ulang ACL jika memindahkan folder atau mengganti akun/service yang menjalankan server.
- Default retensi 30 hari adalah default teknis; kebijakan organisasi harus disepakati. Retensi audit/backup tidak boleh diasumsikan tanpa batas.
- Backup/restore dijalankan melalui CLI dengan path dan target yang eksplisit; uji pemulihan hanya pada penyimpanan terisolasi sebelum dipakai pada data operasional.

## Batas MVP

P1 histori perpindahan tahap/time-in-stage dan P2 input/edit data operasional belum termasuk. Tidak ada AI matching, portal eksternal, WhatsApp otomatis, penggajian, atau klaim employment rate seluruh alumni.

## Dokumen

- `docs/PRD.md` — PRD yang diberikan pemilik, dipertahankan.
- `docs/IMPLEMENTATION.md` — keputusan teknis dan asumsi.
- `docs/API.md` — kontrak API internal.
- `docs/VERIFICATION.md` — hasil eksekusi, bukti, dan penghambat live.
- `docs/ACCEPTANCE.md` — matriks AC-01 sampai AC-19, terpisah antara lokal, live, dan UAT.
- `docs/SETUP.md` — pengisian konfigurasi dan checklist sebelum produksi.
- `docs/STARTUP.md` — startup manual, pemulihan lock dan kompatibilitas cache.
- `docs/AUDIT-20261120.md` — bukti perbaikan terbaru dan batas penerimaannya.
