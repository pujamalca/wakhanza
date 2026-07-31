-- 004_more_settings.sql
-- Ditambahkan saat Fase 2: privacy.sensitive_exam_codes (F4.3, kode
-- jenis_perawatan_lab/radiologi sensitif -- lihat core/privacy.ts) dan jam
-- kirim BOOK_REMIND (PRD §10 pertanyaan #4, belum dijawab RS -- default 18:00
-- WIB dipakai sampai diubah lewat dashboard Pengaturan).

INSERT INTO app_setting (k, v) VALUES
('privacy.sensitive_exam_codes', '[]'),
('schedule.book_remind_hour', '18');
