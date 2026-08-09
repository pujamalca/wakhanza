-- 038_dokumen_hasil.sql
-- HASIL LAB, HASIL RADIOLOGI, dan NOTA/TAGIHAN sebagai BERKAS PDF.
--
-- Tiga pemicu yang sudah ada (`LAB_RESULT`, `RAD_RESULT`, `BILLING_READY`)
-- selama ini mengirim KABAR: "hasilnya sudah tersedia, silakan ambil di loket",
-- "tagihan Anda telah terbit". Migrasi ini menambahkan pilihan agar barangnya
-- ikut dikirim.
--
-- ---------------------------------------------------------------------------
-- BUKAN pemicu baru, dan itu keputusan yang menentukan seluruh bentuknya
-- ---------------------------------------------------------------------------
-- Tidak ada baris `template` baru di sini, tidak ada `trigger_code` baru, tidak
-- ada watermark baru, tidak ada siklus baru. Yang ditambahkan adalah LAMPIRAN
-- OPSIONAL pada tiga pemicu yang sudah berjalan.
--
-- Sebabnya: kejadiannya sama persis. "Hasil lab selesai" adalah satu kejadian,
-- bukan dua. Memberinya kode pemicu tersendiri berarti pasien menerima DUA
-- WhatsApp untuk satu kejadian -- satu berisi kabar, satu berisi berkas -- dan
-- keduanya harus didaftarkan sendiri-sendiri di `OPT_OUT_TRIGGERS`,
-- `TRIGGER_LABEL`, `TRIGGER_SOURCE`, dan daftar tujuan `template_target`. Semua
-- kebijakan itu SUDAH benar untuk ketiga pemicunya; menyalinnya berarti enam
-- tempat yang harus tetap sepakat alih-alih tiga.
--
-- Akibat langsung yang harus disadari: sakelar di bawah TIDAK menyalakan
-- pemberitahuan apa pun. Selama `template.is_active = 0` untuk pemicunya, tidak
-- ada pesan yang keluar dan lampiran ini tidak punya apa pun untuk ditempeli.
-- Halaman /administrasi mengatakan ini di depan staf, dan /template menautkan
-- balik ke sana.
--
-- ---------------------------------------------------------------------------
-- TIGA sakelar, bukan satu -- karena isinya tiga kelas data yang berbeda
-- ---------------------------------------------------------------------------
-- Menggabungkan ketiganya jadi satu `dokumen.enabled` akan memaksa rumah sakit
-- mengambil satu keputusan atas tiga pertanyaan yang jawabannya wajar berbeda:
--
--   hasil lab        angka pemeriksaan berikut nilai rujukannya. Data medis
--                    paling telanjang di seluruh proyek ini.
--   hasil radiologi  narasi bacaan dokter radiologi -- kalimat bebas, dan
--                    justru karena bebas ia bisa memuat apa saja.
--   nota/tagihan     daftar rinci layanan DAN nama obat, plus angka rupiah.
--                    Bukan hasil pemeriksaan, tapi daftar obat seseorang
--                    mengatakan penyakitnya dengan cukup jelas.
--
-- Rumah sakit yang bersedia mengirim notanya belum tentu bersedia mengirim
-- hasil labnya, dan sebaliknya. Ketiganya default MATI.
--
-- ---------------------------------------------------------------------------
-- Ini MEMBALIK premis §5.2, dan pembalikannya harus diambil sadar-sadar
-- ---------------------------------------------------------------------------
-- Sejak Fase 0 aturannya berbunyi: nama pemeriksaan, hasil, nama obat, dan
-- diagnosis TIDAK PERNAH di-SELECT dari `sik` -- merendernya bukan terlarang
-- melainkan mustahil. Fitur ini membaca persis kolom-kolom itu.
--
-- Yang membuatnya bisa dipertanggungjawabkan, dan hanya itu: PENERIMANYA
-- PASIEN ITU SENDIRI, yang memang berhak atas hasilnya. Alasan yang sama
-- membolehkan `administrasi.sertakan_diagnosa` (026). Aturan §5.2 lahir dari
-- pesan yang bisa terbaca orang lain -- notifikasi yang muncul di layar kunci,
-- ponsel yang dipegang bergantian, dan sejak `template_target` (018) juga grup
-- WhatsApp yang keanggotaannya diatur di luar sistem ini.
--
-- Karena itu ada satu aturan yang ditegakkan KODE dan bukan pengaturan:
-- **lampiran tidak pernah ikut ke salinan grup.** Baris `outbox` bertujuan
-- `chat_id` selalu dibuat tanpa media, apa pun `tujuan_mode`-nya. Tanpa aturan
-- itu, satu centang di /template mengubah hasil lab seorang pasien menjadi
-- berkas yang diterima setiap anggota sebuah grup.
--
-- ---------------------------------------------------------------------------
-- Yang TIDAK ada di sini, dan sengaja
-- ---------------------------------------------------------------------------
-- Tidak ada sakelar "kirim ke grup juga" dan tidak ada variabel template yang
-- membocorkan isi berkasnya ke badan pesan. Isi dokumen tinggal DI DALAM
-- dokumen; pesan pengantarnya hanya boleh menyebut nama pasien, no. RM, dan
-- identitas rumah sakit -- persis yang sudah dipakai jalur surat (026).

INSERT INTO app_setting (k, v) VALUES

-- ---------------------------------------------------------------------------
-- Sakelar per jenis, ketiganya MATI
-- ---------------------------------------------------------------------------
  ('dokumen.lab_enabled', '0'),
  ('dokumen.rad_enabled', '0'),
  ('dokumen.nota_enabled', '0'),

-- ---------------------------------------------------------------------------
-- Rincian obat pada nota -- sakelar TERSENDIRI, dan yang paling tajam di sini
-- ---------------------------------------------------------------------------
-- `billing` menyimpan nota yang SUDAH terangkai, baris demi baris, termasuk
-- nama dagang tiap obat yang diserahkan ("Cefixime 200mg ... (Kapsul)"). Daftar
-- obat seseorang adalah bagian yang paling tidak boleh berpindah tangan --
-- itulah alasan `FARMASI_TEMPLATE_VARIABLES` sampai sekarang tidak punya
-- variabelnya sama sekali.
--
-- Saat mati, baris obatnya DIRINGKAS jadi satu baris total ("Obat & BHP"),
-- bukan dihilangkan: nota yang angkanya tidak berjumlah adalah nota yang tidak
-- bisa dicocokkan dengan yang dibayar di kasir, dan yang muncul bukan galat
-- melainkan pasien yang menelepon menanyakan selisih.
--
-- Bawaannya MATI, jadi rumah sakit yang menyalakan nota tanpa membaca apa pun
-- mendapat bentuk yang paling sempit.
  ('dokumen.nota_rincian_obat', '0'),

-- ---------------------------------------------------------------------------
-- Kuota render per siklus -- syarat hidup, bukan penghematan
-- ---------------------------------------------------------------------------
-- Satu dokumen = satu peluncuran Chromium (~480 ms) DI DALAM proses worker,
-- yang juga memegang sesi WhatsApp. Chromium yatim di proses itulah yang pernah
-- menjatuhkannya ke crash loop 29 kali beruntun (CLAUDE.md §"Operasi
-- produksi"). Pelajaran yang sama sudah dibayar di
-- `administrasi.auto_max_per_siklus`.
--
-- Lima, bukan sepuluh, karena siklusnya berbeda: surat sakit otomatis berjalan
-- tiap 5 menit sementara ketiga pemicu ini kelas SISIP dan berjalan tiap 60
-- detik. Diukur di database ini nota terbit ~22/hari (puncak 46), jadi lima per
-- menit sudah jauh di atas laju sesungguhnya; angka ini menjaga LEDAKANNYA --
-- pemicu yang baru dinyalakan, atau watermark yang mengejar ketertinggalan
-- setelah worker mati semalam.
--
-- Yang KEHABISAN kuota tetap menerima PESANNYA, hanya tanpa berkas -- bukan
-- ditunda ke siklus berikutnya. Menahannya berarti membuat pemberitahuan yang
-- sudah berjalan sejak Fase 1 menjadi LEBIH LAMBAT gara-gara tempelan
-- opsionalnya, dan itu arah yang salah: pasien lebih baik menerima "hasil Anda
-- sudah tersedia" tepat waktu tanpa lampiran daripada menunggu sembilan menit
-- untuk keduanya. Aturan yang sama berlaku saat render gagal -- lihat
-- `worker/dokumenLampiran.ts`.
  ('dokumen.max_per_siklus', '5'),

-- ---------------------------------------------------------------------------
-- Pesan pengantar -- WAJIB terpisah dari `template.body`
-- ---------------------------------------------------------------------------
-- Badan template ketiga pemicu berbunyi "silakan ambil di bagian terkait atau
-- tanyakan ke loket" dan "silakan selesaikan pembayaran di kasir". Kalimat itu
-- benar selama yang dikirim cuma kabar, dan menjadi membingungkan begitu
-- berkasnya ikut -- pasien disuruh datang mengambil sesuatu yang sudah ada di
-- tangannya.
--
-- Dipakai HANYA saat lampirannya benar-benar terbentuk. Pesan tanpa lampiran
-- (poli sensitif, dokumen gagal dirender, jenisnya belum dinyalakan) tetap
-- memakai `template.body` apa adanya, jadi mematikan sakelar mengembalikan
-- perilaku persis seperti sebelum migrasi ini.
--
-- Berakhiran frasa berhenti seperti template pasien lain: janji yang dibaca
-- pasien tidak boleh lebih sempit dari yang dijalankan mesin, dan ketiga pemicu
-- ini memang terikat daftar tolak.
  ('dokumen.pesan_lab',
   'Bpk/Ibu {nama_pasien}, berikut hasil pemeriksaan laboratorium Anda dari {nama_rs} dalam bentuk berkas PDF. Hasil ini perlu dibaca bersama dokter -- silakan bawa saat kontrol atau hubungi {kontak_rs}. No. RM: {no_rm}. Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.'),
  ('dokumen.pesan_rad',
   'Bpk/Ibu {nama_pasien}, berikut hasil pemeriksaan radiologi Anda dari {nama_rs} dalam bentuk berkas PDF. Hasil ini perlu dibaca bersama dokter -- silakan bawa saat kontrol atau hubungi {kontak_rs}. No. RM: {no_rm}. Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.'),
  ('dokumen.pesan_nota',
   'Bpk/Ibu {nama_pasien}, berikut rincian tagihan Anda dari {nama_rs} dalam bentuk berkas PDF. Simpan berkas ini sebagai bukti. Bila ada yang perlu ditanyakan, hubungi {kontak_rs}. No. RM: {no_rm}. Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.'),

-- ---------------------------------------------------------------------------
-- Catatan kaki asal-usul -- kosong = pakai bawaan di kode
-- ---------------------------------------------------------------------------
-- Sama seperti `administrasi.catatan_kaki`, dan alasannya sama: berkas PDF yang
-- beredar di WhatsApp lepas dari sistem yang membuatnya. Tanpa satu baris pun
-- yang menyebut asalnya, ia tidak bisa dibedakan dari berkas yang disunting
-- siapa pun. Kosong TIDAK berarti tanpa catatan kaki -- ia berarti memakai
-- bentuk bawaan, karena ini bagian yang tidak boleh hilang cuma karena
-- kotaknya kosong.
  ('dokumen.catatan_kaki', '')

ON DUPLICATE KEY UPDATE v = v;
