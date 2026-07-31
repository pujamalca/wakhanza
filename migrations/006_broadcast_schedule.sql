-- 006_broadcast_schedule.sql
-- Broadcast terjadwal/berulang: staf menyimpan definisi segmen (sama seperti
-- /broadcast, tapi rentang tanggal RELATIF -- "lookback_days hari terakhir
-- dari saat jalan", bukan tanggal tetap, supaya tetap masuk akal tiap kali
-- terulang) + pesan + pola pengulangan. Worker (bukan dashboard) yang benar-
-- benar mengeksekusi saat next_run_at jatuh tempo -- lihat
-- worker/broadcastScheduleRunner.ts. Setiap kali jalan membuat SATU baris
-- broadcast_campaign baru (jejak akuntabilitas per-jalan, konsisten dengan
-- migrations/005_broadcast.sql), bukan menambah kolom ke tabel ini.

CREATE TABLE broadcast_schedule (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(255) NOT NULL,
  created_by        VARCHAR(64)  NOT NULL,
  filter_json       TEXT         NOT NULL,
  message_body      TEXT         NOT NULL,
  repeat_kind       ENUM('once','daily','weekly','monthly') NOT NULL,
  time_of_day       VARCHAR(5)   NOT NULL,     -- 'HH:MM', jam dinding lokal (server WIB)
  day_of_week       TINYINT      NULL,         -- 0=Minggu..6=Sabtu, untuk 'weekly'
  day_of_month      TINYINT      NULL,         -- 1-28, untuk 'monthly'
  run_once_at       DATETIME     NULL,         -- untuk 'once'
  -- Pagar keselamatan: jadwal berulang berhenti otomatis setelah tanggal ini
  -- (opsional) -- supaya tidak ada "atur lalu lupa" tanpa batas waktu.
  stop_after_date   DATE         NULL,
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  next_run_at       DATETIME     NULL,
  last_run_at       DATETIME     NULL,
  last_campaign_id  BIGINT UNSIGNED NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_due (is_active, next_run_at)
) ENGINE=InnoDB;
