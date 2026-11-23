# Verifikasi SIDAKSA

## Verifikasi perbaikan — 20 November 2026

`npm run verify` selesai exit0 pada source stabil: **307 tes / 47 file**, 6 tes tools, 6 skenario browser, build/scan bundle, benchmark, compiled smoke/backup-restore dan startup manual cold/warm/crash/cache legacy. Hash Excel asli dan cache operasional tidak berubah; port 3080 kosong pada awal/akhir tes. Asisten tidak menyalakan server operasional. Bukti `.private/evidence/verify-final-20261120.{json,log}`.

Review independen runtime dan cache sudah PASS; review auth generation akhir merupakan gerbang terpisah. Lihat `docs/AUDIT-20261120.md` dan `docs/STARTUP.md` untuk status terkini. Pemeriksaan Google/Supabase di bawah bersifat historis, bukan verifikasi live ulang hari ini.

## Addendum startup — 14 November 2026

Perbaikan startup telah dibuild dan dipasang pada server normal. `npm start` berulang sekarang exit0 hanya setelah identitas instansi cocok dengan lock privat; tidak membuat penulis kedua. Port asing dan lock tidak terverifikasi tetap fail-closed. Lock lama PID1820 dibersihkan manual hanya setelah proses benar-benar tidak ada, port kosong dan state hash tetap sama; bukan penghapusan lock aktif. Lihat `docs/STARTUP.md`.

Pipeline terbaru **131 tes / 36 file +6tools +6Chrome** lulus, termasuk compiled fresh/duplicate CLI smoke; log `.private/evidence/verify-startup-fix-green.log`. Pengujian normal `npm start` exit0 dan Google/Supabase/API live lulus ulang. Satu race pada assertion tes Mitra diperbaiki dengan menunggu tabel, tanpa mengubah source UI. Laporan review core di bawah bersifat historis; review startup terpisah **PASS**, laporan lengkap `.private/evidence/startup-code-review.json` telah dibaca dengan security_concerns dan logic_errors kosong. Saran non-blocking serta batas metadata publik dicatat pada `docs/STARTUP.md`.

## Baseline integrasi sebelumnya

**Pembaruan: 13 November 2026, WIB.** Dashboard lokal telah benar-benar digunakan dengan Google Sheets dan Supabase Auth nyata. Ini bukan verifikasi deployment internet atau UAT pemilik. Review kode independen final **PASS** setelah laporan lengkap dibaca; tidak ada temuan keamanan atau logika dalam cakupan yang diperiksa. Laporan di `.private/evidence/final-live-code-review.json`.

## Hasil eksekusi

Log pipeline: `.private/evidence/verify-live-setup-20261113-100307.log` — `npm run verify`, **exit 0**.

| Pemeriksaan | Hasil | Scope |
|---|---|---|
| TypeScript | Lulus | Source dan tests |
| Unit/integration/regresi | **125 tes / 35 file lulus** | Termasuk D1 privat, isolasi mapping, snapshot dan transport Google |
| Tools | **6 lulus** | Converter, scanner, Windows path, deny Vite dan launch Chrome |
| Build | Frontend + backend lulus | `dist/client`, `dist/server` |
| Scan bundle | **4 file / 0 temuan** | Pola rahasia; bukan audit menyeluruh |
| Dependency audit | **0 vulnerability dilaporkan** | `npm audit --json` pada 13 November 2026; bukan jaminan bebas cacat |
| Browser sintetis | **6 skenario Chrome lulus** | Tidak memakai kredensial live, SIDAKSA HTTP nyata |
| Benchmark | **p95 388,47 ms** | 10.000 lamaran sintetis, 20 identitas HTTP, 60 request, bound snapshotId |
| Compiled smoke | Lulus | Factory dan direct CLI entry, SPA, private boundaries, backup/restore terisolasi |
| Google live | Lulus | Service account, scope baca-saja, loader produksi dan normalisasi |
| Supabase live | Lulus | Pembuatan satu admin, read-back target, password login, getUser dan /api/me |
| API/browser live | Lulus | Login, source parity, refresh manual, detail, CSV, mobile dan logout |

Benchmark berjalan di Windows / Intel N100 / Node v22.12.0. Tidak mengukur latensi vendor live, WAN, TLS/reverse proxy atau kapasitas hosting organisasi. Baseline tanpa cache sebelumnya p95 27.502,32 ms; hasil baru memakai precondition snapshot seperti jalur UI.

## Sumber operasional nyata

Pada pembacaan segar dan verifikasi API/browser:

- **416 kandidat**.
- **626 lamaran**.
- **21 agen**.
- **78 baris company / 77 ID berbeda / 2 nama kosong**.
- Empat tab aktif: `Data Kandidat`, `Data Mitra Agent`, `Data Company`, `Proses Rekrutment`.
- `Crew List Departure` dan `Funnel Rekap` belum diaktifkan. Nilainya **belum tersedia**, bukan nol.

Sumber Google terbaru dibandingkan dengan raw snapshot privat menggunakan digest yang mengecualikan hanya waktu fetch. Konten, hasil normalisasi, API dan KPI sesuai. Data D1 Excel historis (409 kandidat / 612 lamaran) tetap fixture pengujian terpisah, bukan target jumlah produksi atau fallback.

Masalah sumber tetap ditandai, tidak diperbaiki dengan fuzzy matching. Angka diagnostik bukan jumlah orang berbeda; satu baris bisa memiliki beberapa masalah. Lolos/Completed/crew tetap bukan konfirmasi bekerja atau berangkat.

## Bukti live

- `.private/evidence/google-live-source.json`: pembaca produksi mengakses Google, bukan HTML/CSV publik.
- `.private/evidence/live-dashboard-api.json`: identitas admin diverifikasi backend; Google segar = cache = API; refresh manual memajukan lastSuccessAt; detail terikat snapshot.
- `.private/evidence/live-dashboard-browser.json`: Chrome tanpa route mocking, login nyata, KPI, CSV cocok snapshot, refresh UI, detail, mobile, logout; **0 page error / 0 unexpected API error**.
- `.private/evidence/supabase-admin-provision.json`: akun target dibaca kembali setelah create; role/approval dan password login dibuktikan; sesi uji ditutup.
- Screenshot live desktop/mobile di `.private/evidence/live-overview-{desktop,mobile}.png` telah dibuka dan diperiksa. Tidak menampilkan isi credential.

Password hanya di `D:\sidaksa\.private\credentials\LOGIN-SIDAKSA-ADMIN.txt`; bukan dalam laporan, bundle, atau chat. Service-account key dan secret key setup tetap server-side/privat. Supabase secret setup tidak digunakan frontend maupun runtime login normal.

## Akses dan operasi

- Aplikasi normal berjalan di `http://127.0.0.1:3080` dengan snapshot `google-sheets`, bukan fixture.
- API anonim **401**, token salah **401**.
- Probe marker fiktif `/.private/...`, `/@fs/...` dan `.env` **404**; SPA dan asset kontrol **200**. Tidak menguji boundary dengan mengunduh credential asli.
- ACL file credential diperiksa: current user dan SYSTEM. Server hanya melayani `dist/client`.
- Lock sisa hanya dibersihkan setelah PID lama terbukti telah digunakan proses WebView yang tidak terkait dan tidak ada listener SIDAKSA; proses lain tidak dihentikan, state dipertahankan.
- Scheduler **15 menit** juga telah dieksekusi nyata. Audit `snapshot.publish`, `actorId: scheduler`, `result: ok`, pada **13 November 2026 pukul10.39WIB** cocok dengan snapshot aktif Google; terjadi setelah refresh manual terakhir pukul10.24WIB, tanpa refresh manual lain. Bukti di `.private/evidence/live-scheduler.json`. Ini observasi satu scheduled tick, bukan jaminan uptime jangka panjang.
- Backup operasional pertama berhasil dibuat melalui CLI di `.private/backups/first-live-20261113.json` dengan sumber `google-sheets`; isinya privat dan tidak dilampirkan. Restore live tidak dilakukan, hanya diuji terisolasi.
- Login dan pengujian tidak mengubah isi atau izin berbagi Google Sheet. Keberhasilan read tidak membuktikan persis role Drive yang diberikan; privasi dokumen mengikuti pengaturan pemilik.

## Perbaikan yang diverifikasi

1. SnapshotId tampilan diteruskan ke link, detail, modal dan CSV; perubahan S1→S2 menghasilkan409 dan perlu muat terbaru eksplisit, tanpa auto-download data baru.
2. Mapping lintas mode/spreadsheet ditolak sebelum normalisasi dan kembali di antrean publikasi; keputusan/audit A tidak dibuang atau otomatis disahkan untuk B. Dua belas regresi mencakup reopen, restore dan kembali ke A.
3. Adapter Google mengirim parameter `ranges` berulang secara eksplisit. Bug serializer SDK sempat menghasilkan400 INVALID_ARGUMENT pada panggilan nyata meskipun mock transport lulus. Regresi RED→GREEN dan pembacaan Google produksi setelah fix telah dijalankan.
4. Regresi presisi bulan, ledger baris, koordinat header, skipped interview, atomic publish, metadata CSV, role/redaksi dan private filesystem tetap hijau.

## Batas tersisa

- Review kode independen final lulus pada source yang diperiksa, bukan sertifikasi keamanan menyeluruh. Satu saran non-blocking: perluas tes serialisasi SDK ke tab referensi dan request FORMULA; lihat `docs/REVIEW.md`.
- UAT pemilik/recruiter/pimpinan, role cloud selain admin, token kedaluwarsa/proyek lain, Google OAuth, email undangan/reset/SMTP dan gangguan vendor nyata belum disahkan live.
- Crew/Funnel membutuhkan persetujuan tab eksplisit.
- Hosting internet, HTTPS, kebijakan retensi/backup organisasi dan tanggung jawab privasi belum diputuskan.
- Warning build non-blocking: JS569,07kB (gzip162,86kB), di atas warning Vite500kB; build tetap berhasil.

Tidak ada commit atau deployment publik; tidak ada rahasia atau data baris yang dipublikasikan dalam laporan. Lihat `docs/ACCEPTANCE.md` dan `docs/SETUP.md` untuk pemisahan gate lokal/live/UAT.

