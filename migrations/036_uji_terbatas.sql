-- 036_uji_terbatas.sql
-- MODE UJI TERBATAS -- batas harian berapa PASIEN yang boleh menerima satu
-- pemicu, supaya menyalakan mode pasien tidak harus taruhan penuh.
--
-- `template.tujuan_mode` semua-atau-tidak. Begitu diubah dari `tujuan` ke
-- `pasien_dan_tujuan`, SELURUH kejadian hari itu langsung menjadi WhatsApp ke
-- pasien -- di rumah sakit ini sekitar 22 kunjungan per hari, jadi 22 orang
-- sekaligus pada hari pertama. Tidak ada satu pun cara mencobanya lebih kecil
-- dulu, dan kalau ada yang keliru (kalimatnya, nomornya, jam kirimnya) yang
-- menanggung 22 orang sekaligus sementara yang menerima keluhannya loket.
--
-- PRD Fase 5 menyebutnya "uji coba bertahap" dan selama ini diperlakukan
-- sebagai proses operasional semata. Sebagiannya memang begitu -- tapi
-- "bertahap" tidak bisa dijalankan sama sekali tanpa bentuk kodenya.

-- ---------------------------------------------------------------------------
-- 0 = TANPA BATAS, dan itu WAJIB bawaannya
-- ---------------------------------------------------------------------------
--
-- Seluruh baris yang sudah ada mendapat 0. Menafsirkannya sebagai "nol pesan"
-- akan MEMATIKAN setiap pemicu pasien yang sedang berjalan pada detik migrasi
-- ini diterapkan -- diam-diam, sebagai efek samping penambahan fitur, persis
-- kelas kegagalan yang migrations/034 ada untuk dihindari. Penafsirannya
-- ditegakkan `bolehKirimKePasien()` di core/ujiTerbatas.ts dan dipatok uji.
--
-- Batasnya per PEMICU, bukan satu angka global: QUEUE_REG berbunyi ~22 kali
-- sehari sementara KONTROL_TERBIT beberapa kali seminggu, jadi satu angka
-- bersama akan terlalu ketat untuk yang satu dan tidak berarti apa-apa untuk
-- yang lain.

ALTER TABLE template
  ADD COLUMN batas_pasien_harian INT NOT NULL DEFAULT 0 AFTER tujuan_mode;

-- ---------------------------------------------------------------------------
-- Status baru: yang tertahan DICATAT, bukan dilewati diam-diam
-- ---------------------------------------------------------------------------
--
-- Ini keputusan terpenting di fitur ini. Baris yang tidak pernah dibuat tidak
-- muncul di Antrean mana pun, sehingga "pemicunya rusak" dan "jatahnya habis"
-- terlihat PERSIS SAMA dari dashboard -- dan yang pertama akan dikira yang
-- kedua sampai ada yang membaca kode. Dengan barisnya ada, staf melihat berapa
-- yang tertahan hari itu dan bisa memutuskan menaikkan batasnya.
--
-- Efek samping yang justru diinginkan: kunci idempotennya ikut tertulis, jadi
-- kejadian yang sama tidak dipertimbangkan lagi pada siklus berikutnya.
-- Menaikkan batas TIDAK membangkitkan pesan yang tertahan -- dan itu benar,
-- karena nomor antrian atau pengingat kemarin tidak berguna lagi hari ini.
--
-- Nilainya ditambahkan ke ENUM lewat MODIFY (MariaDB tidak punya "ADD VALUE"),
-- jadi seluruh daftarnya harus ditulis ulang. Urutannya WAJIB sama dengan
-- OUTBOX_STATUSES di core/outboxStatus.ts -- kalau menyimpang, nilai yang sah
-- di kode ditolak mesin database saat INSERT, dan itu baru muncul di produksi.

ALTER TABLE outbox
  MODIFY COLUMN status ENUM(
    'pending',
    'sending',
    'sent',
    'failed',
    'failed_permanent',
    'skipped_no_contact',
    'skipped_opt_out',
    'skipped_uji_terbatas',
    'expired'
  ) NOT NULL DEFAULT 'pending';

-- ---------------------------------------------------------------------------
-- Yang SENGAJA tidak dilakukan
-- ---------------------------------------------------------------------------
--
-- 1. TIDAK berlaku untuk BROADCAST maupun AUTO_REPLY. Broadcast sudah punya
--    pagarnya sendiri (`broadcast.max_recipients`) dan selalu ada staf yang
--    meninjau segmennya; balasan otomatis menjawab orang yang baru saja
--    bertanya, dan menahannya karena kuota berarti mendiamkan penanya. Yang
--    dibatasi di sini khusus pemicu OTOMATIS ke pasien.
--
-- 2. TIDAK menghitung salinan ke grup. Yang dibatasi adalah paparan ke PASIEN,
--    bukan lalu lintas pesan; sebuah pemicu bermode `tujuan` tidak menyentuh
--    jatah ini sama sekali, dan memang seharusnya begitu -- ia tidak mengirim
--    apa pun ke pasien mana pun.
--
-- 3. TIDAK ada grant baru: `wakhanza_rw` sudah punya UPDATE pada `template`
--    dan `outbox`, dan kolom bukan tabel.
