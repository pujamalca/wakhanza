-- 003_app_user_lockout.sql
-- ARCHITECTURE §9.3 / PRD N10: kunci 15 menit setelah 5 kegagalan berturut-turut per
-- nama pengguna. Kolom ini tidak ada di skema awal ARCHITECTURE §3 karena bagian itu
-- hanya menjelaskan perilaku di teks — disimpan di sini sebagai migrasi terpisah.

ALTER TABLE app_user
  ADD COLUMN failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER password_hash,
  ADD COLUMN locked_until    DATETIME NULL AFTER failed_attempts;
