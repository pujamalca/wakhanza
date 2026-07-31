# ARCHITECTURE — wakhanza

Dokumen ini menjelaskan bagaimana wakhanza bekerja: proses apa yang hidup, data mengalir ke mana, dan keputusan teknis apa yang menahan sistem ini tetap benar.

---

## 1. Topologi Proses

```
┌──────────────────┐        ┌────────────────────────────────────────┐
│  SIMRS Khanza    │        │              wakhanza                  │
│  (Java desktop)  │        │                                        │
└────────┬─────────┘        │  ┌──────────────────────────────────┐  │
         │ tulis            │  │  wakhanza-worker  (PM2, 1 saja)  │  │
         ▼                  │  │   poller → normalizer →          │  │
   ┌────────────┐  SELECT   │  │   privacy → outbox               │  │
   │  MariaDB   │◄──────────┼──┤   dispatcher → whatsapp-web.js   │  │
   │    sik     │ wakhanza_ro│ │   node-cron (H-1, pembersihan)   │  │
   │ 1.234 tabel│           │  └───────────────┬──────────────────┘  │
   └────────────┘           │                  │ baca-tulis          │
                            │                  ▼                     │
     TIDAK PERNAH DITULIS   │           ┌─────────────┐              │
                            │           │  MariaDB    │              │
                            │           │  wakhanza   │              │
                            │           └──────▲──────┘              │
                            │                  │                     │
                            │  ┌───────────────┴──────────────────┐  │
                            │  │  wakhanza-web  (PM2, Next.js 14) │  │
                            │  │   QR · outbox · template · nomor │  │
                            │  └──────────────────────────────────┘  │
                            └────────────────────────────────────────┘
```

**Worker wajib satu instance.** Bukan preferensi — keharusan. Klien whatsapp-web.js memegang sesi di memori dan mengunci direktori `.wwebjs_auth`. Dua instance berarti dua Chromium memperebutkan satu sesi, yang berakhir dengan sesi rusak dan QR harus di-scan ulang.

Di `ecosystem.config.js`, `wakhanza-worker` **harus** `instances: 1, exec_mode: 'fork'` — tidak boleh `cluster`.

Dashboard boleh berapa pun instance-nya karena tidak memegang sesi apa pun. Semua komunikasi antar proses lewat database.

> Ini justru pelajaran dari apiwa. Di sana klien WhatsApp hidup di dalam proses web yang dijalankan PM2 mode cluster dengan 2 instance, sehingga instance mana yang memegang sesi tenant menjadi tidak dapat ditentukan dari request ke request. wakhanza memindahkan klien keluar dari proses web sepenuhnya.

### Pertukaran antar proses

Dashboard tidak pernah memanggil worker lewat HTTP. Semuanya lewat tabel:

| Kebutuhan | Mekanisme |
|---|---|
| Menampilkan QR | Worker menulis QR ke `wa_session.qr_data`; dashboard membacanya berkala |
| Menampilkan status koneksi | Worker memperbarui `wa_session.status` + `heartbeat_at` |
| Petugas menekan "kirim ulang" | Dashboard mengubah baris `outbox` ke `pending`; dispatcher mengambilnya di siklus berikutnya |
| Petugas menekan "sambung ulang" | Dashboard menulis `wa_session.command = 'reconnect'`; worker membacanya lalu mengosongkannya |

Konsekuensi yang harus diterima: tindakan petugas terasa lambat, tertunda hingga satu siklus (≤ 5 detik). Imbalannya, tidak ada port internal yang perlu dibuka dan tidak ada penemuan layanan yang perlu diurus.

---

## 2. Alur Data

```
  [1] POLL          baca sik sejak watermark terakhir
       │
  [2] COALESCE      gabungkan baris yang seharusnya jadi satu pesan
       │
  [3] RESOLVE       cari nomor pasien (koreksi manual > sik.pasien)
       │
  [4] NORMALIZE     rapikan ke format 628xxxxxxxxx
       │
  [5] GATE          lewati bila: nomor invalid, opt-out, pemicu nonaktif
       │
  [6] PRIVACY       layanan sensitif → ganti dengan pesan generik
       │
  [7] RENDER        isi variabel ke template
       │
  [8] ENQUEUE       INSERT ke outbox (ditolak bila kunci idempoten sudah ada)
       │
       ▼
  ═══ batas proses ═══ (outbox bertahan melewati restart)
       │
  [9] DISPATCH      ambil pending → cek jam tenang → cek laju
       │
 [10] SEND          whatsapp-web.js, jeda acak 3–8 detik
       │
 [11] LOG           catat hasil, ulangi bila gagal sementara
```

Langkah [1]–[8] adalah tugas poller, berjalan tiap 60 detik. Langkah [9]–[11] adalah tugas dispatcher, berjalan terus-menerus dengan jeda.

Pemisahan ini penting: **membentuk pesan dan mengirim pesan tidak boleh berada dalam satu transaksi.** Bila pengiriman gagal, pesan tetap ada di outbox dan bisa dicoba lagi. Bila keduanya menyatu, kegagalan kirim akan menghapus jejak bahwa pemicunya pernah terdeteksi.

---

## 3. Skema Database `wakhanza`

```sql
-- 001_init.sql

CREATE TABLE poll_cursor (
  trigger_code   VARCHAR(32)  NOT NULL PRIMARY KEY,
  cursor_ts      DATETIME     NOT NULL,
  last_run_at    DATETIME     NULL,
  last_error     TEXT         NULL,
  rows_seen      INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE outbox (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  idempotency_key  VARCHAR(64)  NOT NULL,
  trigger_code     VARCHAR(32)  NOT NULL,
  no_rkm_medis     VARCHAR(15)  NULL,
  phone_e164       VARCHAR(20)  NULL,
  body             TEXT         NOT NULL,
  status           ENUM('pending','sending','sent','failed','failed_permanent',
                        'skipped_no_contact','skipped_opt_out','expired') NOT NULL DEFAULT 'pending',
  attempts         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  event_at         DATETIME     NOT NULL,   -- kapan kejadian terjadi di sik
  scheduled_at     DATETIME     NOT NULL,   -- kapan boleh dikirim
  sent_at          DATETIME     NULL,
  last_error       TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idem (idempotency_key),
  KEY ix_dispatch (status, scheduled_at),
  KEY ix_rm (no_rkm_medis)
) ENGINE=InnoDB;

CREATE TABLE template (
  trigger_code  VARCHAR(32)  NOT NULL PRIMARY KEY,
  label         VARCHAR(80)  NOT NULL,
  body          TEXT         NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    VARCHAR(64)  NULL
) ENGINE=InnoDB;

CREATE TABLE patient_contact (
  no_rkm_medis  VARCHAR(15)  NOT NULL PRIMARY KEY,
  raw_value     VARCHAR(40)  NULL,        -- salinan sik.pasien.no_tlp saat diperiksa
  phone_e164    VARCHAR(20)  NULL,        -- hasil normalisasi; NULL = tak terpakai
  source        ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  reason        VARCHAR(64)  NULL,        -- empty | too_short | not_mobile | unparseable
  checked_at    DATETIME     NOT NULL,
  updated_by    VARCHAR(64)  NULL,
  KEY ix_phone (phone_e164),
  KEY ix_invalid (phone_e164, source)
) ENGINE=InnoDB;

CREATE TABLE opt_out (
  phone_e164  VARCHAR(20) NOT NULL PRIMARY KEY,
  source      ENUM('reply','manual') NOT NULL,
  note        VARCHAR(200) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE wa_session (
  id            TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,  -- selalu satu baris
  status        ENUM('disconnected','qr_pending','authenticating','ready','failed')
                NOT NULL DEFAULT 'disconnected',
  qr_data       TEXT     NULL,
  qr_issued_at  DATETIME NULL,
  phone_number  VARCHAR(20) NULL,
  heartbeat_at  DATETIME NULL,
  command       ENUM('none','reconnect','logout') NOT NULL DEFAULT 'none',
  last_error    TEXT NULL
) ENGINE=InnoDB;

CREATE TABLE send_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  outbox_id     BIGINT UNSIGNED NOT NULL,
  attempt       TINYINT UNSIGNED NOT NULL,
  outcome       ENUM('sent','error') NOT NULL,
  detail        TEXT NULL,
  duration_ms   INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_outbox (outbox_id)
) ENGINE=InnoDB;

CREATE TABLE app_user (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50) NOT NULL UNIQUE,
  name          VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','operator') NOT NULL DEFAULT 'operator',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor       VARCHAR(64) NOT NULL,
  action      VARCHAR(64) NOT NULL,
  target      VARCHAR(120) NULL,
  detail      TEXT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_actor (actor, created_at)
) ENGINE=InnoDB;

CREATE TABLE app_setting (
  k  VARCHAR(64) NOT NULL PRIMARY KEY,
  v  TEXT NOT NULL
) ENGINE=InnoDB;
```

Catatan desain:

- **`outbox.body` menyimpan teks final, bukan referensi ke template.** Mengubah template tidak boleh mengubah bunyi pesan yang sudah pernah dikirim — riwayat harus mencerminkan apa yang benar-benar diterima pasien.
- **`outbox` menyimpan `phone_e164`, bukan hanya `no_rkm_medis`.** Alasan sama: nomor bisa dikoreksi setelah pesan terkirim.
- **`patient_contact` menyimpan `raw_value`.** Saat `sik.pasien.no_tlp` berubah, sistem tahu hasil normalisasi lamanya sudah basi dan perlu dihitung ulang.
- **`wa_session` sengaja satu baris** dengan primary key tetap 1. Satu nomor, satu sesi.

---

## 4. Strategi Polling

### 4.1 Dua kelas pemicu

Ini adalah pembelahan terpenting dalam desain poller, dan sumbernya adalah keterbatasan skema Khanza:

**Tabel Khanza tidak punya `updated_at`.** Karena itu perubahan pada baris yang sudah ada mustahil dideteksi dengan watermark. Konsekuensinya, pemicu terbagi dua:

| Kelas | Cara deteksi | Dipakai untuk |
|---|---|---|
| **Sisip** | Watermark maju pada kolom waktu | `QUEUE_REG`, `RESULT_READY`, `PHARMACY_READY`, `BILLING_READY`, `BOOK_CONFIRM` |
| **Pindai** | Pindai ulang jendela terbatas tiap siklus | `BOOK_CANCEL`, `BOOK_REMIND` |

Pemicu kelas pindai tidak bisa memakai watermark karena `booking_registrasi.status` berubah **tanpa meninggalkan jejak waktu**. Petugas menandai `'Dokter Berhalangan'` hari ini pada booking yang dibuat minggu lalu — `tanggal_booking` tetap minggu lalu.

Solusinya: tiap siklus, pindai ulang seluruh booking yang `tanggal_periksa >= CURDATE()`. Jendela ini terbatas secara alami (booking mendatang saja — pada database yang diperiksa hanya 255 baris seluruhnya), jadi biayanya dapat diabaikan. Yang mencegah pengiriman berulang bukan watermark, melainkan kunci idempoten.

### 4.2 Kunci idempoten

```
idempotency_key = SHA1( trigger_code | kunci_alami_1 | kunci_alami_2 | ... )   → 40 hex
```

| Pemicu | Kunci alami | Efek |
|---|---|---|
| `BOOK_CONFIRM` | `no_rkm_medis`, `tanggal_periksa` | satu konfirmasi per booking |
| `BOOK_REMIND` | `no_rkm_medis`, `tanggal_periksa` | satu pengingat per booking |
| `BOOK_CANCEL` | `no_rkm_medis`, `tanggal_periksa`, **`status`** | status berubah ⇒ kunci baru ⇒ pesan baru |
| `QUEUE_REG` | `no_rawat` | satu pesan per kunjungan |
| `RESULT_READY` | `no_rawat`, jenis (`lab`/`rad`), `tgl_periksa` | **satu pesan per kunjungan per hari** |
| `PHARMACY_READY` | `no_resep` | satu pesan per resep |
| `BILLING_READY` | `no_nota` | satu pesan per nota |

Menyertakan `status` pada `BOOK_CANCEL` adalah yang membuat pemicu kelas pindai bekerja. Selama status masih `'Belum'`, kunci yang dihasilkan selalu sama dan `INSERT` selalu ditolak. Begitu petugas mengubahnya ke `'Dokter Berhalangan'`, kunci berubah, `INSERT` lolos, satu pesan terkirim. Pindaian berikutnya menghasilkan kunci yang sama lagi dan kembali ditolak.

Penyisipan memakai:

```sql
INSERT IGNORE INTO outbox (idempotency_key, trigger_code, ...) VALUES (...);
```

`INSERT IGNORE` mengubah pelanggaran UNIQUE menjadi operasi tanpa efek. Deduplikasi terjadi di dalam mesin database, bukan dalam kode aplikasi — jadi tetap benar meskipun ada dua poller berjalan bersamaan.

### 4.3 Penggabungan hasil penunjang

`RESULT_READY` memakai kunci `(no_rawat, jenis, tgl_periksa)`, bukan per baris `periksa_lab`. Ini disengaja.

`periksa_lab` punya primary key gabungan `(no_rawat, kd_jenis_prw, tgl_periksa, jam)` — satu baris **per jenis pemeriksaan**. Pasien dengan panel darah lengkap menghasilkan belasan baris sekaligus. Tanpa penggabungan, pasien menerima belasan WhatsApp beruntun untuk satu kunjungan.

Query poller karena itu mengelompokkan lebih dulu:

```sql
SELECT l.no_rawat,
       l.tgl_periksa,
       MAX(l.jam)      AS jam_terakhir,
       COUNT(*)        AS jumlah_item
FROM periksa_lab l
WHERE l.tgl_periksa >= :cursor_date
GROUP BY l.no_rawat, l.tgl_periksa
HAVING MAX(TIMESTAMP(l.tgl_periksa, l.jam)) >= :cursor_ts
ORDER BY jam_terakhir
LIMIT 200
```

`jumlah_item` tidak pernah masuk isi pesan — jumlah pemeriksaan pun merupakan petunjuk medis. Nilainya hanya dipakai untuk log dan pemantauan.

### 4.4 Aturan watermark

```
cursor_ts_baru = waktu_kejadian_maksimum_yang_terbaca   (bukan NOW())
query berikutnya memakai  >= cursor_ts   (bukan >)
```

Memakai `>=` berarti baris di batas akan terbaca ulang setiap siklus. Itu disengaja dan aman, karena kunci idempoten menolak duplikatnya. Alternatifnya, `>`, akan **kehilangan secara permanen** baris mana pun yang tercatat pada detik yang persis sama dengan cursor — kegagalan senyap yang jauh lebih buruk daripada sedikit pekerjaan berulang.

Memakai waktu kejadian maksimum yang terbaca, bukan `NOW()`, mencegah lubang saat SIMRS menulis baris dengan jam yang sedikit tertinggal dari jam server.

### 4.5 Zero-date MariaDB

`resep_obat.tgl_penyerahan` bertipe `DATE NOT NULL` dan berisi `'0000-00-00'` untuk resep yang belum diserahkan — 3.213 baris pada database yang diperiksa. Ini bukan anomali; inilah cara Khanza menandai "belum".

Dua akibat yang harus ditangani:

1. Query wajib menyaring `WHERE tgl_penyerahan <> '0000-00-00'`. Menganggap kolom itu `NULL` akan salah total.
2. Koneksi mysql2 **wajib** memakai `dateStrings: true`. Tanpa itu, driver mencoba mengubah `'0000-00-00'` menjadi objek `Date` JavaScript dan menghasilkan `Invalid Date` atau `null`, tergantung konfigurasi — kegagalan senyap yang sulit dilacak.

```ts
new Sequelize(..., {
  dialect: 'mysql',
  dialectOptions: { dateStrings: true, typeCast: true },
});
```

Konversi tanggal dilakukan sendiri di lapisan aplikasi, dari string, dengan zero-date ditangani secara eksplisit.

### 4.6 Batas per siklus

Tiap query memakai `LIMIT 200`. Bila satu siklus mengembalikan 200 baris penuh, watermark tetap maju dan siklus berikutnya melanjutkan sisanya.

Ini melindungi dari dua hal: pemasangan pertama kali (yang tanpa batas akan mencoba mengirim seluruh riwayat), dan pemulihan setelah layanan lama mati. Aturan basi di §6.3 yang kemudian membatalkan pesan yang sudah tidak relevan.

---

## 5. Modul Inti

Semuanya fungsi murni di `src/core/` — tanpa database, tanpa jaringan, mudah diuji menyeluruh.

### 5.1 Normalisasi nomor (`core/phone.ts`)

Kondisi nyata pada 8.117 pasien:

| Kondisi | Jumlah | Porsi |
|---|---|---|
| Kosong / `-` | 3.165 | 39,0% |
| Diawali `08` | 3.677 | 45,3% |
| Diawali `628`/`+62` | 0 | 0% |
| Lain-lain | 1.275 | 15,7% |

Contoh nyata yang harus ditangani: `085267496048`, `81363222286` (kehilangan `0` di depan), `2341231231` (bukan nomor seluler), `-`.

Urutan aturan:

```
1. Buang semua karakter selain digit
2. Buang awalan 62 berulang  (626281… → 6281…)
3. Bila diawali '0'  → ganti dengan '62'
4. Bila diawali '8'  → tambahkan '62' di depan
5. Bila diawali '62' → biarkan
6. Selain itu       → tolak, alasan 'unparseable'
7. Validasi akhir: ^628[1-9][0-9]{7,10}$
```

Langkah 4 adalah yang menyelamatkan sebagian besar dari 1.275 baris golongan "lain-lain" — `81363222286` menjadi `6281363222286`. Langkah 7 yang menolak `2341231231`, karena setelah langkah 6 nomor itu tidak diawali `0`, `8`, maupun `62`.

Alasan penolakan disimpan (`empty`, `too_short`, `not_mobile`, `unparseable`) supaya dashboard dapat mengelompokkan masalah, dan supaya terlihat jelas apakah masalahnya pendataan atau format.

Perhatikan bahwa aturan ini konservatif dengan sengaja. Nomor yang dipaksakan padahal salah akan mengirim informasi layanan seseorang **ke orang lain**. Bila ragu, tolak dan minta petugas memperbaiki.

### 5.2 Penyaring privasi (`core/privacy.ts`)

```
masuk:  { kd_poli, nm_poli, jenis_layanan, kd_jenis_prw[] }
keluar: { aman: boolean, alasan?: string }
```

Daftar layanan sensitif tersimpan di `app_setting` dan dapat diubah dari dashboard. Bila pemicu berasal dari layanan yang tercantum, seluruh isi pesan diganti template generik yang tidak menyebut poli maupun jenis layanan.

Yang **tidak pernah** boleh masuk pesan, tanpa memandang daftar:

- Nama pemeriksaan dari `jns_perawatan_lab`. Tabel ini terbukti memuat `Anti HBs Ag` — menyebutnya sama dengan membocorkan status skrining hepatitis. Tabel itu juga kotor: berisi duplikat dan entri sampah seperti `1111111111111111`, jadi tidak layak ditampilkan bahkan bila tidak sensitif.
- Nama obat dari `resep_obat` / `detail_pemberian_obat`
- Nilai hasil dari `detail_periksa_lab`
- Diagnosis dari `diagnosa_pasien`

Larangan ini ditegakkan lewat struktur, bukan sekadar peninjauan: query di `src/khanza/` **tidak mengambil kolom-kolom itu sama sekali**. Data yang tidak pernah dibaca tidak mungkin bocor karena salah ketik di template.

### 5.3 Template (`core/template.ts`)

Penggantian variabel sederhana `{nama_variabel}`. Tanpa logika percabangan, tanpa perulangan, tanpa evaluasi ekspresi.

Alasannya keamanan: template dapat diubah dari dashboard oleh petugas. Bahasa template yang bisa mengevaluasi ekspresi berarti memberi jalan mengeksekusi kode kepada siapa pun yang bisa masuk dashboard.

Variabel yang tidak dikenal menyebabkan penyimpanan template ditolak, bukan menghasilkan string kosong saat kirim. Kesalahan harus muncul saat petugas menyunting, bukan saat pasien menerima pesan aneh.

---

## 6. Dispatcher

### 6.1 Siklus

```
tiap 5 detik:
  bila wa_session.status ≠ 'ready'        → tunggu
  bila di luar jam tenang                 → tunggu
  bila kuota per jam habis                → tunggu
  ambil 1 baris outbox:
      WHERE status='pending' AND scheduled_at <= NOW()
      ORDER BY scheduled_at
      LIMIT 1  FOR UPDATE SKIP LOCKED
  tandai 'sending' → kirim → catat hasil
  tidur acak 3–8 detik
```

Satu pesan per iterasi, tidak berkelompok. Mengirim beruntun cepat adalah pola yang memicu deteksi spam WhatsApp.

`FOR UPDATE SKIP LOCKED` didukung MariaDB 10.4 dan menjaga kebenaran seandainya kelak ada lebih dari satu dispatcher. Saat ini hanya satu, tetapi biayanya nol dan menghilangkan seluruh kelas bug balapan.

### 6.2 Jam tenang

Default 21.00–07.00 WIB tidak mengirim. Pesan **ditahan**, bukan dibuang: `scheduled_at` dimajukan ke pukul 07.00 berikutnya.

Dikecualikan dari penahanan: `BOOK_CANCEL`. Pemberitahuan dokter berhalangan untuk jadwal besok pagi harus sampai malam itu juga, atau kehilangan seluruh gunanya.

### 6.3 Ambang basi

Sebelum mengirim, dispatcher memeriksa `event_at`. Bila lebih tua dari `STALE_THRESHOLD_HOURS` (default 6 jam), pesan ditandai `expired` dan tidak dikirim.

Ini yang mencegah skenario terburuk pada pemasangan awal maupun pemulihan setelah mati: pasien menerima puluhan pesan tentang kunjungan minggu lalu.

Ambang berbeda per pemicu masuk akal — `QUEUE_REG` basi dalam hitungan jam, sementara `BILLING_READY` masih berguna keesokan harinya. Disimpan per pemicu di `app_setting`.

### 6.4 Kegagalan

| Jenis | Contoh | Tindakan |
|---|---|---|
| Sementara | Chromium putus, jaringan mati, sesi belum siap | ulangi dengan jeda menaik 1/5/25 menit, maksimum 3 kali |
| Permanen | nomor tidak terdaftar di WhatsApp | `failed_permanent`, tidak diulang, nomor ditandai di `patient_contact` |
| Terkena limit | WhatsApp menolak karena laju | jeda kirim global 30 menit, pesan kembali ke `pending` |

Kegagalan permanen memberi umpan balik ke `patient_contact`: nomor yang lolos normalisasi tetapi ditolak WhatsApp adalah nomor yang perlu diperiksa petugas — sesuatu yang tidak dapat dideteksi dari format saja.

---

## 7. Daur Hidup Klien WhatsApp

```
   mulai
     │
     ▼
  memuat sesi dari .wwebjs_auth
     │
     ├── ada & sah ──────────────► ready
     │
     └── tidak ada / kedaluwarsa
              │
              ▼
         terbitkan QR ──► tulis ke wa_session.qr_data
              │              (dashboard menampilkannya)
              ▼
         petugas memindai
              │
              ▼
           ready ──► heartbeat tiap 30 detik
              │
              ├── disconnected ──► coba sambung ulang 3× ──► gagal ──► qr_pending
              │
              └── perintah 'logout' ──► hapus .wwebjs_auth ──► qr_pending
```

QR WhatsApp kedaluwarsa sekitar 20 detik lalu terbit ulang. Dashboard memuat ulang tiap 5 detik dan menandai QR yang lebih tua dari 25 detik sebagai basi agar petugas tidak memindai kode yang sudah mati.

`heartbeat_at` yang tidak diperbarui lebih dari 2 menit dianggap worker mati, dan dashboard menampilkannya sebagai peringatan — meskipun PM2 melaporkan proses masih hidup. Proses yang hidup tetapi Chromium-nya menggantung adalah mode kegagalan yang nyata dan tidak terlihat dari `pm2 status`.

### Sesi adalah aset yang paling berharga

Direktori `.wwebjs_auth` **harus dicadangkan bersama database**. Kehilangannya berarti scan QR ulang — yang memerlukan seseorang dengan akses fisik ke ponsel nomor RS. Di rumah sakit, orang itu bisa saja sedang cuti.

Sebaliknya, `.wwebjs_auth` **tidak boleh** masuk git. Isinya kredensial sesi WhatsApp yang aktif.

---

## 8. Penanganan Berhenti Berlangganan

Meskipun versi 1 tidak melayani percakapan, worker tetap memasang pendengar pesan masuk khusus untuk kata kunci berhenti:

```
pesan masuk cocok /^\s*(stop|berhenti|unsubscribe)\s*$/i
  → INSERT INTO opt_out (phone_e164, source='reply')
  → balas satu kali konfirmasi
  → seluruh outbox 'pending' ke nomor itu ditandai 'skipped_opt_out'
```

Pesan masuk lain diabaikan tanpa balasan. Membalas otomatis untuk hal medis memerlukan tanggung jawab klinis yang berada di luar cakupan perangkat lunak ini.

Setiap pesan keluar menyertakan cara berhenti pada baris terakhir. Selain kewajiban etis, ini juga pengaman praktis: pasien yang tidak punya cara berhenti akan menekan **"Laporkan spam"** di WhatsApp — dan cukup beberapa laporan untuk memblokir nomor rumah sakit.

---

## 9. Keamanan

| Lapis | Penanganan |
|---|---|
| Database `sik` | Pengguna terpisah dengan hak `SELECT` saja. Diverifikasi saat proses mulai — worker menolak jalan bila ternyata bisa menulis |
| Database `wakhanza` | Pengguna terpisah, tanpa akses ke `sik` sama sekali |
| Dashboard | NextAuth wajib, tanpa halaman publik selain `/login` |
| Peran | `admin` boleh mengubah pengaturan & pengguna; `operator` hanya kirim ulang dan koreksi nomor |
| Audit | Setiap perubahan template, koreksi nomor, kirim ulang, dan penambahan opt-out tercatat beserta pelakunya |
| Jaringan | Dashboard mengikat ke `127.0.0.1` atau LAN rumah sakit. Tidak boleh terekspos ke internet |
| Rahasia | `.env` di luar git; `.wwebjs_auth/` di luar git |
| Log | pino dengan penyamaran nomor telepon (`628****4048`). Log bisa dilihat pihak yang tidak berhak melihat data pasien |

**Isi pesan sengaja tidak dienkripsi di dalam `outbox.body`.** Basis datanya berada di server rumah sakit yang sama dengan `sik` — yang menyimpan seluruh rekam medis tanpa enkripsi di tingkat kolom. Mengenkripsi teks notifikasi sementara rekam medis lengkap tersimpan terbuka di sebelahnya adalah teater keamanan yang menambah kerumitan tanpa menambah perlindungan nyata. Yang melindungi keduanya adalah kendali akses di tingkat server dan basis data.

---

## 10. Mode Kegagalan yang Sudah Diantisipasi

| Kegagalan | Yang terjadi | Pemulihan |
|---|---|---|
| Worker mati | Poller berhenti; outbox berhenti mengalir | PM2 menyalakan ulang; watermark tersimpan sehingga tidak ada pemicu terlewat; pesan basi dibatalkan |
| Chromium menggantung | `heartbeat_at` berhenti diperbarui | Pemeriksaan kesehatan memaksa restart proses |
| `sik` tidak dapat dihubungi | Siklus polling gagal, dicatat di `poll_cursor.last_error` | Watermark tidak maju; ulangi siklus berikutnya |
| Database `wakhanza` penuh | `INSERT` gagal | Pemantauan disk; pembersihan berkala (§11) |
| Sesi WhatsApp kedaluwarsa | Status menjadi `qr_pending`, dispatcher berhenti | Dashboard memperingatkan; petugas memindai ulang; outbox tetap utuh menunggu |
| Nomor RS diblokir | Semua pengiriman gagal | Tidak ada pemulihan otomatis. Ganti nomor, pindai QR baru; outbox mengalir kembali |
| Khanza mengubah skema `sik` | Query gagal saat kolom hilang | Pemeriksaan skema saat mulai membandingkan kolom yang dibutuhkan; berhenti dengan pesan jelas alih-alih diam-diam salah |
| Jam server bergeser | Watermark melompat | Watermark memakai waktu kejadian maksimum yang terbaca, bukan `NOW()`, sehingga tahan terhadap pergeseran ke depan |

---

## 11. Pembersihan Berkala

Dijalankan node-cron tiap malam:

| Sasaran | Aturan |
|---|---|
| `outbox` berstatus `sent` | dihapus setelah 90 hari |
| `send_log` | dihapus setelah 90 hari |
| `audit_log` | **tidak pernah dihapus otomatis** |
| `patient_contact` bersumber `auto` | dihitung ulang bila `raw_value` di `sik` berubah |
| `wa_session.qr_data` | dikosongkan saat status menjadi `ready` |

`audit_log` dikecualikan dengan sengaja. Bila kelak muncul pertanyaan siapa yang mengubah nomor telepon seorang pasien sehingga pesannya sampai ke orang lain, jawabannya harus masih ada.
