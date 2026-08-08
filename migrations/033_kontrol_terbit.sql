-- 033_kontrol_terbit.sql
-- SURAT KONTROL DITERBITKAN -- pasangan KONTROL_ULANG (032) dari ujung yang lain.
--
--   KONTROL_TERBIT  surat DISIMPAN dokter   -> "surat kontrol Anda sudah dibuat"
--   KONTROL_ULANG   H-N sebelum tanggalnya  -> "jangan lupa, kontrol besok"
--
-- Bentuk yang sama dengan LAB_REQUEST/RESULT_READY (025) dan SURAT PEMESANAN/
-- PENGADAAN (030/028): dua kejadian yang benar-benar berbeda pada satu benda,
-- masing-masing berbunyi tepat sekali. Menggabungkannya salah ke dua arah --
-- pemberitahuan saat disimpan tidak berguna sebagai pengingat H-1, dan
-- pengingat H-1 datang berminggu-minggu setelah pasien butuh tahu tanggalnya.
--
-- Yang ditutupnya nyata: sampai 032 ada, pasien pemegang surat kontrol tidak
-- diberitahu apa pun. Sesudah 032, ia baru diingatkan H-N -- dan surat yang
-- kontrolnya HARI INI atau BESOK praktis lewat begitu saja, karena saat H-N
-- jatuh suratnya belum ada. Pemicu inilah yang menutup lubang itu.

-- ---------------------------------------------------------------------------
-- Kelas PINDAI, jendelanya `tanggal_rujukan` (= tanggal SURAT, bukan tanggal rujuk)
-- ---------------------------------------------------------------------------
-- `skdp_bpjs` tidak punya kolom waktu penyimpanan sama sekali; kedua kolom
-- tanggalnya DIPILIH staf. Watermark karena itu mustahil benar -- staf yang
-- memundurkan Tanggal Surat membuat barisnya lahir di bawah watermark dan hilang
-- selamanya. Uraian lengkapnya di `src/khanza/kontrolTerbit.ts`.

INSERT INTO template (trigger_code, label, body, is_active, tujuan_mode) VALUES
('KONTROL_TERBIT',
 'Surat kontrol dibuat (non-BPJS)',
 -- Variabelnya SAMA PERSIS dengan KONTROL_ULANG, dan itu bukan kebetulan:
 -- kedua pesan menyangkut surat yang sama, jadi staf yang menyunting salah
 -- satunya tidak perlu menghafal dua kosakata. `{nama_poli}` tetap tidak
 -- dipakai di bawaan -- poli tidak ada di tabel suratnya, dan di server ini
 -- Khanza terbukti TIDAK membuatkan bookingnya (nol baris), jadi barisnya akan
 -- menggantung kosong. Lihat 032.
 'Yth. {nama_pasien}, surat kontrol Anda di {nama_rs} sudah dibuat.\n\nTanggal kontrol : {tanggal_kontrol}\nDokter : {nama_dokter}\nNo. surat : {no_surat_kontrol}\n\nMohon datang sesuai tanggal di atas dan membawa surat kontrol Anda. Informasi: {kontak_rs}\n\nBalas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.',
 0,
 'pasien');

-- ---------------------------------------------------------------------------
-- Lantai aktivasi, kuota, dan jendela
-- ---------------------------------------------------------------------------
INSERT INTO app_setting (k, v) VALUES

-- Jendela pindai dua arah, dalam hari. Kecil dengan sengaja: pemicunya berbunyi
-- SAAT surat disimpan, jadi jendela yang lebar tidak menambah ketepatan --
-- ia cuma memperbesar apa yang terbaca ulang tiap siklus.
('schedule.kontrol_terbit_lookback_hari', '3'),

-- Kuota per siklus. Kelebihannya dikirim siklus berikutnya, tidak dibuang.
('schedule.kontrol_terbit_max_per_siklus', '20'),

-- LANTAI aktivasi, diisi runner-nya sendiri pada siklus pertama sesudah
-- templatenya diaktifkan. Tanpa ini, mengaktifkan pemicu berarti seluruh isi
-- jendela -- termasuk surat yang pasiennya sudah kontrol kemarin -- langsung
-- jadi pesan WhatsApp. Pelajaran `administrasi.auto_sejak` (027).
--
-- Diisi SENDIRI oleh runner, bukan oleh tombol di halaman, karena sakelarnya
-- adalah `template.is_active` yang dipegang aksi generik di /template -- aksi
-- itu tidak tahu apa-apa tentang pemicu ini, dan menambahkan kasus khusus di
-- sana berarti setiap pemicu berikutnya harus ingat menambah kasusnya sendiri.
-- Mengisi diri sendiri tidak bisa lupa.
('schedule.kontrol_terbit_sejak', '');
