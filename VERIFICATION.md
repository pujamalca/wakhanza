# VERIFICATION.md

Bukti untuk klaim di `CLAUDE.md`. Dipisah ke sini karena `CLAUDE.md` dimuat ke
setiap sesi sementara bukti hanya dibaca saat ada yang mempertanyakan sebuah klaim
— tapi aturan prosesnya tidak berubah: **setiap klaim "selesai" tetap harus disertai
keluaran perintah yang membuktikannya** (`IMPLEMENTATION_PLAN.md`).

Judul seksi di bawah **sama persis** dengan judul seksi di `CLAUDE.md`, jadi bukti
sebuah klaim dicari lewat judul seksi tempat klaim itu ditulis. Menambah perilaku
baru berarti menambah buktinya di sini, di bawah judul yang sama.

## Operasi produksi: PM2, sesi WhatsApp, cadangan

Diverifikasi tiga lapis: serah-terima antar dua proses uji (A mundur rapi, B ambil alih dalam 3 detik); `pm2 restart` biasa (satu shutdown, satu pengganti, `restart_time` +1, tanpa loop); dan **skenario insidennya sendiri** -- worker dijalankan manual di luar PM2, merebut sesi dari worker PM2, lalu PM2 autorestart dan merebutnya kembali sehingga worker manual keluar sendiri. Sistem pulih ke keadaan benar tanpa campur tangan, setiap peralihan menutup Chromium dengan rapi, nol `browser is already running`.

Diverifikasi: skenario aslinya diulang persis — baris `outbox` ditaruh menunggu SEBELUM worker dinyalakan, sehingga ia sudah antre tepat saat READY menyala. Sebelum perbaikan: `attempts=1` error lalu `attempts=2` sent. Sesudah: **`attempts=1` sent, `last_error` NULL**. Jalur positif probe-nya dibuktikan terpisah lewat kontrol negatif — `checkHealth()` kini memuat probe itu dan watchdog memanggilnya tiap 60 detik, jadi probe yang rusak akan menyalakan ulang worker berikut peringatan; `unstable restarts: 0` sesudah dua siklus. Cabang tangkapannya TIDAK bisa dibuktikan lewat balapan aslinya (penyuntikan ulang terjadi kapan WhatsApp Web memutuskan bernavigasi), jadi ia diuji lewat `worker/dispatcher.int.test.ts` dengan `wa-client` dipalsukan dan database `wakhanza` sungguhan: galat sementara → `attempts` tetap 0 dan nol baris `send_log`; kegagalan sungguhan → `attempts` naik dan `send_log` tertulis; pengiriman berhasil → seperti biasa. Ditambah 5 unit test pada pengklasifikasinya. **Menunggu balapannya terjadi sendiri berarti cabangnya tidak pernah terbukti, dan "terlalu kecil untuk salah" adalah kalimat yang mendahului bug `@lid` maupun bug `_serialized` di proyek ini.**

Diverifikasi: kedua app `online` dengan **0 restart**, dan satu balasan otomatis benar-benar terkirim ke nomor uji oleh worker yang dikelola PM2 (`send_log.outcome='sent'`).

### Cadangan harian: dijadwalkan sebagai SYSTEM, dan satu jebakan stderr

Diverifikasi lewat jalur terjadwal sungguhan (`Start-ScheduledTask`, bukan memanggil skripnya langsung): `LastTaskResult=0`, berkas 19,02 MB terbentuk, lalu **dipulihkan sungguhan** ke database `wakhanza_restore_test` — 16 tabel, termasuk `patient_contact` 8.118 baris, `app_setting` 28, `template` 7. Database ujinya di-DROP setelah diperiksa.

## Status `outbox`: terminal vs aktif, dan tiga kebocoran yang lahir dari selisih tafsir

Diverifikasi terhadap database sungguhan lewat fungsi produksi (`recoverInterruptedSends()` + `runCleanup()`, bukan reimplementasi): 8 baris terminal berumur 100 hari terhapus berikut berkas lampirannya, `pending` berumur 100 hari dan `sent` hari ini keduanya SELAMAT, dan satu baris `sending` berubah jadi `failed_permanent`.

## Kelas ketiga: BROADCAST (dipicu staf, bukan sik)

Diverifikasi ulang lewat kombinasi: GET `/broadcast` (query+ringkasan+render) lewat HTTP asli dengan cookie sesi admin sungguhan; enqueue (`fetchPatientSegment`→`loadBroadcastContext`→`enqueueMessage`) lewat pemanggilan langsung fungsi produksi yang sama persis dipakai `actions.ts` (bukan reimplementasi); pengiriman sungguhan dikonfirmasi lewat `send_log`/`outbox.status='sent'` oleh worker yang sedang berjalan. POST server action `sendBroadcastAction` itu sendiri TIDAK berhasil direplikasi lewat `curl` mentah (Next.js menolak permintaan multipart hasil rekonstruksi manual dengan redirect ke `/login` -- kemungkinan pemeriksaan same-origin/RSC internal Next yang tidak sepenuhnya bisa ditiru dari luar browser); pola `requireRole('admin')`-nya identik dengan `template/actions.ts` yang sudah terbukti lewat browser sungguhan di Fase 3, jadi celah pembuktian ini murni keterbatasan alat uji command-line, bukan bagian yang belum tervalidasi secara logika. **Celah itu sekarang tertutup**: `sendBroadcastAction` dijalankan lewat browser sungguhan (Puppeteer, tombol dicari lewat TEKSNYA) dengan cakupan semua-waktu dan segmen dipersempit ke pasien uji -- kampanye terbentuk, `filter_json` mencatat `dateFrom: null`, dan pesannya benar-benar terkirim (`send_log.outcome='sent'`, `duration_ms=263`).

Rentang tanggal opsionalnya diverifikasi berlapis: 11 kombinasi filter lewat pemanggilan langsung `fetchPatientSegment()` terhadap `sik` sungguhan (jendela 30 hari + nama pasien lama = 0 hasil; tanggal dikosongkan = 3 hasil; no. RM dan no. pendaftaran sama-sama menemukan pasiennya; batas atas tanggal terbukti menyaring, bukan hiasan -- digeser satu hari, kunjungan yang terpilih ikut mundur); 7 keadaan halaman lewat HTTP asli dengan cookie admin (termasuk penolakan "tanpa filter" dan "cara bayar saja", plus peringatan terpotong pada 1000); dan unit test `segmentScope.test.ts` (13 kasus) + `filters.test.ts` (8 kasus, termasuk bahwa membuka halaman polos TIDAK ikut jadi semua-waktu).

## Kelas ketiga, varian: BROADCAST TERJADWAL (worker-inisiasi, bukan staf-inisiasi)

Diverifikasi ulang: `verify:db`/`verify:plans` lolos (query segmen dipakai ulang tanpa perubahan, sudah tercakup `BROADCAST_SEGMENT`); grant `UPDATE`/`DELETE` dibuktikan LANGSUNG lewat `mysql` (gagal sebelum grant, berhasil sesudah); `computeNextRunAt` diuji unit 15 kasus. `runDueBroadcastSchedules()` dipanggil langsung (fungsi produksi yang SAMA dipakai worker, bukan reimplementasi) terhadap jadwal uji sungguhan (filter dipersempit ke `TESTWA00001`) -- membuat `broadcast_campaign` baru, meng-enqueue `outbox`, dan **worker yang sedang berjalan** (proses terpisah, bukan skrip verifikasi) mengambilnya lewat dispatcher dan mengirim WhatsApp sungguhan dalam 1 detik (`send_log.outcome='sent'`, `duration_ms=311`).

Mode `followup` diverifikasi terpisah: `resolveScheduleWindow` diuji unit 10 kasus (termasuk pemangkasan ke tengah malam dan pergantian bulan); jendela satu-harinya dibuktikan empiris terhadap `sik` sungguhan (H+0 mengembalikan pasien uji, H+1/H+2/H+3 mengembalikan nol -- pasien itu memang hanya berkunjung hari ini); jaminan "sekali kirim" dibuktikan dengan memanggil `runDueBroadcastSchedules()` DUA KALI atas jadwal yang sama -- baris `outbox` tetap satu, dan setelah `filterAlreadySent()` ditambahkan, jalan kedua tidak lagi membuat baris `broadcast_campaign` kosong. Ketiga varian filter (`followup` H+0, `followup` H+3, `rolling` 30 hari) dirender lewat HTTP asli dengan cookie admin sungguhan.

## Kelas keempat: BALASAN OTOMATIS (dipicu PASIEN, arah berlawanan)

Diverifikasi: `handleInboundMessage()` (fungsi produksi yang sama dipanggil worker) diuji langsung terhadap 8 skenario -- sakelar mati, cocok, duplikat, filter poli dari kalimat, prioritas, pertanyaan medis (diam), emoji (tidak dibalas dan tidak dicatat), kuota habis; `core/autoReply.ts` diuji unit 21 kasus; `formatJadwal`/`detectPoli` dibuktikan terhadap `sik` sungguhan; halaman dirender lewat HTTP asli dengan cookie admin (200) dan operator ditolak (307 ke `/ringkasan`, dan 403 dari `/api/settings`); kotak Uji coba dijalankan lewat **browser sungguhan** (Puppeteer) sehingga server action-nya benar-benar tereksekusi -- ini menutup celah pembuktian yang tertinggal pada BROADCAST, yang server action-nya tidak bisa ditiru `curl`; dan dua balasan **benar-benar terkirim** ke nomor uji oleh worker yang sedang berjalan (`send_log.outcome='sent'`).

## Kelas kelima: NOTIFIKASI FARMASI (tujuannya STAF, bukan pasien)

Diverifikasi: `verify:plans` menunjukkan kedua query `range` di PK + `eq_ref` semua join, **tanpa satu pun izin pindai penuh**; `runFarmasiCycle()` (fungsi produksi yang sama dipanggil worker) dijalankan terhadap `sik` sungguhan -- sebaran 3 kejadian × 2 tujuan = 6 baris, idempotensi (cursor direset, jalan ulang, tetap 6), cabang rekap (ambang 1 → 1 rekap/tujuan), dan poli sensitif (isi berubah jadi generik); otorisasi lewat HTTP asli (tanpa login 307 → `/login`, operator 307 → `/ringkasan` dan menunya tidak tampil, admin 200); alur tambah/ubah/nonaktifkan/hapus + penolakan tautan undangan + penolakan variabel `{nama_obat}` lewat **browser sungguhan**; pemilih grup terisi 6 grup nyata dan memilih grup mengisi kotak kodenya sendiri; dan **satu pesan uji benar-benar terkirim** ke nomor uji oleh worker PM2 (`send_log.outcome='sent'`, 296 ms). Pengiriman ke grup SUNGGUHAN belum diuji -- keenam grup itu milik rumah sakit dan mengirim ke sana tanpa izin akan mengganggu anggotanya; yang sudah dibuktikan adalah dispatcher merutekan `@g.us` sebagai grup, bukan sebagai nomor. Seluruh data uji dibersihkan dan `farmasi.enabled` dikembalikan ke `0`.

## Balasan stok & harga obat (`/farmasi`, migrations/019) -- arah MASUK, dan katalog BUKAN rekam medis

Diverifikasi: `susunJawabanStok()` dan `cobaBalasStok()` (fungsi produksi yang sama dipanggil worker) dijalankan terhadap `alca`/`wakhanza` sungguhan atas 7 keadaan, 21 pemeriksaan -- katalog nyata terbaca (Paracetamol 500 Mg sisa 231 Tablet Rp500), mode `petugas` menyebut angka sementara `semua` menyembunyikannya, ketiga cabang (ketemu/kosong/tanpa_nama) benar, `ralan` dan `jualbebas` terbukti menghasilkan teks berbeda, nomor tak terdaftar tidak ditangani DAN tidak membuat baris `outbox`, sesudah didaftarkan barisnya terbentuk dengan `trigger_code='AUTO_REPLY'`, dan mode `mati` tidak menangani apa pun. Worker dihentikan selama pengujian supaya baris uji tidak mungkin terkirim; seluruh baris dan pengaturan dikembalikan di `finally`. `core/stokObat.ts` diuji unit 23 kasus (termasuk bahwa nama obat berisi baris baru tidak bisa menyisipkan barisnya sendiri). Halaman + kotak Uji coba + kedua pagar penyimpanan lewat **browser sungguhan** (10 pemeriksaan).

Jalur GRUP diverifikasi terpisah lewat `cobaBalasStokDariGrup()` (fungsi produksi yang sama dipanggil pendengar) atas 8 keadaan, 22 pemeriksaan: grup tak terdaftar tidak dijawab; grup terdaftar tapi `boleh_tanya=0` juga tidak; sesudah dicentang barisnya terbentuk dengan `chat_id` grup, `phone_e164` NULL, dan menyebut ANGKA; penyerahan ulang pesan yang sama tetap satu baris; obrolan biasa dan emoji tidak dijawab; **mode `semua` TIDAK meloloskan grup yang belum dicentang** sementara yang dicentang tetap mendapat angka; perorangan pada mode `semua` tidak mendapat angka; dan kuota per grup menahan baris berikutnya tanpa menjatuhkannya ke aturan lain. Centang "Boleh tanya" lewat **browser sungguhan** (9 pemeriksaan, dikembalikan ke mati sesudahnya karena grup itu grup apotek nyata). JID grup ujinya karangan, worker dihentikan selama pengujian, dan seluruh baris dibersihkan di `finally`.

## Kelas keenam: DARURAT STOK (`/farmasi`, migrations/021) -- dipicu WAKTU, bukan kejadian

Diverifikasi: `verify:plans` menunjukkan `range`/`Using index` pada `databarang` dan `eq_ref` seluruh join, tanpa satu pun izin pindai penuh; `verify:db` lolos; 370 unit test (26 baru: `stokDarurat.test.ts` 17, `every_n_days` 9). **Jawaban balasan stok dibuktikan TIDAK berubah** -- query lama vs baru dijalankan berdampingan atas seluruh katalog, 880 baris identik kode-per-kode dan stok-per-stok. `runDueStokDarurat()`/`jalankanSatuJadwal()` (fungsi produksi yang sama dipanggil worker) dijalankan terhadap `alca`/`wakhanza` sungguhan atas 9 keadaan, 23 pemeriksaan -- termasuk bahwa jalan kedua atas jatuh tempo yang SAMA tidak menambah baris sementara jatuh tempo baru menambah, sakelar mati tidak memajukan `next_run_at`, tanpa tujuan `next_run_at` dipertahankan, dan gudang aman + pesan kosong tidak mengirim pesan hampa. Worker dihentikan selama pengujian; seluruh baris dan pengaturan dikembalikan di `finally`. Halaman lewat HTTP asli terhadap build produksi di port sendiri (20 pemeriksaan). Server action lewat **browser sungguhan**: jadwal (28 pemeriksaan -- termasuk penolakan jarak 1 hari, penolakan `{nama_pasien}`, jeda/aktifkan, dan **Batal benar-benar tidak menghapus**) dan centang tujuan (14 pemeriksaan -- `terima_darurat_stok` berubah sementara `is_active` dan `boleh_tanya` TIDAK). Dan **satu peringatan benar-benar terkirim** ke nomor uji oleh worker PM2 (`send_log.outcome='sent'`, 295 ms, `attempts=1`).

## Darurat stok: batas dicabut, dan arahnya jadi dua (migrations/022, 023)

Diverifikasi: 395 unit test (`stokDarurat.test.ts` +19 pemecahan/deteksi, `idempotency.test.ts` +6); `verify:plans` tetap `range`/`Using index` tanpa izin pindai penuh; `verify:db` lolos. **38 pemeriksaan lewat fungsi produksi** terhadap `alca`/`wakhanza` sungguhan (worker dihentikan) -- termasuk bahwa 208 barang muat dalam satu pesan, pemecahan pada daftar SUNGGUHAN dengan batas 3.000 menghasilkan 4 bagian dan **NOL barang hilang**, nomor tak terdaftar tidak dijawab dan tidak meninggalkan baris, "stok habis paracetamol" diteruskan bukan dijawab rekap, kedua sakelar benar-benar menahan, dan grup tanpa `boleh_tanya` didiamkan. **Dua pengiriman WhatsApp sungguhan** oleh worker PM2: daftar nyata 9.416 karakter (`sent`, 264 ms) dan probe 13.035 karakter (`sent`, 274 ms). 15 pemeriksaan HTTP terhadap build produksi di port sendiri, 23 lewat **browser sungguhan** (pratinjau tanpa batas menampilkan 208, batas 10 tetap menyebut sisanya, ketiga cabang uji frasa, penolakan frasa kosong, dan nilai yang benar-benar berubah lalu dikembalikan di database).

## `/farmasi` dipecah jadi TAB -- dan rujukan spasial yang ikut jadi salah

Diverifikasi: `tsc`/`eslint`/`next build` bersih, 403 unit test tetap lolos, `verify:db` dan `verify:plans` lolos (tidak ada query `sik` yang disentuh). **70 pemeriksaan HTTP** terhadap build produksi di port sendiri (dipastikan KOSONG lebih dulu) -- termasuk bahwa tiap tab TIDAK membocorkan penanda ketiga tab lain, `?tab=ngawur` jatuh ke bawaan, dan operator ditolak di keempat tab. **32 pemeriksaan lewat browser sungguhan**: keempat tab diklik dan URL-nya ikut berubah, kedua Server Action di blok yang DIPINDAHKAN tetap tersambung (pratinjau membalas 205 barang sungguhan, uji frasa membalas), dialog jadwal tetap membuka dan Batal tetap membatalkan, keempat kotak pesan benar-benar dua kolom, dan tidak satu tab pun meluber menyamping. Tautan paginasi dibuktikan membawa tabnya lewat `hrefHalaman()` langsung -- mesin ini cuma punya 1 tujuan, jadi `Pagination` memang merender tombolnya sebagai `<span>` mati, dan memaksa halaman kedua menuntut >25 tujuan PALSU di tabel yang dibaca worker.

## Tujuan tambahan untuk pemicu pasien (`template_target`, migrations/018)

Diverifikasi: `enqueuePemicuPasien()` + `loadPipelineContext()` (fungsi produksi yang sama dipakai worker) dijalankan terhadap database `wakhanza` sungguhan atas 6 keadaan, 11 pemeriksaan -- mode `pasien` menghasilkan 1 baris tanpa salinan; `pasien_dan_tujuan` menghasilkan 1+2 dengan alamat yang benar; jalan ULANG atas kunci yang sama tetap 3 baris (bukan 6), membuktikan `uq_idem` menegakkan kunci turunannya; mode `tujuan` menghasilkan 0 baris pasien; mode `tujuan` tanpa tujuan aktif menghasilkan NOL baris berikut `ERROR` di log; dan tujuan yang dinonaktifkan tidak ikut dikirimi. Worker dihentikan selama pengujian supaya baris uji tidak mungkin terkirim, dan seluruh baris dibersihkan di `finally`. Halaman lewat HTTP asli terhadap build produksi (7 pemeriksaan, termasuk badge `Pasien` tepat tujuh kali). Server action lewat **browser sungguhan** (7 pemeriksaan): pagar penolakan mode, tambah tujuan, penolakan tautan undangan berikut kalimat jalan keluarnya, penyimpanan mode, dan kolom Penerima ikut berubah di tabel. `turunkanKunciTujuan` diuji unit 5 kasus.

## Halaman Pesan masuk (`/pesan-masuk`) -- arah MASUK, dan tempat mencari ID

Diverifikasi: `catatPesanMasuk()` (fungsi produksi yang sama dipanggil pendengar) diuji terhadap database sungguhan atas 6 keadaan -- perorangan terbalas, `@lid` tak terpetakan, GRUP (`chat_id`=grup vs `pengirim_id`=peserta), stiker, penyerahan ulang pesan yang sama (4 baris bukan 5), dan `simpan_teks=0` (teks `null`, `panjang_teks` tetap 34); halaman lewat HTTP asli dengan cookie admin (13 pemeriksaan isi lolos, tanpa login 307 → `/login`, saringan `grup` tidak meloloskan baris perorangan); sakelar simpan-teks lewat **browser sungguhan**; perbaikan pembacaan-kosong dibuktikan pada keadaan aslinya -- sinkron tepat sesudah sesi ditautkan ulang membaca 0 grup dan **mempertahankan** daftar (`daftar grup terbaca KOSONG -- daftar lama dipertahankan`). `isGroupAddress` diuji unit 3 kasus. **Belum diuji**: pesan masuk SUNGGUHAN lewat pendengar -- butuh ponsel lain mengirim ke nomor RS, dan grup-grupnya kebetulan sepi selama pengujian.

## `{cara_bayar}` — nama penjamin, dan kodenya yang tidak pernah ikut keluar

Diverifikasi: `verify:plans` menunjukkan `pj eq_ref PRIMARY rows~1` pada KEENAM query yang berubah — **tanpa satu pun izin pindai penuh baru**; `verify:db` lolos; 403 unit test (8 baru di `penjamin.test.ts`). 18 pemeriksaan lewat fungsi produksi terhadap `sik` sungguhan: `png_jawab` terisi 200/200 pada QUEUE_REG, PHARMACY_READY, dan BILLING_READY; nilai unik yang benar-benar keluar `"UMUM"` dan `"BPJS Kesehatan"`; tidak satu pun nilai sama dengan kode `penjab` mana pun; dan satu pesan sungguhan dirender penuh (`"...Cara bayar: UMUM."`). Kasus `-` dibuktikan **ujung ke ujung lewat query produksi**, bukan lewat unit test saja: kursor `pollQueueReg()` diarahkan ke baris nyata ber-`kd_pj='-'`, SQL mengembalikan `"-"`, dan `varsQueueReg()` menghasilkan `""`. **Yang TIDAK bisa dibuktikan atas data nyata di mesin ini**: BOOK_CONFIRM/BOOK_CANCEL/BOOK_REMIND dan RESULT_READY(radiologi) — `booking_registrasi` dan `periksa_radiologi` keduanya **0 baris**, jadi tidak ada baris yang bisa mengalir. Query-nya tetap tervalidasi `verify:plans` (EXPLAIN terhadap tabel sungguhan) dan pemetaannya lewat baris buatan; yang belum pernah terjadi adalah baris sungguhan melewatinya.

## Berhenti berlangganan: frasanya, dan CAKUPANNYA yang sengaja sempit

Diverifikasi empiris terhadap database sungguhan: frasa lama (`stop`/`STOP`/`berhenti`/`unsubscribe`) tidak lagi memberhentikan; frasa baru dikenali dalam berbagai kapitalisasi dan di tengah kalimat; sesudah opt-out ketujuh pemicu semuanya `skipped_opt_out` sementara BROADCAST dan AUTO_REPLY tetap `pending`. Plus 9 unit test di `core/optOut.test.ts`.

## Paginasi: satu penurunan, `src/core/pagination.ts`

Diverifikasi: 23 unit test (`core/pagination.test.ts`), lalu **52 pemeriksaan lewat HTTP asli terhadap build produksi** dengan cookie sesi admin sungguhan -- `?page=999` dijepit ke halaman 6 berikut 28 baris (dulu kosong); `page=0/-5/abc/2.7/Infinity` semuanya tidak merusak halaman; `/daftar-tolak` dan `/pesan-masuk` halaman 2 terjangkau; `/template` menampilkan 25+5 tanpa tumpang tindih sementara ketujuh pemicu tetap utuh di KEDUA halaman; `/pesan-masuk` merender dua kontrol dan menggeser `gpage` terbukti tidak menggeser tabel pesan (dan sebaliknya); `/broadcast-terjadwal` membawa `kab=3374&kab=3375&pj&lookbackDays` di tautan halamannya.

## Peringatan gangguan (`worker/alert.ts`) -- jalur yang tidak ikut mati bersama yang diberitakannya

Diverifikasi: keempat perilaku jeda dibuktikan lewat penerima webhook lokal sungguhan (jenis sama tertahan, jenis beda lolos, `test` dua kali beruntun keduanya lolos), payload diperiksa dan tidak memuat data pasien; tombolnya ditekan lewat **browser sungguhan** (Puppeteer, mencari tombol lewat TEKSNYA -- pelajaran dari uji broadcast yang dulu tidak sengaja menekan "Keluar") dengan ketiga jalur: terkirim, URL kosong, dan URL sah tapi tidak ada yang mendengarkan. Tercatat di `audit_log` sebagai `alert_webhook_test`. Dikembalikan ke kosong setelah diuji.

## Akun dashboard: dua jalur, satu pagar

Diverifikasi: otorisasi halaman lewat HTTP asli (operator 307 ke `/ringkasan`, tanpa login 307 ke `/login`, admin 200) dan menu yang benar per peran; seluruh alur admin lewat **browser sungguhan** (buat, username duplikat ditolak, ubah nama+naikkan peran, setel ulang sandi, dialog konfirmasi, nonaktifkan) plus tombol Nonaktifkan yang mati di baris sendiri dan penolakan server saat menurunkan peran sendiri; halaman Profil lewat browser sungguhan (sandi lama salah ditolak, sandi baru = lama ditolak, penggantian berhasil lalu **sandi barunya dipakai login sungguhan**, ganti nama tersimpan); pagar admin-terakhir lewat CLI dengan admin aktif benar-benar disisakan satu; dan 34 unit test di `userPolicy.test.ts`. Akun uji dibersihkan sesudahnya.

Hapus diverifikasi terpisah: alurnya lewat **browser sungguhan** (Hapus mati di baris sendiri; dialog memuat peringatan "masih aktif" hanya untuk akun aktif; **Batal benar-benar tidak menghapus**; sesudah dikonfirmasi barisnya hilang dan pesan sukses muncul), lalu `audit_log` diperiksa langsung -- `user_delete` tercatat berikut `username=... peran=... aktif=...` sementara baris `app_user`-nya nol, membuktikan sekaligus bahwa grant `DELETE ON app_user` memang berlaku. Kedua pagar dibuktikan lewat fungsi produksi `hapusPengguna()` terhadap database sungguhan (bukan hanya `bolehHapus()` yang sudah diuji unit -- yang perlu dibuktikan adalah `keadaanUntuk()` menghitung admin aktif dari database): hapus diri sendiri ditolak, lalu admin sungguhan dinonaktifkan sementara di dalam `try/finally` sampai tersisa SATU admin aktif dan penghapusannya ditolak, lalu dipulihkan. **Sasaran percobaan "admin terakhir" sengaja akun buangan** -- kalau pagarnya ternyata bocor, yang hilang akun uji, bukan akun rumah sakit. `npm run users -- delete` diuji terpisah, termasuk jalur username yang tidak ada.

## `npm run users`, dan kenapa JWT membatasi artinya "dinonaktifkan"

Diverifikasi lewat HTTP asli, tiga langkah dengan kata sandi yang sama supaya `is_active` benar-benar terisolasi sebagai penyebabnya: nonaktif + sandi benar -> ditolak; diaktifkan -> berhasil masuk; dinonaktifkan lagi -> ditolak. Akun uji `operator1`/`locktest`/`admin2` sekarang nonaktif; `admin` dan `puja` tetap aktif (dua admin, supaya satu akun bukan titik kegagalan tunggal).

## Halaman Ringkasan (`/ringkasan`) -- halaman pendaratan

Diverifikasi lewat HTTP asli dengan cookie admin: keadaan ramai (`4 pesan masuk dalam 24 jam terakhir, 2 di antaranya tidak cocok aturan mana pun`) dan keadaan tidak-terpantau (`Balasan otomatis sedang mati, jadi pesan masuk tidak dicatat`); keadaan sunyi diuji unit (5 kasus). Data ujinya dibersihkan dan `autoreply.enabled` dikembalikan.

## `npm run scan:contacts` -- kenapa pemindaian awal perlu ada terpisah

Diverifikasi lewat HTTP asli dengan cookie sesi admin sungguhan: chip terurut `Semua (3.284) | Terlalu pendek (55) | Bukan nomor seluler (52) | Tidak terbaca (11) | Kosong (3.166)`.

## Kelas ketujuh dan kedelapan: BPJS (`/bpjs`, migrations/024) -- satu kanal, dua arah berlawanan

**Pengiriman SUNGGUHAN, kode pemicu baru, lewat worker PM2 yang sedang berjalan.** Satu pesan `BPJS_BATAL` berisi data sintetis (tanpa pasien nyata) diantrekan lewat `loadFarmasiContext` + `enqueueMessage` produksi, lalu diambil dispatcher: `status=sent`, `attempts=1`, `send_log.outcome=sent`, `duration_ms=260`, `last_error` NULL. Dijalankan pukul **22.46 WIB** -- di dalam jam tenang 21..07 -- dan `scheduled_at` sama persis dengan `event_at`, membuktikan pendaftaran `BPJS_BATAL` di `BYPASS_QUIET_HOURS` benar-benar berlaku, bukan sekadar tertulis.

**Kedua query terhadap data nyata** (`npm run dryrun:bpjs -- sik 2026-02-11`, database rujukan berisi 1.808 pembatalan + 18.843 surat kontrol): `BPJS_BATAL` 200 baris, **poli tak terpetakan 0** (`maping_poli_bpjs` melayani seluruhnya, `JAN` -> `U0012` -> "Poliklinik Jantung"); `BPJS_KONTROL` 4 baris untuk 2026-02-11, `{sisa_hari}` terender "besok", `{nama_poli}`/`{nama_dokter}` dari kolom BPJS pada suratnya. Kedua pesan lengkap berikut baris `Kode Pengiriman`.

**Pagar privasi dibuktikan pada OBJEK BARISNYA, bukan dengan membaca SQL.** `Object.keys()` baris sungguhan: `BPJS_BATAL` -> `nobooking, no_rkm_medis, tanggalbatal, keterangan, tanggalperiksa, jampraktek, nohp, kd_poli, nm_pasien, no_tlp, nm_poli, nm_dokter`; `BPJS_KONTROL` -> `no_surat, tgl_rencana, nm_poli_bpjs, nm_dokter_bpjs, no_rkm_medis, nm_pasien, no_tlp, notelep, kd_poli`. Tidak satu pun dari ~45 kolom klinis `bridging_surat_kontrol_bpjs` (`status_prb`, HBA1C, GDP, eGFR, LDL, tekanan darah, ...) maupun `diagawal`/`nmdiagnosaawal` milik `bridging_sep` yang ikut terbaca.

**Kenapa prefix `nobooking` ditolak sebagai pemangkas**, diukur atas seluruh 1.808 baris: `SIGN(DATEDIFF(DATE(tanggalbatal), STR_TO_DATE(LEFT(nobooking,8),'%Y%m%d')))` -> `-1: 506 baris (sampai -60 hari)`, `0: 1.158`, `+1: 144 baris (sampai +105 hari)`. 144 baris terakhir itu akan dibuang pemangkas 30 hari, tanpa galat dan tanpa satu baris `outbox` pun. `LENGTH(nobooking)` seragam 14, 0 baris berformat menyimpang -- jadi penolakannya memang karena semantiknya, bukan karena formatnya tidak konsisten.

**Cadangan nomor dari SEP, diukur bukan diperkirakan**: dari 18.843 surat, 618 milik pasien ber-`pasien.no_tlp` tak terpakai, dan **602 di antaranya (97%)** punya nomor sah di `bridging_sep.notelep`; `notelep` kosong 0 baris. Untuk pembatalan Mobile JKN, `referensi_mobilejkn_bpjs.nohp` kosong 0 dari 1.808 dan menyelamatkan 60 pasien -- tercatat di sini walau TIDAK dipakai, karena tujuan `BPJS_BATAL` adalah staf.

**Biaya pemindaian penuh, diukur**: query surat kontrol berikut join penuh ~35 ms (33/38/38 ms, tiga kali berturut-turut, termasuk overhead klien) atas 18.843 baris. `npm run verify:plans` lolos dengan kedua pemindaian tercatat disengaja (`BPJS_BATAL b ALL`, `BPJS_KONTROL sk ALL`); seluruh join lain `eq_ref` lewat indeks, termasuk `mp eq_ref kd_poli_bpjs (Using index)`.

**Grant tidak diwarisi, untuk kelima kalinya.** Sebelum grant eksplisit: `INSERT` lolos, `UPDATE`/`DELETE` ditolak `ERROR 1142 ... denied to user 'wakhanza_rw'@'localhost' for table 'bpjs_target'`. Sesudah `GRANT UPDATE, DELETE ON wakhanza.bpjs_target` lewat root: keduanya berhasil, baris uji dibersihkan (`sisa_baris_uji: 0`).

**Uji integrasi terhadap `wakhanza` sungguhan** (`src/worker/bpjsRunner.int.test.ts`, 8 kasus, bagian dari `npm run test:int` -> `3 suites / 30 tests passed`) -- membuktikan hal yang tidak bisa dibuktikan unit test, yaitu bahwa pendaftaran kode pemicu benar-benar berakibat pada baris `outbox`: `BPJS_KONTROL` + nomor di daftar tolak -> `skipped_opt_out`; `BPJS_BATAL` + nomor yang sama -> tetap `pending`; `BPJS_KONTROL` pukul 22.30 -> `scheduled_at` bergeser ke jam 7; `BPJS_BATAL` pukul 22.30 -> tidak bergeser; poli sensitif -> template generik dan nama poli TIDAK muncul; kunci H-7 dan H-1 berbeda sehingga keduanya jadi pesan tersendiri; kunci turunan tujuan <= 64 karakter; dan **salinan ke grup tetap `pending` saat pesan ke pasiennya `skipped_opt_out`** -- konsekuensi yang dipatok uji justru karena ia yang harus disadari rumah sakit. Nol baris uji tersisa sesudahnya.

**Uji HTTP lewat build PRODUKSI** (`npm run build` + `next start -p 3199`, port dipastikan KOSONG lebih dulu -- satu listener, PID tunggal): **26 pemeriksaan lolos, 0 gagal**. Anonim -> dialihkan ke `/login`; **operator -> dialihkan ke `/ringkasan`** (admin-only ditegakkan di server, bukan cuma disembunyikan dari nav); ketiga tab 200 berikut isinya masing-masing; `?tab=ngawur` jatuh ke tab bawaan alih-alih galat; nav memuat `/bpjs`. Klaim "tab memangkas query" dibuktikan dari HTML: tab Tujuan **tidak** memuat `bpjs.template_batal` maupun `bpjs.kontrol_hari_sebelum`, dan tab Pembatalan tidak memuat `bpjs.kontrol_hari_sebelum`. Akun uji admin dan operator dihapus sesudahnya.

**Pemeriksaan menyeluruh**: `npm test` 431 lolos (26 suite; +27 dari `core/bpjs.test.ts`, +1 kasus baru di `optOut.test.ts` yang mematok pemicu berpenerima staf TIDAK terikat daftar tolak), `tsc --noEmit` bersih, `eslint` bersih, `next build` sukses dengan rute `/bpjs` terdaftar, `verify:db` lolos (`sik` tulis DITOLAK, `audit_log` DELETE/UPDATE DITOLAK), `verify:plans` lolos.

**Worker sungguhan memuat kedua siklusnya, dibuktikan sesudah `pm2 restart`** (bukan disimpulkan dari kode): siklus `bpjs-kontrol` berjalan pada interval pindainya dan mencatat `{"sasaran":["2026-08-06"],"msg":"tidak ada surat kontrol yang jatuh tempo diingatkan"}` -- H-1 dari 2026-08-05, jadi matematika `sasaranKontrol()` maju ke arah yang benar; nol baris di `alca` ditangani tanpa galat dan tanpa satu pesan pun; `bpjs.kontrol_last_run` terisi `2026-08-05` HANYA sesudah jalannya berhasil. Sakelarnya dikembalikan ke bawaan MATI sesudahnya. Kedua proses PM2 `online`, sesi WhatsApp kembali `ready`, worker restart sekali tanpa loop.

## PERMINTAAN lab & radiologi (`migrations/025`) -- pasangan RESULT_READY dari ujung yang lain

**Query terhadap data produksi sungguhan** (`npm run poll:dryrun`, database `alca`): `LAB_REQUEST` **12 baris kandidat**, pesan lengkap terender dengan nama pasien nyata, nama dokter dari `dokter_perujuk`, identitas RS dari `sik.setting`, dan baris `Kode Pengiriman`. Resolusi nomor berjalan: 2 dari 12 tanpa nomor valid (`ditolak (empty)`), sisanya ternormalisasi ke E.164. `RAD_REQUEST` 0 baris -- lihat catatan di bawah.

**Pagar privasi dibuktikan pada OBJEK BARISNYA, bukan dengan membaca SQL**, terhadap KEDUA database. `Object.keys()` baris sungguhan: `noorder, no_rawat, tgl_permintaan, jam_permintaan, kd_jenis_prw_list, no_rkm_medis, kd_poli, nm_pasien, no_tlp, nm_poli, nm_dokter, png_jawab` -- identik di `alca` (74 baris) dan `sik` (200 baris terbaca). Tidak satu pun dari `diagnosa_klinis`, `informasi_tambahan`, `nm_perawatan`, `stts_bayar`, `tgl_hasil`, `jam_hasil` ikut terbaca. `kd_jenis_prw_list` berisi KODE (`227-K.3`, `242-RJ,290-RJ`), bukan nama pemeriksaan.

**Margin pemangkas, diukur bukan diperkirakan**: `SIGN(DATEDIFF(tgl_permintaan, STR_TO_DATE(LEFT(no_rawat,10),'%Y/%m/%d')))` atas 4.636 baris -> `0: 4.631 baris`, `+1: 5 baris (1..61 hari)`, dan **tidak ada nilai negatif** -- permintaan tidak pernah mendahului kunjungannya, jadi hanya batas bawah pemangkas yang perlu dilebarkan. `noorder` diperiksa sebagai alternatif dan terbukti eksak (`STR_TO_DATE(SUBSTRING(noorder,3,8)) <> tgl_permintaan` -> **0 baris**, panjang seragam 14, awalan `PK` pada seluruh 4.636 baris) tapi tidak dipakai karena awalan radiologi tak terverifikasi.

**Izin pindai penuh dibuktikan sebagai keputusan optimizer, bukan jalur akses yang salah.** Query yang SAMA di dua database: `alca` (74 baris, 12 cocok rentang) -> `type=ALL, key=NULL, rows=62`; `sik` (4.636 baris) -> `type=range, key=no_rawat`. Jendela 120 hari pada volume nyata berisi 868 baris, jadi `maxRows: 3000` tetap berteriak jauh sebelum pemindaian tabel dewasa. `npm run verify:plans` lolos; seluruh join lain `eq_ref`/`ref` lewat indeks.

**Uji integrasi terhadap `wakhanza` sungguhan** (4 kasus baru di `src/worker/bpjsRunner.int.test.ts`, `npm run test:int` -> `3 suites / 34 tests passed`): `LAB_REQUEST` dan `RAD_REQUEST` keduanya -> `skipped_opt_out` untuk nomor di daftar tolak (membuktikan pendaftaran di `OPT_OUT_TRIGGERS` benar-benar berakibat pada baris `outbox`, bukan sekadar menambah string ke sebuah Set); `LAB_REQUEST` pukul 22.30 -> `scheduled_at` bergeser ke jam 7; kode pemeriksaan sensitif -> template generik, dan **baik nama dokter maupun kode pemeriksaannya tidak muncul di badan pesan**.

**Uji HTTP lewat build PRODUKSI** (`next start -p 3199`, port dipastikan kosong -- satu listener): **19 pemeriksaan lolos, 0 gagal**. Kedua label dan kedua kode muncul di `/template`; ketujuh pemicu lama tetap ada; kalimat lama "jumlahnya tetap tujuh" sudah tidak terbaca staf; keduanya tampil **Nonaktif**, dengan **kontrol negatif** (`QUEUE_REG` yang memang aktif TIDAK tampil Nonaktif) supaya asersinya tidak hampa.

**Jebakan verifikasi, dan ia bentuk yang sudah tercatat**: percobaan pertama asersi "tampil Nonaktif" GAGAL atas produk yang benar, karena dibatasi jendela 800 karakter sesudah kode pemicu -- kolom isi pesan memuat template lengkap di atribut `title`, sehingga lencana statusnya jatuh jauh di luar jendela itu. Diperbaiki dengan membatasi asersi ke `<tr>` barisnya. Pelajarannya persis yang sudah dibayar di `/farmasi`: **kondisi tunggu dan asersi wajib dibatasi ke elemen yang sedang diuji.**

**Pengiriman SUNGGUHAN lewat `LAB_REQUEST`**, isinya sintetis, memakai `loadPipelineContext` + `enqueuePemicuPasien` produksi. Diantrekan pukul **06.23 WIB** -- di dalam jam tenang 21..07 -- dan `scheduled_at` menjadi **07.00.00**, membuktikan pemicu ini TUNDUK pada jam tenang. Kontras langsung dengan `BPJS_BATAL` yang diuji pukul 22.46 dan `scheduled_at`-nya sama dengan `event_at`. Baris `Kode Pengiriman` menyebut `07:00:00`, bukan waktu antre -- membuktikan `{waktu}` diisi `scheduled_at`. Templatenya dinyalakan sementara untuk uji ini lalu dikembalikan ke `is_active = 0`. Kirimannya sendiri dibuktikan dengan memajukan `scheduled_at` baris uji itu ke saat itu juga (penundaan jam tenangnya sudah terekam pada nilai 07.00 sebelum dimajukan, jadi yang tersisa tinggal bukti pengirimannya): dispatcher mengambilnya dalam 5 detik -> `status=sent`, `attempts=1`, `send_log.outcome=sent`, `duration_ms=314`, `last_error` NULL.

**Klaim lama yang ikut diperbaiki karena migrasi ini membuatnya keliru**: "tabel `template` tepat tujuh baris selamanya" (dua tempat di `CLAUDE.md`, satu komentar dan satu kalimat yang DIBACA STAF di `/template`), dan daftar `OPT_OUT_TRIGGERS` yang tertulis tujuh (kini sepuluh, dan `optOut.test.ts` mematoknya). Isi tabel sesudah migrasi: 9 baris, `LAB_REQUEST` dan `RAD_REQUEST` keduanya `is_active=0`.

**Pemeriksaan menyeluruh**: `npm test` 431 lolos (26 suite), `tsc --noEmit` bersih, `eslint` bersih, `next build` sukses, `verify:db` lolos, `verify:plans` lolos.

**Worker sungguhan menjalankan kedua poller**, dibuktikan sesudah `pm2 restart` (bukan disimpulkan dari kode): log siklus memuat `{"triggerCode":"LAB_REQUEST","msg":"pemicu nonaktif atau template belum ada, lewati siklus"}` dan pasangannya untuk `RAD_REQUEST`, berulang tiap `polling.interval_ms` (60 detik). Sekali jalan membuktikan dua hal: pollernya benar-benar terpasang di `runAllSisipCycles()`, dan bawaan `is_active = 0` memang menggerbangnya -- nol baris `outbox` dibuat selama templatenya mati.

**Yang TIDAK terbukti, dan sengaja dicatat sebagai tidak terbukti**: `RAD_REQUEST` tidak pernah diuji terhadap satu baris data pun -- `permintaan_radiologi` berisi **0 baris di `alca` MAUPUN `sik`**. Bentuk SQL-nya identik dengan lab (satu fungsi pembangun yang sama) dan EXPLAIN-nya `range no_rawat`, tapi itu bukan hal yang sama dengan terbukti atas data.

**Crash loop sesudah dua restart berdekatan, dan pemulihannya -- terjadi sungguhan saat verifikasi ini.** Gejala terukur: `pm2 list` restart 9 -> 38 dalam beberapa menit, log `{"msg":"worker gagal memulai","message":"Protocol error (Runtime.callFunctionOn): Target closed"}` berulang, plus `ERROR: The process with PID ... could not be terminated`. **`wa_session.status` tetap `ready` sepanjang gangguan** -- ditulis proses yang sudah mati -- sementara `heartbeat_at` basi **195 detik** pada loop yang seharusnya 30 detik; itulah satu-satunya tanda yang jujur. Ditemukan 9 proses `chrome.exe` memegang `.wwebjs_auth` (disaring lewat `CommandLine`, terpisah dari 14 `chrome.exe` milik pemakai yang tidak disentuh). Sesudah `pm2 stop` -> matikan 9 proses itu -> `pm2 start`: worker mencapai `memulai siklus poller` lalu `WhatsApp terautentikasi`, dan heartbeat kembali **23 detik**. Nol `gagal memulai` sesudahnya. Baris `outbox` yang sedang menunggu jadwal tidak terpengaruh (`pending`, `attempts=0`).

## Kelas kesembilan: ADMINISTRASI (`/administrasi`, migrations/026) -- mengirim BERKAS, bukan kabar

**Sumber data dibuktikan dari kode Khanza, bukan ditebak dari nama tabel.** `src/surat/SuratSakit.java` baris 917-923 memanggil `rptSuratSakit5.jasper` atas query yang berangkat dari `reg_periksa` + `pasien` + `dokter` + wilayah, dan `param.put("penyakit", ...)` membacanya dari `diagnosa_pasien` INNER JOIN `penyakit` -- jadi diagnosanya memang tersimpan, bukan diketik dokter saat cetak. `src/simrskhanza/DlgReg.java` baris 10033 memanggil `rptSuratSehat.jasper` **tanpa menyentuh `surat_keterangan_sehat` sama sekali**; tabel itu milik `SuratKeteranganSehat.java` -> `rptDataSuratKeteranganSehat.jasper`. Itulah sebabnya `surat_keterangan_sehat` berisi **0 baris di `alca` MAUPUN `sik`** sementara `suratsakit` berisi **18 baris di `alca`** (dan 0 di `sik` -- kebalikan dari kasus BPJS).

**Penanda kosong Khanza, diukur bukan diperkirakan**, atas 4.873 pasien / 18 surat di `alca`: `kelurahan.nm_kel = 'KELURAHAN'` pada **4.332 pasien (89%)**, `kecamatan` 4.328, `kabupaten` 4.362; `pasien.pekerjaan = '-'` pada **14 dari 18 surat (78%)**; `perusahaan_pasien.nama_perusahaan = '-'` pada **18 dari 18 (100%)**. Terbukti berakibat pada surat: `npm run dryrun:surat` mencetak `baris DIBUANG karena kosong/penanda: Pekerjaan, Instansi` dan alamat `KOTO ALAM` -- bukan `KOTO ALAM, KELURAHAN, KECAMATAN, KABUPATEN` yang dihasilkan query cetak Khanza.

**Pemangkas `no_surat` diukur terhadap `tanggalawal`**: `SUBSTR(no_surat,4,8) = DATE_FORMAT(tanggalawal,'%Y%m%d')` cocok pada **13 dari 18 baris**. *(**Kesimpulan yang dulu ditarik dari angka ini KELIRU dan sudah dicabut** -- baris ini sempat berbunyi "membuktikan tanggal di nomor surat adalah tanggal DIBUAT". 13 dari 18 tidak membuktikan itu; ia hanya membuktikan bahwa nomornya bukan salinan `tanggalawal`. Pengukuran tandingannya menunjukkan cocok dengan `tgl_registrasi` pada **15 dari 18** -- juga bukan aturan. Lihat §"Kelas kesepuluh" untuk apa yang sebenarnya disandikan, dibaca dari kode Khanza.)* Diagnosa tercatat hanya pada **4 dari 18 surat**, jadi barisnya memang sering kosong bahkan saat sakelarnya nyala.

**Rencana query** (`npm run verify:plans`, lolos): `ADMINISTRASI_SURAT_SAKIT` -> `ss range PRIMARY`, seluruh tujuh join `eq_ref`. `ADMINISTRASI_SURAT_SEHAT` -> `ss range idx_reg_periksa_rawat_rkm rows~677 (Using index)`, join `eq_ref`. Izin pindai penuh untuk `sks` **dibuktikan sebagai keputusan optimizer atas tabel KOSONG**, bukan jalur akses yang salah: salinan berstruktur identik diisi 3.000 baris lalu di-EXPLAIN dengan bentuk join yang sama -> `type=ref, key=no_rawat, rows~1` (kosong: `type=ALL, key=NULL`). Salinan ujinya dihapus setelah diukur.

**Privasi dibuktikan pada OBJEK BARISNYA** (`npm run dryrun:surat`, `Object.keys()` baris sungguhan): surat sakit -> `no_surat, no_rawat, tanggalawal, tanggalakhir, lamasakit, tgl_registrasi, umurdaftar, sttsumur, no_rkm_medis, kd_poli, nm_pasien, jk, no_tlp, alamat, pekerjaan, nm_kel, nm_kec, nm_kab, nm_dokter, nama_perusahaan` -- **tidak ada kunci `diagnosa`** saat `administrasi.sertakan_diagnosa = 0`. `kd_poli` ada sebagai KODE, hanya untuk `checkPrivacy()`.

**PDF terbentuk sungguhan**: `%PDF-` magic sah, surat sakit **100.628 byte / 684 ms**, surat sehat **98.984 byte / 600 ms**. Chromium diluncurkan dengan `userDataDir` sementara sendiri (tidak pernah `.wwebjs_auth`), tanpa `--no-sandbox`, ditutup di `finally`. **Tata letaknya diperiksa dengan MELIHATNYA** -- kedua surat dirender ke PNG dan dibaca: kop RS, judul bergaris bawah, nomor surat, tabel identitas, kalimat istirahat/kesimpulan, blok tanda tangan, dan catatan kaki asal-usul semuanya pada tempatnya.

**Dua cacat tata letak yang HANYA terlihat dari gambarnya, dan keduanya lolos dari seluruh uji yang ada.** Dilaporkan pemakai atas surat sungguhan, lalu dibetulkan terhadap koordinat elemen jrxml -- bukan terhadap selera:

1. **QR berada di pojok kiri bawah halaman, jauh dari tanda tangan.** Yang benar dibaca langsung dari `rptSuratSakit5.jrxml`: tanggal `y=306`, "Pemeriksa" `y=321`, **QR `y=340 x=373 w=174 h=73`**, `nm_dokter` `y=419` -- keempatnya pada kolom `x=373` yang sama, jadi QR-nya menempati ruang tanda tangan di antara keduanya. `rptSuratSehat.jrxml` sama persis: `y=245` / **QR `y=258 x=131`** / `y=322` pada `x=130`. Sesudah dipindahkan, kedua surat dirender ulang ke PNG dan dilihat: QR duduk tepat di atas nama dokternya, berikut keterangan 7pt di bawah nama itu.
2. **Logo menempel di garis ganda kop** sementara teks di sebelahnya berjarak. Sebabnya logo `position: absolute` -- ia tidak punya margin/padding sendiri yang bisa mendorong garis itu, jadi satu-satunya yang menahannya `min-height` kop, yang bernilai `21mm` untuk logo `20mm`. Dinaikkan ke `24mm` (20mm logo + 4mm jarak).

**Ujinya ikut diperkuat, dan itu bagian yang paling layak dicatat**: asersi lama berbunyi "ada `<img alt="Kode QR pengesahan">`" dan **lolos sepenuhnya pada versi yang salah letak** -- keberadaan gambar tidak pernah bisa membuktikan letaknya. Sekarang yang dipatok URUTAN ketiganya di dalam HTML (`Dokter Pemeriksa,` -> QR -> nama dokter), plus kasus kebalikannya: saat QR tidak ada, `div.ruang` 20mm harus kembali supaya suratnya tetap punya tempat tanda tangan basah bila dicetak. `npm test` **470 lolos (27 suite)**.

**Uji unit** (`src/core/suratDoc.test.ts`, **26 kasus**): penanda umum + penanda-nama-kolom-sendiri, dan **kontrol negatif** bahwa nama sungguhan yang memuat kata itu (`KELURAHAN BALAI GADANG`) TIDAK ikut dibuang; `'0000-00-00'` -> string kosong, bukan "Invalid Date"; pelolosan HTML kelima karakter berikut urutan `&` lebih dulu; nama pasien berisi `<script>` tidak pernah jadi elemen; blok diagnosa hanya muncul saat terisi.

**Uji HTTP lewat build PRODUKSI** (`next start -p 3199`, port dipastikan kosong lebih dulu -- satu listener): **35 pemeriksaan lolos, 0 gagal**. Termasuk: pratinjau mengembalikan `application/pdf` sungguhan (`%PDF-`, >20 KB) untuk KEDUA jenis, `inline` bukan `attachment`, `cache-control: no-store`; parameter tak sah -> 400, surat tak ada -> 404; tab Pengaturan **tidak** memuat daftar surat (membuktikan `sik` tidak di-query saat tabnya tidak dibuka); baris surat nyata `SKS20260806001` tampil berikut lencana nomor bermasalah.

**BUG KEAMANAN yang ditemukan uji HTTP, bukan dibaca ulang**: operator menerima **HTTP 200 berikut PDF** dari `/administrasi/pratinjau`. Sebabnya `requireRole()` MENGEMBALIKAN respons 403 alih-alih melemparnya, dan versi pertama menulis `await requireRole('admin');` lalu membuang hasilnya. Sesudah diperbaiki: operator ditolak, tidak menerima `content-type` PDF, dan tautan menunya pun tidak tampil. Seluruh `route.ts` lain diaudit untuk pola yang sama -- tidak ada yang lain.

**Alur SEBENARNYA lewat peramban** (Puppeteer, bukan curl -- Server Action tidak bisa dipanggil lewat HTTP biasa, dan memanggil fungsinya langsung akan melewati `requireRole`): login -> `/administrasi?tab=pengaturan` -> tekan **Nyalakan** -> tab Surat sakit -> tekan **Kirim** pada barisnya. Hasil di layar: `Surat untuk PASIEN UJI ADMINISTRASI dimasukkan ke antrean kirim.`

**Pengiriman WhatsApp SUNGGUHAN berlampiran PDF**, dikirim worker PM2 yang sedang berjalan: `outbox` id 25660 -> `status=sent`, `attempts=1`, `media_mime=application/pdf`, `media_name=Surat-Keterangan-Sakit-PASIEN-UJI-ADMINISTRASI.pdf`, dibuat **07:26:20 WIB** dan terkirim **07:26:25** (5 detik), `last_error` NULL, `send_log.outcome=sent`, `duration_ms=3930`. Badan pesannya memuat pengantar berikut baris `Kode Pengiriman : 2026-08-06 07:26:20 HH89D6`, membuktikan kode unik ikut dipasang pada jalur berlampiran.

**Tiga jebakan yang lolos dari `tsc` DAN `next build`, ditemukan hanya karena dijalankan:**

1. **`export type` dari berkas `'use server'`** -> `ReferenceError: JenisSurat is not defined` saat server action pertama dipanggil. Tipe terhapus saat kompilasi sehingga typecheck bersih, tapi bundler memancarkan rujukan runtime untuk ekspornya. Dipindahkan ke `core/suratDoc.ts`.
2. **Modul `khanza/` yang tidak terdaftar di `khanza/index.ts` tidak pernah diperiksa `verify:plans`** -- pendaftarannya efek samping impor. Terlihat sebagai `verify:plans lolos` tanpa satu pun baris ADMINISTRASI. Sesudah ditambahkan ke barrel, satu regresi nyata langsung tertangkap (`sks type=ALL`).
3. **Login me-redirect ke port 3100** (AUTH_URL), yaitu instance PM2 dengan build LAMA -- uji peramban yang mengikutinya akan menguji kode lama. Cookie tidak membedakan port, jadi perbaikannya kembali ke port uji sesudah login.

**Pemeriksaan menyeluruh**: `npm test` **457 lolos (27 suite)**, `tsc --noEmit` bersih, `eslint` bersih, `next build` sukses (`/administrasi` dan `/administrasi/pratinjau` keduanya terdaftar), `verify:db` lolos, `verify:plans` lolos.

**Kebersihan sesudah verifikasi**: fixture uji di `alca` (`pasien` TESTWA00099, `reg_periksa` 2026/08/06/099099, `suratsakit` SKS20260806099) dihapus dan diperiksa 0 sisa; kedua akun uji dihapus; `administrasi.enabled` dikembalikan ke `0`; server uji di port 3199 dihentikan. **Yang sengaja dibiarkan**: satu baris `outbox` id 25660 berstatus `sent` beserta berkas PDF-nya di `uploads/broadcast/` -- itu bukti pengirimannya, dan akan terpangkas sendiri oleh cleanup 90 hari.

### Pratinjau HTML di modal (menggantikan tautan PDF)

**Keluhan awalnya terkonfirmasi sebagai perilaku PERAMBAN, bukan header yang salah.** Route-nya sudah mengirim `Content-Disposition: inline` sejak awal dan itu diverifikasi ulang di sini; tidak ada apa pun di `next.config.js`, `proxy.ts`, atau kode lain yang menimpanya (`grep` seluruh `src/` -> satu-satunya kemunculan ada di route itu sendiri). Yang memutuskan render-atau-unduh adalah setelan PDF peramban, dan tidak ada header yang bisa memaksanya. Karena itu perbaikannya memindahkan pratinjau ke bentuk yang tidak bergantung pada penampil PDF sama sekali.

**Uji HTTP lewat build PRODUKSI** (`next start -H 127.0.0.1 -p 3199`, port dipastikan KOSONG lebih dulu lewat `netstat`): **28 pemeriksaan lolos, 0 gagal**. Termasuk:

- `?jenis=sakit&kunci=SKS20260806001` -> **200 `text/html`**, tanpa `content-disposition` sama sekali, `content-security-policy: sandbox; default-src 'none'; style-src 'unsafe-inline'`, `cache-control: no-store, private`, `x-content-type-options: nosniff`; badannya memuat `SURAT KETERANGAN`, `No. Rekam Medis`, dan catatan kaki asal-usul; **tanpa satu pun `<script>`**.
- `&format=pdf` -> **200 `application/pdf`**, magic `%PDF-`, `content-disposition: inline` -- berkas sungguhannya tetap dilayani.
- **Waktu terukur: HTML 27 ms, PDF 1.030 ms** pada surat yang sama -- 38× lebih cepat, dan jalur HTML tidak meluncurkan Chromium sama sekali.
- Galat dijawab **HTML, bukan JSON**: kunci tak ada -> 404 `text/html` yang menyebut "tidak ditemukan" (bukan `{"error":...}` mentah); `jenis` ngawur -> 400.
- **Operator ditolak 403 pada KEDUA format**, dan badannya tidak memuat `No. Rekam Medis` -- pemeriksaan yang sama yang dulu menangkap bug `requireRole()`, dijalankan ulang atas cabang baru. Tanpa sesi -> ditolak.
- Halaman `/administrasi` **tidak lagi memuat `href="/administrasi/pratinjau`** -- membuktikan tautan lamanya benar-benar hilang, bukan tertimpa.

**Uji peramban** (Puppeteer headless, sesi login sungguhan): **22 pemeriksaan lolos, 0 gagal**. Yang paling menentukan: `Browser.setDownloadBehavior` diarahkan ke direktori sementara dan `Browser.downloadWillBegin` disadap -- sesudah menekan **Lihat**, **nol unduhan terpicu dan direktorinya tetap kosong**. Selain itu: `<dialog>` ada di DOM dalam keadaan tertutup lalu terbuka setelah diklik; iframe-nya menunjuk route pratinjau **tanpa `format=pdf`**, ber-`sandbox=""`, punya `title`, lebar **794 px persis**, dan `opacity` mencapai 1 (selesai dimuat); isi surat terbaca dari dalam bingkainya (`SURAT KETERANGAN`, `No. Rekam Medis`); tautan "Buka berkas PDF" membawa `format=pdf`; tombol Kirim dan Tutup ada di dalam modal; **Esc menutup DAN modalnya bisa dibuka lagi sesudahnya** -- yang membuktikan event `cancel` menyinkronkan balik ke state React.

**Rename `wide` -> `size` dibuktikan tidak mengubah lebar yang sudah ada**: modal `/template` dan `/balasan-otomatis` sama-sama masih `max-w-2xl` dan tidak ikut jadi `max-w-4xl`; pratinjau surat `max-w-4xl`. **5 pemeriksaan lolos, 0 gagal.**

**Yang sengaja TIDAK ditekan**: tombol "Kirim ke pasien" di dalam modal. Worker PM2 sedang hidup, jadi menekannya berarti WhatsApp sungguhan ke nomor pasien sungguhan. Jalur kirimnya sendiri sudah dibuktikan end-to-end di seksi di atas (`outbox` id 25660); yang baru di sini cuma letak tombolnya.

**Pemeriksaan menyeluruh sesudah perubahan**: `npm test` **457 lolos (27 suite)**, `tsc --noEmit` bersih, `eslint` bersih, `next build` sukses. **Kebersihan**: kedua akun uji (`ujiadm`, `ujiops`) dihapus, ketiga skrip `.tmp-*.mjs` dihapus, server uji di 3199 dihentikan dan portnya diperiksa bebas.

**Yang TIDAK terbukti, dan sengaja dicatat sebagai tidak terbukti**: pengiriman surat SEHAT tidak pernah dijalankan sampai WhatsApp -- hanya PDF-nya yang dibuktikan terbentuk dan pratinjaunya lewat HTTP. Jalur enqueue-nya identik dengan surat sakit (satu fungsi `kirimSuratAction` yang sama, dibedakan satu parameter), tapi itu bukan hal yang sama dengan terbukti. Menjalankannya berarti menerbitkan surat keterangan sehat atas kunjungan pasien sungguhan, dan itu justru keputusan yang §"Yang masih perlu keputusan rumah sakit" nyatakan bukan milik kode.

### Logo dan QR pengesahan pada surat

**Bentuknya dibaca dari sumber Khanza, bukan dikarang.** `rptSuratSakit5.jrxml` dan `rptSuratSehat.jrxml` sama-sama punya parameter `logo` (`java.io.InputStream`, dipakai sebagai `imageExpression`, `70x70` di `x=0,y=0`) dan satu `componentElement` berisi `jr:QRCode errorCorrectionLevel="H"` yang `codeExpression`-nya `$P{finger}`. **`finger` TIDAK PERNAH dicetak sebagai teks** -- `grep` atas jrxml-nya menemukannya persis dua kali: deklarasi parameter, dan `codeExpression`. Susunan teksnya diambil dari `SuratSakit.java:923`.

**Dua fakta yang menentukan keputusan, keduanya diukur bukan diasumsikan**: `setting.logo` berisi **75.482 byte** ber-magic `89504E47` (PNG) berukuran **1050x1050**; tabel `sidikjari` berisi **0 baris**, sehingga `finger.equals("")?kodedokter:finger` milik Khanza sedang mencetak kode dokter -- yang berarti QR di sini dan QR Khanza saat ini identik isinya.

**Uji unit**: `npm test` **469 lolos (27 suite)**, naik dari 457 -- 12 tes baru untuk `mimeGambar` (PNG/JPEG/GIF/BMP/WebP dikenali, RIFF-non-WebP dan isi tak dikenal -> `null`), `formatTanggalRingkas` (termasuk `'0000-00-00'` -> kosong), `teksAsalUsul` (susunan Khanza persis, baris kosong dibuang alih-alih mencetak label menggantung, **tidak pernah memuat nama pasien / no. RM / no. surat**), dan `renderSuratHtml` tanpa logo/QR.

**Uji terhadap surat NYATA** (`SKS20260806001` di `alca`, lewat `muatSurat` -> `suratKeHtml` -> `htmlKePdf` yang sama dipakai produksi): **14 pemeriksaan lolos, 0 gagal**.

- Logo dan QR keduanya tertanam sebagai `data:` URI; kop ditandai `class="kop berlogo"`.
- **QR-nya benar-benar menyandikan teks yang dimaksud**, dibuktikan dengan menyandikan ulang `teksAsalUsul()` memakai opsi yang sama dan membandingkan data URI-nya -- **sama persis**. Isinya: `Dikeluarkan di ... , Kabupaten/Kota ...` / `Ditandatangani secara elektronik oleh ...` / `ID ...` / `06-08-2026`, dan **tidak memuat nama pasien maupun no. RM**.
- **Chromium benar-benar MENDEKODE keduanya**, bukan sekadar memuat tagnya: `naturalWidth` 1050x1050 (logo) dan 584x584 (QR). Tag `<img>` yang rusak menghasilkan halaman yang mustahil dibedakan lewat pemeriksaan string, jadi ini pemeriksaan yang tidak bisa dilewati.
- **Teks kop tidak menabrak logo**: tepi kanan logo di 151 px, tulisan mulai di 163 px.
- **PDF memuat 3 XObject `/Image`** dan diawali `%PDF-`. *(`strings` atas PDF-nya menemukan 0 penanda `/Image` -- objeknya terkompresi; itu sebabnya bukti diambil dari Chromium dan dari jumlah XObject, bukan dari grep.)*
- **Tanpa logo dan tanpa QR surat tetap utuh**: tidak ada `<img>` sama sekali, judul dan blok tanda tangan tetap ada, dan PDF-nya tetap terbentuk (**72.739 byte**).

**Akibat ukuran, dicatat sebagai konsekuensi yang diterima**: PDF per surat **72.739 -> 190.626 byte**. Logonya 1050x1050 sementara ditampilkan 76 px; mengecilkannya menuntut paket pengolah gambar baru, ditolak dengan alasan yang sama seperti `pdfkit`/`pdf-lib`.

**Uji HTTP lewat build PRODUKSI** (`next start -H 127.0.0.1 -p 3197`, port dipastikan KOSONG lebih dulu): **12 pemeriksaan lolos, 0 gagal**. Ini yang tidak bisa digantikan uji mana pun di atas -- `page.setContent()` tidak mengirim satu pun header, jadi ia sama sekali tidak menyentuh CSP.

- `content-security-policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:` -- **`data:` saja**, diperiksa eksplisit TIDAK memuat `img-src *` maupun `https:`.
- **Kedua gambar terdekode di peramban sungguhan di bawah header itu** (1050x1050 dan 584x584) dan **nol pelanggaran CSP di konsol**. Kalau `img-src` salah tulis, logonya diblokir HANYA di pratinjau dashboard sementara PDF tetap benar -- kegagalan yang mustahil terlihat tanpa uji ini.
- `&format=pdf` tetap `application/pdf`; HTML tetap `text/html`.

**Pemeriksaan menyeluruh**: `tsc --noEmit` bersih, `eslint` bersih, `next build` sukses, `verify:plans` lolos (`ADMINISTRASI_SURAT_SAKIT`/`_SEHAT` tidak berubah jalur aksesnya walau `d.kd_dokter` ikut di-SELECT), `verify:db` lolos (`sik` tetap menolak tulisan). **Kebersihan**: akun uji `cekqr` dihapus, kedua skrip `.tmp-*` dan direktori `tmp-dryrun-surat/` dihapus, server 3197 dihentikan dan portnya diperiksa bebas.

**Tiga kegagalan selama verifikasi, ketiganya kegagalan UJI bukan kegagalan produk** -- dicatat karena ketiganya bentuk yang sama dan gampang "diperbaiki" ke arah yang salah:

1. **Backtick di dalam komentar CSS.** Blok gaya di `core/suratHtml.ts` ada di dalam template literal JS, jadi backtick di komentarnya menutup stringnya -- galatnya muncul sebagai `TS1005` yang menunjuk baris lain.
2. **Asersi `not.toContain('berlogo')` gagal walau kelasnya benar**: kata itu selalu ada di dalam blok `<style>` sebagai nama kelas. Diperbaiki jadi memeriksa `class="kop"`. Persis jebakan yang sudah tercatat di §`/farmasi` dipecah jadi TAB.
3. **Pagar anti-build-lama dipasang SEBELUM login**, padahal `proxy.ts` menjawab 307 ke `/login` sehingga permintaannya tidak pernah sampai ke route yang memasang headernya. Terbaca sebagai "build lama menjawab" atas build yang justru baru.

## Kelas kesepuluh: SURAT SAKIT OTOMATIS (`migrations/027`) -- berkas yang berangkat tanpa dilihat siapa pun

**Bentuk tabelnya dibuktikan, dan itu yang memaksa kelas pemicunya.** `SHOW CREATE TABLE alca.suratsakit` -> tepat lima kolom (`no_surat`, `no_rawat`, `tanggalawal`, `tanggalakhir`, `lamasakit`), PK `no_surat`, KEY `no_rawat`, **tidak satu pun kolom tanggal/waktu penyimpanan**. Jadi watermark tidak punya apa pun untuk dipegang -- bukan penilaian desain, melainkan keadaan tabelnya.

**Tanggal di `no_surat` BUKAN penanda kejadian yang andal -- diukur, dan sumbernya dibaca.** `src/surat/SuratSakit.java` baris 1209-1210 merakit prefiksnya lewat `Valid.autoNomer3(...)` dari isi kotak **`TanggalAwal`** pada saat nomor dibuatkan. Diukur atas 18 baris di `alca`:

| dibandingkan dengan | cocok |
|---|---|
| `tanggalawal` | 13 / 18 |
| `reg_periksa.tgl_registrasi` | 15 / 18 |

Tidak andal keduanya -- ada baris yang cocok dengan NEITHER (`SKS20240819001`: kunjungan 2024-08-16, `tanggalawal` 2024-08-16, nomor bertanggal 0819). Selisih `tanggalawal` terhadap tanggal kunjungan terentang **0 sampai 6 hari** (`MIN`/`MAX(DATEDIFF)`). Itu yang membuat batas ATAS jendela harus melewati hari ini, dan yang membuat watermark akan melewatkan surat secara permanen.

**Rencana query** (`npm run verify:plans`, lolos): `ADMINISTRASI_SURAT_SAKIT_OTOMATIS` didaftarkan dengan diagnosa MENYALA (bentuk termahal) -> `ss range PRIMARY rows~1`, ketujuh join identitas `eq_ref PRIMARY`, sub-query diagnosa `dp ref PRIMARY` + `pny eq_ref PRIMARY`. **Tanpa satu pun izin pindai penuh**, dan memang tidak dibutuhkan.

**Pipeline dijalankan SUNGGUHAN, bukan ditiru.** Fungsi produksi `runSuratOtomatisCycle()` dipanggil terhadap `alca` + `wakhanza` nyata atas fixture sekali pakai (`TESTWA00099` / `2026/08/07/099099` / `SKS20260807099`, bernomor telepon uji milik pengembang). Sebelum fixture dibuat, `SELECT no_surat FROM alca.suratsakit WHERE no_surat >= 'SKS20260807000'` dipastikan **nol baris** -- jadi tidak ada surat pasien sungguhan yang bisa ikut terbaca oleh jendela uji.

```
sejak = "2026-08-07"
surat dirender jadi PDF   bytes=191726 durasiMs=630
siklus surat sakit otomatis selesai  dari=2026-08-07 sampai=2026-08-14 terbaca=1 baru=1 terkirim=1
outbox 29316  status=sent  attempts=1  phone=628****2916
              media=5330d38b7bd89442.pdf  mediaName=Surat-Keterangan-Sakit-PASIEN-UJI-OTOMATIS.pdf
```

Jendelanya terbukti merentang **ke dua arah** (`dari=2026-08-07 sampai=2026-08-14`) dengan batas bawah dijepit lantai aktivasi.

**Dedup dibuktikan pada siklus KEDUA tanpa perubahan apa pun**: `baris SURAT_SAKIT sebelum=1 sesudah=1`. Tidak ada watermark yang terlibat -- yang menahannya kunci idempoten.

**Lantai aktivasi dibuktikan dengan menggesernya**: `administrasi.auto_sejak` diubah ke `2026-08-08` (besok) atas surat bertanggal hari ini -> `sebelum=0 sesudah=0`. Surat di bawah lantai tidak terbaca sama sekali, bukan terbaca lalu ditolak.

**WORKER-nya sendiri yang mengerjakannya, bukan hanya fungsinya dipanggil dari skrip.** Sesudah `pm2 restart wakhanza-worker` (satu kali; sesi kembali `ready`, heartbeat 9 detik), baris outbox lahir dari siklus worker sendiri -- pid **7824**, bukan pid skrip:

```
{"pid":7824,"bytes":191726,"durasiMs":1259,"msg":"surat dirender jadi PDF"}
{"pid":7824,"dari":"2026-08-07","sampai":"2026-08-14","terbaca":1,"baru":1,"terkirim":1,
 "msg":"siklus surat sakit otomatis selesai"}
{"pid":7824,"triggerCode":"SURAT_SAKIT","tujuan":"628****2916@c.us","berlampiran":true,"msg":"pesan terkirim"}
```

outbox 29320: dibuat **06:49:24**, terkirim **06:49:28**, `attempts=1`. Nomor tujuan **tersamarkan** di log (§9.7).

**Jejak audit** (`audit_log`, insert-only): `system:surat_otomatis | administrasi_kirim_otomatis | sakit:SKS20260807099 | rm=TESTWA00099 diagnosa=tidak pdf=191726B`. Aktornya sengaja berbeda dari username staf, dan aksinya berbeda dari `administrasi_kirim` manual -- dua kanal harus bisa dipisahkan di `/audit`.

**Pemisahan kebijakan dipatok unit test BERPASANGAN**, karena yang perlu dijaga bukan nilai masing-masing melainkan bahwa keduanya berbeda:

- `optOut.test.ts`: `respectsOptOut('SURAT_SAKIT') === true` DAN `respectsOptOut('ADMINISTRASI') === false`; `optOutTriggerCodes()` panjangnya **11**.
- `quietHours.test.ts`: pada 22:30 dengan jam tenang 21-7, `ADMINISTRASI` -> `event_at` apa adanya, `SURAT_SAKIT` -> **ditunda ke 07:00 hari berikutnya**.

*(Jam tenang di mesin ini disetel `dispatch.quiet_hours_start=23` / `end=0`, jadi pengiriman uji pukul 06:47 memang di luar jam tenang -- perilaku itu tidak bisa dibuktikan dari kiriman nyata, dan karena itu dibuktikan pada fungsi murninya.)*

**Keputusan murninya diuji terpisah** (`suratOtomatis.test.ts`, 15 kasus): urutan pemeriksaan, `masuk = kirim + lewat` selalu genap, surat yang ditolak **tidak memakan jatah kuota**, kuota 0 tidak melempar, jendela menyeberangi pergantian bulan dan tahun, dan lantai aktivasi yang sudah lampau tidak mempersempit apa pun.

**Satu jebakan ditemukan saat menulis, sebelum sempat jadi bug**: bentuk pertama fungsi keputusannya membaca `pasien.no_tlp` lewat `normalizePhone()`. `resolvePhone()` mendahulukan koreksi manual dari `/nomor-bermasalah` (F2.1-F2.3), jadi bentuk itu akan menolak persis pasien yang nomornya sudah dibetulkan petugas -- dengan 40% nomor tak terpakai di rumah sakit ini, itu bukan kasus pinggiran. Diperbaiki dengan memindahkan penyelesaian nomor ke pemanggil dan memaksanya lewat TIPE (`KandidatSurat.phoneE164`), sehingga fungsi keputusannya tidak punya jalan membaca `no_tlp` sendiri.

**Satu uji lama GAGAL dan itu benar**: `optOut.test.ts` mematok `optOutTriggerCodes()` sepanjang 10, jadi menambahkan pemicu memaksa keputusannya diambil sadar-sadar alih-alih lolos diam-diam. Diperbarui berikut asersi pasangannya.

**Pemeriksaan menyeluruh**: `npm test` **486 lolos / 28 suite**, `tsc --noEmit` bersih, `eslint` bersih, `next build` sukses (exit 0), `verify:plans` lolos, `verify:db` lolos (`sik` tetap menolak tulisan, `audit_log` tetap append-only).

**Kebersihan**: fixture `TESTWA00099` + `reg_periksa` + `suratsakit` dihapus dari `alca` (diperiksa: 0 sisa), baris `outbox` SURAT_SAKIT dan `patient_contact` uji dihapus, kedua berkas PDF dihapus dari `uploads/broadcast/`, skrip sementara dihapus, dan **`administrasi.auto_enabled` dikembalikan ke `0`** -- menyalakannya adalah keputusan rumah sakit, bukan efek samping verifikasi.
