-- 037_riwayat_status_sesi.sql
-- Rekomendasi teknis 9 Agustus 2026 (R10): tidak ada satu tabel pun yang bisa
-- menjawab "berapa jam gateway mati bulan lalu". `wa_session` hanya menyimpan
-- keadaan SEKARANG -- baris id=1 ditimpa `upsert()` di setiap transisi, jadi
-- riwayatnya hilang begitu status berikutnya ditulis. Setiap perkiraan
-- gangguan sampai hari ini bersifat anekdot, termasuk angka "14 jam" yang
-- pernah tercatat di dokumentasi dan didapat dengan membaca log JSON secara
-- manual baris demi baris.
--
-- Insert-only, pola yang sama dengan audit_log/broadcast_campaign: satu baris
-- per PERUBAHAN status, ditulis di SATU tempat (src/worker/sessionHistory.ts)
-- yang dipakai bersama oleh setiap titik yang sebelumnya menulis
-- `WaSession.upsert({status: ...})` langsung. Bentuk kegagalan yang dihindari
-- persis yang sudah berkali-kali dibayar di proyek ini (respectsOptOut(),
-- core/outboxStatus.ts, kunciPesanMasuk(), core/tujuanPemicu.ts): beberapa
-- tempat berjauhan menafsirkan sendiri satu hal yang sama, dan cukup satu
-- yang lupa diperbarui untuk membuat riwayatnya diam-diam tidak lengkap.
--
-- status_lama NULLABLE: transisi pertama yang pernah tercatat (atau start
-- pertama sebuah instalasi baru) tidak punya status sebelumnya untuk dirujuk.

CREATE TABLE wa_session_event (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  status_lama ENUM('disconnected','qr_pending','authenticating','ready','failed') NULL,
  status_baru ENUM('disconnected','qr_pending','authenticating','ready','failed') NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Satu-satunya pola akses: rentang tanggal + kadang disaring status_baru
  -- ("berapa kali ready->disconnected bulan ini").
  KEY ix_created (created_at, status_baru)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Grant DELETE untuk wakhanza_rw diterapkan MANUAL lewat root, sama seperti
-- setiap tabel baru lain di proyek ini (ARCHITECTURE §9.5) -- skema-lebar
-- hanya mencakup SELECT/INSERT/CREATE/DROP/REFERENCES/INDEX/ALTER, dan tabel
-- ini perlu DELETE saja (tanpa UPDATE, karena baris tidak pernah ditulis
-- ulang) supaya worker/cleanup.ts bisa memangkasnya setelah 90 hari:
--   GRANT DELETE ON wakhanza.wa_session_event TO 'wakhanza_rw'@'localhost';
-- Diverifikasi lewat percobaan DELETE empiris sesudah grant diterapkan, bukan
-- diasumsikan -- lihat VERIFICATION.md.
