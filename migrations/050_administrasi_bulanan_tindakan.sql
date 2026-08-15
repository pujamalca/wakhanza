-- =============================================================================
-- RINCIAN PER TINDAKAN pada REKAP BULANAN ADMINISTRASI
-- =============================================================================
--
-- Berapa kali tiap jenis tindakan dikerjakan bulan itu, plus satu daftar
-- `kd_jenis_prw` yang boleh dicentang staf untuk DILIPAT jadi satu baris agregat.
--
-- Nol tabel baru. Yang bertambah: satu kunci pengaturan, dan bagian tindakan yang
-- disisipkan ke template yang sudah tersimpan.
--
-- -----------------------------------------------------------------------------
-- Angka yang membentuknya, terukur atas database produksi
-- -----------------------------------------------------------------------------
--
--   bulan   baris tindakan   jenis berbeda   kunjungan bertindakan
--   Jan               541              14                     363
--   Feb               437              14                     309
--   Mar               592              16                     410
--   Apr               615              16                     424
--   Mei               556              20                     363
--   Jun               648              16                     443
--   Jul               649              15                     470
--
-- Juli 2026, seluruh 15 jenis:
--
--   473 (72,9%)  konsultasi dokter umum
--    65 (10,0%)  Injeksi Obat
--    30 ( 4,6%)  puyer
--    17 ( 2,6%)  Gula Darah
--    16 ( 2,5%)  nebulisasi
--    13 ( 2,0%)  Asam Urat
--     9 ( 1,4%)  Kolesterol
--     9 ( 1,4%)  Woud toilet ringan
--     6 ( 0,9%)  Pemasangan Infus
--     4 ( 0,6%)  kunjungan rumah perawat
--     2 ( 0,3%)  Hecting
--     2 ( 0,3%)  operasi kecil
--     1 ( 0,2%)  Kunjungan Rumah
--     1 ( 0,2%)  Ekstraksi Benda Asing
--     1 ( 0,2%)  Wound Toilet Besar
--
-- DUA hal yang cuma terlihat dari sebaran itu, dan keduanya alasan pengecualian
-- ini ada:
--
--  1. SATU jenis menelan 72,9%. `konsultasi dokter umum` ada di hampir tiap
--     kunjungan, jadi ia tidak memberi tahu apa pun sementara ia yang membuat
--     keempat belas sisanya terlihat seperti pembulatan.
--  2. EKORNYA tipis dan menyingkap. 6 dari 15 jenis dikerjakan 5 kali atau
--     kurang, dan satu baris "operasi kecil : 2" pada bulan sepi adalah
--     keterangan tentang dua orang tertentu. Keberatan yang SAMA PERSIS membuat
--     migrations/047 sengaja tidak memecah rekap ini per poli -- yang di sana
--     ditutup dengan tidak membuka fiturnya, di sini ditutup dengan centang.
--
--  3. Kunjungan yang punya tindakan bergerak 60,9% -> 70,4%, tren sekelas SOAPIE
--     (49% -> 73%) yang jadi salah satu alasan rekap bulanan ini dibuat.
--
-- -----------------------------------------------------------------------------
-- Pengecualian MELIPAT, tidak membuang
-- -----------------------------------------------------------------------------
--
-- Yang dicentang kehilangan barisnya sendiri lalu masuk satu baris
-- "Dikecualikan (N jenis) : M" -- tapi TETAP terhitung di `{jumlah_tindakan}` dan
-- `{jumlah_jenis_tindakan}`. Kedua bentuk yang lebih sederhana ditolak, dan
-- masing-masing berbohong ke arah yang berbeda:
--
--   dibuang dari TOTAL   -> `{jumlah_tindakan}` diam-diam berarti "tindakan
--                           kecuali yang tidak kami sebutkan", dan perbandingan
--                           antar bulan berhenti berarti begitu ada yang
--                           mencentang sesuatu di tengah tahun.
--   dibuang dari DAFTAR  -> barisnya berhenti berjumlah dengan totalnya, persis
--                           yang ketiga pasangan turunan di 047 ada untuk
--                           mencegah.
--
-- Untuk alasan PRIVASI, melipat justru yang benar: ia menyembunyikan NAMA
-- tindakannya sambil tetap jujur soal jumlahnya.
--
-- Batas baris (`MAKS_BARIS_TINDAKAN`, 40) punya baris lipatannya SENDIRI, tidak
-- dilebur dengan yang dicentang. Keduanya menyembunyikan nama, tapi yang satu
-- KEPUTUSAN staf yang bisa dibatalkan lewat satu centang dan yang satu
-- KETERBATASAN panjang pesan yang tidak bisa diapa-apakan dari halaman mana pun.
--
-- -----------------------------------------------------------------------------
-- Enam tabel, satu daftar
-- -----------------------------------------------------------------------------
--
-- Khanza memecah tindakan menurut pengerjanya (dr / pr / drpr) dikali jalurnya
-- (jalan / inap). Keenamnya dibaca walau lima di antaranya kosong hari ini
-- (`rawat_jl_dr` 12.215, `rawat_jl_drpr` 3, empat sisanya NOL), dengan alasan
-- yang sama yang membuat 047 tidak menyaring `status_lanjut='Ralan'`: rekap ini
-- menghitung SELURUH kunjungan, jadi membaca tindakannya dari rawat jalan saja
-- akan membuat pembilang dan pembaginya berbeda pada hari RS mulai melayani
-- rawat inap -- tanpa satu pun galat, dengan angka yang tetap masuk akal.
--
-- Daftarnya SATU konstanta di `khanza/administrasiBulanan.ts`, dipakai membangun
-- UNION rincian DAN rantai `EXISTS` penghitung kunjungan-bertindakan. Dua daftar
-- berarti dua kesempatan menambahkan tabel ke salah satunya saja.
--
-- TANPA izin pindai penuh, dan itu terukur: keenam PK berawalan `no_rawat`, jadi
-- yang berisi `range no_rawat` + `Using index` dan yang kosong `type=index` +
-- `Using index` -- bukan `ALL`. Seluruh query 2-3 ms.
--
-- -----------------------------------------------------------------------------
-- Yang TETAP tidak dibaca
-- -----------------------------------------------------------------------------
--
-- `kd_dokter` dan `nip` tidak diambil sama sekali. Memecah tindakan per petugas
-- mengubah rekap kunjungan menjadi laporan kinerja per orang, dan itu keputusan
-- tersendiri yang tidak pernah diminta. `no_rawat` disebut DI DALAM tabel
-- turunan -- ia yang menyatukan keenam sumber -- tapi tidak pernah jadi kolom
-- hasil, sama seperti `no_rkm_medis` pada query pasien berulang.
--
-- Satu-satunya NAMA yang bertambah adalah `jns_perawatan.nm_perawatan`, dan
-- selalu sebagai label baris agregat. Ia input bebas petugas Khanza (terukur
-- "puyer", "Woud toilet ringan"), jadi ia WAJIB lewat `isianSurat()` lalu
-- `sanitizeValue()` -- kewajiban yang sama persis dengan `penjab.png_jawab`.
--
-- -----------------------------------------------------------------------------
-- WAJIB: worker dimulai ulang
-- -----------------------------------------------------------------------------
--
-- `administrasi.bulanan_enabled` SUDAH bernilai '1' di mesin ini, tanggal kirim 5,
-- dan `administrasi.bulanan_last_run` sudah berbunyi 202607 -- fitur ini SEDANG
-- BERJALAN. Migrasi ini karena itu mengubah isi pesan yang berangkat pada jadwal
-- berikutnya, bukan menambah sesuatu yang menunggu dinyalakan.
--
-- Tanpa restart, `{rincian_tindakan}` dirender kode lama yang tidak mengenalnya
-- lalu menghasilkan judul "*Tindakan*" yang menggantung tanpa satu baris pun di
-- bawahnya. Pelajaran yang sama sudah dibayar migrations/043 dan 049.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pengaturan
-- -----------------------------------------------------------------------------
--
-- CATATAN: `app_setting` HANYA punya kolom `(k, v)`. Menambahkan `updated_by` ke
-- daftar INSERT membuat migrasinya gagal di tengah -- pelajaran 046.
--
-- KOSONG = tidak ada yang dikecualikan, seluruh jenis disebut satu per satu.
-- Bawaan itu disengaja: menyembunyikan sesuatu sejak migrasi adalah keputusan
-- yang diambil KODE, bukan rumah sakit. `konsultasi dokter umum` yang menelan
-- 72,9% sekalipun tidak dicentang di muka -- biarkan staf melihatnya sekali lalu
-- memutuskan sendiri.
INSERT INTO app_setting (k, v) VALUES
  ('administrasi.bulanan_tindakan_kecuali', '[]')
ON DUPLICATE KEY UPDATE k = k;

-- -----------------------------------------------------------------------------
-- Sisipkan bagian tindakan ke template yang SUDAH tersimpan
-- -----------------------------------------------------------------------------
--
-- `REPLACE()` atas jangkar, BUKAN `UPDATE` yang menimpa seluruh template: staf
-- boleh sudah menyuntingnya, dan menimpanya membuang pekerjaan itu tanpa
-- bertanya.
--
-- JEBAKAN CRLF, dan ia yang membuat bentuk 041 tidak bisa disalin apa adanya:
-- 047 menyemai templatenya dengan `\n`, tapi nilai yang BENAR-BENAR tersimpan
-- memakai `\r\n` -- staf menyimpannya lewat form, dan `<textarea>` mengirim CRLF
-- sesuai spesifikasi HTML. `REPLACE()` yang menambatkan diri pada teks berisi
-- baris baru gaya LF karena itu tidak cocok sama sekali: tanpa galat, tanpa
-- perubahan, dan migrasinya tetap tercatat "berhasil" sementara rekapnya
-- berangkat tanpa satu baris tindakan pun. Pelajaran 043 dan 049.
--
-- Dua pagarnya: jangkarnya sepotong teks TANPA baris baru, dan baris baru yang
-- disisipkan mengikuti gaya yang sudah dipakai lewat `IF(v LIKE '%\r\n%', ...)`.
--
-- Idempoten lewat `AND v NOT LIKE '%{rincian_tindakan}%'`.
--
-- LETAKNYA sesudah blok "Cara bayar" dan sebelum "Kelengkapan berkas", dan itu
-- mengikuti aturan urutan yang sudah ditulis 047: pembagi lebih dulu, pecahan
-- sesudahnya. Rincian tindakan pembaginya `{jumlah_tindakan}` yang disebut tepat
-- di atasnya, sementara "Kelengkapan berkas" pembaginya `{jumlah_kunjungan}` yang
-- sudah disebut di kepala pesan.
UPDATE app_setting
SET v = REPLACE(
      v,
      '*Kelengkapan berkas terisi*',
      CONCAT(
        '*Tindakan*',
        IF(v LIKE '%\r\n%', '\r\n', '\n'),
        'Total tindakan : {jumlah_tindakan} dari {jumlah_jenis_tindakan} jenis',
        IF(v LIKE '%\r\n%', '\r\n', '\n'),
        'Kunjungan tanpa tindakan : {jumlah_tanpa_tindakan}',
        IF(v LIKE '%\r\n%', '\r\n\r\n', '\n\n'),
        '{rincian_tindakan}',
        IF(v LIKE '%\r\n%', '\r\n\r\n', '\n\n'),
        '*Kelengkapan berkas terisi*'
      )
    )
WHERE k = 'administrasi.template_bulanan'
  AND v LIKE '%*Kelengkapan berkas terisi*%'
  AND v NOT LIKE '%{rincian_tindakan}%';
