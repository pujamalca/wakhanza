-- 018_template_target.sql
-- TUJUAN TAMBAHAN UNTUK KETUJUH PEMICU PASIEN.
--
-- Sampai sekarang penerima sebuah pemicu pasien ditentukan sepenuhnya oleh
-- kejadiannya: satu baris `reg_periksa` -> satu pasien -> satu nomor. Notifikasi
-- farmasi (016) memperkenalkan bentuk kedua -- tujuan yang DIPILIH staf, berupa
-- grup WhatsApp atau nomor petugas -- tapi hanya untuk dua pemicunya sendiri.
--
-- Migrasi ini membawa bentuk itu ke ketujuh pemicu pasien, dan sengaja MEMAKAI
-- ULANG mekanisme yang sudah ada alih-alih membangun jalur kedua:
--   * alamatnya tetap `outbox.chat_id` (016), bukan kolom baru
--   * validasi/normalisasinya tetap `core/farmasiTarget.ts`
--   * daftar grupnya tetap `wa_group`, diisi worker lewat `wa_session.command`
--
-- Yang BARU cuma dua: ke mana sebuah pemicu boleh dikirim, dan apakah pasiennya
-- masih ikut dikirimi.

-- ---------------------------------------------------------------------------
-- template.tujuan_mode -- apakah pasien masih penerimanya
-- ---------------------------------------------------------------------------
-- Tiga nilai, dan pemisahan ini disengaja daripada satu boolean "kirim ke grup":
--
--   'pasien'            hanya pasien. PERSIS perilaku sebelum migrasi ini.
--   'pasien_dan_tujuan' pasien tetap dapat, tiap tujuan dapat salinan.
--   'tujuan'            HANYA tujuan; pasien tidak dikirimi sama sekali.
--
-- Default 'pasien' bukan sekadar nilai awal yang aman -- ia yang memastikan
-- migrasi ini nol perubahan perilaku sampai ada yang memutuskan sebaliknya di
-- dashboard. Sebuah kolom baru yang diam-diam mengubah ke mana notifikasi
-- pasien dikirim adalah persis jenis perubahan yang tidak boleh menumpang
-- `npm run migrate`.
--
-- 'tujuan' ada karena beberapa pemicu memang lebih masuk akal sebagai
-- koordinasi internal daripada pemberitahuan pasien (mis. QUEUE_REG ke grup
-- loket). Tanpa nilai ini, satu-satunya cara mencapainya adalah mengosongkan
-- nomor pasien -- yang mustahil, karena nomornya berasal dari `sik` yang
-- read-only.
ALTER TABLE template
  ADD COLUMN tujuan_mode ENUM('pasien','pasien_dan_tujuan','tujuan')
    NOT NULL DEFAULT 'pasien' AFTER is_active;

-- ---------------------------------------------------------------------------
-- template_target -- grup/nomor tujuan, PER PEMICU
-- ---------------------------------------------------------------------------
CREATE TABLE template_target (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Menunjuk `template.trigger_code`. TIDAK dipasang FOREIGN KEY, mengikuti
  -- seluruh skema ini yang memang tidak memakainya (`outbox.trigger_code`,
  -- `audit_log.actor`, dst.) -- lihat ARCHITECTURE §3. Barisnya tetap terikat
  -- lewat aplikasi: halaman /template hanya menawarkan ketujuh kode yang ada.
  trigger_code VARCHAR(32) NOT NULL,

  -- 'grup'     : JID grup WhatsApp, mis. 120363000000000000@g.us
  -- 'personal' : nomor petugas, disimpan SUDAH sebagai JID (628xxx@c.us)
  --
  -- Sama seperti `farmasi_target`: keduanya disimpan sebagai JID lengkap supaya
  -- dispatcher meneruskannya apa adanya tanpa perlu tahu bedanya. `jenis` ada
  -- untuk TAMPILAN dan validasi saat menyimpan, bukan untuk mengubah cara
  -- mengirim.
  jenis        ENUM('grup','personal') NOT NULL,
  chat_id      VARCHAR(64) NOT NULL,

  -- Nama yang ditulis staf, bukan diambil dari WhatsApp -- nama grup bisa
  -- diubah anggotanya kapan saja, dan daftar tujuan yang berubah nama sendiri
  -- membuat "siapa yang menerima ini" sulit dijawab saat ditelusuri belakangan.
  label        VARCHAR(80) NOT NULL,

  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_by   VARCHAR(64) NOT NULL,
  updated_by   VARCHAR(64) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),

  -- Unik per (PEMICU, tujuan) -- BUKAN per tujuan saja seperti
  -- `farmasi_target.uq_chat`. Bedanya nyata: satu grup loket yang sama sangat
  -- wajar menerima QUEUE_REG maupun BILLING_READY, jadi keunikan menyeluruh
  -- akan menolak pemasangan yang benar. Yang harus ditolak adalah tujuan yang
  -- sama dua kali untuk pemicu yang SAMA, karena kunci idempotennya menyertakan
  -- chat_id sehingga dua baris identik menghasilkan dua kunci BERBEDA dan
  -- lolos dari uq_idem -- grupnya menerima pesan yang sama dua kali.
  UNIQUE KEY uq_trigger_chat (trigger_code, chat_id),
  KEY ix_trigger_aktif (trigger_code, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
