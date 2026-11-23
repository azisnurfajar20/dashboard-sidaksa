# Kontrak API internal SIDAKSA

Tipe resmi berada di `shared/contracts.ts`. Error berbentuk `{ "error": { "code": "...", "message": "..." } }`. Semua endpoint `/api` kecuali `/api/health` dan `/api/public-config` memerlukan `Authorization: Bearer <access-token>` yang diverifikasi server.

## Identitas dan sumber

| Method | Path | Hasil |
|---|---|---|
| GET | /api/public-config | PublicConfig; hanya URL dan publishable key yang memang boleh berada di browser |
| GET | /api/health | Kesehatan proses minimal, bukan bukti koneksi live |
| GET | /api/me | MeResponse: user dan permissions |
| GET | /api/status | AppStatus: kesiapan, snapshot, status sync dan jadwal |
| GET | /api/dictionaries | FilterOptions untuk filter yang benar-benar ada pada snapshot |

## Pembacaan

| Path | Hasil |
|---|---|
| /api/overview | OverviewResponse: KPI, chart, kualitas dan metadata |
| /api/applications | ListResponse<Application> |
| /api/applications/:id | ApplicationDetail |
| /api/candidates | ListResponse<Candidate> |
| /api/candidates/:id | CandidateDetail |
| /api/partners?kind=agents atau companies | ListResponse<Partner> |
| /api/departures | ListResponse<Departure>; tidak tersedia bukan zero |
| /api/issues | ListResponse<DataIssue> |

Filter mengikuti QueryFilters. Pagination `page`, `limit`; pengurutan `sort`, `direction`. Nilai kosong memakai sentinel `__empty__`, bukan wildcard tidak terkendali. Backend memvalidasi semua query. Semua tabel dan ekspor harus memakai logika filter yang sama. Respons detail tidak boleh berisi field sensitif yang tidak diizinkan untuk peran pengguna.

### Identitas, tanggal, dan daftar mitra

`candidateGraduationYear` dan `candidateCategory` pada lamaran hanya berasal dari relasi master dengan `identityVerified=true`. Relasi tidak terverifikasi tetap mempertahankan token ID literal dan masalah identitas, tetapi kedua atribut tervalidasi itu `null` dan tidak masuk kohort tahun/kategori master. Kontak/detail kandidat tidak diwariskan melalui relasi yang gagal; nama mirip tidak memperbaiki ID otomatis.

Tanggal bulan bernama, bulan numerik, dan tanggal harian memakai batas tahun kalender yang sama, **1900..2200 inklusif**. Teks mentah tetap dipertahankan. Tahun tidak valid menghasilkan `iso=null`, `precision=unknown` dan masalah tanggal ambigu, bukan tanggal/bulan yang dikoreksi. Tanggal bulan yang valid tetap berpresisi `month`, bukan hari pertama yang dibuat-buat.

Pada `/api/partners` dan ekspor `kind=partners`:
- `q` mencari **master** (`id`, `name`, `country`); `country` adalah **Negara master**, bukan negara tujuan lamaran; `issue` adalah **Masalah data master**, bukan masalah lamaran. Predikat ini diterapkan sekali pada baris master.
- Filter lain (`from`, `to`, `agent`, `company`, `workBase`, `position`, `status`, `finalResult`, `stage`, `year`, `category`, `metric`) membatasi **kohort lamaran tertaut** untuk menghitung ulang `applicationCount`, `passedCount`, dan `unknownResultCount`. Contohnya, `status` di sini adalah status proses lamaran, bukan status kerja sama master. Negara tujuan atau masalah lamaran tidak diterapkan ulang dari `country`/`issue`.
- Master terpilih tetap ditampilkan walaupun hitungan kohort nol. Relasi ID master yang ambigu tetap dikarantina; tidak ada padanan fuzzy baru.
- Kelompok `__unmapped__` hanya berisi lamaran kohort yang memang tidak memiliki relasi mitra tervalidasi. Mitra yang tidak lolos filter master **tidak** dipindahkan ke kelompok ini. Kelompok memiliki `country=''`, `issueCodes=['UNMAPPED_GROUP']`, nama `Tidak terpetakan`; ketiga predikat master yang sama juga berlaku padanya. Maka `country=ID` mengecualikannya, `country=__empty__` dapat memilihnya, dan `issue=UNMAPPED_GROUP` memilih masalah kelompok ini, bukan sembarang masalah lamaran.
- Pengurutan dilakukan **setelah** hitungan kohort dan kelompok tak terpetakan terbentuk, identik untuk tabel dan CSV. Tabel dipaginasi; CSV memuat seluruh pilihan, bukan hanya halaman saat ini. `excludedDatePrecision` untuk mitra menghitung eksklusi kohort lamaran sebelum pemilihan master, bukan jumlah baris master.

## Admin

| Method | Path | Keterangan |
|---|---|---|
| GET | /api/settings | AppSettings; kesiapan credential sebagai boolean, tidak ada isi key/path rahasia |
| PUT | /api/settings | Body hanya referenceTabs, syncIntervalMinutes, retentionDays |
| POST | /api/sync | Sinkronisasi satu arah yang diserialisasi, tidak mengubah Sheets |
| GET | /api/audit | AuditListResponse; log admin tidak memerlukan snapshot rekrutmen |
| GET | /api/mappings | `{rows: MappingDecision[]}` |
| POST | /api/mappings | `{kind, alias, targetId, reason, snapshotId}`; target harus tunggal, tabrakan ditolak |
| POST | /api/issues/:id/review | `{status, note, snapshotId}`; tinjauan terpisah dari sumber |

### Metadata log audit

`AuditListResponse = {rows: AuditEvent[], pagination, meta: AuditMeta}`. Metadata berbentuk:

```json
{"kind":"audit","generatedAt":"2026-11-19T00:00:00.000Z","filters":{"q":"sync"},"sourceSnapshot":null}
```

`generatedAt` adalah waktu respons log, **bukan** waktu snapshot sumber. `sourceSnapshot` hanya konteks sumber yang benar-benar tersedia untuk konfigurasi aktif: `{snapshotId, source, createdAt}` atau `null`. Tidak ada snapshot/source palsu pada metadata log; data tetap berasal dari audit persisten, termasuk kegagalan refresh pertama atau perubahan settings sebelum snapshot pertama. `q`, pagination, serta sort `at|action|result|actorId|id` didukung; default `at desc`. Autentikasi dan batas **admin saja** tetap berlaku.

Tanpa `snapshotId`, log dapat dibaca ketika snapshot belum ada/ditarik karena sumber tidak cocok. `snapshotId` opsional tetap merupakan prasyarat eksplisit: snapshot tersedia tetapi berbeda menghasilkan `409 SNAPSHOT_CHANGED`; tidak ada snapshot sumber yang tersedia menghasilkan `503 SNAPSHOT_UNAVAILABLE`. Klien Settings harus memakai `AuditListResponse`, bukan memaksakan `DataMeta`/`ListResponse<AuditEvent>` atau menjadikan snapshot syarat membaca log.

## Ekspor

`GET /api/export?kind=aggregate|applications|candidates|departures|partners` mengembalikan CSV UTF-8. Gunakan filter yang sama. Snapshot ID disertakan sebagai kolom metadata agar jumlah baris tetap dapat direkonsiliasi. Kontak tidak ikut secara default. Pimpinan hanya ekspor agregat. Permintaan kontak eksplisit memerlukan izin yang sesuai. CSV formula injection dinetralkan tanpa mengubah nilai sumber.

### CSV kosong: record metadata, bukan baris bisnis

CSV **nonkosong tetap kompatibel**: BOM UTF-8, header/kolom yang sama, metadata `snapshot_id`, `snapshot_at`, `source`, `filters`, `unit_definition` di setiap baris bisnis; tidak disisipkan record metadata atau kolom tipe baru.

Jika pilihan memiliki **nol baris bisnis**, CSV berisi header metadata tersendiri dan tepat satu record dengan kolom berikut (tidak ada kolom `id`, nama kandidat/mitra, kontak, maupun baris aplikasi/mitra dummy):

| Kolom | Nilai |
|---|---|
| `snapshot_id`, `snapshot_at`, `source` | ID, waktu, dan mode snapshot yang benar-benar dipakai |
| `filters` | JSON filter bisnis efektif; `snapshotId` adalah prasyarat terpisah, bukan filter |
| `unit_definition` | Definisi unit sesuai jenis ekspor |
| `record_type` | `metadata` |
| `business_row_count` | `0` |
| `export_kind` | `applications`, `candidates`, `departures`, atau `partners` |
| `partner_kind` | `agents` / `companies` untuk mitra; string kosong untuk jenis lain |
| `excluded_date_precision` | Jumlah eksklusi presisi tanggal dari seleksi yang sama; `0` untuk kandidat |

Rekonsiliasi harus mengenali `record_type=metadata`: jumlah baris bisnis adalah `business_row_count=0`, **bukan** jumlah record CSV sesudah header. Untuk CSV nonkosong, jumlah baris bisnis adalah jumlah record sesudah header. Agregat tetap memiliki baris definisi KPI walaupun kohort lamaran nol. Semua sel, termasuk metadata, melalui netralisasi formula CSV yang sama. Format kosong ini mengubah kontrak lama header-only; konsumen yang mengimpor CSV harus mengenalinya, tidak menganggap record metadata sebagai kandidat atau mitra.

## Keterbatasan bukti

Token/identitas dan sumber yang diinjeksi dalam unit/integration test hanya pengujian terisolasi; bukan login Supabase atau sinkronisasi Google Sheets live. Aplikasi normal tidak menyediakan endpoint login demo, parameter untuk menjadi admin, atau mode fixture fallback.
