-- 044_erm_penilaian.sql
-- ERM / PENILAIAN UMUM -- pemicu pertama yang memberitakan sesuatu yang TIDAK
-- terjadi.
--
-- ===========================================================================
-- Kenapa ini kelas pemicu yang berbeda dari keenam belas sebelumnya
-- ===========================================================================
--
-- Setiap pemicu di sistem ini sampai sekarang berangkat dari sesuatu yang ADA:
-- baris pendaftaran muncul, resep divalidasi, nota tersimpan, hasil lab selesai.
-- Bahkan pembatalan penjualan (migrations/040), yang memberitakan baris yang
-- LENYAP, tetap berangkat dari baris yang pernah ada dan tercatat di buku pantau.
--
-- Yang ini berangkat dari KETIADAAN: pasien terdaftar dengan `status_poli =
-- 'Baru'`, dan asesmen awal keperawatannya tidak pernah dibuat. Tidak ada baris
-- yang muncul untuk dipicu, dan tidak akan pernah ada -- justru ketiadaannya
-- yang jadi kabarnya.
--
-- Akibat langsungnya: TIDAK ADA watermark dan tidak ada kelas sisip yang mungkin.
-- Yang bisa menjawabnya cuma membaca ulang seluruh hari itu pada jam yang
-- ditentukan, lalu membandingkan dua tabel. Kelasnya WAKTU, sama dengan DARURAT
-- STOK dan kedua rekap farmasi.
--
-- ===========================================================================
-- Yang benar-benar BARU di sini: BANYAK JAM dalam sehari
-- ===========================================================================
--
-- Ketiga rekap yang sudah ada berbunyi tepat sekali sehari, dan penandanya
-- menyimpan TANGGAL (`farmasi.penjualan_rekap_last_run` dan sebangsanya).
-- Bentuk itu rusak begitu ada dua jam: rekap 13:00 menulis "hari ini", lalu
-- 19:30 membaca penanda yang masih berbunyi "hari ini" dan tidak pernah
-- berangkat. Tanpa satu pun galat.
--
-- Karena itu penandanya di sini menyimpan TANGGAL BERIKUT SLOTNYA
-- ("2026-08-13 19:30"), dan kejatuhtempoannya dihitung di
-- `core/rekapJadwal.ts`'s `slotJatuhTempo()` -- bukan lewat `jatuhTempoHarian()`
-- yang sengaja TIDAK disentuh, karena ia dipakai tiga fitur yang sedang berjalan
-- di produksi.
--
-- ===========================================================================
-- Kenapa dua jam, dan kenapa 13:00 + 19:30 -- DIUKUR
-- ===========================================================================
--
-- Jeda dari pendaftaran ke asesmen: rata-rata 119 menit, maksimum 3.756 menit
-- (62 jam), dan 7 asesmen diisi pada HARI YANG BERBEDA dari pendaftarannya.
-- Jadi rekap tunggal di sore hari akan menuduh pasien "belum diisi" pada saat
-- perawatnya memang belum sempat -- peringatan yang salah, dan peringatan yang
-- salah lebih cepat diabaikan daripada peringatan yang tidak ada.
--
-- Sebaran jam pengisian (90 hari): naik dari pukul 10, memuncak di 18:00 (31)
-- dan 19:00 (26), lalu jatuh ke 5 pada pukul 20 dan NOL sesudahnya.
--
-- Karena itu dua jam dengan peran yang berbeda, dan halamannya mengatakan itu:
--   13:00  PENGINGAT  -- masih di tengah hari, masih bisa dikerjakan
--   19:30  HITUNGAN AKHIR -- pengisian praktis sudah berhenti
--
-- Keduanya BAWAAN, bukan paksaan: `erm.penilaian_jam` menerima daftar berapa pun.

-- ---------------------------------------------------------------------------
-- erm_target -- tujuan, TABEL SENDIRI
-- ---------------------------------------------------------------------------
-- Alasannya sama persis dengan yang membuat `bpjs_target` tidak menumpang
-- `farmasi_target` (migrations/024): halaman /farmasi menampilkan SELURUH baris
-- tabel itu sebagai "tujuan apotek", jadi grup keperawatan akan muncul di sana
-- berikut enam centang yang tidak berlaku baginya -- dan menghapusnya dari
-- halaman itu diam-diam mematikan rekap ERM yang tidak ditampilkan di sana.
--
-- Di sini pemisahannya bahkan lebih jelas daripada BPJS: penerimanya PERAWAT,
-- bukan petugas apotek maupun loket. Tidak ada satu pun centang di
-- `farmasi_target` yang artinya berlaku untuk mereka.
--
-- Alamat yang SAMA boleh ada di kedua tabel -- itu dua keputusan berbeda yang
-- kebetulan menuju alamat yang sama.
CREATE TABLE erm_target (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- 'grup' | 'personal', dinormalisasi core/farmasiTarget.ts sebelum disimpan.
  jenis      ENUM('grup','personal') NOT NULL,
  -- JID LENGKAP. VARCHAR(64) mengikuti outbox.chat_id; VARCHAR(20) milik
  -- phone_e164 tidak muat untuk JID grup yang 24 karakter (migrations/016).
  chat_id    VARCHAR(64) NOT NULL,
  label      VARCHAR(80) NOT NULL,

  -- Satu centang untuk sekarang, dan sengaja TIDAK dinamai `is_active` saja.
  --
  -- Submenu ERM berikutnya (penilaian gigi, mata, kebidanan) akan menambah
  -- centangnya sendiri di tabel ini, persis seperti farmasi_target tumbuh dari
  -- satu jadi enam. Nama yang menyebut ISINYA sejak awal membuat kolom kedua
  -- tinggal ditambahkan; nama `is_active` akan memaksa penggantian nama pada
  -- tabel yang sudah berisi baris pilihan staf.
  terima_penilaian_umum TINYINT(1) NOT NULL DEFAULT 0,

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

-- ---------------------------------------------------------------------------
-- Pengaturan
-- ---------------------------------------------------------------------------
INSERT INTO app_setting (k, v) VALUES

-- Sakelar utama. MATI, konsisten dengan farmasi.enabled / bpjs.enabled /
-- autoreply.enabled. Di sini alasannya khusus: isi rekapnya adalah DAFTAR NAMA
-- PASIEN berikut nomor rekam medisnya, dikirim ke sebuah grup WhatsApp yang
-- keanggotaannya diatur DI LUAR sistem ini. Itu keputusan privasi rumah sakit,
-- bukan keputusan yang aman menyala karena kebetulan termigrasi.
('erm.enabled', '0'),

-- === Penilaian umum ========================================================
('erm.penilaian_enabled', '0'),

-- Daftar jam, dipisah koma. Bentuk yang sama dengan
-- `privacy.sensitive_poli_codes` dan `bpjs.kontrol_hari_sebelum`, jadi staf yang
-- pernah menyunting salah satunya tidak perlu belajar bentuk kedua.
--
-- Dua jam bawaan dengan peran berbeda -- lihat pengukurannya di kepala berkas.
('erm.penilaian_jam', '13:00,19:30'),

-- Hari yang direkap, dihitung mundur dari hari kirim. 0 = hari itu juga.
--
-- 0 dan bukan 1, dan itu bukan penyalinan dari rekap farmasi: kedua jam bawaan
-- di atas jatuh pada hari kerja yang SAMA dengan pendaftarannya, dan rekap yang
-- menyebut kemarin tidak bisa ditindaklanjuti siapa pun hari ini. Rekap
-- penjualan memakai 0 dengan alasan yang sama; rekap yang berjam pagi harus
-- memakai 1, dan halamannya memperingatkan kombinasi itu.
('erm.penilaian_offset_hari', '0'),

-- Kolom mana yang harus terisi supaya sebuah asesmen dianggap LENGKAP.
--
-- Empat tanda vital, dan `bb`/`tb` sengaja DI LUAR. Itu diukur, bukan dipilih:
-- dari 191 asesmen milik pasien Baru dalam 90 hari, `tb` kosong pada 173 (91%)
-- dan `bb` pada 144 (75%). Memasukkannya membuat golongan "terisi sebagian"
-- menelan hampir seluruh golongan "lengkap" -- dan pembedaan yang tidak pernah
-- membedakan apa pun sama saja dengan tidak ada.
--
-- Daftar-izinnya ditegakkan KODE (`KOLOM_INTI` di khanza/penilaianAwal.ts),
-- bukan oleh kepercayaan pada isi kolom ini: nilainya masuk ke nama kolom SQL,
-- dan nama kolom tidak bisa jadi parameter terikat.
('erm.penilaian_kolom_inti', 'td,nadi,suhu,rr'),

-- Kode poli yang dicakup. KOSONG = seluruh poli.
--
-- Kosong adalah perilaku yang benar HARI INI dan terukur: dari 550 pasien Baru
-- dalam 90 hari, `kd_poli` bernilai UMUM pada 550. Jadi kosong dan 'UMUM'
-- menghasilkan daftar yang sama persis.
--
-- Kunci ini ada untuk hari Poliklinik Gigi mulai dipakai: tanpanya, pasien gigi
-- akan dilaporkan "belum mengisi asesmen umum" padahal yang wajib untuknya
-- asesmen gigi -- dan itu tidak menghasilkan galat, cuma daftar yang salah.
('erm.penilaian_poli', ''),

-- Berapa banyak pasien yang disebut namanya di dalam satu pesan.
--
-- Ada karena pesan WhatsApp yang kelewat panjang dipotong DIAM oleh pihak yang
-- jauh, bukan ditolak sebagai galat (pelajaran migrations/022 -- batas 12.000
-- karakter itu DIUKUR lewat kiriman sungguhan). Sisanya diringkas jadi "dan N
-- pasien lain".
--
-- 40 dipilih dari laju sesungguhnya: 5-16 pasien Baru per hari, puncak 16. Jadi
-- pada pemakaian normal batas ini TIDAK PERNAH menggigit, dan ia murni jaring
-- pengaman untuk hari yang tidak wajar.
('erm.penilaian_max_baris', '40'),

-- Tingkat rincian. 'penuh' = nama + no. RM per pasien; 'ringkas' = angka saja.
--
-- Bawaannya 'penuh', dan itu berbeda dari `farmasi.stok_rincian_umum` yang
-- justru bawaannya ringkas. Bedanya bukan kelalaian: di sana yang ringkas TETAP
-- berguna (tersedia/kosong menjawab pertanyaan penanyanya), sementara di sini
-- "5 pasien belum diisi" tidak memberi tahu perawat mana pun siapa yang harus
-- ditemui -- rekapnya jadi pemberitahuan yang mustahil ditindaklanjuti.
--
-- Yang menahan paparannya bukan kunci ini melainkan `erm.penilaian_enabled`
-- yang mati. 'ringkas' disediakan untuk RS yang memutuskan nama pasien tidak
-- boleh beredar di grup, dan tetap ingin tahu angkanya.
('erm.penilaian_rincian', 'penuh'),

-- Template. {daftar_pasien} multi-baris, dirakit core/penilaianRekap.ts yang
-- memanggil sanitizeValue() sendiri per nama -- syarat untuk MULTILINE_VARIABLES.
('erm.template_penilaian',
 '*Asesmen Awal Keperawatan*\n{nama_rs}\n\nTanggal : {tanggal_rekap}\nPasien baru : {jumlah_total}\nSudah lengkap : {jumlah_lengkap}\nBelum diisi : {jumlah_belum}\nTerisi sebagian : {jumlah_sebagian}\n\n{daftar_pasien}\n\nMohon dilengkapi melalui SIMRS.'),

-- Pesan saat SELURUH asesmen hari itu sudah lengkap. KOSONG = diam.
--
-- Alasan yang sama dengan `farmasi.template_darurat_kosong`: pesan harian yang
-- isinya "tidak ada apa-apa" berhenti dibaca dalam sepekan, dan sejak itu yang
-- sungguhan ikut tidak terbaca.
--
-- Di sini "kosong" ditentukan JUMLAH YANG PERLU DIISI, bukan jumlah pasiennya:
-- hari tanpa satu pun pasien baru dan hari yang seluruh asesmennya sudah
-- lengkap sama-sama tidak menuntut tindakan apa pun.
('erm.template_penilaian_kosong', ''),

-- Penanda slot terakhir yang sudah berbunyi: "2026-08-13 19:30".
--
-- CUMA penghemat query, BUKAN penentu kebenaran -- yang mencegah kirim ganda
-- adalah kunci idempoten yang memuat tanggal + slot + chat_id, ditegakkan
-- `uq_idem` di mesin database. Karena itu ia dimajukan SESUDAH berhasil, tidak
-- pernah sebelum (pelajaran `bpjs.kontrol_last_run`).
('erm.penilaian_last_run', '')

ON DUPLICATE KEY UPDATE v = v;
