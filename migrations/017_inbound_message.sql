-- 017_inbound_message.sql
-- CATATAN PESAN MASUK -- dan kenapa `auto_reply_log` tidak bisa dipakai.
--
-- Sampai sini satu-satunya jejak pesan masuk adalah `auto_reply_log`, dan ia
-- tidak pernah bisa menjawab "apa saja yang masuk hari ini" karena tiga hal
-- yang semuanya disengaja untuk tujuannya sendiri:
--
--   1. Ia hanya ditulis kalau `autoreply.enabled` menyala. Saat mati,
--      `handleInboundMessage()` berhenti di baris pertama -- sebelum satu pun
--      baris log ditulis. Nol baris tidak bisa dibedakan dari nol pesan.
--   2. Pesan GRUP tidak pernah sampai ke sana. Pendengar membuangnya di baris
--      kedua (`isIndividualAddress`), jadi tidak ada satu pun jejaknya.
--   3. Pesan tanpa huruf/angka (stiker, "👍") sengaja tidak dicatat supaya
--      tidak memakan kuota nomor -- benar untuk balasan otomatis, tapi ia
--      tetap "chat yang masuk" bagi orang yang sedang melihat daftar.
--
-- Tabel ini menjawab pertanyaan yang berbeda: SIAPA mengirim apa, dari mana,
-- dan apa ID-nya. `auto_reply_log` tetap ada dan tetap jadi sumber kuota serta
-- ringkasan di /ringkasan -- keduanya tidak saling menggantikan.

CREATE TABLE inbound_message (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- id pesan dari WhatsApp. whatsapp-web.js MENYERAHKAN ULANG pesan lama setiap
  -- kali sesi dipulihkan, jadi tanpa kunci unik ini satu restart worker
  -- menggandakan seluruh riwayat yang masih ada di ponsel.
  wa_message_id  VARCHAR(160) NOT NULL,
  -- Percakapannya: `628xxx@c.us`, `<id>@lid`, atau `120363xxx@g.us`.
  chat_id        VARCHAR(64) NOT NULL,
  jenis          ENUM('perorangan','grup') NOT NULL,
  -- Di grup, chat_id adalah GRUPNYA -- yang mengirim adalah salah satu peserta,
  -- dan itulah yang disimpan di sini. Untuk perorangan nilainya sama dengan
  -- chat_id. Dipisah karena inilah "id user" yang dicari orang saat membuka
  -- halaman ini.
  pengirim_id    VARCHAR(64) NULL,
  -- Hasil pemetaan ke nomor telepon. NULL berarti pengalamatan `@lid` yang
  -- nomornya tidak berhasil ditanyakan ke WhatsApp -- keadaan nyata yang pernah
  -- membuat pesan pasien hilang berjam-jam, jadi ia harus TERLIHAT sebagai
  -- kolom kosong di layar, bukan disembunyikan.
  phone_e164     VARCHAR(20) NULL,
  -- Nama yang dipasang sendiri oleh pengirim di WhatsApp (pushname), dan nama
  -- grup. Keduanya diketik orang lain, bukan data Khanza -- ditampilkan apa
  -- adanya sebagai petunjuk, tidak pernah dipakai mencocokkan pasien.
  nama_kontak    VARCHAR(120) NULL,
  nama_chat      VARCHAR(160) NULL,
  tipe           VARCHAR(24) NOT NULL,
  -- Isi pesan. NULL bila `inbox.simpan_teks` dimatikan -- lihat di bawah.
  teks           TEXT NULL,
  -- SELALU diisi, bahkan saat teksnya tidak disimpan. Tanpa ini, mematikan
  -- penyimpanan teks membuat "pesan panjang dari pasien" tidak bisa dibedakan
  -- dari "stiker" -- padahal itu justru yang perlu diketahui untuk memutuskan
  -- apakah ada yang harus dibalas manusia.
  panjang_teks   INT UNSIGNED NOT NULL DEFAULT 0,
  -- Apakah pesan ini memicu balasan otomatis. Menjawab "pertanyaan mana yang
  -- tidak terjawab siapa pun" tanpa perlu menggabungkan dua tabel di layar.
  dibalas        TINYINT(1) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wa_msg (wa_message_id),
  -- Kueri panas halaman ini: urut waktu terbaru, disaring jenis.
  KEY ix_waktu (created_at, jenis),
  -- "Semua pesan dari nomor/grup ini" saat satu baris diklik.
  KEY ix_chat (chat_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO app_setting (k, v) VALUES
-- Menyimpan ISI pesan masuk. Default MENYALA, dan itu keputusan yang perlu
-- disadari -- kebalikan dari `autoreply.log_inbound_text` yang default mati.
--
-- Bedanya bukan inkonsistensi melainkan tujuan: kolom di `auto_reply_log` ada
-- untuk MENYETEL KATA KUNCI, dan itu sudah terjawab kolom `outcome` tanpa
-- menyimpan sepatah kata pun milik pasien. Halaman Pesan masuk ada untuk
-- MEMBACA pesannya; tanpa teks, ia menampilkan daftar baris kosong dan tidak
-- menjawab apa pun.
--
-- Yang harus disadari rumah sakit: pesan masuk pasien bisa berisi keluhan
-- medis, dan tabel ini BUKAN rekam medis. Ia ikut tercadangkan, ikut terbaca
-- siapa pun yang bisa membuka dashboard sebagai admin, dan masa simpannya 30
-- hari (bukan 90 seperti tabel lain) justru karena itu. Sakelarnya ada di
-- halamannya sendiri, satu klik.
('inbox.simpan_teks', '1'),
-- Masa simpan sendiri, sengaja lebih pendek dari 90 hari milik outbox/send_log.
-- Nilai yang dibutuhkan untuk pekerjaan sehari-hari ("siapa yang mengirim
-- kemarin, apa ID grupnya") jauh lebih pendek umurnya daripada bukti
-- pengiriman, sementara isinya jauh lebih sensitif.
('inbox.simpan_hari', '30');
