# Menjalankan SIDAKSA di Windows

## Pembaruan Google Auth — 21 November 2026

Warning `keyFilename` diperbaiki melalui objek JWT service-account eksplisit, bukan dengan menyembunyikan log atau mengganti file kredensial. Build baru tersedia. Jika SIDAKSA masih berjalan, tekan **Ctrl+C pada terminal server lama**, tunggu shutdown, lalu jalankan `npm run start` dari `D:\sidaksa`. Start dari terminal kedua saat proses lama masih hidup hanya memakai instansi lama, bukan memuat build baru. Asisten tidak me-restart server operasional.

Scope Sheets tetap baca-saja; Excel, Sheets, `.env`, akun dan isi kredensial tidak diubah. Bukti autentikasi/live read serta batas pengujian penuh dicatat di `docs/GOOGLE-AUTH-20261121.md`; jangan menyamakan lulus tes auth dengan lulus seluruh pipeline.

## Panduan terbaru — 20 November 2026

Pemilik menjalankan server operasional sendiri. Buka PowerShell:

```powershell
cd D:\sidaksa
npm run start
```

Build terbaru sudah dihasilkan. Setelah source diubah lagi, jalankan `npm run build` sebelum `npm run start`. `start-sidaksa.cmd` adalah alternatif build-dan-start yang dibuka sendiri, bukan autostart Windows. Biarkan terminal terbuka; Ctrl+C melakukan shutdown normal. Asisten tidak mempertahankan server operasional di background.

### Lock dan restart

Metadata staging privat disinkronkan sebelum publikasi no-replace. Guard kernel dipegang sepanjang umur penulis, dan restart hanya memulihkan pemilik yang terbukti mati/diganti melalui identitas kelahiran proses. PID hidup saja tidak membuktikan pemiliknya masih sama.

Lock kosong/rusak yang sudah ada dari versi lama, pemilik legacy ambigu, atau identitas tidak terverifikasi tetap ditolak. Jangan menghapus lock sembarang, menghentikan semua Node, atau mematikan layanan Windows berdasarkan PID saja. Kondisi ambigu memerlukan pemeriksaan operator, bukan penghapusan data.

### Cache lama

Versi terbaru mengenali hanya dua representasi legacy yang dapat direproduksi seluruhnya. Revisi tidak dikenal dan perubahan yang tidak dapat dijelaskan tetap fail-closed.

- Load melakukan konversi di memori tanpa menulis file aktif.
- Revisi semantik menghasilkan ID snapshot berbeda. Request lama memerlukan explicit latest; review lama tidak dipindahkan ke issue baru.
- Sebelum penulisan normal pertama, state asli dicadangkan lengkap tanpa menimpa target lain di `.private/data/compatibility/` atau subfolder `compatibility` dataDir terkonfigurasi.
- Sinkronisasi startup dapat melakukan penulisan/cadangan tersebut setelah pemilik menjalankan aplikasi. Excel dan Google Sheets tidak diubah.
- Cadangan mengandung data privat; jangan ditempatkan di folder publik atau diunggah.

`STORE_INVALID` kini menjelaskan masalah integritas/kompatibilitas cache secara aman. Jangan menghapus cache, mapping, review, akun, kredensial atau workbook untuk menghilangkan pesan.

### Bukti terbaru

`npm run verify` exit0: **307 tes/47 file**, 6 tes tools, 6 skenario Chrome, build/scan bundle, benchmark, compiled smoke, backup/restore dan recovery. Perintah Windows persis `npm run start` diuji cold/warm/forced-exit/cache legacy pada store/port terisolasi. Cache asli berhasil dibaca secara read-only; hash Excel dan cache operasional tetap sama. Review independen runtime PASS93 dan cache PASS52; status review auth dicatat terpisah di `docs/AUDIT-20261120.md`.

Bukti: `.private/evidence/verify-final-20261120.json`, `verify-final-20261120.log`, `manual-start-smoke.json`, `manual-legacy-start-smoke.json` dan `cache-readonly-validation-20261120.json`.

SIGKILL bukan uji reboot laptop/listrik mati. Linux, deployment internet, login cloud terbaru dan UAT pemilik tidak diklaim oleh rangkaian ini.

## Catatan historis 14 November — bukan panduan versi terbaru

Dari PowerShell di folder `D:\sidaksa`:

```powershell
npm start
```

Build yang tersedia harus sudah terbaru. Setelah mengubah source, jalankan `npm run build` dahulu. `start-sidaksa.cmd` melakukan build sebelum memulai server.

## Perilaku setelah perbaikan 14 November 2026

- Jika belum ada server dan penyimpanan bebas, SIDAKSA memulai server seperti biasa. Terminal ini menjalankan server; Ctrl+C mematikannya secara normal.
- Jika server **yang sama** sudah aktif, perintah mengembalikan exit0 dengan pesan `SIDAKSA sudah berjalan di http://127.0.0.1:3080`. Tidak membuat penulis kedua, tidak mematikan server lama dan tidak mengubah lock/data. Terminal perintah kedua tidak memiliki kendali shutdown atas server pertama.
- Deteksi bukan sekadar port terbuka: identitas instansi di health endpoint harus cocok dengan metadata lock privat proyek dan PID pemilik harus hidup. `X-Sidaksa-Instance` adalah metadata publik tanpa autentikasi, bukan kredensial login dan bukan bukti mandiri kepemilikan listener OS. Pemeriksaan ini bekerja dalam batas kepercayaan penyimpanan privat; tidak menggantikan Supabase Auth atau pemeriksaan proses saat pemulihan manual.
- Perintah kedua **tidak menerapkan ulang konfigurasi yang diubah**. Konfigurasi baru membutuhkan restart server aktif yang terkontrol.
- Port yang dipakai layanan lain atau lock yang tidak dapat diverifikasi tetap menghasilkan kegagalan dengan penjelasan spesifik, bukan keberhasilan palsu.

## Lock tertinggal setelah shutdown abnormal

Menutup paksa Node/terminal atau proses dihentikan oleh pengelola proses dapat meninggalkan `.private/data/.runtime.lock`. Jangan langsung menghapusnya dan jangan menghentikan semua proses Node.

Periksa PID dalam lock, identitas proses, serta listener pada port aplikasi. Jika proses pemilik benar-benar tidak ada dan tidak ada listener SIDAKSA, operator dapat membersihkan **hanya lock usang tersebut**, setelah mempertahankan backup serta memastikan `state.json` tidak berubah. Jangan menghapus cache, mapping, akun atau file credential untuk mengatasi lock. Lock legacy/tidak terverifikasi tidak dibersihkan otomatis.

## Bukti perbaikan

- Pesan gagal yang sama direproduksi pada proses kedua di build lama.
- Regresi source RED→GREEN; 6 tes startup mencakup fresh start, pemakaian ulang server sama, layanan lain, lock malformed/legacy/mode berbeda, konflik port, dan sanitasi pesan.
- `npm run verify`: **131 tes / 36 file**, 6 tools, 6 skenario Chrome, build/scanner, benchmark dan compiled smoke lulus. Log `.private/evidence/verify-startup-fix-green.log`.
- Compiled-entry smoke benar-benar memulai child Node baru lalu menjalankan child kedua; child kedua exit0, pesan existing-instance benar, lock dan server pertama tetap utuh.
- Pada server normal, perintah **`npm start` benar-benar diuji lagi**: exit0, health200, identitas sama, tidak mengubah lock. Bukti `.private/evidence/startup-live-command.json`.
- Login admin, pembacaan Google segar, cache/API parity, refresh dan private boundaries diperiksa lagi setelah rollout. Bukti `.private/evidence/live-dashboard-api.json`. Tidak ada isi Google Sheet atau credential yang diubah.

Review independen core sebelumnya tetap sebagai bukti scope historis. Review startup terpisah **PASS**; laporan lengkap `.private/evidence/startup-code-review.json` telah diterima dan dibaca: tidak ada temuan keamanan/logika dalam cakupan yang diperiksa. Reviewer menjalankan 6 tes fokus terisolasi; compiled CLI dan layanan live diverifikasi parent secara terpisah. Saran non-blocking yang belum diterapkan: perluas tes penolakan untuk PID mati, lock oversized/symlink, host non-loopback dan respons health tidak valid. Klarifikasi metadata publik sudah ditambahkan di atas. Ini bukan sertifikasi keamanan menyeluruh, UAT manusia atau deployment internet.
