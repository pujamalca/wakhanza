-- =============================================================================
-- PENYARING CARA BAYAR UNTUK LAMPIRAN HASIL & TAGIHAN
-- =============================================================================
--
-- Tiga daftar kode penjamin (`kd_pj`), satu per jenis dokumen. Hanya kunjungan
-- yang penjaminnya ada di daftar yang lampirannya ikut dikirim. KOSONG = seluruh
-- penjamin, dan itu bawaannya -- jadi migrasi ini nol-perubahan-perilaku.
--
-- -----------------------------------------------------------------------------
-- Yang tersaring TETAP menerima pesannya, cuma tanpa berkas
-- -----------------------------------------------------------------------------
--
-- Ini penyaring LAMPIRAN, bukan penyaring pemicu. Pasien yang penjaminnya di luar
-- daftar tetap menerima "hasil pemeriksaan Anda sudah tersedia" / "tagihan Anda
-- telah terbit" seperti sebelum fitur lampiran ada -- kalimat yang memang sudah
-- berdiri sendiri dan tetap berguna sejak Fase 1.
--
-- Menyaringnya di SQL pemicu akan menghasilkan hal yang berbeda dan salah:
-- pasiennya berhenti diberi tahu sama sekali. Karena itu penyaringnya duduk di
-- jalur lampiran (`lolosSaring` pada `runSisipCycle`), bukan di query poller.
--
-- -----------------------------------------------------------------------------
-- Kenapa PER JENIS, bukan satu untuk seluruh tab
-- -----------------------------------------------------------------------------
--
-- Terukur atas 90 hari di instalasi ini:
--
--   nota tagihan   1.324 UMUM, 574 BPJS Kesehatan, 2 tanpa penjamin
--   hasil lab         11 baris, SELURUHNYA BPJS Kesehatan
--   hasil radiologi    0 (tabelnya memang kosong)
--
-- Kedua angka itu menjawab pertanyaan yang berbeda. Rincian tagihan tidak
-- menjawab apa pun bagi pasien yang tagihannya ditanggung penjamin -- itulah
-- kebutuhan yang melahirkan fitur ini. Hasil laboratorium sama pentingnya bagi
-- siapa pun, apa pun cara bayarnya. Satu penyaring untuk ketiganya memaksa kedua
-- pertanyaan itu dijawab dengan satu jawaban.
--
-- Ditambah: ketiga sakelar `dokumen.*_enabled` di tab yang sama SUDAH per jenis,
-- jadi penyaring tunggal akan jadi satu-satunya setelan di sana yang tidak.
--
-- -----------------------------------------------------------------------------
-- Berkunci pada KODE, bukan nama -- dan itu bukan pilihan gaya
-- -----------------------------------------------------------------------------
--
-- `penjab.png_jawab` adalah teks yang bisa disunting staf lewat Khanza. Penyaring
-- yang berkunci padanya berhenti cocok DIAM-DIAM pada hari seseorang mengganti
-- "BPJS Kesehatan" jadi "BPJS": tidak ada galat, cuma pasien yang berhenti
-- menerima lampirannya.
--
-- Kodenya dibaca lewat query TERSENDIRI (`ambilKdPjKunjungan()`), bukan dengan
-- menambahkan `kd_pj` ke baris pemicu. Sejak `{cara_bayar}` ada, query pemicu
-- sengaja mengambil `pj.png_jawab` SAJA -- kodenya tidak pernah ikut keluar dari
-- SQL, sehingga merender "A02" ke pasien bukan terlarang melainkan MUSTAHIL.
-- Query kecil di jalur lampiran menjawab kebutuhan penyaring tanpa membatalkan
-- jaminan itu; ia `eq_ref PRIMARY` dan hanya dijalankan bila daftarnya terisi.
--
-- -----------------------------------------------------------------------------
-- Akibat yang harus disadari sebelum mengisinya
-- -----------------------------------------------------------------------------
--
-- Katalog `penjab` di sini punya 25 baris tapi hanya DUA yang aktif (`A01` UMUM,
-- `A02` BPJS Kesehatan). Sisanya -- termasuk belasan baris "Asuransi ..." --
-- berstatus nonaktif. Daftar pilihannya tetap menampilkan SELURUHNYA dan bukan
-- yang aktif saja, karena penyaring ini dicocokkan terhadap kunjungan yang SUDAH
-- terjadi: asuransi yang dinonaktifkan bulan lalu tetap penjamin kunjungan bulan
-- lalu, dan menghilangkannya dari pilihan berarti pasiennya tidak akan pernah
-- bisa dimasukkan ke daftar. Alasan yang sama sudah ditulis di `core/penjamin.ts`
-- soal `penjab.status`.
--
-- Kunjungan ber-`kd_pj = '-'` (penanda "tidak diisi" milik Khanza) TIDAK akan
-- pernah lolos begitu penyaringnya dipasang, karena `'-'` memang tidak bisa
-- dipilih dari daftar. Terukur 2 dari 1.900 nota dalam 90 hari -- jarang, tapi
-- disebutkan di halamannya alih-alih ditemukan belakangan.
-- =============================================================================

-- Bawaannya `[]` -- daftar kosong, artinya SELURUH penjamin.
--
-- Bentuknya JSON array supaya sebentuk dengan `privacy.sensitive_poli_codes`,
-- dan dibaca lewat `getSettingJson<string[]>` yang sama. Nilai yang tidak bisa
-- diurai jatuh ke daftar kosong -- yaitu "semua lolos", bukan "tidak ada yang
-- lolos": setelan yang rusak tidak boleh diam-diam mematikan lampiran yang
-- sedang berjalan.

INSERT INTO app_setting (k, v) VALUES
  ('dokumen.lab_cara_bayar', '[]')
ON DUPLICATE KEY UPDATE k = k;

INSERT INTO app_setting (k, v) VALUES
  ('dokumen.rad_cara_bayar', '[]')
ON DUPLICATE KEY UPDATE k = k;

INSERT INTO app_setting (k, v) VALUES
  ('dokumen.nota_cara_bayar', '[]')
ON DUPLICATE KEY UPDATE k = k;
