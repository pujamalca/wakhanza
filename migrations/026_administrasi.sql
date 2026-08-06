-- 026_administrasi.sql
-- ADMINISTRASI: mengirim DOKUMEN lengkap (surat keterangan sakit & sehat) ke
-- pasien sebagai berkas PDF, bukan sebagai teks pemberitahuan.
--
-- Sepuluh kelas pemicu sebelumnya semuanya mengirim KABAR: "antrian Anda
-- sekian", "hasil sudah siap", "obat bisa diambil". Yang ini mengirim
-- BARANGNYA -- berkas yang selama ini hanya bisa didapat dengan datang ke
-- loket. Bedanya bukan teknis belaka: sebuah surat keterangan sakit adalah
-- dokumen yang diserahkan pasien ke tempat kerjanya, jadi yang beredar bukan
-- lagi kabar tentang kunjungan melainkan surat resmi rumah sakit.

-- ---------------------------------------------------------------------------
-- TIDAK ada tabel baru, dan itu keputusan yang disengaja
-- ---------------------------------------------------------------------------
-- Lampiran sudah punya jalurnya sejak `migrations/014` (`outbox.media_path` +
-- `uploads/`), dan pengiriman tetap lewat `enqueueMessage()` yang sama dengan
-- sepuluh pemicu lain. Yang benar-benar baru cuma ISI berkasnya, dan itu
-- dirender dari `sik` saat staf menekan kirim -- tidak ada yang perlu
-- disimpan. Jejak siapa mengirim surat apa ke siapa sudah dijawab `audit_log`
-- (insert-only) dan baris `outbox`-nya sendiri.
--
-- Menambah tabel "surat_terkirim" akan menduplikasi keduanya sekaligus, dan
-- angka yang disimpan terpisah adalah angka yang bisa basi -- pelajaran yang
-- sama dengan `broadcast_campaign` yang menghitung terkirim/gagal LANGSUNG
-- dari `outbox` alih-alih menyimpan penghitung.

-- ---------------------------------------------------------------------------
-- Sakelar utama MATI, dengan alasan yang berbeda dari sakelar lain
-- ---------------------------------------------------------------------------
-- `farmasi.enabled` mati karena penerimanya grup yang keanggotaannya diatur di
-- luar sistem ini. `autoreply.enabled` mati karena sistemnya jadi menjawab.
-- Yang ini mati karena dokumennya sendiri: surat keterangan sakit adalah
-- dokumen yang dipakai untuk urusan ketenagakerjaan, dan begitu ia beredar
-- sebagai berkas WhatsApp ia bisa diteruskan siapa pun ke mana pun. Yang
-- memutuskan itu boleh atau tidak adalah rumah sakit, bukan bawaan sistem.
INSERT INTO app_setting (k, v) VALUES
  ('administrasi.enabled', '0'),

-- ---------------------------------------------------------------------------
-- DIAGNOSA: mati, dan ia sakelar TERSENDIRI
-- ---------------------------------------------------------------------------
-- `rptSuratSakit5.jasper` -- varian yang dirujuk saat fitur ini diminta --
-- mencetak baris "Diagnosa" berisi kode ICD + nama penyakit, dibaca dari
-- `diagnosa_pasien` + `penyakit`. Itu rekam medis telanjang, dan sepanjang
-- proyek ini aturannya tidak pernah berubah: kolom semacam itu tidak diambil
-- dari `sik` sama sekali (§5.2).
--
-- Di sini penerimanya PASIEN ITU SENDIRI, yang memang berhak atas diagnosanya
-- -- jadi larangannya tidak otomatis berlaku, tapi keputusannya juga bukan
-- milik kode. Dua hal yang membuatnya tetap perlu diputuskan sadar-sadar:
-- nomor tujuan berasal dari `pasien.no_tlp` yang di rumah sakit ini 40%-nya
-- tidak terpakai (jadi salah kirim bukan kemungkinan teoretis), dan berkas
-- PDF bisa diteruskan ke mana pun setelah diterima.
--
-- Saat MATI, kolom diagnosanya tidak ikut di-SELECT sama sekali -- merendernya
-- mustahil, bukan sekadar terlarang. Varian tanpa diagnosa juga bukan
-- karangan kita: `rptSuratSakit.jasper` (varian dasar Khanza) memang tidak
-- memuatnya.
  ('administrasi.sertakan_diagnosa', '0'),

-- ---------------------------------------------------------------------------
-- Pesan pengantar
-- ---------------------------------------------------------------------------
-- Lampiran WhatsApp membatasi KETERANGAN pada 1024 karakter (core/media.ts),
-- jauh lebih pendek daripada pesan teks biasa -- karena itu keduanya sengaja
-- singkat. Frasa berhentinya TIDAK disertakan: pengiriman ini selalu dipicu
-- staf yang menekan kirim untuk satu pasien, bukan aliran otomatis yang bisa
-- dihentikan. Menjanjikan "balas untuk berhenti" pada pesan yang memang tidak
-- pernah berulang adalah janji yang tidak berarti apa-apa -- dan janji yang
-- lebih luas dari yang dijalankan mesin adalah kesalahan yang sudah dibayar
-- di §"Berhenti berlangganan".
  ('administrasi.pesan_sakit',
   'Bpk/Ibu {nama_pasien}, berikut surat keterangan sakit Anda dari {nama_rs}. Simpan berkas ini baik-baik. Informasi lebih lanjut hubungi {kontak_rs}.'),
  ('administrasi.pesan_sehat',
   'Bpk/Ibu {nama_pasien}, berikut surat keterangan sehat Anda dari {nama_rs}. Simpan berkas ini baik-baik. Informasi lebih lanjut hubungi {kontak_rs}.'),

-- ---------------------------------------------------------------------------
-- Catatan kaki asal-usul -- padanan parameter `finger` milik Khanza
-- ---------------------------------------------------------------------------
-- Khanza mencetak "Dikeluarkan di ... Ditandatangani secara elektronik oleh
-- ..." di kaki suratnya. Padanannya di sini bukan hiasan: berkas PDF lepas
-- dari sistem yang membuatnya begitu ia masuk WhatsApp, dan tanpa satu baris
-- pun yang menyebut asalnya beserta keberadaan lembar asli bertanda tangan,
-- ia tidak bisa dibedakan dari berkas yang disunting siapa pun.
--
-- Dikosongkan pun tetap ada bentuk bawaannya di `lib/surat.ts` -- ini bagian
-- yang tidak boleh hilang hanya karena kotaknya dikosongkan.
  ('administrasi.catatan_kaki',
   'Dokumen ini diterbitkan secara elektronik oleh {nama_rs} dan dikirim melalui WhatsApp resmi rumah sakit. Lembar asli yang ditandatangani tersedia di rumah sakit. Bila ada keraguan atas keaslian dokumen ini, hubungi {kontak_rs}.')
ON DUPLICATE KEY UPDATE v = v;
