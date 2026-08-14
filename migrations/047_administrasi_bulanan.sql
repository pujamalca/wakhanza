-- =============================================================================
-- REKAP BULANAN ADMINISTRASI
-- =============================================================================
--
-- Satu pesan sebulan berisi gambaran KUNJUNGAN bulan yang baru lewat: berapa
-- pasien yang datang, cara bayarnya, berapa yang batal, berapa yang baru dan
-- lama, berapa yang bolak-balik, seberapa lengkap berkasnya terisi, dan berapa
-- surat yang terbit. Dikirim pada TANGGAL dan JAM yang disetel staf.
--
-- Bentuknya sengaja dibuat semirip mungkin dengan REKAP BULANAN FARMASI (046) --
-- kelas pemicu WAKTU berperiode bulan, `core/rekapBulan.ts` yang sama, penanda
-- `"YYYYMM"` yang sama, rekap terlewat yang DIKEJAR, dan tabel tujuan tersendiri.
-- Yang berikut ini adalah yang BERBEDA, dan yang berbeda itulah yang gagal diam
-- kalau 046 disalin mentah-mentah.
--
-- -----------------------------------------------------------------------------
-- (1) Ia berangkat DARI `reg_periksa`, dan itu mengubah letak pagarnya
-- -----------------------------------------------------------------------------
--
-- Rekap farmasi berangkat dari `resep_obat` dan menyebut `reg_periksa` tepat
-- sekali, lewat satu `COUNT(DISTINCT no_rkm_medis)` yang berdiri sendiri justru
-- supaya tetap begitu. Di sini `reg_periksa` ADALAH penggeraknya -- tabel yang
-- memuat `no_rkm_medis`, `kd_poli`, `p_jawab`, dan `almt_pj` sekaligus. Pagar
-- "tabelnya memang tidak disebut" karena itu tidak tersedia sama sekali.
--
-- Yang menggantikannya tiga hal, dan ketiganya ditegakkan BENTUK KODE:
--
--   a. Tidak satu pun kolom identitas masuk daftar SELECT. `no_rkm_medis` hanya
--      pernah jadi argumen `COUNT(DISTINCT ...)`; `pasien` tidak pernah di-JOIN.
--   b. Kelengkapan berkas dibaca lewat `EXISTS`, bukan JOIN. Bentuk itu
--      menghasilkan BOOLEAN, jadi query mengetahui SOAPIE sudah diisi tanpa
--      pernah mengetahui apa isinya -- prinsip `TRIM(p.td) <> ''` di 044. Tabel
--      yang disentuhnya memuat rekam medis telanjang: `pemeriksaan_ralan.keluhan`
--      /`pemeriksaan`/`penilaian`/`evaluasi`, `diagnosa_pasien.kd_penyakit`,
--      `resume_pasien.diagnosa_utama`.
--   c. `kd_poli` tidak dibaca sama sekali. Rekap ini tidak memecah per poli, dan
--      pada bulan sepi satu baris "Poliklinik Kulit & Kelamin : 3" adalah
--      keterangan tentang tiga orang tertentu.
--
-- Satu-satunya NAMA yang ikut keluar adalah `penjab.png_jawab`, dan selalu
-- sebagai label pada baris agregat.
--
-- -----------------------------------------------------------------------------
-- (2) `status_poli`, bukan `stts_daftar` -- dan itu bukan preferensi
-- -----------------------------------------------------------------------------
--
-- Keduanya ada di `reg_periksa` dan artinya berbeda: `stts_daftar` menjawab
-- "pasien ini baru pertama kali terdaftar di RS", `status_poli` menjawab "baru
-- pertama kali ke POLI ini". Terukur keduanya menyimpang pada 85 dari 12.392
-- baris.
--
-- Yang dipakai `status_poli`, karena aturan "pasien baru wajib punya asesmen awal
-- keperawatan" ditegakkan migrations/044 terhadap kolom itu. Memakai
-- `stts_daftar` di sini menghasilkan pembagi yang berbeda dari pembilangnya --
-- rekap berbunyi "97 dari 188 pasien baru belum diasesmen" sementara halaman
-- /erm/penilaian-umum pada hari yang sama menyebut 191. Dua angka berbeda untuk
-- satu pertanyaan, tanpa satu pun galat.
--
-- -----------------------------------------------------------------------------
-- (3) `status_bayar`, bukan ketiadaan `nota_jalan` -- dan keduanya DIUKUR
-- -----------------------------------------------------------------------------
--
-- "Belum closing billing" dan "belum bayar" adalah dua nama untuk satu tindakan
-- kasir, dan datanya membenarkan itu: atas SELURUH 12.392 baris, 102 kunjungan
-- ber-`status_bayar='Belum Bayar'` DAN tanpa baris `nota_jalan`, sementara yang
-- menyimpang hanya SATU (punya nota tapi statusnya tertinggal 'Belum Bayar').
--
-- Yang dipakai `status_bayar` karena ia kolom pada tabel penggeraknya sendiri --
-- nol join, terindeks, dan namanya menyebut isinya.
--
-- -----------------------------------------------------------------------------
-- Angka yang mengubah keputusan, terukur atas database produksi
-- -----------------------------------------------------------------------------
--
--   bulan  kunjungan  pasien  batal  baru  blm-bayar  soapie  diagnosa  resep
--   Jan          596     507      3   160          3     295         5    564
--   Feb          471     393      8   116          8     268        25    441
--   Mar          597     504      3   183          3     349        30    568
--   Apr          631     549      4   170          4     269         3    593
--   Mei          541     463      2   132          7     230        15    507
--   Jun          644     539      6   188         15     232         7    589
--   Jul          668     563      2   191         10     486         3    634
--
-- Tiga hal yang cuma terlihat dari rekap BULANAN:
--
--  1. SOAPIE bergerak tajam: 49% (Januari) -> 73% (Juli). Rekap harian
--     menampilkan satu angka tanpa pembanding, sehingga perubahan sepelan ini
--     tidak pernah terbaca sebagai perubahan.
--  2. DIAGNOSA praktis tidak pernah diisi: 3 dari 668 kunjungan pada Juli (0,4%),
--     dan tidak pernah melewati 6% pada bulan mana pun. Angka ini yang paling
--     mungkin mengubah tindakan seseorang, dan sampai sekarang tidak ada satu pun
--     layar di sistem ini yang menampilkannya.
--  3. PASIEN vs KUNJUNGAN berbeda 16% (563 dari 668 pada Juli), dan yang BERULANG
--     -- datang lebih dari sekali DI DALAM bulan itu -- 81 orang yang menyumbang
--     186 kunjungan. Tiga angka yang gampang tertukar, jadi ketiganya disebut.
--
-- -----------------------------------------------------------------------------
-- Yang WAJIB diketahui sebelum menyalakannya: DUA angka akan selalu nol
-- -----------------------------------------------------------------------------
--
--   `resume_pasien`   COUNT(*) = 0 di database produksi. Bukan TABLE_ROWS yang
--                     membulat (pelajaran migrations/030) -- benar-benar nol
--                     baris, dan `resume_pasien_ranap` juga.
--   surat kontrol     `skdp_bpjs` 1 baris, `bridging_surat_kontrol_bpjs` 0.
--                     Arsip `sik` membuktikan query-nya benar (253 dan 18.843
--                     baris, terbaca 176 dan 904 pada bulan contohnya), tapi RS
--                     ini tidak mencatat surat kontrol di database produksinya.
--   surat sakit       17 baris seluruhnya, Agustus 2024 - Februari 2025, lalu
--                     berhenti. Menunya praktis sudah ditinggalkan.
--
-- Ketiganya tetap dibaca dan tetap ditampilkan sebagai 0, dengan alasan yang sama
-- yang membuat pemesanan dan hibah tetap ditampilkan di 046: nol di sini bukan
-- sifat struktural melainkan keadaan yang bisa berubah, dan hari ia berhenti nol
-- adalah hari angkanya mulai berarti. Menyembunyikannya membuat "tidak ada
-- resume" tidak bisa dibedakan dari "fiturnya tidak membaca resume".
--
-- -----------------------------------------------------------------------------
-- `administrasi.bulanan_enabled` default MATI
-- -----------------------------------------------------------------------------
--
-- BERDIRI SENDIRI dari `administrasi.enabled`, dan alasannya lebih kuat daripada
-- pemisahan mana pun di 041/042/046: `administrasi.enabled` menyalakan pengiriman
-- BERKAS PDF berisi nama, umur, dan alamat pasien ke nomor WhatsApp -- keputusan
-- terberat di halaman ini. Menjadikan rekap bertingkat di bawahnya berarti
-- memaksa RS mengambil keputusan itu hanya untuk mendapat satu pesan berisi
-- ANGKA.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- administrasi_target -- tujuan, TABEL SENDIRI
-- -----------------------------------------------------------------------------
--
-- Alasannya sama persis dengan `erm_target` (044) dan `bpjs_target` (024): kalau
-- ia menumpang `farmasi_target`, grup manajemen/rekam medis akan muncul di
-- halaman /farmasi sebagai "tujuan apotek" berikut tujuh centang yang tidak
-- berlaku baginya -- dan menghapusnya dari halaman itu diam-diam mematikan rekap
-- administrasi yang tidak ditampilkan di sana.
--
-- Di sini pemisahannya bahkan lebih jelas daripada ERM: `/administrasi` sampai
-- sekarang TIDAK PUNYA daftar tujuan sama sekali. Kesembilan kelas pemicunya
-- berujung ke nomor seorang PASIEN (surat sakit, surat sehat, dokumen hasil),
-- jadi tabel ini memperkenalkan penerima STAF pertama di halaman ini.
--
-- Alamat yang SAMA boleh ada di beberapa tabel tujuan -- itu keputusan berbeda
-- yang kebetulan menuju alamat yang sama.
CREATE TABLE administrasi_target (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- 'grup' | 'personal', dinormalisasi core/farmasiTarget.ts sebelum disimpan.
  jenis      ENUM('grup','personal') NOT NULL,
  -- JID LENGKAP. VARCHAR(64) mengikuti outbox.chat_id; VARCHAR(20) milik
  -- phone_e164 tidak muat untuk JID grup yang 24 karakter (migrations/016).
  chat_id    VARCHAR(64) NOT NULL,
  label      VARCHAR(80) NOT NULL,

  -- Dinamai menurut ISINYA sejak awal, bukan `is_active` saja -- pelajaran yang
  -- sudah dibayar `erm_target`. Rekap administrasi berikutnya (mingguan, atau
  -- rekap per poli) akan menambah centangnya sendiri di tabel ini, persis seperti
  -- `farmasi_target` tumbuh dari satu jadi tujuh. Nama yang menyebut isinya
  -- membuat kolom kedua tinggal ditambahkan; `is_active` akan memaksa penggantian
  -- nama pada tabel yang sudah berisi pilihan staf.
  terima_bulanan TINYINT(1) NOT NULL DEFAULT 0,

  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Satu alamat satu baris. Tanpa ini, dua baris untuk grup yang sama
  -- menghasilkan dua pesan per kejadian, dan yang terlihat di grup adalah
  -- "sistemnya mengirim dobel" bukan "ada dua baris tujuan".
  UNIQUE KEY uq_chat (chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Pengaturan
-- -----------------------------------------------------------------------------
--
-- CATATAN untuk siapa pun yang menyalin blok ini: `app_setting` HANYA punya
-- kolom `(k, v)`. Menambahkan `updated_by` ke daftar INSERT membuat migrasinya
-- gagal di tengah, dan karena DDL MariaDB tidak transaksional, CREATE TABLE di
-- atas sudah terlanjur masuk sementara `schema_migrations` belum mencatat apa
-- pun -- pelajaran yang dibayar saat migrations/046 ditulis.

INSERT INTO app_setting (k, v) VALUES
  ('administrasi.bulanan_enabled', '0')
ON DUPLICATE KEY UPDATE k = k;

-- Tanggal kirim, 1-28.
--
-- Dijepit di 28 karena tanggal 29-31 tidak ada di Februari: jadwal "tiap tanggal
-- 30" akan melewatkan satu bulan setiap tahun tanpa satu pun galat, dan yang
-- terlihat cuma rekap Februari yang tidak pernah datang. Alasan yang sama persis
-- dengan `dayOfMonth` pada `broadcast_schedule` (core/schedule.ts).
--
-- Bawaannya 3, sama dengan rekap farmasi: kunjungan akhir bulan kadang baru
-- di-closing hari kerja pertama bulan berikutnya, dan rekap tanggal 1 pukul 08:00
-- akan menghitungnya sebagai "belum closing billing" padahal kasirnya belum
-- sempat buka. Angka ini bisa diubah staf, dan justru itu yang diminta.
INSERT INTO app_setting (k, v) VALUES
  ('administrasi.bulanan_tanggal', '3')
ON DUPLICATE KEY UPDATE k = k;

-- Jam kirim. Pagi hari kerja -- bulannya sudah tutup, tidak ada yang dikejar.
INSERT INTO app_setting (k, v) VALUES
  ('administrasi.bulanan_jam', '08:00')
ON DUPLICATE KEY UPDATE k = k;

-- Penanda bulan yang terakhir dikirim, `"YYYYMM"`.
--
-- CUMA penghemat query, bukan penentu kebenaran -- yang mencegah kiriman ganda
-- adalah kunci idempoten `(ADM_BULANAN, bulan, chat_id)` yang ditegakkan
-- `uq_idem` di mesin database. Karena itu ia dimajukan SESUDAH berhasil, tidak
-- pernah sebelum (pelajaran `bpjs.kontrol_last_run`).
--
-- Bentuknya `"YYYYMM"` dan bukan nama bulan, karena `bulanJatuhTempo()`
-- membandingkannya sebagai STRING: `"YYYYMM"` salah satu dari sedikit bentuk
-- tanggal yang urutan leksikalnya sama dengan urutan waktunya.
INSERT INTO app_setting (k, v) VALUES
  ('administrasi.bulanan_last_run', '')
ON DUPLICATE KEY UPDATE k = k;

-- -----------------------------------------------------------------------------
-- Isi pesan
-- -----------------------------------------------------------------------------
--
-- URUTANNYA disengaja: pembagi lebih dulu, pecahan sesudahnya. Angka
-- "3 diagnosa" tidak bisa dinilai sebelum pembacanya tahu ada 668 kunjungan, dan
-- ketiga angka "perlu ditindaklanjuti" tidak bisa dinilai sebelum ia membaca
-- kelengkapan berkasnya.
--
-- `{jumlah_pasien}` DAN `{jumlah_kunjungan}` keduanya disebut dengan label yang
-- membedakannya secara tegas -- selisihnya terukur 16%, dan label "pasien" pada
-- angka kunjungan berbohong sebanyak itu setiap bulan.
--
-- Bagian "Perlu ditindaklanjuti" memakai sisi NEGATIF (`{jumlah_tanpa_resep}`,
-- `{jumlah_baru_tanpa_asesmen}`, `{jumlah_belum_bayar}`) sementara
-- `{rincian_berkas}` memakai sisi POSITIF. Itu bukan inkonsistensi: yang pertama
-- daftar pekerjaan, yang kedua gambaran keadaan. Keduanya diturunkan dari
-- pembilang yang sama di `gabungAdmBulanan()`, jadi keduanya tidak bisa
-- menyimpang.
INSERT INTO app_setting (k, v) VALUES
  ('administrasi.template_bulanan',
   '*Rekap Administrasi Bulanan*\n{nama_rs}\n\nPeriode : {bulan_rekap}\n\n*Kunjungan*\nTotal kunjungan : {jumlah_kunjungan}\nPasien berbeda : {jumlah_pasien}\n\n{rincian_pasien}\n\n*Cara bayar*\n{rincian_cara_bayar}\n\n*Kelengkapan berkas terisi*\n{rincian_berkas}\n\n*Perlu ditindaklanjuti*\nAsesmen awal belum diisi : {jumlah_baru_tanpa_asesmen}\nKunjungan tanpa resep : {jumlah_tanpa_resep}\nBelum closing billing : {jumlah_belum_bayar}\n\n*Surat*\nSurat sakit : {jumlah_surat_sakit}\nSurat kontrol : {jumlah_surat_kontrol}\n\nRekap otomatis, dikirim {tanggal}.')
ON DUPLICATE KEY UPDATE k = k;

-- Bulan tanpa SATU PUN kunjungan. Bawaannya KOSONG = sengaja diam.
--
-- Alasan yang sama dengan `farmasi.template_bulanan_kosong`: pesan yang isinya
-- "tidak ada apa-apa" berhenti dibaca, dan sejak itu yang sungguhan ikut tidak
-- terbaca.
--
-- Di sini keadaannya jauh lebih ekstrem daripada di farmasi. Bulan tanpa satu pun
-- KUNJUNGAN berarti rumah sakit tidak menerima seorang pasien pun sebulan penuh
-- -- keadaan yang, kalau benar-benar terjadi, sudah diketahui semua orang jauh
-- sebelum rekapnya jatuh tempo. Justru karena itu mengisinya masuk akal: pesan
-- yang cuma muncul pada keadaan seaneh itu tidak akan pernah jadi kebisingan, dan
-- kalau ia datang tanpa ada yang menutup rumah sakit, yang sedang ia laporkan
-- adalah query yang berhenti membaca.
INSERT INTO app_setting (k, v) VALUES
  ('administrasi.template_bulanan_kosong', '')
ON DUPLICATE KEY UPDATE k = k;
