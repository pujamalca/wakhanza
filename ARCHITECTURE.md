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
   │  sik/alca  │ wakhanza_ro│ │   15 siklus pemicu + node-cron   │  │
   │ ~1.157 tbl │           │  └───────────────┬──────────────────┘  │
   └────────────┘           │                  │ baca-tulis          │
                            │                  ▼                     │
     TIDAK PERNAH DITULIS   │           ┌─────────────┐              │
                            │           │  MariaDB    │              │
                            │           │  wakhanza   │              │
                            │           └──────▲──────┘              │
                            │                  │                     │
                            │  ┌───────────────┴──────────────────┐  │
                            │  │  wakhanza-web  (PM2, Next.js 16) │  │
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
  [7] RENDER        isi variabel ke template, sisipkan kode unik (§6.1)
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

### 3.1 Yang tumbuh sesudah Fase 4

Blok DDL di atas adalah `001_init.sql` dan **bukan lagi bentuk skema yang berjalan**. Skema `wakhanza` sekarang berisi **26 tabel** (plus `schema_migrations`), dan tiga tabel intinya bertambah kolom. Dituliskan di sini sebagai daftar berikut ALASANNYA — bukan DDL lengkap, karena DDL yang disalin ke dokumen adalah DDL yang cepat atau lambat menyimpang dari migrasinya. Bentuk pastinya selalu di `migrations/NNN_*.sql`; yang tidak bisa dibaca dari sana adalah kenapa tabelnya berdiri sendiri.

**Kolom yang bertambah pada tabel inti**, dan semuanya menentukan perilaku:

| Tabel | Kolom baru | Yang berubah karenanya |
|---|---|---|
| `outbox` | `chat_id` (016) | tujuan bisa berupa grup/petugas, bukan cuma nomor pasien. **Bukan menumpang `phone_e164`**: JID grup 24 karakter tidak muat di `VARCHAR(20)`, dan dispatcher memakai `phone_e164` untuk mencari `opt_out` serta memanggil `getNumberId()` — keduanya tidak berlaku untuk grup. `chat_id` NULL = perilaku lama persis |
| | `media_path`, `media_mime`, `media_name` (014) | lampiran; yang disimpan LINTASANNYA, bukan isinya — satu broadcast ke 500 pasien menunjuk satu berkas |
| | `campaign_id` (005) | menautkan balik ke `broadcast_campaign`; jumlah terkirim/gagal DIHITUNG dari sini saat dibaca, tidak pernah disimpan sebagai penghitung |
| | `wa_message_id`, `ack_level`, `ack_at` (035) | konfirmasi terkirim. **Dimensi KEDUA, bukan status baru** — baris tetap `sent` sementara ack-nya bergerak |
| | status `skipped_uji_terbatas` (036) | yang tertahan kuota uji DICATAT, bukan dilewati diam-diam |
| `template` | `tujuan_mode` (018) | `pasien` / `pasien_dan_tujuan` / `tujuan`. Bawaan `pasien` yang membuat migrasinya nol-perubahan-perilaku |
| | `batas_pasien_harian` (036) | 0 = tanpa batas. Bawaan itu wajib: menafsirkan 0 sebagai "nol pesan" mematikan setiap pemicu yang sedang berjalan pada detik migrasinya diterapkan |
| `app_user` | penguncian (003) | lima kegagalan login mengunci akun |

**Tabel yang ditambahkan**, dikelompokkan menurut fitur yang melahirkannya:

| Tabel | Migrasi | Perannya, dan kenapa berdiri sendiri |
|---|---|---|
| `broadcast_campaign` | 005 | jejak akuntabilitas per kirim. **Insert-only** justru supaya angkanya tidak pernah bisa basi |
| `broadcast_schedule` | 006 | definisi segmen+pesan+pengulangan. Butuh `UPDATE`/`DELETE` (beda dari dua tetangganya) untuk `next_run_at`/`is_active` |
| `broadcast_template` | 008 | template broadcast **DISALIN, bukan diacu** — tidak ada FK, jadi menyunting/menghapusnya tidak mengubah jadwal yang berjalan |
| `auto_reply_rule` | 010 | aturan kata kunci; `priority` lalu `id` menentukan yang menang |
| `auto_reply_log` | 010 | kuota per nomor dihitung dari SINI, bukan `outbox` — pesan lain ke nomor yang sama tidak boleh memakan jatahnya. Tanpa grant `UPDATE`: baris log tidak pernah ditulis ulang |
| `farmasi_target` | 016 | tujuan apotek. Enam kolom centang terpisah (`is_active`, `boleh_tanya`, `terima_darurat_stok`, `terima_pengadaan`, `terima_hibah`, `terima_penjualan`, `terima_pemesanan`) karena masing-masing menjawab pertanyaan BERBEDA — pilihan yang digabung adalah pilihan yang hilang |
| `wa_group` | 016 | daftar grup hasil `sync_groups`. Ada karena JID grup **tidak bisa dilihat dari aplikasi WhatsApp**; yang bisa disalin staf cuma tautan undangan, yang bukan JID |
| `inbound_message` | 017 | arah MASUK. Terpisah dari `auto_reply_log` karena yang terakhir cuma ditulis saat `autoreply.enabled` menyala — nol baris di sana tidak bisa dibedakan dari nol pesan |
| `template_target` | 018 | tujuan tambahan **per `trigger_code`**. Unik per (pemicu, tujuan), bukan per tujuan — satu grup loket wajar menerima dua pemicu |
| `stok_alert_schedule` | 021 | jadwal darurat stok; `repeat_kind` di sini memuat `every_n_days` yang sengaja TIDAK ada di `broadcast_schedule` |
| `bpjs_target` | 024 | **tabel sendiri, bukan kolom ketujuh di `farmasi_target`** — halaman `/farmasi` menampilkan seluruh baris tabel itu sebagai "tujuan apotek", jadi grup pendaftaran akan muncul di sana berikut centang yang tidak berlaku baginya |
| `penjualan_pantau` | 040 | ingatan untuk mendeteksi nota yang DIHAPUS. Baris yang lenyap tidak meninggalkan apa pun untuk dibaca, jadi deteksinya menuntut catatan sendiri. Tidak menyimpan satu pun isi nota |
| `wa_session_event` | 037 | riwayat TRANSISI status sesi. `wa_session` cuma menyimpan keadaan sekarang (ditimpa `upsert`), jadi setiap perkiraan lama gangguan sebelum ini bersifat anekdot |
| `erm_target` | 044 | tujuan keperawatan. Sekali lagi tabel sendiri: penerimanya PERAWAT, dan tidak satu pun centang di `farmasi_target` berlaku bagi mereka |
| `wa_command_admin` | 045 | siapa yang boleh MENULIS aturan lewat WhatsApp. Terpisah dari `farmasi_target.boleh_tanya` karena "boleh menanyakan stok" dan "boleh mengubah apa yang dikatakan RS kepada pasien" adalah dua wewenang yang beratnya sama sekali berbeda |
| `wa_command_session` | 045 | ingatan percakapan wizard — satu-satunya keadaan bertahan di jalur pesan masuk. Kunci `(chat_id, pengirim_id)`, bukan `chat_id` saja: di grup, hanya peserta yang MEMULAI yang jawabannya dipakai |

**Grant TIDAK diwarisi, dan ini bukan catatan administratif.** `wakhanza_rw` diberi `UPDATE`/`DELETE` per-tabel (§9.5), bukan skema-lebar, jadi setiap tabel baru butuh grant eksplisit satu per satu. Terbukti empiris **delapan kali** — `ERROR 1142: command denied` sebelum grant, berhasil sesudahnya — pada `broadcast_schedule`, `broadcast_template`, `auto_reply_rule`/`auto_reply_log`, `farmasi_target`/`wa_group`, `stok_alert_schedule`, `template_target`, `bpjs_target`, `erm_target`, dan `wa_command_admin`/`wa_command_session`. Ini dijalankan lewat akun MariaDB berhak grant (root), **bukan** lewat `npm run migrate`: `wakhanza_rw` sendiri tidak punya `GRANT OPTION`.

**`DATETIME` di `wakhanza` menyimpan UTC, bukan WIB.** Sequelize memakai `timezone: '+00:00'`, jadi tulis-lewat-Sequelize dan baca-lewat-Sequelize konsisten dan tidak ada yang perlu diperbaiki di kode. Yang perlu diketahui adalah konsekuensi BACANYA: nilai yang terlihat di CLI `mysql` bukan jam dinding WIB, jadi menghitung selisih waktu dari angka mentah itu meleset 7 jam. Pakai `CONVERT_TZ(kolom,'+00:00','+07:00')` saat memeriksa lewat `mysql` — tapi **jangan** memakainya pada query yang dijalankan Sequelize, karena di sana `NOW()` ikut UTC dan koreksinya menghasilkan galat 7 jam dengan tanda terbalik.

---

## 4. Strategi Polling

### 4.1 Kelas pemicu

Ini adalah pembelahan terpenting dalam desain poller, dan sumbernya adalah keterbatasan skema Khanza:

**Tabel Khanza tidak punya `updated_at`.** Karena itu perubahan pada baris yang sudah ada mustahil dideteksi dengan watermark. Fase 0–4 hanya membutuhkan dua kelas; fitur sesudahnya menambahkan empat lagi — bukan karena selera, melainkan karena tiap kelas baru menjawab pertanyaan "apa yang memulai pesan ini" yang tidak bisa dijawab kelas sebelumnya.

| Kelas | Yang memicu | Cara deteksi | Dipakai untuk |
|---|---|---|---|
| **Sisip** | baris baru di `sik` | watermark maju di `poll_cursor` (`advanceCursor()`) | `QUEUE_REG`, `LAB_RESULT`, `RAD_RESULT`, `LAB_REQUEST`, `RAD_REQUEST`, `PHARMACY_READY`, `BILLING_READY`, `FARMASI_VALIDASI`, `FARMASI_PENYERAHAN`, `BPJS_BATAL` |
| **Pindai** | baris baru/berubah, tanpa kolom waktu yang bisa dipercaya | pindai ulang jendela terbatas tiap siklus (`core/jendelaPindai.ts`); dedup MURNI lewat kunci idempoten | `BOOK_CONFIRM`, `BOOK_CANCEL`, `SURAT_SAKIT`, `KONTROL_TERBIT`, `FARMASI_PENGADAAN`, `FARMASI_PEMESANAN`, `FARMASI_HIBAH`, `FARMASI_PENJUALAN`, `FARMASI_PENJUALAN_HAPUS` |
| **Staf-inisiasi** | seseorang menekan kirim | tidak ada polling `sik` sama sekali | `BROADCAST` (manual), `ADMINISTRASI` |
| **Jadwal tersimpan** | `next_run_at` jatuh tempo | `computeNextRunAt()` atas definisi yang disimpan staf | `BROADCAST` terjadwal, `FARMASI_STOK_DARURAT` |
| **Pesan masuk** | pasien mengirim WhatsApp | pendengar `client.on('message')` | `AUTO_REPLY` |
| **Waktu** | jam dinding melewati jam yang disetel staf | `jatuhTempoHarian()` / `slotJatuhTempo()` + penanda di `app_setting` | `BPJS_KONTROL`, `KONTROL_ULANG`, `FARMASI_PENJUALAN_REKAP`, `FARMASI_RESEP_REKAP`, `ERM_PENILAIAN_UMUM` |

**Kelas pindai** tidak bisa memakai watermark karena `booking_registrasi.status` berubah **tanpa meninggalkan jejak waktu**. Petugas menandai `'Dokter Berhalangan'` hari ini pada booking yang dibuat minggu lalu — `tanggal_booking` tetap minggu lalu. Solusinya: tiap siklus, pindai ulang seluruh booking yang `tanggal_periksa >= CURDATE()`. Jendela ini terbatas secara alami, jadi biayanya dapat diabaikan.

Sebab yang sama berulang pada pemicu berikutnya lewat bentuk yang lebih ekstrem: `suratsakit`, `pembelian`, `surat_pemesanan_medis`, `hibah_obat_bhp`, dan `penjualan` **tidak punya kolom jam sama sekali** — yang ada cuma kolom DATE yang DIPILIH staf. Watermark di atas kolom yang bisa dimundurkan manusia melewatkan baris secara permanen tanpa galat. Karena itu jendelanya merentang **ke DUA arah** dari hari ini: nomor yang dirakit dari tanggal pilihan staf bisa mendarat di masa depan.

**Kelas waktu** adalah yang paling gampang dikira kelas pindai, dan bedanya menentukan: tidak ada baris di `sik` yang "muncul" untuk memicunya. Penandanya di `app_setting` (`*_last_run`) **cuma penghemat query, bukan penentu kebenaran** — yang mencegah kirim ganda tetap kunci idempoten yang ditegakkan `uq_idem` di mesin database. Karena itu penanda dimajukan **sesudah** pekerjaannya berhasil, tidak pernah sebelum: satu kegagalan sesaat yang menulis penanda lebih dulu menghapus rekap atau pengingat SEHARIAN tanpa percobaan kedua.

`BOOK_REMIND` adalah anggota kelas ini lewat mekanisme yang lebih tua — `node-cron` di `startScheduler()`, yang membaca `schedule.book_remind_hour` **sekali** saat worker mulai. Mengubah jamnya lewat dashboard karena itu tidak berlaku sampai worker dinyalakan ulang, tanpa satu pun tanda bahwa setelan barunya belum aktif. Pemicu berjadwal sesudahnya sengaja tidak menirunya: semuanya memeriksa kejatuhtempoan tiap siklus pindai dan membaca jamnya ULANG tiap kali.

**Satu pemicu berdiri di luar pembelahan ini, dan bukan karena mekanismenya.** `ERM_PENILAIAN_UMUM` berkelas waktu seperti kelima tetangganya, tapi yang diberitakannya adalah **KETIADAAN** — asesmen awal yang belum diisi. Setiap pemicu lain berangkat dari sesuatu yang ADA; bahkan `FARMASI_PENJUALAN_HAPUS`, yang memberitakan baris yang lenyap, tetap berangkat dari baris yang pernah tercatat (karena itu `penjualan_pantau` ada). Di sini tidak ada dan tidak akan pernah ada baris untuk dipicu, sehingga watermark maupun jendela pindai sama-sama mustahil — satu-satunya cara mengetahuinya adalah membaca ulang seluruh hari lalu **membandingkan dua tabel**. Konsekuensi yang ikut: ia satu-satunya yang berbunyi **beberapa kali sehari**, dan penanda bertanggal biasa RUSAK pada jam kedua (rekap 13:00 menulis "hari ini", lalu 19:30 membacanya sebagai "sudah" dan tidak pernah berangkat). Karena itu penandanya menyimpan tanggal **berikut slotnya**, lewat `slotJatuhTempo()`.

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
| `LAB_REQUEST` / `RAD_REQUEST` | `noorder` | satu pesan per PERMINTAAN — bukan digabung per kunjungan seperti hasilnya, karena tabelnya sudah satu baris per permintaan dan dokter bisa menambah pemeriksaan susulan pada hari yang sama |
| `KONTROL_TERBIT` | `tahun`-`no_antrian`, `tgl_kontrol` | `tahun` WAJIB ikut: `no_antrian` cuma urut PER TAHUN, jadi tanpanya surat 000001 tahun ini ditolak sebagai duplikat surat 000001 tahun lalu |
| `KONTROL_ULANG` / `BPJS_KONTROL` | `no_surat`, tanggal rencana, **selisih hari** | selisih hari wajib ikut supaya setelan "7,1" menghasilkan DUA pengingat; tanggalnya ikut supaya surat yang dijadwalkan ulang diingatkan lagi |
| `SURAT_SAKIT` | `no_surat` | **tanpa stempel waktu** — kelas pindai membaca ulang jendelanya tiap siklus |
| `FARMASI_VALIDASI` / `FARMASI_PENYERAHAN` | `no_resep`, `chat_id` | |
| `FARMASI_PENGADAAN` / `_PEMESANAN` / `_HIBAH` | nomor nota, `chat_id` | |
| `FARMASI_PENJUALAN` / `_HAPUS` | `nota_jual`, `chat_id`, **generasi** | Khanza menomori dari `MAX(RIGHT(nota_jual,3))` per tanggal, jadi menghapus nota TERAKHIR hari itu membuat nomornya dipakai ulang; tanpa penghitung ini penggantinya ditolak sebagai duplikat, diam-diam |
| `FARMASI_PENJUALAN_REKAP` / `_RESEP_REKAP` | tanggal rekap, `chat_id` | |
| `ERM_PENILAIAN_UMUM` | tanggal rekap, **slot**, `chat_id` | slot wajib ikut — ia satu-satunya pemicu yang berbunyi beberapa kali sehari |
| `BROADCAST` | `campaign.id`, `no_rkm_medis` | `campaign.id` BARU tiap kali jalan, jadi jadwal berulang memang mengirim ulang |
| `BROADCAST_FOLLOWUP` | `schedule.id`, `no_rawat` | **tanpa `campaign.id`** — satu kunjungan hanya pernah memicu satu pesan selamanya. Berkunci pada KUNJUNGAN, bukan pasien, supaya kunjungan berikutnya tetap dapat tindak lanjutnya sendiri |
| `AUTO_REPLY` | id pesan masuk | |
| `ADMINISTRASI` / `FARMASI_UJI` | kunci alami + **stempel waktu** | sengaja BISA kirim ulang, lihat di bawah |

Menyertakan `status` pada `BOOK_CANCEL` adalah yang membuat pemicu kelas pindai bekerja. Selama status masih `'Belum'`, kunci yang dihasilkan selalu sama dan `INSERT` selalu ditolak. Begitu petugas mengubahnya ke `'Dokter Berhalangan'`, kunci berubah, `INSERT` lolos, satu pesan terkirim. Pindaian berikutnya menghasilkan kunci yang sama lagi dan kembali ditolak.

Penyisipan memakai:

```sql
INSERT IGNORE INTO outbox (idempotency_key, trigger_code, ...) VALUES (...);
```

`INSERT IGNORE` mengubah pelanggaran UNIQUE menjadi operasi tanpa efek. Deduplikasi terjadi di dalam mesin database, bukan dalam kode aplikasi — jadi tetap benar meskipun ada dua poller berjalan bersamaan.

**Empat aturan yang menempel pada bentuk kuncinya**, dan ketiga yang pertama gagal DIAM bila dilanggar — karena `INSERT`-nya memang sengaja `ignoreDuplicates`, jadi baris yang tertolak tidak menghasilkan satu pun galat:

1. **`chat_id` WAJIB masuk kunci begitu satu kejadian menyebar ke banyak tujuan.** Tanpanya, tujuan KEDUA dan seterusnya ditolak `uq_idem` sebagai duplikat, dan hanya satu grup yang pernah menerima apa pun.

2. **Kunci turunan per tujuan di-HASH ULANG, bukan disambung** (`turunkanKunciTujuan()`). `outbox.idempotency_key` `VARCHAR(64)` sementara SHA1 hex sudah 40 karakter; sambungan dengan JID grup 24 karakter menjadi 65, dan MariaDB non-strict **memotongnya diam-diam** tepat di bagian yang membedakan satu tujuan dari tujuan lain.

3. **Stempel waktu di dalam kunci adalah keputusan, bukan kelalaian.** Ia ADA pada `ADMINISTRASI` dan `FARMASI_UJI` — keduanya ditekan MANUSIA untuk satu sasaran, dan kirim ulang adalah keadaan normal (berkas terhapus dari ponsel, staf sedang membetulkan kode grup). Menolaknya sebagai duplikat berarti tombolnya menjawab "berhasil" sementara tidak ada apa pun yang terkirim. Ia sengaja TIDAK ADA pada seluruh kelas pindai: jendelanya dibaca ulang tiap siklus selama berhari-hari, jadi kunci yang selalu baru berarti nota yang sama dikirim setiap lima menit.

4. **Penyaringan di depan bukan pengganti `uq_idem`, melainkan penghemat yang berbeda per pemakainya.** `saringKunciBaru()` membuang baris yang kuncinya sudah ada SEBELUM pekerjaan mahal dikerjakan — di broadcast yang dihemat adalah baris `broadcast_campaign` yang mengaku punya penerima padahal nol pesan baru; di surat otomatis dan dokumen hasil yang dihemat adalah satu peluncuran Chromium plus satu PDF berisi identitas pasien untuk pesan yang toh ditolak. Penyaring itu WAJIB memeriksa kunci yang benar-benar ditulis: pada `tujuan_mode = 'tujuan'` yang ditulis hanya kunci TURUNAN, dan penyaring yang memeriksa kunci DASAR tidak pernah menyaring apa pun. Itu bukan kemungkinan teoretis — terukur 1.043 baris log "terkirim:1" sementara `outbox` berisi 2. Karena itu aturan penyebarannya tinggal di `core/tujuanPemicu.ts` dan dipakai BERSAMA oleh yang menulis dan yang menyaring.

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
WHERE l.no_rawat >= :lookback_prefix                      -- pemangkas indeks, lihat §4.4
GROUP BY l.no_rawat, l.tgl_periksa
HAVING MAX(TIMESTAMP(l.tgl_periksa, l.jam)) >= :cursor_ts -- ketepatan
ORDER BY jam_terakhir
LIMIT 200
```

Perhatikan bahwa penyaring pertama memakai `no_rawat`, **bukan** `tgl_periksa`. Alasannya ada di §4.4 dan bersifat menentukan — memfilter `tgl_periksa` secara langsung membuat query ini memindai seluruh tabel.

`jumlah_item` tidak pernah masuk isi pesan — jumlah pemeriksaan pun merupakan petunjuk medis. Nilainya hanya dipakai untuk log dan pemantauan.

### 4.4 Indeks: kendala yang menentukan bentuk seluruh query

**Ini bagian terpenting dokumen ini untuk kinerja.** Kolom tanggal yang tampak paling wajar dijadikan watermark justru tidak terindeks di Khanza — dan indeks tidak boleh ditambahkan, karena itu berarti menulis ke `sik`.

Hasil pemeriksaan indeks pada database nyata:

| Tabel | Kolom waktu yang wajar | Terindeks? |
|---|---|---|
| `reg_periksa` | `tgl_registrasi`, `jam_reg` | **tidak** |
| `booking_registrasi` | `tanggal_booking`, `jam_booking` | **tidak** |
| `periksa_lab` | `tgl_periksa`, `jam` | **tidak** — hanya kolom ke-3 dan ke-4 dalam PK gabungan, sehingga tidak dapat dipakai tanpa kolom terdepan |
| `periksa_radiologi` | `tgl_periksa`, `jam` | **tidak** — sama |
| `resep_obat` | `tgl_penyerahan` | **tidak** — yang terindeks `tgl_peresepan`, kolom yang berbeda |
| `nota_jalan` | `tanggal` | ya |

Bukti biayanya, dari `EXPLAIN` pada `reg_periksa`:

```
WHERE tgl_registrasi >= '2026-05-01'   →  type: ALL     key: NULL     rows: 33.159
WHERE no_rawat       >= '2026/05/01'   →  type: range   key: PRIMARY  rows: 3
```

Pada basis data pengembangan ini selisihnya sudah 11.000 kali. Di rumah sakit sungguhan dengan jutaan baris `reg_periksa`, pemindaian penuh setiap 60 detik akan terasa oleh petugas yang sedang memakai SIMRS.

**Jalan keluarnya: tanggal sudah ter-enkode di dalam primary key.**

| Tabel | Primary key | Bentuk | Penyaring berindeks |
|---|---|---|---|
| `reg_periksa` | `no_rawat` | `2026/05/29/000001` | `no_rawat >= '2026/05/29'` |
| `periksa_lab` | `(no_rawat, kd_jenis_prw, tgl_periksa, jam)` | terdepan `no_rawat` | `no_rawat >= '2026/05/29'` |
| `periksa_radiologi` | sama | sama | sama |
| `resep_obat` | `no_resep` | `202601100001` (YYYYMMDDNNNN) | `no_resep >= '20260110'` |
| `nota_jalan` | `no_rawat` + indeks `tanggal` | — | `tanggal >= …` |

Karena kedua format terurut secara leksikal menurut tanggal, perbandingan string biasa menghasilkan range scan pada primary key. Pada `periksa_lab`, `EXPLAIN` bahkan melaporkan `Using index` — seluruh query terjawab dari indeks tanpa menyentuh baris data sama sekali.

**Jebakan yang menyertainya: tanggal di dalam kunci adalah tanggal kunjungan, bukan tanggal kejadian.**

Pasien rawat inap terdaftar sekali, lalu menjalani pemeriksaan berhari-hari sesudahnya. Menyaring `no_rawat >= hari_ini` akan melewatkan hasil lab hari ini milik pasien yang mendaftar minggu lalu.

Pengukuran pada data nyata:

| Jeda hari | `periksa_lab` | `resep_obat` |
|---|---|---|
| 0 | 4.580 | 28.370 |
| 1 | 3 | 2 |
| 2 | 2 | 1 |
| 6 | 1 | 1 |

Hampir seluruhnya sehari, dengan maksimum terukur 6 hari. Tetapi angka itu berasal dari basis data pengembangan yang nyaris tanpa rawat inap panjang; perawatan ICU sungguhan bisa berminggu-minggu.

Karena itu polanya **dua penyaring, dua tujuan berbeda**:

```sql
WHERE no_rawat >= :lookback_prefix                       -- memangkas lewat indeks
  AND TIMESTAMP(tgl_periksa, jam) >= :cursor_ts          -- menentukan ketepatan
```

Penyaring pertama tidak menentukan kebenaran, hanya membatasi berapa baris yang disentuh. Penyaring kedua yang menentukan hasilnya benar. Dengan `LOOKBACK_DAYS` default 30, cakupannya jauh melampaui jeda terukur sekaligus tetap memangkas sebagian besar tabel.

`LOOKBACK_DAYS` yang terlalu kecil menyebabkan **pemicu hilang diam-diam** untuk pasien rawat inap lama — jenis kegagalan yang tidak menghasilkan error dan hanya ketahuan dari keluhan pasien. Sesuaikan dengan lama rawat terpanjang di rumah sakit yang bersangkutan, lalu lebihkan.

**`booking_registrasi` adalah satu-satunya yang tidak punya jalan keluar.** Primary key-nya `(no_rkm_medis, tanggal_periksa)` — kolom terdepannya nomor rekam medis, sehingga rentang tanggal tidak dapat memanfaatkannya. Pemicu kelas pindai di tabel ini memang memindai penuh. Peredamnya: tabel booking terbatas secara alami (hanya janji temu, 255 baris pada basis data ini), dan pemicu kelas pindai berjalan pada interval yang lebih longgar — lihat §4.7.

### 4.5 Aturan watermark

```
cursor_ts_baru = waktu_kejadian_maksimum_yang_terbaca   (bukan NOW())
query berikutnya memakai  >= cursor_ts   (bukan >)
```

Memakai `>=` berarti baris di batas akan terbaca ulang setiap siklus. Itu disengaja dan aman, karena kunci idempoten menolak duplikatnya. Alternatifnya, `>`, akan **kehilangan secara permanen** baris mana pun yang tercatat pada detik yang persis sama dengan cursor — kegagalan senyap yang jauh lebih buruk daripada sedikit pekerjaan berulang.

Memakai waktu kejadian maksimum yang terbaca, bukan `NOW()`, mencegah lubang saat SIMRS menulis baris dengan jam yang sedikit tertinggal dari jam server.

### 4.6 Zero-date MariaDB

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

### 4.7 Batas per siklus dan irama per kelas

Query poller memakai `LIMIT 200`. Bila satu siklus mengembalikan 200 baris penuh, watermark tetap maju dan siklus berikutnya melanjutkan sisanya.

Ini melindungi dari dua hal: pemasangan pertama kali (yang tanpa batas akan mencoba mengirim seluruh riwayat), dan pemulihan setelah layanan lama mati. Aturan basi di §6.3 yang kemudian membatalkan pesan yang sudah tidak relevan.

Angka itu **tidak seragam di seluruh query**, dan tidak boleh diseragamkan begitu saja: query yang melayani LAYAR (segmen broadcast, pencarian surat) punya batasnya sendiri karena yang membacanya manusia, bukan dispatcher. Yang mengikat cuma satu aturan — **batas yang tersentuh WAJIB terlihat**. Pada segmen broadcast angka "Cocok" yang menyentuh batas diberi peringatan terpotong, karena tepat pada angka itu ia berubah arti dari "jumlah yang cocok" menjadi "jumlah yang sempat terbaca". Pada `FARMASI_PENJUALAN` batas yang tersentuh **menghentikan siklus total** alih-alih sekadar mencatat peringatan: jendela yang terpotong mengembalikan sebagian nota yang ada, dan sisanya lalu terlihat persis seperti nota yang DIHAPUS — satu-satunya kesalahan di fitur itu yang mengirim pesan salah alih-alih tidak mengirim pesan.

Irama siklusnya dua angka, bukan satu per kelas:

| Siklus | Interval | Alasan |
|---|---|---|
| `poller:sisip` | `polling.interval_ms` — **60 detik** | range scan primary key, murah |
| `kontrol-terbit` | **60 detik**, satu-satunya kelas pindai yang begini | diukur **0,07 ms** sekali baca (`skdp_bpjs` bertambah hanya saat poliklinik menerbitkan surat), dan yang dibeli adalah pemberitahuan sampai semenit sesudah petugas menekan simpan — selaras dengan `QUEUE_REG`, yang memang jadi pembandingnya di mata orang |
| 13 siklus lain | `polling.scan_interval_ms` — **5 menit** | semuanya membaca ULANG jendela/keadaan tiap kali jalan |
| `BOOK_REMIND` | sekali sehari | `node-cron`, lihat §4.1 |
| `heartbeat` / `session-command` / `session-watchdog` | 30 dtk / 5 dtk / 60 dtk | daur hidup, bukan pemicu |

Pembatalan yang terlambat maksimum 5 menit masih jauh lebih baik daripada pasien datang ke rumah sakit dengan sia-sia. Menaikkannya menjadi 60 detik berarti memindai penuh 1.440 kali sehari demi keuntungan yang tidak terasa oleh siapa pun.

**Tiap fitur mendapat `loop()` sendiri, tidak pernah digabung** — dan itu bukan kerapian. Sakelarnya terpisah, jadi satu siklus gabungan yang gagal pada setengah pertamanya akan menghentikan setengah yang satunya: fitur yang DIMATIKAN rumah sakit bisa menjatuhkan fitur yang dinyalakannya. `loop()` menangkap galat per siklus supaya satu kegagalan tidak merambat.

### 4.8 Penjaga rencana query

Semua analisis di §4.4 tidak berguna bila suatu saat ada yang menulis `WHERE tgl_registrasi >= …` karena tampak lebih jelas dibaca. Perubahan seperti itu tidak menghasilkan error, tidak menggagalkan uji, dan tidak terlihat saat peninjauan kode — hanya membuat query 11.000 kali lebih mahal secara diam-diam.

Karena itu rencana query diperlakukan sebagai uji regresi:

```bash
npm run verify:plans
```

Skrip menjalankan `EXPLAIN` pada setiap query poller dan **gagal** bila ada baris dengan:

- `type: ALL` pada tabel yang tidak diberi izin pindai penuh
- `key: NULL`
- `rows` melampaui ambang yang ditetapkan per pemicu

Dijalankan di Fase 0 dan setiap kali query poller disentuh. Ini satu-satunya cara kendala kinerja bertahan melewati pergantian orang yang mengerjakannya. Sekarang **56 pemeriksaan terdaftar, 239 baris EXPLAIN diperiksa**.

**Izin pindai penuh diberikan per TABEL, bukan per query.** `PlanCheck.allowFullScan` berisi ALIAS sebagaimana muncul di kolom `table` milik EXPLAIN (`b`/`d`/`p0`/`sks`), bukan nama tabel aslinya. Bentuk lamanya `boolean`, dan itu terlalu tumpul dalam dua arah sekaligus: satu query menyentuh banyak tabel, jadi mengizinkan pemindaian pada SATU di antaranya berarti berhenti menjaga SEMUANYA — query jadwal dokter menyentuh tiga tabel padahal yang memang kecil cuma `dokter`. Izinnya kini menggugurkan tepat dua pemeriksaan yang jadi tidak berlaku (`type=ALL` dan `key=NULL`) sementara **`maxRows` tetap ditegakkan untuk semua** — justru pada tabel yang boleh dipindai penuh itulah asumsi "tabel ini kecil" perlu gagal berisik saat ternyata keliru. Pada bentuk lamanya `maxRows` bahkan tidak pernah benar-benar jalan: pemeriksaannya keburu dilewati `continue`, jadi jaring pengaman yang tertulis di komentarnya sebenarnya tidak ada.

Izin yang berlaku sekarang ada **sembilan**, dan alasannya berbeda-beda — menyalin satu izin ke query baru karena "aman kalau ada" adalah persis cara izin menganggur mulai menutupi kemunduran berikutnya:

| Tabel (alias) | Alasan | Akan hilang sendiri? |
|---|---|---|
| `booking_registrasi` (`b`) | kelas pemicunya memang pindai | tidak |
| `referensi_mobilejkn_bpjs_batal` (`b`) | prefiks `nobooking` menyandikan tanggal JANJI, bukan tanggal PEMBATALAN — terukur 144 dari 1.808 dibatalkan SESUDAH hari janjinya, sampai 105 hari. Yang membuatnya bisa diterima adalah LAJU TUMBUHNYA (~2,8 baris/hari), bukan ukurannya hari ini | tidak |
| `bridging_surat_kontrol_bpjs` (`sk`) | PK-nya memuat tanggal sebagai `MMYY` di tengah string — tidak terurut leksikal antar tahun, jadi tidak bisa jadi pemangkas sama sekali. Diterima karena jalannya sekali sehari (~35 ms) | tidak |
| `skdp_bpjs` (`s`) | `tahun` diturunkan dari `tanggal_datang` sementara jendelanya `tanggal_rujukan`; selisihnya terukur −57 sampai +309 hari | tidak |
| `dokter` (`d`) | tabel konfigurasi — barisnya sebanyak (dokter × hari praktik), tidak tumbuh seiring jumlah pasien | tidak |
| `databarang` (`b`) ×2 | katalog; pencariannya `LIKE '%…%'` yang tidak bisa dilayani indeks B-tree mana pun | tidak |
| `pasien` (`p0`) ×2 | tumbuh, tapi satu baris per PASIEN dan query-nya jalan sekali tiap staf menekan Terapkan — bukan berulang di latar | tidak |
| `permintaan_lab` (`pm`) | **sementara**: query-nya BENAR dan memakai indeks pada volume nyata, tapi optimizer memilih pindai penuh selagi tabelnya kecil. Dibuktikan dengan query yang SAMA terhadap dua database — 74 baris → `type=ALL`, 4.636 baris → `range no_rawat` | ya |
| `surat_keterangan_sehat` (`sks`) | **sementara**, sebab yang sama: tabelnya kosong di sini | ya |

Dua izin terakhir itulah alasan `maxRows` yang jadi penjaga sebenarnya, bukan daftar izinnya.

**Satu jebakan yang membuat pemeriksaan gagal untuk query yang justru paling murah:** baris EXPLAIN dengan `table = NULL` **bukan** pemindaian penuh melainkan kebalikannya — "Impossible WHERE noticed after reading const tables", "Select tables optimized away", yaitu optimizer sudah membuktikan hasilnya tanpa membaca apa pun. Dulu `type ?? 'ALL'` membacanya sebagai full scan. Ketahuan lewat query pencarian no. pendaftaran, yang nilai contohnya memang sengaja tidak ada di database mana pun — dan **nilai contoh yang tidak cocok dengan data nyata adalah keadaan NORMAL untuk pemeriksaan rencana**, bukan kekecualian.

**Modul `khanza/` yang tidak terdaftar di `khanza/index.ts` TIDAK PERNAH diperiksa.** Pendaftarannya efek samping impor, jadi lupa menambahkannya ke barrel tidak menghasilkan satu pun galat — cuma pemeriksaan yang diam-diam tidak berjalan.

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

#### Kekecualian yang membalik premis di atas, dan syaratnya

Kalimat "tanpa memandang daftar" di atas berlaku penuh sejak Fase 0 sampai `migrations/026`, dan **sudah tidak lagi mutlak**. Dua fitur membacanya dengan sengaja:

| Fitur | Yang dibaca | Migrasi |
|---|---|---|
| `administrasi.sertakan_diagnosa` | kode ICD + nama penyakit dari `diagnosa_pasien`+`penyakit` | 026 |
| DOKUMEN HASIL | angka hasil `detail_periksa_lab` berikut nilai rujukannya, narasi `hasil_radiologi`, nama obat pada rincian nota | 038 |

**Yang membenarkannya cuma satu hal, dan ia tidak bisa diganti alasan lain: penerimanya pasien itu sendiri**, yang memang berhak atas hasilnya. Larangan §5.2 lahir dari pesan yang bisa terbaca ORANG LAIN — pesan yang salah kirim, pesan yang tampil di layar kunci, salinan ke grup. Ia sama sekali tidak melarang seorang pasien memegang hasil pemeriksaannya sendiri.

Karena alasannya sesempit itu, ada satu aturan yang ditegakkan **KODE dan bukan pengaturan**: **lampiran tidak pernah ikut ke salinan grup**, apa pun `tujuan_mode` di `/template`. `enqueuePemicuPasien()` memasang `media: null` eksplisit pada tiap tujuan tambahan. Ini satu-satunya perlindungan di sana yang TIDAK terjadi dengan sendirinya — daftar tolak, jam tenang, dan penggantian poli sensitif semuanya akibat dari bentuk `enqueueMessage`, sementara `...input` dengan senang hati menyalin berkasnya ke tiap grup. Tanpa baris itu, satu centang di `/template` mengubah hasil laboratorium seorang pasien menjadi berkas yang diterima setiap anggota sebuah grup.

Empat pagar lain yang menempel, dan semuanya konsekuensi dari alasan yang sama:

- **Ketiga sakelarnya default MATI**, terpisah per kelas data (angka lab, narasi radiologi, rincian obat pada nota) — karena jawaban rumah sakit wajar berbeda untuk ketiganya.
- **Poli sensitif MENOLAK, tidak diganti template generik** — mengganti kalimat pengantar tidak menyembunyikan apa pun selama lampirannya ikut.
- **`pasien.no_ktp` tetap tidak pernah diambil**, walau `rptPeriksaLab` milik Khanza mencetaknya: nomor identitas nasional di dalam berkas yang diteruskan tanpa batas adalah bahan pencurian identitas, dan ia tidak menambah apa pun bagi pasien yang sedang membaca hasilnya sendiri.
- **Nama berkas tidak memuat nama pasien** — nama berkas justru bagian yang paling kelihatan, muncul di daftar chat dan pratinjau notifikasi layar kunci sebelum siapa pun membukanya.

Di luar kedua fitur itu, larangan §5.2 berlaku utuh — dan pada beberapa pemicu ia bahkan lebih ketat daripada sekadar "tidak di-SELECT". Pada rekap resep harian (042) `reg_periksa` dan `pasien` **tidak ikut dalam query sama sekali**: bukan "dibaca lalu tidak ditampilkan", melainkan tidak ada jalan apa pun dari query itu menuju seorang pasien. Pada rekap asesmen awal (044) tanda vital dibaca sebagai `TRIM(p.td) <> ''` — sebuah **boolean**, sehingga query-nya mengetahui tekanan darah sudah dicatat tanpa pernah mengetahui berapa angkanya.

**Cara membuktikannya bukan dengan membaca SQL, melainkan memeriksa `Object.keys()` baris hasilnya.** Skrip `dryrun:penjualan`, `dryrun:resep`, dan `dryrun:penilaian` melakukan itu dan **keluar dengan kode 1** bila ada kolom terlarang yang menyelinap masuk. Keduanya dibuktikan MENGGIGIT dengan menambahkan kolom pasien ke daftar SELECT dengan sengaja, bukan diasumsikan.

**Satu kolom teks bebas dibuka, dan bentuk pagarnya layak dicatat karena ia BUKAN penyaring.** `penjualan.keterangan` — kotak Keterangan yang diketik kasir — dibaca sejak pemilik sistem memintanya sebagai `{keterangan}`. Terukur, isinya kosakata pendek pada hampir seluruh baris (98,8% dari yang terisi cuma penanda `-` milik Khanza), tapi di antara 84 baris yang benar-benar terisi ada nama orang dan catatan klinis. Tidak ada satu pun cara kode membedakan keduanya, jadi yang menahan adalah **tempat ia dibaca**, bukan isinya: hanya lewat query yang jalan untuk nota yang sudah lolos dedup dan kuota (bukan jendela pindai yang membaca ratusan baris tiap siklus), tidak pernah pada agregat rekap harian, dan tetap lewat `sanitizeValue()` karena `{keterangan}` sengaja bukan anggota `MULTILINE_VARIABLES`. `dryrun:penjualan` memeriksanya **dua arah** — ada di tempat yang benar, tidak ada di kedua tempat yang salah — karena kolom yang diam-diam hilang dari daftar SELECT menghasilkan variabel kosong selamanya tanpa satu pun galat.

### 5.3 Template (`core/template.ts`)

Penggantian variabel sederhana `{nama_variabel}`. Tanpa logika percabangan, tanpa perulangan, tanpa evaluasi ekspresi.

Alasannya keamanan: template dapat diubah dari dashboard oleh petugas. Bahasa template yang bisa mengevaluasi ekspresi berarti memberi jalan mengeksekusi kode kepada siapa pun yang bisa masuk dashboard.

Variabel yang tidak dikenal menyebabkan penyimpanan template ditolak, bukan menghasilkan string kosong saat kirim. Kesalahan harus muncul saat petugas menyunting, bukan saat pasien menerima pesan aneh.

Penggantian **wajib satu lintasan**, dan setiap nilai yang berasal dari `sik` dibersihkan lebih dulu. Alasannya bukan kerapian melainkan keamanan — lihat §9.2.

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

Laju rendah menangani separuh masalah. Separuh lainnya adalah **isi yang identik**: puluhan pesan `QUEUE_REG` dalam satu pagi hanya berbeda di nama dan nomor antrian, dan broadcast tanpa `{nama_pasien}` bisa sama persis karakter per karakter untuk ratusan pasien. Karena itu setiap pesan mendapat kode singkat di baris terakhir (`src/core/uniqueCode.ts`, default `Ref: {kode}`).

Kodenya **diturunkan dari `idempotency_key`, bukan acak**, dan disisipkan saat **ENQUEUE** (langkah [8]) alih-alih saat SEND (langkah [10]). Dua konsekuensi yang keduanya disengaja:

- Percobaan kirim ulang (§6.4) mengirim **teks yang sama persis**. Kode acak akan membuat percobaan kedua tampak sebagai pesan baru — baik bagi pasien maupun bagi WhatsApp — persis kebalikan dari yang diinginkan.
- `outbox.body` tetap sama dengan yang benar-benar terkirim, sehingga halaman Log dan jejak audit menunjukkan teks sungguhan, dan kode yang disebut pasien lewat telepon bisa dicari langsung (`outbox.body LIKE '%KODE%'`) tanpa kolom tambahan.

Alfabetnya Crockford Base32 (32 karakter tepat — tanpa bias modulo — dan tanpa I, L, O, U, jadi 0/O maupun 1/I/L tidak bisa tertukar saat dibacakan lewat telepon).

`FOR UPDATE SKIP LOCKED` didukung MariaDB 10.4 dan menjaga kebenaran seandainya kelak ada lebih dari satu dispatcher. Saat ini hanya satu, tetapi biayanya nol dan menghilangkan seluruh kelas bug balapan.

### 6.2 Jam tenang

Default 21.00–07.00 WIB tidak mengirim. Pesan **ditahan**, bukan dibuang: `scheduled_at` dimajukan ke pukul 07.00 berikutnya.

Dikecualikan dari penahanan: **dua belas kode pemicu**, dan alasannya berbeda-beda. Daftarnya di `core/quietHours.ts`'s `BYPASS_QUIET_HOURS`; yang penting dipahami adalah bahwa hanya ada TIGA alasan yang sah, dan pemicu baru harus masuk lewat salah satunya:

| Alasan | Pemicu | Isinya |
|---|---|---|
| **Ada orang yang sedang menunggu** | `BOOK_CANCEL`, `AUTO_REPLY`, `ADMINISTRASI`, `FARMASI_UJI`, `WA_PERINTAH` | pemberitahuan dokter berhalangan untuk jadwal besok pagi harus sampai malam itu juga; balasan atas pesan yang pasiennya kirim barusan; berkas yang diminta pasien yang sedang di loket; pesan uji yang stafnya berdiri menunggunya muncul di grup; langkah berikutnya dari wizard yang stafnya baru saja mulai — dan sesinya sendiri kedaluwarsa dalam 10 menit, jadi menahannya sampai 07.00 bukan memperlambat melainkan membuat fiturnya MUSTAHIL dipakai sepuluh jam setiap hari |
| **Penerimanya STAF, bukan pasien** | `FARMASI_VALIDASI`, `FARMASI_PENYERAHAN`, `BPJS_BATAL` | jam tenang melindungi orang yang tidur di rumah, bukan shift malam yang justru menunggu pesan ini — dan menahannya membuat seluruh resep semalam menumpuk lalu terkirim serentak pagi hari, persis pola beruntun yang memicu deteksi spam |
| **Jamnya DIPILIH STAF SENDIRI** | `FARMASI_STOK_DARURAT`, `FARMASI_PENJUALAN_REKAP`, `FARMASI_RESEP_REKAP`, `ERM_PENILAIAN_UMUM` | menundukkannya pada jam tenang berarti diam-diam mengabaikan jam yang baru saja mereka setel |

Alasan ketiga adalah yang paling gampang terlewat, dan lubangnya tidak bergejala: jam tenang bawaan mulai **21:00** sementara rekap resep berjam bawaan **22:00**, jadi tanpa pengecualian itu ia tertahan sampai 07:00 keesokan hari **setiap hari, pada setelan bawaannya sendiri** — rekap "hari ini" yang selalu tiba besok paginya, tanpa satu pun galat. `ERM_PENILAIAN_UMUM` sempat tertinggal dari daftar ini lewat sebab yang sama: kedua slot bawaannya (13:00, 19:30) kebetulan di luar jam tenang, sehingga ia bekerja benar apa adanya sementara slot 21:30 yang sah menurut fiturnya sendiri akan hilang diam-diam. Ketiga rekap itu dipatok bersama-sama di `quietHours.test.ts` — yang dijaga bukan nilai masing-masing melainkan bahwa ketiganya SAMA.

**Yang sengaja TIDAK dikecualikan, dan itu keputusan bukan kelalaian:** keempat pemicu nota barang (`FARMASI_PENGADAAN`, `FARMASI_PEMESANAN`, `FARMASI_HIBAH`, `FARMASI_PENJUALAN`). Penerimanya memang grup gudang yang sama, tapi pembedanya bukan penerimanya melainkan **siapa yang memilih waktunya** — pada nota, waktunya ditentukan kapan kasir kebetulan menekan simpan, jadi argumen "setelan yang baru saja dibuat" tidak berlaku dan tidak bisa dipinjam ke sana. Terukur, ia nyaris tidak pernah menggigit: penjualan berhenti pukul 20:00, dan tidak satu pun dari 910 faktur pengadaan tersimpan lewat pukul 20:00. Perlu diketahui bahwa komentar di keempat runner-nya sempat berbunyi "jam tenang dilewati" — kalimat yang keliru terhadap perilakunya sendiri. Keempatnya sedang MENYALA di produksi, jadi mengubah perilakunya sebagai efek samping pekerjaan lain adalah persis kejutan yang tidak boleh datang; ini keputusan pemilik sistem.

Pengecualian dicatat **pada kode pemicu, bukan pada isi pesan**, dan itulah yang membuat satu berkas yang sama bisa tunduk atau tidak tergantung siapa yang mengirimnya: surat sakit yang dikirim staf berkode `ADMINISTRASI` (dikecualikan) sementara yang dikirim otomatis berkode `SURAT_SAKIT` (tunduk). Menumpangkan keduanya pada satu kode memaksa keduanya sama, dan salah ke arah mana pun.

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

### 7.1 Tiga mekanisme yang menopang diagram di atas

Diagram itu benar dan **tidak cukup**. Ia menggambarkan sesi yang sehat; tiga mekanisme berikut ada karena masing-masing menutup satu mode kegagalan nyata yang sudah terjadi di produksi. Prosedur pemulihannya ada di CLAUDE.md dan `RUNBOOK.md`; yang dituliskan di sini keputusan desainnya, karena itu yang perlu diketahui sebelum menyentuh startup worker.

**(a) Instance tunggal dijaga KUNCI PORT, bukan berkas kunci** (`worker/singleInstance.ts`, `WORKER_LOCK_PORT` default 3101), dipanggil **paling awal** di `main()` — sebelum database, sebelum Chromium, karena yang diperebutkan adalah direktori sesi sehingga yang kalah harus tahu sebelum menyentuhnya.

Port dilepas sistem operasi saat proses mati, **termasuk SIGKILL dan listrik padam**; berkas kunci berisi pid meninggalkan kunci basi sesudah kematian mendadak — dan kematian mendadak justru mode kegagalan paling sering di sini. Soketnya sekalian jadi jalur permintaan mundur.

Yang kalah **MEMINTA pemegangnya mundur** — bukan keluar, dan bukan sekadar menunggu. Keduanya salah di ujung yang berbeda: keluar adalah persis yang memberi makan loop `autorestart` PM2; sekadar menunggu membuat PM2 melacak si PENUNGGU sementara pemegang sesi jadi yatim, sehingga `pm2 restart` berikutnya hanya mengganti penunggunya dan **kode baru tidak pernah benar-benar dijalankan** — kegagalan yang lebih senyap daripada loop yang berisik. Pemegang yang mundur WAJIB lewat `shutdown()`, bukan `process.exit()`, kalau tidak ia meninggalkan state sesi setengah tertulis untuk yang mengambil alih.

Ini **bukan** pelanggaran "kedua proses tidak pernah berkomunikasi lewat HTTP" (§1): aturan itu tentang koordinasi APLIKASI (antrean pesan, status sesi) yang tetap sepenuhnya lewat tabel. Yang lewat sini cuma satu kata kendali daur hidup, antara dua instance worker yang sama, di loopback.

**Kode keluarnya harus SELAMAT sampai ke PM2.** Yang mundur keluar dengan **75**, yang terdaftar di `stop_exit_codes` supaya tidak dinyalakan ulang. `main().catch()` yang memanggil `process.exit(1)` menimpanya — dan pernah menimpanya sungguhan, sehingga tiap pemegang yang mundur justru dilahirkan kembali lalu mengusir penggantinya, tanpa akhir. Perlu diketahui juga bahwa **`pm2 restart` TIDAK membaca ulang `ecosystem.config.js`**: `stop_exit_codes` yang tertulis di berkas tapi tidak ada di proses berjalan adalah keadaan yang mungkin, dan hanya `pm2 delete` + `pm2 start` yang memperbaikinya.

**(b) `ready` TIDAK berarti halamannya bisa mengirim.** whatsapp-web.js menaruh objek pembantunya, `window.WWebJS`, ke dalam halaman lewat `Client.inject()`. Objek itu **dihapus setiap kali frame bernavigasi** dan disuntikkan ulang secara ASINKRON, tanpa satu pun event yang menandainya. Di sela itu `sendMessage()` gagal dengan `Cannot read properties of undefined (reading 'getChat')` — yang undefined bukan chat-nya, melainkan seluruh objek suntikan.

| Sinyal | Yang dibacanya | Melihat celahnya? |
|---|---|---|
| `isWaReady()` | baris `wa_session` yang ditulis saat event READY | tidak — keadaan HISTORIS |
| `checkHealth()` → `getState()` | modul milik WhatsApp SENDIRI | tidak — selamat dari navigasi |
| `window.WWebJS` | objek suntikan whatsapp-web.js | inilah yang hilang |

Akibatnya bukan satu baris log: tiap kejadian menghabiskan satu dari hanya tiga percobaan (`core/retry.ts`), dan startup justru saat antrean paling menumpuk — tiga kali seperti itu menandai notifikasi pasien `failed_permanent`. Penawarnya `tungguHalamanSiap()` yang menjajaki `window.WWebJS` langsung ke halaman, plus `galatHalamanBelumSiap()` yang memisahkan "belum sempat mencoba" dari "sudah dicoba dan gagal" — yang pertama TIDAK menaikkan `attempts` dan TIDAK menulis `send_log`. **Probe yang tidak bisa dijalankan dianggap SIAP, bukan sebaliknya**: gagal-tertutup berarti dispatcher berhenti mengirim selamanya tanpa satu pun galat kalau bentuk pustakanya berubah.

**(c) `sessionWatchdog()` keluar bila sesi di luar `ready` lebih dari 15 menit**, dan PM2 menyalakan ulang. Pemeriksaan kesehatan yang lama berhenti lebih dulu (`if (!isWaReady()) return`) — ia hanya menjaga sesi yang SUDAH siap dari Chromium yang menggantung, bukan sesi yang tidak pernah sampai siap. Sesi tersangkut `authenticating` karena itu pernah membuat sistem mati **14 jam** sementara PM2 melaporkan `online`. Tiga hal yang menempel:

- **`qr_pending` sengaja dikecualikan** — itu bukan macet melainkan sistem yang benar sedang menunggu manusia memindai QR, dan restart di tengahnya justru mengedaluwarsakan kode yang sedang dipindai petugas.
- **15 menit, bukan 5, dan itu pengamatan bukan kehati-hatian**: penautan ulang yang terlalu sering tampaknya membuat WhatsApp memperlambat sinkronisasi. Watchdog yang menyala tiap 5 menit akan menjadi sumber masalahnya sendiri alih-alih pemulihannya.
- **Keluarnya WAJIB lewat `shutdown()`** — versi pertamanya `process.exit()` langsung, dan itu meninggalkan state sesi setengah tertulis sehingga proses penggantinya menggantung di `authenticating`: pemulihan yang justru menciptakan kegagalan berikutnya. `shutdown()` juga memberi `destroy()` batas waktunya sendiri, karena sebagian pemanggilnya keluar JUSTRU karena Chromium menggantung.

**Yang membocorkan proses mati bukan `status`, melainkan umur `heartbeat_at`.** `wa_session.status` tetap `ready` sepanjang gangguan, karena baris itu ditulis proses yang sudah mati dan tidak ada yang membatalkannya. Karena itu denyutnya ditulis **TANPA SYARAT** — sebelumnya digerbangi `isWaReady()`, sehingga membeku juga saat sesi terputus padahal prosesnya sehat, dan "basi" tidak bisa dibedakan dari "sesi bermasalah". Sekarang artinya tunggal: **basi = tidak ada proses worker yang hidup.**

---

## 8. Penanganan Berhenti Berlangganan

Worker memasang pendengar pesan masuk, dan pemeriksaan frasa berhenti berjalan **paling dulu** — aturan balasan otomatis yang keliru ditulis staf tidak boleh bisa menyandera permintaan berhenti berlangganan.

```
pesan masuk MEMUAT frasa "Berhenti Kirim Otomatis" (tak peduli huruf besar/kecil)
  → INSERT INTO opt_out (phone_e164, source='reply')
  → balas satu kali konfirmasi
  → outbox 'pending' ke nomor itu, TERBATAS pada pemicu yang terikat,
    ditandai 'skipped_opt_out'
```

**Frasanya tiga kata, bukan satu, dan justru karena panjang ia boleh dicocokkan sebagai BAGIAN dari kalimat** (`migrations/011`). Pola lama `^(stop|berhenti|unsubscribe)$` terpaksa ketat karena satu kata seperti "berhenti" gampang muncul di kalimat biasa — akibatnya `"stop dong"` dan `"saya mau berhenti"` TIDAK berhenti padahal maksud pasiennya jelas. Frasa sepanjang ini praktis mustahil terketik tanpa sengaja, jadi pencocokan yang lebih longgar justru lebih aman **sekaligus** lebih memaafkan. Konsekuensi yang harus disadari: **`STOP` polos tidak lagi memberhentikan apa pun** — ia jatuh ke pencocokan balasan otomatis seperti pesan biasa.

**Cakupannya sengaja SEMPIT, dan itu keputusan rumah sakit yang ditulis sebagai daftar.** Yang terikat hanya pemicu otomatis KE PASIEN — 15 kode di `OPT_OUT_TRIGGERS`, termasuk `RESULT_READY` sebagai peninggalan supaya baris yang terlanjur mengantre dengan kode lama tetap tercoret. `BROADCAST` dan `AUTO_REPLY` sengaja TIDAK terikat: yang pertama pengumuman yang disusun staf lewat kanal berbeda, yang kedua jawaban atas pesan yang pasiennya sendiri kirim barusan — mendiamkan orang yang baru saja bertanya bukan menghormati permintaannya, melainkan membuat sistem tampak rusak. Pemicu yang tidak terdaftar dianggap **tidak terikat**, karena default "terikat" akan membuat kanal baru diam-diam berhenti terkirim tanpa ada yang memutuskan.

`respectsOptOut()` adalah SATU-SATUNYA sumber kebenarannya, dipakai di tiga tempat: `enqueueMessage()`, dispatcher (pemeriksaan kedua sebelum kirim, §9.8), dan pencoretan antrean saat permintaan berhenti masuk. Pencoretan itu **WAJIB menyertakan `triggerCode`** — tanpanya, broadcast dan balasan otomatis yang kebetulan sedang mengantre ikut tercoret, sehingga cakupannya bergantung pada kebetulan waktu.

**Teks yang dibaca pasien tidak boleh menjanjikan lebih luas dari yang dijalankan mesin — maupun lebih sempit.** Tiga tempat harus tetap sepakat: `OPT_OUT_CONFIRMATION` di `wa-client.ts`, isi template pemicu, dan keterangan halaman `/daftar-tolak`. Arah "lebih sempit" pernah terjadi dan sama salahnya: teks konfirmasi menyebut "pengingat kontrol BPJS" sementara sejak `migrations/032` ada DUA pemicu pengingat kontrol yang terikat, sehingga pasien non-BPJS wajar menyimpulkan pengingatnya tidak ikut berhenti lalu mengeluh justru saat sistemnya bekerja benar.

**Pesan masuk lain TIDAK lagi diabaikan**, dan itu keluar dari premis satu-arah PRD §3 lebih jauh daripada broadcast. Sejak `migrations/010` ada `/balasan-otomatis` (kata kunci, bukan AI) dan sejak `019`/`039` ada balasan stok serta pertanyaan ketersediaan. Yang menahannya: **`autoreply.enabled` dan `farmasi.stok_mode` keduanya default MATI**, jawaban yang tidak cocok default DIAM (pesan cadangan kosong), dan isi tiap aturan seluruhnya ditulis staf atau dibaca apa adanya dari `sik.jadwal` — sistem ini tidak pernah menyusun kalimat medis sendiri. Tanggung jawab klinis atas isi aturan tetap berada di luar perangkat lunak ini; yang berubah adalah bahwa sekarang ada tempat bagi rumah sakit untuk menaruhnya, bukan bahwa perangkat lunaknya mengambil alih.

### 8.1 Pesan masuk yang MENULIS (`migrations/045`)

Keempat jalur masuk di atas punya satu sifat bersama yang gampang terlewat karena tidak pernah perlu disebut: **tidak satu pun mengubah cara sistem ini berperilaku**. Permintaan berhenti menulis `opt_out` — catatan tentang satu nomor; balasan stok, rekap darurat, dan pencocokan aturan seluruhnya membaca.

`/tambah-jawaban-otomatis` dan saudaranya memutus sifat itu: ia menulis `auto_reply_rule`, yaitu baris yang menentukan **apa yang dikatakan nomor rumah sakit kepada pasien**. Karena itu ia berdiri sebagai jalur tersendiri, bukan cabang di dalam balasan otomatis:

```
pesan masuk
  → frasa berhenti?            (paling dulu, tak pernah bisa disandera)
  → PERINTAH?                  ← wa_command_admin + autoreply.wa_perintah_enabled
       ya  → wizard bertahap, keadaannya di wa_command_session
       tdk → handleInboundMessage (persediaan → aturan kata kunci)
```

Urutannya mengikat. **Sebelum `handleInboundMessage`, bukan di dalamnya**, karena sakelarnya berdiri sendiri dari `autoreply.enabled` — rumah sakit harus bisa menyusun aturannya lewat WhatsApp sebelum menyalakan balasan otomatis, dan di dalam fungsi itu ia mati bersamanya pada baris pertama. Akibatnya ia juga mendahului cabang persediaan, yang selalu menjawab begitu kata kuncinya kena dan akan menelan isi balasan yang kebetulan menyebut "harga".

Tiga hal yang membedakannya dari setiap penangan pesan masuk lain, dan ketiganya berakar pada satu fakta: **ini percakapan bertahap pertama di sistem yang seluruh penangannya tidak punya ingatan.**

| | Kenapa perlu | Tanpanya |
|---|---|---|
| `last_wa_id` + kunci idempoten | whatsapp-web.js menyerahkan ulang pesan lama tiap sesi dipulihkan | satu restart worker memajukan wizard beberapa langkah dengan jawaban kemarin |
| batas waktu sesi (`autoreply.wa_sesi_timeout_menit`) | wizard boleh ditinggalkan di tengah | sesi menelan SETIAP pesan berikutnya dari orang itu selamanya |
| kunci `(chat_id, pengirim_id)` | grup punya banyak peserta | kalimat siapa pun yang mengetik di grup jadi nama aturan atau isi balasan |

Wewenangnya dibaca dari `wa_command_admin` — daftar putih TERSENDIRI, bukan `farmasi_target.boleh_tanya`. "Boleh menanyakan stok" dan "boleh mengubah apa yang dikatakan RS kepada pasien" adalah dua wewenang yang beratnya sama sekali berbeda; menggabungkannya berarti setiap grup apotek ikut mendapat wewenang kedua tanpa seorang pun memutuskannya. Alamat yang tidak terdaftar **didiamkan**, bukan dijawab "Anda tidak berwenang" — menjawabnya memberi tahu setiap pasien yang mengetik garis miring bahwa perintah semacam ini ada.

Validasinya sama persis dengan `/balasan-otomatis` (nama unik, kata kunci minimal dua huruf, variabel tak dikenal ditolak). Kalau berbeda, WhatsApp menjadi jalan pintas yang melewati pagar yang ditegakkan dashboard — dan `{nama_pasien}` yang lolos di sana adalah keputusan privasi §5.2 yang dibatalkan diam-diam. Satu pemeriksaan justru DITAMBAHKAN: panjang label ≤ 80, karena kolomnya VARCHAR(80) dan MariaDB non-strict memotongnya tanpa galat sementara kotak di peramban punya `maxLength` dan WhatsApp tidak punya kotak.

Aturan baru lahir **nonaktif** kecuali `autoreply.wa_tambah_aktif_langsung` dinyalakan. Itu bukan kehati-hatian melainkan jawaban atas pertanyaan yang belum dijawab rumah sakit — siapa yang meninjau bahwa isi tiap aturan benar secara klinis. Selama mati, jawabannya "orang yang membuka dashboard lalu mencentang aktif"; dinyalakan, jawabannya menjadi "tidak ada".

**`/bantuan` menerangkan keadaan, dan bagian kemampuannya dibaca PER-ALAMAT.** Ia satu-satunya tempat orang yang mengatur balasan otomatis lewat WhatsApp bisa melihat konfigurasinya; boleh menyebutkannya karena yang sampai ke sana selalu alamat berwenang. Dua fakta di dalamnya tidak punya jalan lain untuk dilihat dari WhatsApp, dan tanpanya aturan yang benar terlihat persis seperti aturan yang gagal: `autoreply.enabled` yang mati membuat SETIAP aturan diam termasuk yang bertanda aktif, dan nasib aturan baru menentukan apakah yang barusan diketik sudah menjawab pasien atau menunggu dicentang.

Bagian "apa lagi yang bisa ditanyakan" tunduk pada pemisahan daftar putih di atas, dan pemisahan itu justru yang membuatnya perlu dijaga. Nomor rumah sakit menjawab beberapa hal lewat daftar yang berbeda-beda; bantuan yang menyebut kemampuan secara umum menyuruh seseorang mengetik "stok paracetamol" saat alamatnya tidak ada di daftar satunya — ia mengetik apa yang disuruh, tidak terjadi apa-apa, dan tidak ada satu pun galat yang menyebut sebabnya, karena memang tidak ada yang salah selain alamatnya. Izinnya karena itu dibaca lewat `izinTanyaStok()`/`izinTanyaDarurat()` yang **diekspor dari `stokReply.ts` dan dipakai gerbangnya sendiri**, bukan penurunan kedua di sisi bantuan; alamat yang belum berhak diberi tahu sebabnya berikut jalan keluarnya, bukan didiamkan (yang didiamkan adalah alamat tak berwenang atas PERINTAH, dan itu keputusan berbeda).

Setiap pesan keluar menyertakan cara berhenti sebagai kalimat penutup isi pesannya. Selain kewajiban etis, ini juga pengaman praktis: pasien yang tidak punya cara berhenti akan menekan **"Laporkan spam"** di WhatsApp — dan cukup beberapa laporan untuk memblokir nomor rumah sakit.

Sejak kode unik ditambahkan (§6.1), baris paling akhir secara harfiah adalah `Ref: <kode>`, bukan kalimat berhentinya. Ini disengaja dan tidak menggeser prioritas: kalimat berhenti tetap menutup **prosa** yang dibaca pasien, sementara kode adalah satu baris metadata pendek di bawahnya. Menaruh kode di atas isi pesan akan membuat kalimat pertama yang dibaca pasien tampak seperti sampah otomatis — justru memperbesar peluang dilaporkan sebagai spam.

---

## 9. Keamanan

### 9.1 Ringkasan lapisan

| Lapis | Penanganan |
|---|---|
| Database `sik` | Pengguna terpisah dengan hak `SELECT` saja. Diverifikasi saat proses mulai — worker menolak jalan bila ternyata bisa menulis |
| Database `wakhanza` | Pengguna terpisah, tanpa akses ke `sik` sama sekali |
| Dashboard | NextAuth wajib, tanpa halaman publik selain `/login` |
| Peran | `admin` boleh mengubah pengaturan & pengguna; `operator` hanya kirim ulang dan koreksi nomor |
| Audit | Setiap perubahan template, koreksi nomor, kirim ulang, dan penambahan opt-out tercatat beserta pelakunya |
| Jaringan | Dashboard mengikat ke `127.0.0.1`. Tidak boleh terekspos ke internet |
| Rahasia | `.env` dan `.wwebjs_auth/` di luar git, dengan izin berkas dibatasi |
| Log | pino dengan penyamaran nomor telepon. Nama pasien tidak pernah masuk log |

### 9.2 Penyuntikan lewat template

Ancaman yang paling mudah terlewat, karena datang dari data yang tampak tidak berbahaya.

`nm_pasien` berasal dari `sik.pasien` dan diisi petugas pendaftaran. Kolomnya `varchar(40)` tanpa pembatasan isi. Bila mesin template melakukan penggantian berulang sampai tidak ada lagi yang cocok, pasien bernama `{kontak_rs}` akan membuat nomor telepon rumah sakit muncul di tempat namanya seharusnya berada. Nama yang disusun lebih cermat dapat memindahkan variabel lain ke posisi yang menyesatkan.

**Penggantian wajib satu lintasan.** Template dipindai sekali dari kiri ke kanan; nilai yang sudah disisipkan tidak pernah dipindai ulang:

```ts
// BENAR — satu lintasan, hasil substitusi tidak diperiksa lagi
body.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');

// SALAH — perulangan sampai stabil membuat nilai ikut dievaluasi
while (/\{\w+\}/.test(out)) { /* ... */ }
```

Selain itu, nilai variabel dibersihkan sebelum masuk: karakter kendali dan pemisah baris berlebih dibuang, panjang dibatasi. Nama sepanjang 40 karakter berisi baris baru dapat dipakai memalsukan struktur pesan sehingga tampak seperti pengumuman resmi rumah sakit.

Pembatasan ini berlaku untuk **semua** nilai yang berasal dari `sik`, bukan hanya nama: `nm_poli` dan `nm_dokter` juga diisi manusia.

### 9.3 Autentikasi dashboard

**Biaya hashing.** apiwa memakai `bcryptjs` — implementasi JavaScript murni — dengan cost 12. Itu terbukti menahan event loop cukup lama sampai beberapa login berbarengan membuat endpoint autentikasi menggantung hingga timeout. Di wakhanza proses web juga melayani halaman lain, jadi masalah yang sama akan muncul.

Gunakan `bcrypt` dengan binding native (menjalankan hashing di thread pool libuv, bukan di event loop), atau `@node-rs/bcrypt`. Cost 12 tetap dipertahankan — yang diperbaiki tempat eksekusinya, bukan kekuatannya.

**Pembatasan percobaan masuk.** Tanpa itu, dashboard berisi data pasien dapat ditebak paksa dari dalam jaringan rumah sakit. Hitungan kegagalan per nama pengguna disimpan di database; setelah 5 kegagalan berturut-turut, akun terkunci 15 menit. Setiap penguncian tercatat di `audit_log`.

Pembatasan berdasarkan nama pengguna, bukan alamat IP — di rumah sakit banyak komputer berbagi satu IP melalui NAT, sehingga pembatasan per IP akan mengunci seluruh loket sekaligus.

**Cookie sesi.** NextAuth dengan `httpOnly`, `sameSite: 'lax'`, dan `secure` bila TLS aktif. Masa sesi 8 jam — satu giliran kerja — bukan 30 hari seperti apiwa. Komputer loket dipakai bergantian banyak orang.

### 9.4 Transport dashboard

Ini kelemahan yang harus disebut terang-terangan: **jaringan rumah sakit bukan jaringan tepercaya.**

Dashboard yang disajikan lewat HTTP polos di LAN mengirimkan cookie sesi dan nama pasien dalam bentuk terbaca oleh siapa pun yang dapat mengamati lalu lintas jaringan.

Urutan pilihan, dari yang terbaik:

1. Ikat ke `127.0.0.1` dan akses hanya dari server itu sendiri. Paling aman, tetapi tidak praktis bila petugas perlu mengaksesnya dari loket
2. Reverse proxy (Caddy/nginx) dengan TLS memakai sertifikat internal rumah sakit
3. TLS dengan sertifikat swakelola, dipasang sekali di komputer petugas
4. HTTP polos di VLAN terpisah — hanya bila rumah sakit menerima risikonya secara sadar

Next.js diikat lewat `next start -H 127.0.0.1 -p 3100`. Tanpa `-H`, Next.js mengikat ke seluruh antarmuka jaringan dan dashboard langsung terbuka bagi seluruh jaringan rumah sakit tanpa ada yang menyadarinya.

### 9.5 Kekebalan log audit

`audit_log` disebut append-only. Menegakkannya ternyata **tidak sesederhana** `REVOKE DELETE, UPDATE ON wakhanza.audit_log FROM wakhanza_rw` di atas fondasi `GRANT ALL PRIVILEGES ON wakhanza.*` — dibuktikan langsung saat implementasi (Fase 0): MariaDB menyatukan (union) hak akses dari seluruh tingkatan yang berlaku (global, database, tabel, kolom). `REVOKE` pada tingkat tabel **tidak dapat mencabut** hak yang diberikan pada tingkat database. Selama `wakhanza_rw` masih memegang `ALL PRIVILEGES` di tingkat skema, `UPDATE`/`DELETE` pada `audit_log` tetap diizinkan oleh grant database itu — perintah `REVOKE` di atas bahkan gagal dijalankan (`ERROR 1147: no such grant`) karena tidak ada entri hak tingkat-tabel untuk dicabut.

Model hak akses yang benar-benar menegakkannya: **jangan pernah memberi `UPDATE`/`DELETE` di tingkat database sama sekali.** Beri `SELECT, INSERT, CREATE, ALTER, INDEX, DROP, REFERENCES` di tingkat skema (aman dan dibutuhkan bersama, termasuk untuk migrasi), lalu beri `UPDATE, DELETE` satu per satu di tingkat tabel untuk setiap tabel yang memang butuh — **kecuali** `audit_log`, yang tidak pernah menerima grant itu di tingkat mana pun. Detail lengkap perintahnya ada di `TECH_STACK.md` §"Dua Koneksi Database yang Sengaja Dipisah".

Diverifikasi langsung: `INSERT` ke `audit_log` oleh `wakhanza_rw` berhasil, `UPDATE`/`DELETE` ditolak MariaDB (`ERROR 1142: command denied`), dan tabel lain (`app_setting`, dst.) tetap bisa di-`UPDATE` seperti biasa. Pembersihan berkala di §11 memang tidak menyentuh tabel ini, dan sekarang ketentuan itu tidak lagi bergantung pada kode yang berperilaku benar — atau pada asumsi yang keliru tentang cara kerja `REVOKE`.

Prinsip yang sama dengan pengaman read-only pada `sik`: aturan yang penting ditegakkan oleh mesin, bukan oleh niat baik — dan mesin itu sendiri perlu diperiksa langsung, bukan diasumsikan dari baca dokumentasi.

### 9.6 Sandbox Chromium

whatsapp-web.js menjalankan Chromium yang memuat `web.whatsapp.com` — konten jarak jauh yang tidak kita kendalikan. Chromium adalah permukaan serangan terbesar di seluruh sistem ini.

apiwa menjalankannya dengan `--no-sandbox`. **wakhanza tidak boleh.**

`--no-sandbox` adalah penanganan darurat untuk kontainer Linux tanpa namespace yang memadai. Di Windows, sandbox Chromium bekerja tanpa perlu diapa-apakan. Mematikannya berarti membuang batas pengamanan yang memisahkan proses perender dari sistem operasi — pada server yang berada satu jaringan dengan basis data rekam medis.

Bila Chromium menolak jalan, perbaiki akar masalahnya (izin berkas, akun layanan), jangan matikan sandbox-nya.

Pengerasan tambahan: jalankan worker sebagai akun layanan khusus, bukan Administrator. Akun itu hanya perlu membaca berkas program, menulis ke `.wwebjs_auth/` dan `logs/`, serta menghubungi MariaDB.

### 9.7 Log dan data pribadi

Log dibaca admin IT dan vendor — pihak yang tidak berhak melihat data pasien.

| Data | Perlakuan |
|---|---|
| Nomor telepon | disamarkan: `628****4048` |
| Nama pasien | **tidak pernah** masuk log, termasuk log kesalahan |
| Nomor rekam medis | boleh — pengenal tanpa arti bagi yang tidak punya akses SIMRS |
| Isi pesan | hanya kode pemicu, bukan teks yang terkirim |

Yang paling sering bocor: **objek kesalahan Sequelize**. Objek itu menyertakan query beserta nilai parameternya, sehingga `logger.error(err)` bisa menumpahkan seluruh baris pasien ke berkas log. Catat `err.message` dan kode kesalahan saja, tidak pernah objeknya utuh.

Berkas log berputar dan dibatasi umurnya. Log adalah salinan kedua data pribadi dan ikut menjadi tanggung jawab.

### 9.8 Berhenti berlangganan diperiksa dua kali

Daftar tolak diperiksa saat memasukkan ke outbox (alur §2 langkah 5) **dan** sekali lagi tepat sebelum mengirim.

Pemeriksaan kedua bukan pengulangan yang mubazir. Ada jeda antara pesan masuk antrean dan pesan terkirim — jeda yang bisa panjang bila jam tenang sedang berlaku. Pasien yang membalas `STOP` pada jeda itu tetap akan menerima pesan bila pemeriksaan hanya dilakukan di depan.

Menghormati permintaan berhenti bukan sekadar sopan santun. Pasien yang merasa permintaannya diabaikan akan menekan **"Laporkan spam"**, dan cukup beberapa laporan untuk memblokir nomor rumah sakit secara permanen.

### 9.9 Cadangan

Cadangan berisi seluruh nomor telepon pasien dan sesi WhatsApp yang masih aktif. Sesi itu setara kredensial: siapa pun yang memegang salinan `.wwebjs_auth` dapat menyamar sebagai nomor WhatsApp rumah sakit.

| Ketentuan | Alasan |
|---|---|
| Cadangkan database `wakhanza` **dan** `.wwebjs_auth/` | Kehilangan sesi memerlukan akses fisik ke ponsel nomor rumah sakit |
| Simpan terenkripsi, bukan di berbagi jaringan terbuka | Isinya data pribadi dan kredensial |
| Tidak pernah ke penyimpanan awan pihak ketiga | Prinsip yang sama dengan penolakan vendor WhatsApp |
| Uji pemulihannya | Cadangan yang tidak pernah diuji bukan cadangan |

### 9.10 Permukaan dependensi

whatsapp-web.js menarik Puppeteer, dan Puppeteer menarik Chromium — jutaan baris kode yang memuat konten jarak jauh. Di sinilah letak hampir seluruh risiko dependensi.

- `npm audit` dijalankan di Fase 0 dan setiap kali dependensi berubah
- Versi Chromium dari Puppeteer disematkan dan diperbarui secara sengaja, bukan otomatis. Chromium yang tidak pernah diperbarui akan menumpuk kerentanan; Chromium yang berubah tanpa diuji dapat mematahkan whatsapp-web.js
- Tidak ada telemetri keluar. Tanpa Sentry, tanpa pelaporan kerusakan otomatis — jejak kesalahan dapat memuat data pasien

### 9.11 Yang sengaja tidak dilakukan

**Isi pesan tidak dienkripsi di dalam `outbox.body`.** Basis datanya berada di server rumah sakit yang sama dengan `sik` — yang menyimpan seluruh rekam medis tanpa enkripsi di tingkat kolom. Mengenkripsi teks notifikasi sementara rekam medis lengkap tersimpan terbuka di sebelahnya adalah teater keamanan: menambah kerumitan tanpa menambah perlindungan nyata. Yang melindungi keduanya adalah kendali akses di tingkat server dan basis data.

**Tidak ada 2FA pada dashboard.** Penggunanya petugas loket yang masuk berkali-kali setiap giliran kerja, sering di komputer bersama. 2FA di konteks itu berakhir dengan kode tertempel di monitor — menurunkan keamanan, bukan menaikkan. Yang dipakai: sesi pendek, penguncian setelah gagal berulang, dan audit menyeluruh.

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

`audit_log` dikecualikan dengan sengaja. Bila kelak muncul pertanyaan siapa yang mengubah nomor telepon seorang pasien sehingga pesannya sampai ke orang lain, jawabannya harus masih ada. Sejak §9.5, pengecualian itu ditegakkan hak akses MariaDB, bukan hanya oleh kode pembersih yang berperilaku benar.

---

## 12. Kinerja

Kendala yang membentuk seluruh bagian ini: **wakhanza berbagi server dan basis data dengan SIMRS yang sedang dipakai petugas.** Perlambatan yang ditimbulkannya akan dirasakan orang yang sedang melayani pasien.

### 12.1 Anggaran

| Ukuran | Anggaran | Cara memeriksa |
|---|---|---|
| Satu siklus polling (seluruh pemicu sisip) | < 500 ms | Waktu tercatat di `poll_cursor.last_run_at` |
| Pemindaian `booking_registrasi` | < 200 ms | Interval 5 menit, lihat §4.7 |
| Koneksi ke `sik` | maksimum 2 | `pool.max` |
| Memori worker | < 600 MB | `pm2 monit`; Chromium mendominasi |
| Muat halaman dashboard | < 1 detik | Dengan paginasi |

Anggaran tanpa cara memeriksa hanyalah harapan. Setiap baris di atas punya kolom ketiga karena alasan itu.

### 12.2 Resolusi kontak secara berkelompok

Satu siklus polling dapat menghasilkan hingga 200 baris, masing-masing memerlukan nomor telepon pasiennya. Menanyakannya satu per satu berarti 200 query bolak-balik.

Sebagai gantinya, kumpulkan seluruh `no_rkm_medis` dari batch lalu ambil sekaligus:

```sql
SELECT no_rkm_medis, nm_pasien, no_tlp
FROM pasien
WHERE no_rkm_medis IN (:daftar)     -- PRIMARY KEY, satu perjalanan
```

Hal yang sama berlaku untuk `poliklinik` dan `dokter` — keduanya tabel kecil dan tetap, jadi cukup dimuat sekali ke memori saat worker mulai dan disegarkan tiap jam. Tabel `setting` (identitas rumah sakit) diperlakukan sama.

### 12.3 Batas waktu query

Query ke `sik` diberi batas waktu eksekusi. Tanpa itu, satu query yang tersendat karena penguncian tabel oleh SIMRS akan menahan siklus polling tanpa batas, dan siklus berikutnya menumpuk di belakangnya.

```sql
SET STATEMENT max_statement_time=5 FOR SELECT ...
```

Query yang melampaui batas dianggap kegagalan siklus: dicatat di `poll_cursor.last_error`, watermark tidak maju, dan siklus berikutnya mengulanginya. Melewatkan satu siklus jauh lebih baik daripada menumpuk antrean query di basis data rumah sakit.

### 12.4 Memori Chromium

Chromium yang dijalankan Puppeteer merembeskan memori pada proses yang hidup berhari-hari. Ini sifat bawaan, bukan bug yang bisa diperbaiki dari sisi kita.

```js
// ecosystem.config.js
{
  name: 'wakhanza-worker',
  instances: 1,
  exec_mode: 'fork',
  max_memory_restart: '800M',
}
```

Restart karena memori aman: outbox bersifat permanen dan sesi WhatsApp tersimpan di `.wwebjs_auth`, sehingga proses menyala kembali dan melanjutkan tanpa scan QR ulang dan tanpa pesan hilang. Inilah imbalan dari keputusan menaruh antrean di basis data alih-alih di memori.

### 12.5 Paginasi dashboard

`outbox` dan `send_log` tumbuh terus sampai pembersihan 90 hari. Pada rumah sakit dengan 300 pesan per hari, itu sekitar 27.000 baris.

Semua daftar di dashboard dipaginasi di sisi basis data — `LIMIT`/`OFFSET` dengan penghitungan terpisah, bukan mengambil seluruhnya lalu menyaring di peramban. Saringan status memanfaatkan indeks `ix_dispatch`.

Halaman nomor bermasalah memakai indeks `ix_invalid` dan menyaring `phone_e164 IS NULL`, sehingga tidak perlu memindai seluruh `patient_contact`.

### 12.6 Yang tidak perlu dioptimasi

Menyebutkan ini agar tidak ada yang membuang waktu di sana:

| Hal | Alasan |
|---|---|
| Laju pengiriman WhatsApp | Kelambatannya **disengaja** (jeda 3–8 detik). Mempercepatnya memblokir nomor rumah sakit |
| Interval polling di bawah 60 detik | Pasien tidak merasakan bedanya antara 30 dan 60 detik. Beban ke `sik` berlipat |
| Cache untuk isi outbox | Datanya berubah tiap siklus dan hanya dibaca dashboard. Cache di sini menambah ketidakcocokan, bukan kecepatan |
| Skema `wakhanza` | Volumenya kecil dan indeksnya sudah tepat. Seluruh risiko kinerja ada di sisi `sik` |

---

## 13. Pengukuran terhadap data nyata (kalibrasi)

Angka-angka yang pernah diukur langsung terhadap `sik`/`alca` di mesin pengembangan. Dipisah dari `CLAUDE.md` karena yang mengikat pekerjaan berikutnya adalah **aturannya**, bukan angkanya — tapi angkanya tetap perlu saat menilai apakah sebuah asumsi masih berlaku di instalasi lain. **Semua angka ini milik satu mesin dan satu titik waktu**; jangan dijadikan konstanta.

### 13.1 Katalog barang apotek (`databarang`, `gudangbarang`)

| Yang diukur | Nilai |
|---|---|
| `databarang` seluruhnya | 887 baris |
| `gudangbarang` seluruhnya | 907 baris, **semuanya** `no_batch = ''` |
| Aturan mentah Khanza (tanpa `stokminimal > 0`) | 348 baris cocok |
| … di antaranya ber-`stokminimal = 0` | **141** (≈40% kebisingan) |
| Sesudah `stokminimal > 0` disaring | **207 barang** (111 habis, 96 menipis) |
| EXPLAIN `b.stokminimal > 0` | `range` + `Using index`, ~514 dari 887 |

Dua konsekuensi yang jadi aturan di `CLAUDE.md`: `stokminimal > 0` wajib disaring (kalau tidak, 40% isinya barang yang memang tidak pernah punya ambang), dan `farmasi.stok_pakai_batch` default `0` karena tidak satu pun baris di sini memakai batch.

Layar persediaan Khanza sendiri memakai N+1 — satu query jumlah stok per baris di dalam `while(rs.next())`, jadi **888 perjalanan ke MariaDB untuk 887 barang**. Wakhanza memakai satu `GROUP BY ... HAVING` justru karena ia proses latar yang berbagi `pool.max: 2` dengan SIMRS yang sedang melayani pasien.

### 13.2 Urutan langkah resep (`resep_obat`)

| Langkah | Kolom | Jeda rata-rata |
|---|---|---|
| Dokter menulis resep | `tgl_peresepan` + `jam_peresepan` | — |
| Validasi apotek | `tgl_perawatan` + `jam` | +5,3 menit |
| Penyerahan | `tgl_penyerahan` + `jam_penyerahan` | +12,4 menit |

Yang membuktikan `jam` benar-benar langkah tersendiri dan bukan salinan waktu penyerahan: **3.214 resep yang BELUM diserahkan sudah punya `jam` terisi**, dan dari ~28 ribu baris yang sudah diserahkan hanya **1** yang urutannya terbalik. `tgl_perawatan` berisi `'0000-00-00'` pada 13 baris lama.

### 13.3 Nomor telepon pasien (`pasien.no_tlp`)

8.118 pasien, **4.834 (59,5%) nomornya terpakai** sesudah normalisasi `core/phone.ts` — melampaui baseline 45% di PRD. Dari 3.284 sisanya, **3.166 beralasan `empty`** (tidak punya nomor sama sekali di Khanza); yang benar-benar bisa dikoreksi petugas dari mejanya cuma 118 (`too_short` 55, `not_mobile` 52, `unparseable` 11). Sebaran timpang inilah yang membentuk urutan chip di `/nomor-bermasalah`.

### 13.4 Segmen broadcast (`BROADCAST_SEGMENT_SEMUA`)

Bentuk semua-waktu berangkat dari `pasien`. Dengan pencarian nama saja MariaDB memakai `nm_pasien` sebagai covering index (`type: index`); ia jatuh ke pemindaian penuh begitu wilayah ikut dipilih, karena kesetaraan `kd_kab` dan `LIKE '%..%'` tidak bisa dilayani satu indeks yang sama. Dengan **cara bayar sebagai satu-satunya filter**, optimizer membalik arah join dan membaca separuh `reg_periksa` — itulah alasan cara bayar tidak cukup untuk membuka mode semua-waktu.
