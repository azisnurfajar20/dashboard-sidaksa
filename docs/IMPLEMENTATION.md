# SIDAKSA — keputusan implementasi

- Lokasi permintaan `D:sidaksa` ditafsirkan sebagai folder root `D:\sidaksa` pada Local Disk D, sesuai konteks pengguna.
- MVP baca-saja sesuai PRD yang dilampirkan. Google Sheets merupakan sumber produksi; Excel hanya fixture privat pengujian.
- UI: React, TypeScript, Bootstrap 5.3.8 dengan palet persis #06509B, #FF9001, #FFFFFF. Permukaan utama: monitoring operasional, bukan landing page pemasaran.
- Backend: Node.js 22.12+, Express, pembaca Google Sheets berizin baca, snapshot file privat atomik. Supabase hanya diputuskan untuk Auth, tidak otomatis menjadi database rekrutmen.
- Tidak ada kredensial yang dibuat-buat, akun demo, fallback fixture di aplikasi normal, atau perubahan data Google Sheets.
- Sesi diverifikasi server melalui Supabase Auth; approval/role hanya dari app_metadata yang dikelola admin.
- Empat tab utama diwajibkan. Dua tab rekap hanya dibaca ketika diaktifkan secara eksplisit. Ketidaktersediaannya bukan angka nol.
- Default login email/password; Google OAuth tersedia bila dikonfigurasi. Tidak ada pendaftaran publik dalam UI. Keputusan ini dapat diganti lewat konfigurasi, bukan migrasi data.
- Interval 15 menit dan retensi snapshot 30 hari adalah default teknis, belum kebijakan final organisasi; harus ditinjau sebelum produksi.
- Implementasi P1/P2 seperti histori perpindahan tahap dan input/edit operasional tidak termasuk MVP.
- Pembacaan API menggunakan satu proyeksi snapshot privat per revision store. Revision hanya berubah setelah commit atomik; perubahan mapping, review, preferensi, publikasi, dan restore menginvalidasi cache. Autentikasi/izin dan proyeksi kolom tetap diperiksa pada setiap request, bukan di-cache sebagai respons HTTP.
- E2E menggunakan identitas dan sumber sintetis melalui dependency injection yang hanya ada di kode pengujian. Tidak ada flag HTTP/environment untuk login demo atau mengaktifkan fixture pada aplikasi normal.
- `npm run verify` menguji build, izin, fixture D1, browser Chrome, beban 10.000 lamaran/20 pengguna simulasi, serta startup/backup/pemulihan hasil build. Koneksi vendor live dan UAT pemilik tetap gate terpisah.
