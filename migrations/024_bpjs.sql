-- 024_bpjs.sql
-- BPJS -- dua pemicu yang sumbernya BUKAN alur kerja internal Khanza melainkan
-- kanal BPJS (Mobile JKN dan surat kontrol), dan karena itu arah pemicunya
-- berbeda satu sama lain:
--
--   BPJS_BATAL    pasien membatalkan sendiri lewat aplikasi Mobile JKN
--                 -> diberitahukan ke GRUP/PETUGAS (seperti notifikasi farmasi)
--   BPJS_KONTROL  surat kontrol punya tanggal rencana di masa depan
--                 -> mengingatkan PASIEN H-N (seperti BOOK_REMIND)
--
-- Keduanya di satu halaman karena sumber datanya satu (BPJS), tapi keduanya
-- TIDAK berbagi sakelar, tujuan, maupun perlakuan jam tenang -- lihat kolom
-- terpisah di bawah, dan alasannya sama dengan yang membuat 020/021 memisahkan
-- `boleh_tanya` dan `terima_darurat_stok`: pilihan yang digabung adalah pilihan
-- yang hilang.

-- ---------------------------------------------------------------------------
-- bpjs_target -- tujuan, TABEL SENDIRI dan bukan kolom keempat di farmasi_target
-- ---------------------------------------------------------------------------
-- Menumpang `farmasi_target` akan tampak hemat: bentuk barisnya identik
-- (chat_id + label + jenis), dan validasinya memang dipakai bersama
-- (core/farmasiTarget.ts). Tapi tabel itu menjawab pertanyaan-pertanyaan
-- tentang APOTEK, dan halaman /farmasi menampilkan SELURUH barisnya sebagai
-- "tujuan apotek". Menambahkan tujuan BPJS ke sana membuat grup pendaftaran
-- muncul di daftar tujuan apotek berikut tiga centang yang tidak berlaku
-- baginya -- dan sebaliknya, satu tujuan yang dihapus dari halaman /farmasi
-- diam-diam mematikan notifikasi BPJS yang tidak ditampilkan di halaman itu.
--
-- Alamat yang SAMA boleh ada di kedua tabel. Itu bukan duplikasi yang perlu
-- disatukan: satu grup yang menerima notifikasi apotek DAN pembatalan BPJS
-- adalah dua keputusan berbeda yang kebetulan menuju alamat yang sama, dan
-- mencabut salah satunya tidak boleh mencabut satunya lagi.
CREATE TABLE bpjs_target (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- 'grup' | 'personal', dinormalisasi core/farmasiTarget.ts sebelum disimpan.
  jenis      ENUM('grup','personal') NOT NULL,
  -- JID LENGKAP untuk kedua jenis (`628xxx@c.us` / `120363xxx@g.us`), sehingga
  -- dispatcher meneruskannya apa adanya. VARCHAR(64) mengikuti outbox.chat_id;
  -- VARCHAR(20) milik phone_e164 tidak muat untuk JID grup yang 24 karakter --
  -- pelajaran yang sudah dibayar di migrations/016.
  chat_id    VARCHAR(64) NOT NULL,
  label      VARCHAR(80) NOT NULL,

  -- DUA centang terpisah, sengaja, dan keduanya bawaan MATI.
  --
  -- terima_batal   : pembatalan Mobile JKN. Isinya menyebut NAMA PASIEN dan
  --                  poli tujuannya -- data pasien, dan itu yang membuat
  --                  centang ini berat.
  -- terima_kontrol : SALINAN pengingat kontrol yang dikirim ke pasien.
  --                  Aslinya tetap ke pasien; ini untuk loket yang ingin tahu
  --                  siapa saja yang diingatkan hari itu.
  --
  -- Digabung jadi satu kolom akan salah ke dua arah sekaligus, dan keduanya
  -- pemakaian yang wajar: grup pendaftaran yang perlu tahu pembatalan (supaya
  -- slotnya bisa diisi pasien lain) tanpa ikut menerima salinan tiap pengingat,
  -- dan sebaliknya.
  terima_batal   TINYINT(1) NOT NULL DEFAULT 0,
  terima_kontrol TINYINT(1) NOT NULL DEFAULT 0,

  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Satu alamat satu baris DI DALAM tabel ini. Tanpa ini, dua baris untuk grup
  -- yang sama menghasilkan dua pesan per kejadian -- dan yang terlihat di grup
  -- adalah "sistemnya mengirim dobel", bukan "ada dua baris tujuan".
  UNIQUE KEY uq_chat (chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Pengaturan
-- ---------------------------------------------------------------------------
INSERT INTO app_setting (k, v) VALUES

-- Sakelar utama halaman. MATI, konsisten dengan farmasi.enabled dan
-- autoreply.enabled: fitur yang mengirim WhatsApp atas inisiatifnya sendiri
-- dinyalakan sadar-sadar, bukan menyala karena kebetulan termigrasi.
('bpjs.enabled', '0'),

-- === Tab 1: pembatalan Mobile JKN =========================================
('bpjs.batal_enabled', '0'),

-- Ambang rekap, alasan yang sama persis dengan farmasi.max_per_cycle: satu
-- pembatalan massal (admin membatalkan seluruh jadwal seorang dokter yang
-- berhalangan) menghasilkan puluhan baris dalam satu siklus, dan mengirimnya
-- satu per satu adalah pola beruntun yang memicu deteksi spam WhatsApp pada
-- SATU-SATUNYA nomor rumah sakit -- notifikasi pasien ikut mati bersamanya.
('bpjs.batal_max_per_cycle', '20'),

-- {keterangan} adalah alasan batal yang ditulis di kolom `keterangan` Khanza
-- ("Dibatalkan Oleh Admin"). Ia teks bebas dari sistem luar, jadi ikut lewat
-- sanitizeValue seperti variabel satu-baris lainnya.
('bpjs.template_batal',
 '*Pembatalan Mobile JKN*\n{nama_rs}\n\nPasien : {nama_pasien} ({no_rm})\nPoli : {nama_poli}\nJadwal : {tanggal} {jam}\nDibatalkan : {tanggal_batal}\nKeterangan : {keterangan}'),

-- Padanan generik untuk poli sensitif (F4.3). BUKAN privacy.generic_template:
-- yang itu ditulis untuk PASIEN ("ada informasi dari rumah sakit") dan tidak
-- berguna bagi loket. Alasan yang sama dengan farmasi.template_generic --
-- penerimanya tetap perlu tahu ada slot yang kosong, tanpa membaca siapa yang
-- berurusan dengan layanan sensitif itu.
('bpjs.template_batal_generic',
 '*Pembatalan Mobile JKN*\n{nama_rs}\n\nAda satu booking yang dibatalkan pasien pada {tanggal_batal}. Rinciannya dapat dilihat di SIMRS.'),

('bpjs.template_batal_rekap',
 '*Pembatalan Mobile JKN*\n{nama_rs}\n\n{jumlah_batal} booking dibatalkan pasien. Rinciannya dapat dilihat di SIMRS.'),

-- === Tab 2: pengingat surat kontrol =======================================
('bpjs.kontrol_enabled', '0'),

-- Berapa hari SEBELUM tanggal rencana kontrol pengingat dikirim. Daftar
-- dipisah koma, jadi "7,1" berarti dua pengingat: sepekan sebelumnya dan
-- H-1. '0' berarti hari-H itu sendiri.
--
-- Daftar, bukan satu angka, karena itulah bentuk pertanyaan yang sebenarnya:
-- pasien kontrol dijadwalkan berminggu-minggu di muka, dan satu pengingat
-- saja terlalu awal untuk diingat atau terlalu telat untuk mengatur perjalanan.
('bpjs.kontrol_hari_sebelum', '1'),

-- Jam dinding WIB saat pengingat dikirim. Dibaca ULANG tiap siklus worker
-- (bukan sekali saat worker mulai seperti schedule.book_remind_hour), supaya
-- mengubahnya di dashboard berlaku hari itu juga alih-alih menunggu restart
-- yang tidak diminta siapa pun.
('bpjs.kontrol_jam', '9'),

-- Penanda tanggal terakhir jalan (YYYY-MM-DD), DITULIS WORKER.
--
-- Ditaruh di app_setting -- berbeda dari stok_alert_schedule.next_run_at yang
-- sengaja diberi tabel sendiri justru untuk menghindari ini. Bedanya: nilai ini
-- hanya menghemat satu query, BUKAN penentu kebenaran. Kalaupun admin
-- membukanya lalu menyimpannya kembali sehingga penandanya mundur, yang terjadi
-- cuma satu query ulang -- pesannya sendiri tetap ditolak `uq_idem` karena
-- kunci idempotennya memuat no_surat + tanggal rencana + selisih harinya.
-- Kunci ini juga sengaja TIDAK didaftarkan di EDITABLE_KEYS.
('bpjs.kontrol_last_run', ''),

-- Apakah pasien ikut dikirimi. Menyalakan tab ini dengan nilai '0' berarti
-- HANYA salinan ke tujuan yang dicentang terima_kontrol yang terkirim -- bentuk
-- "loket ingin daftarnya, pasien belum" yang wajar saat rumah sakit masih
-- menimbang dasar persetujuannya. Padanan `template.tujuan_mode` = 'tujuan'.
('bpjs.kontrol_ke_pasien', '1'),

-- {tanggal_kontrol} = tgl_rencana, {sisa_hari} = berapa hari lagi.
-- {nama_dokter}/{nama_poli} diambil dari kolom BPJS pada surat kontrol
-- (nm_dokter_bpjs/nm_poli_bpjs), bukan dari `dokter`/`poliklinik` -- itulah
-- nama yang tercetak di surat yang dipegang pasien.
--
-- Berakhiran frasa berhenti berlangganan, sama seperti ketujuh template pasien
-- (lihat migrations/011). WAJIB, bukan gaya: BPJS_KONTROL terikat opt-out di
-- core/optOut.ts, dan pemicu yang terikat tapi tidak pernah menyebutkan caranya
-- berhenti membuat janji itu tidak bisa dijalankan pasien yang menerimanya.
('bpjs.template_kontrol',
 'Yth. {nama_pasien}, kami mengingatkan jadwal kontrol Anda di {nama_rs}:\n\nTanggal : {tanggal_kontrol} ({sisa_hari})\nPoli : {nama_poli}\nDokter : {nama_dokter}\n\nMohon membawa surat kontrol dan kartu JKN. Informasi: {kontak_rs}\n\nBalas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.'),

-- Padanan generik poli sensitif untuk pengingat kontrol. Yang ini TETAP
-- privacy.generic_template pada jalurnya sendiri lewat checkPrivacy di
-- enqueueMessage -- baris ini hanya dipakai bila rumah sakit ingin bunyi yang
-- berbeda khusus kanal BPJS. Kosong = pakai privacy.generic_template.
('bpjs.template_kontrol_generic', '');
