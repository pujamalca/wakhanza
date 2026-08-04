-- 022_darurat_stok_tanya.sql
-- DARURAT STOK: batasnya dicabut, dan arahnya jadi dua.
--
-- Dua perubahan pada fitur yang diperkenalkan 021, keduanya berangkat dari
-- pemakaian sungguhan:
--
--   1. `max_baris` bawaannya 30 dan isiannya berhenti di 200. Diukur terhadap
--      katalog di mesin ini, 208 barang berada di bawah ambang minimalnya --
--      jadi kapnya bukan teoretis, ia menggigit pada hari pertama. Yang lebih
--      buruk dari sekadar menggigit: daftar ini bukan bacaan melainkan DAFTAR
--      PESANAN, dan barang ke-31 tetap harus dibeli hari itu juga. Yang
--      tergunting justru yang paling tidak mendesak, sehingga ketiadaannya
--      paling sulit disadari.
--
--   2. Peringatannya hanya bisa DIKIRIM, tidak bisa DITANYA. Padahal keadaan
--      yang paling sering menimbulkan pertanyaan adalah di antara dua jadwal --
--      "yang tadi pagi sudah dibeli, sekarang tinggal apa lagi". Balasan stok
--      (019) sudah menjawab satu barang; yang belum ada adalah rekapnya.

-- ---------------------------------------------------------------------------
-- max_baris: 0 = SELURUHNYA
-- ---------------------------------------------------------------------------
-- Kolomnya dipertahankan, hanya bawaannya yang berubah. Menghapusnya akan
-- membuang pilihan yang tetap sah ("sepuluh paling kritis tiap pagi" untuk
-- kepala instalasi yang tidak menyusun pesanan sendiri) -- dan pilihan yang
-- dihapus adalah pilihan yang hilang, pelajaran yang sudah dibayar dua kali di
-- tabel `farmasi_target`.
--
-- Panjang pesannya sekarang ditangani lewat PEMECAHAN, bukan pemotongan:
-- daftar yang melebihi `BATAS_KARAKTER_BAGIAN` (core/stokDarurat.ts) dikirim
-- sebagai beberapa pesan berturut-turut, seluruhnya. Itu pembedaan yang
-- menentukan -- pemotongan membuang barang, pemecahan tidak.
ALTER TABLE stok_alert_schedule
  MODIFY COLUMN max_baris SMALLINT UNSIGNED NOT NULL DEFAULT 0;

-- Baris yang sudah ada ikut dibebaskan. Nilai 30 pada baris lama BUKAN pilihan
-- sadar siapa pun -- ia bawaan kolom yang form-nya bahkan mengisikannya sendiri
-- -- jadi membiarkannya berarti jadwal yang sudah berjalan diam-diam tetap
-- memotong daftar pesanan sesudah pembatasannya dicabut. Jadwal yang memang
-- ingin rekap pendek tinggal mengisinya kembali, dan sekarang isian itu berarti
-- keputusan alih-alih bawaan yang tidak pernah dilihat.
UPDATE stok_alert_schedule SET max_baris = 0 WHERE max_baris = 30;

-- ---------------------------------------------------------------------------
-- Arah MASUK: rekap yang bisa ditanyakan
-- ---------------------------------------------------------------------------
INSERT INTO app_setting (k, v) VALUES

-- Sakelar arah MASUK, terpisah dari `farmasi.darurat_enabled` yang mengatur
-- fiturnya secara keseluruhan. Rumah sakit sangat wajar ingin rekap terjadwal
-- tiap pagi tanpa nomornya ikut menjawab kapan pun ada yang mengetik "stok
-- habis" -- dan sebaliknya. Alasan yang sama yang membuat 020 memisahkan
-- `boleh_tanya` dari `is_active`.
--
-- Bawaannya '1', BERBEDA dari sakelar-sakelar lain yang bawaannya mati, dan itu
-- bukan kelalaian: yang menahan seluruhnya tetap `farmasi.darurat_enabled` yang
-- mati. Kunci ini ada untuk MEMATIKAN arah masuk pada rumah sakit yang tidak
-- menginginkannya, bukan untuk menambah satu langkah lagi sebelum fiturnya bisa
-- dipakai sama sekali.
('farmasi.darurat_tanya', '1'),

-- Frasa yang dibaca sebagai permintaan REKAP.
--
-- FRASA, bukan kata tunggal seperti `farmasi.stok_keywords`. Kata "stok"
-- sendirian sudah dipakai pencarian satu obat, jadi yang membedakan keduanya
-- adalah kata yang menyertainya. Frasa terpanjang diperiksa lebih dulu
-- (core/stokDarurat.ts), supaya "stok menipis" tidak keburu dimenangkan oleh
-- frasa pendek yang kebetulan jadi bagiannya.
--
-- Yang TIDAK ada di sini dan sengaja: "stok" dan "harga" polos. Keduanya milik
-- balasan stok, dan memasukkannya berarti setiap pertanyaan tentang satu obat
-- dijawab daftar dua ratus barang.
('farmasi.darurat_keywords',
 'darurat stok,stok darurat,stok kritis,stok menipis,stok habis,obat habis,rekap stok,daftar stok');
