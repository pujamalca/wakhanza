-- 040_penjualan.sql
-- PENJUALAN OBAT, ALKES & BHP -- nota penjualan apotek, saat DISIMPAN dan saat DIHAPUS.
--
-- Sumbernya menu "Transaksi Penjualan Obat, Alkes & BHP Medis" di Khanza
-- (`src/inventory/DlgPenjualan.java`), yang menulis satu baris `penjualan`
-- berikut sekian baris `detailjual`. Fitur farmasi KETUJUH, dan yang pertama
-- punya DUA arah kejadian atas satu baris yang sama:
--
--   PENGADAAN       (028)  barang MASUK dari pemasok      -- hanya "disimpan"
--   SURAT PEMESANAN (030)  pesanan DIKIRIM ke pemasok     -- hanya "disimpan"
--   HIBAH           (031)  barang MASUK tanpa pemasok     -- hanya "disimpan"
--   PENJUALAN       (ini)  barang KELUAR ke pembeli       -- "disimpan" DAN "dihapus"
--
-- ===========================================================================
-- YANG PALING PENTING: tabelnya PUNYA kolom pasien, dan kolom itu TIDAK DIBACA
-- ===========================================================================
--
-- Ketiga pemicu farmasi di atas aman dengan sendirinya -- `pembelian`,
-- `surat_pemesanan_medis`, dan `hibah_obat_bhp` tidak punya satu kolom pun yang
-- menautkannya dengan seorang pasien, jadi "tidak ada data pasien di sini"
-- adalah pernyataan tentang BENTUK TABELNYA, bukan tentang disiplin kodenya.
--
-- `penjualan` BERBEDA. Ia punya `no_rkm_medis` DAN `nm_pasien`, dan `detailjual`
-- punya nama obatnya. Digabung, keduanya adalah persis "obat APA yang diterima
-- SIAPA" -- hal yang komentar pembuka `khanza/stokObat.ts` ada untuk melarang,
-- dan yang membuat `resep_obat` tidak pernah boleh disentuh modul farmasi.
--
-- Diukur atas seluruh 16.787 baris di database ini:
--
--   no_rkm_medis   7 nilai berbeda; '000' pada 16.779 baris (99,95%)
--   nm_pasien     10 nilai berbeda; satu penanda tetap pada 16.545 baris
--
-- Jadi dalam pemakaian sungguhan ini penjualan bebas di loket apotek, bukan
-- penyerahan obat kepada pasien yang teridentifikasi. Tapi 8 baris MEMANG
-- membawa no. RM sungguhan -- artinya kolomnya bisa terisi, dan "hampir selalu
-- kosong" bukan jaminan apa pun terhadap baris berikutnya.
--
-- Karena itu keputusannya diambil di tingkat QUERY, bukan tingkat template:
-- `khanza/penjualan.ts` tidak pernah men-SELECT `no_rkm_medis` maupun
-- `nm_pasien`, dan `PENJUALAN_TEMPLATE_VARIABLES` tidak punya variabelnya.
-- Merender identitas pembeli karena itu bukan terlarang melainkan MUSTAHIL
-- (ARCHITECTURE §5.2) -- pola yang sama dengan `status_prb` pada surat kontrol
-- BPJS dan keenam kolom klinis pada `skdp_bpjs`.
--
-- Ini menahan diri, bukan melonggarkan: nota yang dikirim menyebut BARANG dan
-- RUPIAH, tidak pernah seorang pembeli pun.

-- ---------------------------------------------------------------------------
-- farmasi_target.terima_penjualan
-- ---------------------------------------------------------------------------
-- Penomoran kolom di tabel ini sudah terlanjur menyimpang (028 menyebut dirinya
-- "KEEMPAT", 030 "KEENAM"), jadi kolom ini sengaja TIDAK diberi nomor -- yang
-- mengikat adalah daftar PERTANYAANNYA, bukan urutannya.
--
-- Terpisah dari `terima_pengadaan` dan `terima_pemesanan` karena arah barangnya
-- berlawanan: keduanya menjawab "apa yang kita BELI dan berapa harganya dari
-- pemasok", sementara ini menjawab "apa yang kita JUAL dan berapa yang masuk".
-- Bagian pengadaan yang mencocokkan tagihan pemasok tidak punya urusan dengan
-- omzet loket, dan kasir yang perlu tahu tiap nota tidak punya urusan dengan
-- harga beli. Pemisahan yang digabung adalah pilihan yang hilang -- pelajaran
-- yang sudah dibayar tiga kali di tabel yang sama ini (020, 021, 028).
--
-- DEFAULT 0 -- tidak satu pun tujuan lama mulai menerima nota penjualan tanpa
-- ada yang memutuskannya di dashboard.
ALTER TABLE farmasi_target
  ADD COLUMN terima_penjualan TINYINT(1) NOT NULL DEFAULT 0 AFTER terima_hibah;

-- ---------------------------------------------------------------------------
-- penjualan_pantau -- BUKU INGATAN, dan tanpanya "dihapus" mustahil dideteksi
-- ---------------------------------------------------------------------------
-- Sebuah baris yang dihapus tidak meninggalkan apa pun untuk dibaca. Poller
-- yang cuma membaca `penjualan` karena itu buta terhadap penghapusan secara
-- struktural: yang hilang terlihat persis sama dengan yang tidak pernah ada.
-- Mendeteksinya MENUNTUT ingatan tentang apa yang dulu ada -- tidak ada jalan
-- lain, dan itulah satu-satunya alasan tabel ini ada.
--
-- ===========================================================================
-- Kenapa BUKAN `riwayat_barang_medis`, walau tabel itu MEMANG mencatat hapus
-- ===========================================================================
--
-- Ia menggoda, dan lebih menggoda daripada saat 028 menolaknya: di sini
-- `posisi='Penjualan'` DENGAN `status='Hapus'` benar-benar ada (54 baris,
-- 2024-04-20 s/d 2026-04-20), dan `keterangan`-nya memuat nomor notanya.
-- Ditolak karena TIGA hal yang terukur, dan ketiganya berdiri sendiri:
--
-- 1. `status='Hapus'` TIDAK berarti notanya dihapus. Dari 22 nota berbeda yang
--    punya baris Hapus, 5 MASIH ADA di `penjualan` -- itu satu barang yang
--    dikeluarkan dari nota yang tetap hidup, bukan nota yang dibatalkan. Yang
--    menjawab dengan benar cuma "apakah notanya masih ada", dan begitu kita
--    tetap harus memeriksa itu, tabel riwayatnya tidak menambah apa-apa.
--
-- 2. Biayanya diukur, dan ia tumbuh selamanya: `EXPLAIN` menghasilkan
--    `type=ALL` atas 96.958 baris (tidak ada indeks pada `tanggal`; satu-satunya
--    kunci di sana `kode_brng` dan `kd_bangsal`), 52-57 ms sekali baca, pada
--    tabel berisi 114.834 baris yang bertambah ~100 sehari. Bandingkan jendela
--    `penjualan` yang sudah dibaca pemicunya: `range PRIMARY`, 1 ms. Ingatan
--    kita sendiri menjawab pertanyaan yang sama tanpa menyentuh `sik` sekali pun.
--
-- 3. `keterangan`-nya memuat NAMA ORANG. `DlgPenjualan.java:4260` merakitnya
--    sebagai `no_nota + " " + kode_member + " " + nama_member`. Di sini fitur
--    membernya tidak dipakai sehingga yang tersimpan nomor nota telanjang
--    (54/54 cocok `^PJ[0-9]{11}$`), tapi begitu RS memakainya, membaca kolom itu
--    berarti membaca nama pembeli -- persis yang seluruh berkas ini hindari.
--
-- ===========================================================================
-- Kenapa "hilang dari jendela" SETARA DENGAN "dihapus", dan bukan tebakan
-- ===========================================================================
--
-- Jendelanya adalah rentang atas `nota_jual`, dan `nota_jual` adalah PRIMARY KEY
-- yang tidak pernah berubah. Jadi sebuah nota yang ada di buku ini, yang
-- nomornya jatuh DI DALAM jendela yang sedang dibaca, dan yang tidak
-- dikembalikan pembacaan itu, hanya bisa hilang karena barisnya memang tidak ada
-- lagi. Menggeser `tgl_jual` tidak memindahkannya keluar jendela -- yang
-- memangkas jendela adalah nomornya, bukan tanggalnya.
--
-- Syarat "DI DALAM jendela" itu yang menahan salah tafsir terbesarnya: nota
-- berumur delapan hari keluar sendiri dari jendela tujuh hari karena waktu
-- berjalan, dan tanpa syarat itu setiap nota yang menua akan dilaporkan
-- terhapus. Karena itu jendelanya dihitung SEKALI lalu diserahkan ke kedua
-- pembacaan -- lihat `worker/penjualanRunner.ts`.
--
-- `generasi` menutup satu celah yang jarang tapi senyap: Khanza menomori nota
-- dari `MAX(RIGHT(nota_jual,3))` untuk tanggal itu (`DlgPenjualan.java:3986`),
-- jadi menghapus nota TERAKHIR hari itu membuat nomornya dipakai ulang oleh
-- penjualan berikutnya. Tanpa penghitung ini, penjualan baru tersebut memakai
-- kunci idempoten yang sama persis dengan yang sudah dihapus, ditolak `uq_idem`
-- sebagai duplikat, dan tidak pernah dikabarkan -- tanpa satu pun galat.
CREATE TABLE IF NOT EXISTS penjualan_pantau (
  nota_jual     VARCHAR(20) NOT NULL,
  -- Naik satu tiap kali nomor yang sama dipakai lagi sesudah penghapusannya
  -- dikabarkan. Ikut ke dalam kunci idempoten saat > 0.
  generasi      INT         NOT NULL DEFAULT 0,
  -- Kapan notifikasi "disimpan" untuk generasi ini dibuat. Baris ini TIDAK
  -- pernah ada untuk nota yang tidak pernah dikabarkan, dan itu yang membuat
  -- penghapusan nota lama (sebelum lantai aktivasi) tidak pernah dilaporkan.
  dikabarkan_at DATETIME    NOT NULL,
  -- Terisi saat penghapusannya sudah dikabarkan. NULL = masih dipantau.
  hapus_at      DATETIME    NULL,
  PRIMARY KEY (nota_jual)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Pengaturan
-- ---------------------------------------------------------------------------
INSERT INTO app_setting (k, v) VALUES

-- Sakelar utama MATI, berdiri sendiri dari `farmasi.enabled`. Alasannya sama
-- dengan ketiga pemicu farmasi lain: notifikasi resep memuat data PASIEN dan itu
-- yang membuat sakelarnya berat, sementara nota penjualan tidak menyebut seorang
-- pembeli pun (lihat catatan privasi di atas).
--
-- YANG WAJIB DIBACA SEBELUM MENYALAKANNYA, dan ini yang membedakannya dari
-- ketiga pemicu farmasi lain: LAJUNYA. Diukur pada 60 hari terakhir, apotek ini
-- menerbitkan 16-46 nota per hari (33 pada 11 Agustus 2026). Bandingkan
-- pengadaan: 2,21 faktur per hari. Menyalakan ini berarti grup tujuan menerima
-- puluhan pesan sehari, dan itu keputusan yang harus diambil dengan angkanya di
-- depan mata -- halaman `/farmasi?tab=penjualan` menampilkannya.
('farmasi.penjualan_enabled', '0'),

-- LANTAI aktivasi -- diisi tanggal hari ini tiap kali sakelarnya dinyalakan.
-- Tanpa ini, menyalakan sakelar berarti seluruh isi jendela langsung jadi pesan
-- WhatsApp pada siklus berikutnya. Konsekuensi yang dikatakan halamannya di
-- depan staf: nota bernomor sebelum hari aktivasi tidak pernah terkirim
-- otomatis, selamanya -- DAN penghapusannya juga tidak pernah dikabarkan, karena
-- ia tidak pernah masuk buku pantau.
('farmasi.penjualan_sejak', ''),

-- Berapa hari ke belakang DAN ke depan yang dipindai ulang tiap siklus.
--
-- Di sini prefiks nota terbukti EKSAK terhadap `tgl_jual` -- 16.787 dari 16.787
-- baris cocok, 0 menyimpang ke kedua arah, sepanjang dua setengah tahun. Itu
-- pemangkas paling bersih di proyek ini (bandingkan pengadaan: 9 dari 910
-- menyimpang). Jendela dua arah karena itu bukan koreksi atas simpangan yang
-- terukur melainkan jaring pengaman terhadap yang belum pernah terjadi:
-- `Valid.autoNomer3` mengambil prefiksnya dari kotak Tanggal yang DIPILIH staf
-- (`DlgPenjualan.java:3986`), jadi nota bertanggal maju secara struktural
-- mungkin walau belum pernah muncul.
--
-- Arah mundur sekaligus menentukan berapa lama sebuah nota masih dipantau untuk
-- penghapusan: nota yang lebih tua dari jendela tidak lagi diperiksa.
('farmasi.penjualan_lookback_hari', '7'),

-- Kuota per siklus, dibagi bersama antara kabar "disimpan" dan "dihapus".
-- Kelebihannya dikirim siklus berikutnya, TIDAK dibuang.
--
-- Lebih besar dari kuota pengadaan (5) karena lajunya memang jauh lebih tinggi:
-- 33 nota sehari yang tersebar di ~12 jam kerja berarti ~1,4 nota per siklus 5
-- menit, jadi 10 tidak akan menggigit dalam pemakaian biasa. Ia ada untuk
-- ledakannya -- pemicu yang baru dinyalakan, atau entri borongan sesudah libur.
('farmasi.penjualan_max_per_siklus', '10'),

-- Apakah harga jual ikut dicetak di daftar barang.
--
-- MENYALA secara bawaan, alasan yang sama dengan `farmasi.pengadaan_harga`: yang
-- diminta adalah nota penjualan, dan nota tanpa harga bukan nota. Saat mati,
-- kolom harganya TIDAK di-SELECT sama sekali -- merendernya jadi mustahil, bukan
-- sekadar terlarang.
--
-- Kelima angka header (jumlah item, subtotal, ongkir, PPN, total) SELALU dibaca
-- walau sakelar ini mati, dengan alasan yang sudah dibayar di 031: label angka
-- penutup ditulis di template sebagai baris tersendiri, jadi memutusnya
-- menyisakan "Total : " yang menggantung tanpa angka -- dan pesan seperti itu
-- terbaca sebagai sistem rusak, lalu yang benar ikut tidak dipercaya.
('farmasi.penjualan_harga', '1'),

-- Apakah kabar PENGHAPUSAN ikut dikirim.
--
-- Berdiri sendiri, dan MENYALA secara bawaan -- yang menahan seluruhnya tetap
-- `farmasi.penjualan_enabled` yang mati. Ada karena keduanya melayani kebutuhan
-- yang berbeda: kabar "disimpan" adalah catatan omzet, kabar "dihapus" adalah
-- KOREKSI atas catatan itu. Grup yang menerima yang pertama tanpa yang kedua
-- akan menyimpan nota yang sudah dibatalkan sebagai kalau-kalau masih sah, dan
-- justru pembatalan itulah yang paling perlu terlihat.
('farmasi.penjualan_hapus_kabar', '1'),

-- Isi pesan saat nota DISIMPAN. `{daftar_barang}` dirakit core/penjualan.ts
-- (banyak baris, tiap nama barang dan satuan sudah lewat sanitizeValue) -- lihat
-- MULTILINE_VARIABLES di core/template.ts.
--
-- Tidak ada satu pun variabel pembeli di sini, dan tidak ada yang tersedia untuk
-- ditambahkan -- lihat PENJUALAN_TEMPLATE_VARIABLES di core/template.ts.
--
-- LABEL `{ongkir}` berbunyi "Pembulatan/ongkir", BUKAN "Ongkir", dan itu temuan
-- dari data bukan pilihan gaya. Kolomnya memang bernama `ongkir` di Khanza, tapi
-- apotek ini memakainya sebagai PEMBULATAN: dari 3.945 nota yang mengisinya,
-- 2.959 membuat totalnya kelipatan Rp1.000 dan 3.343 kelipatan Rp500; 3.764
-- (95%) bernilai di bawah Rp1.000, dengan rata-rata Rp379. Dicetak "Ongkir :
-- Rp1.422" pada penjualan bebas di loket yang jelas tidak dikirim ke mana pun,
-- pesannya terbaca sebagai sistem rusak -- dan sejak itu angka yang benar pun
-- tidak dipercaya. Nilai terbesarnya Rp20.000 dan 181 nota mengisinya di atas
-- Rp1.000, jadi kadang ia memang ongkos kirim; labelnya menyebut keduanya.
--
-- Nama VARIABELNYA tetap `{ongkir}` supaya tetap bisa ditelusuri ke kolom Khanza
-- yang mengisinya. Yang diperbaiki labelnya, bukan tautannya ke sumber.
('farmasi.template_penjualan',
 '*Penjualan Obat & BHP*\n{nama_rs}\n\nNo. Nota : {no_nota}\nTanggal : {tgl_jual}\nJenis : {jenis_jual}\nGudang : {nama_gudang}\nPetugas : {nama_petugas}\nStatus : {status_bayar}\n\n*Barang ({jumlah_item}):*\n{daftar_barang}\n\nSubtotal : {subtotal}\nPembulatan/ongkir : {ongkir}\nPPN : {ppn}\n*Total : {total}*'),

-- Isi pesan saat nota DIHAPUS.
--
-- Sengaja TIDAK memuat `{daftar_barang}` maupun angka rupiahnya, dan itu bukan
-- penghematan: barisnya sudah tidak ada di Khanza saat pesan ini dirakit, jadi
-- satu-satunya sumber angka adalah pesan LAMA yang kita kirim sendiri. Mencetak
-- ulang angka dari ingatan berarti nota yang sudah dibatalkan beredar untuk
-- kedua kalinya lengkap dengan isinya -- kebalikan dari yang dibutuhkan. Yang
-- perlu diketahui penerima cuma NOMORNYA, supaya ia bisa mencoret nota yang
-- sudah terlanjur dicatat.
('farmasi.template_penjualan_hapus',
 '*Penjualan DIBATALKAN*\n{nama_rs}\n\nNo. Nota : {no_nota}\n\nNota penjualan di atas sudah dihapus dari sistem. Mohon coret dari catatan bila sudah terlanjur dicatat.\n\nDilaporkan : {tanggal} {jam}');
