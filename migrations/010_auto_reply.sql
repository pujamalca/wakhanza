-- 010_auto_reply.sql
-- BALASAN OTOMATIS: pasien mengirim pesan, worker mencocokkan kata kunci, lalu
-- membalas sendiri. Ini pertama kalinya wakhanza bereaksi pada pesan MASUK di
-- luar kata `STOP` -- sampai sini sistemnya satu arah (PRD §3).
--
-- Dua tabel, dan keduanya sengaja terpisah:
--
--   auto_reply_rule : definisi yang dikelola staf (kata kunci -> isi balasan).
--                     Jumlahnya belasan, disunting lewat dashboard.
--   auto_reply_log  : satu baris per pesan MASUK yang diproses. Tumbuh secepat
--                     pasien mengirim pesan. Ia juga sumber batas laju
--                     per nomor -- lihat worker/autoReply.ts.
--
-- Menyatukannya akan mencampur tabel konfigurasi kecil dengan tabel kejadian
-- yang tumbuh terus, dan membuat pembersihan berkala (worker/cleanup.ts)
-- mustahil dilakukan tanpa menyentuh aturan yang masih dipakai.

CREATE TABLE auto_reply_rule (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  label       VARCHAR(80) NOT NULL,
  -- Larik JSON. Disimpan sudah ternormalisasi (core/autoReply.ts
  -- normalizeKeyword) supaya pencocokan tidak perlu menormalisasi ulang
  -- puluhan kata kunci untuk tiap pesan masuk -- tapi worker TETAP
  -- menormalisasi ulang saat membaca, supaya baris yang pernah disunting
  -- langsung lewat mysql tidak diam-diam berhenti cocok.
  keywords    TEXT NOT NULL,
  match_mode  ENUM('contains','exact') NOT NULL DEFAULT 'contains',
  body        TEXT NOT NULL,
  -- Kecil = diperiksa lebih dulu. Aturan spesifik ("jadwal dokter jantung")
  -- harus bisa ditaruh di atas yang umum ("jadwal").
  priority    INT NOT NULL DEFAULT 100,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_by  VARCHAR(64) NOT NULL,
  updated_by  VARCHAR(64) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_label (label),
  KEY ix_aktif (is_active, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE auto_reply_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone_e164      VARCHAR(20) NOT NULL,
  rule_id         INT UNSIGNED NULL,
  -- matched  : satu aturan cocok, balasannya masuk outbox
  -- fallback : tidak ada yang cocok, pesan cadangan yang dikirim
  -- no_match : tidak ada yang cocok dan tidak ada pesan cadangan -- DIAM
  -- rate_limited : nomor ini sudah melewati kuota balasan per jam
  -- duplicate    : pesan WhatsApp yang sama sudah pernah diproses
  outcome         ENUM('matched','fallback','no_match','rate_limited','duplicate') NOT NULL,
  -- Isi pesan pasien. NULL kecuali autoreply.log_inbound_text dinyalakan.
  --
  -- Default MATI dan itu disengaja: pesan masuk dari pasien bisa berisi keluhan
  -- medis, dan tabel ini bukan rekam medis. Yang dibutuhkan untuk menyetel kata
  -- kunci sebenarnya cuma tahu BERAPA BANYAK yang tak terjawab -- itu sudah
  -- terjawab kolom `outcome` tanpa menyimpan satu kata pun milik pasien.
  -- RS yang memang ingin menyetel kata kunci dari kalimat asli bisa menyalakannya
  -- sementara lewat halaman Pengaturan.
  inbound_preview VARCHAR(120) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Kolom pertama nomor telepon: SATU-SATUNYA kueri panas di tabel ini adalah
  -- batas laju ("berapa balasan ke nomor ini satu jam terakhir"), dan itu jalan
  -- untuk SETIAP pesan masuk. created_at menyusul supaya jadi covering index.
  KEY ix_phone_time (phone_e164, created_at),
  -- Halaman dashboard membaca lintas-nomor per rentang waktu.
  KEY ix_time (created_at, outcome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- autoreply.enabled DEFAULT '0' -- ini sakelar utamanya, dan sengaja MATI.
-- Menyalakannya mengubah wakhanza dari pengirim notifikasi satu arah menjadi
-- sistem yang menjawab pasien. Itu keputusan rumah sakit (siapa yang
-- bertanggung jawab atas isi jawabannya), bukan sesuatu yang pantas menyala
-- sendiri hanya karena migrasinya sudah dijalankan.
INSERT INTO app_setting (k, v) VALUES
('autoreply.enabled', '0'),
-- Kuota balasan per nomor per jam. Satu orang yang mengirim 50 pesan tidak
-- boleh menghasilkan 50 balasan -- itu pola beruntun yang persis memicu
-- deteksi spam WhatsApp (PRD F5.2), dan yang kena blokir adalah satu-satunya
-- nomor RS.
('autoreply.max_per_number_per_hour', '5'),
-- Pesan cadangan saat tidak ada kata kunci yang cocok. Kosong = DIAM.
-- Diam adalah default yang benar: pesan tak dikenali sering kali pertanyaan
-- medis sungguhan, dan menjawabnya dengan "maaf tidak mengerti" berulang kali
-- lebih buruk daripada tidak menjawab sama sekali.
('autoreply.fallback_body', ''),
-- Jeda sebelum pesan cadangan boleh dikirim lagi ke nomor yang sama. Tanpa ini,
-- orang yang mengetik beberapa kalimat berturut-turut menerima "maaf tidak
-- mengerti" untuk tiap kalimatnya.
('autoreply.fallback_cooldown_minutes', '180'),
-- Batas jumlah baris jadwal dalam satu pesan. Pesan WhatsApp yang kepanjangan
-- terpotong di sisi penerima; lebih baik dipotong sendiri dengan catatan jelas.
('autoreply.schedule_max_rows', '60'),
('autoreply.log_inbound_text', '0');

-- Aturan awal supaya halaman Balasan otomatis tidak kosong saat pertama dibuka,
-- dan supaya ada contoh nyata bentuk kata kunci yang benar. Semuanya sudah
-- aktif, tapi TIDAK ADA yang terkirim selama autoreply.enabled masih '0'.
INSERT INTO auto_reply_rule (label, keywords, match_mode, body, priority, created_by) VALUES
('Jadwal dokter hari ini',
 '["jadwal hari ini","dokter hari ini","praktek hari ini","jaga hari ini"]',
 'contains',
 'Berikut jadwal praktik dokter di {nama_rs} hari ini:\n\n{jadwal_hari_ini}\n\nInformasi lebih lanjut: {kontak_rs}',
 10,
 'system:migration'),
('Jadwal dokter',
 '["jadwal dokter","jadwal praktek","jadwal praktik","jam praktek","jadwal poli","dokter praktek"]',
 'contains',
 'Berikut jadwal praktik dokter di {nama_rs}:\n\n{jadwal_dokter}\n\nInformasi lebih lanjut: {kontak_rs}',
 20,
 'system:migration'),
('Daftar poliklinik',
 '["daftar poli","poli apa saja","layanan apa saja","ada poli apa"]',
 'contains',
 'Layanan poliklinik yang tersedia di {nama_rs}:\n\n{daftar_poli}\n\nUntuk jadwal dokternya, balas: jadwal dokter',
 30,
 'system:migration'),
('Alamat dan kontak',
 '["alamat","lokasi","dimana","di mana","nomor telepon"]',
 'contains',
 '{nama_rs}\n{alamat_rs}\nTelepon: {kontak_rs}',
 40,
 'system:migration');
