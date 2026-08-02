-- Lampiran gambar/dokumen untuk BROADCAST manual (/broadcast).
--
-- Lingkupnya sengaja sempit: hanya broadcast yang dikirim staf sambil meninjau.
-- Broadcast terjadwal, tujuh pemicu otomatis, dan balasan otomatis tetap teks,
-- karena ketiganya mengirim TANPA ada manusia yang melihat isinya tiap kali.
--
-- Berkasnya sendiri TIDAK disimpan di database, hanya lintasannya. Satu
-- broadcast ke 500 pasien menghasilkan 500 baris outbox yang menunjuk SATU
-- berkas yang sama -- menyimpan blob-nya per baris akan menggandakan poster
-- 5 MB sebanyak 500 kali di tabel yang paling cepat tumbuh di skema ini.
ALTER TABLE outbox
  ADD COLUMN IF NOT EXISTS media_path VARCHAR(255) NULL AFTER body,
  ADD COLUMN IF NOT EXISTS media_mime VARCHAR(100) NULL AFTER media_path,
  ADD COLUMN IF NOT EXISTS media_name VARCHAR(255) NULL AFTER media_mime;

-- Jejak akuntabilitas: apa yang dilampirkan pada kampanye ini. broadcast_campaign
-- insert-only, jadi ini catatan tetap tentang berkas yang pernah dikirim --
-- tetap terbaca walau berkasnya sudah dipangkas cleanup 90 hari.
ALTER TABLE broadcast_campaign
  ADD COLUMN IF NOT EXISTS media_path VARCHAR(255) NULL AFTER message_body,
  ADD COLUMN IF NOT EXISTS media_mime VARCHAR(100) NULL AFTER media_path,
  ADD COLUMN IF NOT EXISTS media_name VARCHAR(255) NULL AFTER media_mime;

-- Batas ukuran, bisa diturunkan RS tanpa menyentuh kode. 16 MB adalah batas
-- praktis WhatsApp untuk media; dokumen boleh lebih besar tapi tidak ada
-- gunanya mengirim berkas raksasa ke ponsel pasien lewat kuota mereka.
INSERT INTO app_setting (k, v) VALUES ('broadcast.max_media_mb', '16')
  ON DUPLICATE KEY UPDATE k = k;
