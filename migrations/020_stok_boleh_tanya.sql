-- 020_stok_boleh_tanya.sql
-- SIAPA YANG BOLEH BERTANYA stok/harga -- per tujuan, dan kini termasuk GRUP.
--
-- Versi pertama fitur stok (019) memakai keanggotaan `farmasi_target` apa
-- adanya sebagai daftar putih: setiap tujuan personal yang aktif otomatis boleh
-- bertanya. Itu menggabungkan dua hal yang ternyata memang berbeda:
--
--   "ke mana notifikasi resep DIKIRIM"   (is_active)
--   "siapa yang boleh BERTANYA stok"     (kolom baru ini)
--
-- Rumah sakit sangat wajar ingin sebuah grup menerima pemberitahuan resep tanpa
-- ingin nomornya ikut menjawab pertanyaan di dalam grup itu -- dan sebaliknya.
-- Dengan satu kolom saja, pilihan itu tidak ada.
--
-- Tetap SATU tabel, bukan daftar putih kedua: dua tempat yang harus diingat
-- saat petugas berganti nomor akan gagal DIAM, petugasnya sekadar tidak pernah
-- dijawab.
--
-- DEFAULT 0, termasuk untuk baris yang sudah ada. Ini MEMPERKETAT perilaku 019
-- dengan sengaja: sesudah migrasi ini, tidak ada satu pun tujuan yang boleh
-- bertanya sampai admin mencentangnya sendiri. Aman karena `farmasi.stok_mode`
-- memang masih 'mati' secara bawaan -- tidak ada perilaku produksi yang
-- berubah, yang berubah hanya keharusan memilih secara sadar.
ALTER TABLE farmasi_target
  ADD COLUMN boleh_tanya TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;

-- ---------------------------------------------------------------------------
-- Kuota jawaban per GRUP
-- ---------------------------------------------------------------------------
-- Kenapa angkanya sendiri dan tidak menumpang `autoreply.max_per_number_per_hour`:
-- yang dibatasi di sana adalah seberapa sering kita menjawab satu ORANG.
-- Sebuah grup berisi banyak orang, jadi angka yang wajar untuk satu nomor
-- pribadi terlalu ketat di sini -- lima pertanyaan dari lima petugas berbeda
-- dalam sejam adalah pemakaian normal, bukan penyalahgunaan.
--
-- Kuotanya tetap ADA, dan itu bagian terpentingnya: satu balasan di grup berarti
-- satu pesan keluar dari SATU-SATUNYA nomor rumah sakit. Percakapan grup yang
-- ramai bisa memicu rentetan balasan -- persis pola deteksi spam yang, bila
-- kena, mematikan notifikasi pasien sekaligus (PRD F5.2).
INSERT INTO app_setting (k, v) VALUES
('farmasi.stok_max_per_grup_per_jam', '10');
