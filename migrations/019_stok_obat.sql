-- 019_stok_obat.sql
-- BALASAN STOK & HARGA OBAT.
--
-- Menjawab pertanyaan yang MASUK ("stok paracetamol?", "harga paramex berapa?")
-- dengan data dari katalog apotek di `sik`: `databarang` (harga) +
-- `gudangbarang` (stok per batch).
--
-- Kenapa diatur di /farmasi dan bukan di /balasan-otomatis: yang perlu
-- diputuskan di sini bukan "kalimat apa yang dibalas" melainkan "apakah
-- persediaan dan harga apotek boleh dijawab otomatis, dan kepada siapa" -- itu
-- keputusan apotek, dan tempatnya bersama sakelar farmasi lainnya.
--
-- PENTING supaya tidak tertukar dengan larangan privasi yang sudah ada:
-- CLAUDE.md melarang mengambil nama obat dari `sik`, dan larangan itu tentang
-- `resep_obat` -- obat APA yang diterima SIAPA, yang memang rekam medis.
-- Katalog harga dan stok gudang tidak melekat pada pasien mana pun; ia setara
-- daftar harga yang ditempel di loket. Lihat komentar panjang di
-- src/khanza/stokObat.ts.

INSERT INTO app_setting (k, v) VALUES

-- Sakelar utama, dan MATI secara bawaan -- pola yang sama dengan
-- `farmasi.enabled`, `autoreply.enabled`, dan `alert.webhook_url`. Tiga nilai,
-- bukan satu boolean, karena "boleh dijawab otomatis" dan "boleh dijawab
-- kepada siapa saja" adalah dua keputusan berbeda dengan akibat berbeda:
--
--   'mati'    tidak menjawab sama sekali. BAWAAN.
--   'petugas' hanya menjawab nomor yang terdaftar di `farmasi_target`
--             (jenis personal). Persediaan dan harga adalah informasi dagang
--             apotek; ini pilihan yang membuatnya tetap internal.
--   'semua'   menjawab siapa pun yang mengirim pesan ke nomor rumah sakit.
--
-- 'semua' bukan pilihan yang salah -- ketersediaan obat dan daftar harga memang
-- lazim diumumkan, dan pasien yang bisa memastikan lebih dulu tidak perlu
-- datang sia-sia. Tapi itu keputusan apotek, bukan bawaan yang menyala sendiri
-- hanya karena migrasinya sudah dijalankan.
('farmasi.stok_mode', 'mati'),

-- Kata kunci pemicunya, dipisah koma, dicocokkan sebagai KATA UTUH.
-- Dicocokkan LEBIH DULU daripada aturan /balasan-otomatis, jadi kata kunci di
-- sini sebaiknya spesifik -- kata umum seperti "obat" akan menelan pertanyaan
-- yang sebenarnya dimaksudkan untuk aturan lain.
('farmasi.stok_keywords', 'stok,harga'),

-- Berapa obat yang disebut dalam satu jawaban. Pencariannya `LIKE '%..%'`,
-- jadi "para" bisa cocok dengan belasan barang; tanpa batas ini satu pertanyaan
-- menghasilkan pesan WhatsApp sepanjang layar yang tidak terbaca siapa pun.
('farmasi.stok_max_hasil', '5'),

-- Harga mana yang disebut. `ralan` = tarif rawat jalan (yang dibayar pasien
-- poliklinik), `jualbebas` = pembelian langsung di loket tanpa resep. Keduanya
-- ada di `databarang` dan sering BERBEDA, jadi menjawab dengan yang keliru
-- berarti pasien datang membawa uang yang salah.
('farmasi.stok_harga', 'jualbebas'),

-- Jawaban saat obatnya ketemu. {stok_obat} sudah berupa daftar berbaris-baris
-- yang dirakit khanza/stokObat.ts.
('farmasi.stok_template',
 'Informasi obat di {nama_rs}:\n\n{stok_obat}\n\nHarga dapat berubah sewaktu-waktu. Untuk memastikan, hubungi {kontak_rs}.'),

-- Ketemu kata kuncinya, tapi obatnya tidak ada di katalog. Menyebut ulang apa
-- yang dicari ({cari_obat}) supaya penanya tahu ejaannya yang terbaca -- salah
-- ketik adalah sebab paling sering, dan jawaban "tidak ditemukan" tanpa
-- menyebut apa yang dicari tidak memberi petunjuk untuk membetulkannya.
('farmasi.stok_template_kosong',
 'Maaf, "{cari_obat}" tidak ditemukan di daftar obat kami. Coba tulis nama yang lebih umum, atau hubungi {kontak_rs}.'),

-- Ketemu kata kuncinya, tapi penanya tidak menyebut obat apa pun ("berapa
-- harga obat?"). SENGAJA tidak menebak dan tidak menampilkan katalog -- yang
-- keluar hanya permintaan untuk menyebutkan namanya.
('farmasi.stok_template_tanpa_nama',
 'Sebutkan nama obatnya ya, mis. "stok paracetamol" — supaya bisa kami cek.');
