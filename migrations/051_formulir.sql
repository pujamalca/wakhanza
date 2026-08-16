-- 051_formulir.sql
-- FORMULIR LEWAT WHATSAPP -- arah masuk pertama yang menyimpan DATA YANG
-- DIKETIK PASIEN.
--
-- Pasien mengetik kata kunci yang disetel staf (mis. `/request-obat`), lalu
-- dituntun pertanyaan demi pertanyaan sampai jawabannya tersimpan sebagai satu
-- baris `wa_form_entry` yang bisa ditindaklanjuti dari dashboard. Kata kunci
-- maupun daftar pertanyaannya SEPENUHNYA disetel staf; tidak ada satu pun
-- formulir bawaan, dan tidak ada kata "obat" di mana pun dalam kode ini.
--
-- ===========================================================================
-- Kenapa ini beda jenis dari SELURUH arah masuk yang sudah ada
-- ===========================================================================
--
-- Sampai sekarang wakhanza menerima lima macam pesan masuk:
--
--   permintaan berhenti  -> menulis `opt_out`: catatan tentang SATU NOMOR
--   pertanyaan stok      -> MEMBACA katalog Khanza
--   rekap darurat        -> MEMBACA gudang Khanza
--   balasan kata kunci   -> MEMBACA `auto_reply_rule`
--   perintah /tambah dsb -> menulis KONFIGURASI, dari alamat berwenang saja
--
-- Yang ini menulis DATA, dan yang mengetiknya SIAPA PUN. Kedua bagian kalimat
-- itu bergerak berlawanan dengan 045 dan keduanya menaikkan taruhannya:
--
--   * 045 menulis baris yang menentukan apa yang dikatakan RS; kesalahannya
--     dibaca pasien. Yang ini menulis kalimat yang DIKETIK pasien; kesalahannya
--     dibaca staf -- lebih ringan.
--   * TAPI 045 dijaga daftar putih `wa_command_admin`, sementara yang ini
--     terbuka untuk setiap nomor yang mengirim WhatsApp ke RS. Tidak ada daftar
--     putih yang bisa dipasang tanpa membatalkan gunanya: formulir yang cuma
--     bisa diisi orang yang sudah terdaftar bukan formulir pasien.
--
-- Yang menggantikan daftar putih karena itu ada tiga, dan ketiganya di bawah:
-- sakelar utama yang MATI, kuota per nomor per hari, dan masa simpan yang
-- terbatas.
--
-- ===========================================================================
-- (1) Sesi memakai TABEL YANG SAMA dengan wizard perintah, dibedakan `jenis`
-- ===========================================================================
--
-- Tabel sesi kedua terlihat lebih rapi dan SALAH, dan sebabnya bukan
-- penghematan: `wa_command_session` unik pada (chat_id, pengirim_id), dan
-- keunikan itu memaksakan satu hal yang memang benar -- SATU ORANG HANYA BISA
-- BERADA DI SATU PERCAKAPAN. Dengan dua tabel, seorang admin yang meninggalkan
-- wizard `/tambah` di tengah lalu mengetik kata kunci formulir akan punya DUA
-- sesi hidup sekaligus, dan penangan pesan masuk harus memilih salah satunya
-- untuk memiliki pesan berikutnya. Pilihan apa pun salah separuh waktu, dan
-- yang kalah menelan jawaban yang dimaksudkan untuk yang menang -- tanpa satu
-- pun galat.
--
-- Dengan satu tabel, perintah baru di tengah formulir MENGGANTIKAN formulirnya
-- (baris yang sama ditimpa), yaitu perilaku yang sudah berlaku antar perintah
-- sejak 045 dan yang memang dimaksudkan orangnya: ia sedang berpindah pikiran.
--
-- Yang WAJIB menyertainya, dan tanpanya fitur ini gagal DIAM: kedua penangan
-- harus MENYARING `jenis` miliknya sendiri. `commandReply.ts` membuang sesi
-- yang langkahnya tidak dikenal (`isLangkah()`), jadi tanpa penyaring itu ia
-- akan menghapus sesi formulir milik seorang admin pada pesan berikutnya --
-- pasiennya sendiri aman karena tidak pernah lolos daftar putih, jadi
-- kerusakannya hanya muncul pada admin dan hanya kadang-kadang.
--
-- Bawaan 'perintah' membuat seluruh baris yang sudah ada benar tanpa disentuh.
--
-- ===========================================================================
-- (2) Pertanyaannya DIBEKUKAN ke dalam jawabannya
-- ===========================================================================
--
-- `wa_form_entry.jawaban_json` menyimpan {pertanyaan, jawaban} berpasangan,
-- bukan {field_id, jawaban}. Staf bisa menyunting atau menghapus pertanyaan
-- lewat dashboard di sela dua pesan pasien, dan tanpa pembekuan ini jawaban
-- lama akan ditampilkan di bawah pertanyaan yang TIDAK PERNAH DIAJUKAN
-- kepadanya. Yang muncul bukan galat melainkan catatan yang terbaca masuk akal
-- dan salah -- dan catatan itu dipakai staf untuk bertindak.
--
-- Pelajaran yang sama persis dengan `DataWizard.pilihan` di 045 (daftar
-- bernomor dibekukan supaya nomor 3 tidak berpindah arti antara "pilih" dan
-- "konfirmasi"), dan dengan `broadcast_campaign.message_body` yang menyimpan
-- SALINAN alih-alih mengacu `broadcast_template`.
--
-- Alasan yang sama membuat `form_nama` ikut dibekukan: formulir boleh dihapus,
-- dan jawaban yang tersisa harus tetap bisa dibaca.
--
-- ===========================================================================
-- (3) Kata kunci: dicocokkan lewat matchRule() yang SAMA, ditolak saat DISIMPAN
-- ===========================================================================
--
-- Pencocokannya memakai `core/autoReply.ts`'s `matchRule()` apa adanya -- kata
-- utuh, mode contains/exact, urutan `priority`. Bukan penghematan: penurunan
-- kedua atas "kapan sebuah pesan dianggap cocok" berarti kotak uji di dashboard
-- dan worker bisa menyimpang, dan yang menyimpang selalu yang tidak mengirim
-- apa-apa sehingga kesalahannya tidak bergejala.
--
-- Efek sampingnya yang paling berguna: `/request-obat` dan `request obat`
-- melewati kode yang sama persis, karena `normalizeInbound()` mengubah setiap
-- karakter non-alfanumerik jadi spasi -- garis miringnya musnah di kedua sisi.
-- Jadi bentuk bergaris miring adalah KEBIASAAN yang boleh dipilih staf, bukan
-- cabang kode tersendiri.
--
-- TABRAKAN dengan kata kunci `auto_reply_rule` DITOLAK SAAT DISIMPAN, bukan
-- dijaga pagar gugur-diam seperti golongan ketersediaan di migrations/039. Di
-- sana pagar itu perlu karena kata tanyanya ("ada", "adakah") adalah DUGAAN
-- atas bahasa sehari-hari yang tidak bisa dihindari tabrakannya. Di sini kata
-- kuncinya DIPILIH staf satu per satu, jadi tabrakan selalu bisa dihindari --
-- dan menolaknya di depan orang yang bisa membetulkannya saat itu juga jauh
-- lebih baik daripada mendiamkannya lalu membuat salah satu fitur berhenti
-- menjawab tanpa ada yang tahu.
--
-- ===========================================================================
-- (4) Grup: MATI secara bawaan, per formulir
-- ===========================================================================
--
-- Aturan "nomor RS tidak pernah membalas di grup" tetap berlaku (PRD F5.2), dan
-- formulir pasien memang tidak masuk akal di grup: jawabannya terbaca seluruh
-- anggota. Tapi formulir INTERNAL ("lapor kerusakan alat") justru paling wajar
-- diisi dari grup unit. Karena itu `boleh_grup` per formulir, bawaan 0 -- staf
-- yang menyalakannya sedang memutuskan sesuatu tentang satu formulir tertentu,
-- bukan tentang seluruh fitur.
--
-- ===========================================================================
-- Grant
-- ===========================================================================
--
-- Untuk KESEPULUH kalinya di proyek ini, grant per-tabel TIDAK diwarisi dari
-- grant skema-lebar (`wakhanza_rw` sengaja tanpa UPDATE/DELETE di tingkat
-- database, ARCHITECTURE §9.5). Diterapkan manual lewat akun berhak grant:
--
--   GRANT UPDATE, DELETE ON wakhanza.wa_form       TO 'wakhanza_rw'@'localhost';
--   GRANT UPDATE, DELETE ON wakhanza.wa_form_field TO 'wakhanza_rw'@'localhost';
--   GRANT UPDATE, DELETE ON wakhanza.wa_form_entry TO 'wakhanza_rw'@'localhost';
--   FLUSH PRIVILEGES;
--
-- `wa_form_entry` butuh UPDATE (staf menandai sudah diproses berikut catatannya)
-- dan DELETE (dipangkas `worker/cleanup.ts` menurut `formulir.simpan_hari`).

-- ---------------------------------------------------------------------------
-- Definisi formulir
-- ---------------------------------------------------------------------------
CREATE TABLE wa_form (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Nama yang dilihat staf di dashboard dan dibekukan ke tiap jawaban.
  nama          VARCHAR(80) NOT NULL,
  -- Kata kunci pemicu, JSON array sudah ternormalisasi -- bentuk yang sama
  -- persis dengan `auto_reply_rule.keywords`, supaya `parseKeywords()` dan
  -- `serializeKeywords()` yang sudah ada dipakai apa adanya.
  kata_kunci    TEXT NOT NULL,
  -- 'contains' (kata kunci muncul di mana saja) atau 'exact' (seluruh pesan
  -- harus sama persis). Teks, bukan ENUM: nilainya milik core/autoReply.ts, dan
  -- ENUM yang tertinggal menolak baris dengan galat yang tidak menyebut sebab
  -- sebenarnya (pelajaran `RepeatKind` di migrations/021).
  match_mode    VARCHAR(16) NOT NULL DEFAULT 'contains',
  -- Kecil = diperiksa lebih dulu, sama artinya dengan `auto_reply_rule.priority`.
  priority      INT NOT NULL DEFAULT 100,
  -- Kalimat pembuka sebelum pertanyaan pertama. Boleh kosong: formulir yang
  -- pertanyaannya sudah jelas tidak perlu pengantar.
  pesan_pembuka TEXT NOT NULL,
  -- Kalimat penutup sesudah jawaban terakhir tersimpan. Di sinilah RS
  -- menuliskan apa yang terjadi berikutnya ("akan dihubungi petugas"), dan
  -- itulah satu-satunya hal yang membedakan formulir yang ditindaklanjuti dari
  -- formulir yang cuma menampung.
  pesan_penutup TEXT NOT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 0,
  -- Lihat (4) di kepala berkas.
  boleh_grup    TINYINT(1) NOT NULL DEFAULT 0,
  created_by    VARCHAR(64) NOT NULL,
  updated_by    VARCHAR(64) NULL,
  created_at    DATETIME NOT NULL,
  updated_at    DATETIME NOT NULL,
  PRIMARY KEY (id),
  -- Nama unik: daftar bernomor di WhatsApp dan tabel di dashboard sama-sama
  -- memakai nama sebagai pembeda, dan dua formulir bernama sama tidak bisa
  -- dibedakan staf sama sekali.
  UNIQUE KEY uq_nama (nama),
  KEY ix_aktif (is_active, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Pertanyaan
-- ---------------------------------------------------------------------------
CREATE TABLE wa_form_field (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  form_id      INT UNSIGNED NOT NULL,
  -- Urutan tanya. Bukan `id`: staf menyisipkan pertanyaan di tengah, dan urutan
  -- yang mengikuti id membuat sisipan selalu mendarat di akhir.
  urutan       INT NOT NULL,
  -- Pertanyaannya sebagaimana dibaca pasien, dan sekaligus label yang dibekukan
  -- ke dalam jawabannya. Satu tulisan, dua guna -- dua kolom terpisah berarti
  -- dua yang bisa menyimpang.
  label        VARCHAR(200) NOT NULL,
  -- 'teks' | 'angka' | 'pilihan'. Sengaja hanya tiga: tiap tipe tambahan adalah
  -- satu cabang validasi baru yang harus benar di worker DAN di dashboard.
  tipe         VARCHAR(16) NOT NULL DEFAULT 'teks',
  -- Pilihan untuk tipe 'pilihan', JSON array. Diabaikan untuk tipe lain.
  pilihan_json TEXT NULL,
  -- Pertanyaan tak wajib bisa dilewati pasien dengan mengetik "-". Berguna
  -- untuk keterangan tambahan yang sering tidak ada.
  wajib        TINYINT(1) NOT NULL DEFAULT 1,
  -- 0 = pakai batas bawaan core/waFormulir.ts. Ada karena jawaban yang
  -- kepanjangan tersimpan TERPOTONG DIAM oleh MariaDB non-strict, dan potongan
  -- itu jatuh persis di bagian yang paling menjelaskan (pelajaran MAKS_LABEL di
  -- 045).
  maks_panjang INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_form (form_id, urutan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Jawaban yang masuk
-- ---------------------------------------------------------------------------
CREATE TABLE wa_form_entry (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  form_id       INT UNSIGNED NOT NULL,
  -- Dibekukan; lihat (2) di kepala berkas. TANPA foreign key, jadi formulir
  -- yang dihapus tidak menghapus jawaban pasien -- kelas kerugian yang sama
  -- dengan `broadcast_campaign` yang sengaja tidak mengacu `broadcast_template`.
  form_nama     VARCHAR(80) NOT NULL,
  chat_id       VARCHAR(64) NOT NULL,
  pengirim_id   VARCHAR(64) NOT NULL,
  -- null untuk grup dan untuk perorangan yang alamatnya gagal dipetakan.
  phone_e164    VARCHAR(20) NULL,
  -- Ditautkan lewat `patient_contact` (indeks `ix_phone`), dan HANYA bila
  -- nomornya menunjuk TEPAT SATU pasien. Satu nomor keluarga yang dipakai
  -- beberapa pasien menghasilkan null, bukan tebakan -- pelajaran `detectPoli()`
  -- yang mengembalikan null saat ambigu. Tidak pernah dibaca dari `sik`.
  no_rkm_medis  VARCHAR(15) NULL,
  -- [{ pertanyaan, jawaban }], berurutan sebagaimana ditanyakan.
  jawaban_json  TEXT NOT NULL,
  -- Alur kerja staf. 'baru' -> 'diproses' -> 'selesai'; 'batal' untuk yang
  -- ternyata tidak perlu ditindaklanjuti.
  status        ENUM('baru','diproses','selesai','batal') NOT NULL DEFAULT 'baru',
  catatan       TEXT NULL,
  ditangani_oleh VARCHAR(64) NULL,
  ditangani_at  DATETIME NULL,
  created_at    DATETIME NOT NULL,
  PRIMARY KEY (id),
  -- Daftar masuk dibuka terurut waktu dan disaring status; keduanya lewat sini.
  KEY ix_masuk (created_at, status),
  KEY ix_form (form_id, created_at),
  -- Kuota per nomor per hari, dan pencarian riwayat satu penelepon.
  KEY ix_nomor (phone_e164, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Sesi: satu tabel untuk dua macam percakapan
-- ---------------------------------------------------------------------------
-- `IF NOT EXISTS` karena DDL MariaDB TIDAK transaksional: migrasi yang gagal di
-- pernyataan berikutnya meninggalkan kolom ini sudah terpasang sementara
-- `schema_migrations` belum mencatat apa pun, dan berkas yang tidak bisa
-- dijalankan ulang menuntut penyuntingan tangan pada database produksi
-- (pelajaran migrations/046).
ALTER TABLE wa_command_session
  ADD COLUMN IF NOT EXISTS jenis VARCHAR(16) NOT NULL DEFAULT 'perintah' AFTER pengirim_id;

INSERT INTO app_setting (k, v) VALUES

-- Sakelar utama, MATI. Menyalakannya berarti setiap nomor yang mengirim
-- WhatsApp ke RS bisa menyimpan baris ke database ini -- keputusan yang tidak
-- boleh menyala sebagai efek samping migrasi.
('formulir.enabled', '0'),

-- Batas waktu sesi formulir, menit. SENDIRI, bukan menumpang
-- `autoreply.wa_sesi_timeout_menit` (10), dan bukan karena angkanya kebetulan
-- berbeda: yang kedaluwarsa di sana adalah staf yang tinggal mengetik ulang
-- perintahnya, di sini seorang pasien yang harus mengulang seluruh formulir
-- dari awal dan hampir pasti tidak akan. 0 = kedaluwarsa dimatikan; sengaja
-- TIDAK dianjurkan, dan halamannya mengatakan kenapa.
('formulir.sesi_timeout_menit', '30'),

-- Kuota per nomor per hari. Pengganti daftar putih yang tidak bisa dipasang di
-- sini; lihat kepala berkas. Dihitung dari `wa_form_entry` yang SELESAI, bukan
-- dari percakapan yang dimulai -- orang yang membatalkan di tengah tidak sedang
-- menyalahgunakan apa pun. 0 = tanpa batas.
('formulir.maks_per_nomor_per_hari', '3'),

-- Masa simpan jawaban, hari. Isinya diketik pasien dan bisa memuat keluhan;
-- tabel ini bukan rekam medis dan ikut tercadangkan. 90 hari selaras dengan
-- `outbox`/`auto_reply_log`, dan cukup panjang untuk menindaklanjuti permintaan
-- yang tertunda sekalipun. 0 = tanpa pemangkasan.
('formulir.simpan_hari', '90')

-- `v = v` (bukan `v = VALUES(v)`): menjalankan ulang migrasi tidak boleh
-- mengembalikan setelan yang sudah disunting staf ke nilai seed.
ON DUPLICATE KEY UPDATE v = v;
