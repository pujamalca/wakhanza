-- 016_farmasi.sql
-- NOTIFIKASI FARMASI: kelas pemicu kelima, dan yang pertama tujuannya STAF
-- rumah sakit alih-alih pasien.
--
-- Empat kelas sebelumnya semuanya berujung ke nomor seorang pasien: sisip dan
-- pindai berangkat dari kejadian di `sik`, broadcast dari staf/jadwal, balasan
-- otomatis dari pesan pasien. Semuanya mengirim ke `<nomor>@c.us` hasil
-- normalisasi kolom `pasien.no_tlp`.
--
-- Yang ini mengirim ke GRUP WhatsApp apotek (atau nomor personal petugasnya),
-- dan perbedaan itu menjalar ke mana-mana: tidak ada nomor pasien untuk
-- dinormalisasi, opt-out tidak berlaku (grup staf bukan pasien yang bisa minta
-- berhenti), dan alamat tujuannya BUKAN nomor telepon sama sekali.

-- ---------------------------------------------------------------------------
-- outbox.chat_id -- alamat tujuan yang sudah pasti, di luar jalur nomor pasien
-- ---------------------------------------------------------------------------
-- Sengaja kolom BARU, bukan menumpang `phone_e164`. Tiga alasan, dan ketiganya
-- akan jadi bug diam kalau ditumpangkan:
--
--   1. Lebarnya tidak muat. `phone_e164` VARCHAR(20) pas untuk 628xxxxxxxxxx;
--      JID grup (`120363402118136446@g.us`) 24 karakter dan terpotong diam-diam.
--   2. Namanya akan berbohong, dan ada kode yang memercayainya: dispatcher
--      memakai `phone_e164` untuk mencari daftar tolak (`opt_out.phone_e164`)
--      dan untuk `getNumberId()`. Sebuah JID grup di kolom itu akan dicari di
--      daftar tolak sebagai kalau-kalau ia nomor pasien.
--   3. `maskPhone()` di log mengasumsikan isinya nomor.
--
-- NULL = perilaku lama persis: tujuannya dirakit dari `phone_e164` + '@c.us'.
ALTER TABLE outbox
  ADD COLUMN chat_id VARCHAR(64) NULL DEFAULT NULL AFTER phone_e164;

-- ---------------------------------------------------------------------------
-- farmasi_target -- ke mana notifikasi apotek dikirim
-- ---------------------------------------------------------------------------
CREATE TABLE farmasi_target (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- 'grup'     : JID grup WhatsApp, mis. 120363402118136446@g.us
  -- 'personal' : nomor petugas, disimpan SUDAH sebagai JID (628xxx@c.us)
  --
  -- Keduanya disimpan dalam bentuk JID yang sama supaya dispatcher tidak perlu
  -- tahu bedanya -- ia cuma meneruskan `chat_id` apa adanya ke WhatsApp. Kolom
  -- `jenis` ada untuk TAMPILAN dan validasi saat menyimpan, bukan untuk
  -- mengubah cara mengirim.
  jenis      ENUM('grup','personal') NOT NULL,
  chat_id    VARCHAR(64) NOT NULL,
  -- Nama yang ditulis staf ("Grup Apotek Shift Pagi"). Bukan diambil dari
  -- WhatsApp: nama grup bisa diubah anggotanya kapan saja, dan daftar tujuan
  -- yang berubah nama sendiri membuat "siapa yang menerima ini" jadi sulit
  -- dijawab saat ditelusuri belakangan.
  label      VARCHAR(80) NOT NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Tujuan yang sama dua kali berarti tiap resep dikirim dua kali ke grup yang
  -- sama. Ditolak di mesin database, bukan cuma di form -- kunci idempoten
  -- menyertakan chat_id, jadi dua baris tujuan yang identik menghasilkan dua
  -- kunci yang BERBEDA dan lolos dari uq_idem.
  UNIQUE KEY uq_chat (chat_id),
  KEY ix_aktif (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- wa_group -- daftar grup hasil pembacaan sesi WhatsApp
-- ---------------------------------------------------------------------------
-- Alasan tabel ini ada: JID grup tidak bisa dilihat dari aplikasi WhatsApp.
-- Tanpa daftar ini, satu-satunya cara mengisi `farmasi_target` adalah menyalin
-- kode dari suatu tempat yang tidak diketahui staf rumah sakit, dan kode yang
-- salah ketik GAGAL DIAM-DIAM -- pesannya masuk outbox, dikirim, ditolak
-- WhatsApp, dan grupnya tidak pernah menerima apa pun.
--
-- Diisi WORKER (satu-satunya proses yang memegang sesi WhatsApp) atas perintah
-- lewat `wa_session.command`, bukan lewat HTTP dari proses web -- aturan yang
-- sama seperti QR dan tombol sambung ulang.
CREATE TABLE wa_group (
  chat_id        VARCHAR(64) NOT NULL,
  nama           VARCHAR(160) NOT NULL,
  jumlah_peserta INT UNSIGNED NULL,
  synced_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Perintah baru untuk worker
-- ---------------------------------------------------------------------------
ALTER TABLE wa_session
  MODIFY COLUMN command ENUM('none','reconnect','logout','sync_groups') NOT NULL DEFAULT 'none';

-- ---------------------------------------------------------------------------
-- Pengaturan
-- ---------------------------------------------------------------------------
INSERT INTO app_setting (k, v) VALUES
-- Sakelar utama, dan sengaja MATI -- sama seperti `autoreply.enabled` dan
-- `alert.webhook_url`. Fitur yang mengirim data pasien ke sebuah GRUP tidak
-- pantas menyala sendiri hanya karena migrasinya sudah dijalankan; siapa saja
-- yang ada di dalam grup itu adalah keputusan rumah sakit, bukan keputusan kode.
('farmasi.enabled', '0'),

-- Dua langkah apotek, masing-masing bisa dimatikan sendiri. Dibuktikan dari
-- data `sik` di mesin ini, bukan diasumsikan dari nama kolomnya:
--
--   dokter menulis resep   tgl_peresepan + jam_peresepan
--   VALIDASI apotek        tgl_perawatan + jam              (+5,3 menit)
--   PENYERAHAN             tgl_penyerahan + jam_penyerahan  (+12,4 menit)
--
-- Yang memastikan `jam` benar-benar langkah tersendiri (bukan salinan waktu
-- penyerahan): 3.214 resep yang BELUM diserahkan sudah punya `jam` terisi,
-- dan dari ~28 ribu baris hanya 1 yang urutannya terbalik.
('farmasi.validasi_enabled', '1'),
('farmasi.penyerahan_enabled', '1'),

('farmasi.template_validasi',
 '*Resep divalidasi*\nNo. resep : {no_resep}\nPasien : {nama_pasien} ({no_rm})\nPoli : {nama_poli}\nJam : {jam}'),

('farmasi.template_penyerahan',
 '*Obat diserahkan*\nNo. resep : {no_resep}\nPasien : {nama_pasien} ({no_rm})\nPoli : {nama_poli}\nJam : {jam}'),

-- Dipakai saat resepnya berasal dari poli sensitif (F4.3). Tidak menyebut
-- pasien maupun poli, tapi TETAP dikirim -- apotek masih perlu tahu ada
-- pekerjaan masuk, dan nomor resepnya sudah cukup untuk membukanya di SIMRS.
-- Mendiamkannya sepenuhnya justru membuat resep pasien poli sensitif diam-diam
-- terlewat, yang merugikan pasien yang perlindungannya paling dijaga.
('farmasi.template_generic',
 '*Ada resep menunggu*\nNo. resep : {no_resep}\nBuka SIMRS untuk detailnya.'),

-- Di atas batas ini, satu siklus mengirim SATU pesan rekap alih-alih sekian
-- puluh pesan satuan.
--
-- Ini bukan kenyamanan, melainkan syarat agar sistemnya tetap hidup. Pagi sibuk
-- bisa menghasilkan puluhan resep dalam satu siklus 60 detik; mengirimkannya
-- satu per satu adalah persis pola beruntun yang memicu deteksi spam WhatsApp
-- (PRD F5.2) -- dan yang kena blokir adalah SATU-SATUNYA nomor rumah sakit,
-- sehingga notifikasi pasien ikut mati bersamanya.
('farmasi.max_per_cycle', '20'),

('farmasi.template_rekap',
 '*{jumlah_resep} resep* baru diproses apotek sejak {jam}.\nBuka SIMRS untuk daftar lengkapnya.');
