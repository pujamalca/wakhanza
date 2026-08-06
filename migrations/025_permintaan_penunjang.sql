-- 025_permintaan_penunjang.sql
-- PERMINTAAN lab dan radiologi -- pasangan RESULT_READY dari ujung yang lain.
--
--   PERMINTAAN  dokter MEMESAN pemeriksaan  -> "ada yang harus Anda jalani"
--   RESULT_READY hasilnya selesai           -> "hasilnya sudah bisa diambil"
--
-- Yang pertama belum ada sampai migrasi ini, dan ketiadaannya punya akibat
-- nyata: pasien rawat jalan yang pulang tanpa tahu ada permintaan lab akan
-- datang lagi hanya untuk itu, dan bagian penunjang tidak pernah tahu ada
-- pekerjaan masuk sampai pasiennya muncul di loket.

-- ---------------------------------------------------------------------------
-- DUA baris, bukan satu -- berbeda dari RESULT_READY
-- ---------------------------------------------------------------------------
-- RESULT_READY menangani lab DAN radiologi lewat SATU `trigger_code` (dibedakan
-- hanya oleh dua watermark terpisah di `poll_cursor`), karena pesannya memang
-- sama: "hasil Anda sudah tersedia", dan `{jenis_layanan}` cukup membedakannya.
--
-- Untuk permintaan itu TIDAK cukup, dan sebabnya bukan isi pesannya melainkan
-- TUJUANNYA: sejak `template_target` (018), tiap `trigger_code` punya daftar
-- tujuan tambahannya sendiri. Satu kode bersama berarti grup Laboratorium dan
-- grup Radiologi tidak bisa dipisahkan -- keduanya menerima setiap permintaan,
-- termasuk yang bukan pekerjaannya. Dua kode membuat pemisahan itu mungkin
-- tanpa satu baris kode tambahan.
--
-- Konsekuensi yang harus disadari: `template` TIDAK LAGI berisi tujuh baris.
-- Klaim "tepat tujuh baris selamanya" di CLAUDE.md ikut diperbarui bersama
-- migrasi ini -- yang benar sejak awal adalah "satu baris per pemicu pasien".

-- ---------------------------------------------------------------------------
-- is_active = 0, dan ini BUKAN sekadar meniru pola
-- ---------------------------------------------------------------------------
-- Enam dari tujuh baris yang sudah ada pun nonaktif di instalasi ini. Yang
-- membuatnya wajib di sini: worker memungut pemicu lewat
-- `Template.findByPk(triggerCode)` dan langsung berjalan begitu barisnya aktif,
-- jadi baris aktif yang termigrasi diam-diam akan mulai mengirim WhatsApp ke
-- pasien tanpa seorang pun memutuskannya -- dan `polling.lookback_days` (30)
-- berarti kiriman pertamanya adalah SELURUH permintaan sebulan terakhir
-- sekaligus.
INSERT INTO template (trigger_code, label, body, is_active, tujuan_mode) VALUES

('LAB_REQUEST',
 'Permintaan pemeriksaan lab',
 -- Nama pemeriksaannya SENGAJA tidak disebut, dan variabelnya memang tidak ada
 -- (§5.2 -- `jns_perawatan_lab.nm_perawatan` tidak pernah diambil dari sik).
 -- Yang perlu diketahui pasien adalah bahwa ada pemeriksaan yang menunggu dan
 -- ke mana ia harus pergi; apa pemeriksaannya sudah ada di lembar permintaan
 -- yang dipegangnya, tempat kendali aksesnya memang ada.
 'Bpk/Ibu {nama_pasien}, dokter {nama_dokter} meminta pemeriksaan laboratorium untuk Anda di {nama_rs} pada {tanggal} {jam}. Silakan menuju bagian Laboratorium. No. RM: {no_rm}. Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.',
 0,
 'pasien'),

('RAD_REQUEST',
 'Permintaan pemeriksaan radiologi',
 'Bpk/Ibu {nama_pasien}, dokter {nama_dokter} meminta pemeriksaan radiologi untuk Anda di {nama_rs} pada {tanggal} {jam}. Silakan menuju bagian Radiologi. No. RM: {no_rm}. Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.',
 0,
 'pasien');
