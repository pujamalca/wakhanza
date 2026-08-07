-- 028_pengadaan.sql
-- PENGADAAN OBAT, ALKES & BHP MEDIS -- nota pembelian langsung dari pemasok.
--
-- Sumbernya menu "Transaksi Pengadaan Obat, Alkes & BHP Medis" di Khanza
-- (`src/inventory/DlgPembelian.java`), yang menulis satu baris `pembelian`
-- berikut sekian baris `detailbeli`. Fitur farmasi KEEMPAT, dan arah pemicunya
-- melengkapi ketiga yang sudah ada:
--
--   NOTIFIKASI FARMASI (016)  dipicu kejadian di `sik`  (resep divalidasi/diserahkan)
--   BALASAN STOK       (019)  dipicu pesan MASUK        (ada yang bertanya)
--   DARURAT STOK       (021)  dipicu WAKTU              (jadwal jatuh tempo)
--   PENGADAAN          (ini)  dipicu kejadian di `sik`  (pembelian disimpan)
--
-- Bentuknya paling dekat ke 016, tapi dengan satu perbedaan yang menentukan
-- seluruh implementasinya: `pembelian` TIDAK punya kolom jam sama sekali --
-- hanya `tgl_beli` bertipe DATE, dan tanggal itu DIPILIH staf (tanggal nota
-- pemasok), bukan diisi jam server. Watermark karena itu mustahil benar, jadi
-- ia kelas PINDAI seperti SURAT_SAKIT (027): jendela yang dibaca ulang tiap
-- siklus, dedup murni lewat kunci idempoten.
--
-- TIDAK ADA SATU PUN DATA PASIEN pada pemicu ini, dan tidak bisa ada --
-- `pembelian`/`detailbeli` tidak punya satu kolom pun yang menautkannya dengan
-- seorang pasien. Itu yang membuatnya satu kategori dengan DARURAT STOK, dan
-- karena itu sakelarnya berdiri sendiri dari `farmasi.enabled` yang berat justru
-- karena notifikasi resep memuat identitas pasien.

-- ---------------------------------------------------------------------------
-- farmasi_target.terima_pengadaan -- kolom KEEMPAT, dan sekali lagi TERPISAH
-- ---------------------------------------------------------------------------
-- Tabel ini kini menjawab EMPAT pertanyaan berbeda tentang satu tujuan:
--
--   is_active            ke mana notifikasi resep dikirim
--   boleh_tanya          siapa yang boleh membuat nomor RS menjawab
--   terima_darurat_stok  siapa yang menerima peringatan persediaan
--   terima_pengadaan     siapa yang menerima nota pembelian
--
-- Alasannya sama persis dengan yang membuat 020 memisahkan `boleh_tanya` dan
-- 021 memisahkan `terima_darurat_stok`, dan di sini pemisahannya justru paling
-- tajam: nota pembelian memuat HARGA BELI dari pemasok, yang punya nilai dagang
-- tersendiri. Grup shift apotek sangat wajar perlu tahu tiap resep masuk tanpa
-- ikut membaca harga yang dibayar RS ke pemasoknya; sebaliknya kepala instalasi
-- atau bagian pengadaan justru HANYA perlu yang ini.
--
-- Menggabungkannya dengan `is_active` akan membuat pilihan itu hilang, dan
-- pilihan yang hilang adalah pelajaran yang sudah dibayar dua kali di tabel yang
-- sama ini.
--
-- DEFAULT 0 -- tidak satu pun tujuan lama mulai menerima nota pembelian tanpa
-- ada yang memutuskannya di dashboard.
ALTER TABLE farmasi_target
  ADD COLUMN terima_pengadaan TINYINT(1) NOT NULL DEFAULT 0 AFTER terima_darurat_stok;

-- ---------------------------------------------------------------------------
-- Pengaturan
-- ---------------------------------------------------------------------------
INSERT INTO app_setting (k, v) VALUES

-- Sakelar utama MATI secara bawaan, konsisten dengan seluruh fitur yang
-- mengirim WhatsApp atas inisiatifnya sendiri. BERDIRI SENDIRI dari
-- `farmasi.enabled`, dengan alasan yang sama seperti `farmasi.darurat_enabled`:
-- notifikasi resep memuat data PASIEN dan itu yang membuat sakelarnya berat,
-- sementara nota pembelian tidak menyebut seorang pasien pun. RS yang memutuskan
-- belum mau data pasien mengalir ke grup tetap boleh memakai yang ini.
('farmasi.pengadaan_enabled', '0'),

-- LANTAI aktivasi -- diisi tanggal hari ini tiap kali sakelarnya dinyalakan.
--
-- Tanpa ini, menyalakan sakelar berarti seluruh isi jendela (bawaannya tujuh
-- hari ke belakang) langsung jadi pesan WhatsApp pada siklus berikutnya --
-- termasuk pembelian yang sudah diurus tuntas minggu lalu. Pelajaran yang sama
-- dengan `administrasi.auto_sejak` (027) dan dengan LAB_REQUEST yang bawaannya
-- nonaktif.
--
-- Konsekuensi yang HARUS disadari, dan yang dikatakan halamannya di depan staf:
-- faktur bernomor sebelum hari aktivasi tidak pernah terkirim otomatis,
-- selamanya.
('farmasi.pengadaan_sejak', ''),

-- Berapa hari ke belakang DAN ke depan yang dipindai ulang tiap siklus.
--
-- Dua arah, dan arah majunya bukan kehati-hatian: prefiks `no_faktur` dirakit
-- Khanza dari kotak Tanggal Beli yang dipilih staf, jadi staf yang mengubah
-- tanggalnya SEBELUM menekan tombol nomor menghasilkan faktur bernomor lebih
-- besar daripada prefiks hari ini. Uraian lengkapnya di khanza/pengadaan.ts.
('farmasi.pengadaan_lookback_hari', '7'),

-- Kuota per siklus. Kelebihannya dikirim siklus berikutnya, TIDAK dibuang.
--
-- Diukur: 2,21 faktur per hari aktif di RS ini, jadi angka ini tidak akan pernah
-- menggigit dalam pemakaian biasa. Ia ada untuk keadaan yang tidak biasa --
-- entri borongan setelah libur panjang, atau jendela yang baru dilebarkan --
-- supaya satu siklus tidak berubah jadi belasan pesan beruntun ke grup yang
-- sama. Pola beruntun itu persis yang memicu deteksi spam WhatsApp (PRD F5.2),
-- dan yang diblokir adalah SATU-SATUNYA nomor rumah sakit.
('farmasi.pengadaan_max_per_siklus', '5'),

-- Apakah harga beli ikut dicetak di daftar barang.
--
-- MENYALA secara bawaan, berbeda dari kebanyakan sakelar di proyek ini, dan itu
-- disengaja: yang diminta adalah nota pembelian, dan nota tanpa harga bukan nota
-- -- gudang memakainya untuk mencocokkan barang yang datang dengan tagihan
-- pemasok. Kunci ini ada untuk MEMATIKAN harga, bukan untuk menambah satu
-- langkah lagi sebelum fiturnya berguna; yang menahan seluruhnya tetap
-- `farmasi.pengadaan_enabled` yang mati.
--
-- Saat mati, kolom harganya TIDAK di-SELECT sama sekali (lihat
-- khanza/pengadaan.ts) -- bentuk yang sama dengan `administrasi.sertakan_diagnosa`:
-- merendernya jadi mustahil, bukan sekadar terlarang (§5.2).
('farmasi.pengadaan_harga', '1'),

-- Isi pesannya. `{daftar_barang}` dirakit core/pengadaan.ts (banyak baris, tiap
-- nama barang dan satuan sudah lewat sanitizeValue) -- lihat MULTILINE_VARIABLES.
--
-- Tidak ada satu pun variabel pasien di sini, dan tidak ada yang tersedia untuk
-- ditambahkan -- lihat PENGADAAN_TEMPLATE_VARIABLES di core/template.ts.
('farmasi.template_pengadaan',
 '*Pengadaan Barang Medis*\n{nama_rs}\n\nNo. Faktur : {no_faktur}\nTanggal : {tgl_beli}\nPemasok : {nama_suplier}\nGudang : {nama_gudang}\nPetugas : {nama_petugas}\n\n*Barang ({jumlah_item}):*\n{daftar_barang}\n\nTotal : {total}\nPotongan : {potongan}\nPPN : {ppn}\n*Tagihan : {tagihan}*');
