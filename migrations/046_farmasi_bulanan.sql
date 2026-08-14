-- =============================================================================
-- REKAP BULANAN FARMASI
-- =============================================================================
--
-- Satu pesan sebulan berisi SELURUH kegiatan farmasi bulan yang baru lewat:
-- resep berikut angka mutunya (berapa yang belum divalidasi, belum diserahkan,
-- belum ditelaah), dan keempat jalur barang (pengadaan, pemesanan, hibah,
-- penjualan). Dikirim pada TANGGAL dan JAM yang disetel staf.
--
-- -----------------------------------------------------------------------------
-- Kelas pemicunya WAKTU, tapi periodenya BULAN -- dan itu yang baru
-- -----------------------------------------------------------------------------
--
-- Ketiga rekap yang sudah ada (penjualan 041, resep 042, asesmen 044) semuanya
-- HARIAN, dan penandanya menyimpan tanggal. Bentuk itu tidak bisa dipakai di
-- sini: yang harian bertanya "apakah HARI INI sudah dikirim", yang bulanan
-- bertanya "apakah BULAN ITU sudah dikirim". Karena itu `core/rekapBulan.ts`
-- berdiri sendiri, dan `jatuhTempoHarian()`/`slotJatuhTempo()` sengaja TIDAK
-- disentuh -- ketiganya dipakai fitur yang sedang berjalan di produksi.
--
-- Satu perbedaan perilaku yang menempel padanya, dan arahnya berlawanan dari
-- rekap harian: rekap bulanan yang TERLEWAT justru DIKEJAR. Isinya bulan yang
-- sudah tutup, jadi angkanya tidak berubah sedikit pun antara tanggal 3 dan
-- tanggal 20 -- worker yang mati sepekan lalu hidup lagi tetap mengirim rekap
-- yang benar dan utuh. Membuangnya berarti sebulan penuh data hilang tanpa satu
-- pun cara mendapatkannya kembali.
--
-- -----------------------------------------------------------------------------
-- TELAAH RESEP -- tabelnya ADA, dan itu kebalikan dari yang diduga
-- -----------------------------------------------------------------------------
--
-- `telaah_farmasi` berisi 10.463 baris di database produksi. PK-nya `no_resep`,
-- sama persis dengan `resep_obat`, jadi "resep yang belum ditelaah" jatuh sebagai
-- `LEFT JOIN ... IS NULL` dengan rencana `eq_ref PRIMARY`. Terukur pula: NOL
-- baris telaah tanpa resep yang bersesuaian, jadi arah join-nya tidak
-- menyembunyikan apa pun.
--
-- Kedua puluh kolom enum hasil telaahnya (`resep_tepat_dosis`,
-- `resep_interaksi_obat`, ...) TIDAK pernah di-SELECT. Yang diminta adalah berapa
-- resep yang belum ditelaah, bukan penilaian klinis atas resep seorang pasien --
-- dan hasil telaah adalah data yang jenisnya sama dengan `diagnosa_klinis` pada
-- permintaan lab (025).
--
-- -----------------------------------------------------------------------------
-- Angka yang mengubah keputusan, terukur atas database produksi
-- -----------------------------------------------------------------------------
--
--   bulan    resep  kunjungan  pasien  blm-validasi  blm-serah  tanpa-telaah
--   Feb        467        441       -             0          9            30
--   Mei        541        507     449             0         24            48
--   Jun        629        589     519             0         99           100
--   Jul        685        634     541             0        175           145
--
-- Dua hal yang cuma terlihat dari rekap BULANAN dan tidak dari rekap harian:
--
--  1. TREN. "Belum diserahkan" naik dari 9 (Februari) ke 175 (Juli) -- dari 2%
--     menjadi 25,5% dari seluruh resep. "Belum ditelaah" dari 30 ke 145. Rekap
--     harian menampilkan satu angka tanpa pembanding, sehingga kenaikan sepelan
--     ini tidak pernah terbaca sebagai kenaikan.
--  2. PASIEN vs KUNJUNGAN. Juli punya 634 kunjungan dari 541 pasien -- selisih
--     15%. Menyediakan salah satunya saja berarti memilihkan tafsir untuk staf,
--     dan tafsir yang salah tidak menghasilkan galat.
--
-- Pengadaan 20-42 faktur/bulan; penjualan 307-765 nota/bulan; pemesanan dan
-- hibah NOL pada setiap bulan (kedua menunya praktis belum dipakai). Keduanya
-- tetap dibaca dan tetap ditampilkan sebagai 0, atas permintaan pemilik sistem.
--
-- -----------------------------------------------------------------------------
-- `farmasi.bulanan_enabled` default MATI
-- -----------------------------------------------------------------------------
--
-- Berdiri sendiri dari `farmasi.enabled`, dengan alasan yang sudah dibayar di
-- 041 dan 042: `farmasi.enabled` menyalakan pesan yang memuat NAMA PASIEN, NO. RM,
-- dan POLI ke sebuah grup WhatsApp. Menjadikan rekap ini bertingkat di bawahnya
-- berarti memaksa RS mengambil keputusan privasi terberat di halaman Farmasi
-- hanya untuk mendapatkan satu pesan berisi ANGKA.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tujuan: kolom KETUJUH di `farmasi_target`
-- -----------------------------------------------------------------------------
--
-- Bukan menumpang `is_active`, dan alasannya paling kuat di antara ketujuhnya:
-- isinya yang PALING LUAS di seluruh halaman Farmasi -- omzet penjualan, belanja
-- ke pemasok, dan angka mutu apotek dalam satu pesan. Itu bacaan MANAJEMEN,
-- bukan bacaan shift.
--
-- Digabung dengan `is_active`, grup shift apotek yang perlu tahu tiap resep masuk
-- akan otomatis ikut menerima laporan berisi angka belanja dan penilaian kinerja
-- tempatnya sendiri bekerja -- tanpa satu pun cara melepaskannya selain ikut
-- mematikan notifikasi resepnya.
--
-- Bawaannya 0: memperketat dengan sengaja, sama seperti `boleh_tanya` (020).
--
-- `IF NOT EXISTS` -- satu-satunya ALTER di seluruh migrations/ yang memakainya,
-- dan itu bukan gaya melainkan pelajaran yang dibayar saat berkas ini ditulis:
-- percobaan pertamanya gagal pada INSERT di bawah (kolom `updated_by` yang tidak
-- ada di `app_setting`), dan karena DDL MariaDB TIDAK transaksional, kolomnya
-- sudah terlanjur masuk sementara `schema_migrations` belum mencatat apa pun.
-- Menjalankannya ulang lalu gagal dengan "Duplicate column" -- pada berkas yang
-- sebagian besar isinya belum pernah jalan.
--
-- Berkas migrasi yang tidak bisa dijalankan ulang sesudah gagal di tengah
-- menuntut penyuntingan tangan pada database produksi untuk memulihkannya, dan
-- itu persis keadaan yang paling mudah membuat satu langkah terlewat.
ALTER TABLE farmasi_target
  ADD COLUMN IF NOT EXISTS terima_bulanan TINYINT(1) NOT NULL DEFAULT 0 AFTER terima_penjualan;

-- -----------------------------------------------------------------------------
-- Pengaturan
-- -----------------------------------------------------------------------------

INSERT INTO app_setting (k, v) VALUES
  ('farmasi.bulanan_enabled', '0')
ON DUPLICATE KEY UPDATE k = k;

-- Tanggal kirim, 1-28.
--
-- Dijepit di 28 karena tanggal 29-31 tidak ada di Februari: jadwal "tiap tanggal
-- 30" akan melewatkan satu bulan setiap tahun tanpa satu pun galat, dan yang
-- terlihat cuma rekap Februari yang tidak pernah datang. Alasan yang sama persis
-- dengan `dayOfMonth` pada `broadcast_schedule` (core/schedule.ts).
--
-- Bawaannya 3, bukan 1: transaksi akhir bulan kadang baru dientri hari kerja
-- pertama bulan berikutnya, dan rekap tanggal 1 pukul 08:00 akan melewatkannya.
-- Angka ini bisa diubah staf, dan justru itu yang diminta.
INSERT INTO app_setting (k, v) VALUES
  ('farmasi.bulanan_tanggal', '3')
ON DUPLICATE KEY UPDATE k = k;

-- Jam kirim. Pagi hari kerja -- bulannya sudah tutup, tidak ada yang dikejar.
--
-- Berbeda dari ketiga rekap harian yang jamnya malam (21:00 penjualan, 22:00
-- resep), dan sebabnya bukan selera: jam malam di sana dipilih supaya rekap tidak
-- melewatkan transaksi yang masih berjalan hari itu. Di sini periodenya sudah
-- tutup berhari-hari, jadi satu-satunya yang menentukan adalah kapan orang
-- membacanya.
INSERT INTO app_setting (k, v) VALUES
  ('farmasi.bulanan_jam', '08:00')
ON DUPLICATE KEY UPDATE k = k;

-- Penanda bulan yang terakhir dikirim, `"YYYYMM"`.
--
-- CUMA penghemat query, bukan penentu kebenaran -- yang mencegah kiriman ganda
-- adalah kunci idempoten `(FARMASI_BULANAN, bulan, chat_id)` yang ditegakkan
-- `uq_idem` di mesin database. Karena itu ia dimajukan SESUDAH berhasil, tidak
-- pernah sebelum (pelajaran `bpjs.kontrol_last_run`).
--
-- Bentuknya `"YYYYMM"` dan bukan nama bulan, karena `bulanJatuhTempo()`
-- membandingkannya sebagai STRING: `"YYYYMM"` salah satu dari sedikit bentuk
-- tanggal yang urutan leksikalnya sama dengan urutan waktunya.
INSERT INTO app_setting (k, v) VALUES
  ('farmasi.bulanan_last_run', '')
ON DUPLICATE KEY UPDATE k = k;

-- -----------------------------------------------------------------------------
-- Isi pesan
-- -----------------------------------------------------------------------------
--
-- `{rincian_mutu}` ditaruh SESUDAH angka pokoknya, bukan di antaranya: ketiga
-- angka "yang tidak" hanya bisa dinilai kalau pembaginya sudah terbaca lebih
-- dulu. 175 resep belum diserahkan berarti hal yang sangat berbeda pada bulan
-- 685 resep dan pada bulan 3.000 resep.
--
-- `{jumlah_pasien}` DAN `{jumlah_kunjungan}` keduanya disebut, dengan label yang
-- membedakannya secara tegas -- selisihnya terukur 15%, dan label "pasien" pada
-- angka kunjungan berbohong sebanyak itu setiap bulan.
INSERT INTO app_setting (k, v) VALUES
  ('farmasi.template_bulanan',
   '*Rekap Farmasi Bulanan*\n{nama_rs}\n\nPeriode : {bulan_rekap}\n\n*Resep*\nJumlah resep : {jumlah_resep}\nPasien berbeda : {jumlah_pasien}\nKunjungan : {jumlah_kunjungan}\nBaris obat : {jumlah_item}\nRacikan : {jumlah_racikan}\nSudah diserahkan : {jumlah_diserahkan}\nNilai obat : {nilai_obat}\n\n*Perlu ditindaklanjuti*\n{rincian_mutu}\n\n*Barang*\n{rincian_barang}\n\nRekap otomatis, dikirim {tanggal}.')
ON DUPLICATE KEY UPDATE k = k;

-- Bulan tanpa SATU PUN kegiatan farmasi. Bawaannya KOSONG = sengaja diam.
--
-- Alasan yang sama dengan `farmasi.template_darurat_kosong` dan
-- `farmasi.template_penjualan_rekap_kosong`: pesan yang isinya "tidak ada apa-apa"
-- berhenti dibaca, dan sejak itu yang sungguhan ikut tidak terbaca.
--
-- Di sini keadaannya jauh lebih jarang daripada pada rekap harian -- rekap harian
-- resep terukur diam setiap hari Minggu, sementara bulan yang NOL resep, NOL
-- pengadaan, NOL pemesanan, NOL hibah, DAN nol penjualan sekaligus berarti apotek
-- benar-benar tutup sebulan penuh. Justru karena itu mengisinya masuk akal: pesan
-- yang cuma muncul pada keadaan seaneh itu tidak akan pernah jadi kebisingan.
INSERT INTO app_setting (k, v) VALUES
  ('farmasi.template_bulanan_kosong', '')
ON DUPLICATE KEY UPDATE k = k;
