-- 031_hibah.sql
-- HIBAH OBAT & BHP -- nota barang medis yang DITERIMA sebagai pemberian.
--
-- Sumbernya menu "Hibah Obat & BHP" di Khanza
-- (`src/inventory/InventoryHibahObatBHP.java`), yang menulis satu baris
-- `hibah_obat_bhp` berikut sekian baris `detailhibah_obat_bhp`.
--
--   NOTIFIKASI FARMASI (016)  dipicu kejadian di `sik`  (resep divalidasi/diserahkan)
--   BALASAN STOK       (019)  dipicu pesan MASUK        (ada yang bertanya)
--   DARURAT STOK       (021)  dipicu WAKTU              (jadwal jatuh tempo)
--   PENGADAAN          (028)  dipicu kejadian di `sik`  (pembelian disimpan)
--   SURAT PEMESANAN    (030)  dipicu kejadian di `sik`  (pesanan disimpan)
--   HIBAH              (ini)  dipicu kejadian di `sik`  (penerimaan hibah disimpan)
--
-- Nomornya 031, bukan 029 seperti saat berkas ini pertama ditulis: 030 sudah
-- terlanjur diterapkan lebih dulu di mesin ini, dan berkas migrasi yang urutan
-- namanya berbeda dari urutan penerapannya adalah berkas yang menyesatkan
-- pembaca berikutnya. Baris `schema_migrations`-nya ikut diganti namanya.
--
-- PENGADAAN dan SURAT PEMESANAN adalah PASANGAN (pesanan dikirim -> barang
-- datang). Hibah bukan tahap ketiga dari alur itu melainkan jalur pemasukan
-- barang yang berdiri sendiri: tidak ada pesanan yang mendahuluinya, dan tidak
-- ada yang ditagihkan sesudahnya.
--
-- Sengaja dibentuk semirip mungkin dengan 028: kelas PINDAI lewat sebab yang
-- sama (`hibah_obat_bhp` tidak punya stempel waktu sama sekali -- hanya
-- `tgl_hibah` bertipe DATE yang DIPILIH staf), pemangkas prefiks pada PRIMARY
-- KEY, kuota per siklus, dan lantai aktivasi. Aturan bersamanya benar-benar
-- DIPAKAI BERSAMA di kode (`core/notaBarang.ts`, `core/jendelaPindai.ts`), bukan
-- disalin.
--
-- TIGA hal yang BERBEDA dari 028, dan ketiganya berasal dari bentuk tabelnya:
--
--   1. Tidak ada potongan/PPN/tagihan -- tidak ada yang dibayar. Yang ada
--      sebagai gantinya DUA penilaian atas barang yang sama: `totalhibah`
--      (disebut pemberi) dan `totalnilai` (diakui RS, dan inilah yang dijurnal
--      Khanza sebagai PERSEDIAAN HIBAH OBAT & BHP / PENDAPATAN HIBAH).
--   2. Pemberinya dari `pemberihibah`, bukan `datasuplier` -- dan kolomnya
--      NULLABLE, jadi sebuah hibah memang boleh tidak menunjuk pemberi mana pun.
--   3. `kode_pemberi` bisa berisi penanda `'-'` alih-alih nama (terbukti pada
--      baris H0001 di database uji), pola yang sama dengan `penjab.png_jawab`.
--
-- TIDAK ADA SATU PUN DATA PASIEN pada pemicu ini, dan tidak bisa ada --
-- `hibah_obat_bhp`/`detailhibah_obat_bhp` tidak punya satu kolom pun yang
-- menautkannya dengan seorang pasien. Itu yang membuatnya satu kategori dengan
-- PENGADAAN dan DARURAT STOK, dan karena itu sakelarnya berdiri sendiri dari
-- `farmasi.enabled` yang berat justru karena notifikasi resep memuat identitas
-- pasien.
--
-- ---------------------------------------------------------------------------
-- YANG HARUS DIKETAHUI SEBELUM MENYALAKANNYA
-- ---------------------------------------------------------------------------
-- `hibah_obat_bhp` KOSONG di kedua database di mesin ini (`alca` dan `sik`),
-- sama seperti `permintaan_radiologi` saat RAD_REQUEST dibuat. Query-nya
-- dibuktikan terhadap salinan uji berisi baris sungguhan (`sik-dev-alca`,
-- `sik-ridda-dev` -- 6 baris hibah, 14 baris rincian), TAPI belum pernah
-- berjalan atas satu pun hibah yang benar-benar dicatat rumah sakit ini.
-- Sebelum menyalakannya, periksa lebih dulu lewat `npm run dryrun:hibah` bahwa
-- barisnya memang terbaca.

-- ---------------------------------------------------------------------------
-- farmasi_target.terima_hibah -- dan sekali lagi TERPISAH
-- ---------------------------------------------------------------------------
-- Tabel ini kini menjawab ENAM pertanyaan berbeda tentang satu tujuan:
--
--   is_active            ke mana notifikasi resep dikirim
--   boleh_tanya          siapa yang boleh membuat nomor RS menjawab
--   terima_darurat_stok  siapa yang menerima peringatan persediaan
--   terima_pengadaan     siapa yang menerima nota pembelian
--   terima_pemesanan     siapa yang menerima nota pesanan ke pemasok
--   terima_hibah         siapa yang menerima nota penerimaan hibah
--
-- Kolomnya sengaja TIDAK diberi nomor urut di komentar kode: penomorannya sudah
-- terlanjur menyimpang (028 menyebut dirinya "KEEMPAT", 030 menyebut dirinya
-- "KEENAM"), dan tiap kolom baru menambah satu tempat lagi yang bisa salah
-- hitung tanpa ada yang menyadarinya. Daftar di atas yang mengikat.
--
-- Terpisah dari `terima_pengadaan`, dan itu bukan keseragaman melainkan
-- perbedaan yang nyata: nota pembelian memuat HARGA BELI dari pemasok, yang
-- punya nilai dagang tersendiri dan karena itu wajar dibatasi ke bagian
-- pengadaan. Nota hibah memuat nilai barang PEMBERIAN -- angka yang justru
-- sering perlu dilihat lebih luas (kepala instalasi, akuntansi, bahkan bagian
-- yang menyusun ucapan terima kasih ke pemberinya) sementara harga pemasok
-- tidak. Menggabungkan keduanya memaksa RS memilih satu daftar penerima untuk
-- dua jenis informasi yang batas kerahasiaannya berbeda.
--
-- DEFAULT 0 -- tidak satu pun tujuan lama mulai menerima nota hibah tanpa ada
-- yang memutuskannya di dashboard.
ALTER TABLE farmasi_target
  ADD COLUMN terima_hibah TINYINT(1) NOT NULL DEFAULT 0 AFTER terima_pengadaan;

-- ---------------------------------------------------------------------------
-- Pengaturan
-- ---------------------------------------------------------------------------
INSERT INTO app_setting (k, v) VALUES

-- Sakelar utama MATI secara bawaan. BERDIRI SENDIRI dari `farmasi.enabled` dan
-- dari `farmasi.pengadaan_enabled`: keduanya menjawab pertanyaan kebijakan yang
-- berbeda, dan RS yang sudah memutuskan satu belum tentu sudah memutuskan yang
-- lain.
('farmasi.hibah_enabled', '0'),

-- LANTAI aktivasi -- diisi tanggal hari ini tiap kali sakelarnya dinyalakan.
--
-- Tanpa ini, menyalakan sakelar berarti seluruh isi jendela langsung jadi pesan
-- WhatsApp pada siklus berikutnya. Pelajaran yang sama dengan
-- `farmasi.pengadaan_sejak` (028) dan `administrasi.auto_sejak` (027).
--
-- Konsekuensi yang HARUS disadari, dan yang dikatakan halamannya di depan staf:
-- hibah bernomor sebelum hari aktivasi tidak pernah terkirim otomatis,
-- selamanya.
('farmasi.hibah_sejak', ''),

-- Berapa hari ke belakang DAN ke depan yang dipindai ulang tiap siklus.
--
-- Dua arah, dengan alasan yang sama seperti pengadaan: prefiks `no_hibah`
-- dirakit Khanza dari kotak Tanggal yang dipilih staf, jadi staf yang mengubah
-- tanggalnya SEBELUM menekan tombol nomor menghasilkan baris bernomor lebih
-- besar daripada prefiks hari ini.
--
-- Bawaannya 7 sama seperti pengadaan, walau hibah jauh lebih jarang. Angka yang
-- lebih besar menggoda ("toh cuma beberapa baris"), tapi jendela adalah jumlah
-- hari yang dibaca ULANG tiap lima menit dan lantai aktivasinya sudah menjaga
-- arsip lama -- yang dibeli oleh jendela lebar cuma toleransi terhadap worker
-- yang mati berhari-hari, dan itu keadaan yang punya peringatannya sendiri.
('farmasi.hibah_lookback_hari', '7'),

-- Kuota per siklus. Kelebihannya dikirim siklus berikutnya, TIDAK dibuang.
('farmasi.hibah_max_per_siklus', '5'),

-- Apakah nilai barangnya ikut dicetak.
--
-- MENYALA secara bawaan, sama seperti `farmasi.pengadaan_harga`: yang diminta
-- adalah nota penerimaan barang, dan nilai barang adalah bagian dari nota itu --
-- ia yang dicocokkan gudang dengan berita acara serah terima dari pemberinya.
-- Kunci ini ada untuk MEMATIKAN nilai, bukan untuk menambah satu langkah lagi
-- sebelum fiturnya berguna; yang menahan seluruhnya tetap
-- `farmasi.hibah_enabled` yang mati.
--
-- Saat mati, kolom nilai PER BARANG tidak di-SELECT sama sekali (lihat
-- khanza/hibah.ts) -- merendernya jadi mustahil, bukan sekadar terlarang (§5.2).
--
-- Kedua TOTAL header tetap dibaca, persis seperti `tagihan` pada pengadaan.
-- Versi pertama memutus keduanya juga (alasannya terdengar lebih ketat: tidak
-- ada yang ditagihkan pada sebuah hibah), dan itu terbukti salah begitu
-- hasilnya dilihat -- templatenya menulis label kedua total sebagai baris
-- tersendiri, sehingga mematikan sakelarnya menghasilkan "Total nilai hibah :"
-- tanpa angka. Satu-satunya jalan keluarnya adalah menyuruh staf ikut
-- menyunting templatenya, dan invarian dua-langkah semacam itu berulang kali
-- terbukti gagal DIAM di proyek ini. RS yang tidak ingin satu pun angka beredar
-- menghapus {total_hibah} dan {total_diakui} dari templatenya.
('farmasi.hibah_nilai', '1'),

-- Isi pesannya. `{daftar_barang}` dirakit core/hibah.ts (banyak baris, tiap nama
-- barang dan satuan sudah lewat sanitizeValue) -- lihat MULTILINE_VARIABLES.
--
-- Kedua total disebut dengan nama yang dipakai Khanza di layarnya sendiri
-- ("Total Nilai Hibah" dan "Total Pengakuan Nilai Persediaan Hibah", disingkat
-- di sini supaya muat sebaris). Menyimpang dari istilah yang tertulis di layar
-- petugas akan membuat angka yang sama tampak sebagai dua hal berbeda.
--
-- Tidak ada satu pun variabel pasien di sini, dan tidak ada yang tersedia untuk
-- ditambahkan -- lihat HIBAH_TEMPLATE_VARIABLES di core/template.ts.
('farmasi.template_hibah',
 '*Penerimaan Hibah Obat & BHP*\n{nama_rs}\n\nNo. Hibah : {no_hibah}\nTanggal : {tgl_hibah}\nAsal hibah : {nama_pemberi}\nGudang : {nama_gudang}\nPetugas : {nama_petugas}\n\n*Barang ({jumlah_item}):*\n{daftar_barang}\n\nTotal nilai hibah : {total_hibah}\n*Nilai diakui : {total_diakui}*');
