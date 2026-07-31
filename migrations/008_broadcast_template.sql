-- 008_broadcast_template.sql
-- Pesan broadcast tersimpan yang bisa dipilih ulang, TERPISAH dari tabel
-- `template`. Keduanya sengaja tidak digabung walau sama-sama "template":
--
--   `template`           : satu baris per PEMICU (trigger_code = primary key),
--                          dipilih otomatis oleh worker saat kejadiannya
--                          terdeteksi di sik. Staf tidak pernah memilihnya, dan
--                          jumlahnya tetap tujuh.
--   `broadcast_template` : sebanyak yang staf mau, dipilih MANUAL saat menyusun
--                          broadcast/jadwal. Tidak terikat pemicu apa pun.
--
-- Menggabungkannya ke satu tabel akan memaksa trigger_code palsu untuk baris
-- broadcast, dan membuat Template.findByPk(triggerCode) milik worker bisa
-- tidak sengaja mengambil pesan broadcast.

CREATE TABLE broadcast_template (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80) NOT NULL,
  body        TEXT NOT NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_by  VARCHAR(64) NOT NULL,
  updated_by  VARCHAR(64) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
