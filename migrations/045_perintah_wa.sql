-- 045_perintah_wa.sql
-- PERINTAH LEWAT WHATSAPP -- tulisan pertama ke konfigurasi wakhanza yang
-- berasal dari luar dashboard.
--
-- ===========================================================================
-- Kenapa ini beda jenis dari SELURUH arah masuk yang sudah ada
-- ===========================================================================
--
-- Sampai sekarang wakhanza menerima empat macam pesan masuk, dan tidak satu pun
-- di antaranya mengubah cara sistem ini berperilaku:
--
--   permintaan berhenti  -> menulis `opt_out`, yaitu catatan tentang SATU nomor
--   pertanyaan stok      -> membaca katalog Khanza, tidak menulis apa pun
--   rekap darurat        -> membaca gudang Khanza, tidak menulis apa pun
--   balasan kata kunci   -> membaca `auto_reply_rule`, tidak menulis apa pun
--
-- Yang ini menulis `auto_reply_rule`: baris yang menentukan APA YANG DIKATAKAN
-- NOMOR RUMAH SAKIT KEPADA PASIEN. Bedanya bukan soal tabel mana yang disentuh
-- melainkan soal siapa yang menanggung akibatnya -- salah ketik di sini dibaca
-- pasien, bukan staf.
--
-- Karena itu tiga hal di bawah ini bukan kelengkapan melainkan syarat.
--
-- ===========================================================================
-- (1) Daftar putih TERSENDIRI, bukan `farmasi_target.boleh_tanya`
-- ===========================================================================
--
-- Menumpang daftar yang sudah ada terlihat hemat dan salah: `boleh_tanya`
-- menjawab "siapa yang boleh MENANYAKAN stok", sementara tabel ini menjawab
-- "siapa yang boleh MENGUBAH apa yang dikatakan RS kepada pasien". Dua wewenang
-- yang beratnya sama sekali berbeda, dan menggabungkannya berarti setiap grup
-- apotek -- yang di mesin ini bisa beranggota puluhan orang, dan salah satunya
-- 722 -- ikut mendapat wewenang kedua tanpa seorang pun memutuskannya.
--
-- Pelajaran yang sudah dibayar `migrations/020` saat memisahkan `boleh_tanya`
-- dari `is_active`, dan `migrations/021` saat menambah `terima_darurat_stok`:
-- pilihan yang digabung adalah pilihan yang hilang.
--
-- BUKAN pula kolom baru di `farmasi_target`. Halaman `/farmasi` menampilkan
-- SELURUH baris tabel itu sebagai "tujuan apotek"; nomor yang wewenangnya cuma
-- menulis aturan balasan akan muncul di sana berikut enam centang yang tidak
-- satu pun berlaku baginya. Alasan yang sama membuat `bpjs_target` (024) dan
-- `erm_target` (044) berdiri sendiri.
--
-- ===========================================================================
-- (2) Aturan baru lahir NONAKTIF, dan itu sebuah SETELAN
-- ===========================================================================
--
-- `autoreply.wa_tambah_aktif_langsung` bawaannya '0': aturan tersimpan dengan
-- `is_active = 0` dan baru menyala setelah ada yang membukanya di
-- `/balasan-otomatis`. Yang dibeli bukan keamanan teoretis -- CLAUDE.md
-- §"Yang masih perlu keputusan rumah sakit" sudah lebih dulu mencatat bahwa
-- "siapa yang meninjau bahwa isi tiap aturan benar secara klinis" adalah
-- pertanyaan yang BELUM dijawab RS. Membiarkan aturan menyala seketika berarti
-- menjawabnya diam-diam dengan "tidak ada yang meninjau".
--
-- Sakelarnya ada karena kerugiannya juga nyata: sebagian besar orang menambah
-- aturan dari WhatsApp JUSTRU karena sedang tidak di depan komputer, dan aturan
-- yang belum menyala belum menolong siapa-siapa. RS yang sudah menunjuk
-- peninjaunya boleh membukanya sendiri; yang belum, tidak kehilangan apa pun.
--
-- ===========================================================================
-- (3) Sesi wizard: percakapan BERTAHAP pertama di sistem ini
-- ===========================================================================
--
-- Setiap penangan pesan masuk yang ada tidak punya ingatan: satu pesan datang,
-- diputuskan, selesai. Wizard tiga langkah menuntut keadaan yang bertahan antar
-- pesan, dan keadaan itu membawa tiga jebakan yang semuanya gagal DIAM:
--
--   * **Penyerahan ulang.** whatsapp-web.js menyerahkan ulang pesan lama setiap
--     sesi dipulihkan. Tanpa penjaga, satu restart worker memajukan wizard
--     beberapa langkah sekaligus memakai jawaban kemarin. `last_wa_message_id`
--     menyimpan pesan terakhir yang sudah memajukan sesi ini; yang sama datang
--     lagi diabaikan. Ia lapis KEDUA -- lapis pertamanya pemeriksaan `outbox`
--     atas kunci idempoten, sama seperti jalur balasan stok grup.
--
--   * **Sesi yang tak pernah habis.** Wizard yang ditinggalkan di tengah akan
--     menelan SETIAP pesan berikutnya dari orang itu selamanya -- termasuk
--     pertanyaan stok yang sah. `updated_at` + `autoreply.wa_sesi_timeout_menit`
--     membuatnya kedaluwarsa; sesi kedaluwarsa diperlakukan seolah tidak ada,
--     bukan dijawab "sesi habis" (orang yang menulis pesan tak berhubungan
--     sepuluh menit kemudian tidak sedang menunggu kabar tentang wizard).
--
--   * **Dua orang di satu grup.** Kuncinya (chat_id, pengirim_id), BUKAN chat_id
--     saja. Di grup, hanya peserta yang MEMULAI wizard yang jawabannya dipakai;
--     pesan peserta lain lewat begitu saja ke penanganan biasa. Tanpa itu,
--     kalimat siapa pun yang kebetulan mengetik di grup yang sama menjadi nama
--     aturan atau isi balasan -- tanpa satu pun galat. Untuk obrolan perorangan
--     `pengirim_id` diisi `chat_id` itu sendiri, jadi bentuk kuncinya seragam
--     dan tidak ada cabang NULL yang harus diingat di dua tempat.
--
-- ===========================================================================
-- Grant
-- ===========================================================================
--
-- KEDUANYA butuh UPDATE dan DELETE, dan untuk kedelapan kalinya di proyek ini
-- grant per-tabel TIDAK diwarisi dari grant skema-lebar (`wakhanza_rw` sengaja
-- tanpa UPDATE/DELETE di tingkat database, ARCHITECTURE §9.5). Diterapkan
-- manual lewat akun berhak grant:
--
--   GRANT UPDATE, DELETE ON wakhanza.wa_command_admin   TO 'wakhanza_rw'@'localhost';
--   GRANT UPDATE, DELETE ON wakhanza.wa_command_session TO 'wakhanza_rw'@'localhost';
--   FLUSH PRIVILEGES;

CREATE TABLE wa_command_admin (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Alamat LENGKAP (`628xxx@c.us` atau `120363xxx@g.us`), divalidasi lewat
  -- core/farmasiTarget.ts yang sama dipakai tujuan farmasi/BPJS/ERM -- termasuk
  -- penolakan tautan undangan grup, yang sama sekali bukan JID dan tidak bisa
  -- dikonversi menjadi JID.
  chat_id     VARCHAR(64) NOT NULL,
  -- Keterangan buatan staf ("HP Kepala Rekam Medis"). Ia satu-satunya cara
  -- mengetahui SIAPA sebuah JID grup 18 digit itu saat meninjau daftarnya
  -- kembali enam bulan kemudian.
  label       VARCHAR(80) NOT NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_by  VARCHAR(64) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Satu alamat satu baris. Berbeda dari `template_target` yang unik per
  -- (pemicu, tujuan): di sana satu grup wajar menerima beberapa pemicu, di sini
  -- wewenangnya cuma satu macam.
  UNIQUE KEY uq_chat (chat_id),
  KEY ix_aktif (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE wa_command_session (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  chat_id      VARCHAR(64) NOT NULL,
  -- Peserta yang memulai. Untuk obrolan perorangan diisi `chat_id` -- lihat
  -- alasan bentuk seragamnya di kepala berkas.
  pengirim_id  VARCHAR(64) NOT NULL,
  -- Langkah wizard, mis. 'tambah:kata_kunci'. Bentuknya ditentukan
  -- core/waCommand.ts; disimpan sebagai teks dan BUKAN ENUM justru karena
  -- daftar langkah akan bertambah tiap perintah baru, dan ENUM yang tertinggal
  -- menolak baris dengan galat yang tidak menyebut sebab sebenarnya (pelajaran
  -- `RepeatKind` di migrations/021).
  langkah      VARCHAR(32) NOT NULL,
  -- Jawaban yang sudah terkumpul + daftar id aturan yang sedang ditampilkan
  -- sebagai pilihan bernomor. Daftar itu DIBEKUKAN di sini, bukan dibaca ulang
  -- saat konfirmasi: aturan bisa dihapus lewat dashboard di sela dua pesan, dan
  -- nomor 3 yang berpindah arti antara "pilih" dan "konfirmasi" berarti staf
  -- menghapus aturan yang bukan dilihatnya.
  data_json    TEXT NOT NULL,
  -- Penjaga penyerahan ulang, lapis kedua. Lihat kepala berkas.
  last_wa_id   VARCHAR(128) NULL,
  created_at   DATETIME NOT NULL,
  -- Disentuh tiap langkah; inilah yang dibandingkan dengan batas waktu, bukan
  -- created_at -- wizard yang sedang berjalan tidak boleh mati di tengah hanya
  -- karena sudah dimulai sepuluh menit lalu.
  updated_at   DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sesi (chat_id, pengirim_id),
  KEY ix_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO app_setting (k, v) VALUES

-- Sakelar utama, MATI. Berdiri SENDIRI dari `autoreply.enabled`, dan itu
-- disengaja ke dua arah: RS harus bisa menulis aturannya lewat WhatsApp
-- sebelum menyalakan balasan otomatis (menyusun dulu, menyalakan belakangan),
-- dan RS yang balasan otomatisnya sudah berjalan tidak otomatis membuka
-- wewenang menulis aturan kepada siapa pun. Karena itu pula cabang perintah
-- diperiksa SEBELUM `handleInboundMessage`, bukan di dalamnya.
('autoreply.wa_perintah_enabled', '0'),

-- Aturan baru langsung menyala? Bawaannya TIDAK. Uraiannya di kepala berkas.
('autoreply.wa_tambah_aktif_langsung', '0'),

-- Batas waktu sesi wizard, menit. Sepuluh cukup panjang untuk mengetik isi
-- balasan beberapa paragraf sambil diselingi pekerjaan lain, dan cukup pendek
-- supaya wizard yang ditinggalkan tidak menelan pesan sore harinya. 0 =
-- kedaluwarsa dimatikan; sengaja TIDAK dianjurkan, dan halamannya mengatakan
-- kenapa.
('autoreply.wa_sesi_timeout_menit', '10')

-- `v = v` (bukan `v = VALUES(v)`): menjalankan ulang migrasi tidak boleh
-- mengembalikan setelan yang sudah disunting staf ke nilai seed.
ON DUPLICATE KEY UPDATE v = v;
