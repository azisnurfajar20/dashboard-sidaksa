# Menyiapkan SIDAKSA untuk koneksi nyata

## Status saat handoff

Pada 13 November 2026, file service account telah divalidasi dan dipasang pada `.env`; pembaca Google Sheets nyata, Supabase Auth nyata, akun admin pertama, API berizin dan browser lokal telah diverifikasi. Panduan di bawah tetap berlaku untuk penyiapan ulang/lingkungan baru. Password akun pertama hanya di file privat `D:\sidaksa\.private\credentials\LOGIN-SIDAKSA-ADMIN.txt`; jangan menyalin ke chat atau repository. Tidak ada akun demo atau fallback Excel. Dua tab referensi tetap belum diaktifkan. UAT pemilik dan hosting/HTTPS internet belum dilakukan.

## 1. Menjalankan aplikasi lokal

1. Buka `D:\sidaksa\start-sidaksa.cmd`. Launcher membangun ulang aplikasi sebelum menjalankan server.
2. Buka alamat yang dicetak, default `http://127.0.0.1:3080`.
3. Tanpa konfigurasi Auth, layar login akan nonaktif dengan penjelasan setup. Ini keadaan yang disengaja, bukan kredensial bawaan yang perlu ditebak.
4. Hentikan server dengan Ctrl+C sebelum mengganti konfigurasi atau melakukan restore.

Mode pengembangan: `start-dev.cmd`. Produksi lokal: `npm run build` lalu `npm start` dari folder proyek. Jangan jalankan dua proses dengan store atau port yang sama.

## 2. Konfigurasi Supabase Auth

Edit `.env` secara lokal, bukan melalui chat:

```dotenv
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
AUTH_GOOGLE_ENABLED=false
```

- Isi URL project dan publishable key project yang benar. Secret/service-role key ditolak sebagai key browser.
- Siapkan akun internal melalui jalur admin tepercaya. Aplikasi tidak menyediakan pendaftaran publik.
- Approval dan peran dibaca backend dari `app_metadata`, bukan `user_metadata` atau field role request.
- Akun harus memiliki metadata aplikasi berikut, yang diatur oleh admin tepercaya melalui Admin API organisasi:

```json
{
  "sidaksa_approved": true,
  "sidaksa_role": "admin"
}
```

Peran yang didukung: `admin`, `recruiter`, `leader`. Berikan hak minimum; gunakan akun pimpinan untuk agregat tanpa kontak. Jangan memasukkan secret key untuk mengatur metadata ke frontend, repository, atau pesan chat.

Login default menggunakan email/password. Jika organisasi memilih Google OAuth, konfigurasi provider dan redirect origin pada Supabase terlebih dahulu, lalu aktifkan `AUTH_GOOGLE_ENABLED=true`. Jangan mengaktifkan flag tanpa konfigurasi provider. Untuk email undangan/reset pada produksi, penyedia dan pengaturan SMTP masih perlu disiapkan organisasi.

## 3. Konfigurasi pembaca Google Sheets privat

Identitas pembaca sumber berbeda dari login pengguna.

1. Siapkan project Google, aktifkan Sheets API, dan sediakan service account/identitas backend berizin baca.
2. Beri email service account akses Viewer pada dokumen yang dimaksud. Jangan mengubah spreadsheet atau foto menjadi publik.
3. Simpan file kredensial hanya di lokasi privat. Contoh lokasi lokal yang sesuai: `D:/sidaksa/.private/credentials/google-service-account.json`. Folder `.private` bukan bagian bundle atau version control.
4. Isi lokasi file tersebut, bukan isi JSON atau private key, pada `.env`:

```dotenv
GOOGLE_SPREADSHEET_ID=1TrkKzadHZyMmc0ZfMe8CUic66s5-96XZ4vdBpsEuEes
GOOGLE_APPLICATION_CREDENTIALS=
GOOGLE_REFERENCE_TABS=[]
```

Empat tab wajib: `Data Kandidat`, `Data Mitra Agent`, `Data Company`, `Proses Rekrutment`. Header wajib divalidasi oleh aplikasi. Dua tab pembanding (`Crew List Departure`, `Funnel Rekap`) hanya dibaca setelah disetujui secara eksplisit melalui konfigurasi/pengaturan admin. Belum tersedia tidak ditampilkan sebagai angka nol.

Jika organisasi menggunakan Application Default Credentials, jalur tersebut harus benar-benar disiapkan pada lingkungan server sebelum `GOOGLE_USE_ADC=true`. Jangan menganggap flag itu menghasilkan kredensial.

## 4. Pemeriksaan setelah konfigurasi

1. Restart server.
2. Jalankan `npm run config:check`. Exit 2 berarti konfigurasi belum lengkap. Exit 0 hanya berarti nilai konfigurasi tersedia; ini bukan bukti layanan live berhasil diakses.
3. Login sebagai akun yang disetujui, lalu verifikasi `/api/me` sesuai peran.
4. Login sebagai admin dan jalankan refresh. Catat snapshot ID, waktu keberhasilan, serta jumlah sumber saat itu.
5. Rekonsiliasikan API dan browser dengan snapshot Google Sheets yang baru. Jangan mengharuskan jumlahnya sama dengan baseline Excel historis.
6. Uji akun pimpinan, URL API langsung, ekspor, token salah/kedaluwarsa/proyek lain, sumber gagal, dan jadwal refresh nyata. Bukti produksi harus terpisah dari pengujian lokal.

## 5. Backup dan pemulihan

Jalankan dari folder proyek; file harus tetap privat:

```bash
npm run data:backup -- .private/backups/sidaksa.json
# Hentikan server sebelum restore:
npm run data:restore -- .private/backups/sidaksa.json
```

Restore memvalidasi backup dan menolak fixture pada jalur normal. Tidak ada flag CLI untuk memulihkan fixture sebagai sumber operasional. Pemulihan cache rusak sudah diuji pada direktori sementara terisolasi, bukan dengan merusak data operasional.

Store memiliki `.runtime.lock` berisi PID proses pemilik. Jika terjadi shutdown abnormal, periksa bahwa proses pemilik benar-benar tidak ada sebelum membersihkan lock sisa. Jangan menghapus `state.json`, backup, atau lock yang masih digunakan proses hidup untuk melewati error.

Retensi default 30 hari adalah default teknis untuk arsip/audit terkait, bukan kebijakan organisasi. Backup manual tidak otomatis dipangkas oleh retensi snapshot; jadwal, lokasi, masa simpan, penghapusan, dan uji restore berkala perlu diputuskan sebelum produksi.

## 6. Gate sebelum produksi

- Konfirmasi daftar pengguna, metode/provisioning akun, role, pencabutan akses, dan audit perubahan akses di lingkungan admin tepercaya.
- Konfirmasi tab/rentang produksi dan keputusan atas konflik identitas/master.
- Tetapkan makna bukti penempatan/keberangkatan; jangan mengganti label catatan menjadi konfirmasi tanpa bukti baru.
- Siapkan hosting, HTTPS, origin/redirect yang benar, kebijakan reverse proxy/rate-limit, pemantauan, retensi, backup, dan tanggung jawab privasi.
- Lakukan UAT pemilik/tim dan uji live terpisah. Kinerja lokal dengan Auth/sumber sintetis tidak menjamin latensi cloud atau jaringan produksi.

## 7. Mengulang verifikasi lokal

`npm run verify` menjalankan seluruh pipeline. Chrome terpasang dan Python diperlukan untuk QA; runtime dashboard menggunakan Node. E2E menyalakan listener terisolasi pada port 4180/4181, menolak reuse server, menggunakan data sintetis berlabel fixture, dan tidak mengisi `.env` normal. Bukti berada di `.private/evidence`; jangan dipublikasikan bersama data pengguna.
