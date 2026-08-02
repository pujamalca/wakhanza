-- 011_opt_out_phrase.sql
-- Frasa berhenti berlangganan diganti dari "STOP" menjadi
-- "Berhenti Kirim Otomatis", dan cakupannya dipersempit ke tujuh pemicu
-- otomatis saja (lihat src/core/optOut.ts).
--
-- Ketujuh template di bawah menutup pesannya dengan instruksi cara berhenti.
-- Instruksi itu HARUS ikut berubah: kalau tidak, pasien disuruh membalas STOP
-- oleh pesan resmi rumah sakit, mengetiknya, lalu tidak terjadi apa-apa --
-- kegagalan yang paling merusak kepercayaan justru karena tampak seperti
-- rumah sakit mengabaikannya, bukan seperti kesalahan teknis.
--
-- Diperbarui lewat REPLACE() pada kalimat lamanya, bukan menulis ulang seluruh
-- body: rumah sakit mungkin sudah menyunting template ini lewat dashboard, dan
-- suntingan itu tidak boleh hilang hanya karena frasa berhentinya berubah.
-- Baris yang kalimatnya sudah diubah staf tidak akan tersentuh sama sekali.

UPDATE template
SET body = REPLACE(
      body,
      'Balas STOP untuk berhenti menerima notifikasi.',
      'Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.'
    )
WHERE body LIKE '%Balas STOP untuk berhenti menerima notifikasi.%';
