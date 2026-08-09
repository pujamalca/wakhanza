-- 035_konfirmasi_terkirim.sql
-- KONFIRMASI TERKIRIM -- membedakan "WhatsApp menerima titipannya" dari
-- "penerimanya benar-benar dapat".
--
-- Sampai migrasi ini, satu-satunya sinyal keberhasilan adalah `outbox.status =
-- 'sent'`, dan artinya jauh lebih lemah daripada yang dibaca orang: ia cuma
-- menyatakan `client.sendMessage()` pulang tanpa melempar. Kiriman ke JID grup
-- yang sama sekali TIDAK ADA pun berakhir `sent` -- dibuktikan langsung dan
-- sudah tercatat di CLAUDE.md. Untuk pemicu yang menuju grup staf itu masih bisa
-- ditolerir karena ada manusia yang menyadari grupnya sepi; untuk notifikasi
-- PASIEN tidak ada seorang pun di ujung sana yang akan mengeluh.
--
-- Akibat praktisnya: pertanyaan yang paling sering datang lewat telepon --
-- "pasiennya benar-benar dapat, tidak?" -- tidak bisa dijawab dari mana pun.
-- Dan pertanyaan itu pula yang menahan RS menyalakan mode pasien: selama
-- "terkirim" tidak bisa dibedakan dari "hilang", tidak ada dasar untuk berani.

-- ---------------------------------------------------------------------------
-- Kenapa TIGA kolom, bukan satu
-- ---------------------------------------------------------------------------
--
-- `wa_message_id` adalah satu-satunya penghubung antara baris ini dan event
-- `message_ack` yang datang belakangan. Event itu cuma membawa objek pesan
-- WhatsApp; tanpa menyimpan id-nya saat kirim, tidak ada cara mencocokkannya
-- kembali ke baris `outbox` mana pun.
--
-- `ack_level` dan `ack_at` dipisah karena keduanya menjawab hal berbeda:
-- tingkatnya (sampai ke server / ke HP / dibaca) dan KAPAN tingkat itu tercapai.
-- Satu kolom gabungan akan memaksa penguraian teks tiap kali dibaca.

ALTER TABLE outbox
  -- VARCHAR(64): id pesan WhatsApp berbentuk `true_628xxx@c.us_3EB0...`, dan
  -- yang terpanjang teramati masih jauh di bawah ini. Kolom terlalu pendek akan
  -- DIPOTONG diam-diam oleh MariaDB non-strict, lalu pencocokan ack-nya selalu
  -- meleset tanpa satu pun galat -- pelajaran yang sudah dibayar dua kali di
  -- proyek ini (`idempotency_key` pada template_target, `phone_e164` pada
  -- auto_reply_log).
  ADD COLUMN wa_message_id VARCHAR(64) NULL DEFAULT NULL AFTER sent_at,

  -- TINYINT dan bukan ENUM: nilainya milik whatsapp-web.js (-1 s/d 4), jadi
  -- tingkat baru dari pustaka itu tidak boleh menjatuhkan INSERT. Yang menjaga
  -- artinya adalah `isTingkatAck()` di core/waAck.ts, yang MENOLAK nilai tak
  -- dikenal sebelum sempat tersimpan.
  ADD COLUMN ack_level TINYINT NULL DEFAULT NULL AFTER wa_message_id,

  ADD COLUMN ack_at DATETIME NULL DEFAULT NULL AFTER ack_level,

  -- Dicari lewat id saat event ack datang, dan itu satu-satunya aksesnya.
  -- Tanpa indeks, tiap ack -- yang datangnya beberapa kali PER PESAN -- memindai
  -- `outbox`, tabel yang paling cepat tumbuh di skema ini.
  ADD INDEX ix_wa_message (wa_message_id);

-- ---------------------------------------------------------------------------
-- Yang SENGAJA tidak dilakukan
-- ---------------------------------------------------------------------------
--
-- 1. TIDAK menambah status baru ke ENUM `outbox.status`. Konfirmasi adalah
--    dimensi KEDUA, bukan kelanjutan dari status: sebuah baris tetap `sent`
--    sementara ack-nya bergerak dari server ke HP ke dibaca. Menjadikannya
--    status akan memaksa `core/outboxStatus.ts` memutuskan apakah "delivered"
--    itu terminal atau aktif -- pertanyaan yang tidak punya jawaban benar, dan
--    dispatcher/cleanup/Ringkasan ketiganya akan menafsirkannya sendiri-sendiri.
--
-- 2. TIDAK mengisi mundur baris lama. Ack hanya tiba untuk pesan yang dikirim
--    selama sesi hidup; 401 baris yang sudah ada tidak akan pernah punya
--    kabarnya, dan menebak nilainya berarti mengarang bukti pengiriman.
--
-- 3. TIDAK ada grant baru. `wakhanza_rw` sudah punya UPDATE pada `outbox`
--    (dispatcher memakainya), dan kolom bukan tabel -- dibuktikan empiris pada
--    migrations/028, bukan diasumsikan.
--
-- CATATAN PENTING untuk siapa pun yang membaca kolom ini: `ack_level` KOSONG
-- TIDAK berarti pesannya tidak sampai. Konfirmasi cuma datang selama sesi yang
-- mengirimnya masih hidup, jadi pesan yang dikirim sebelum worker dimulai ulang
-- kemungkinan besar tidak pernah mendapat ack-nya walau benar-benar diterima.
-- Kolom ini bukti POSITIF ("ini sampai"), bukan bukti negatif ("ini tidak").
