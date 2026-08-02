-- 012_generic_template_opt_out.sql
-- privacy.generic_template adalah pesan pengganti yang dipakai ketika layanan
-- pasien masuk daftar sensitif (F4.3) -- ia MENGGANTIKAN isi salah satu dari
-- tujuh template pemicu, jadi ia juga salah satu pesan yang tunduk pada
-- "Berhenti Kirim Otomatis".
--
-- Migration 011 hanya menyentuh tabel `template` dan melewatkan yang ini,
-- sehingga pasien dengan layanan sensitif justru satu-satunya yang TIDAK
-- pernah diberi tahu cara berhenti. Kebalikan dari yang seharusnya.
--
-- Sama seperti 011: hanya menambahkan bila kalimatnya belum ada, supaya
-- suntingan staf lewat halaman Pengaturan tidak tertimpa.

UPDATE app_setting
SET v = CONCAT(v, ' Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.')
WHERE k = 'privacy.generic_template'
  AND v <> ''
  AND v NOT LIKE '%Berhenti Kirim Otomatis%';
