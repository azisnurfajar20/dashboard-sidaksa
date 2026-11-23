# Perbaikan autentikasi Google — 21 November 2026

## Cakupan

Warning yang dilaporkan: `The keyFilename option is deprecated. Please use the auth object constructor instead.`

`server/google.ts` sebelumnya meneruskan `keyFile` ke `GoogleAuth`. Pada SDK terpasang `google-auth-library` 11.3.3, opsi tersebut merupakan alias `keyFilename` dan constructor mengeluarkan warning yang sama.

Perubahan produksi dibatasi pada `server/google.ts` dan helper baru `server/google-auth.ts`:

- Baca file service account lokal secara terbatas, maksimum 64 KiB; handle selalu ditutup.
- Terima hanya tipe `service_account`, email yang valid dan private key RSA minimal 2048 bit.
- Buat `JWT({ email, key, scopes })` secara eksplisit, lalu `GoogleAuth({ authClient })`; tidak memakai opsi generik deprecated `keyFile`, `keyFilename` atau `credentials`.
- Tidak meneruskan `token_uri`, `credential_source`, `universe_domain` atau pemilih provider dari JSON.
- Scope tetap `spreadsheets.readonly`. ADC eksplisit tanpa file dan injected transport tetap didukung.
- Inisialisasi lazy; kegagalan baca lokal tidak dicache selamanya. Pesan API tetap generik tanpa kredensial atau isi upstream.
- Tidak mengubah `.env`, isi/filename kredensial, akun, source Excel/Sheets, mapping atau cache operasional.

Dokumentasi resmi yang benar-benar dibaca melalui browser: URL pada warning diarahkan ke `https://docs.cloud.google.com/docs/authentication/client-libraries#external-credentials`. Bagian validasi service-account keys menyarankan loader khusus tipe tersebut dan menolak tipe lain. Perilaku versi SDK lokal juga diperiksa pada `node_modules/google-auth-library/build/src/auth/googleauth.js` dan deklarasi tipenya; keputusan API tidak bergantung pada contoh library lain.

## Bukti saat ini

- RED: 16 tes, 12 gagal/4 lulus; test SDK nyata menangkap warning sebelum patch. `.private/evidence/google-auth-red-20261121.json`.
- GREEN: seluruh 16 tes terfokus lulus; pemeriksaan TypeScript proyek lulus. `.private/evidence/google-auth-green-20261121.json`.
- Live produksi read-only: loader baru membaca empat tab Google Sheets, tanpa membuat store/server atau menyimpan raw workbook; warningCount=0 dan credentialFileUnchanged=true. `.private/evidence/google-auth-live-20261121.json`.
- Build frontend/backend berhasil; security scan findingCount=0; 6 skenario browser lulus; compiled smoke/private boundaries dan CLI backup/restore lulus.
- Exact `npm run start` terisolasi lulus cold/warm/forced-exit. Manual legacy startup sempat gagal, kemudian rerun terpisah lulus; bukan bukti semua percobaan stabil.
- Pipeline penuh pertama belum lulus: 318/320 tes lulus, dua kasus runtime lock menolak acquisition. Recheck 31 tes lock menghasilkan 30 lulus/1 gagal pada kasus berbeda. Source `runtime-lock.ts` tetap SHA-256 `e802a421d60a53a3c0600fed4760d2a3f071826f71714d48fb4df316d4fe37cd`.
- Probe terisolasi langsung pada runtime lock lulus 5/5; dependency graph hanya memuat `server/auth.ts` dan `server/runtime-lock.ts`, bukan modul Google yang diubah. Penyebab rinci kegagalan lock intermittent belum dipastikan dan tidak diam-diam diperbaiki dengan melemahkan guard. `.private/evidence/google-auth-native-diag-20261121.json`.
- Review independen perubahan Google **PASS**: 16/16 tes yang dipelihara dan 6/6 probe tambahan lulus, tanpa blocker keamanan/logika. Parent membaca laporan lengkap dan mencocokkan SHA-256 enam file scope dengan source aktif. Bukti: `.private/evidence/google-auth-final-review-20261121.json`.
- Saran nonblocking: jadikan probe concurrent init/retry, unknown credential type, file-growth/partial-read dan handle-close sebagai regresi permanen.
- Pengulangan pipeline penuh telah selesai **exit 1**: **304/320 tes lulus, 16 gagal; 44/48 file lulus**, disertai satu suite yang gagal pada hook penutupan browser. Kegagalan tersebar pada runtime-lock publication/recovery dan HTTP startup/restore; sebagian stack menunjuk callback error pemeriksaan identitas native PowerShell di `server/runtime-lock.ts:65`. Penyebab error native rinci belum dipastikan. Ini **bukan PASS** dan belum dituntaskan dalam perbaikan warning Google. Log lengkap: `.private/evidence/google-auth-verify-20261121.log` dan `.private/evidence/google-auth-verify-retry-20261121.log`.
- Proses test runner pengulangan telah keluar; asisten tidak menghentikan/restart server operasional pemilik. Source enam file scope review tetap cocok SHA-256; build backend hasil perbaikan berukuran 105141 byte, SHA-256 `6c24386541a672109e4a979524a6bebfbf51a8543f715091baafd36709758348`. Aktivasi backend baru tetap dilakukan oleh pemilik melalui restart normal di bawah.

## Aktivasi oleh pemilik

Build baru tersedia di `dist/server/index.js`. Proses operasional yang sudah hidup tidak memuat ulang kode backend secara otomatis. Asisten tidak menghentikan atau menyalakannya kembali.

1. Pada terminal yang menjalankan SIDAKSA, tekan **Ctrl+C** dan tunggu shutdown normal.
2. Jalankan sendiri:

```powershell
cd D:\sidaksa
npm run start
```

Jangan hanya menjalankan `npm run start` dari terminal kedua saat server lama masih hidup: mekanisme duplicate-start akan memakai instansi lama, bukan memuat build baru. Tidak perlu membuat akun, mengunduh key baru, menghapus cache/lock, atau mengubah Excel/Sheets untuk perbaikan warning ini.
