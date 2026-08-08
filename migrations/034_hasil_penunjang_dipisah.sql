-- 034_hasil_penunjang_dipisah.sql
-- RESULT_READY dipecah jadi DUA pemicu: LAB_RESULT dan RAD_RESULT.
--
-- Sesudah migrasi ini, keempat pemicu penunjang jadi simetris -- dua ujung
-- yang sama, dipisah dengan cara yang sama:
--
--   dokter MEMESAN     LAB_REQUEST   RAD_REQUEST   (025)
--   hasil SELESAI      LAB_RESULT    RAD_RESULT    (di sini)

-- ---------------------------------------------------------------------------
-- Kenapa dipisah, dan kenapa alasannya BUKAN isi pesannya
-- ---------------------------------------------------------------------------
-- 025 sudah menuliskan alasan ini untuk permintaan, dan alasan itu berlaku
-- utuh di sini -- yang keliru adalah menganggapnya tidak berlaku:
--
--   "Yang menuntut pemisahan bukan isi pesannya melainkan TUJUANNYA: sejak
--    `template_target` (018), tiap `trigger_code` punya daftar tujuan
--    tambahannya sendiri. Satu kode bersama berarti grup Laboratorium dan grup
--    Radiologi tidak bisa dipisahkan -- keduanya menerima setiap permintaan,
--    termasuk yang bukan pekerjaannya."
--
-- Ganti "permintaan" dengan "hasil" dan kalimatnya tetap benar. Waktu 025
-- ditulis, RESULT_READY dibiarkan menyatu dengan alasan "pesannya memang sama
-- dan {jenis_layanan} cukup membedakannya" -- yang menjawab pertanyaan tentang
-- ISI, bukan tentang TUJUAN. Akibat nyatanya: `tujuan_mode` dan daftar tujuan
-- RESULT_READY berlaku untuk lab DAN radiologi sekaligus, jadi mustahil
-- mengirim hasil lab ke grup Laboratorium tanpa grup Radiologi ikut menerima
-- setiap hasil lab, dan sebaliknya.
--
-- Yang ikut didapat gratis, dan tidak bisa didapat dengan cara lain: isi pesan,
-- sakelar aktif, dan mode tujuan yang terpisah. Rumah sakit yang cuma ingin
-- memberitahukan hasil radiologi sekarang bisa menyalakan satu tanpa satunya.

-- ---------------------------------------------------------------------------
-- Migrasi ini WAJIB nol-perubahan-perilaku, dan itu yang menentukan bentuknya
-- ---------------------------------------------------------------------------
-- `template.is_active` adalah sakelar KEBIJAKAN rumah sakit. Memecah satu baris
-- jadi dua dengan `is_active = 0` bawaan -- pola yang benar untuk pemicu BARU
-- (025, 032, 033) -- di sini akan MEMATIKAN pemberitahuan yang sedang berjalan,
-- diam-diam, sebagai efek samping refaktor. Begitu pula `body` yang mungkin
-- sudah disunting staf lewat /template, dan `tujuan_mode` beserta daftar
-- tujuannya.
--
-- Karena itu keempatnya DISALIN dari baris lama, bukan ditulis ulang di sini:
--
--   is_active     -> pemicu yang menyala tetap menyala, yang mati tetap mati
--   body          -> suntingan staf tidak hilang (pelajaran REPLACE() di 011)
--   tujuan_mode   -> mode 'tujuan' tidak diam-diam kembali ke 'pasien'
--   updated_by    -> teksnya tetap tercatat milik siapa
--
-- `label` justru TIDAK disalin: ia yang membedakan kedua baris barunya di
-- layar, dan dua baris berlabel "Hasil penunjang selesai" tidak bisa dibedakan
-- staf sama sekali.
--
-- {jenis_layanan} tetap terisi sesudah pemisahan (worker mengisinya per jenis
-- seperti sebelumnya), jadi body salinan menghasilkan pesan yang sama persis
-- karakter demi karakter. Rumah sakit yang mau boleh menggantinya dengan kata
-- "laboratorium"/"radiologi" langsung, tapi itu keputusan mereka, bukan efek
-- samping migrasi.
INSERT INTO template (trigger_code, label, body, is_active, tujuan_mode, updated_by)
SELECT 'LAB_RESULT', 'Hasil laboratorium selesai', body, is_active, tujuan_mode, updated_by
  FROM template WHERE trigger_code = 'RESULT_READY';

INSERT INTO template (trigger_code, label, body, is_active, tujuan_mode, updated_by)
SELECT 'RAD_RESULT', 'Hasil radiologi selesai', body, is_active, tujuan_mode, updated_by
  FROM template WHERE trigger_code = 'RESULT_READY';

-- Tujuan tambahan ikut disalin ke KEDUANYA, bukan dibiarkan hilang. Kalau
-- tidak, `tujuan_mode = 'tujuan'` yang ikut tersalin akan menghasilkan pemicu
-- yang pesannya tidak pergi ke mana pun -- keadaan yang sengaja dijaga tiga
-- lapis di /template justru karena tidak meninggalkan satu baris `outbox` pun
-- untuk dilihat siapa pun.
--
-- Sesudah ini keduanya bisa dipisahkan lewat halaman Template, dan itulah
-- seluruh gunanya migrasi ini. Yang tidak boleh terjadi adalah pemisahan itu
-- dilakukan DI SINI dengan menebak grup mana yang mengurus lab dan mana yang
-- radiologi -- tidak ada satu pun kolom yang menjawabnya.
INSERT INTO template_target (trigger_code, jenis, chat_id, label, is_active, created_by, updated_by)
SELECT 'LAB_RESULT', jenis, chat_id, label, is_active, created_by, updated_by
  FROM template_target WHERE trigger_code = 'RESULT_READY';

INSERT INTO template_target (trigger_code, jenis, chat_id, label, is_active, created_by, updated_by)
SELECT 'RAD_RESULT', jenis, chat_id, label, is_active, created_by, updated_by
  FROM template_target WHERE trigger_code = 'RESULT_READY';

DELETE FROM template_target WHERE trigger_code = 'RESULT_READY';
DELETE FROM template WHERE trigger_code = 'RESULT_READY';

-- ---------------------------------------------------------------------------
-- Ambang basi ikut pindah, dengan angkanya yang sekarang -- bukan angka seed
-- ---------------------------------------------------------------------------
-- `dispatch.stale_hours_by_trigger` berkunci pada kode pemicu. Kode yang tidak
-- ada di dalamnya jatuh ke `dispatch.stale_threshold_hours_default` (6 jam),
-- jadi membiarkannya berarti hasil penunjang berubah dari 12 jam jadi 6 --
-- pengetatan diam-diam yang tidak diminta siapa pun, dan yang muncul sebagai
-- pesan `expired` alih-alih sebagai galat.
--
-- Lewat JSON_SET, bukan REPLACE() atas teksnya: angkanya bisa saja sudah
-- disunting staf lewat /pengaturan, dan yang harus ikut pindah adalah angka
-- yang BERLAKU sekarang, bukan 12 yang kebetulan tertulis di seed 002.
UPDATE app_setting
   SET v = JSON_REMOVE(
             JSON_SET(v,
                      '$.LAB_RESULT', JSON_EXTRACT(v, '$.RESULT_READY'),
                      '$.RAD_RESULT', JSON_EXTRACT(v, '$.RESULT_READY')),
             '$.RESULT_READY')
 WHERE k = 'dispatch.stale_hours_by_trigger'
   AND JSON_EXTRACT(v, '$.RESULT_READY') IS NOT NULL;

-- ---------------------------------------------------------------------------
-- YANG SENGAJA TIDAK DISENTUH -- dan ini bagian paling berbahaya dari migrasi
-- ---------------------------------------------------------------------------
-- 1. `poll_cursor`. Watermarknya SUDAH terpisah sejak awal dan bernama
--    `RESULT_READY_LAB` / `RESULT_READY_RADIOLOGI`. Namanya kini tidak lagi
--    cocok dengan kode pemicunya, dan menyelaraskannya terasa rapi -- tapi
--    watermark yang namanya berubah adalah watermark yang HILANG: `getCursor`
--    tidak menemukan barisnya, jatuh ke `now - polling.lookback_days` (30
--    hari), lalu poller membaca ulang sebulan penuh hasil pemeriksaan. Jangan
--    diganti. Nama kunci itu murni identitas baris, bukan keterangan.
--
-- 2. Kunci idempoten. Ia tetap diturunkan dari 'RESULT_READY' di
--    `pollerResultReady.ts` justru supaya hasil yang SUDAH pernah dikirim tetap
--    dikenali sebagai duplikat sesudah pemisahan ini. `jenis` sudah jadi bagian
--    kuncinya sejak awal, jadi lab dan radiologi memang tidak pernah bertabrakan.
--
-- 3. Baris `outbox` lama ber-`trigger_code = 'RESULT_READY'`. Ia riwayat, dan
--    riwayat tidak ditulis ulang. `TRIGGER_LABEL` karena itu tetap memuat
--    RESULT_READY sebagai baris peninggalan supaya halaman Antrean dan Log
--    tidak menampilkan kode mentah, dan `OPT_OUT_TRIGGERS` tetap memuatnya
--    supaya baris yang mungkin masih `pending` tetap terikat daftar tolak.
