-- 002_seed_settings.sql
-- Seed baris tunggal wa_session (ARCHITECTURE §3: "wa_session sengaja satu baris"),
-- template default per pemicu (F3.1), dan app_setting yang dibaca dashboard Pengaturan (F6).
-- Nilai awal di sini mencerminkan default di .env.example / TECH_STACK.md — sesudah baris ini
-- ada, app_setting di database adalah sumber kebenaran saat aplikasi berjalan; .env hanya
-- dipakai untuk kredensial koneksi dan hal yang tidak boleh berubah tanpa restart.

INSERT INTO wa_session (id, status) VALUES (1, 'disconnected');

INSERT INTO template (trigger_code, label, body, is_active) VALUES
('BOOK_CONFIRM', 'Konfirmasi booking',
 'Bpk/Ibu {nama_pasien}, booking Anda di {nama_rs} pada {tanggal} pukul {jam} di poli {nama_poli} telah kami terima. No. RM: {no_rm}. Balas STOP untuk berhenti menerima notifikasi.',
 1),
('BOOK_REMIND', 'Pengingat H-1',
 'Pengingat: Bpk/Ibu {nama_pasien} memiliki jadwal periksa besok, {tanggal} pukul {jam}, di poli {nama_poli}, {nama_rs}. Mohon datang tepat waktu. Balas STOP untuk berhenti menerima notifikasi.',
 1),
('BOOK_CANCEL', 'Dokter berhalangan / booking batal',
 'Bpk/Ibu {nama_pasien}, mohon maaf jadwal periksa Anda pada {tanggal} di poli {nama_poli} {nama_rs} mengalami perubahan. Silakan hubungi {kontak_rs} untuk info jadwal pengganti. Balas STOP untuk berhenti menerima notifikasi.',
 1),
('QUEUE_REG', 'Nomor antrian terbit',
 'Bpk/Ibu {nama_pasien}, nomor antrian Anda di {nama_rs} poli {nama_poli} hari ini adalah {no_antrian}. No. RM: {no_rm}. Balas STOP untuk berhenti menerima notifikasi.',
 1),
('RESULT_READY', 'Hasil penunjang selesai',
 'Bpk/Ibu {nama_pasien}, hasil pemeriksaan {jenis_layanan} Anda di {nama_rs} sudah tersedia. Silakan ambil di bagian terkait atau tanyakan ke loket. No. RM: {no_rm}. Balas STOP untuk berhenti menerima notifikasi.',
 1),
('PHARMACY_READY', 'Obat siap diambil',
 'Bpk/Ibu {nama_pasien}, obat Anda sudah siap diambil di farmasi {nama_rs}. No. RM: {no_rm}. Balas STOP untuk berhenti menerima notifikasi.',
 1),
('BILLING_READY', 'Tagihan terbit',
 'Bpk/Ibu {nama_pasien}, tagihan Anda di {nama_rs} telah terbit. Silakan selesaikan pembayaran di kasir. No. RM: {no_rm}. Balas STOP untuk berhenti menerima notifikasi.',
 1);

INSERT INTO app_setting (k, v) VALUES
('polling.interval_ms', '60000'),
('polling.scan_interval_ms', '300000'),
('polling.lookback_days', '30'),
('polling.query_timeout_sec', '5'),
('dispatch.quiet_hours_start', '21'),
('dispatch.quiet_hours_end', '7'),
('dispatch.send_min_delay_ms', '3000'),
('dispatch.send_max_delay_ms', '8000'),
('dispatch.max_per_hour', '200'),
('dispatch.stale_threshold_hours_default', '6'),
('dispatch.stale_hours_by_trigger',
 '{"QUEUE_REG":6,"RESULT_READY":12,"PHARMACY_READY":12,"BILLING_READY":48,"BOOK_CONFIRM":48,"BOOK_CANCEL":12,"BOOK_REMIND":24}'),
-- F4.3: daftar kode poli/layanan sensitif — KOSONG sampai RS memutuskan (PRD §10 pertanyaan #2).
-- Diisi lewat dashboard Pengaturan, bukan dengan menebak dari sini.
('privacy.sensitive_poli_codes', '[]'),
('privacy.generic_template',
 'Bpk/Ibu {nama_pasien}, ada informasi dari {nama_rs} terkait kunjungan Anda. Silakan menghubungi {kontak_rs} atau datang ke bagian informasi.'),
('auth.login_max_attempts', '5'),
('auth.login_lockout_minutes', '15'),
('auth.session_max_age_hours', '8');
