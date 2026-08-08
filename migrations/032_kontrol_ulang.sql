-- 032_kontrol_ulang.sql
-- PENGINGAT SURAT KONTROL untuk pasien NON-BPJS.
--
-- Padanan BPJS_KONTROL dari sisi Khanza sendiri. Sampai migrasi ini, pengingat
-- kontrol hanya ada untuk pasien yang suratnya lewat bridging VClaim; pasien
-- yang suratnya diterbitkan lewat menu "Surat Kontrol" biasa tidak menerima
-- apa-apa.
--
-- ---------------------------------------------------------------------------
-- DUA menu bernama mirip, dan tabelnya berbeda
-- ---------------------------------------------------------------------------
--   "Surat Kontrol"        -> surat/SuratKontrol.java    -> `skdp_bpjs`     <-- INI
--   "Surat Kontrol VClaim" -> bridging/BPJSSuratKontrol  -> `bridging_surat_kontrol_bpjs`
--
-- Akhiran `_bpjs` pada nama tabel yang pertama peninggalan sejarah (SKDP =
-- Surat Keterangan Dalam Perawatan); isinya dipakai untuk pasien mana pun.
-- Uraian lengkapnya di `src/khanza/kontrolUlang.ts`.
--
-- ---------------------------------------------------------------------------
-- TABRAKAN DENGAN BOOK_REMIND -- ini bagian yang paling penting di berkas ini
-- ---------------------------------------------------------------------------
-- Khanza punya setelan `JADIKANBOOKINGSURATKONTROL` di `setting/database.xml`
-- (BUKAN di tabel, jadi tidak terlihat dari wakhanza sama sekali). Bila
-- bernilai `yes`, setiap surat kontrol yang disimpan JUGA membuat satu baris
-- `booking_registrasi` pada pasien dan tanggal yang sama.
--
-- Di mesin ini setelannya `yes`, dan terukur: 253 dari 253 surat kontrol punya
-- baris bookingnya. Artinya BOOK_CONFIRM (saat surat dibuat) dan BOOK_REMIND
-- (H-1 sebelum kontrol) SUDAH menyentuh pasien-pasien ini.
--
-- Menyalakan KONTROL_ULANG bersama BOOK_REMIND karena itu berarti DUA PESAN
-- untuk satu kunjungan yang sama, dari dua pemicu yang tidak saling tahu --
-- bentuk kegagalan yang sama yang membuat SURAT PEMESANAN sengaja tidak
-- memberitakan kedatangan barang (itu sudah tugas PENGADAAN).
--
-- Tidak ada pagar mesin untuk ini, dan itu disengaja: keduanya sah dipakai
-- sendiri-sendiri, dan instalasi yang setelannya `no` justru TIDAK punya
-- BOOK_REMIND untuk pasien ini sama sekali -- di sanalah pemicu ini menutup
-- lubang yang sesungguhnya. Yang ada adalah peringatan di halaman /template,
-- di depan orang yang menyalakannya.

-- ---------------------------------------------------------------------------
-- is_active = 0, dengan alasan yang sama seperti 025
-- ---------------------------------------------------------------------------
-- Worker memungut pemicu lewat `Template.findByPk(triggerCode)` dan langsung
-- berjalan begitu barisnya aktif. Baris aktif yang termigrasi diam-diam akan
-- mulai mengirim WhatsApp ke pasien tanpa seorang pun memutuskannya.
INSERT INTO template (trigger_code, label, body, is_active, tujuan_mode) VALUES
('KONTROL_ULANG',
 'Pengingat kontrol (non-BPJS)',
 -- Diagnosa, terapi, alasan, dan rencana tindak lanjut SENGAJA tidak disebut,
 -- dan variabelnya memang tidak ada -- `khanza/kontrolUlang.ts` tidak pernah
 -- men-SELECT keenam kolomnya (§5.2). Keenamnya tercetak di surat kertas yang
 -- sudah dipegang pasien, tempat kendali aksesnya memang ada.
 --
 -- `{nama_poli}` TIDAK dipakai di sini walau variabelnya tersedia, dan itu
 -- keputusan sadar. Poli tidak ada di `skdp_bpjs`; ia hanya bisa didapat lewat
 -- baris `booking_registrasi` yang dibuat Khanza bila `JADIKANBOOKINGSURATKONTROL`
 -- bernilai `yes` -- setelan di berkas XML milik Khanza, tak terlihat dari sini.
 -- Di instalasi yang setelannya `no`, baris "Poli : {nama_poli}" berubah jadi
 -- "Poli : " pada SETIAP pesan: label menggantung yang terbaca sebagai sistem
 -- rusak, dan sejak itu keterangan yang benar pun tidak dipercaya. Pelajaran
 -- yang sama persis sudah dibayar pada sakelar nilai hibah (031).
 --
 -- Staf tetap boleh menambahkannya sendiri; halaman /template menyebutkan
 -- syaratnya di depan mereka. Di mesin ini setelannya `yes` dan poli terukur
 -- ada pada 253/253 surat, jadi menambahkannya aman di sini.
 'Yth. {nama_pasien}, kami mengingatkan jadwal kontrol Anda di {nama_rs}:\n\nTanggal : {tanggal_kontrol} ({sisa_hari})\nDokter : {nama_dokter}\nNo. surat : {no_surat_kontrol}\n\nMohon membawa surat kontrol Anda. Informasi: {kontak_rs}\n\nBalas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.',
 0,
 'pasien');

-- ---------------------------------------------------------------------------
-- Jadwal: pola BPJS_KONTROL, bukan pola BOOK_REMIND
-- ---------------------------------------------------------------------------
-- BOOK_REMIND memakai node-cron dan membaca `schedule.book_remind_hour` SEKALI
-- saat worker mulai, jadi mengubah jamnya lewat dashboard tidak berlaku sampai
-- ada yang menyalakan ulang worker -- tanpa satu pun tanda bahwa setelan
-- barunya belum aktif. `runBpjsKontrolIfDue()` memperbaiki itu dengan memeriksa
-- kejatuhtempoan tiap siklus pindai dan membaca jamnya ulang tiap kali. Pemicu
-- ini mengikuti yang kedua.
INSERT INTO app_setting (k, v) VALUES

-- Jam kirim (0-23, WIB). Bawaannya 09:00 -- sama seperti `bpjs.kontrol_jam`,
-- supaya rumah sakit yang memakai keduanya tidak perlu menghafal dua jam yang
-- berbeda tanpa alasan.
('schedule.kontrol_ulang_jam', '9'),

-- Selisih hari, boleh lebih dari satu ("7,1" = dua pengingat per surat).
-- Kunci idempotennya menyertakan selisihnya justru untuk ini.
('schedule.kontrol_ulang_hari_sebelum', '1'),

-- Penanda "sudah jalan hari ini". CUMA penghemat query, bukan penentu
-- kebenaran -- yang mencegah kirim ganda adalah kunci idempoten yang ditegakkan
-- `uq_idem` di mesin database.
('schedule.kontrol_ulang_last_run', '');
