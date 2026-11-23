# PRD: Dashboard Akses Kerja & Alumni

**Versi:** 0.3, Google Sheets, Supabase Auth, palet warna, dan Bootstrap 5 dikonfirmasi pemilik  
**Tanggal riset:** 9 November 2026, WIB  
**Penulis:** Nara  
**Status:** sumber data, penyedia login, palet warna, dan framework UI telah diputuskan pemilik; lingkup fitur lainnya tetap draf. Dokumen ini bukan aplikasi yang sudah dibangun.

## 1. Ringkasan keputusan

Bangun dashboard internal untuk memantau kandidat, lamaran, hasil seleksi, mitra, dan catatan penempatan. Mulai dengan aplikasi **baca-saja**: perubahan data operasional tetap dilakukan di sumber, bukan di dashboard.

**Keputusan pemilik:** data operasional yang ditampilkan berasal dari **Google Sheets** dan login aplikasi menggunakan **Supabase Auth**. File Excel yang sudah diperiksa hanya menjadi baseline analisis dan fixture pengujian, bukan sumber pembaruan produksi. Integrasi Sheets dan Supabase pada aplikasi **belum dikonfigurasi atau diuji** dalam pekerjaan penyusunan PRD ini. Jangan menjadikan spreadsheet publik untuk memudahkan integrasi.

Prioritas pertama adalah ketepatan angka, penelusuran ke baris sumber, dan perlindungan data. Grafik funnel yang menarik tidak berguna bila jumlah orang, jumlah lamaran, dan jumlah catatan keberangkatan tercampur.

### Keputusan yang sudah dikonfirmasi

- Google Sheets adalah sumber utama data operasional dashboard.
- Supabase Auth adalah penyedia autentikasi pengguna aplikasi.
- Pemilihan Supabase Auth tidak otomatis menetapkan Supabase Database sebagai penyimpanan data rekrutmen; penyimpanan cache, snapshot, role, dan audit masih perlu dirancang.
- Keputusan sumber dan login berasal dari arahan langsung pemilik setelah PRD v0.1 (D2), bukan hasil inferensi riset.
- Framework UI yang diwajibkan adalah **Bootstrap 5**.
- Palet warna yang diwajibkan adalah **#06509B**, **#FF9001**, dan **#FFFFFF**. Ketentuan UI ini berasal dari arahan langsung pemilik (D3).

### Asumsi yang belum dikonfirmasi

- Aplikasi digunakan satu organisasi, oleh tim akses kerja/rekrutmen dan pimpinan.
- Bahasa antarmuka Indonesia; waktu pembaruan ditampilkan dalam WIB.
- Kandidat dan agen eksternal tidak mempunyai akun pada MVP.
- MVP tidak mengubah data kandidat, lamaran, atau status di spreadsheet.
- Interval sinkronisasi produksi yang diusulkan adalah 15 menit, bukan kebutuhan yang sudah disepakati.
- Anggaran, penyedia hosting, jumlah pengguna serentak, dan target peluncuran belum ditetapkan.

## 2. Dasar data dan temuan nyata

**D1: sumber internal** adalah `Data Akses Kerja & Alumni.xlsx`, diberikan oleh pemilik dan diperiksa secara lokal pada 9 November 2026. Pemeriksaan membaca struktur OOXML dan nilai hasil rumus yang tersimpan; tidak menghitung ulang rumus dan tidak mengubah workbook.

| Objek | Hasil pemeriksaan D1 | Makna untuk produk |
|---|---|---|
| Kandidat | 409 baris, 409 ID berbeda | Angka master kandidat; belum terbukti merupakan seluruh populasi alumni |
| Mitra agen | 20 baris, 20 ID berbeda | Master mitra, bukan otomatis 20 mitra aktif |
| Company | 78 baris ber-ID, 77 ID berbeda; 2 baris tanpa nama | Jangan menyebut 78 sebagai jumlah perusahaan unik yang tervalidasi |
| Lamaran | 612 baris; 394 token ID kandidat berbeda, termasuk 1 yang tidak ditemukan di master | Satu kandidat dapat memiliki beberapa lamaran; token ID berbeda bukan langsung jumlah orang valid |
| Crew List Departure | 128 entri bernama, 127 nama berbeda | Bukan bukti 128 orang unik sudah berangkat |
| Funnel Rekap | 409 baris ber-ID; 172 status kosong | Rekap turunan belum layak menjadi sumber utama KPI |

### Masalah yang langsung memengaruhi kebutuhan

1. `Status Proses` kosong pada 238 dari 612 lamaran. Nilai kosong harus tampil sebagai "Belum diisi", bukan otomatis "In Progress".
2. Hasil akhir berisi 181 `Lolos`, 88 `Tidak Lolos`, dan 343 kosong. Sebut metriknya "Lolos seleksi akhir"; belum ada bukti bahwa semua itu berarti menerima kontrak atau sudah bekerja.
3. Terdapat 1 referensi kandidat yang tidak ditemukan di master: `Proses Rekrutment!B597` berisi `DKDP_014`. Sistem tidak boleh otomatis mengubah token itu menjadi ID lain.
4. Pada 15 baris lamaran, nama yang tersimpan berbeda dari nama master untuk ID yang sama. Ini memerlukan peninjauan identitas, bukan penggabungan otomatis berdasarkan kemiripan nama.
5. `DCDP_51` muncul di `Data Company!A52` dan `A53`. Pilihan perusahaan yang benar harus diputuskan pemilik data.
6. `Funnel Rekap!B2` menggunakan referensi `A3`, bukan `A2`; pola pergeseran juga terlihat pada B3 dan B4. Ini adalah temuan pemeriksaan rumus, bukan hasil audit ulang seluruh perhitungan.
7. Rumus pada `Crew List Departure!B2` menyimpan QUERY dengan rentang `Proses Rekrutment!$C$2:$Q$456`, sedangkan data lamaran mencapai baris 613. Jangan menganggap rekap itu mencakup seluruh sumber terbaru.
8. Dari 128 entri crew, 119 mempunyai teks tanggal harian yang dapat dibaca, 2 hanya bulan-tahun, dan 7 berisi `Menunggu Jadwal`. Tanggal yang tercatat pun belum membuktikan keberangkatan aktual.
9. Ada 263 nilai atau format tanggal apply yang hanya menyajikan bulan-tahun. Jangan mengarang tanggal harian untuk menghitung durasi.
10. Kolom `Tahun Lulus` pada 49 kandidat berisi label non-tahun seperti kategori akses/program. Pisahkan tahun lulus dari kategori peserta; jangan langsung menandainya sebagai data rusak.
11. Nomor handphone kosong pada 112 kandidat. Kontak kosong merupakan masalah kelengkapan, bukan alasan untuk menghapus kandidat.

**Batas interpretasi:** data ini menunjukkan aktivitas akses kerja yang tercatat. Data belum cukup untuk menyatakan tingkat bekerja seluruh alumni, keberhasilan kausal suatu agen, atau jumlah keberangkatan aktual yang terkonfirmasi.

## 3. Hasil riset pembanding dan keputusan desain

Bagian ini membedakan praktik sumber dari keputusan yang diusulkan untuk proyek.

| Temuan sumber primer | Keputusan untuk proyek ini |
|---|---|
| Greenhouse membedakan laporan cohort berdasarkan kelompok tanggal apply, aktivitas berdasarkan waktu kejadian, dan snapshot pada waktu tertentu.[1] | Pisahkan filter periode apply, periode keberangkatan, dan kondisi terkini. Jangan memakai satu filter tanggal yang berubah makna tanpa label. |
| Workable menjelaskan bahwa funnel-nya memakai posisi saat ini dan mengasumsikan kandidat telah melewati semua tahap sebelumnya, termasuk tahap yang dilewati.[2] | Jangan menyalin asumsi tersebut. Data sumber memuat jalur langsung ke interview user. MVP menampilkan distribusi tahap yang terbukti, bukan mengaku mempunyai riwayat funnel lengkap. |
| Google menyediakan scope baca-saja; scope Sheets berlaku pada tingkat file, bukan batas satu tab.[3] | Batasi akses sumber dan terapkan daftar tab yang boleh dibaca pada aplikasi. Jangan menyebut daftar tab aplikasi sebagai pembatas keamanan OAuth. |
| File tertentu dapat dibagikan langsung kepada email service account dengan tingkat akses yang sesuai; pengaturan IAM saja tidak memberi akses ke file Sheets.[5] | Untuk satu spreadsheet privat, gunakan identitas backend yang hanya diberi akses dokumen yang dibutuhkan. Jangan meminta akses semua Drive bila tidak diperlukan. |
| Sheets API menerapkan kuota dan menyarankan exponential backoff ketika terkena pembatasan.[4] | Sinkronkan melalui backend terjadwal, gunakan cache/snapshot, dan jangan membaca seluruh Sheets untuk setiap kunjungan pengguna. |
| OWASP menganjurkan hak minimum, akses ditolak secara default, dan pemeriksaan izin pada setiap request di sisi server.[6] | Terapkan izin untuk halaman, API, ekspor, dan kolom kontak. Menyembunyikan tombol atau kolom di browser tidak cukup. |

Ini riset pola produk, bukan evaluasi pembelian Greenhouse atau Workable. Tidak ada klaim bahwa proyek harus membeli atau meniru seluruh fitur keduanya.

## 4. Masalah, tujuan, dan indikator keberhasilan

### Pertanyaan yang harus dijawab

- Berapa kandidat yang ada, dan berapa lamaran yang diproses?
- Lamaran mana yang perlu diperiksa atau ditindaklanjuti?
- Bagaimana komposisi hasil seleksi menurut agen, company, negara, posisi, dan basis kerja?
- Catatan bergabung/keberangkatan apa yang tersedia, dan mana yang masih menunggu jadwal atau konfirmasi?
- Seberapa lengkap dan dapat dipercaya angka yang sedang dilihat?

### Target produk yang diusulkan

- Pada UAT, pimpinan dapat menjawab pertanyaan ringkasan tanpa membuka spreadsheet.
- Setiap angka dapat ditelusuri ke definisi, filter, snapshot, dan baris sumber.
- Seluruh baris masukan diperhitungkan sebagai valid, perlu ditinjau, atau ditolak; tidak ada penghapusan diam-diam.
- Tim dapat menyiapkan ekspor laporan agregat dari filter yang sama dengan tampilan.
- Waktu pembuatan laporan manual diukur sebelum dan setelah peluncuran. Target penghematan belum ditetapkan karena baseline belum ada.

## 5. Pengguna dan izin

| Peran usulan | Hak MVP | Pembatasan |
|---|---|---|
| Admin data | Refresh, melihat masalah data, menyetujui mapping yang eksplisit, mengatur sumber dan akun melalui jalur admin yang berizin | Tidak mengubah spreadsheet atau data operasional dari dashboard |
| Tim rekrutmen | Membaca kandidat dan riwayat lamaran; melihat kontak sesuai izin; mengekspor data yang diizinkan | Tidak mengelola kredensial atau akun |
| Pimpinan | Melihat agregat, rincian non-kontak, dan ekspor agregat | Kontak, foto, dan catatan sensitif tidak disertakan secara default |

Sumber belum memiliki PIC/penugasan yang konsisten. Jangan menjanjikan pembatasan "hanya kandidat milik recruiter tersebut" sebelum hubungan penugasannya tersedia. Akses eksternal per agen memerlukan rancangan izin terpisah dan bukan MVP.

## 6. Lingkup MVP dan kebutuhan fungsional

P0 berarti harus ada pada rilis MVP yang disepakati. **Pembacaan Google Sheets, login Supabase Auth, Bootstrap 5, serta palet #06509B, #FF9001, dan #FFFFFF adalah P0 yang telah dikonfirmasi.** UAT fixture Excel dapat dilakukan selama pengembangan, tetapi tidak memenuhi syarat integrasi produksi.

| ID | Prioritas | Kebutuhan |
|---|---|---|
| FR-01 | P0 | Login/logout menggunakan Supabase Auth, validasi token pada backend, akun yang diizinkan, serta otorisasi peran untuk data detail dan ekspor |
| FR-02 | P0 | Membaca tab/rentang Google Sheets yang disetujui, memvalidasi schema, menyimpan snapshot dan hasil normalisasi dengan jejak sumber; Excel D1 hanya fixture pengujian |
| FR-03 | P0 | Overview dengan kartu KPI yang memiliki definisi, unit, cakupan periode, status validasi, serta tautan rincian |
| FR-04 | P0 | Tabel lamaran yang dapat dicari, difilter, diurutkan, dan dibuka detailnya |
| FR-05 | P0 | Direktori kandidat dan daftar seluruh lamaran terkait; satu orang boleh memiliki lebih dari satu lamaran |
| FR-06 | P0 | Analitik agen/company dengan jumlah lamaran, hasil seleksi, dan kelengkapan data; menampilkan kelompok tidak terpetakan |
| FR-07 | P0 | Daftar catatan crew/bergabung yang membedakan tanggal harian, bulan saja, menunggu jadwal, dan belum terkonfirmasi |
| FR-08 | P0 | Pusat kualitas data: ID tidak ditemukan, identitas tidak konsisten, ID berulang, status kosong, tanggal ambigu, dan rumus/rekap yang perlu diperiksa |
| FR-09 | P0 | Ekspor CSV sesuai filter dan izin, disertai waktu snapshot dan definisi unit; kontak tidak ikut secara default |
| FR-10 | P0 | Sinkronisasi Google Sheets privat satu arah, status keberhasilan/kegagalan, refresh manual admin, dan pemulihan ke snapshot Google Sheets terakhir yang berhasil |
| FR-11 | P1 | Riwayat kejadian tahap, metrik waktu proses, dan pengingat dengan PIC serta tanggal tindak lanjut yang valid |
| FR-12 | P2 | Input/edit operasional dari aplikasi setelah sumber utama dan aturan konflik diputuskan |
| FR-13 | P0 | UI menggunakan Bootstrap 5 dan palet brand #06509B, #FF9001, #FFFFFF secara konsisten pada login dan seluruh dashboard |

### Tidak termasuk MVP

- Portal kandidat/alumni, portal agen, job marketplace, dan aplikasi mobile native.
- Pengiriman WhatsApp/email otomatis atau penjadwalan interview otomatis.
- Penyimpanan paspor, visa, medical check-up, atau berkas tambahan yang belum diminta.
- AI matching, penilaian otomatis kandidat, dan prediksi peluang lolos.
- Penggajian, pembayaran, komisi, kontrak kerja, dan multi-organisasi.
- Sinkronisasi dua arah atau penggantian Google Sheets sebagai tempat input.
- Klaim employment rate seluruh alumni, time-to-hire lengkap, atau histori tahap masa lalu yang tidak tercatat.

## 7. Susunan halaman dan alur utama

### 7.1 Overview

- Baris atas: sumber aktif, waktu snapshot, filter konteks, dan peringatan kualitas data.
- Kartu: master kandidat, lamaran, lolos seleksi akhir, status eksplisit In Progress, status belum diisi, dan catatan crew.
- Grafik: lamaran per bulan apply, distribusi status/hasil, komposisi basis kerja, dan mitra menurut volume serta hasil yang tercatat.
- Semua angka dapat diklik untuk membuka tabel dengan filter yang sesuai.
- Kartu master kandidat diberi label "seluruh master"; jangan ikut periode apply seolah-olah tersedia tanggal pendaftaran kandidat.

### 7.2 Rekrutmen

- Satu baris per lamaran dalam satu snapshot.
- Filter: periode apply, agen, company, negara, basis kerja, posisi, hasil interview, hasil akhir, status proses, dan tanda masalah data.
- Detail menampilkan bukti milestone yang tersedia dan catatan, bukan timeline perubahan status yang dibuat-buat.
- Daftar tindak lanjut hanya memakai bukti yang tersedia. "Hari sejak apply" tidak boleh diberi nama "lama berada di tahap ini".

### 7.3 Kandidat

- Pencarian ID/nama, tahun lulus yang tervalidasi, kategori peserta, sekolah, serta daerah.
- Profil menampilkan semua lamaran terkait dan masalah identitas yang belum diselesaikan.
- Kontak ditampilkan hanya kepada pengguna yang berizin; profil tidak dimuat sebagai halaman publik.

### 7.4 Mitra dan company

- Jumlah baris sumber dan jumlah master yang tervalidasi dibedakan.
- Relasi harus melalui ID/mapping yang disetujui. Nama berbeda tidak disatukan otomatis.
- Perbandingan menampilkan jumlah kasus yang belum ada hasilnya; hindari peringkat "agen terbaik" dari sampel kecil atau data belum lengkap.

### 7.5 Catatan penempatan/keberangkatan

- Tampilkan keterangan sumber, tanggal yang tercatat, ketelitian tanggal, dan status verifikasi.
- Sediakan kategori menunggu jadwal serta identitas/lamaran yang belum dapat dipadankan.
- Penggabungan crew ke kandidat atau lamaran berdasarkan nama saja tidak boleh dianggap tervalidasi.

### 7.6 Kualitas data

- Ringkasan per jenis masalah, tabel baris terdampak, tingkat dampak, dan koordinat sumber.
- Pengguna berizin dapat menandai hasil tinjauan atau mapping secara eksplisit; perubahan dicatat terpisah dari data asli.
- Area pengaturan admin berisi sumber Google Sheets, riwayat sync, akun Supabase Auth, dan audit aktivitas; bukan menu input data rekrutmen.

### 7.7 Ketentuan UI: palet warna dan Bootstrap 5

**Ketentuan dari pemilik (D3)**

- Gunakan **Bootstrap 5** sebagai framework UI/frontend utama proyek.
- Palet warna brand wajib menggunakan kode **#06509B**, **#FF9001**, dan **#FFFFFF** persis seperti arahan pemilik.
- Ketentuan Bootstrap 5 berlaku untuk tampilan aplikasi; tidak menetapkan framework backend atau memindahkan sumber data dari Google Sheets.

**Penggunaan warna yang diusulkan dalam rancangan**

| Peran visual | Kode warna | Penggunaan yang diusulkan |
|---|---|---|
| Warna utama: biru | `#06509B` | Identitas utama, navigasi/header, judul, tautan, dan tombol utama |
| Warna aksen: oranye | `#FF9001` | Penekanan visual, aksen komponen, indikator pilihan, dan elemen grafik yang diberi label jelas |
| Warna dasar: putih | `#FFFFFF` | Latar utama, permukaan kartu/form/tabel, serta teks di atas latar biru |

Paletnya adalah keputusan pemilik; penempatan per komponen di atas adalah usulan desain yang dapat disesuaikan saat review tampilan.

**Aturan penerapan**

- Terapkan theme Bootstrap secara konsisten melalui style/theme proyek. Jangan memakai warna default Bootstrap sebagai pengganti ketiga warna brand yang sudah ditetapkan.
- Gunakan Bootstrap 5 untuk susunan responsif dan komponen UI yang relevan, seperti navigasi, kartu KPI, tabel, form, tombol, dropdown, dan modal. Komponen tambahan yang diperlukan harus tetap mengikuti theme yang sama.
- Konsistensi berlaku pada halaman login, seluruh halaman dashboard, filter, ekspor/refresh, serta keadaan loading, kosong, dan gagal.
- Utamakan teks biru pada latar putih atau teks putih pada latar biru. Gunakan oranye terutama sebagai aksen; hindari menjadikannya pasangan teks kecil dengan putih karena keterbacaannya lebih rendah.
- Status tidak boleh disampaikan hanya melalui warna: sertakan label, ikon, atau pola yang dapat dibedakan. Tetap sediakan indikator fokus dan penggunaan keyboard.
- Catat versi Bootstrap 5 yang dipakai dalam dependensi proyek. Perubahan ke major version atau framework UI lain memerlukan persetujuan pemilik.

## 8. Kamus KPI dan aturan periode

| KPI | Definisi MVP | Pengecualian/peringatan |
|---|---|---|
| Master kandidat | Jumlah ID kandidat unik dan valid pada master | Bukan jumlah seluruh alumni; belum tersedia tanggal registrasi untuk tren kandidat baru |
| Lamaran | Jumlah baris lamaran yang mempunyai nama kandidat dalam snapshot, termasuk baris yang perlu peninjauan | Identitas bermasalah diberi label; barisnya tidak hilang dari volume lamaran |
| Lolos seleksi akhir | Lamaran dengan hasil akhir eksplisit `Lolos` | Bukan otomatis hired, signed contract, join, atau deployed |
| Proses In Progress | Lamaran dengan status eksplisit `In Progress` | Status kosong tidak ikut dianggap aktif |
| Status belum diisi | Lamaran dengan status proses kosong | Ditampilkan sebagai kategori tersendiri |
| Hasil belum diisi | Lamaran dengan hasil akhir kosong | Bukan otomatis gagal ataupun masih aktif |
| Catatan crew | Jumlah entri bernama pada roster sumber | Bukan jumlah orang unik sudah berangkat |
| Distribusi tahap | Tahap yang dapat ditentukan dari bukti dan aturan mapping yang disetujui | Tahap tidak diketahui tetap Unknown; tahap yang dilewati tidak diasumsikan pernah terjadi |
| Kelengkapan suatu kolom | Baris terisi dibagi baris yang diwajibkan mengisi kolom tersebut | Aturan wajib/opsional harus disetujui; jangan menilai semua field sebagai wajib |

### Aturan denominator dan filter

1. Default analisis lamaran memakai cohort berdasarkan bulan apply. Daftar aktivitas interview dan crew memakai periode kejadian masing-masing dengan label berbeda.[1]
2. Metrik berbasis kandidat memakai ID master, bukan jumlah nama. Identitas yang belum tervalidasi ditampilkan dengan jumlah pengecualian dan tidak dihitung sebagai orang yang sudah dipastikan.
3. Rate kelolosan tidak menjadi kartu utama sebelum definisi disepakati. Bila digunakan, tampilkan numerator, denominator, kelompok periode yang sama, serta jumlah hasil kosong. Jangan membagi jumlah berangkat bulan ini dengan jumlah apply bulan ini dari orang yang berbeda.
4. Nilai bulan-tahun disimpan sebagai presisi bulan. Filter satu bulan/tahun penuh dapat memasukkannya; filter harian atau batas yang memotong bulan tidak memasukkannya dan wajib menampilkan jumlah yang tidak tercakup karena presisi.
5. Metrik durasi hanya boleh memakai pasangan tanggal harian yang valid, urut secara waktu, dan makna kejadian yang telah disepakati. Tampilkan ukuran sampel dan pengecualian. Metrik ini bukan syarat MVP.
6. Historical funnel, conversion antar-tahap, dan time-in-stage menunggu event history. Snapshot baru tidak menciptakan histori sebelum sistem mulai menyimpan data.
7. `Completed` tidak disamakan otomatis dengan `Berangkat`; `Lolos` tidak disamakan otomatis dengan keberangkatan aktual.
8. Penempatan/keberangkatan terkonfirmasi memerlukan definisi bukti dan field aktual yang disahkan pemilik. Sebelum tersedia, tampilkan catatan atau jadwal, bukan KPI konfirmasi.

## 9. Aturan status dan model data

### Pisahkan tiga makna

- **Tahap:** daftar, interview agen, interview user, seleksi akhir, atau Unknown.
- **Hasil:** lolos, tidak lolos, pending, atau belum diketahui pada tahap yang relevan.
- **Kondisi proses:** nilai sumber `In Progress`, `Closed`, `Completed`, atau belum diisi; mapping tambahan memerlukan persetujuan.

Pembatalan, mengundurkan diri, tanpa interview, dan menunggu jadwal dapat muncul di teks. Simpan teks aslinya; hanya gunakan mapping yang eksplisit dan disetujui. Teks non-kosong pada kolom tanggal tidak otomatis membuktikan interview pernah berlangsung.

### Entitas minimum

- `Candidate`: ID sumber, nama, tahun lulus terstruktur jika valid, kategori peserta terpisah, sekolah, daerah, serta kontak dengan akses terbatas.
- `Agent` dan `Company`: ID sumber, atribut master, status, dan hubungan yang sudah tervalidasi.
- `ApplicationSnapshot`: ID internal pada batch, kandidat/agen/company tervalidasi atau unresolved, atribut posisi, tanggal beserta presisi, hasil, status mentah, status turunan, dan referensi baris.
- `CrewReference`: baris roster pembanding; kaitan ke orang/lamaran tetap unresolved sampai ada bukti pengenal yang memadai.
- `ImportBatch`: fingerprint sumber, waktu baca, versi schema/mapping, status, statistik baris, dan snapshot yang dipublikasikan.
- `DataIssue`, `MappingDecision`, serta audit aktivitas: hasil tinjauan yang terpisah dari sumber asli.

Workbook belum menyediakan ID lamaran persisten. MVP mengganti snapshot secara utuh, bukan menambah seluruh baris pada setiap refresh. Identitas internal berbasis batch dan koordinat hanya untuk penelusuran dalam snapshot, bukan ID bisnis lintas pembaruan. ID lamaran persisten harus ditambahkan melalui perubahan schema yang disetujui sebelum mendukung edit, merge lintas batch, atau histori per lamaran yang andal.

## 10. Sumber utama dan sinkronisasi

### Kedudukan setiap tab

| Tab | Kedudukan yang diusulkan |
|---|---|
| Data Kandidat | Master kandidat; menjadi dasar identitas setelah validasi |
| Data Mitra Agent | Master agen; relasi nama perlu mapping eksplisit |
| Data Company | Master company, dengan karantina relasi ambigu akibat ID berulang |
| Proses Rekrutment | Catatan lamaran utama; hasil lookup yang tidak konsisten tetap ditandai |
| Crew List Departure | Referensi pembanding, bukan fakta keberangkatan aktual yang otomatis dipercaya |
| Funnel Rekap | Rekap pembanding untuk rekonsiliasi, bukan sumber final KPI |

Membaca keenam tab untuk audit awal tidak berarti semuanya wajib menjadi sumber produksi. Pemilik perlu menyetujui daftar tab produksi. Jika dua tab turunan dikecualikan, layar pembanding menyatakan tidak tersedia, bukan menampilkan data pengganti.

### Alur data yang ditetapkan untuk rancangan

`Google Sheets privat -> backend pembaca Sheets -> staging dan validasi -> cache/snapshot -> API berizin -> dashboard`

Alur autentikasi terpisah: `Pengguna -> Supabase Auth -> sesi/token -> backend memverifikasi identitas dan izin -> akses API dashboard`.

Login Supabase bukan kredensial Google Sheets. Pembacaan spreadsheet memakai identitas backend tersendiri dengan izin dokumen yang sesuai; pengguna aplikasi tidak perlu diberi akses langsung ke file sumber.[5][10]

- Sumber produksi: Google Sheets privat yang ditetapkan pemilik, dengan Spreadsheet ID `1TrkKzadHZyMmc0ZfMe8CUic66s5-96XZ4vdBpsEuEes`. Tab/rentang produksi masih memerlukan persetujuan.
- Backend menggunakan identitas Google tersendiri, dengan rekomendasi service account berizin Viewer pada dokumen dan scope baca-saja yang sesuai. Kredensial Google tidak dikirim ke browser.[3][5]
- Excel D1 digunakan hanya untuk fixture/prototipe yang diberi label jelas. Kegagalan koneksi produksi tidak boleh mengganti data dengan Excel secara diam-diam.
- Refresh otomatis diusulkan setiap 15 menit; manual refresh hanya untuk admin dan dibatasi agar tidak memicu beban berulang. Cache dan retry terbatas memakai exponential backoff.[4]
- Publikasi snapshot aplikasi dilakukan utuh setelah pemeriksaan; jangan menjanjikan bahwa beberapa pembacaan sumber terpisah adalah transaksi spreadsheet yang atomik.
- Jika sumber gagal, tetap tampilkan snapshot Google Sheets terakhir yang berhasil dengan peringatan kedaluwarsa. Jika belum ada snapshot berhasil, tampilkan keadaan belum tersedia.
- Tab/kolom wajib yang hilang menghentikan publikasi batch. Masalah pada baris tertentu masuk daftar review dan memengaruhi hanya metrik yang bergantung pada kolom tersebut.
- Tidak ada fallback data demo, pengubahan error menjadi nol, pengunduhan foto otomatis, atau penulisan kembali ke sumber.

### 10.1 Login Supabase Auth dan akses Google Sheets

**Pemisahan tanggung jawab**

- Google Sheets menyimpan data operasional kandidat, agen, company, dan lamaran.
- Supabase Auth mengelola identitas/sesi pengguna. Supabase menerbitkan access token JWT untuk sesi pengguna; backend harus memverifikasi token, bukan sekadar membaca payload-nya.[10]
- Backend mengatur siapa yang boleh membaca ringkasan, detail, kontak, ekspor, serta menjalankan refresh. Token valid tidak otomatis memberi hak Admin data.
- Rekomendasi akses sumber: satu identitas backend Google berizin baca. Akses dashboard tidak otomatis memberi akses ke dokumen Google, begitu juga sebaliknya.[5]

**Kebutuhan autentikasi dan otorisasi**

1. Sediakan login dan logout melalui Supabase Auth. Untuk penggunaan internal, usulannya akun berbasis undangan atau persetujuan admin, tanpa pendaftaran publik. Metode login akhirnya belum dipilih.
2. Verifikasi token server-side memakai SDK atau library verifikasi yang sesuai konfigurasi signing key Supabase; periksa validitas, kedaluwarsa, issuer/audience yang diharapkan, dan identitas pengguna. Jangan membangun algoritma kriptografi sendiri.[10]
3. Periksa peran/izin dari sumber yang dikelola server/admin. Jangan mempercayai peran yang dikirim browser atau disimpan pada `user_metadata` yang dapat diubah pengguna; dokumentasi Supabase melarang penggunaan metadata tersebut untuk keputusan otorisasi sensitif.[11]
4. Browser boleh menggunakan publishable key Supabase sesuai fungsinya. Secret key Supabase dan kredensial Google tetap hanya pada lingkungan backend tepercaya; keduanya tidak dibagikan melalui chat, frontend, atau repository.[12]
5. Bila Supabase Database dipilih untuk role, cache, atau audit, desain kebijakan akses/RLS secara eksplisit. RLS database bukan pengganti otorisasi endpoint backend yang membaca Google Sheets.
6. Kebijakan persetujuan akun, perubahan peran, masa berlaku sesi, dan pencabutan akses ditetapkan sebelum produksi. Uji tidak boleh mengasumsikan logout atau perubahan role langsung membatalkan setiap JWT lama tanpa mekanisme yang memang dirancang.
7. Tidak ada login demo, kata sandi statis di frontend, akses anonim ke data rekrutmen, atau bypass login ketika layanan Auth tidak tersedia.

## 11. Keamanan dan privasi

Data sumber memuat nama, nomor kontak, foto, dan catatan. Untuk proyek ini, minimisasi data dan akses internal menjadi persyaratan produk.

- Server menolak akses tanpa izin; API, ekspor, dan file mengikuti aturan yang sama. Data kontak tidak dikirim ke browser pengguna yang tidak berhak, bukan sekadar disembunyikan.[6]
- Kredensial sumber disimpan hanya di backend/secret store, tidak di frontend, repository, file build publik, atau pesan error.
- Gunakan Supabase Auth sebagai penyedia login, HTTPS, pengelolaan sesi yang aman, pembatasan percobaan login, dan kebijakan pencabutan akses. Metode login (misalnya email/password atau Google OAuth), provisioning akun, serta kebijakan sesi masih perlu disetujui.
- Foto dan tautan Drive mengikuti izin sumber. Jangan mengubah izin foto menjadi publik untuk memperbaiki tampilan.
- Validasi file unggahan, ukuran/dekompresi, serta schema; jangan mengeksekusi formula, macro, link, atau teks instruksi dalam workbook. Ekspor teks harus aman saat dibuka sebagai spreadsheet.
- Catat impor, publikasi snapshot, ekspor, perubahan mapping, serta perubahan akses. Hindari menyimpan isi kontak dan catatan sensitif di log.
- Kebijakan retensi file mentah, snapshot, backup, dan penghapusan harus ditetapkan sebelum produksi; jangan menyimpan semuanya tanpa batas.

UU Nomor 27 Tahun 2022 tercantum berstatus berlaku pada portal resmi peraturan.[8] Dasar pemrosesan, hak subjek data, retensi, dan prosedur insiden perlu diperiksa penanggung jawab organisasi sebelum peluncuran. Riset ini hanya memverifikasi metadata peraturan tersebut, bukan audit seluruh pasal, putusan terkait, aturan pelaksana, atau pernyataan kepatuhan hukum.

## 12. Kebutuhan nonfungsional

Berikut target desain, **belum hasil pengujian** dan perlu disesuaikan dengan hosting serta beban yang dipilih:

- Respons API pembacaan ringkasan p95 maksimal 2 detik pada skenario uji 20 pengguna serentak dan 10.000 baris lamaran.
- Halaman utama siap dibaca maksimal 3 detik pada perangkat/jaringan uji yang didokumentasikan, menggunakan snapshot yang sudah tersedia.
- Tabel menggunakan pagination; grafik dan tabel tidak mengunduh seluruh data pribadi bila tidak perlu.
- Antarmuka desktop sebagai prioritas, tetap dapat dibaca pada tablet/ponsel. Grafik tidak mengandalkan warna saja dan tabel dapat diakses dengan keyboard.
- Tersedia loading, tidak ada hasil filter, belum ada data, data bermasalah, dan sumber gagal; keadaan tersebut dibedakan dari angka nol yang valid.
- Backup dan uji pemulihan harus terbukti sebelum produksi; target kehilangan data/waktu pemulihan mengikuti keputusan hosting dan retensi.

Supabase Auth sudah dikunci sebagai penyedia login. **Bootstrap 5** sudah dikunci sebagai framework UI/frontend, bersama palet **#06509B**, **#FF9001**, dan **#FFFFFF**. Pilihan arsitektur rendering frontend, framework backend, database cache/snapshot, serta hosting belum dikunci; Supabase Database tidak otomatis dipilih untuk data rekrutmen. Kebutuhan yang wajib adalah pemrosesan sumber di server, penyimpanan snapshot/jejak asal, otorisasi, serta kemampuan menguji ulang definisi metrik. PRD ini tidak membutuhkan microservices atau sistem streaming.

## 13. Acceptance criteria dan UAT

Semua kriteria di bawah adalah syarat pembangunan mendatang, bukan klaim bahwa aplikasi telah lulus pengujian.

| ID | Skenario | Hasil yang harus terjadi |
|---|---|---|
| AC-01 | Muat fixture D1 tanpa filter selama pengujian | Audit menunjukkan 409 kandidat, 20 agen, 78 baris company ber-ID, 612 lamaran, 128 crew bernama, dan 409 baris rekap. Header/baris penomoran tanpa nama tidak dihitung sebagai entri. |
| AC-02 | Buka master company | Sistem menampilkan ID `DCDP_51` berulang, 77 ID berbeda dan 2 nama kosong; tidak mengklaim 77 sebagai jumlah company unik yang sudah valid. |
| AC-03 | Buka pemeriksaan identitas | `DKDP_014` pada baris 597 tetap dipertahankan dan ditandai tidak ditemukan; 15 ketidaksesuaian nama-ID masuk review. Sistem tidak memperbaiki identitas berdasarkan dugaan. |
| AC-04 | Lihat status dan hasil seluruh lamaran | Kategori status kosong berjumlah 238. Hasil akhir memisahkan 181 Lolos, 88 Tidak Lolos, dan 343 kosong. Jumlah kategori dapat direkonsiliasi dengan 612 lamaran. |
| AC-05 | Buka rekap/funnel | Sistem menandai referensi B2 ke A3 sebagai masalah sumber, tidak memakai rekap tersebut sebagai sumber kebenaran KPI aplikasi. Tidak menciptakan histori tahap. |
| AC-06 | Buka daftar crew | 7 entri Menunggu Jadwal tidak dianggap sudah berangkat; 2 tanggal bulan saja tidak dianggap tanggal harian; 119 tanggal harian tidak otomatis dinyatakan keberangkatan terkonfirmasi. |
| AC-07 | Terapkan filter harian dan bulanan | Nilai berpresisi bulan tidak dibuat menjadi tanggal harian. Jumlah entri yang tidak tercakup ditampilkan pada filter harian/parsial; hasil ekspor sama dengan tampilan. |
| AC-08 | Baca ulang snapshot sumber yang sama dua kali | Pada fixture D1, snapshot aktif tetap berisi 612 lamaran, bukan hasil penambahan ganda. Pengujian Google Sheets memakai jumlah aktual saat pengambilan dan mencatat identitas snapshot. |
| AC-09 | Hapus tab/kolom wajib pada salinan uji | Batch tidak dipublikasikan sebagai data lengkap. Snapshot terakhir yang berhasil tetap tersedia dengan pesan kegagalan yang benar. |
| AC-10 | Akses tanpa login, peran pimpinan, dan URL API langsung | Request tanpa login ditolak; kontak/foto/catatan terlindungi tidak ada dalam payload yang tidak berizin. Uji ekspor dan perubahan ID URL mengikuti aturan yang sama. |
| AC-11 | Ganggu akses sumber Google Sheets produksi | UI memperlihatkan sync gagal dan waktu keberhasilan terakhir, bukan nol atau data demo. Jika belum pernah berhasil, tampilkan sumber belum tersedia. |
| AC-12 | Klik KPI dan ekspor | Filter, jumlah baris, unit hitung, dan snapshot sama pada kartu, tabel rincian, serta ekspor. Kolom sensitif mengikuti izin. |
| AC-13 | Verifikasi integrasi produksi | Bukti terpisah tersedia untuk akses sumber privat, konfigurasi server tersimpan, respons API baru, tampilan browser, dan refresh terjadwal. Keberhasilan baca file lokal tidak memenuhi kriteria ini. |
| AC-14 | UAT pimpinan dan tim | Pengguna dapat menelusuri ringkasan ke baris sumber, membuka riwayat lamaran, menemukan data bermasalah, serta menyiapkan laporan tanpa mengubah data sumber. |
| AC-15 | Login Supabase Auth dan token API | Pengguna yang disetujui dapat login dan mengakses endpoint sesuai peran. Token hilang, tidak valid, kedaluwarsa, atau berasal dari proyek yang tidak sesuai ditolak server tanpa membocorkan data. |
| AC-16 | Eskalasi peran dari browser | Mengganti field role pada request atau user_metadata tidak memberi akses admin, refresh, ekspor, atau kontak yang tidak diizinkan. |
| AC-17 | Sumber produksi setelah login | Data dashboard dapat direkonsiliasi dengan snapshot Google Sheets yang dicatat saat pengambilan, bukan harus sama dengan jumlah historis D1. Login berhasil tidak dianggap bukti sinkronisasi Sheets berhasil. |
| AC-18 | Pemeriksaan frontend dan jalur admin | Frontend tidak mengandung secret key Supabase atau kredensial Google. Operasi admin menggunakan lingkungan server tepercaya dan memerlukan otorisasi; publishable key tidak diperlakukan sebagai rahasia. |
| AC-19 | Review framework UI dan palet warna | Dependensi UI menggunakan Bootstrap 5; theme memuat kode #06509B, #FF9001, dan #FFFFFF; login, navigasi, kartu, tabel, form, tombol, dan keadaan sistem konsisten serta dapat digunakan pada tampilan desktop dan layar kecil. |

## 14. Tahapan pengembangan

1. **Validasi produk dan data:** sepakati pengguna, sumber, istilah hasil/keberangkatan, mapping, dan daftar tab. Selesaikan atau karantina konflik identitas serta ID company.
2. **Fondasi dan prototipe:** siapkan rancangan Supabase Auth, otorisasi backend, pembaca Google Sheets, serta overview/tabel/kualitas data. Fixture D1 digunakan untuk uji transformasi dan rekonsiliasi, bukan sebagai sumber produksi.
3. **Integrasi wajib:** konfigurasi Supabase Auth dan Google Sheets privat setelah akses tersedia; buktikan login, otorisasi API, pembaruan data backend/browser, penanganan gagal, dan scheduler.
4. **Pilot internal:** periksa rekonsiliasi angka, uji akses/ekspor, kinerja, serta backup/pemulihan; ukur waktu pelaporan.
5. **Pengembangan operasional:** hanya setelah MVP dipakai, tentukan event history, ID lamaran persisten, PIC/follow-up, dan kebutuhan input/edit.

Belum ada estimasi tanggal, durasi, atau biaya pembangunan. Estimasi dibuat setelah keputusan lingkup, tim, lingkungan hosting, dan akses sumber dikonfirmasi.

## 15. Keputusan pemilik yang masih diperlukan

| Keputusan | Default rekomendasi | Dampak bila berubah |
|---|---|---|
| Hanya dashboard atau sekaligus input/edit? | Dashboard baca-saja | Input/edit membutuhkan ID lamaran persisten, aturan konflik, audit perubahan, dan sumber utama yang baru |
| Siapa pengguna awal? | Tim internal dan pimpinan | Akses agen/alumni membutuhkan pembatasan objek, proses akun, dan alur privasi tambahan |
| Metode login dan provisioning akun? | Usulan akun internal berbasis undangan, bukan pendaftaran publik; metode login belum dikunci | Supabase Auth sudah dipilih, tetapi pilihan email/password atau Google OAuth dan daftar pengguna memengaruhi alur login |
| Apa bukti berangkat/penempatan? | Belum ditetapkan; tampilkan catatan sumber | Definisi yang salah mengubah KPI keberhasilan |
| Apakah semua kandidat adalah alumni organisasi? | Belum diasumsikan | Menentukan denominator analitik alumni dan kebutuhan registry alumni resmi |
| Seberapa cepat data perlu diperbarui? | Usulan 15 menit | Mempengaruhi biaya operasi, scheduler, dan ekspektasi pengguna |

## 16. Provenans dan batas riset

- D1 diperiksa baca-saja; fingerprint SHA-256: `2c63d692c63e2261b6b42d4833a36fd99aae8473f6b585538204d25396a4853c`.
- Seluruh hitungan di bagian 2 berasal dari D1, bukan contoh data, klaim vendor, atau asumsi pasar.
- Nilai formula adalah cache tersimpan; pemeriksaan rumus bersifat terarah, bukan penghitungan ulang menyeluruh.
- D2 adalah arahan pemilik: sumber data Google Sheets dan login Supabase. Dua keputusan ini dikunci dalam v0.2.
- D3 adalah arahan pemilik: palet #06509B, #FF9001, #FFFFFF serta framework Bootstrap 5. Ketentuan ini dikunci dalam v0.3.
- Belum dilakukan wawancara pengguna, observasi operasional, uji aplikasi, pengukuran kinerja, koneksi Google Sheets privat, atau konfigurasi proyek Supabase.
- Dokumentasi vendor dipakai untuk pola pelaporan dan batas teknis, bukan sebagai bukti bahwa suatu metrik bisnis cocok tanpa validasi pemilik.
- Di luar keputusan Google Sheets dan Supabase Auth dari D2 serta Bootstrap 5 dan palet warna dari D3, definisi, fitur, interval, dan target kinerja tetap usulan Nara yang memerlukan persetujuan produk sebelum menjadi komitmen implementasi.


### Riwayat perubahan

- v0.1: draf awal berdasarkan analisis Excel dan riset pola dashboard.
- v0.2: menetapkan Google Sheets sebagai sumber produksi dan Supabase Auth sebagai login; mengubah integrasi Sheets menjadi P0, memisahkan dua jalur kredensial, serta menambah pengujian token/izin/sumber/secrets. Lingkup baca-saja tetap usulan, bukan persetujuan pemilik yang baru.
- v0.3: menambahkan keputusan pemilik tentang Bootstrap 5 serta palet #06509B, #FF9001, #FFFFFF; menetapkan FR-13, panduan penggunaan warna, dan AC-19. Keputusan Google Sheets dan Supabase Auth tetap berlaku.

## Sources

Sumber primer diakses pada 9 November 2026. D1 adalah workbook unggahan; D2 adalah arahan pemilik tentang Google Sheets dan Supabase Auth; D3 adalah arahan pemilik tentang palet warna dan Bootstrap 5. Nomor sumber v0.1 dipertahankan.

```text
Sources:
[1] https://support.greenhouse.io/hc/en-us/articles/213332286-Comparing-cohort-activity-and-snapshot-reports
[2] https://help.workable.com/hc/en-us/articles/115012920928-Using-the-Hiring-funnel-report
[3] https://developers.google.com/workspace/sheets/api/scopes
[4] https://developers.google.com/workspace/sheets/api/limits
[5] https://developers.google.com/workspace/guides/create-credentials
[6] https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet
[8] https://peraturan.go.id/id/uu-no-27-tahun-2022
[10] https://supabase.com/docs/guides/auth/jwts
[11] https://supabase.com/docs/guides/auth/users
[12] https://supabase.com/docs/guides/getting-started/api-keys
```
