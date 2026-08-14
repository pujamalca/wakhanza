-- =============================================================================
-- PECAHAN CARA BAYAR PADA REKAP RESEP HARIAN
-- =============================================================================
--
-- `{rincian_cara_bayar}` -- berapa resep dan berapa rupiah per penjamin, untuk
-- satu hari. Nol tabel baru, nol kunci pengaturan baru, nol sakelar baru.
--
-- -----------------------------------------------------------------------------
-- Kenapa ini bukan hiasan: `{nilai_obat}` mencampur KAS dengan PIUTANG
-- -----------------------------------------------------------------------------
--
-- Pasien umum membayar di loket; tagihan pasien BPJS ditagihkan ke penjamin dan
-- baru jadi uang belakangan. Sampai migrasi ini, rekap harian menyajikan
-- keduanya sebagai SATU angka -- dan angka itu tidak bisa dipakai mencocokkan kas
-- apotek pada akhir hari tanpa membuka Khanza.
--
-- Terukur Juli 2026 di database produksi:
--
--   UMUM             500 resep   Rp15.357.316   <- kas
--   BPJS Kesehatan   185 resep    Rp2.181.685   <- piutang
--   ------------------------------------------
--   total            685 resep   Rp17.539.001
--
-- 12,4% dari angka yang selama ini dibaca sebagai satu kesatuan ternyata belum
-- jadi uang.
--
-- -----------------------------------------------------------------------------
-- Ia MELONGGARKAN invarian yang ditulis tegas di migrations/042
-- -----------------------------------------------------------------------------
--
-- Berkas itu menyatakan, dan `khanza/farmasiStaf.ts` mengulanginya di atas query
-- headernya: `reg_periksa` dan `pasien` TIDAK di-JOIN sama sekali -- "bukan
-- di-JOIN lalu kolomnya tidak dipilih, melainkan tabelnya memang tidak disebut,
-- sehingga tidak ada jalan apa pun dari query ini menuju seorang pasien."
--
-- Query cara bayar MENYEBUT `reg_periksa`, dan itu tidak bisa dihindari: `kd_pj`
-- hanya hidup di sana. `detail_pemberian_obat` -- satu-satunya tabel lain yang
-- sudah dijoinkan modul ini -- tidak punya satu pun kolom penjamin. Jadi
-- pilihannya bukan "cara lain yang lebih aman", melainkan antara menyediakan
-- pecahan ini atau tidak sama sekali.
--
-- Pagarnya karena itu BERPINDAH dari "tabelnya tidak disebut" ke BENTUK KODE,
-- pola yang sama yang sudah dibayar di migrations/046 dan 047:
--
--   1. Query TERSENDIRI, bukan join tambahan pada agregat yang sudah ada.
--      Digabung, `reg_periksa` ikut hadir di query berkolom banyak dan penyunting
--      berikutnya tidak punya satu pun tanda bahwa ia sedang melewati pagar.
--   2. `pasien` tetap TIDAK disebut. Nama, alamat, dan nomor telepon tidak punya
--      jalan menuju modul ini. `no_rkm_medis` pun tidak diambil.
--   3. Yang meninggalkan SQL cuma kode penjamin, namanya, dan dua angka.
--      `png_jawab` adalah nama INSTANSI, bukan orang.
--
-- Karena pagarnya berpindah dari "mustahil" ke "dijaga", pemeriksaan pada
-- `Object.keys()` di `npm run dryrun:resep` berubah dari kerapian menjadi
-- SATU-SATUNYA yang membuktikannya -- `no_rawat` dan `no_rkm_medis` kini
-- benar-benar ada di jangkauan query itu, tinggal satu kolom SELECT jaraknya.
--
-- -----------------------------------------------------------------------------
-- Dua jebakan SQL yang keduanya menghasilkan angka yang tetap masuk akal
-- -----------------------------------------------------------------------------
--
-- (1) `COUNT(DISTINCT ro.no_resep)`, BUKAN `COUNT(*)`. `detail_pemberian_obat`
--     berisi satu baris per BARANG, jadi join ke sana menggandakan baris
--     resepnya. Terukur Juli 2026: `COUNT(*)` menghasilkan 3.108 sementara resep
--     yang sungguhan 685 -- salah 4,5 kali, dan 3.108 tetap terlihat wajar di
--     dalam sebuah pesan.
--
-- (2) LEFT JOIN ke `detail_pemberian_obat`, berbeda dari query NILAI yang INNER.
--     Di sana INNER benar karena yang dijumlahkan memang uang yang sudah masuk
--     penagihan. Di sini satu query harus menghasilkan DUA angka dengan pembagi
--     yang berbeda: jumlah resep harus berjumlah dengan `{jumlah_resep}`
--     (SELURUH resep), sementara rupiahnya dengan `{nilai_obat}` (yang tertagih
--     saja). INNER akan membuat pecahan resepnya hanya menghitung yang sudah
--     divalidasi, sehingga penjumlahannya berhenti cocok dengan baris di atasnya
--     -- dan rekap yang tidak berjumlah berhenti dipercaya seluruhnya.
--
-- Keduanya dipatok `npm run dryrun:resep`, yang keluar dengan kode 1 bila salah.
--
-- -----------------------------------------------------------------------------
-- TANPA sakelar, dan itu keputusan
-- -----------------------------------------------------------------------------
--
-- Alasan yang sama persis dengan `{nilai_obat}` di migrations/043: sakelar yang
-- memutus variabel agregat menyisakan label menggantung (`*Rincian per cara
-- bayar:*` tanpa isi) yang terbaca sebagai sistem rusak, dan satu-satunya jalan
-- keluarnya adalah menyuruh staf ikut menyunting templatenya -- invarian
-- dua-langkah yang berulang kali terbukti gagal DIAM di proyek ini.
--
-- Jalan keluarnya sama: HAPUS kedua barisnya dari template, satu tindakan yang
-- terlihat di halaman yang sedang dibuka. Yang menahan seluruhnya tetap
-- `farmasi.resep_rekap_enabled`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Menyisipkan barisnya ke template TERSIMPAN
-- -----------------------------------------------------------------------------
--
-- JANGKARNYA sepotong teks TANPA baris baru, dan gaya baris barunya mengikuti
-- yang sudah dipakai -- keduanya pelajaran yang dibayar di migrations/043.
--
-- Nilai yang benar-benar tersimpan memakai CRLF, karena staf menyimpannya lewat
-- form dan `<textarea>` mengirimkan CRLF sesuai spesifikasi HTML. `REPLACE()`
-- yang menambatkan diri pada teks berisi `\n` karena itu TIDAK COCOK SAMA SEKALI
-- -- tanpa galat, tanpa perubahan, dan migrasinya tetap tercatat "berhasil"
-- sementara rekapnya berangkat malam itu tanpa satu pecahan pun. Diperiksa
-- langsung sebelum berkas ini ditulis: `v LIKE '%\r\n%'` bernilai 1.
--
-- Ditaruh tepat SESUDAH `*Nilai obat*` dan SEBELUM rincian per dokter, karena ia
-- yang menerangkan angka di atasnya: berapa dari jumlah itu yang sudah jadi kas.
--
-- Idempoten lewat `NOT LIKE '%{rincian_cara_bayar}%'`.
UPDATE app_setting
SET v = REPLACE(
      v,
      '*Nilai obat : {nilai_obat}*',
      CONCAT(
        '*Nilai obat : {nilai_obat}*',
        IF(v LIKE '%\r\n%', '\r\n\r\n', '\n\n'),
        '*Rincian per cara bayar:*',
        IF(v LIKE '%\r\n%', '\r\n', '\n'),
        '{rincian_cara_bayar}'
      )
    )
WHERE k = 'farmasi.template_resep_rekap'
  AND v LIKE '%*Nilai obat : {nilai_obat}*%'
  AND v NOT LIKE '%{rincian_cara_bayar}%';
