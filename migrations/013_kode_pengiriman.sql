-- Baris kode di akhir setiap pesan: dari "Ref: 5QVC9G" menjadi
-- "Kode Pengiriman : 2026-08-02 20:18:41 5QVC9G".
--
-- "Ref: 5QVC9G" tidak berarti apa-apa bagi pasien yang menerimanya. Tanggal
-- dan jam langsung menjawab "pesan ini soal kapan", dan tetap bisa disebutkan
-- pasien lewat telepon untuk dicari (outbox.body LIKE '%...%').
--
-- Kodenya TIDAK dihapus, dan itu bukan kehati-hatian berlebih: satu broadcast
-- meng-enqueue seluruh penerimanya dalam satu perulangan rapat, jadi ratusan
-- pesan mendapat detik yang SAMA. Digabung dengan isi broadcast yang memang
-- identik, seluruh kiriman akan jadi identik karakter per karakter -- persis
-- pola yang membuat WhatsApp menandai nomor RS sebagai spam, yaitu
-- satu-satunya alasan fitur ini ada (PRD F5.2). Lihat core/uniqueCode.ts.
--
-- Hanya menimpa bila nilainya masih persis bawaan lama, sama seperti
-- migrations/011: kalau admin sudah menyuntingnya sendiri, suntingannya menang.
UPDATE app_setting
SET v = 'Kode Pengiriman : {waktu} {kode}'
WHERE k = 'dispatch.unique_code_template'
  AND v = 'Ref: {kode}';
