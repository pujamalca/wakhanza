-- 005_broadcast.sql
-- Fitur broadcast: staf memilih segmen pasien (tanggal kunjungan, wilayah,
-- cara bayar) dari reg_periksa+pasien lalu mengirim pesan ke segmen itu.
-- broadcast_campaign HANYA insert (jejak siapa mengirim apa ke berapa orang
-- kapan, untuk akuntabilitas) -- jumlah terkirim/gagal dihitung langsung dari
-- outbox.campaign_id saat dibaca, bukan disimpan sebagai penghitung yang bisa
-- basi. outbox.campaign_id menghubungkan setiap baris pesan balik ke kampanye
-- asalnya (NULL untuk ketujuh pemicu reaktif yang sudah ada).

CREATE TABLE broadcast_campaign (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_by       VARCHAR(64)  NOT NULL,
  filter_json      TEXT         NOT NULL,
  message_body     TEXT         NOT NULL,
  recipient_count  INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

ALTER TABLE outbox
  ADD COLUMN campaign_id BIGINT UNSIGNED NULL AFTER trigger_code,
  ADD KEY ix_campaign (campaign_id);

-- Pagar keselamatan: batas jumlah penerima per kampanye sekali kirim, supaya
-- kesalahan filter (mis. rentang tanggal kelewat lebar) tidak langsung
-- membuat ribuan pesan masuk outbox sekaligus. Bisa diubah dari dashboard
-- Pengaturan (F6) tanpa restart, sama seperti tunable lain.
INSERT INTO app_setting (k, v) VALUES ('broadcast.max_recipients', '500');
