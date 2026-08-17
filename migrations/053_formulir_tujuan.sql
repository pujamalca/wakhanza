-- 053_formulir_tujuan.sql
-- KE MANA jawaban formulir dikabarkan, dan SEBERAPA RINCI.
--
-- ===========================================================================
-- Lubang yang ditutupnya: formulir yang tersimpan tidak memberi tahu siapa pun
-- ===========================================================================
--
-- Sejak 051 seluruh jalurnya lengkap kecuali ujungnya. Pasien mengetik kata
-- kunci, dituntun pertanyaan demi pertanyaan, menerima kalimat penutup yang
-- berbunyi "petugas akan menghubungi Anda" -- lalu barisnya diam di
-- `wa_form_entry` sampai ada yang kebetulan membuka `/formulir`.
--
-- Kalimat penutup itulah yang membuat kekurangan ini bukan sekadar
-- ketidaknyamanan. `actions.ts` MEWAJIBKAN pesan penutup diisi persis supaya
-- pasien tahu apa yang terjadi berikutnya; sistem lalu menjanjikan tindak
-- lanjut yang tidak dikabarkan kepada seorang pun. Formulir yang paling
-- berguna -- permintaan obat, laporan kerusakan alat -- justru yang paling
-- terluka: gunanya seluruhnya terletak pada CEPATNYA sampai ke orang yang
-- bertugas.
--
-- ===========================================================================
-- (1) Tabel SENDIRI, bukan menumpang `template_target`
-- ===========================================================================
--
-- `template_target` berkunci pada `trigger_code`, dan tujuan di sini melekat
-- pada SEBUAH FORMULIR. Menumpangnya menuntut trigger_code palsu seperti
-- `FORMULIR:7` -- persis bentuk yang sudah ditolak migrations/018 saat
-- pertanyaan yang sama muncul antara `template_target` dan `farmasi_target`.
-- Dan taruhannya nyata: `trigger_code` di sana dipakai `Template.findByPk()`
-- serta seluruh penyaring halaman Antrean/Log, jadi nilai yang bukan kode
-- pemicu akan muncul di tempat-tempat yang menganggapnya kode pemicu.
--
-- Yang TIDAK berubah: bentuk kolomnya dibuat kembar dengan kedua tabel tujuan
-- yang sudah ada -- `chat_id` disimpan sudah sebagai JID lengkap, divalidasi
-- `core/farmasiTarget.ts` yang sama, dipilih dari `wa_group` yang sama. Tiga
-- tabel dengan tiga bentuk berbeda adalah tiga tempat yang bisa menyimpang.
--
-- Keunikannya (form_id, chat_id): satu grup boleh menerima banyak formulir,
-- satu formulir boleh punya banyak tujuan, tapi grup yang sama dipasang dua
-- kali pada formulir yang sama cuma menghasilkan pesan kembar.
--
-- ===========================================================================
-- (2) Rinciannya PER FORMULIR, dan bawaannya `ringkas`
-- ===========================================================================
--
-- Jawaban formulir adalah TEKS YANG DIKETIK PASIEN. Ia bisa memuat keluhan,
-- nama obat, atau apa pun yang kebetulan ditulis orang yang sedang butuh
-- bantuan -- dan tujuannya sebuah grup yang anggotanya bisa berubah tanpa
-- sepengetahuan siapa pun di sini.
--
-- Dua mode, dan bedanya bukan panjang melainkan APA YANG BEREDAR:
--
--   ringkas  nama formulir, waktu, dan nomor penanya. TANPA satu pun jawaban.
--            Grup tahu ADA yang masuk dan harus dibuka; isinya dibaca di
--            dashboard, tempat aksesnya sudah dijaga login dan peran.
--   lengkap  seluruh pasangan pertanyaan-jawaban ikut. Dipakai bila grupnya
--            memang unit yang menindaklanjuti, dan RS sudah memutuskan isi itu
--            boleh beredar di WhatsApp.
--
-- Bawaannya `ringkas` karena bawaan yang salah di sini tidak bisa ditarik:
-- pesan yang telanjur masuk grup tidak bisa dihapus dari ponsel anggotanya.
-- Arah sebaliknya cuma merepotkan -- staf membuka dashboard sekali lalu
-- mengganti setelannya.
--
-- `no_rkm_medis` TIDAK PERNAH ikut, di kedua mode. Ia bukan sesuatu yang
-- ditulis pasien melainkan hasil PENAUTAN yang dikerjakan sistem ini, dan
-- menyiarkan tautan nomor-telepon-ke-nomor-rekam-medis ke grup memberi
-- pembacanya kemampuan yang tidak dimilikinya sebelum pesan itu masuk.
--
-- VARCHAR, bukan ENUM: nilainya milik `core/waFormulirTujuan.ts`, dan ENUM
-- yang tertinggal menolak baris dengan galat yang tidak menyebut sebab
-- sebenarnya (pelajaran `RepeatKind` di migrations/021, diulang di 051).
--
-- ===========================================================================
-- (3) Sakelarnya adalah DAFTAR TUJUANNYA sendiri, bukan `app_setting` baru
-- ===========================================================================
--
-- Tanpa satu pun baris `wa_form_target` yang aktif, tidak ada satu pun pesan
-- yang berangkat -- yaitu perilaku 051 apa adanya. Jadi migrasi ini TIDAK
-- mengubah apa pun sampai seorang admin memasang tujuan pertamanya, dan
-- tindakan itu sendiri sudah merupakan keputusan sadar tentang satu formulir
-- tertentu. Setelan `formulir.tujuan_enabled` di atasnya cuma akan jadi sakelar
-- kedua yang bisa lupa dinyalakan, dengan gejala "sudah dipasang tapi tidak
-- ada yang sampai" -- kelas kegagalan yang paling mahal di proyek ini.
--
-- ===========================================================================
-- Grant
-- ===========================================================================
--
-- Untuk kesekian kalinya: grant per-tabel TIDAK diwarisi dari grant skema-lebar
-- (`wakhanza_rw` sengaja tanpa UPDATE/DELETE di tingkat database,
-- ARCHITECTURE §9.5). Diterapkan manual lewat akun berhak grant:
--
--   GRANT UPDATE, DELETE ON wakhanza.wa_form_target TO 'wakhanza_rw'@'localhost';
--   FLUSH PRIVILEGES;

CREATE TABLE IF NOT EXISTS wa_form_target (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  form_id     INT UNSIGNED NOT NULL,
  -- 'grup' | 'personal', sebentuk persis dengan farmasi_target/template_target.
  jenis       ENUM('grup','personal') NOT NULL,
  -- JID lengkap: `120363...@g.us` atau `628...@c.us`. Disimpan sudah jadi
  -- alamat, bukan nomor mentah -- lihat core/farmasiTarget.ts.
  chat_id     VARCHAR(64) NOT NULL,
  -- Ditulis staf sendiri, bukan diambil dari WhatsApp: nama grup bisa diubah
  -- anggotanya kapan saja, dan label yang berubah sendiri membuat staf ragu
  -- apakah tujuannya masih yang dulu dipasang.
  label       VARCHAR(80) NOT NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_by  VARCHAR(64) NOT NULL,
  updated_by  VARCHAR(64) NULL,
  created_at  DATETIME NOT NULL,
  updated_at  DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_form_tujuan (form_id, chat_id),
  KEY ix_form (form_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- `IF NOT EXISTS` karena DDL MariaDB TIDAK transaksional: migrasi yang gagal di
-- pernyataan berikutnya meninggalkan kolom ini terpasang sementara
-- `schema_migrations` belum mencatat apa pun (pelajaran migrations/046, diulang
-- di 051).
ALTER TABLE wa_form
  ADD COLUMN IF NOT EXISTS tujuan_rincian VARCHAR(16) NOT NULL DEFAULT 'ringkas' AFTER boleh_grup;
