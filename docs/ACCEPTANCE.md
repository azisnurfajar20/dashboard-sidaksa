# Matriks penerimaan SIDAKSA — PRD v0.3

Pembaruan 13 November 2026: pipeline lokal, Google Sheets, Supabase Auth, API/browser dan scheduled refresh nyata telah dijalankan. Matriks membedakan fixture D1 historis dari data Google terbaru dan UAT manusia. Review kode independen final lulus. **Tidak ada klaim seluruh AC produksi/internet telah lulus**; UAT pemilik, role cloud lain dan deployment publik tetap terpisah.

| ID | Bukti yang dijalankan | Status dan batas |
|---|---|---|
| AC-01 | `tests/domain/workbook.test.ts`, `tests/backend/d1-persistence.test.ts`: D1 merekonsiliasi 409 kandidat, 20 agen, 78 baris company, 612 lamaran, 128 crew bernama, 409 rekap | Lulus fixture D1; bukan jumlah Google live |
| AC-02 | D1: 77 token ID company berbeda, 2 nama kosong, `DCDP_51` pada baris 52 dan 53; relasi ambigu tidak dipastikan otomatis | Lulus lokal; master tetap perlu keputusan pemilik |
| AC-03 | D1 mempertahankan `DKDP_014` pada baris 597; 15 ketidaksesuaian identitas terdeteksi; HTTP tidak memadankan kontak pada lamaran tak tervalidasi | Lulus lokal |
| AC-04 | D1: status kosong 238; hasil akhir 181 Lolos, 88 Tidak Lolos, 343 kosong | Lulus lokal; blank/whitespace tidak menjadi In Progress |
| AC-05 | Pemeriksaan formula reference shift dan range; rekap tidak digunakan untuk menghitung KPI | Lulus lokal; formula cache tidak dihitung ulang |
| AC-06 | D1 membedakan 119 tanggal harian, 2 bulan saja, 7 menunggu jadwal; seluruh `confirmed` tetap false | Lulus lokal; tidak membuktikan keberangkatan aktual |
| AC-07 | Regresi format numerik bulan/tahun, metadata format Google, filter hari/bulan; E2E menunjukkan pengecualian presisi dan CSV mengikuti filter | Lulus terisolasi; format dari Google nyata tetap perlu dicek setelah koneksi |
| AC-08 | D1 benar-benar disinkronkan ulang dua kali ke store privat: tetap 612; backup/restore mempertahankan snapshot dan literal ID | Lulus D1 dan refresh Google nyata berulang: tetap626 tanpa penambahan ganda; snapshotId berubah sesuai fetch baru |
| AC-09 | Schema batch yang rusak ditolak; snapshot D1 terakhir dan state aktif tetap tersedia; regresi kegagalan arsip/cleanup/transaksi | Lulus lokal |
| AC-10 | HTTP dan browser: anonim ditolak, pimpinan tanpa kontak/foto/notes/reviewNote, URL detail dan ekspor mengikuti izin; private static paths ditolak | Lulus terisolasi; admin live, anonim401, token salah401 dan private-marker404 juga diuji. Role cloud lain belum diuji |
| AC-11 | Kegagalan loader yang diinjeksi mempertahankan cache, status gagal dan waktu keberhasilan; browser menampilkan last-good warning; sumber awal kosong bukan nol | Lulus simulasi; gangguan akses Google nyata belum diuji |
| AC-12 | Guard snapshotId, link/detail/CSV terikat meta tampilan, stale409 dan muat terbaru eksplisit; regresi Chrome HTTP nyata S1→S2 lulus. Ekspor/detail Google live cocok snapshot | Lulus eksekusi lokal/live yang diuji dan review kode independen final |
| AC-13 | Service account dan loader produksi membaca empat tab nyata; fresh-source/cache/API parity lulus, refresh manual API dan UI memajukan lastSuccessAt | Koneksi, refresh API/UI dan tick scheduler Google nyata lulus; audit snapshot.publish actor scheduler pada13November10.39WIB sesuai snapshot aktif |
| AC-14 | Alur teknis browser untuk telusur sumber, kandidat/lamaran, masalah data, laporan dan admin telah dijalankan | **UAT pimpinan/tim/pemilik belum dilakukan** |
| AC-15 | Akun admin baru dibaca kembali dari Supabase; password login, getUser, /api/me dan UI nyata lulus; token salah401 dan logout diuji | Login admin live lulus; expiry/proyek lain/provider OAuth dan role lain belum disahkan live |
| AC-16 | Unit menolak `user_metadata` sebagai izin; browser sengaja menerima metadata admin palsu untuk leader tetapi `/api/me` tetap membatasi; endpoint admin menolak | Provisioning satu admin live dan read-back app_metadata lulus; spoofing/role lain tetap bukti terisolasi, pencabutan akses cloud belum disahkan |
| AC-17 | assertMappingSource menolak reuse lintas sumber sebelum normalisasi dan di antrean publikasi; 12 regresi sintetis, reopen/restore dan kembali ke A lulus. Source/cache/API nyata cocok | Perbaikan, eksekusi dan review independen final lulus; mismatch/provenance tidak dikenal fail-closed |
| AC-18 | Scan hasil build, guard publishable/secret key, private path HTTP GET/HEAD/encoding, izin admin dan pemisahan file diuji | Lulus pemeriksaan lokal; konfigurasi hosting/secret production belum dinilai |
| AC-19 | Bootstrap 5.3.8 dan tiga warna brand pada source/theme; screenshot nyata desktop/mobile diperiksa, drawer/modal/scroll keyboard dan tabel diuji | Lulus review lokal pada Chrome yang terpasang; UAT perangkat organisasi tetap diperlukan |

## Target nonfungsional

- Uji API overview memakai 10.000 lamaran sintetis, 20 identitas HTTP simulasi bersamaan, 60 request terukur setelah warm-up; target p95 2.000 ms diuji oleh `tools/benchmark.mjs`. Lihat angka aktual terakhir pada `.private/evidence/performance.json`.
- Benchmark tidak mencakup latensi Supabase/Google live, reverse proxy, TLS, atau jaringan WAN. Waktu halaman pada jaringan/perangkat produksi belum disahkan.
- Store privat, backup, pemulihan cache rusak, lock penulis, serta penolakan path publik diuji terhadap file/listener nyata terisolasi.
- Startup hasil build, SPA, asset publik kontrol, API anonim, dan keadaan belum dikonfigurasi dibuktikan dalam `.private/evidence/production-smoke.json`.

## Lingkup yang sengaja tidak dibangun

P1 histori tahap/time-in-stage/PIC-reminder dan P2 input/edit operasional belum termasuk MVP. Tidak ada akun demo, portal kandidat/agen, AI matching, WhatsApp otomatis, penggajian, sinkronisasi dua arah, ataupun klaim employment rate seluruh alumni.
