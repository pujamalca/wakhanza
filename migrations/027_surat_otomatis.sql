-- 027_surat_otomatis.sql
-- SURAT SAKIT OTOMATIS: berkas yang dikirim TANPA ada manusia yang melihatnya.
--
-- `migrations/026` membuat surat bisa dikirim sebagai PDF, tapi selalu oleh
-- staf yang menekan tombol untuk satu pasien. Yang ditambahkan di sini adalah
-- pemicunya: begitu dokter menyimpan surat keterangan sakit di SIMRS Khanza,
-- suratnya berangkat sendiri.
--
-- ---------------------------------------------------------------------------
-- TIDAK ada tabel baru, DAN tidak ada watermark -- keduanya disengaja
-- ---------------------------------------------------------------------------
-- Sepuluh pemicu lain memakai `poll_cursor`: proses sampai waktu T, lain kali
-- mulai dari T. Itu MUSTAHIL benar di sini, dan sebabnya ada di bentuk tabel
-- Khanza-nya: `suratsakit` cuma punya lima kolom (`no_surat`, `no_rawat`,
-- `tanggalawal`, `tanggalakhir`, `lamasakit`) dan tidak satu pun stempel waktu.
--
-- Yang tersisa sebagai penanda urutan cuma `no_surat`, dan tanggal di dalamnya
-- BUKAN tanggal barisnya tersimpan. Dibuktikan dari sumber Khanza sendiri --
-- `SuratSakit.java` merakit nomornya dari kotak "Tanggal Awal" pada saat nomor
-- dibuatkan -- dan diukur atas 18 baris di database ini: tanggal itu cocok
-- dengan `tanggalawal` pada 13 baris dan dengan tanggal kunjungan pada 15,
-- jadi tidak andal keduanya.
--
-- Watermark di atas nomor yang tidak monoton terhadap urutan penyimpanan akan
-- MELEWATI surat secara permanen: tanpa galat, tanpa baris `outbox`, tanpa
-- satu pun tanda di layar. Kelas kegagalan yang sama persis dengan prefiks
-- `nobooking` pada pembatalan BPJS. Karena itu jalur ini kelas PINDAI: jendela
-- ±N hari yang dibaca ulang tiap siklus, dedup murni lewat kunci idempoten
-- yang ditegakkan `uq_idem` di mesin database.

-- ---------------------------------------------------------------------------
-- Sakelar BERTINGKAT, dan keduanya perlu
-- ---------------------------------------------------------------------------
-- `administrasi.enabled` menjawab "boleh mengirim surat lewat WhatsApp?" --
-- pertanyaan kebijakan yang harus dijawab rumah sakit lebih dulu (lihat 026).
-- Yang ini menjawab "boleh mengirimnya TANPA staf menekan tombol?", dan itu
-- pertanyaan yang baru masuk akal sesudahnya. Pola yang sama dengan
-- `bpjs.batal_enabled` di bawah `bpjs.enabled`.
--
-- Yang membuat sakelar kedua ini berat sendiri: sepuluh kanal lain yang
-- berjalan otomatis semuanya mengirim KABAR, yang salahnya berumur sekejap.
-- Yang ini mengirim BERKAS berisi nama, umur, alamat, dan nomor rekam medis --
-- dan berkas yang telanjur diterima tidak bisa ditarik kembali.
INSERT INTO app_setting (k, v) VALUES
  ('administrasi.auto_enabled', '0'),

-- ---------------------------------------------------------------------------
-- LANTAI aktivasi -- yang mencegah "hari pertama membongkar arsip"
-- ---------------------------------------------------------------------------
-- Diisi tanggal hari ini (YYYY-MM-DD) setiap kali sakelarnya DINYALAKAN, dan
-- jendela pindai tidak pernah turun di bawahnya. Tanpa ini, menyalakan
-- sakelarnya berarti setiap surat di dalam jendela -- termasuk milik pasien
-- yang sudah pulang seminggu lalu -- langsung jadi berkas WhatsApp pada siklus
-- berikutnya. Pelajaran `LAB_REQUEST`, yang bawaannya nonaktif justru supaya
-- pemicu yang baru menyala tidak mengirim sebulan penuh sekaligus.
--
-- Kosong sejak migrasi ini, dan itu BUKAN "tanpa lantai": selama
-- `auto_enabled` masih '0' tidak ada satu siklus pun yang berjalan, dan
-- menyalakannya lewat dashboard mengisi kolom ini sebelum sakelarnya berlaku.
  ('administrasi.auto_sejak', ''),

-- ---------------------------------------------------------------------------
-- Lebar jendela, DUA arah
-- ---------------------------------------------------------------------------
-- Arah maju bukan kehati-hatian: surat yang ditulis hari ini untuk istirahat
-- mulai pekan depan bernomor lebih BESAR daripada prefiks hari ini, jadi
-- jendela yang berhenti di hari ini membuang persis surat-surat itu. Diukur di
-- database ini, `tanggalawal` mendahului kunjungan sampai 6 hari.
--
-- Arah mundur memberi kesempatan kedua pada siklus yang gagal (worker mati,
-- MariaDB terkunci SIMRS) tanpa perlu mekanisme percobaan ulang tersendiri.
  ('administrasi.auto_lookback_hari', '7'),

-- ---------------------------------------------------------------------------
-- Kuota per siklus -- syarat hidup, bukan penghematan
-- ---------------------------------------------------------------------------
-- Satu surat = satu peluncuran Chromium (~480 ms) DI DALAM proses worker, yang
-- juga memegang sesi WhatsApp. Chromium yatim di proses itulah yang pernah
-- menjatuhkannya ke crash loop 29 kali beruntun. Kelebihannya tidak dibuang --
-- ia dikirim pada siklus berikutnya lima menit lagi.
  ('administrasi.auto_max_per_siklus', '10')
ON DUPLICATE KEY UPDATE v = v;
