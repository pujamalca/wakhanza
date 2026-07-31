-- 007_unique_code.sql
-- Kode unik per pesan (lihat src/core/uniqueCode.ts). Pengaman tambahan untuk
-- PRD F5.2: jeda acak dan kuota per jam menekan LAJU kirim, tapi tidak
-- menyentuh masalah kedua yang sama-sama memicu deteksi spam WhatsApp --
-- banyak pesan dengan teks yang identik. Kode singkat di baris terakhir
-- membuat setiap pesan berbeda tanpa mengubah isi yang dibaca pasien.
--
-- Aktif secara default: nilai yang melindungi nomor RS tidak boleh menunggu
-- ada yang ingat menyalakannya. Bisa dimatikan dari dashboard Pengaturan
-- (isi 0) bila RS memutuskan lain.

INSERT INTO app_setting (k, v) VALUES
('dispatch.unique_code_enabled', '1'),
('dispatch.unique_code_template', 'Ref: {kode}');
