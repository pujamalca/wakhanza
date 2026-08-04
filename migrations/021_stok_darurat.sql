-- 021_stok_darurat.sql
-- DARURAT STOK -- peringatan persediaan yang dikirim TANPA ada yang bertanya.
--
-- Fitur farmasi ketiga, dan arah pemicunya berbeda dari kedua yang sudah ada:
--
--   NOTIFIKASI FARMASI (016)  dipicu kejadian di `sik`  (resep divalidasi/diserahkan)
--   BALASAN STOK       (019)  dipicu pesan MASUK        (ada yang bertanya)
--   DARURAT STOK       (ini)  dipicu WAKTU              (jadwal jatuh tempo)
--
-- Perbedaan itu yang membentuk pagarnya: tidak ada kejadian yang membatasi
-- volumenya, dan tidak ada manusia yang meninjau tiap kali kirim. Yang menahan
-- keduanya adalah jadwal yang dipilih staf sendiri plus batas baris per pesan.

-- ---------------------------------------------------------------------------
-- farmasi_target.terima_darurat_stok -- kolom ketiga, dan sekali lagi TERPISAH
-- ---------------------------------------------------------------------------
-- Tabel ini kini menjawab TIGA pertanyaan berbeda tentang satu tujuan:
--
--   is_active            ke mana notifikasi resep dikirim
--   boleh_tanya          siapa yang boleh membuat nomor RS menjawab
--   terima_darurat_stok  siapa yang menerima peringatan persediaan
--
-- Menggabungkannya dengan `is_active` akan salah ke dua arah sekaligus, dan
-- keduanya bentuk pemakaian yang wajar: grup apotek shift yang perlu tahu tiap
-- resep masuk tapi tidak perlu rekap persediaan tiap pagi, dan sebaliknya nomor
-- kepala instalasi yang justru HANYA perlu rekap persediaan tanpa dibanjiri
-- pemberitahuan tiap resep. Alasannya sama persis dengan yang membuat 020
-- memisahkan `boleh_tanya`, dan alasan itu terbukti bukan teori: pilihan yang
-- digabung adalah pilihan yang hilang.
--
-- DEFAULT 0 untuk baris yang sudah ada -- tidak satu pun tujuan lama mulai
-- menerima peringatan baru tanpa ada yang memutuskannya di dashboard.
ALTER TABLE farmasi_target
  ADD COLUMN terima_darurat_stok TINYINT(1) NOT NULL DEFAULT 0 AFTER boleh_tanya;

-- ---------------------------------------------------------------------------
-- stok_alert_schedule -- kapan peringatan dikirim
-- ---------------------------------------------------------------------------
-- Tabel tersendiri, bukan kunci `app_setting`, dan bukan menumpang
-- `broadcast_schedule`.
--
-- Kenapa bukan app_setting: `next_run_at` adalah keadaan yang DITULIS worker
-- tiap kali jadwal jalan. `app_setting` adalah konfigurasi yang ditulis manusia
-- lewat form Pengaturan -- form yang mengirim ULANG semua kunci tiap Simpan
-- ditekan. Menaruh keadaan worker di sana berarti seorang admin yang membuka
-- Pengaturan lalu menyimpannya bisa memundurkan atau memajukan jadwal tanpa
-- pernah bermaksud begitu, dan tanpa satu pun tanda.
--
-- Kenapa bukan `broadcast_schedule`: tabel itu berbentuk segmen PASIEN
-- (filter_json berisi wilayah/cara bayar/rentang kunjungan, message_body per
-- pasien, satu `broadcast_campaign` per jalan). Tidak satu pun berlaku di sini,
-- dan memaksakannya berarti separuh kolomnya selamanya NULL sementara worker
-- broadcast harus belajar melewati baris yang bukan miliknya.
CREATE TABLE stok_alert_schedule (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Nama yang ditulis staf ("Rekap pagi grup apotek"). Muncul di daftar jadwal
  -- dan di `audit_log`, jadi "jadwal mana yang mengirim ini" bisa dijawab tanpa
  -- membaca id.
  nama        VARCHAR(80) NOT NULL,

  -- 'every_n_days' SENGAJA tidak ada di ENUM `broadcast_schedule.repeat_kind`.
  -- Lihat core/schedule.ts: tipe TS-nya pun dipisah (RepeatKindPeriodik) supaya
  -- nilai ini tidak bisa tanpa sengaja masuk ke jadwal broadcast dan gagal di
  -- sini sebagai galat ENUM yang tidak menyebut sebab sebenarnya.
  --
  -- 'once' TIDAK ada, dan ketiadaannya disengaja: peringatan persediaan yang
  -- cuma sekali bukan peringatan, itu laporan -- dan untuk itu sudah ada tombol
  -- "Kirim sekarang" yang hasilnya langsung terlihat.
  repeat_kind ENUM('daily','every_n_days','weekly','monthly') NOT NULL,
  -- Jarak hari untuk 'every_n_days'. Dijepit 2-90 di core/schedule.ts; 1 punya
  -- namanya sendiri ('daily') dan dua jalan menuju perilaku yang sama berarti
  -- dua tempat yang harus diperiksa saat menelusuri.
  interval_days TINYINT UNSIGNED NULL,
  -- Jam dinding WIB. Seluruh proyek mengasumsikan server RS berzona WIB
  -- (quietHours.ts, khanza/common.ts) -- lihat catatan UTC di CLAUDE.md soal
  -- kolom DATETIME, yang TIDAK berlaku untuk kolom string ini.
  time_of_day VARCHAR(5) NOT NULL,
  day_of_week TINYINT NULL,
  -- 1-28, dibatasi supaya selalu valid termasuk Februari, tanpa logika
  -- kasus-khusus di computeNextRunAt().
  day_of_month TINYINT NULL,

  -- Kosong = seluruh jenis barang. Terisi = hanya jenis itu (`jenis.kdjns` di
  -- sik), supaya apotek bisa memisahkan "obat" dari "alkes habis pakai" yang
  -- ditangani orang berbeda.
  kd_jenis    VARCHAR(4) NULL,
  -- Batas baris dalam satu pesan. Kolom, bukan konstanta: 207 barang berada di
  -- bawah ambang minimal di database ini, dan berapa banyak yang muat dibaca
  -- sekali duduk adalah penilaian apoteknya sendiri.
  max_baris   SMALLINT UNSIGNED NOT NULL DEFAULT 30,

  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  -- NULL = tidak akan pernah jalan lagi. Worker menyaring
  -- `is_active=1 AND next_run_at <= NOW()`, jadi NULL adalah rem yang tidak
  -- bergantung pada is_active -- dua rem terpisah, sengaja.
  next_run_at DATETIME NULL,
  last_run_at DATETIME NULL,
  -- Berapa barang yang cocok saat terakhir jalan. Nol berulang kali adalah
  -- tanda saringan jenisnya keliru, dan tanpa kolom ini satu-satunya cara
  -- mengetahuinya adalah membaca pesan yang terkirim.
  last_jumlah SMALLINT UNSIGNED NULL,

  created_by  VARCHAR(64) NOT NULL,
  updated_by  VARCHAR(64) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Query worker tiap siklus: is_active + next_run_at. Tanpa indeks ini, tiap
  -- siklus 60 detik memindai seluruh tabel -- kecil hari ini, tapi ini persis
  -- kelas kebiasaan yang ARCHITECTURE §4.4 ada untuk mencegahnya.
  KEY ix_due (is_active, next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Pengaturan
-- ---------------------------------------------------------------------------
-- Sakelar utama MATI secara bawaan, konsisten dengan `farmasi.enabled` dan
-- `autoreply.enabled`: fitur yang mengirim WhatsApp atas inisiatifnya sendiri
-- dinyalakan sadar-sadar, bukan menyala karena kebetulan termigrasi.
INSERT INTO app_setting (k, v) VALUES
('farmasi.darurat_enabled', '0'),

-- Apakah instalasi Khanza ini memakai penomoran batch. Menentukan CABANG
-- perhitungan stok (lihat khanza/stokGudang.ts) -- dan salah menyetelnya tidak
-- menghasilkan galat, melainkan seluruh katalog terbaca berstok nol. Bawaan '0'
-- bukan tebakan: seluruh 907 baris `gudangbarang` di mesin ini ber-no_batch=''.
('farmasi.stok_pakai_batch', '0'),

-- Isi pesannya. `{daftar_stok}` dirakit core/stokDarurat.ts (banyak baris,
-- tiap nama barang sudah lewat sanitizeValue) -- lihat MULTILINE_VARIABLES.
('farmasi.template_darurat',
 '*Peringatan Persediaan*\n{nama_rs}\n{tanggal} {jam}\n\nTotal {jumlah_total} barang di bawah ambang minimal ({jumlah_habis} habis, {jumlah_menipis} menipis).\n\n{daftar_stok}'),

-- Pesan saat TIDAK ada satu pun barang di bawah ambang. Default KOSONG =
-- DIAM, alasan yang sama dengan `autoreply.fallback_body`: peringatan yang
-- datang tiap hari untuk mengatakan "tidak ada apa-apa" berhenti dibaca dalam
-- seminggu, dan sejak itu yang sungguhan ikut tidak terbaca. Apotek yang justru
-- ingin kepastian harian bahwa jadwalnya masih hidup boleh mengisinya.
('farmasi.template_darurat_kosong', '');
