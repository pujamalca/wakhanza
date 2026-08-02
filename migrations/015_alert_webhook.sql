-- 015_alert_webhook.sql
-- Peringatan ke LUAR dashboard.
--
-- Latar belakangnya satu kejadian nyata: sesi WhatsApp tersangkut jam 01:25 dan
-- baru ketahuan 14 jam kemudian. Panel peringatan di /ringkasan sudah ada, tapi
-- ia mengandalkan seseorang membuka halamannya -- dan jam segitu tidak ada.
--
-- TIDAK BISA lewat WhatsApp, dan itu bukan detail kecil: hampir semua yang
-- layak dialarmkan di sistem ini adalah "WhatsApp tidak jalan". Jalur pemberi
-- tahu harus jalur yang tidak ikut mati bersama yang diberitakannya.
--
-- Bentuknya webhook HTTP generik, bukan SMTP: nol dependensi baru (fetch sudah
-- bawaan Node), dan satu URL yang sama bisa diarahkan ke bot Telegram, webhook
-- Slack/Discord, atau endpoint milik IT rumah sakit.
--
-- DEFAULT KOSONG = tidak ada peringatan yang dikirim. Sama seperti
-- autoreply.enabled: fitur yang menghubungi dunia luar dinyalakan sadar-sadar,
-- bukan menyala karena kebetulan terpasang. Isi lewat halaman Pengaturan.

INSERT INTO app_setting (k, v) VALUES
('alert.webhook_url', ''),
-- Jeda minimum per JENIS peringatan. Watchdog menyala tiap 15 menit selama
-- sesi belum pulih; tanpa jeda, satu gangguan semalaman jadi ratusan pesan dan
-- penerimanya berhenti membacanya -- alasan yang sama kenapa level log di
-- wa-client.ts dipisah debug/warn.
('alert.min_interval_minutes', '15')
ON DUPLICATE KEY UPDATE k = k;
