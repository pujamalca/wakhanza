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

## Kata tanya ketersediaan, dan jawaban ringkas untuk nomor umum (`migrations/039`)

**Tabrakan yang melahirkan seluruh rancangannya DIUKUR lebih dulu, bukan dikira.** Katalog `alca` (880 barang aktif) dicocokkan terhadap kata-kata yang muncul di aturan `/balasan-otomatis` yang sedang aktif: `poli` → **2 barang** cocok `nama_brng LIKE '%poli%'`, `apa` → 10, `ada` → 1, `hari` → 1; `jadwal`/`dokter`/`praktek`/`layanan`/`alamat`/`lokasi`/`telepon`/`jaga` → 0. Angka 2 pada `poli` itulah yang membuktikan pagar "lepas bila obat tak ketemu" TIDAK cukup sendirian -- pada "ada poli apa" obatnya justru ketemu -- dan karena itu pagar kedua (aturan `/balasan-otomatis` menang) ada.

**Perutean dibuktikan atas 11 kalimat lewat `npm run dryrun:stok`**, yang memanggil `susunJawabanStok()` berikut pemeriksa aturan yang SAMA dipakai worker, terhadap `alca`/`wakhanza` sungguhan:

| Pertanyaan | Hasil |
|---|---|
| `apotek adakah obat paracetamol` | dijawab -- 4 barang, cari `paracetamol` |
| `ada paracetamol?` | dijawab |
| `jual obat amlodipin tidak` | dijawab -- cari `amlodipin`, 5 dari 6 cocok |
| `ready paracetamol ga` | dijawab |
| `stok paracetamol` / `berapa harga paracetamol` | dijawab (golongan ketat, tak berubah) |
| `adakah obat <nama karangan>` | **dilepas** -- `ketersediaan_tak_ketemu` |
| `ada poli apa` | **dilepas** -- `aturan_menang` (cari `poli`) |
| `ada dokter jaga hari ini` | **dilepas** -- `ketersediaan_tak_ketemu` (cari `dokter jaga`) |
| `jadwal dokter` | **dilepas** -- `bukan_pertanyaan_stok` |
| `apotek` (tanpa nama obat) | **dilepas** -- `ketersediaan_tanpa_nama` |

Bentuk jawabannya juga dibuktikan berdampingan pada tiap kalimat: `[petugas]` menyebut `sisa 187 Tablet — Rp500` berikut `(habis)` pada yang nol, `[umum]` menyebut `• <nama> — tersedia` / `• <nama> — kosong` saja -- tanpa satu pun angka rupiah, angka sisa, satuan, maupun tanda `(menipis)`.

**Dua hal ditemukan oleh uji, bukan oleh pembacaan kode.** (1) `jual obat amlodipin tidak` semula menyisakan `amlodipin tidak` sebagai satu pola `LIKE` dan tidak pernah cocok -- kata ingkar (`tidak`, `nggak`, `ga`, ...) karena itu masuk `KATA_PENGAPIT`; tanpa itu golongan barunya meleset justru pada bentuk "X ada tidak?" yang paling sering. (2) `ada paracetamol?` meleset selama `ada` polos masih dikecualikan, dan itu yang menuntut pagar kedua dibangun alih-alih membuang katanya.

**Gerbang penuh**: `npx jest` **40 suite / 680 uji** lolos (dari 667; `stokObat.test.ts` 23 → 39, termasuk asersi bahwa nama obat berisi baris baru tidak bisa menyisipkan barisnya sendiri pada cabang `ringkas` yang merakit barisnya SENDIRI), `tsc --noEmit` bersih, `eslint` bersih, `verify:plans` lolos, `verify:db` lolos (`sik` tulis DITOLAK), `npm run build` berhasil dan penanda teks barunya terbukti ada di `.next/server`.

**Pemasangan**: `pm2 restart wakhanza-web` (`/login` HTTP 200, `/farmasi?tab=stok` 307 ke login = pagar peran tegak), lalu worker lewat prosedur tiga langkah -- `pm2 stop` → Chromium pemegang sesi tersisa **nol** → `pm2 start`. Penghitung restart worker tetap **8**, tanpa kaskade; sesi kembali `ready` dengan umur denyut **12 detik** dan `last_error` kosong, dibaca lewat Sequelize (bukan `NOW()` SQL, yang melebihkan 25.200 detik).

**Yang TIDAK diubah, sengaja**: `farmasi.stok_mode` tetap `petugas`. Membuka jawaban untuk nomor umum adalah keputusan rumah sakit, dan pemilik sistem memilih menyiapkannya dulu -- jadi bentuk `[umum]` di atas terbukti benar tanpa satu pun nomor asing pernah dijawab. Tidak ada pesan WhatsApp yang dikirim selama verifikasi ini.

**Sesudah verifikasi, pemilik sistem menyalakannya sendiri lewat dashboard** (`farmasi.stok_mode` = `semua`, `farmasi.stok_rincian_umum` tetap `ringkas`), dan jalurnya terbukti hidup end-to-end di produksi: empat baris `outbox` berkode `AUTO_REPLY` berstatus `sent` -- japri menerima `Informasi ketersediaan obat di ...` (bentuk ringkas, tanpa satu angka pun), grup apotek yang terdaftar `boleh_tanya` menerima `Informasi obat di ...` (bentuk penuh). Jadi keputusan (a) di CLAUDE.md sudah diambil RS; yang masih bawaan (b).

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

### Bot Telegram + alasan kegagalan yang menyebut sebabnya (10 Agustus 2026)

**Bentuk URL-nya diukur langsung terhadap `api.telegram.org`, bukan dibaca dari dokumentasi.** Empat probe, dan yang membuktikan bukan keberhasilannya melainkan BEDA GALATNYA:

```
POST bot<token>                          -> HTTP 404  {"description":"Not Found"}
POST bot<token>/sendMessage              -> HTTP 400  "Bad Request: chat_id is empty"
POST bot<token>/sendMessage?chat_id=999… -> HTTP 400  "Bad Request: chat not found"
POST bot<token>/sendMessage?chat_id=<sah> -> HTTP 200 terkirim
```

Baris ketiga itu intinya: `chat not found` (bukan `chat_id is empty`) membuktikan Telegram **membaca query string walau body-nya JSON**, dan itu yang membuat `chat_id` bisa tinggal di URL alih-alih memaksa cabang payload per-tujuan. Field asing kita (`kind`, `message`, `detail`, `host`, `at`) ikut di body pada keempatnya dan tidak pernah ditolak -- Telegram mengabaikan parameter yang tidak dikenalnya.

`getMe` atas URL bot telanjang **berhasil**, dan itu jebakannya: ia membuktikan tokennya sah, bukan bahwa URL-nya bisa dikirimi. Kejadian nyata yang melahirkan seluruh perubahan ini adalah `alert.webhook_url` diisi bentuk itu, tombol uji menjawab "Gagal terkirim", dan HTTP 404 yang menjawabnya tidak pernah sampai ke layar.

**Alasan kegagalan dibuktikan lewat `sendAlert()` SUNGGUHAN** (skrip sekali pakai terhadap database `wakhanza`, bukan curl), keempat keadaan berturut-turut, dan nilai yang ditinggalkan dipaksa benar lewat `finally`:

```
[SALAH -- tanpa /sendMessage] terkirim:false
  HTTP 404 -- URL-nya tidak menunjuk endpoint apa pun. ... ekornya wajib "/sendMessage" ...
  Jawaban penerima: {"ok":false,"error_code":404,"description":"Not Found"}
[SALAH -- tanpa chat_id]      terkirim:false
  HTTP 400 -- ... sebabnya hampir selalu "?chat_id=<id>" belum ada di URL.
  Jawaban penerima: {"ok":false,"error_code":400,"description":"Bad Request: chat_id is empty"}
[SALAH -- host tidak ada]     terkirim:false
  Tidak sampai ke penerimanya sama sekali (nama domain, firewall keluar, TLS, atau lewat batas 10 detik).
[BENAR]                       terkirim:true, alasan kosong
nilai tersimpan sesudah uji sama dengan bentuk yang benar: true
```

Skripnya menerima token lewat variabel lingkungan dan mencetak URL tersamar (`bot<token>`) -- rahasianya tidak pernah mendarat di disk dalam repositori publik ini, dan berkas `.tmp-*` dihapus sesudahnya.

**17 unit test `core/alertError.test.ts`, dibuktikan MENGGIGIT dua arah** dengan merusak implementasinya sengaja, bukan diasumsikan:

| Yang dirusak | Yang gagal |
|---|---|
| urutan sensor/potong dibalik (potong dulu, sensor belakangan) | 1 dari 17 -- tepat uji "token persis di garis potong" |
| `sensorRahasia()` dimatikan seluruhnya | 2 dari 17 -- kedua uji penyensoran |

Uji "token di ekor teks panjang" versi pertama **tidak menggigit** dan diperbaiki: tokennya jatuh di luar 200 karakter sehingga hilang oleh pemotongan bahkan tanpa penyensoran. Diganti dengan token yang dimulai tepat sebelum batas, sehingga yang diuji benar-benar URUTANNYA.

**Gerbang penuh**: `npx jest` 40 suite / 667 uji lolos (dari 650), `tsc --noEmit` bersih, `eslint` bersih, `npm run build` berhasil dan penanda teks barunya terbukti ada di `.next/server`.

**Jalur UI-nya dikonfirmasi pemilik sistem sesudah pemasangan**: tombol "Kirim peringatan uji" di `/pengaturan` ditekan lewat dashboard sungguhan, menampilkan "Terkirim", dan pesannya benar-benar masuk ke Telegram. Itu menutup satu-satunya sambungan yang tidak bisa dibuktikan dari sisi skrip -- pembungkus Server Action (`requireRole` + `logAudit`) dan tampilannya -- karena membuktikannya sendiri menuntut membuat akun admin sementara di sistem yang memegang data pasien.

**Pemasangan**: `pm2 restart wakhanza-web` (`/login` -> HTTP 200), lalu worker lewat prosedur tiga langkah -- `pm2 stop` -> Chromium pemegang sesi tersisa **nol** -> `pm2 start`. Penghitung restart worker tetap 8, tanpa kaskade; `WhatsApp siap` ~3 detik sesudah start. Kesehatannya diperiksa lewat **umur denyut** dibaca Sequelize (bukan `NOW()` SQL, yang melebihkan 25.200 detik): `ready`, denyut 10 detik, `last_error` kosong.

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

## Kelas kesebelas: PENGADAAN (`/farmasi`, migrations/028) -- nota pembelian, dan tabelnya tanpa jam

**Kelas pemicunya dipaksa bentuk tabel, dan itu dibuktikan dari skema plus sumber Khanza -- bukan disimpulkan dari nama kolom.** `SHOW CREATE TABLE pembelian` menunjukkan sebelas kolom dan **tidak satu pun bertipe waktu**; yang ada `tgl_beli` bertipe `date`. `DlgPembelian.java:1759` menunjukkan tanggal itu berasal dari kotak yang dipilih staf, bukan dari jam server. Watermark karena itu mustahil benar -> kelas PINDAI.

**Arah prefiks `no_faktur` DIUKUR atas seluruh 910 baris**, dan nol pada salah satu arah itulah yang menentukan artinya:

```
prefix_lebih_maju  prefix_lebih_mundur  maks_maju_hari
9                  0                    31
```

Nol pada arah mundur = alurnya selalu "nomor dibuatkan hari ini, lalu `tgl_beli` digeser mundur ke tanggal nota pemasok". Jadi prefiksnya penanda **kapan dimasukkan** -- yang memang dibutuhkan pemicu -- sementara `tgl_beli` adalah tanggal notanya. Pola `PG`+YYYYMMDD+3 digit cocok pada **910/910**, dan tanggal di dalamnya cocok dengan `tgl_beli` pada **901/910**.

**`riwayat_barang_medis` ditolak lewat dua pengukuran, bukan lewat selera.** Ia punya `tanggal` DATE + `jam` TIME dan `posisi='Pengadaan'` -- waktu kejadian yang tidak dipunyai `pembelian`. Tapi: `SHOW CREATE TABLE` menunjukkan satu-satunya kunci adalah `kode_brng` dan `kd_bangsal` (jadi penyaringan waktu = pemindaian penuh atas **114.092** baris, 58.664 di antaranya dari pemberian obat), dan `SUM(no_faktur='')` atas 5.374 baris `Pengadaan` menjawab **5.374** -- kolom penautnya kosong seluruhnya, karena cabang non-batch `DlgPembelian.java:998` meneruskan `no_faktur=""`.

**Rencana query lolos tanpa satu pun izin pindai penuh:**

```
[ok] FARMASI_PENGADAAN    b range PRIMARY  rows~9
[ok] FARMASI_PENGADAAN    s eq_ref PRIMARY  rows~1
[ok] FARMASI_PENGADAAN    pt eq_ref PRIMARY  rows~1
[ok] FARMASI_PENGADAAN    g eq_ref PRIMARY  rows~1
[ok] FARMASI_PENGADAAN_DETAIL d ref no_faktur  rows~3  (Using index)
[ok] FARMASI_PENGADAAN_DETAIL_HARGA d ref no_faktur  rows~3  (Using index)
```

**Sakelar harga ditegakkan di QUERY, dan dibuktikan pada objek barisnya** -- bukan dengan membaca SQL:

```
harga=IKUT   kunci baris detail: no_faktur, kode_brng, nama_brng, satuan, jumlah, h_beli, total
harga=TIDAK  kunci baris detail: no_faktur, kode_brng, nama_brng, satuan, jumlah
```

**`kadaluarsa` tidak diambil, dan alasannya terukur**: dari 1.257 baris detail sepanjang 2026, **251 sudah lewat pada hari barangnya dibeli** (1.006 wajar, 0 kosong).

**Jam tenang nyaris tidak relevan di sini, dan itu juga diukur**: sebaran jam simpan dari `riwayat_barang_medis` berhenti di jam **20**, tidak satu pun faktur tersimpan sesudahnya (puncaknya 11-15).

**Pengiriman SUNGGUHAN, ke nomor uji pengembang -- grup apotek nyata sengaja TIDAK dicentang:**

```
tujuan uji siap: id=20
sakelar dinyalakan, lantai aktivasi = 2026-08-07
baris outbox FARMASI_PENGADAAN: 0 -> 1
sesudah siklus KEDUA: 1 (idempoten OK)
siklus pengadaan selesai  dari:2026-08-07 sampai:2026-08-14 terbaca:1 baru:1 terkirim:1 tujuan:1
```

`terbaca: 1` membuktikan **lantai aktivasi bekerja** -- jendelanya berisi 9 faktur, tapi lantai hari ini memangkasnya ke satu. Siklus kedua tidak menambah baris = idempotensinya tegak tanpa mengandalkan `uq_idem`.

```
          id: 30091
      status: sent
     chat_id: 6282283082916@c.us
    attempts: 1
  dibuat_wib: 2026-08-07 18:41:29
terkirim_wib: 2026-08-07 18:41:33
```

Isi yang benar-benar terkirim (dibaca lewat Sequelize; konsol `mysql` merusak UTF-8):

```
*Pengadaan Barang Medis*
«nama RS»

No. Faktur : PG20260807001
Tanggal : 07-08-2026
Pemasok : «nama pemasok»
Gudang : Apotek
Petugas : «nama petugas»

*Barang (3):*
• Easy Touch Strip Gula — 75 Botol @ Rp3.600 = Rp270.000
• Easy Touch Strip Kolesterol — 30 Botol @ Rp16.000 = Rp480.000
• Spuit 3 cc onemade — 100 Box/Dus/Kotak @ Rp2.000 = Rp200.000

Total : Rp950.000
Potongan : Rp0
PPN : Rp0
*Tagihan : Rp950.000*

Kode Pengiriman : 2026-08-07 18:41:29 Y1PW2C
```

Baris **Kode Pengiriman** membuktikan ia benar-benar lewat `enqueueMessage()` bersama, bukan jalur kedua.

**Satu bug ditemukan unit test, bukan diperkirakan**: `formatRupiah(null)` mengembalikan `"Rp0"`. `Number(null)` dan `Number('')` sama-sama `0` dan lolos `Number.isFinite`, jadi `h_beli` yang NULL akan tercetak sebagai harga **nol** -- bukan "tidak diketahui" melainkan "gratis", pada angka yang dipakai apotek mencocokkan nota pemasok. Diperbaiki lewat `keAngka()` yang menolak `null`/`undefined`/`''` sebelum `Number()` menyentuhnya.

**Grant kolom baru dibuktikan, bukan diasumsikan** -- `farmasi_target` sudah ber-grant dan kolom bukan tabel, jadi tidak ada `ERROR 1142` seperti pada lima tabel sebelumnya:

```
UPDATE farmasi_target SET terima_pengadaan = terima_pengadaan WHERE 1=0;
-> UPDATE kolom baru OK
```

**Verifikasi HTTP lewat build produksi di port sendiri (3199), 26 pemeriksaan SEMUA LOLOS** -- termasuk bahwa tab Pengadaan **tidak menawarkan** `{nama_pasien}` maupun `{no_rm}`, bahwa keempat centang tampil di satu kolom "Boleh / menerima", dan bahwa ketiga tab lama masih HTTP 200.

**Dua jebakan verifikasi, keduanya kegagalan UJI bukan kegagalan produk**, dan keduanya bentuk baru dari yang sudah tercatat:

1. **Server uji basi.** Pembacaan pertama menunjukkan `</span>Centang` tanpa spasi, dan bundel `.next` yang sama justru berisi anak `" "` -- yang menjawab adalah proses `next start` lama yang belum benar-benar mati. Sesudah dipastikan port 3199 kosong lalu dinyalakan ulang, HTML-nya benar. Pelajaran yang sama dengan dua listener pada §"Darurat stok", hanya sebabnya proses yang tidak jadi terbunuh alih-alih dua binding.
2. **Asersi menuntut dua text node bersebelahan.** React memisahkan dua anak teks dengan penanda `<!-- -->`, jadi `includes('</span> Centang')` GAGAL atas HTML yang benar (`</span> <!-- -->Centang`). Asersi yang mematok spasi wajib meloloskan penanda itu.

**Pemeriksaan menyeluruh**: `npm test` **507 lolos / 29 suite**, `tsc --noEmit` bersih, `eslint` bersih, `next build` sukses, `verify:plans` exit 0, `verify:db` lolos (`sik` tetap menolak tulisan, `audit_log` tetap append-only).

**Kebersihan**: tujuan uji dihapus (`farmasi_target` kembali 1 baris, `terima_pengadaan=0`), akun `verifikasi.pengadaan` dihapus, server uji port 3199 dihentikan, dan **`farmasi.pengadaan_enabled` dikembalikan ke `0`** -- menyalakannya adalah keputusan rumah sakit, bukan efek samping verifikasi. `farmasi.pengadaan_sejak` sengaja DIBIARKAN terisi: mengosongkannya saat mematikan berarti menyalakan kembali akan membongkar arsip, dan itu justru urutan tindakan yang paling wajar dilakukan orang yang sedang mencoba-coba.

## Kelas kedua belas: SURAT PEMESANAN (`/farmasi`, migrations/030) -- ujung yang lain dari pengadaan

**Sumbernya dibaca, bukan ditebak.** `inventory/InventorySuratPemesanan.java` (tombolnya `btnSuratPemesananMedis`, `frmUtama.java:5216` = "Surat Pemesanan Obat & BHP") menulis `surat_pemesanan_medis` + `detail_surat_pemesanan_medis`. `DlgPembelian.java:1810-1826` MEMBACA kedua tabel itu untuk mengisi layar pembelian -- itulah yang membuktikan pemicu ini pasangan PENGADAAN dari ujung yang lain, bukan salinannya, dan karena itu ia tidak boleh ikut memberitakan kedatangan.

**Prefiks tahun DUA digit, dibuktikan dari sumber Khanza dan dari data.** `InventorySuratPemesanan.java:1677` merakitnya sebagai `"SPM" + substring(8,10) + substring(3,5) + substring(0,2)` atas kotak `dd-MM-yyyy` -> `SPM` + `YYMMDD` + 3 digit. Cocok dengan data (`SPM230610001` = 2023-06-10). Menyalin bentuk `PG`/`HO` (`YYYYMMDD`) menghasilkan `SPM20260807000` yang leksikal DI ATAS seluruh `SPM26...` -> nol baris selamanya, tanpa galat.

**Arah prefiks vs `tanggal` diukur atas 109 baris di enam database** (`sik` 10, `sik-dev` 19, `sik-dev-alca` 14, `sik-ridda-dev` 40, `alca-dev` 18, `sik05112026` 8): **0 maju, 0 mundur** -- cocok seluruhnya. Sebabnya terlihat di `Valid.autoNomer3`-nya, yang query urutannya sendiri menyaring `WHERE tanggal = <tanggal terpilih>`. Jendela tetap dua arah karena mekanismenya masih mengizinkan penyimpangan. Diulang lewat jalur produksi di `dryrun:pemesanan`: `sik-dev-alca` **14 cocok / 0 berbeda**, `sik` **10 cocok / 0 berbeda**.

**`pegawai` vs `petugas` -- terukur, bukan dipilih.** Atas 40 baris `sik-ridda-dev`: `pegawai.nik` menyelesaikan **40/40**, `petugas.nip` **21/40**. Yang gagal termasuk `010101`, `08998998`, `D0000003`, `D0000004`. Terlihat langsung di keluaran dryrun -- `SRI WAHYUNI` (nip `08998998`) terender, dan ia salah satu yang `petugas` tidak bisa selesaikan. Sejalan dengan foreign key `surat_pemesanan_medis_ibfk_2` dan `InventoryVerifikasiPenerimaan.java:718`.

**`status` mutable dan reversibel**, dibuktikan dari sumber: `DlgCariSuratPemesanan.java:1212` menyetel 'Sudah Datang' (berpenjaga), `:1230` menyetelnya KEMBALI ke 'Proses Pesan' (**tanpa penjaga**). Karena itu ia tidak masuk kunci idempoten. Sebaran nyata: 88 'Sudah Datang', 15 'Proses Pesan', 0 NULL.

**Bentuk data yang menentukan dua keputusan:**

- **Header tanpa rincian**: arsip `sik` **9 dari 10**; empat database sehat **0 dari 91**. Karena itu dilewati, bukan dikirim sebagai nota kosong -- dan dibuktikan menyala: `dryrun:pemesanan -- sik` mencetak `SPM231011002 | 0 barang` -> `(tanpa satu baris rincian pun -- worker MELEWATI pesanan seperti ini)`.
- **`subtotal` vs `total`**: diskon baris terpakai pada **1 dari 122** baris `sik-ridda-dev`, dan pada baris itu pula keduanya berselisih. Yang dicetak `total`. Dipatok unit test tersendiri.
- **`jumlah2`**: sama persis dengan `jumlah` pada seluruh 122 baris -> tidak diambil.
- Rata 3,1 barang per pesanan, maksimal 8.

**Nota terbukti bisa dicocokkan sendiri** (dryrun `sik-dev-alca`, SPM260629001): 1.110.000 + 369.300 + 440.000 = **1.919.300** = Subtotal; + PPN 211.123 + Meterai 0 = **2.130.423** = Tagihan.

**Sakelar harga memutus KOLOMNYA, dibuktikan pada objek barisnya** -- bukan dengan membaca SQL. Menyala: `no_pemesanan, kode_brng, nama_brng, satuan, jumlah, h_pesan, total`. Mati: `no_pemesanan, kode_brng, nama_brng, satuan, jumlah` -- `h_pesan`/`total` **absen dari kunci**, sementara kelima angka header tetap terender.

**Rencana query**: `FARMASI_PEMESANAN` `p range PRIMARY` / `s eq_ref PRIMARY` / `pg eq_ref nik_2`; `FARMASI_PEMESANAN_DETAIL` dan `_DETAIL_HARGA` keduanya `d ref no_pemesanan (Using index)`. **Tanpa izin pindai penuh**, dan dibuktikan di kedua ujung ukuran -- `alca` (1 baris) maupun `sik-ridda-dev` (40/122) sama-sama `range PRIMARY`, justru keadaan yang membuat `sks` dan `permintaan_lab` gagal.

**Grant kolom baru TIDAK diperlukan**, dibuktikan empiris lewat `wakhanza_rw`: `UPDATE farmasi_target SET terima_pemesanan = terima_pemesanan WHERE 1=0` berhasil. Grant melekat pada TABEL, dan kolom bukan tabel.

**`information_schema.TABLE_ROWS` berbohong, dan itu sempat masuk dokumentasi.** `TABLE_ROWS` melaporkan **0** untuk `alca.surat_pemesanan_medis`; `COUNT(*)` menjawab **1** (SPM240327001, 27-03-2024, 'Proses Pesan', 1 rincian, 0 header tanpa rincian, prefiks cocok). Migrasi, halaman `/farmasi`, dan skrip dryrun sempat menyatakan tabelnya KOSONG atas dasar angka perkiraan itu. **Yang menemukannya bukan pembacaan ulang melainkan pratinjau dashboard**, yang merender nota sungguhan pada saat dokumentasinya masih menyatakan sebaliknya -- lalu keempat tempat itu dikoreksi. Konsekuensi baiknya: query-nya kini terbukti atas data produksi, bukan cuma salinan uji.

**Uji peramban: 21 dari 22 pemeriksaan lolos, dan yang ke-22 sengaja TIDAK diklaim lolos.** Yang lolos, terhadap build produksi lewat peramban sungguhan: tab muncul di bilah, callout "ujung yang lain dari Pengadaan" dan "tidak menyebut satu pun pasien" terender, sakelar default MATI, lantai aktivasi dikatakan sebelum ditekan, kelima variabel khas (`{no_pemesanan}` `{tgl_pemesanan}` `{status}` `{meterai}` `{tagihan}`) bisa disisipkan, `{nama_gudang}` dan variabel pasien TIDAK ditawarkan, pratinjau merender `Nota SPM240327001` berikut kelima angka penutup dan tanpa baris Gudang, centang keenam ada di tabel tujuan, keterangannya menyebut "Enam centang", dan tab lain tidak ikut merender isi tab ini.

**Yang ke-22 adalah judul callout ketiga**, dan statusnya harus dinyatakan apa adanya: asersinya GAGAL pada putaran terakhir yang benar-benar dijalankan, karena server uji basi (jebakan 2 di bawah). Sesudah judulnya dikoreksi dan build diulang, putaran keempat **tidak pernah dijalankan** -- pekerjaannya beralih ke instance PM2 atas permintaan pemilik sistem, dan akun uji sudah dihapus. Yang membuktikan koreksinya sampai ke produksi karena itu bukan peramban melainkan artefak build: `grep -rl "hampir tidak pernah dipakai" .next/server` menemukan `chunks/ssr/src_app_(dashboard)_farmasi_147p68f._.js`, dan instance PM2 dijalankan ulang atas build itu. Kedua puluh satu asersi lain tidak tersentuh perubahan tersebut -- yang berubah cuma satu string judul -- tapi keduanya diuji atas build sebelum koreksi, dan itu perbedaan yang layak dicatat alih-alih dibulatkan jadi "22/22".

**Tiga jebakan verifikasi, ketiganya kegagalan UJI bukan kegagalan produk:**

1. **Menunggu penanda pending HILANG, bukan hasil MUNCUL.** `waitForFunction(() => !text.includes('Membaca...'))` terpenuhi SEKETIKA -- transisi React ke "Membaca..." belum terjadi saat penantian dimulai, jadi asersinya membaca form yang belum bergerak. Bentuk baru dari jebakan `waitForFunction` yang sudah tercatat. Diperbaiki dengan menunggu salah satu dari SELURUH keadaan akhir yang mungkin, termasuk yang galat -- supaya penantiannya tidak pernah menutupi kegagalan sungguhan dengan timeout.
2. **`pkill -f "next start -p 3197"` TIDAK mematikan servernya** (npx melahirkan proses anak dengan baris perintah lain). Port tetap dipegang proses lama, seluruh uji berikutnya melawan build lama, dan 21 dari 22 asersi tetap hijau karena yang berubah cuma satu kalimat. Yang membocorkannya `Get-Process -Id 2112 | Select StartTime` (19:46, sebelum suntingan). Bentuk ketiga dari jebakan server basi yang sudah dua kali tercatat.
3. **Uji dijalankan dari direktori scratchpad** -> `ERR_MODULE_NOT_FOUND: puppeteer`. Skrip peramban harus jalan dari direktori proyek (`.tmp-*.mjs`, gitignored).

**Sejak sesi ini, verifikasi HTTP dijalankan lewat instance PM2, bukan port sendiri** -- atas permintaan pemilik sistem, karena instalasi ini berjalan di atas database produksi. Nasihat lama di CLAUDE.md yang berbunyi kebalikannya sudah dicabut, dan jebakan (2) di atas adalah biaya terakhir yang dibayarnya. Bukti untuk perubahan yang butuh login diambil dari `.next` hasil build (`grep -rl` atas penandanya menemukan `chunks/ssr/src_app_(dashboard)_farmasi_147p68f._.js`), bukan dengan membuat akun uji.

**Pemeriksaan menyeluruh**: `npm test` **538 lolos / 31 suite** (+13 di `pemesanan.test.ts`), `tsc --noEmit` bersih, `eslint` bersih, `next build` sukses, `verify:plans` exit 0, `verify:db` lolos (`sik` tetap menolak tulisan, `audit_log` tetap append-only), `npm run migrate` menerapkan `030_pemesanan.sql`.

**Kebersihan**: akun admin sementara `ujipemesanan` **dihapus** (`npm run users -- list` kembali 1 baris), berkas `.tmp-*.mjs` dihapus, tidak ada server uji tersisa (`netstat` bersih pada 3197/3199), `farmasi.pemesanan_harga` dikembalikan ke `1` setelah diuji dimatikan, dan **`farmasi.pemesanan_enabled` tetap `0`** -- menyalakannya keputusan rumah sakit, bukan efek samping verifikasi. Sesudah verifikasi: `pm2 restart wakhanza-web` lalu `wakhanza-worker` **sekali** (`wa_session` `ready`, umur heartbeat **1 detik**, log startup tanpa galat).

---

## Kelas ketiga belas: HIBAH (`/farmasi`, migrations/031) -- barang masuk tanpa pemasok

### Bentuk data dibaca dari sumber Khanza, bukan ditebak dari nama tabel

`src/inventory/InventoryHibahObatBHP.java` -- yang menentukan seluruh keputusannya:

```
:1386  Valid.autoNomer3(... , "HO"+TglBeli...substring(6,10)+substring(3,5)+substring(0,2), 3, NoFaktur)
       -> prefiks HO + YYYYMMDD, dirakit dari kotak Tanggal yang DIPILIH staf
       -> mekanisme identik dengan no_faktur pengadaan, sampai ke nama variabelnya (TglBeli)

:798   menyimpantf2("hibah_obat_bhp", 7 kolom)
       no_hibah, kode_pemberi, nip, tgl_hibah, totalhibah(ttl), totalnilai(ttl2), kd_bangsal

:64-65 nama kolom di layar Khanza:
       "Nilai Hibah(Rp)"  "Subttl Hibah(Rp)"  "Nilai Diakui(Rp)"  "Subttl Diakui(Rp)"
:547   "Total Nilai Hibah :"
:561   "Total Pengakuan Nilai Persediaan Hibah :"

:838-846  jurnal hanya bila ttl2 > 0:
          PERSEDIAAN HIBAH OBAT & BHP  <-> PENDAPATAN HIBAH
          -> totalnilai (dari h_diakui) yang masuk buku, BUKAN totalhibah
          -> itulah alasan nilai DIAKUI jadi angka utama tiap baris

:824   cabang non-batch: Trackobat.catatRiwayat(..., "Hibah", ..., "", "", ...)
       -> no_faktur diteruskan KOSONG, persis DlgPembelian.java:998
```

Skema, dan ketiadaan stempel waktu yang memaksa kelas PINDAI:

```
$ mysql -u root alca -e "SHOW CREATE TABLE hibah_obat_bhp\G"
  no_hibah      varchar(20) NOT NULL,      PRIMARY KEY (no_hibah)
  kode_pemberi  char(5) DEFAULT NULL,      -> NULLABLE (kd_bangsal NOT NULL)
  nip           varchar(20) DEFAULT NULL,
  tgl_hibah     date DEFAULT NULL,         -> DATE, dipilih staf; tidak ada kolom jam
  totalhibah    double NOT NULL,
  totalnilai    double NOT NULL,
  kd_bangsal    char(5) NOT NULL
```

### Tabelnya KOSONG di produksi -- diukur dengan COUNT(*), bukan TABLE_ROWS

Pelajaran 030 diterapkan sejak awal:

```
$ mysql -u root -N -e "SELECT table_schema, table_rows FROM information_schema.tables
                       WHERE table_name='hibah_obat_bhp';"
alca 0 . alca-dev 0 . ridda-dev 0 . sik 0 . sik05112026 0 . sik12062026 0
sik-dev 0 . sik-dev-alca 3 . sik-ridda-dev 3

$ mysql -u root alca -e "SELECT COUNT(*) FROM hibah_obat_bhp"     -> 0   (dikonfirmasi)
$ mysql -u root sik  -e "SELECT COUNT(*) FROM hibah_obat_bhp"     -> 0   (dikonfirmasi)
$ mysql -u root "sik-dev-alca"   -e "SELECT COUNT(*) ..."         -> 3
$ mysql -u root "sik-ridda-dev"  -e "SELECT COUNT(*) ..."         -> 3   (14 baris rincian total)
```

**Batas yang harus disebut apa adanya**: RAD_REQUEST-nya fitur ini. Query-nya terbukti atas
data sungguhan dari instalasi Khanza LAIN, tapi belum pernah berjalan atas satu baris pun
milik RS ini.

### Prefiks: diukur, dan pengukurannya diakui TIDAK cukup

```
$ mysql: DATEDIFF(prefix(no_hibah), tgl_hibah) atas seluruh 6 baris kedua database uji
HO20260604001 0 . HO20260625001 0 . HO20260702001 0
HO20250630001 0 . HO20250719001 0 . HO20251110001 0
```

Enam baris, semuanya nol. Berbeda dari pengadaan (910 baris: 9 maju / **0 mundur**), ini tidak
membuktikan arah penyimpangannya. Yang menopang keputusannya adalah kesamaan mekanismenya di
sumber Khanza; jendelanya tetap dua arah supaya penyimpangan yang mungkin sudah terjaring.

`riwayat_barang_medis` ditolak, dan di sini bahkan tidak punya barisnya:

```
$ mysql -u root alca -e "SELECT posisi, COUNT(*) n, SUM(no_faktur='') kosong
                         FROM riwayat_barang_medis GROUP BY posisi ORDER BY n DESC;"
Pemberian Obat 58683/58683 . Penjualan 29763/29763 . Opname 20261/20261
Pengadaan 5374/5374 . Retur Beli 30/30          <- TIDAK ADA posisi 'Hibah' sama sekali
```

### EXPLAIN: `range PRIMARY` bahkan pada tabel KOSONG

Justru inilah yang membedakannya dari `sks` dan `permintaan_lab`, yang perlu izin pindai penuh
sementara karena kolom pemangkasnya bukan PK. Query yang SAMA, dua database:

```
alca (0 baris)          h range PRIMARY rows~1 . pm/pt/g eq_ref PRIMARY rows~1
sik-dev-alca (3 baris)  h range PRIMARY rows~3 . pm/pt/g eq_ref PRIMARY rows~1
```

`npm run verify:plans` (exit 0), keempat pemeriksaan baru tanpa satu pun izin pindai penuh:

```
[ok] FARMASI_HIBAH        h range PRIMARY  rows~1
[ok] FARMASI_HIBAH        pm eq_ref PRIMARY  rows~1
[ok] FARMASI_HIBAH        pt eq_ref PRIMARY  rows~1
[ok] FARMASI_HIBAH        g  eq_ref PRIMARY  rows~1
[ok] FARMASI_HIBAH_DETAIL d ref PRIMARY  rows~1
[ok] FARMASI_HIBAH_DETAIL br eq_ref PRIMARY  rows~1
[ok] FARMASI_HIBAH_DETAIL sat eq_ref PRIMARY  rows~1
[ok] FARMASI_HIBAH_DETAIL_NILAI d ref PRIMARY  rows~1
[ok] FARMASI_HIBAH_DETAIL_NILAI br eq_ref PRIMARY  rows~1
[ok] FARMASI_HIBAH_DETAIL_NILAI sat eq_ref PRIMARY  rows~1
```

### Sakelar nilai: §5.2 dibuktikan pada Object.keys(), bukan dengan membaca SQL

```
$ npm run dryrun:hibah -- sik-dev-alca            # farmasi.hibah_nilai = 1
kolom header  : no_hibah, tgl_hibah, nama_pemberi, nama_petugas, nm_bangsal, totalhibah, totalnilai
kolom rincian : no_hibah, kode_brng, nama_brng, satuan, jumlah, h_hibah, h_diakui, subtotaldiakui

$ (farmasi.hibah_nilai = 0)
Nilai PER BARANG ikut dibaca: TIDAK  -- kedua total header selalu dibaca
  | . Cervarix Vaksin - 20 Box/Dus/Kotak
  | . Engerix B 0,5 ml Vaksin Bayi - 20 Ampul
  | Total nilai hibah : Rp40
  | *Nilai diakui : Rp40*
kolom header  : no_hibah, tgl_hibah, nama_pemberi, nama_petugas, nm_bangsal, totalhibah, totalnilai
kolom rincian : no_hibah, kode_brng, nama_brng, satuan, jumlah      <- h_* LENYAP
```

**Cacat yang ditemukan lewat keluaran ini, bukan lewat pembacaan ulang.** Versi pertama memutus
kedua total header juga, dan hasilnya:

```
  | Total nilai hibah :
  | *Nilai diakui : *
```

Dua baris label menggantung. Diperbaiki dengan mempersempit arti sakelarnya ke nilai PER BARANG
(padanan `{tagihan}` pada pengadaan), bukan dengan menyuruh staf ikut menyunting templatenya.

### Kiriman WhatsApp SUNGGUHAN

Keadaan saat verifikasi: pemilik sistem sudah menyalakan `farmasi.hibah_enabled` sendiri dari
dashboard (`audit_log` id 454, `puja`, 2026-08-07 20:00:10 WIB) dan mencentang `terima_hibah`
pada grup apotek SUNGGUHAN (id 452, 19:59:45). Karena itu siklusnya **tidak** dipakai untuk uji
kirim: skrip ujinya memanggil rantai fungsi produksi yang sama persis
(`pollHibahJendela` -> `ambilDetailHibah` -> `susunVarsHibah` -> `enqueueMessage`) dengan tujuan
dan jendela diserahkan langsung -- **nol tulisan ke `app_setting`, nol tulisan ke
`farmasi_target`**, dan data uji tidak pernah menyentuh grup apotek.

```
database Khanza : sik-dev-alca
tujuan uji      : 6282283082916@c.us  (grup apotek sungguhan TIDAK disentuh)
baris hibah terbaca: 3
memakai HO20260702001 (2 barang, 1 pesan)
baris outbox FARMASI_HIBAH: 0 -> 1
sesudah pengulangan : 1 (idempoten OK)

id: 31273  status: sent  chat_id: 6282283082916@c.us  attempts: 1  last_error: NULL
dibuat_wib: 2026-08-08 08:18:22   terkirim_wib: 2026-08-08 08:18:27
```

Isi pesan yang benar-benar terkirim (dibaca lewat Sequelize, bukan CLI `mysql`):

```
*Penerimaan Hibah Obat & BHP*
RS SIMRS KHANZA

No. Hibah : HO20260702001
Tanggal : 02-07-2026
Asal hibah : DINKES PROPINSI
Gudang : Apotek
Petugas : (nama petugas, disamarkan di berkas ini)

*Barang (2):*
. Amoxsan 500 mg - 1.000 Kapsul @ Rp4.029 = Rp4.029.000
. Amoxsan 500 mg - 1.000 Kapsul @ Rp6.839 = Rp6.839.000

Total nilai hibah : Rp10.868.000
*Nilai diakui : Rp10.868.000*

Kode Pengiriman : 2026-08-08 08:18:22 7C02Q5
```

(Butir aslinya memakai U+2022 dan U+2014; diganti di kutipan ini supaya berkas dokumentasi
tetap ASCII.) Baris kode pengiriman itu yang membuktikan ia lewat `enqueueMessage()` yang sama,
bukan jalur pintas. `nama_rs` berbunyi "RS SIMRS KHANZA" karena `getHospitalIdentity()` membaca
`setting` dari database uji yang sedang ditunjuk -- benar, bukan cacat.

### Jalur produksi apa adanya: nol baris, nol pesan

```
$ npx tsx <skrip> ; runHibahCycle() terhadap alca, pengaturan pemilik sistem tidak disentuh
database Khanza: alca
outbox FARMASI_HIBAH: 1 -> 1  (nol pesan baru, benar)
```

Sakelar menyala, tujuan tercentang, nol baris terbaca, nol pesan keluar -- persis yang akan
dilakukan worker.

### Siklusnya benar-benar terdaftar di worker yang berjalan

Jalur kosong sengaja SENYAP (`if (header.length === 0) return;`), jadi tidak ada baris log yang
bisa membuktikannya. Dibuktikan lewat satu-satunya keadaan yang memang berisik -- `terima_hibah`
dimatikan sebentar (aman: tabel sumbernya kosong, tidak ada pesan yang bisa terlewat), lalu
dikembalikan:

```
{"level":40,"time":1786152280377,"pid":8980,"hostname":"PMA",
 "msg":"hibah menyala tapi belum ada tujuan yang mencentang \"terima hibah\""}
```

`pid 8980` = worker BARU (sebelumnya 9664), jadi ia menjalankan kode yang baru ditulis.
Sesudahnya `terima_hibah` dikembalikan ke `1` dan seluruh barisnya diperiksa ulang:

```
id 15 . Apotek Alca . is_active 1 . boleh_tanya 1 . terima_darurat_stok 1
        terima_pengadaan 1 . terima_pemesanan 1 . terima_hibah 1
farmasi.hibah_enabled 1 . hibah_lookback_hari 7 . hibah_max_per_siklus 5
farmasi.hibah_nilai 1 . hibah_sejak 2026-08-07
```

### Verifikasi HTTP -- lewat instance PM2 (port 3100), 34 pemeriksaan

Pagar anti-build-lama lebih dulu (`exit 2` bila penanda fitur baru tidak ada), lalu:

```
[ok] login berhasil -- HTTP 302
[ok] tab Hibah HTTP 200
[ok] menyebut menu Khanza asalnya
     (keadaan sakelar saat diuji: MENYALA)
[ok] saat menyala, menyebut sejak kapan berlakunya
[ok] saat menyala, menjelaskan pemicunya
[ok] menyebut ketiadaan data pasien
[ok] sakelar nilai ada
[ok] menjelaskan bahwa kedua TOTAL tetap ikut saat nilai dimatikan
[ok] isian jendela pindai ada          [ok] isian kuota ada
[ok] editor isi pesan ada              [ok] pratinjau menyebut memakai nilai tersimpan
[ok] memperingatkan tabel hibah masih kosong di RS ini
[ok] tidak menawarkan {nama_pasien}    [ok] tidak menawarkan {no_rm}
[ok] menawarkan {daftar_barang}        [ok] menawarkan {total_diakui}
     (tujuan hibah tercentang: ADA)
[ok] peringatan tujuan sesuai keadaan sebenarnya
[ok] tab Tujuan HTTP 200               [ok] kolom gabungan "Boleh / menerima"
[ok] centang Hibah tampil di baris     [ok] centang Pengadaan masih ada
[ok] centang Pemesanan masih ada       [ok] centang Darurat stok masih ada
[ok] keterangan menyebut enam centang
[ok] tab resep/stok/darurat/pengadaan/pemesanan masih HTTP 200 (5x)
[ok] tab tsb tidak ikut memuat form hibah (5x)   <- pemisahan per-URL masih bekerja
SEMUA LOLOS
```

**Jebakan verifikasi, dan kali ini bukan salah kode maupun salah uji.** Tiga asersi pertama
gagal karena ditulis dengan anggapan sakelarnya MATI (keadaan bawaan migrasinya) -- padahal
pemilik sistem menyalakannya sendiri dari dashboard di tengah pekerjaan ini. `audit_log` yang
menjawabnya dalam satu query, bukan penelusuran kode. Ujinya diubah jadi **membaca keadaan yang
sedang berlaku lalu memeriksa keterangan yang sesuai untuk keadaan itu** -- uji yang memaksakan
keadaan bawaan pada sistem yang sedang dipakai orang akan terus melaporkan "gagal" atas halaman
yang berperilaku benar.

### Refaktor bersama: dibuktikan nol-perubahan-perilaku

`core/notaBarang.ts` mengangkat `formatRupiah` / `formatJumlah` / `keAngka` /
`formatTanggalDokumen` / `kelompokkanPerNomor` / `pecahBarisBarang` / `BATAS_KARAKTER_NOTA` dari
`core/pengadaan.ts`. Ke-20 uji pengadaan yang ada lolos **tanpa satu asersi pun berubah** (hanya
nama impornya, dengan alias lokal supaya isinya tetap identik):

```
$ npx jest core/pengadaan              ->  20 passed, 20 total
$ npx jest core/hibah core/pengadaan   ->  38 passed
```

### Pemeriksaan menyeluruh

`npm test` **538 lolos / 31 suite** (+18 di `hibah.test.ts`), `tsc --noEmit` bersih, `eslint`
bersih, `next build` sukses, `verify:plans` exit 0, `verify:db` lolos (`sik` tetap menolak
tulisan, `audit_log` tetap append-only), `npm run migrate` menerapkan `031_hibah.sql`.

**Nomor migrasi**: pertama ditulis `029_hibah.sql`, diganti jadi `031_hibah.sql` begitu ketahuan
`030_pemesanan.sql` sudah terlanjur diterapkan lebih dulu. Baris `schema_migrations` ikut
diganti nama; `npm run migrate` sesudahnya menjawab "sudah mutakhir, tidak ada yang dijalankan".

### Kebersihan

Akun admin sementara `verifikasi.hibah` **dihapus**; grant `SELECT` sementara untuk
`wakhanza_ro` pada `sik-dev-alca` **dicabut** (`SHOW GRANTS` kembali ke `sik` + `alca` saja);
berkas sementara di luar scratchpad dihapus. **Pengaturan hibah milik pemilik sistem tidak
diubah sama sekali** -- `farmasi.hibah_enabled` tetap `1` dan `terima_hibah` tetap `1`
sebagaimana mereka setel sendiri, dan `farmasi.hibah_nilai` dikembalikan ke `1` setelah diuji
dimatikan. `pm2 restart wakhanza-web` lalu `wakhanza-worker` **sekali** (`wa_session` `ready`,
umur heartbeat 27 detik).

## Label pemicu di luar tabel `template`

### Celahnya diukur, bukan diduga

`labels.test.ts` menuntut setiap baris `template` punya label, dan itu benar -- tapi pemicu yang BUKAN baris `template` (`FARMASI_*`, `BPJS_*`, `SURAT_SAKIT`) sengaja dikecualikan darinya, sehingga mereka juga lolos dari pemeriksaan LABEL. Kode yang benar-benar dipakai runner dibandingkan dengan isi `TRIGGER_LABEL`:

```
kode pemicu yang dipakai kode:  19
yang sudah punya label:         25 (termasuk peninggalan + baris template)

TANPA label:
  FARMASI_HIBAH
  FARMASI_PEMESANAN
  FARMASI_PENGADAAN
```

Tepat tiga, tidak ada yang lain. Ketiganya hidup berbulan-bulan sejak `migrations/028`/`030`/`031`, dan selama itu halaman Antrean dan Log menampilkan **kode mentah** untuk pesan yang benar-benar terkirim ke grup apotek. Kegagalannya diam sempurna -- `triggerLabel()` jatuh ke `?? code`, jadi tidak ada galat maupun baris kosong, cuma tulisan yang tidak berarti apa-apa bagi petugas.

### Labelnya menyebut KEJADIAN, bukan nama menu

```
FARMASI_PENGADAAN: 'Apotek: barang datang (pembelian)'
FARMASI_PEMESANAN: 'Apotek: pesanan ke pemasok'
FARMASI_HIBAH:     'Apotek: barang datang (hibah)'
```

"Nota pengadaan" dan "nota pemesanan" berdampingan di satu tabel Antrean praktis tidak bisa dibedakan, padahal keduanya dua ujung berlawanan dari satu alur -- yang satu barangnya SUDAH datang, yang satu baru DIPESAN. Pelajaran `KONTROL_ULANG`/`KONTROL_TERBIT` yang sama: yang dicari orang saat menelusuri justru pemicu MANA yang mengirim.

### Gerbang barunya dibuktikan MENGGIGIT ke DUA arah

Acuannya dibaca dari `src/worker/*.ts` -- konstanta `TRIGGER_*` di sanalah yang dipakai saat menulis baris `outbox`, jadi ia satu-satunya sumber kebenaran soal kode mana yang bisa muncul di layar. Bukan disalin jadi daftar kedua di dalam uji.

```
# [1] satu label dihapus
    x setiap pemicu yang dipakai runner punya label manusianya
Tests: 1 failed, 10 passed

# [2] dua label dibuat kembar
    x labelnya berbeda satu sama lain
Tests: 1 failed, 10 passed

# dipulihkan
Tests: 11 passed
```

Arah kedua perlu karena dua pemicu berlabel sama sama tidak bergunanya dengan tidak punya label, cuma lebih sulit disadari -- layarnya tampak wajar. Nyata di sini: keempat nota barang sama-sama tergoda dinamai "nota <sesuatu>".

Uji `menemukan konstanta pemicunya sama sekali` menjaga parsernya sendiri: kalau bentuk deklarasinya berubah dan regexnya berhenti cocok, daftarnya jadi kosong dan kedua pemeriksaan di atas lolos tanpa memeriksa apa pun -- gerbang yang rusak DIAM, persis kelas kegagalan yang ia jaga.

### Gerbang lengkap

```
npm run typecheck -> bersih
npm run lint      -> bersih
npm test          -> Test Suites: 45 passed, Tests: 746 passed
npm run build     -> sukses
```

(dari 743 uji: +3 di `labels.test.ts`)

## Kelas kelima belas: PENJUALAN (`/farmasi`, migrations/040) -- barang KELUAR, dan pemicu pertama yang punya kejadian "dihapus"

### Bentuk data yang menentukan seluruh rancangannya

Seluruh angka di bawah diukur langsung terhadap `alca` (database produksi), lewat koneksi `wakhanza_ro` yang sama dipakai worker.

```
penjualan   COUNT(*) = 16.787   (Mar 2024 - Agu 2026)
detailjual  COUNT(*) = 29.852
```

**Pemangkas `nota_jual` EKSAK -- 0 simpangan ke KEDUA arah:**

```sql
SELECT SUM(SUBSTRING(nota_jual,1,2) = 'PJ')                            AS awalan_PJ,
       SUM(SUBSTRING(nota_jual,3,8) = DATE_FORMAT(tgl_jual,'%Y%m%d'))  AS cocok,
       COUNT(*)                                                        AS total
FROM penjualan;
-- awalan_PJ 16787 | cocok 16787 | total 16787

SELECT SUM(STR_TO_DATE(SUBSTRING(nota_jual,3,8),'%Y%m%d') > tgl_jual) AS prefiks_maju,
       SUM(STR_TO_DATE(SUBSTRING(nota_jual,3,8),'%Y%m%d') < tgl_jual) AS prefiks_mundur
FROM penjualan;
-- prefiks_maju 0 | prefiks_mundur 0
```

Bandingkan pengadaan (9 dari 910 menyimpang sampai 31 hari). Ini pemangkas paling bersih di proyek ini; jendela dua arah dipertahankan sebagai jaring pengaman, bukan sebagai koreksi.

**Kolom pasiennya ADA, dan hampir selalu penanda -- tapi tidak selalu:**

```sql
SELECT COUNT(DISTINCT nm_pasien) AS nama_berbeda,
       COUNT(DISTINCT no_rkm_medis) AS rm_berbeda, COUNT(*) AS baris FROM penjualan;
-- nama_berbeda 10 | rm_berbeda 7 | baris 16787

SELECT no_rkm_medis, COUNT(*) FROM penjualan GROUP BY no_rkm_medis ORDER BY 2 DESC LIMIT 3;
-- '000' 16779 | (dua nilai lain) 3, 1
```

Delapan baris membawa no. RM sungguhan. Itu yang membuat penahanannya dikerjakan di tingkat query, bukan diserahkan pada kebiasaan data.

**Aritmetika total, diperiksa pada SELURUH baris rincian:**

```sql
SELECT COUNT(*) AS n,
       SUM(ABS(total - (subtotal - bsr_dis + tambahan + embalase + tuslah)) < 0.01) AS cocok
FROM detailjual;
-- n 29852 | cocok 29852
```

**`ongkir` adalah PEMBULATAN, bukan ongkos kirim:**

```sql
SELECT COUNT(*) AS n_ada_ongkir,
       SUM((jml + p.ongkir) MOD 1000 = 0) AS bulat_1000,
       SUM((jml + p.ongkir) MOD 500  = 0) AS bulat_500,
       SUM(p.ongkir < 1000)               AS dibawah_1000,
       MAX(p.ongkir) AS terbesar, ROUND(AVG(p.ongkir)) AS rata
FROM penjualan p
JOIN (SELECT nota_jual, SUM(total) AS jml FROM detailjual GROUP BY nota_jual) d
  ON d.nota_jual = p.nota_jual
WHERE p.ongkir <> 0;
-- n_ada_ongkir 3945 | bulat_1000 2959 | bulat_500 3343
-- dibawah_1000 3764 | terbesar 20000 | rata 379
```

Itulah yang mengubah label template bawaannya jadi "Pembulatan/ongkir". `ppn` tidak pernah terisi (0 dari 16.787); `ongkir` pada 3.945.

**Laju harian (60 hari terakhir), angka yang ditampilkan di sakelarnya:**

```
2026-08-11  33      2026-08-05  18
2026-08-10  33      2026-08-04  28
2026-08-08   9      2026-08-03  46
2026-08-07  20      2026-08-01  16
2026-08-06  20      2026-07-31  30
```

**`nip` diperiksa terhadap KEDUA master, bukan diasumsikan:**

```sql
SELECT COUNT(*) AS total,
       SUM(EXISTS (SELECT 1 FROM petugas t WHERE t.nip = p.nip)) AS cocok_petugas,
       SUM(EXISTS (SELECT 1 FROM pegawai g WHERE g.nik = p.nip)) AS cocok_pegawai
FROM penjualan p WHERE p.nota_jual >= 'PJ20260701000';
-- total 943 | cocok_petugas 943 | cocok_pegawai 943
```

### Kenapa `riwayat_barang_medis` ditolak -- tiga pengukuran

```sql
-- (1) status='Hapus' TIDAK berarti notanya dihapus
SELECT COUNT(*) AS nota_hapus_berbeda,
  SUM(EXISTS (SELECT 1 FROM penjualan p WHERE p.nota_jual = t.nota)) AS masih_ada,
  SUM(NOT EXISTS (SELECT 1 FROM penjualan p WHERE p.nota_jual = t.nota)) AS benar_lenyap
FROM (SELECT DISTINCT keterangan AS nota FROM riwayat_barang_medis
      WHERE posisi='Penjualan' AND status='Hapus') t;
-- nota_hapus_berbeda 22 | masih_ada 5 | benar_lenyap 17
```

```
-- (2) biayanya, dan ia tumbuh selamanya
EXPLAIN SELECT DISTINCT keterangan FROM riwayat_barang_medis
  WHERE posisi='Penjualan' AND status='Hapus' AND tanggal >= '2026-08-05';
  type=ALL  possible_keys=NULL  key=NULL  rows~96958  Extra="Using where; Using temporary"
  terukur: dingin 52 ms, hangat 57 ms
  riwayat_barang_medis COUNT(*) = 114.834, bertambah ~100/hari

-- bandingkan jendela penjualan yang SUDAH dibaca pemicunya:
EXPLAIN SELECT nota_jual, tgl_jual FROM penjualan
  WHERE nota_jual >= 'PJ20260805000' AND nota_jual <= 'PJ20260819999';
  type=range  key=PRIMARY  rows~137
  terukur: 1 ms
```

```
-- (3) keterangan memuat nama orang begitu fitur member dipakai
DlgPenjualan.java:4260
  Trackobat.catatRiwayat(..., "Simpan", ..., NoNota.getText()+" "+kdmem.getText()+" "+nmmem.getText())
-- di sini membernya kosong, jadi 54/54 cocok '^PJ[0-9]{11}$'
```

### Rencana query -- keenamnya tanpa izin pindai penuh

```
npm run verify:plans
[ok] FARMASI_PENJUALAN               p  range PRIMARY    rows~137
[ok] FARMASI_PENJUALAN               pt eq_ref PRIMARY   rows~1
[ok] FARMASI_PENJUALAN               b  eq_ref PRIMARY   rows~1
[ok] FARMASI_PENJUALAN_ADA           p  range PRIMARY    rows~137  (Using index)
[ok] FARMASI_PENJUALAN_RINGKAS       d  ref nota_jual    rows~2    (Using index)
[ok] FARMASI_PENJUALAN_ANGKA         p  const PRIMARY    rows~1
[ok] FARMASI_PENJUALAN_DETAIL        d  ref nota_jual    rows~2    (Using index)
[ok] FARMASI_PENJUALAN_DETAIL        br eq_ref PRIMARY   rows~1
[ok] FARMASI_PENJUALAN_DETAIL        sat eq_ref PRIMARY  rows~1
[ok] FARMASI_PENJUALAN_DETAIL_HARGA  d  ref nota_jual    rows~2    (Using index)
verify:plans lolos.
```

> Keluaran di atas dari 040 dan sengaja **tidak ditulis ulang**. `FARMASI_PENJUALAN_ANGKA` sejak itu bernama `FARMASI_PENJUALAN_TERPILIH` -- lihat "`{keterangan}`" di akhir seksi ini; rencananya tidak berubah (`p const PRIMARY rows~1`).

### Deteksi pembatalan dibuktikan terhadap jendela SUNGGUHAN

Uji dijalankan terhadap `penjualan` produksi (sakelar fiturnya tetap MATI sepanjang uji; yang disuntik cuma baris buku pantau milik kita sendiri, lalu dihapus lagi):

```
jendela 2026-08-05 .. 2026-08-19  (PJ20260805000 .. PJ20260819999)
nota yang ADA di penjualan: 142

menyuntik buku pantau:
  PJ20260812010  <- nota SUNGGUHAN yang masih ada
  PJ20260805900  <- di dalam jendela, TIDAK ada di penjualan
  PJ20250101001  <- di LUAR jendela, tidak ada di penjualan

HASIL:
  terhapus : ["PJ20260805900"]

  BENAR:
    hantu dilaporkan terhapus            : true  (harus true)
    nota sungguhan TIDAK dilaporkan      : true  (harus true)
    nota luar jendela TIDAK dilaporkan   : true  (harus true)
    nota sungguhan TIDAK dikabarkan lagi : true  (harus true)

  nomor dipakai ulang -> generasi naik  : true  (harus true, dapat 1)

baris uji dibersihkan; sisa buku pantau: 0 (harus 0)
```

Asersi ketiga itulah yang paling mahal kalau hilang: tanpa syarat "di dalam jendela", setiap nota yang menua keluar dari jendela lalu dilaporkan sebagai pembatalan -- pesan SALAH atas penjualan yang masih hidup, bukan sekadar pesan yang tidak terkirim.

### Pagar jendela dibuktikan MENGGIGIT

```
# `diDalam()` dilumpuhkan sengaja (return true)
npx jest src/core/pantauPenjualan
  × nota di LUAR jendela tidak pernah dilaporkan terhapus walau ada di buku pantau
  × nota di LUAR jendela tidak pernah dilaporkan baru walau ada di penjualan
Tests: 2 failed, 15 passed

# dipulihkan
Tests: 17 passed
```

### Grant tidak diwarisi -- untuk KEENAM kalinya

Dibuktikan lewat percobaan SELECT/INSERT/UPDATE/DELETE empiris, bukan diasumsikan.

```
# sesudah `npm run migrate`, SEBELUM grant diterapkan lewat root
grant penjualan_pantau untuk wakhanza_rw:
  SELECT   BERHASIL
  INSERT   BERHASIL
  UPDATE   DITOLAK  -> UPDATE command denied to user 'wakhanza_rw'@'localhost' for table 'penjualan_pantau'
  DELETE   DITOLAK  -> DELETE command denied to user 'wakhanza_rw'@'localhost' for table 'penjualan_pantau'

# GRANT SELECT, INSERT, UPDATE, DELETE ON wakhanza.penjualan_pantau TO 'wakhanza_rw'@'localhost';
grant penjualan_pantau untuk wakhanza_rw:
  SELECT   BERHASIL
  INSERT   BERHASIL
  UPDATE   BERHASIL
  DELETE   BERHASIL
  sisa baris uji: 0 (harus 0)
```

### Pratinjau terhadap data produksi

`npm run dryrun:penjualan` (tidak menulis apa pun, tidak menyentuh buku pantau):

```
Jendela worker (2026-08-05 .. 2026-08-19): 137 baris
Pembacaan luas (2000-01-01 .. 2099-12-31): 1000 baris  <- TERPOTONG di batas jendela (1000)

  --- PJ20260812003 | 2026-08-12 | Jual Bebas | Belum Dibayar | 4 barang ---
  | *Penjualan Obat & BHP*
  | ...
  | *Barang (4):*
  | • Fasidol Tablet — 10 Kaplet @ Rp400 = Rp4.000
  | ...
  | Subtotal : Rp28.578
  | Pembulatan/ongkir : Rp1.422
  | PPN : Rp0
  | *Total : Rp30.000*

  --- SEANDAINYA PJ20260812004 dihapus ---
  | *Penjualan DIBATALKAN*
  | No. Nota : PJ20260812004
  | Nota penjualan di atas sudah dihapus dari sistem. ...

  kolom header yang benar-benar terbaca : nota_jual, tgl_jual, jns_jual, status, nama_petugas, nm_bangsal
  kolom rincian yang benar-benar terbaca: nota_jual, kode_brng, nama_brng, satuan, jumlah, h_jual, total
  PAGAR PRIVASI OK -- tidak satu pun kolom identitas pembeli terbaca

  prefiks nomor vs kolom tgl_jual: 1000 cocok, 0 berbeda (dari 1000)

  buku pantau: 0 baris (0 di dalam jendela)
  bila worker jalan sekarang: 137 nota baru, 0 pembatalan
  (lantai aktivasi belum ada -- ditulis saat sakelarnya dinyalakan, ...)
```

Pagar privasinya diperiksa pada **`Object.keys()` baris hasilnya**, bukan dengan membaca SQL -- satu-satunya cara membuktikan kolom yang tidak diambil memang tidak sampai ke proses ini.

**Dua cacat pada skrip pratinjaunya sendiri ditemukan dan diperbaiki di sini**, keduanya kelas "angka yang tampak pasti padahal bukan": (1) `luas.length` dicetak sebagai "seluruh riwayat" padahal ia `LIMIT` query-nya sendiri -- keluar tepat 1.000, angka bulat yang terbaca seperti hitungan sungguhan, sementara jumlah notanya 16.787; (2) karena urutannya ASC, contoh yang dicetak berasal dari **2024** alih-alih dari nota terakhir yang baru dimasukkan orang -- persis yang ingin dicocokkan dengan layar Khanza. Sekarang keterpotongannya dikatakan dan contohnya diambil dari jendela worker. Bentuk kegagalan yang sama sudah dibayar di `information_schema.TABLE_ROWS` pada 030.

### Gerbang lengkap

```
npm run typecheck   -> bersih
npm run lint        -> bersih
npm test            -> Test Suites: 45 passed, Tests: 743 passed
npm run verify:db   -> verify:db lolos.   (sik: tulis DITOLAK; wakhanza: 24 tabel)
npm run verify:plans-> verify:plans lolos.
npm run build       -> sukses
```

(dari 44 suite / 726 uji sebelum penambahan ini: +1 suite `pantauPenjualan`, +17 uji)

### Terpasang, dan siklusnya dibuktikan BERJALAN

Worker dimulai ulang lewat prosedur tiga langkah yang terdokumentasi (`pm2 stop` -> pastikan Chromium pemegang sesi bersih -> `pm2 start`), dari PowerShell:

```
Chromium pemegang sesi tersisa: 0
pm2 start wakhanza-worker  -> online, restart 7 (TIDAK naik -- tidak ada kaskade)
[1] status=ready denyut=8s  -> SESI SIAP
pm2 restart wakhanza-web   -> online
```

Siklus barunya dibuktikan benar-benar terdaftar, bukan disimpulkan dari "prosesnya menyala": sakelarnya dinyalakan sementara **dengan nol tujuan bercentang** -- keadaan yang membuat runner berhenti SEBELUM menyentuh `sik`, sehingga nol pesan mungkin terkirim -- lalu lognya diperiksa:

```
{"level":40,...,"msg":"penjualan menyala tapi belum ada tujuan yang mencentang \"terima penjualan\""}
```

`level: 40` (warn) itu sendiri bagian dari buktinya: ia jalur yang sengaja dipilih untuk keadaan setengah jadi, dan ia hanya bisa berbunyi dari kode yang baru. Sesudahnya sakelarnya dikembalikan ke `0`.

Keadaan akhir, dan ini yang harus benar sebelum RS memutuskan apa pun:

```
farmasi.penjualan_enabled      [0]     <- MATI
farmasi.penjualan_sejak        []      <- lantai BELUM ditulis; ia lahir saat RS menyalakannya
farmasi.penjualan_hapus_kabar  [1]
farmasi.penjualan_harga        [1]
farmasi.penjualan_lookback_hari [7]
farmasi.penjualan_max_per_siklus [10]
penjualan_pantau: 0 baris
farmasi_target bercentang terima_penjualan: 0
```

Lantai yang masih kosong itu disengaja: menyalakan sementara lewat SQL sengaja TIDAK melewati `togglePenjualanAction`, justru supaya ia tidak menulis lantai aktivasi atas nama keputusan yang belum diambil siapa pun.

Gerbang autentikasi tetap tegak, dan penanda fiturnya ada di build:

```
/farmasi?tab=penjualan -> 307 http://127.0.0.1:3100/login

grep -rl "<penanda>" .next/server
[18] nota penjualan DIBATALKAN
[ 7] penjualan_pantau
[ 6] terima_penjualan
[ 2] Notifikasi penjualan
[ 2] Tabel penjualan PUNYA kolom pasien
[ 0] Pembulatan/ongkir      <- BENAR: string ini hidup di app_setting, bukan di build
```

Baris terakhir layak disebut tersendiri -- nol di sana bukan kegagalan melainkan yang diharapkan, dan menyimpulkan sebaliknya akan menyuruh orang mencari cacat yang tidak ada.

### Yang TIDAK diverifikasi, dan kenapa itu bisa diterima

**Belum ada satu pun pesan penjualan yang benar-benar terkirim ke WhatsApp.** `farmasi.penjualan_enabled` MATI dan `terima_penjualan` belum dicentang pada satu tujuan pun -- menyalakannya berarti mengirim puluhan pesan sehari ke grup sungguhan, dan itu keputusan RS (lihat "Yang masih perlu keputusan rumah sakit"). Yang bisa gagal diam sudah dipagari dari sisi lain: seluruh keputusan pembatalannya ada di fungsi murni yang diuji berikut bukti menggigitnya, query-nya terbukti atas 16.787 baris produksi, dan jalur enqueue-nya `enqueueMessage()` yang sama dipakai empat belas kelas pemicu lain.

**Pembatalan SUNGGUHAN (nota dihapus lewat layar Khanza) belum pernah terjadi selama fitur ini hidup.** Yang diuji adalah perbandingannya terhadap jendela sungguhan dengan baris pantau yang disuntik -- itu membuktikan logikanya, bukan bahwa staf yang menghapus nota di Khanza benar-benar menghasilkan baris yang hilang. Yang menopang keyakinan itu terukur: 17 dari 22 nota ber-`status='Hapus'` di `riwayat_barang_medis` memang sudah tidak ada di `penjualan`.

### `{keterangan}` -- kolom yang dulu terlarang, dibuka atas permintaan pemilik sistem

**Bentuk datanya, diukur atas SELURUH tabel di `alca` sebelum satu baris kode pun diubah:**

```
penjualan  COUNT(*)                                  16.859
  keterangan kosong                                   9.603
  keterangan terisi                                   7.256
    - di antaranya penanda '-' milik Khanza           7.172   (98,8% dari yang terisi)
  nilai berbeda yang benar-benar terisi                  38
  panjang terpanjang                                     40 karakter
  baris yang mengandung baris baru                        0
```

Ke-38 nilai itu diperiksa satu per satu. Sebagian besar keterangan kerja gudang ("obat rutin", "obat luar", "obat mlm", "suntik"); **sebagian berisi NAMA ORANG dan sebagian lagi catatan klinis** -- dua hal yang seluruh modul ini ada untuk menahan. Nilainya tidak disalin ke berkas mana pun di repo ini, sesuai aturan yang sama yang melarang identitas pasien sungguhan masuk berkas uji. Kesimpulannya: tidak ada satu pun cara kode membedakan keduanya dari "obat rutin", jadi yang menahan bukan penyaring melainkan tempat ia dibaca.

**Ketiga pagar, diperiksa pada `Object.keys()` baris hasilnya lewat `npm run dryrun:penjualan` terhadap produksi:**

```
kolom header yang benar-benar terbaca : nota_jual, tgl_jual, jns_jual, status, nama_petugas, nm_bangsal
kolom rincian yang benar-benar terbaca: nota_jual, kode_brng, nama_brng, satuan, jumlah, h_jual, total
kolom nota terpilih yang terbaca      : nota_jual, ppn, ongkir, keterangan
PAGAR PRIVASI OK -- tidak satu pun kolom identitas pembeli terbaca
keterangan OK -- hanya terbaca untuk nota yang benar-benar dikirim
...
=== REKAP HARIAN ===
kolom terbaca: jns_jual, jml_nota, ppn, penyesuaian, jml_baris, jml_barang, subtotal
[ok] tidak ada kolom pasien/keterangan/dosis yang terbaca
```

Pemeriksaannya **dua arah**, dan arah kedua yang gampang terlupakan: `keterangan` wajib ADA di pembacaan nota terpilih. Kolom yang diam-diam hilang dari daftar SELECT menghasilkan `{keterangan}` kosong SELAMANYA tanpa satu pun galat, dan itu tidak bisa dibedakan dari nota yang keterangannya memang kosong. Ketiga keadaan salah menyetel `process.exitCode = 1`.

**Terender pada nota produksi sungguhan** (template uji, bukan template tersimpan -- template bawaan sengaja tidak memuatnya):

```
mentah="obat luar"  -> variabel="obat luar"    | Keterangan : obat luar
mentah="obat rutin" -> variabel="obat rutin"   | Keterangan : obat rutin
mentah="suntik"     -> variabel="suntik"       | Keterangan : suntik
mentah="-"          -> variabel=""             | Keterangan :
```

Baris terakhir adalah buktinya sekaligus alasannya: itulah bentuk yang akan muncul pada ~99,5% nota bila `{keterangan}` dipasang di template bawaan.

**Bukti MENGGIGIT, dua-duanya dengan merusak kodenya sengaja lalu memulihkan:**

| Yang dirusak | Akibat |
|---|---|
| `keteranganNota()` tidak lagi memakai `isianSurat()` | **8 uji gagal** (`membuang penanda "belum diisi" milik Khanza: "-"`, `"--"`, `"---"`, `"0"`, `"null"`, `"undefined"`, `"n/a"`, `"  -  "`) |
| `'keterangan'` dihapus dari `PENJUALAN_TEMPLATE_VARIABLES` | **1 uji gagal** (`diterima saat template nota penjualan disimpan`) |

Keduanya dipulihkan; 19 uji `penjualan.test.ts` lolos sesudahnya.

**Kenapa ujinya di `core/penjualan.test.ts` dan bukan atas `susunVarsPenjualan` langsung**: fungsi itu tinggal di worker bersama keenam `susunVars*` lain, dan worker mengimpor `@/models` sehingga memuatnya menuntut MariaDB hidup -- percobaan pertama benar-benar gagal dengan `Variabel lingkungan WA_DB_HOST wajib diisi`. Memindahkan fungsinya ke core akan memutus simetri ketujuh runner; yang dipindah karena itu cuma TURUNANNYA (`keteranganNota()`), mengikuti `hitungTotalNota()` yang sudah lebih dulu ada di sana persis dengan alasan yang sama.

**Gerbang sesudah perubahan**: `tsc --noEmit` 0, `eslint` 0, **926 uji unit** (dari 907), `next build`, `verify:db` (27 tabel, tulis ke `sik` ditolak), `verify:plans` lolos berikut `FARMASI_PENJUALAN_TERPILIH p const PRIMARY rows~1` -- rencana yang sama dengan `FARMASI_PENJUALAN_ANGKA` yang digantikannya, jadi kolom tambahannya terbukti tidak mengubah apa pun.

## Rekap harian penjualan (`migrations/041`) -- dipicu WAKTU, dan sakelarnya sengaja tidak bertingkat

### Jam bawaan 21:00 -- diukur, bukan dipilih

`penjualan` tidak punya kolom jam sama sekali, jadi kapan transaksi benar-benar terjadi dibaca dari `riwayat_barang_medis` (`posisi='Penjualan'`, `status='Simpan'`, 90 hari terakhir, 3.603 baris):

```
jam  8 -> 126     jam 13 -> 412     jam 18 -> 430
jam  9 ->  21     jam 14 -> 472     jam 19 -> 904   <- puncaknya
jam 10 ->  27     jam 15 -> 457     jam 20 ->  59
jam 11 -> 159     jam 16 -> 341     jam 21 ->   0
jam 12 ->  48     jam 17 -> 147
```

Transaksi TERAKHIR per hari (14 hari terakhir) teramati 19:19, 19:00, 18:42, 18:41, 15:41, 14:25, 13:56, 13:50, 13:28, 12:49, 11:52.

Jam 21 adalah jam pertama yang NOL sepanjang 90 hari. Rekap jam 18:00 -- angka yang paling wajar dikira "sore, sesudah jam kerja" -- akan rutin melewatkan jam 18 dan 19, yaitu 1.334 dari 3.603 baris (37%).

### `ongkir` bukan sekadar pembulatan -- label 040 diperbaiki karena pengukuran ULANG

Sebaran atas SELURUH 16.787 nota:

```
null      0
= 0      12.848
> 0       3.565   (157 di antaranya > Rp1.000; maksimum +20.000)
< 0         380   ( 30 di antaranya < -Rp1.000; minimum -21.000)
```

Yang negatif terbukti POTONGAN HARGA, bukan pembulatan -- diperiksa terhadap `SUM(detailjual.total)`:

```
ongkir  -21.000   subtotal 159.500  ->  total 138.500
ongkir  -18.000   subtotal  50.000  ->  total  32.000
ongkir  -15.000   subtotal 125.000  ->  total 110.000
ongkir  -13.000   subtotal 147.000  ->  total 134.000
ongkir  -11.670   subtotal 442.170  ->  total 430.500
```

Diskon 13% yang dicetak di bawah label "Pembulatan" terbaca sebagai sistem rusak. Migrasi 041 menggantinya lewat `REPLACE()` atas teks yang persis, dan dibuktikan berlaku pada template yang SUDAH HIDUP di produksi:

```
Subtotal : {subtotal}
Penyesuaian : {ongkir}      <- sebelumnya "Pembulatan/ongkir : {ongkir}"
PPN : {ppn}
*Total : {total}*
```

### `{status_bayar}` sengaja tidak ada -- diukur

```sql
SELECT status, COUNT(*) FROM penjualan GROUP BY status;
-- 'Sudah Dibayar'  16.793     (satu-satunya nilai)
```

Rincian lunas-vs-piutang akan jadi baris yang selamanya mengatakan hal yang sama.

### Rencana query: `range` pada keduanya, TANPA izin pindai penuh

```
[ok] FARMASI_PENJUALAN_REKAP_HEADER  p  range PRIMARY    rows~33
[ok] FARMASI_PENJUALAN_REKAP_ITEM    p  range PRIMARY    rows~33
[ok] FARMASI_PENJUALAN_REKAP_ITEM    d  ref   nota_jual  rows~1
verify:plans lolos.
```

Optimizer membalik arah join sendiri: penyaringnya ditulis pada `d.nota_jual`, dan MariaDB menggerakkannya dari `penjualan` lewat PRIMARY. Terukur 2-33 ms untuk kedua query sekaligus. `Using temporary; Using filesort` berasal dari `GROUP BY` atas hasil rentang yang sudah puluhan baris, bukan dari pemindaian tabel.

`verify:db` tetap lolos (`sik` menolak tulisan, `audit_log` menolak UPDATE/DELETE).

### Rekap atas data produksi sungguhan -- `npm run dryrun:penjualan`

```
=== REKAP HARIAN -- tanggal 2026-08-12 (offset 0 hari) ===
  kolom terbaca: jns_jual, jml_nota, ppn, penyesuaian, jml_baris, jml_barang, subtotal
  [ok] tidak ada kolom pasien/keterangan/dosis yang terbaca
  11 nota, 18 baris, 130 barang; subtotal 227983, penyesuaian 917, ppn 0, total 228900

*Rekap Penjualan Harian*
«nama RS»

Tanggal : 12-08-2026

Jumlah nota : 11
Jumlah barang : 130 (18 baris)

Subtotal : Rp227.983
Penyesuaian : Rp917
PPN : Rp0
*Total : Rp228.900*

*Rincian per jenis:*
• Jual Bebas : 10 nota, Rp222.203
• Karyawan : 1 nota, Rp6.697

Dikirim : Rabu, 12 Agustus 2026 14.34

Kode Pengiriman : 2026-08-12 14:34:03 S0VSWT
```

Dua pemeriksaan aritmetika yang menutup penggabungan dua query itu: `227.983 + 917 + 0 = 228.900` (total keseluruhan), dan `222.203 + 6.697 = 228.900` (rincian per jenis berjumlah sama dengan totalnya).

**Pagar privasi diperiksa pada `Object.keys()` baris HASILNYA**, bukan dengan membaca SQL: tujuh kolom terbaca, tidak satu pun dari `no_rkm_medis` / `nm_pasien` / `keterangan` / `nama_bayar` / `aturan_pakai`.

### Cabang "hari kosong" dibuktikan lewat fungsi produksinya

`susunRekapHarian()` dijalankan atas lima hari berturut-turut:

```
offset 0  2026-08-12  nota= 11  kosong=false  body=290 karakter
offset 1  2026-08-11  nota= 33  kosong=false  body=290 karakter
offset 2  2026-08-10  nota= 33  kosong=false  body=290 karakter
offset 3  2026-08-09  nota=  0  kosong=true   body=null (DIAM)
offset 4  2026-08-08  nota=  9  kosong=false  body=290 karakter
```

`body = null` pada 2026-08-09 adalah cabang "tidak ada penjualan DAN pesan kosong sengaja dibiarkan diam".

### Siklusnya benar-benar terpasang di worker -- dibuktikan TANPA mengirim apa pun

Bentuk kegagalan yang perlu ditutup: sakelarnya muncul di dashboard sementara worker tidak pernah menjalankan siklusnya -- gagal DIAM, persis jebakan yang tercatat untuk `migrations/038`.

Membuktikannya tanpa mengirim pesan sungguhan memakai hari yang TERBUKTI nol nota di atas: sakelar dinyalakan sementara dengan `jam = 00:01` (sudah lewat), `offset = 3` (menunjuk 2026-08-09), penanda dikosongkan. Dengan begitu runner melewati SELURUH jalurnya -- baca sakelar, periksa kejatuhtempoan, muat tujuan, baca `sik`, putuskan -- lalu berhenti di cabang diam.

Pengaturannya ditulis langsung lewat `setSetting`, sengaja TIDAK lewat `toggleRekapPenjualanAction`, supaya tidak ada baris `audit_log` yang mengaku seorang admin mengambil keputusan kebijakan.

Hasilnya, satu baris di log worker dan tidak ada yang lain:

```json
{"level":30,"pid":5496,"tanggalRekap":"2026-08-09",
 "msg":"rekap penjualan: tidak ada penjualan hari itu dan pesan kosong tidak diisi, lewati"}
```

Baris itu membuktikan SELURUH jalurnya dilewati: sakelar dibaca, kejatuhtempoan lolos, tujuan dimuat (kalau tidak, yang muncul adalah `warn` "belum ada tujuan yang mencentang"), `sik` dibaca untuk 2026-08-09, dan cabang diam diambil.

**Penanda harian dibuktikan maju sesudahnya**, yaitu jalur "dimajukan sesudah berhasil, termasuk saat berhasilnya adalah sengaja diam":

```
farmasi.penjualan_rekap_last_run   ""  ->  "2026-08-12"
```

Sesudah dua siklus, `outbox` berisi **0 baris** ber-`trigger_code = 'FARMASI_PENJUALAN_REKAP'` -- tidak satu pun pesan dibuat, apalagi dikirim. Seluruh nilainya lalu dikembalikan ke bawaan (`enabled=0`, `jam=21:00`, `offset=0`, penanda kosong) dan dibaca ulang untuk memastikan.

**Satu kekeliruan verifikasi yang layak dicatat**, karena bentuknya persis yang berulang di proyek ini: pembacaan penanda pertama dilakukan dengan menjalankan ulang skrip yang SAMA yang memasang setelan ujinya. Skrip itu punya efek samping -- ia menulis penandanya kembali ke kosong -- sehingga `""` yang terbaca adalah tulisan saya sendiri, bukan keadaan yang ditinggalkan worker. Angka yang tampak seperti pengukuran padahal hasil tindakan sendiri; pelajaran yang sama dengan `information_schema.TABLE_ROWS` di 030 dan `luas.length` di dryrun 040. Pembacaannya diulang dengan skrip yang HANYA membaca.

### Gerbang label menggigit pada pemicu baru

`labels.test.ts` (dibuat sesi sebelumnya) membaca konstanta `TRIGGER_*` dari `src/worker/*.ts` lalu menuntut tiap kode punya label manusianya. Ini pemakaian pertamanya atas pemicu yang benar-benar baru:

```
label dihapus sementara
  × setiap pemicu yang dipakai runner punya label manusianya
Tests: 1 failed, 10 passed, 11 total

=== PULIHKAN ===
Tests: 11 passed, 11 total
```

### `menitKirim` tidak menggeser kedua pemanggil lama

`jatuhTempoHarian()` dipakai bersama tiga runner; parameter menit ditambahkan untuk HH:MM. Yang dijaga bukan fitur barunya melainkan bahwa pengingat kontrol BPJS dan non-BPJS tidak bergeser semenit pun: uji memeriksa menit 0/1/30/59 pada jam sebelum dan sesudah batas, dan seluruh 11 uji `bpjs.test.ts` yang lama tetap lolos tanpa satu asersi pun diubah.

### Pemeriksaan menyeluruh

```
tsc --noEmit          bersih
eslint .              bersih
npm test              46 suite, 781 uji lolos   (dari 45 suite / 746 uji)
npm run test:int      3 suite, 46 uji lolos
npm run verify:db     lolos
npm run verify:plans  lolos
npm run build         berhasil
npm run migrate       041 diterapkan
```

Grant tidak diperlukan: 041 tidak membuat tabel baru, hanya menambah baris `app_setting` (tabel yang grant-nya sudah ada) dan satu `UPDATE` atas baris yang sudah ada.

### Pemasangan

`wakhanza-web` dimulai ulang; ketiga penanda fitur baru ada di build (`Rekap penjualan harian` 2 berkas, `penjualan_rekap_jam` 9, `rincian_jenis` 10).

`wakhanza-worker` dimulai ulang lewat prosedur tiga langkah: `pm2 stop` -> `Get-CimInstance Win32_Process ... wwebjs_auth` menghasilkan **0 proses tersisa** -> `pm2 start`. Sesudahnya `wa_session.status = ready`, denyut 28 detik (ambang basi 40 detik), `last_error` kosong, penghitung restart tetap 9 (tidak ada kaskade).

Restart ini WAJIB dan bukan kehati-hatian: tanpa itu sakelar rekapnya muncul di dashboard sementara worker tidak pernah menjalankan siklusnya.

### Yang TIDAK diverifikasi, dan kenapa itu bisa diterima

**Rekap sungguhan belum pernah terkirim ke grup.** Mengirimnya berarti menyalakan `farmasi.penjualan_rekap_enabled` untuk hari yang berisi penjualan, dan itu keputusan RS -- lihat §"Yang masih perlu keputusan rumah sakit". Yang bisa gagal DIAM sudah dipagari dari sisi lain: teks pesannya dirender atas data produksi sungguhan lewat fungsi yang sama dipakai worker (di atas), jalur enqueue-nya `enqueueMessage()` yang sama dipakai ketujuh pemicu farmasi lain, dan tujuannya daftar yang sama yang sudah terbukti menerima nota penjualan hari ini.

**Cabang "sudah jalan hari ini, tidak diulang" belum teramati di produksi.** Ia dipatok unit test (`jatuhTempoHarian`), dan penjaga sesungguhnya bukan penanda itu melainkan `uq_idem` di mesin database.

## Kelas keempat belas: DOKUMEN HASIL (`migrations/038`) -- ISI pemeriksaan, bukan kabar tentangnya

Dijalankan 9 Agustus 2026 terhadap database produksi (`alca`) dan `wakhanza` sungguhan.

### Bentuk data Khanza yang menentukan seluruh rancangannya

Laju kejadian -- yang menentukan kuota per siklus:

```
nota_jalan/hari (30 hr terakhir)   21.87
nota_jalan puncak/hari             46.00
periksa_lab kunjungan/hari          0.13
billing baris/nota rata2           20.60
billing baris/nota max             41.00
```

Ketersediaan tabel:

```
detail_periksa_lab   alca 73    sik 6106
periksa_lab          alca 74    sik 4588
periksa_radiologi    alca 0     sik 0
hasil_radiologi      alca 0     sik 0
nota_jalan           alca 12142 sik 32471
nota_inap            alca 0     sik 0
```

Kelengkapan kolom hasil lab (menentukan mana yang boleh dihilangkan saat kosong):

```
alca.detail_periksa_lab: total 73, nilai kosong 6, nilai_rujukan kosong 0, keterangan kosong 69
sik.detail_periksa_lab : total 6106, nilai kosong 27, nilai_rujukan kosong 3
```

**Peran ketiga kolom teks `billing`** -- diukur, bukan disimpulkan dari namanya:

```
Ttl* dengan totalbiaya<>0                          0
baris item (pemisah=':') dengan `no` tidak kosong  0
baris no='' & pemisah='' & status<>'-'         23727   (TtlObat 11585, Dokter 12142)
...yang totalbiaya<>0                              0
```

Nol pada baris pertama itulah yang membuat `SUM(totalbiaya)` aman dipakai sebagai total; nol pada baris kedua yang membuat `no` bisa dipercaya sebagai label kelompok.

**Total yang dihitung sendiri, diperiksa silang terhadap Khanza:**

```
nota_diperiksa  cocok  beda
8642            8630   12
```

(`SUM(billing.totalbiaya)` vs `SUM(detail_nota_jalan.besar_bayar)`, selisih < 0,5.) 12 baris yang berbeda itulah alasan bagian PEMBAYARAN tetap ditampilkan apa adanya dari Khanza alih-alih diganti angka hitungan sendiri.

### Bug yang ditemukan pratinjau, bukan pembacaan skema

Percobaan pertama memetakan `nm_perawatan` sebagai label kelompok. Keluaran `npm run dryrun:dokumen` atas nota sungguhan:

```
  dr. (nama disamarkan)                                                  Rp0
  :                                                                Rp10.000
  :                                                                     Rp0
    konsultasi dokter umum                         Rp25.000    1     Rp25.000
  31,655                                                                Rp0
```

Judul kelompok berbunyi ":" dan subtotalnya jadi baris bernama "31,655" tanpa angka. Sesudah diperbaiki (`no` sebagai label, `Ttl*` dihitung ulang):

```
    [keterangan] dr. (nama disamarkan)
  [seksi] Registrasi                                                  Rp10.000
  [seksi] Tindakan
    [item] konsultasi dokter umum                     Rp25.000    1     Rp25.000
  [seksi] Obat & BHP
  [subtotal] Subtotal                                                 Rp31.655
  [seksi] Tambahan Biaya
    [item] p                                             Rp345    1        Rp345
  [seksi] Potongan Biaya
    [item] konsul                                      Rp5.000    1     -Rp5.000
  [total] TOTAL                                                       Rp62.000
pembayaran:
  A Kas                    Rp62.000
```

Subtotal hitungan sendiri (`Rp31.655`) cocok persis dengan angka terformat milik Khanza (`31,655`), dan TOTAL (`Rp62.000`) cocok persis dengan baris pembayarannya.

### Sakelar rincian obat: nama disembunyikan, angka TIDAK berubah

Dengan `dokumen.nota_rincian_obat = '1'` (dinyalakan sementara lalu dikembalikan ke `'0'`):

```
baris    : 17  (rincian obat ditampilkan)
  [seksi] Obat & BHP
    [item] Dexaharsen 0,75 mg (Kaplet)                   Rp260   10      Rp2.600
    [item] Acetylcysteine 200 mg (Kapsul)                Rp845    6      Rp5.070
    [item] Cefixime 200mg (OGB Dexa) merah (Kapsul)     Rp1.950    6     Rp11.700
    [item] Omeprazol mega/nova (Kapsul)                  Rp325    6      Rp1.950
    [item] Livron B.Plex (Tablet)                        Rp507    5      Rp2.535
    [item] Brochifar Plus Kap (Tablet)                   Rp780   10      Rp7.800
  [subtotal] Subtotal                                                 Rp31.655
  [total] TOTAL                                                       Rp62.000
```

Dengan `'0'`: 11 baris, nol nama obat, **subtotal `Rp31.655` dan TOTAL `Rp62.000` identik**.

### PDF benar-benar terbentuk

```
Hasil-Laboratorium-31072026.pdf   199.787 byte, magic %PDF-   (alca, data produksi)
Rincian-Tagihan-08082026.pdf      210.657 byte, magic %PDF-   (alca, data produksi)
Hasil-Radiologi-18112025.pdf      168.573 byte, magic %PDF-   (database Khanza lain)
```

Radiologi dibuktikan terhadap database Khanza lain karena `hasil_radiologi` KOSONG di `alca` maupun `sik`. Grant `SELECT` sementara untuk `wakhanza_ro` diberikan lalu **dicabut**; diperiksa sesudahnya: 0 sisa grant.

Struktur HTML yang benar-benar dirender (diperiksa atas keluaran `dokumenKeHtml()` dengan data produksi):

```
lab  judul "HASIL PEMERIKSAAN LABORATORIUM"
     kolom [Pemeriksaan, Hasil, Satuan, Nilai Rujukan, Keterangan]   <- sama persis rptPeriksaLab
     adaQr true  qrSebelumNama true  adaCatatanKaki true  adaLogo true  tagLiar false
nota judul "RINCIAN TAGIHAN"
     kolom [Layanan / Barang, Biaya, Jml, Jumlah]
     adaQr true  qrSebelumNama true  adaCatatanKaki true  adaLogo true  tagLiar false
```

`qrSebelumNama` menegakkan aturan letak yang dibaca dari koordinat elemen jrxml: QR duduk DI DALAM blok tanda tangan, antara label penanda tangan dan namanya.

### Pemindahan kerangka cetak: NOL perubahan keluaran

`core/cetakHtml.ts` dan `lib/cetak.ts` diekstrak dari `core/suratHtml.ts` dan `lib/surat.ts`. HTML kedua surat (sakit + sehat, dengan dan tanpa QR/catatan kaki) dirender sebelum dan sesudahnya:

```
sebelum 10.069 byte   sesudah 10.065 byte
diff  -> HANYA di dalam komentar CSS (prosa yang sengaja digeneralkan
         dari "Dokter Pemeriksa," jadi "label penanda tangan")
sama tanpa komentar CSS: True | panjang 6461 6461
```

### Rencana query: tidak satu pun butuh izin pindai penuh

```
[ok] DOKUMEN_IDENTITAS         r/pk/p/kel/kec/kab/pj/d  const PRIMARY  rows~1
[ok] DOKUMEN_HASIL_LAB         d ref PRIMARY  rows~1
[ok] DOKUMEN_HASIL_LAB         pl/jp/ptg/dr/tl eq_ref PRIMARY  rows~1
[ok] DOKUMEN_HASIL_RADIOLOGI   h ref PRIMARY  rows~1
[ok] DOKUMEN_PERIKSA_RADIOLOGI pr ref PRIMARY  rows~1
[ok] DOKUMEN_NOTA              b ref no_rawat  rows~25  (Using index)
[ok] DOKUMEN_NOTA_BAYAR_RAJAL  dn ref PRIMARY  rows~1
[ok] DOKUMEN_NOTA_BAYAR_RANAP  dn index nama_bayar  rows~1
[ok] DOKUMEN_CONTOH_LAB        pl index kd_jenis_prw  rows~58  (Using index)
[ok] DOKUMEN_CONTOH_RADIOLOGI  h index PRIMARY  rows~1  (Using index)
[ok] DOKUMEN_CONTOH_NOTA       n index tanggal  rows~1
```

**Gerbangnya menangkap satu kesalahan nyata sebelum sempat dipasang.** Versi pertama `DOKUMEN_CONTOH_NOTA` memakai `ORDER BY tanggal DESC, jam DESC`, dan komentarnya mengklaim indeks `tanggal` terpakai. `verify:plans` menjawab:

```
[GAGAL] DOKUMEN_CONTOH_NOTA  n type=ALL (full scan), key=NULL, rows=10071 melampaui ambang 500
```

`nota_jalan` tidak punya indeks `(tanggal, jam)`, jadi menambahkan `jam` memaksa pemindaian penuh 10.071 baris untuk mengambil SATU baris contoh. Diperbaiki jadi `ORDER BY tanggal DESC` saja -> `type=index, key=tanggal, rows=1`.

### Pagar "berkas tidak pernah ke grup" -- DIBUKTIKAN MENGGIGIT

`media: null` pada salinan tujuan dihapus sengaja, lalu uji integrasinya dijalankan:

```
● enqueuePemicuPasien: tujuan_mode (migrations/018)
  › lampiranPasien: berkas TIDAK PERNAH ikut ke salinan grup
  › `media` yang diisi langsung pada input pun tidak bocor ke salinan grup
    Received: "uji-dokumen.pdf"
Tests: 1 failed, 45 skipped, 46 total
```

Baris grup menerima berkasnya. Sesudah dipulihkan: lolos.

### Gerbang "migrasi dan kode menyebut kalimat yang sama" -- DIBUKTIKAN MENGGIGIT

Satu frasa di `migrations/038` diubah sengaja (`berikut hasil pemeriksaan laboratorium Anda` -> `berikut hasil lab Anda`):

```
● PESAN_BAWAAN_DOKUMEN › lab: teks di migrasi sama dengan di kode
  Expected: "...berikut hasil pemeriksaan laboratorium Anda dari {nama_rs}..."
  Received: "...berikut hasil lab Anda dari {nama_rs}..."
Tests: 1 failed, 22 skipped, 2 passed, 25 total
```

Sesudah dipulihkan: lolos.

### Gerbang penuh

```
tsc --noEmit          bersih
eslint .              bersih
npm test              38 suite, 641 uji lolos   (dari 37/616)
npm run test:int      3 suite, 46 uji lolos     (dari 3/42)
npm run verify:plans  lolos (11 pemeriksaan DOKUMEN_* baru)
npm run verify:db     lolos -- sik tulis DITOLAK, audit_log DELETE/UPDATE DITOLAK
npm run build         berhasil
npm run migrate       038_dokumen_hasil.sql diterapkan
```

Build memuat perubahannya:

```
.next/server/.../administrasi/pratinjau-dokumen/route.js   ada
"Hasil & tagihan"                                          18 berkas
dokumen.lab_enabled / nota_rincian_obat                     4 berkas
```

### Pemasangan

`pm2 restart wakhanza-web` -> pid 8688, online, uptime 4 detik, restart counter 6. `wakhanza-worker` **tidak disentuh**: pid 15312, uptime 6 jam, counter tetap 80.

Gerbang autentikasi lewat instance PM2 sungguhan (port 3100):

```
307 /administrasi?tab=hasil                              -> /login
307 /administrasi/pratinjau-dokumen?jenis=lab            -> /login
307 /administrasi/pratinjau-dokumen?jenis=lab&format=pdf -> /login
200 /login
```

Sesi WhatsApp sebelum dan sesudah pemasangan: `status=ready`, umur denyut 5 detik (dibaca lewat `CONVERT_TZ(heartbeat_at,'+00:00','+07:00')` -- angka mentahnya UTC dan meleset 7 jam).

**Worker belum dimulai ulang, dan itu disengaja.** Ketiga sakelar mati, jadi perilaku kode lama dan baru identik: `params.lampiran` `undefined` -> `runSisipCycle` tidak menghitung kunci baru dan tidak merender apa pun, dan `media: null` pada salinan tujuan tidak mengubah apa pun karena belum ada pemicu pasien yang mengisi `media`. Restart hari ini berarti mengambil risiko kaskade yang **terjadi sungguhan pada mesin ini hari ini juga** (delapan instance dalam ~45 detik dari satu `pm2 restart`) tanpa imbalan apa pun. Yang WAJIB: worker dimulai ulang sebelum sakelar pertama dinyalakan.

## PENGINGAT KONTROL non-BPJS (`migrations/032`) -- padanan BPJS_KONTROL dari sisi Khanza sendiri

Verifikasi 8 Agustus 2026. Nama pasien, nomor telepon, dan nama dokter sungguhan
yang muncul di keluaran perintah TIDAK disalin ke berkas ini (preseden commit
`1cb8e92`); yang dicatat bentuk dan jumlahnya.

### Menu mana yang benar, dan tabelnya

Dibaca dari sumber Khanza, bukan disimpulkan dari nama tabel:

```
$ grep -n -iE "surat.?kontrol|SuratKontrol" src/simrskhanza/frmUtama.java
5997:        btnSKDPBPJS.setText("Surat Kontrol");
13402:        SuratKontrol form = new SuratKontrol(this, false);
45758:        btnBPJSSuratKontrol.setText("Surat Kontrol VClaim");
17775:        BPJSSuratKontrol form = new BPJSSuratKontrol(this, false);
```

`surat/SuratKontrol.java`'s `isBooking()` menulis 13 kolom ke `skdp_bpjs`, dan
kolom ke-9/ke-10 membuktikan arti kedua tanggalnya:

```java
Sequel.menyimpantf("skdp_bpjs","?,?,?,?,?,?,?,?,?,?,?,?,?", ... 13, new String[]{
     TanggalPeriksa...substring(6,10),   // 1 tahun
     ...
     Valid.SetTgl(TanggalPeriksa)+" "+..., // 9 tanggal_datang  <- tanggal KONTROL
     Valid.SetTgl(TanggalSurat)+" "+...,   // 10 tanggal_rujukan <- tanggal SURAT
     NoSurat.getText(), KdDokter.getText(), Status...            // 11-13
 })
```

### Invarian pemangkas: `tahun` == `YEAR(tanggal_datang)`

```
$ for d in sik sik-dev-alca sik-ridda-dev; do ... SUM(tahun <> YEAR(tanggal_datang)) ...
sik              253 baris, meleset=0, datang NULL=0
sik-dev-alca     13 baris,  meleset=0, datang NULL=0
sik-ridda-dev    9 baris,   meleset=0, datang NULL=0
```

275 baris, **0 meleset**. Bandingkan prefiks `no_faktur` pengadaan (9 dari 910
menyimpang) dan `nobooking` pembatalan BPJS (144 dari 1.808). Tidak ada margin
yang perlu ditambahkan.

### Tabrakan dengan BOOK_REMIND -- diukur, bukan diduga

```
$ grep -i kontrol setting/database.xml
    <entry key="JADIKANBOOKINGSURATKONTROL">yes</entry>
    <entry key="JADIKANBOOKINGSURATKONTROLAPIBPJS">no</entry>

$ mysql sik -e "SELECT COUNT(*) total_surat,
      SUM(CASE WHEN b.no_rkm_medis IS NOT NULL THEN 1 ELSE 0 END) ada_booking
    FROM skdp_bpjs s LEFT JOIN booking_registrasi b
      ON b.no_rkm_medis=s.no_rkm_medis AND b.tanggal_periksa=DATE(s.tanggal_datang)"
total_surat  ada_booking
253          253
```

**253/253.** Karena itu peringatannya ada, dan karena itu ia TIDAK jadi pagar
mesin -- lihat CLAUDE.md.

Status suratnya (alasan `WHERE status='Menunggu'`):

```
status          n
Menunggu        151
Sudah Periksa   102
```

Sebaran cara bayar di arsip: BPJS 252, UMUM 1 -- menunya sempat dipakai untuk
pasien BPJS sebelum bridging VClaim dipakai.

### verify:plans -- tanpa satu pun izin pindai penuh

Dijalankan terhadap `alca`, tempat `skdp_bpjs` **nol baris** -- justru keadaan
yang membuat `sks` dan `permintaan_lab` jatuh ke `type=ALL` dan perlu izin
sementara:

```
$ npm run verify:plans
[ok] KONTROL_ULANG        s ref PRIMARY  rows~1
[ok] KONTROL_ULANG        p eq_ref PRIMARY  rows~1
[ok] KONTROL_ULANG        d eq_ref PRIMARY  rows~1
[ok] KONTROL_ULANG        b eq_ref PRIMARY  rows~1
[ok] KONTROL_ULANG        pk eq_ref PRIMARY  rows~1
...
verify:plans lolos.
```

Alias `b` = `booking_registrasi`, satu-satunya tabel yang punya izin pindai
penuh yang disengaja di proyek ini -- di sini ia `eq_ref` karena dimasuki lewat
PRIMARY KEY-nya sendiri `(no_rkm_medis, tanggal_periksa)`.

### Pratinjau terhadap data sungguhan

`alca` (produksi) -- pembedaan "kosong" vs "tidak jatuh tempo" bekerja:

```
$ npm run dryrun:kontrol
=== dryrun:kontrol terhadap database "alca" -- tidak menulis apa pun ===
baris template : ADA, is_active=0, tujuan_mode=pasien
hari sebelum   : "1" -> menyasar tanggal 2026-08-09
--- seluruh isi skdp_bpjs (BUKAN yang akan dikirim) ---
  0 baris -- menu "Surat Kontrol" di Khanza belum pernah dipakai di database ini.
--- KONTROL_ULANG: 0 baris kandidat pada tanggal acuan ---
```

Arsip `sik`, tanggal acuan diserahkan supaya H-1 jatuh pada tanggal yang berisi:

```
$ npm run dryrun:kontrol -- sik 2024-02-04
hari sebelum   : "1" -> menyasar tanggal 2024-02-05
--- seluruh isi skdp_bpjs (BUKAN yang akan dikirim) ---
  253 baris, tanggal kontrol 2023-12-09 s/d 2024-02-05
--- KONTROL_ULANG: 16 baris kandidat pada tanggal acuan ---
  kolom yang benar-benar terbaca: tahun, no_antrian, no_rkm_medis, tgl_kontrol,
                                  nm_pasien, no_tlp, nm_dokter, kd_poli, nm_poli
  kolom klinis yang ikut terbaca: TIDAK ADA (benar)
  tanpa nomor sah  : 2 / 16
  tanpa poli       : 0 / 16
```

Privasi dibuktikan pada **objek barisnya** (`Object.keys()`), bukan dengan
membaca SQL: `diagnosa`, `terapi`, `alasan1`, `alasan2`, `rtl1`, `rtl2` tidak
ada di sana sama sekali -- padahal keenamnya tercetak di surat kertasnya
(`rptSuratSKDPBPJS.jrxml` memakai `$F{temp4}`..`$F{temp9}`).

Bentuk pesan yang dirender (isi sungguhan disamarkan):

```
Yth. (nama pasien), kami mengingatkan jadwal kontrol Anda di (nama RS, dari sik.setting):

Tanggal : 2024-02-05 (besok)
Dokter : (nama dokter, disamarkan di berkas ini)
No. surat : 000219

Mohon membawa surat kontrol Anda. Informasi: Telepon : (kontak RS)

Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.

Kode Pengiriman : 2026-08-08 09:35:58 MM4WZ8
```

### Uji unit

```
$ npx jest
Test Suites: 31 passed, 31 total
Tests:       545 passed, 545 total
```

Yang ditambahkan: enam kasus `tahunDariTanggal` di `core/bpjs.test.ts`
(termasuk pergantian tahun yang menghasilkan DUA tahun -- alasan fungsi itu
mengembalikan larik), `KONTROL_ULANG` masuk daftar terikat opt-out
(`optOutTriggerCodes()` 11 -> 12), dan asersi BERPASANGAN di
`quietHours.test.ts` bahwa BPJS_KONTROL dan KONTROL_ULANG sama-sama TUNDUK jam
tenang -- yang dijaga bukan nilai masing-masing melainkan bahwa keduanya SAMA.

### Verifikasi HTTP lewat instance PM2 (port 3100)

`npm run build` lalu `pm2 restart wakhanza-web`, diuji lewat port produksi.
Akun admin sementara dibuat dan **dihapus di alur yang sama**.

```
[ok]   login berhasil -- HTTP 302
[ok]   /template HTTP 200
[ok]   baris pemicu baru muncul di tabel
[ok]   kode pemicunya tampil
[ok]   judul peringatan tabrakan ada
[ok]   menyebut setelan Khanza penyebabnya
[ok]   menyebut akibatnya: pesan kedua
[ok]   menerangkan syarat {nama_poli}
[ok]   saat KONTROL_ULANG nonaktif, TIDAK memakai bentuk peringatan mendesak
[ok]   menawarkan {no_surat_kontrol} / {tanggal_kontrol} / {sisa_hari}
[ok]   tidak menawarkan variabel klinis {diagnosa} / {terapi} / {rtl1} / {alasan1}
[ok]   template bawaan menyebut nomor suratnya
[ok]   template bawaan memuat frasa berhenti
[ok]   /ringkasan, /antrean, /bpjs masih HTTP 200

SEMUA LOLOS

$ npm run users -- delete verifikasi.kontrol
[ok] 'verifikasi.kontrol' dihapus permanen.
```

### Siklus worker benar-benar berjalan

Jalur kosongnya sunyi menurut rancangan, jadi ia dibuktikan dengan mengaktifkan
templatenya SEBENTAR. Aman karena `alca.skdp_bpjs` nol baris (nol pesan mungkin
terkirim) dan karena sakelar itu dibuat migrasi ini sendiri dengan bawaan 0 --
bukan keputusan pemilik sistem, berbeda dari `farmasi.hibah_enabled`.

```
$ tail logs/wakhanza.1.log | grep kontrol
"msg":"tidak ada surat kontrol non-BPJS yang jatuh tempo"

$ mysql wakhanza -e "SELECT k,v FROM app_setting WHERE k='schedule.kontrol_ulang_last_run'"
schedule.kontrol_ulang_last_run   2026-08-08
```

Membuktikan seluruh rantainya: loop terdaftar -> sakelar dibaca -> konteks
dimuat -> `sik` di-query -> hasil kosong dicatat -> penanda harian maju.

Dikembalikan seketika, dan dibuktikan kembali ke bawaan migrasi:

```
trigger_code   is_active
KONTROL_ULANG  0

k                                 nilai
schedule.kontrol_ulang_hari_sebelum  [1]
schedule.kontrol_ulang_jam           [9]
schedule.kontrol_ulang_last_run      []

$ SELECT COUNT(*) FROM outbox WHERE trigger_code='KONTROL_ULANG'
0
```

**Nol baris `outbox` pernah dibuat**, dan nol pesan pernah terkirim.

### Catatan operasional: restart worker memicu kaskade peluncuran PM2

`pm2 restart wakhanza-worker` (diperlukan untuk memuat siklus baru) jatuh ke
loop pengambilalihan -- instance baru meminta pemegang mundur, keluarnya
pemegang dihitung PM2 sebagai exit yang perlu autorestart, berputar tiap ~7
detik dengan `Protocol error (Runtime.callFunctionOn): Target closed`. Persis
pola yang sudah tercatat di CLAUDE.md.

Pemulihannya mengikuti tiga langkah yang sudah didokumentasikan, dan langkah
kedua menemukan sesuatu yang layak dicatat:

```
Chromium pemegang sesi: 0
sisa sesudah dibersihkan: 0
chrome.exe milik pemakai yang TIDAK disentuh: 14
```

**Tidak ada Chromium yatim sama sekali** -- jadi penyebabnya murni kaskade
peluncuran ganda PM2, bukan sesi yang tersangkut. Penyaring baris perintah
(`*wwebjs_auth*`) tetap membuktikan nilainya: 14 `chrome.exe` milik pemakai
tidak tersentuh. Sesudah `pm2 stop` + `pm2 start` sekali, sesi pulih:

```
status  umur_detik
ready   13
```

## SURAT KONTROL DITERBITKAN (`migrations/033`) -- pasangan KONTROL_ULANG dari ujung yang lain

Verifikasi 8 Agustus 2026. Nama pasien, nomor telepon, nama dokter, dan nama
rumah sakit sungguhan TIDAK disalin ke berkas ini (preseden commit `1cb8e92`).

### Kenapa pemicu ini ada: surat sungguhan yang tidak menghasilkan apa-apa

Sesudah 032 dipasang, surat kontrol sungguhan dibuat lewat Khanza dan tidak ada
WhatsApp yang keluar. Bukan kegagalan -- diagnosis lengkapnya:

```
$ mysql alca -e "SELECT tahun,no_antrian,no_rkm_medis,tanggal_datang,status FROM skdp_bpjs"
tahun  no_antrian  no_rkm_medis  tanggal_datang       status
2026   000004      (no. RM)      2026-08-08 00:00:00  Menunggu

$ tail logs/wakhanza.1.log | grep 'ontrol non-BPJS'
10:30:33 tidak ada surat kontrol non-BPJS yang jatuh tempo ['2026-08-09']
```

Tanggal kontrolnya HARI ITU, sementara pengingatnya H-1 -- jadi saat H-1 jatuh
(kemarin), suratnya belum ada. Sistemnya benar; yang tidak ada adalah pemicu
untuk kejadian "surat disimpan". Itulah lubang yang ditutup 033.

### Rencana query -- pindai penuh yang DISENGAJA, berbeda dari 032

```
$ npm run verify:plans
[ok] KONTROL_ULANG        s ref PRIMARY  rows~1
[ok] KONTROL_ULANG        p eq_ref PRIMARY  rows~1
[ok] KONTROL_ULANG        d eq_ref PRIMARY  rows~1
[ok] KONTROL_ULANG        b eq_ref PRIMARY  rows~1
[ok] KONTROL_ULANG        pk eq_ref PRIMARY  rows~1
[--] KONTROL_TERBIT       s ALL — pemindaian penuh yang disengaja  rows~1
[ok] KONTROL_TERBIT       p eq_ref PRIMARY  rows~1
[ok] KONTROL_TERBIT       d eq_ref PRIMARY  rows~1
[ok] KONTROL_TERBIT       b eq_ref PRIMARY  rows~1
[ok] KONTROL_TERBIT       pk eq_ref PRIMARY  rows~1
verify:plans lolos.
```

Izin pindai penuh HANYA untuk alias `s` (= `skdp_bpjs`); keempat tabel lain di
query yang sama tetap dijaga dan tetap `eq_ref`. Alasannya bukan "tabelnya
kecil" melainkan pemangkas yang tidak tersedia: jendelanya `tanggal_rujukan`,
yang tidak punya hubungan tetap dengan `tahun` (selisih `tanggal_datang -
tanggal_rujukan` terukur -57 s/d +309 hari di arsip), jadi menebak tahun berarti
melewatkan baris tanpa galat.

### Pratinjau: surat sungguhan terbaca pemicu baru

```
$ npm run poll:dryrun
--- KONTROL_TERBIT jendela surat: 2026-08-05 s/d 2026-08-11 (lantai aktivasi diabaikan di pratinjau) ---

=== KONTROL_TERBIT: 1 baris kandidat ===
  (template nonaktif -- akan dilewati oleh worker sungguhan)
  tanpa nomor valid : 0 / 1
  layanan sensitif  : 0 / 1
  - RM (disamarkan) -> (nomor pasien, disamarkan) [auto]
      "Yth. (nama pasien), surat kontrol Anda di (nama RS) sudah dibuat.

      Tanggal kontrol : 2026-08-08
      Dokter : (nama dokter, disamarkan)
      No. surat : 000004

      Mohon datang sesuai tanggal di atas dan membawa surat kontrol Anda. ...
```

### Lantai aktivasi memasang dirinya sendiri, dan gerbangnya benar-benar menahan

Sesudah worker dimuat ulang dengan siklus baru, templatenya masih `is_active=0`.
Buktinya lantai aktivasinya TETAP KOSONG -- kalau gerbangnya tidak menahan,
siklus pertama akan memasangnya:

```
$ mysql wakhanza -e "SELECT k,CONCAT('[',v,']') FROM app_setting WHERE k LIKE 'schedule.kontrol_terbit%'"
schedule.kontrol_terbit_lookback_hari    [3]
schedule.kontrol_terbit_max_per_siklus   [20]
schedule.kontrol_terbit_sejak            []

$ mysql wakhanza -e "SELECT trigger_code,is_active FROM template WHERE trigger_code LIKE 'KONTROL%'"
KONTROL_TERBIT  0
KONTROL_ULANG   1
```

Worker sehat sesudah dimuat ulang (`pm2 stop` + `pm2 start`, bukan `restart` --
urutan itulah yang tidak memicu kaskade peluncuran ganda):

```
status  umur_detik
ready   3
```

### Uji unit

```
$ npx jest
Test Suites: 31 passed, 31 total
Tests:       545 passed, 545 total
```

`optOutTriggerCodes()` 12 -> 13, dan asersi jam tenang diperluas menjadi KETIGA
pemicu kontrol (BPJS_KONTROL, KONTROL_ULANG, KONTROL_TERBIT) sama-sama TUNDUK.
KONTROL_TERBIT yang paling menggoda dikecualikan -- ia berbunyi seketika saat
surat disimpan -- dan justru itu sebabnya dipatok: yang membenarkan pengecualian
jam tenang selalu adanya ORANG YANG MENUNGGU, dan di sini tidak ada.

### Verifikasi HTTP (PM2, port 3100)

Akun admin sementara dibuat dan dihapus di alur yang sama.

```
[ok]   pemicu KONTROL_TERBIT muncul
[ok]   pasangannya KONTROL_ULANG masih ada
[ok]   tidak lagi mengklaim setelan Khanza menyala di sini
[ok]   menyatakan tidak ada booking yang ikut terbentuk
[ok]   memperingatkan setelan itu dipegang klien Khanza
[ok]   memperingatkan {nama_poli} akan kosong
[ok]   tidak menawarkan variabel klinis {diagnosa}/{terapi}/{rtl1}/{alasan1}
[ok]   /ringkasan, /antrean, /bpjs, /farmasi masih HTTP 200

SEMUA LOLOS
```

### KOREKSI atas seksi 032: tabrakan BOOK_REMIND tidak berlaku di instalasi ini

Seksi 032 di atas semula menyatakan setelan Khanza `JADIKANBOOKINGSURATKONTROL`
bernilai `yes` di mesin ini dan "253 dari 253 surat punya bookingnya". Angkanya
benar tapi kedua sumbernya salah: 253/253 dari **arsip `sik`** (pemakaian awal
2024), dan `yes` dibaca dari `setting/database.xml` di folder
`D:\laragon\www\SIMRS-Khanza` -- yang BUKAN klien yang dijalankan rumah sakit ini.

Diukur pada surat sungguhan yang baru dibuat lewat klien yang benar-benar dipakai:

```
$ mysql alca -e "SELECT ... FROM booking_registrasi WHERE no_rkm_medis='(no. RM pasien itu)'"
(kosong)

$ mysql alca -e "SELECT COUNT(*) FROM booking_registrasi WHERE tanggal_booking=CURDATE()"
0
```

**Nol booking.** Jadi tabrakan dengan BOOK_REMIND tidak berlaku di sini, dan
`{nama_poli}` memang akan kosong. Peringatan di `/template` sudah dikoreksi
untuk menyatakan itu, berikut catatan bahwa setelannya dipegang klien Khanza dan
bisa berubah tanpa tanda apa pun di sisi ini.

Pelajarannya bukan tentang booking: **konfigurasi klien Khanza tidak bisa
disimpulkan dari folder sumber mana pun yang kebetulan ada di mesin ini.** Yang
menjawabnya cuma akibatnya di database.

## Tiga tabel template yang sengaja TIDAK digabung

Verifikasi 8 Agustus 2026, bagian "Tiap baris pemicu menyebut TABEL Khanza
asalnya". Nama pasien, nomor telepon, nama dokter, dan nama rumah sakit
sungguhan TIDAK disalin ke berkas ini (preseden commit `1cb8e92`).

### Peta sumbernya diambil dari query pollernya, bukan dari nama pemicunya

Sebelas baris `template` ditelusuri ke klausa `FROM` masing-masing:

```
$ grep -n "FROM " src/khanza/{antrian,booking,penunjang,permintaanPenunjang,farmasi,billing,kontrolUlang}.ts
antrian.ts:37             FROM reg_periksa r
booking.ts:49             FROM booking_registrasi b
penunjang.ts:55           FROM ${table}          -> periksa_lab | periksa_radiologi
permintaanPenunjang:108   FROM ${induk}          -> permintaan_lab | permintaan_radiologi
farmasi.ts:33             FROM resep_obat ro
billing.ts:46,50          FROM nota_jalan  UNION ALL  FROM nota_inap
kontrolUlang.ts:164       FROM skdp_bpjs s       (dipakai bersama kontrolTerbit.ts)
```

| Baris `template` | Tabel Khanza | Kolom yang menentukan kapan berbunyi |
|---|---|---|
| QUEUE_REG | `reg_periksa` | `no_reg` terisi + `TIMESTAMP(tgl_registrasi, jam_reg)` |
| BOOK_CONFIRM | `booking_registrasi` | `status = 'Belum'` |
| BOOK_CANCEL | `booking_registrasi` | `status` = 'Batal' / 'Dokter Berhalangan' |
| BOOK_REMIND | `booking_registrasi` | `tanggal_periksa` = besok |
| RESULT_READY | `periksa_lab` + `periksa_radiologi` | digabung per (`no_rawat`, `tgl_periksa`) |
| LAB_REQUEST | `permintaan_lab` | `TIMESTAMP(tgl_permintaan, jam_permintaan)` |
| RAD_REQUEST | `permintaan_radiologi` | idem |
| PHARMACY_READY | `resep_obat` | `tgl_penyerahan <> '0000-00-00'` |
| BILLING_READY | `nota_jalan` + `nota_inap` | `TIMESTAMP(tanggal, jam)` |
| KONTROL_TERBIT | `skdp_bpjs` | jendela `tanggal_rujukan` (tanggal surat) |
| KONTROL_ULANG | `skdp_bpjs` | `tanggal_datang` H-N, `status = 'Menunggu'` |

BOOK_CONFIRM dan BOOK_CANCEL memang SATU query dan satu siklus
(`pollerBooking.ts:48,52`) -- yang membedakannya status barisnya, dan itulah yang
ditulis sebagai `catatan` pada BOOK_CANCEL alih-alih dibiarkan tampak seperti dua
sumber berbeda.

### Gerbangnya BENAR-BENAR menggigit, dua arah

Daftar acuannya diurai dari `INSERT INTO template` di `migrations/*.sql`, bukan
disalin jadi daftar ketiga. Dibuktikan dengan merusaknya sengaja -- satu kunci
`QUEUE_REG` diganti `PEMICU_KARANGAN`, yang sekaligus menciptakan kedua cacat:

```
$ npx jest src/components/ui/labels.test.ts
  × setiap baris template yang dimigrasikan punya keterangan sumbernya
    - Array []
    + Array [ "QUEUE_REG",
  × tidak menjelaskan pemicu yang bukan baris template
    - Array []
    + Array [ "PEMICU_KARANGAN",
Tests: 2 failed, 4 passed, 6 total
```

Sesudah dikembalikan:

```
$ npx jest src/components/ui/labels.test.ts
  √ migrasinya benar-benar terbaca (kalau nol, parsernya yang rusak, bukan produknya)
  √ setiap baris template yang dimigrasikan punya keterangan sumbernya
  √ setiap baris template yang dimigrasikan punya label manusianya
  √ tidak menjelaskan pemicu yang bukan baris template
  √ menyebut tabel dan kapan berbunyinya, bukan sekadar ada
  √ kode tak dikenal tidak dipaksakan jadi keterangan karangan
Tests: 6 passed
```

Uji pertama ("migrasinya benar-benar terbaca") ada karena parser yang rusak
menghasilkan larik KOSONG, dan larik kosong membuat kedua pemeriksaan pembagi-habis
lolos tanpa memeriksa apa pun -- gerbang yang mati diam.

### Seluruh suite

```
$ npm run typecheck   # tsc --noEmit, bersih
$ npx jest
Test Suites: 32 passed, 32 total
Tests:       551 passed, 551 total
$ npm run lint        # bersih
$ npm run build       # /template ƒ (Dynamic)
```

### Verifikasi HTTP -- lewat instance PM2 (port 3100), 37 pemeriksaan

Akun admin sementara dibuat dan **dihapus di alur yang sama** (`npm run users --
delete`, dikonfirmasi lewat `users -- list`: tinggal satu akun milik pemilik
sistem). Pagar anti-build-lama aktif: penanda fitur baru tidak ada -> `exit 2`.

```
[ok]  /template HTTP 200
[ok]  QUEUE_REG: sumbernya reg_periksa            [ok]  QUEUE_REG: kapan berbunyinya
[ok]  BOOK_CONFIRM: sumbernya booking_registrasi  [ok]  BOOK_CONFIRM: kapan berbunyinya
[ok]  BOOK_CANCEL: sumbernya booking_registrasi   [ok]  BOOK_CANCEL: kapan berbunyinya
[ok]  BOOK_REMIND: sumbernya booking_registrasi   [ok]  BOOK_REMIND: kapan berbunyinya
[ok]  RESULT_READY: periksa_lab + periksa_radiologi  [ok]  RESULT_READY: kapan berbunyinya
[ok]  LAB_REQUEST: sumbernya permintaan_lab       [ok]  LAB_REQUEST: kapan berbunyinya
[ok]  RAD_REQUEST: sumbernya permintaan_radiologi [ok]  RAD_REQUEST: kapan berbunyinya
[ok]  PHARMACY_READY: sumbernya resep_obat        [ok]  PHARMACY_READY: kapan berbunyinya
[ok]  BILLING_READY: nota_jalan + nota_inap       [ok]  BILLING_READY: kapan berbunyinya
[ok]  KONTROL_TERBIT: sumbernya skdp_bpjs         [ok]  KONTROL_TERBIT: kapan berbunyinya
[ok]  KONTROL_ULANG: sumbernya skdp_bpjs          [ok]  KONTROL_ULANG: kapan berbunyinya
[ok]  pengantar menyebut tabel yang dibaca
[ok]  pengantar menegaskan hanya membaca
[ok]  catatan "akhiran _bpjs menyesatkan" tidak membanjiri tabel
[ok]  catatan "satu pesan per kunjungan" tidak membanjiri tabel
[ok]  tidak menawarkan variabel klinis {diagnosa}/{terapi}/{rtl1}/{alasan1}
[ok]  /ringkasan, /antrean, /bpjs, /farmasi, /balasan-otomatis masih HTTP 200

SEMUA LOLOS
```

Kedua pemeriksaan `catatan` sengaja BERPOLARITAS TERBALIK: yang dibuktikan bukan
teksnya ada, melainkan teksnya **tidak** ikut ke sebelas baris tabel. Tanpa
asersi itu, "catatan hanya di modal" cuma niat di komentar.

### Modal: catatannya memang muncul di sana

Diuji lewat peramban terkendali (Puppeteer, `userDataDir` sendiri di direktori
sementara -- TIDAK PERNAH `.wwebjs_auth`). Tombol Ubah dicari **di dalam baris
RESULT_READY**, bukan lewat teks global: halaman ini punya sebelas tombol
berlabel sama persis. Kondisi tunggunya dibatasi ke `dialog[open]`, bukan
`<body>` -- pelajaran jebakan verifikasi kelima di `/farmasi`.

```
[ok]  halaman Template terbuka -- http://127.0.0.1:3100/template
[ok]  tombol Ubah pada baris Hasil penunjang ditemukan
[ok]  modal menyebut tabel sumbernya            (periksa_lab + periksa_radiologi)
[ok]  modal menyebut kapan berbunyinya
[ok]  modal memuat catatan yang TIDAK ada di tabel
[ok]  kode pemicunya tetap terbaca              (RESULT_READY)
[ok]  kotak isi pesan tetap ada

SEMUA LOLOS
```

### Kebersihan

Tidak ada migrasi, tidak ada perubahan skema, tidak ada sakelar kebijakan yang
disentuh: perubahannya murni keterangan di layar plus satu uji. `template.is_active`
seluruh baris tidak diubah, dan tidak satu pun pesan dikirim selama verifikasi.

## HASIL lab & radiologi dipisah (`migrations/034`) -- kekecualian yang disudahi

Verifikasi 8 Agustus 2026. Nama pasien, nomor telepon, nama dokter, dan nama
rumah sakit sungguhan TIDAK disalin ke berkas ini (preseden commit `1cb8e92`).

### Keadaan SEBELUM migrasi, diukur bukan diingat

```
$ mysql wakhanza -e "SELECT trigger_code, is_active, tujuan_mode, CHAR_LENGTH(body) ..."
RESULT_READY   is_active=0   tujuan_mode=pasien   body=243 karakter

template_target WHERE trigger_code='RESULT_READY'   -> 0 baris
poll_cursor  RESULT_READY_LAB         2026-08-03 12:37:15
             RESULT_READY_RADIOLOGI   2026-08-03 12:37:15
app_setting  dispatch.stale_hours_by_trigger -> {... "RESULT_READY":12 ...}
outbox       trigger_code='RESULT_READY' -> 1 baris (pasien uji, status expired)
```

Angka-angka itu yang menentukan bentuk migrasinya: baris yang dipecah sedang
NONAKTIF di sini, tapi migrasinya tetap harus benar untuk instalasi yang
menyalakannya -- karena itu `is_active` disalin, bukan ditulis `0`.

### Sesudah `npm run migrate` -- nol-perubahan-perilaku dibuktikan kolom per kolom

```
$ npm run migrate
[migrate] jalankan 034_hasil_penunjang_dipisah.sql ...
[migrate] selesai  034_hasil_penunjang_dipisah.sql

LAB_RESULT   is_active=0  tujuan_mode=pasien  body=243  label='Hasil laboratorium selesai'
RAD_RESULT   is_active=0  tujuan_mode=pasien  body=243  label='Hasil radiologi selesai'
sisa_result_ready_di_template        -> 0
target_result_ready_tersisa          -> 0

body_kedua_baris_sama       -> 1     (LAB_RESULT.body = RAD_RESULT.body, byte per byte)
masih_pakai_jenis_layanan   -> 1     ({jenis_layanan} utuh, jadi teksnya tidak berubah)
frasa_berhenti_utuh         -> 1     ("Berhenti Kirim Otomatis" tidak tergunting)
```

`is_active`, `tujuan_mode`, dan panjang badan pesan (243) sama persis dengan
baris lamanya -- itulah bukti bahwa yang terjadi PEMECAHAN, bukan penulisan
ulang. `label` satu-satunya yang berbeda, dan memang harus berbeda.

**Ambang basi ikut pindah dengan angka yang BERLAKU, bukan angka seed:**

```
sebelum : {"QUEUE_REG":6,"RESULT_READY":12,"PHARMACY_READY":12, ...}
sesudah : {"QUEUE_REG":6,"PHARMACY_READY":12, ..., "LAB_RESULT":12,"RAD_RESULT":12}
```

Kunci lain tidak tersentuh. Tanpa langkah ini keduanya jatuh ke
`dispatch.stale_threshold_hours_default` = 6 jam -- pengetatan diam-diam yang
muncul sebagai pesan `expired`, bukan sebagai galat.

**Yang sengaja TIDAK berubah, dan diperiksa memang tidak berubah:**

```
poll_cursor  RESULT_READY_LAB         2026-08-03 12:37:15   (utuh)
             RESULT_READY_RADIOLOGI   2026-08-03 12:37:15   (utuh)
outbox       RESULT_READY -> 1 baris                        (riwayat, utuh)
```

Watermark yang diganti nama = watermark yang hilang: `getCursor` jatuh ke
`now - polling.lookback_days` (30 hari) dan poller mengirim ulang sebulan penuh
hasil pemeriksaan. Prefiks kunci idempotennya tetap `RESULT_READY` lewat alasan
yang sama -- hasil yang sudah pernah dikirim harus tetap dikenali duplikat.

### Worker benar-benar menjalankan EMPAT siklus penunjang, bukan tiga

Sesudah `pm2 start wakhanza-worker` (log worker sungguhan, pid 16300):

```
21:05:04  LAB_REQUEST | pemicu nonaktif atau template belum ada, lewati siklus
21:05:04  RAD_REQUEST | pemicu nonaktif atau template belum ada, lewati siklus
21:05:04  LAB_RESULT  | pemicu nonaktif atau template belum ada, lewati siklus
21:05:04  RAD_RESULT  | pemicu nonaktif atau template belum ada, lewati siklus
```

Sebelum migrasi baris ketiga dan keempat adalah SATU baris `RESULT_READY`.

Pesan itu sendiri ambigu ("nonaktif ATAU template belum ada"), jadi yang
membuktikan templatenya benar-benar ketemu adalah `poll:dryrun`, yang
membedakan keduanya:

```
$ npm run poll:dryrun
=== LAB_REQUEST: 16 baris kandidat ===
  (template nonaktif -- akan dilewati oleh worker sungguhan)
=== RAD_REQUEST: 0 baris kandidat ===
=== LAB_RESULT: 3 baris kandidat ===
  (template nonaktif -- akan dilewati oleh worker sungguhan)     <- bukan "belum ada template"
=== RAD_RESULT: 0 baris kandidat ===
```

`reportSection()` sekaligus kehilangan parameter `triggerCode`-nya: ia ada
justru karena hasil penunjang tampil sebagai `RESULT_READY(lab)` sementara
templatenya satu baris. Kekecualiannya hilang, dan parameter bernilai bawaan
yang tidak dipakai siapa pun adalah persis tempat pratinjau dan produksi mulai
menyimpang tanpa satu pun galat.

### Gerbang `labels.test.ts` diajari membaca migrasi yang MENGHAPUS

Parsernya semula hanya mengenali `INSERT INTO template ... VALUES`. Migrasi ini
memakai `INSERT ... SELECT` (untuk menyalin) dan `DELETE` (untuk membuang baris
lama). Kedua penanganan itu dirusak sengaja, satu per satu:

```
A. penanganan DELETE dilumpuhkan
   × pemecahan RESULT_READY terbaca sebagai pemecahan, bukan penambahan
   × setiap baris template yang dimigrasikan punya keterangan sumbernya
   Tests: 2 failed, 6 passed

B. penanganan INSERT...SELECT dilumpuhkan
   × migrasinya benar-benar terbaca (kalau nol, parsernya yang rusak)
   × pemecahan RESULT_READY terbaca sebagai pemecahan, bukan penambahan
   × tidak menjelaskan pemicu yang bukan baris template
   Tests: 3 failed, 5 passed

C. dikembalikan
   Tests: 8 passed
```

Perhatikan arah kegagalannya berbeda, dan itu yang membuktikan gerbangnya
menjaga DUA hal: DELETE yang terlewat membuat uji menuntut keterangan untuk
pemicu yang sudah tidak ada; SELECT yang terlewat membuat dua pemicu yang
benar-benar berjalan tidak pernah diperiksa punya keterangan sama sekali.

Ditambah dua uji baru yang menyatakan ketidaksamaan ketiga daftar secara
eksplisit: `TRIGGER_LABEL.RESULT_READY` **ada** (baris riwayat butuh labelnya)
sementara `TRIGGER_SOURCE.RESULT_READY` **tidak** (ia menjelaskan baris
`template` yang ADA).

### Seluruh suite

```
$ npm run typecheck   # tsc --noEmit, bersih
$ npx jest
Test Suites: 32 passed, 32 total
Tests:       553 passed, 553 total
$ npm run lint        # bersih
$ npm run build       # sukses
$ npm run verify:db      # sik tetap menolak tulisan, audit_log tetap append-only
$ npm run verify:plans   # lolos
```

**Satu uji lama GAGAL dan itu benar**: `optOut.test.ts` mematok
`optOutTriggerCodes()` sepanjang 13, jadi mengubah daftarnya memaksa
keputusannya diambil sadar-sadar. 13 -> 15: RESULT_READY pecah jadi dua (+1),
lalu kode lamanya DITAHAN sebagai peninggalan (+1) karena daftar itu juga
dipakai untuk MENCORET antrean di `wa-client.ts` -- baris `pending` berkode lama
harus tetap tercoret saat pasiennya meminta berhenti.

`verify:plans` menamainya `HASIL(lab)` / `HASIL(radiologi)` -- deskriptif seperti
`PERMINTAAN(jenis)`, bukan kode pemicunya, karena kode itu ditentukan di worker
bukan di modul `khanza/`. Keduanya lolos TANPA izin pindai penuh:

```
[ok] HASIL(lab)        periksa_lab range PRIMARY  rows~3  (Using index)
[ok] HASIL(radiologi)  periksa_radiologi index kd_jenis_prw  rows~1  (Using index)
```

### Verifikasi HTTP -- lewat instance PM2 (port 3100), 31 pemeriksaan

Akun admin sementara dibuat dan **dihapus di alur yang sama** (dikonfirmasi
lewat `users -- list`: tinggal satu akun milik pemilik sistem). Pagar
anti-build-lama aktif: penanda fitur baru tidak ada -> `exit 2`.

```
[ok]  /template HTTP 200
[ok]  Hasil lab: barisnya ada / sumbernya periksa_lab / kapan berbunyinya
[ok]  Hasil radiologi: barisnya ada / sumbernya periksa_radiologi / kapan berbunyinya
[ok]  Permintaan lab: barisnya ada / sumbernya permintaan_lab / kapan berbunyinya
[ok]  Permintaan radiologi: barisnya ada / sumbernya permintaan_radiologi / kapan berbunyinya
[ok]  baris RESULT_READY tidak ada lagi
[ok]  label lama "Hasil penunjang selesai" tidak ada lagi
[ok]  tidak ada baris bersumber "periksa_lab + periksa_radiologi"
[ok]  {jenis_layanan} masih terpakai di badan pesannya
[ok]  frasa berhenti utuh di badan pesannya
[ok]  tidak menawarkan variabel klinis {diagnosa}/{terapi}/{hasil_lab}/{nama_pemeriksaan}
[ok]  Ringkasan memakai label peninggalan, bukan kode mentah
[ok]  Ringkasan tidak menampilkan kode mentah RESULT_READY
[ok]  /antrean, /log, /bpjs, /farmasi, /balasan-otomatis, /pengaturan masih HTTP 200

SEMUA LOLOS
```

Tiga asersi sengaja BERPOLARITAS TERBALIK (baris lama hilang, label lama
hilang, sumber gabungan hilang): tanpa itu "pemecahannya benar-benar terjadi di
layar" cuma niat di komentar. Pemeriksaan Ringkasan adalah pasangannya dari arah
sebaliknya -- baris `outbox` peninggalan tetap tampil sebagai
"Hasil penunjang (lama)", bukan sebagai kode mentah.

### Worker: satu restart yang berubah jadi lingkaran, dan pemulihannya

`pm2 restart wakhanza-worker` menjatuhkan worker ke lingkaran restart ~7 detik:
tiap instance baru meminta pemegang sesi mundur, pemegangnya keluar dengan
`exitCode 75`, PM2 membaca itu sebagai crash lalu menyalakan instance baru lagi.
Bentuknya yang sudah tercatat di CLAUDE.md ("satu perintah restart meluncurkan
dua proses"), tapi **BUKAN** lewat sebab yang di sana: tidak ada Chromium yatim
sama sekali (`Get-CimInstance ... wwebjs_auth` -> **0** proses), dan serah-terima
`singleInstance.ts` sendiri bekerja normal -- yang berputar adalah autorestart
PM2 di atas keluarnya proses lama.

Pemulihannya mengikuti urutan yang sudah terdokumentasi, dan berhasil:

```
pm2 stop wakhanza-worker
Get-CimInstance Win32_Process ... wwebjs_auth  -> 0 proses (tidak ada yang perlu dimatikan)
netstat :3101 LISTENING                        -> 0 (kunci worker sudah lepas)
pm2 start wakhanza-worker
-> status online, uptime 45s, restarts TETAP 34 (tidak bertambah)
-> wa_session: status=ready, umur heartbeat 27 detik (ambang basi 40 detik)
```

Yang membocorkan lingkarannya bukan `status` melainkan **umur heartbeat dan
jumlah restart yang terus naik** -- pelajaran yang sama seperti insiden 29
restart: `wa_session.status` ditulis proses yang sudah mati dan tidak ada yang
membatalkannya.

### Kebersihan

Tidak ada perubahan skema (tidak ada kolom/tabel baru; `template` dan
`template_target` cuma berganti isi baris), tidak ada grant baru yang
diperlukan -- `wakhanza_rw` sudah memegang `UPDATE`/`DELETE` untuk `template`,
`template_target`, dan `app_setting`, dan itu diperiksa lewat
`SHOW GRANTS FOR CURRENT_USER()` sebelum migrasinya ditulis, bukan diasumsikan.

**Tidak ada sakelar kebijakan yang berubah**: `LAB_RESULT` dan `RAD_RESULT`
mewarisi `is_active = 0` dari baris yang dipecah, jadi tidak satu pun pemicu
menyala maupun padam sebagai akibat migrasi ini. Tidak satu pun pesan dikirim
selama verifikasi. Akun admin sementara dihapus, dan skrip verifikasinya tinggal
di luar repo.

**`periksa_radiologi` KOSONG di kedua database** (`COUNT(*)` = 0 pada `alca`
maupun `sik`), jadi RAD_RESULT belum pernah berjalan atas satu baris data pun --
keadaan yang sama persis dengan `permintaan_radiologi` saat RAD_REQUEST dibuat.
Yang terbukti: bentuk SQL-nya identik dengan yang lab (satu
`buildResultReadySql()` yang cuma berganti nama tabel), EXPLAIN-nya lolos, dan
worker menjalankan siklusnya. Yang TIDAK terbukti: bahwa barisnya terbaca.
Periksa lewat `npm run poll:dryrun` sebelum menyalakan templatenya.


## Dedup pemicu pasien, dan dua cacat daur hidup worker

Diverifikasi 2026-08-09 terhadap database produksi (`wakhanza` + `alca`) dan
instance PM2 yang sesungguhnya.

### Bug dedup: kunci yang tidak pernah ditulis

Log worker sebelum perbaikan, siklus `KONTROL_TERBIT` berulang tiap 60 detik:

```
09:00:17  {"dari":"2026-08-08","sampai":"2026-08-12","terbaca":1,"baru":1,"terkirim":1,"tujuan":1}
09:01:17  {"dari":"2026-08-08","sampai":"2026-08-12","terbaca":1,"baru":1,"terkirim":1,"tujuan":1}
```

Jumlah baris semacam itu di seluruh log: **1.043**. Isi `outbox` yang sebenarnya:

```
SELECT COUNT(*) FROM outbox WHERE trigger_code='KONTROL_TERBIT';  -> 2
```

Kedua baris itu bertanggal 2026-08-08, keduanya ber-`chat_id` grup. Jadi 1.043
laporan "terkirim" menghasilkan 2 pesan.

Sebabnya dibuktikan langsung dengan menghitung kedua bentuk kunci untuk baris
yang sama, terhadap database produksi:

```
tujuan_mode = tujuan, jumlah tujuan aktif = 1
jendela 2026-08-08..2026-08-12 -> 1 baris

surat 2026-000001 (kontrol 2026-08-09)
  kunci DASAR   e70bd70476ab848e  ada di outbox? TIDAK
  kunci DITULIS e3f61eec833fbe50  ada di outbox? YA

penyaring LAMA  (kunci dasar)   -> 1 baris dianggap BARU
penyaring BARU  (kunci ditulis) -> 0 baris dianggap BARU
```

`e3f61eec833fbe50...` cocok dengan `idempotency_key` baris `outbox` nomor 31675.
Kunci dasarnya memang tidak pernah ada.

Sesudah perbaikan diterapkan dan worker dimulai ulang, baris
`siklus surat kontrol terbit selesai` **berhenti muncul sama sekali** -- runner
kembali lebih awal karena `belum.length === 0`.

Uji unit `core/tujuanPemicu.test.ts` (9 kasus) memaku aturannya, termasuk asersi
`expect(kunci).not.toContain(DASAR)` untuk mode `tujuan` -- yaitu pernyataan
langsung atas bug ini.

### Loop restart: kode keluar yang ditimpa

Log saat `pm2 restart` dijalankan sebelum perbaikan, satu pid, selisih 7 ms:

```
09:17:29 pid 8064  "wakhanza-worker berhenti..."   exitCode 75
09:17:29 pid 8064  "worker gagal memulai"  Protocol error (Runtime.callFunctionOn): Target closed
```

Instance baru lahir tiap ~7,5 detik tanpa henti. Sesudah `main().catch()` diberi
penjaga `sedangBerhenti`, baris penggantinya muncul dan kode keluarnya bertahan:

```
09:38:36  "main() gagal karena worker sedang berhenti -- kode keluar shutdown() dipertahankan"
09:38:37  "sesi WhatsApp ditutup rapi"
```

**Itu belum cukup, dan sebabnya terpisah.** `stop_exit_codes` ternyata TIDAK ADA
di proses yang berjalan walau tertulis di `ecosystem.config.js`:

```
$j = pm2 prettylist; if ($j -match "stop_exit_codes") {...}
-> "stop_exit_codes TIDAK ADA di proses berjalan"
```

Konsekuensi langsung dari aturan yang sudah tercatat: `pm2 restart` tidak membaca
ulang berkas konfigurasi. Sesudah `pm2 delete` + `pm2 start ecosystem.config.js
--only wakhanza-worker` dari PowerShell:

```
-> "OK: stop_exit_codes kini ADA"
pm2 list -> wakhanza-worker  online  uptime 22s  restarts 0
pm2 save -> Successfully saved in C:\ProgramData\pm2\home\dump.pm2
```

Pelajaran yang ikut terbayar: **menyalakan ulang worker dua kali berdekatan**
(09:47 dan 09:50) menjatuhkannya kembali ke loop, persis seperti yang sudah
tertulis di CLAUDE.md. Pemulihannya mengikuti urutan yang terdokumentasi --
`pm2 stop`, matikan Chromium yang menyaring `wwebjs_auth` (9 proses; 13 proses
`chrome.exe` milik pemakai TIDAK tersentuh), pastikan port kunci 3101 tanpa
LISTENING (13 sisa hanya TIME_WAIT), lalu `pm2 start`.

### Kolam database ditutup di tengah siklus

Sebelum perbaikan, pada penutupan:

```
{"loop":"heartbeat","message":"ConnectionManager.getConnection was called after the connection manager was closed!"}
{"loop":"poller:sisip","message":"ConnectionManager.getConnection was called after the connection manager was closed!"}
```

Sesudah `tungguSiklusSelesai()` dipasang, galat itu tidak muncul lagi pada
penutupan mana pun sesudahnya.

### Jebakan pengukuran denyut

Diagnosis awal sesi ini menyatakan worker mati 7 jam. **Itu keliru**, dan
sebabnya jebakan yang sudah tertulis di CLAUDE.md:

```
status  tersimpan_utc        wib                  umur_benar  umur_salah
ready   2026-08-09 02:20:24  2026-08-09 09:20:24  8 detik     25.208 detik
```

Selisihnya tepat 25.200 detik (7 jam). `heartbeat_at` ditulis Sequelize ber-
`timezone: '+00:00'` sementara `NOW()` mengembalikan WIB. Nol baris `outbox`
hari itu juga bukan gejala: hari Minggu, tidak ada pelayanan.

## Konfirmasi terkirim (`migrations/035`) -- terbukti untuk grup, belum untuk nomor

Skema diterapkan dan diperiksa:

```
[migrate] jalankan 035_konfirmasi_terkirim.sql ... selesai
```

`core/waAck.test.ts` -- 14 kasus lolos, termasuk yang memaku ketiga keputusan
sulitnya: tingkat hanya boleh maju, `ACK_ERROR` boleh menimpa dari bawah, dan
label grup berbeda dari perorangan.

**Yang TIDAK terbukti SAAT ITU: penautan id** -- lalu terbukti belakangan, lihat
"Penautan id: terukur ulang" di bawah seksi ini. Lima kiriman uji sungguhan ke
nomor RS sendiri (obrolan dengan diri sendiri, tidak mengganggu siapa pun)
semuanya berakhir `sent` dengan `wa_message_id` tetap NULL:

```
34815  sent  NULL  -
34820  sent  NULL  -
34821  sent  NULL  -
```

Sebab pertamanya ditemukan lewat diagnostik yang ditambahkan khusus:

```
{"kunciPesan":"undefined","bentukId":"undefined","msg":"id pesan keluar tidak bisa diturunkan"}
```

Bukan `id`-nya yang hilang melainkan SELURUH objeknya. Dibuktikan di sumber
pustaka yang terpasang:

```
whatsapp-web.js 1.34.7
    return sentMsg ? new Message(this, sentMsg) : undefined;
```

`sentMsg` berasal dari `page.evaluate(...)` yang di mesin ini menjawab
`undefined`. Pesannya tetap terkirim -- `send_log` mencatat `sent`, dan
kirimannya benar-benar sampai.

Jalur pengganti lewat event `message_create` sudah dipasang tapi **belum terbukti
menautkan**: nol baris ber-`wa_message_id` sesudah percobaan berikutnya, dan nol
galat. Penelusuran dihentikan sadar-sadar karena tiap iterasi menuntut satu
restart worker lagi pada proses produksi, dan cadangan restart hari itu sudah
jauh terlampaui. Sebagai gantinya, ketiga sebab kegagalan yang mungkin kini
DIBEDAKAN di log pada level `warn` (id tidak terbaca / isi kosong / tidak ada
baris cocok, berikut jumlah kandidat), supaya jawabannya didapat pada restart
berikutnya tanpa mengulang seluruh percobaan.

Selama belum tertaut, fiturnya merosot persis seperti rancangannya: kolom kosong
dan UI berbunyi "Belum ada kabar" -- yang memang bukti POSITIF, bukan negatif.
Tidak ada yang menyesatkan dan tidak ada yang rusak.

**Seluruh dua paragraf di atas adalah catatan SEJARAH, dan kesimpulannya sudah
dibantah.** Dugaan yang tertulis di sana -- bahwa jawabannya "didapat pada restart
berikutnya" -- ternyata tepat: pengukuran ulang di bawah menunjukkan penautannya
mulai berhasil pada 2026-08-10T01:18Z dan sejak itu bekerja untuk tujuan grup.

### Penautan id: terukur ulang (12 Agustus 2026)

Klaim "belum terbukti" di atas **dibantah pengukuran**, dan yang keliru bukan
angkanya melainkan SAMPELNYA: ketiga baris di atas (34815, 34820, 34821)
seluruhnya mendahului baris tertaut pertama, jadi ia mengukur keadaan sebelum
penautannya pernah sekali pun berhasil.

Batasnya dicari, bukan dikira:

```
id tertaut PERTAMA : 37116  (2026-08-10T01:18:26.000Z)
id NULL TERAKHIR   : 43552
-> BERCAMPUR: ada NULL sesudah penautan pertama
```

Sejak baris tertaut pertama:

```
226 dari 232 baris 'sent' membawa wa_message_id

per jenis tujuan:
  grup/petugas (chat_id) : 226/227 tertaut
  pasien (nomor)         :   0/5   tertaut
```

Keenam yang tidak tertaut diperiksa satu per satu, bukan dihitung saja:

```
kiriman ke NOMOR sejak penautan pertama -- SELURUHNYA satu pemicu, satu ledakan:
  #37591 AUTO_REPLY kirim=2026-08-10T04:12:11.000Z ack=NULL panjang=119
  #37592 AUTO_REPLY kirim=2026-08-10T04:12:21.000Z ack=NULL panjang=307
  #37595 AUTO_REPLY kirim=2026-08-10T04:12:37.000Z ack=NULL panjang=307
  #37599 AUTO_REPLY kirim=2026-08-10T04:13:44.000Z ack=NULL panjang=307
  #37606 AUTO_REPLY kirim=2026-08-10T04:15:42.000Z ack=NULL panjang=307

kiriman ke GRUP yang tidak tertaut -- satu-satunya:
  #43552 QUEUE_REG kirim=2026-08-12T09:15:20.000Z
```

Sebaran `ack_level` atas seluruh `outbox` berstatus `sent`:

```
ack=NULL : 407     <- seluruhnya mendahului 37116
ack=1    : 147
ack=2    :  79
```

Delapan baris `sent` terakhir, seluruhnya tertaut:

```
#44211 kirim=2026-08-12T14:37:05Z ack=1 ack_at=14:37:34Z wa_message_id=TERTAUT (51 karakter)
#44112 kirim=2026-08-12T13:48:50Z ack=1 ack_at=13:48:50Z wa_message_id=TERTAUT (51 karakter)
#44019 kirim=2026-08-12T13:03:38Z ack=1 ack_at=13:03:38Z wa_message_id=TERTAUT (51 karakter)
#43926 kirim=2026-08-12T12:16:57Z ack=1 ack_at=12:16:58Z wa_message_id=TERTAUT (51 karakter)
```

Kesimpulan yang ditopang angka ini, dan tidak lebih dari itu: **penautan bekerja
untuk tujuan grup/petugas (226/227)**; untuk kiriman ke NOMOR masih tak terjawab,
karena satu-satunya sampel yang ada adalah lima baris `AUTO_REPLY` dari satu
ledakan tiga menit. Nol dari lima BUKAN bukti bahwa kiriman ke nomor tidak pernah
menaut.

Baris uji dibersihkan (`DELETE ... WHERE body LIKE '%uji konfirmasi terkirim%'`,
5 baris) dan skrip sementaranya dihapus.

## Mode uji terbatas (`migrations/036`) -- supaya mode pasien tidak harus taruhan penuh

Skema diterapkan, dan nol-perubahan-perilaku dibuktikan pada baris yang sudah ada:

```
[migrate] jalankan 036_uji_terbatas.sql ... selesai

BILLING_READY  pasien  0
BOOK_CANCEL    pasien  0
BOOK_CONFIRM   pasien  0
BOOK_REMIND    tujuan  0

enum('pending','sending','sent','failed','failed_permanent',
     'skipped_no_contact','skipped_opt_out','skipped_uji_terbatas','expired')
```

Seluruh baris mendapat 0 = tanpa batas, jadi tidak satu pun pemicu berubah
perilaku. `core/ujiTerbatas.test.ts` (9 kasus) memaku penafsiran itu lebih dulu,
termasuk asersi bahwa `bolehKirimKePasien(0, 9999)` tetap `{boleh:true}`.

Gerbang pembagi-habis `core/outboxStatus.test.ts` tetap lolos dengan status baru,
dan `tsc` MENOLAK build sampai `OUTBOX_STATUS_LABEL`/`OUTBOX_STATUS_HELP` diisi:

```
labels.ts(16,14): error TS2741: Property 'skipped_uji_terbatas' is missing
labels.ts(28,14): error TS2741: Property 'skipped_uji_terbatas' is missing
```

Itu gerbangnya bekerja -- status baru tidak bisa lolos tanpa keterangannya.

Kehadirannya di build produksi dibuktikan tanpa membuat akun admin sementara:

```
4 berkas  <- "Batas pasien per hari"
2 berkas  <- "Uji terbatas:"
16 berkas <- "Tertahan jatah uji"
```

## Riwayat status sesi (`wa_session_event`, `migrations/037`)

Migrasi diterapkan (`npm run migrate`), grant `DELETE` diterapkan manual lewat
root, lalu dibuktikan EMPIRIS (bukan diasumsikan) dengan koneksi sebagai
`wakhanza_rw` yang sesungguhnya:

```
INSERT (wakhanza_rw): OK
SELECT: OK, n=1
DELETE (wakhanza_rw): OK, affected=1
UPDATE (wakhanza_rw): DITOLAK sesuai rancangan -- ER_TABLEACCESS_DENIED_ERROR
```

`tsc --noEmit` bersih sesudah kelima titik penulisan (`wa-client.ts` x4,
`sessionCommand.ts` x1) dialihkan lewat `catatTransisiStatus()`. Dibuktikan
lagi lewat restart worker PRODUKSI sungguhan (bukan simulasi) -- dua transisi
tercatat persis sesuai urutan yang terlihat di log:

```
SELECT id, status_lama, status_baru, CONVERT_TZ(created_at,'+00:00','+07:00') FROM wa_session_event ORDER BY id DESC LIMIT 2;
  2 | ready          | authenticating
  3 | authenticating | ready
```

## Sebelas perbaikan operasional dari penilaian teknis 9 Agustus 2026, dan DUA yang sengaja TIDAK dikerjakan

**Git hook `pre-push`.** Dipasang (`install-git-hooks.ps1`) dan dijalankan LANGSUNG lewat `sh .git/hooks/pre-push` (bukan cuma dibaca kodenya) -- lolos, 606 uji, **16,519 detik** total (`typecheck` + `lint` + `test`).

**Uji integrasi `enqueuePemicuPasien()`.** `npm run test:int`: **42 uji lolos** (dari ~30 sebelumnya), termasuk regresi persis skenario bug dedup (baris yang seluruh kuncinya sudah ada di `outbox` pada mode `tujuan` DIBUANG penyaring; baris dengan tujuan baru yang belum terkirim DIPERTAHANKAN). Baris uji dibersihkan lewat DUA jalur (`idempotency_key LIKE 'INTTEST|%'` untuk kunci dasar, `chat_id IN (...)` untuk kunci turunan yang di-hash ulang) -- dibuktikan sisa 0 baris sesudahnya.

**Cadangan direstore SUNGGUHAN.** `restore-backup.ps1 -BackupFile backups\wakhanza-backup-20260809-020947.enc -RestoreDbName wakhanza_restore_test -AdminUser root`:

```
[ok] dipulihkan ke 'wakhanza_restore_test': 22 tabel.
  outbox: 420 baris
  template: 12 baris
  audit_log: 487 baris
  patient_contact: 4858 baris
  app_user: 1 baris
```

Database uji di-`DROP` sesudah diperiksa. Pemeriksaan selisih ukuran di `backup.ps1` diuji lewat backup SUNGGUHAN kedua di hari yang sama: `wakhanza-backup-20260809-140016.enc` (46,08 MB) dibandingkan dengan yang jam 02:09 (45,33 MB) -> "selisih ukuran vs cadangan sebelumnya: 1.6%, dalam batas wajar" -- jalur `Send-BackupAlert` (query `alert.webhook_url` lewat `mysql` langsung) diverifikasi terpisah menghasilkan string kosong yang benar (URL memang belum diisi).

**Peringatan dasbor webhook kosong.** `tsc --noEmit` dan `eslint` bersih atas `AlertConfigWarning.tsx` + `page.tsx`. Logikanya `webhookConfigured={Boolean(alertWebhookUrl)}` -- diverifikasi lewat pembacaan `getSetting('alert.webhook_url')` yang sama dipakai `worker/alert.ts`, jadi tidak bisa menyimpang dari kebenaran yang dipakai worker.

**Akun admin cadangan.** `npm run users -- add pemulihan "Akun Pemulihan (cadangan)" admin <sandi-acak>` -> `[ok] pengguna 'pemulihan' dibuat sebagai admin.`, dikonfirmasi lewat `npm run users -- list` (2 admin aktif), tercatat `audit_log` (jalur produksi, bukan INSERT manual).

**Investigasi baca-saja poli sensitif.** `SELECT kd_poli, nm_poli, status FROM poliklinik` (26 baris) + pencarian kata kunci PRD F4.3 terhadap `alca` sungguhan -- hasil dan jumlah kunjungan per kandidat tercatat di CLAUDE.md "Yang masih perlu keputusan rumah sakit". Nol baris ditulis ke `app_setting`.

**Draf aturan balasan otomatis.** `AutoReplyRule.create({..., isActive: false})` dua kali, dikonfirmasi lewat `SELECT label, is_active FROM auto_reply_rule`: kedua baris baru (`id=8`, `id=9`) `is_active=0`, empat baris lama tidak tersentuh.

**Pembaruan dependensi.** `postcss` 8.5.25->8.5.26 (dalam rentang semver `^8.5.25` yang sudah ada). `git diff --stat` mengonfirmasi cakupannya sempit (16 baris `package-lock.json`, 2 baris `package.json`); 606 uji + `tsc` + `eslint` + `next build` tetap lolos sesudahnya.

**TIDAK dikerjakan** (`tujuan_mode` ke pasien sungguhan, isi `privacy.sensitive_poli_codes`): dibuktikan negatif -- `SELECT batas_pasien_harian FROM template` seluruhnya `0`, dan `privacy.sensitive_poli_codes` tetap `[]` di akhir sesi (lihat "Pemeriksaan menyeluruh" di bawah).

### Kaskade restart dari SATU `pm2 restart`, dan versi PM2 yang tidak sama

Terjadi LANGSUNG saat mendeploy `wa_session_event` ke produksi -- bukan disimulasikan. Satu `pm2 restart wakhanza-worker` (dikonfirmasi hanya SATU perintah dijalankan) menaikkan `restart_time` dari 65 ke 80 dalam ~45 detik, dengan pola log yang identik berulang (proses baru muncul, minta proses sebelumnya mundur, yang lama keluar `exitCode:75`, jarak antar kemunculan ~5 detik -- sama persis `restart_delay: 5000`). Dibedakan dari kedua mode kegagalan yang sudah tercatat lewat pemeriksaan LANGSUNG:

```
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where CommandLine -like "*wwebjs_auth*"
jumlah proses chrome.exe terkait wwebjs_auth: 0   <- BUKAN Chromium yatim
```

Setiap baris log serah-terima menunjukkan `singleInstance.ts` bekerja BENAR (yang kalah minta mundur, yang menang dapat kunci) -- BUKAN dua proses berebut yang salah satunya jadi yatim. Dipulihkan lewat prosedur tiga langkah yang sudah terdokumentasi (`pm2 stop` -> konfirmasi 0 Chromium tersisa -> `pm2 start`): proses akhir (pid 15312) mencapai `ready` dalam **1,5 detik** (`"WhatsApp terautentikasi"` pukul `:35.853` -> `"WhatsApp siap"` pukul `:36.368`) dan bertahan (`restart_time` tetap 80, tidak naik lagi) selama diamati.

### Total memori Chromium sungguhan vs `max_memory_restart`

Diukur langsung pada proses produksi yang sedang hidup, bukan diperkirakan:

```
PID 11084 (Node, dilacak PM2)              : 178 MB
10x chrome.exe anak-cucu (turunan Puppeteer): 973,7 MB total
Ambang max_memory_restart                  : 800 MB (838.860.800 byte)
```

Kesepuluh proses `chrome.exe` diidentifikasi lewat `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where CommandLine -like "*wwebjs_auth*"` dan dijumlahkan lewat `WorkingSet64` masing-masing. Total 973,7 MB sudah di atas ambang 800 MB, sementara PM2 (yang cuma mengukur `PID 11084`) melaporkan 178 MB -- jauh di bawahnya. `max_memory_restart` karena itu terbukti TIDAK PERNAH bisa terpicu oleh pertumbuhan memori Chromium yang sesungguhnya, terlepas dari topologi peluncuran Node (§ "Enam jebakan Windows" sudah menutup jebakan `tsx` CLI vs `node --import tsx`, tapi itu jebakan yang berbeda).

## Panel pertanyaan tak terjawab (`/balasan-otomatis`)

Angka yang melahirkannya, diukur atas 30 hari produksi:

```
SELECT dibalas, COUNT(*) FROM inbound_message WHERE created_at >= NOW() - INTERVAL 30 DAY GROUP BY 1;
0  207
1   11
```

`core/pertanyaanTakTerjawab.test.ts` -- 14 kasus lolos.

Dijalankan atas data produksi sungguhan, hasil SEBELUM penyaring kebisingan
ditambahkan:

```
pesan perorangan tak terjawab 30 hari : 84 (berteks: 24)
kata kunci aturan terpasang           : 19

    3x apotik      3x harga       2x 40y4th4    2x abaikan
    2x adalah      2x ado         2x alca       2x batusangkar
    2x bayar       2x bit         2x buka       2x cd260781880
    2x https       2x hubungi     2x invoice
```

Dua hal yang terlihat dari situ dan langsung diperbaiki: token bercampur
huruf-angka (`40y4th4`, `cd260781880` -- kode promo dan id transaksi dari pesan
promosi) serta potongan tautan (`https`, `bit`) mendominasi dan tidak akan pernah
jadi aturan; dan angka 84 membohongi dasar analisisnya karena hanya **24** pesan
yang benar-benar berteks. Keduanya dipatok uji tersendiri yang komentarnya
menyebut nilai yang benar-benar ditemukan.

Yang tersisa sesudah penyaringan adalah yang memang berguna: `apotik` dan `harga`,
masing-masing 3 pesan berbeda -- pertanyaan apotek yang nyata dan belum punya
aturan.

Kehadirannya di build produksi:

```
2 berkas  <- "Kata yang sering ditanya tapi belum punya aturan"
2 berkas  <- "Belum bisa dianalisis"
```

## Pemeriksaan menyeluruh sesudah keempatnya

```
npm run typecheck   bersih
npm run lint        bersih
npx jest            36 suite, 606 uji lolos   (dari 553 sebelum sesi ini)
npm run build       Compiled successfully in 6.0s
npm run migrate     035 dan 036 diterapkan
```

Keadaan akhir worker: `wa_session.status = ready`, denyut 16 detik (diukur lewat
`CONVERT_TZ`), satu pid, siklus berjalan normal, nol galat sejak instance
terakhir. `wakhanza-web` menjawab HTTP 200 pada `/login`.

## Pemeriksaan menyeluruh sesudah sebelas perbaikan operasional (9 Agustus 2026, lanjutan)

```
npm run typecheck   bersih
npm run lint        bersih
npx jest             36 suite, 606 uji lolos
npm run test:int     3 suite, 42 uji lolos     (dari ~30 sebelum sesi ini)
npm run build        Compiled successfully, 25 route
npm run verify:db    lolos -- sik tulis DITOLAK, audit_log DELETE/UPDATE DITOLAK, wakhanza 23 tabel
npm run verify:plans lolos
npm run migrate      037 diterapkan
```

Deploy dua tahap: `pm2 restart wakhanza-web` (HTTP 200 di `/login` sesudahnya)
lalu `pm2 restart wakhanza-worker` -- yang kedua memicu kaskade restart baru
(lihat "Kaskade restart dari SATU pm2 restart" di atas), dipulihkan lewat
prosedur tiga langkah terdokumentasi. Keadaan akhir, diukur sesudah proses
stabil selama 7 menit tanpa restart tambahan:

```
wakhanza-web    : online, restart_time=4,  uptime 10m, 109,6 MB
wakhanza-worker : online, restart_time=80, uptime 7m,  168,7 MB
wa_session      : status=ready, denyut 7 detik
```

`git status --short`: hanya `src/core/watermark.ts` tersisa tak terlacak
(sengaja, di luar cakupan sesi ini). Tujuh commit sebelumnya sudah di-push;
seluruh pekerjaan sesi ini BELUM di-commit pada titik pemeriksaan ini.

## Variabel BROADCAST (`core/broadcastVars.ts`) -- satu pemetaan, dan yang sengaja tetap tidak ada

Dijalankan 9 Agustus 2026, sesudah laporan bahwa "+ Sisipkan variabel" di
`/broadcast` dan `/broadcast-terjadwal` lebih sempit daripada di
`/administrasi` dan `/template`.

**Duplikasi yang ditemukan.** Literal pemetaan yang sama persis
(`{ ...identityVars(identity), nama_pasien: row.nm_pasien ?? '', no_rm: row.no_rkm_medis }`)
berada di EMPAT berkas sebelum perbaikan:

```
src/app/(dashboard)/broadcast/actions.ts:123           kirim manual
src/worker/broadcastScheduleRunner.ts:127              kirim terjadwal
src/app/(dashboard)/broadcast/page.tsx:57              pratinjau
src/app/(dashboard)/broadcast-terjadwal/page.tsx:91    pratinjau
```

Sesudahnya keempatnya memanggil `broadcastVars(row, identity)`. `identityVars()`
TETAP dipakai tujuh pemanggil lain (`autoReply`, `pollerBooking`, `scheduler`,
`sisipCycle`, `stokReply`), jadi ia bukan ekspor mati.

**Gerbang, seluruhnya lolos:**

```
npm run typecheck   -> bersih
npm run lint        -> bersih
npx jest            -> 37 suite, 616 uji lolos (sebelumnya 606; +10 dari broadcastVars.test.ts)
npm run build       -> sukses
npm run verify:plans-> lolos
npm run verify:db   -> lolos (sik tulis DITOLAK, audit_log DELETE/UPDATE DITOLAK)
```

`verify:plans` dan `verify:db` dijalankan walau tidak ada query yang disentuh --
keempat kolom yang kini dipakai (`nm_kab`, `nm_kec`, `nm_kel`,
`tgl_kunjungan_terakhir`) sudah lebih dulu ada di `SELECT_DAN_JOIN` milik
`khanza/pasienSegment.ts`, jadi **nol kolom `sik` baru diambil**.

**Uji "membagi habis" DIBUKTIKAN MENGGIGIT ke dua arah**, bukan diasumsikan.
Kedua kerusakan disengaja lalu dikembalikan:

```
arah 1 -- tambah 'kota' ke BROADCAST_TEMPLATE_VARIABLES saja:
  Expected - 1 / Received + 0
  -   "kota"
  Tests: 1 failed, 9 passed

arah 2 -- tambah nama_poli ke broadcastVars() saja:
  Expected - 0 / Received + 1
  +   "nama_poli"
  Tests: 1 failed, 9 passed
```

Arah kedua sekaligus membuktikan gerbangnya menjaring `{nama_poli}` yang
menyelinap ke konteks broadcast -- kebocoran privasi, bukan sekadar kerapian.

**Penanda bawaan Khanza terbukti dibuang.** `nm_kel='KELURAHAN'`,
`nm_kec='KECAMATAN'`, `nm_kab='KABUPATEN'` ketiganya dirender string kosong
(dipatok `broadcastVars.test.ts`), bersama penanda umum `'-'`, `null`, dan
spasi. Tanpa ini 89% pasien di mesin ini menghasilkan "Warga KECAMATAN,".
`tgl_kunjungan_terakhir='0000-00-00'` -> string kosong, bukan "Invalid Date".

**Build memuat perubahannya**, diperiksa tanpa menyentuh satu pun akun:

```
tanggal_kunjungan -> 24 berkas di .next/server
kelurahan         -> 28
kecamatan         -> 32
kabupaten         -> 32
```

**Pemasangan.** `broadcast_schedule` diperiksa lebih dulu dan berisi **0 baris**
(`SELECT COUNT(*)`, bukan `information_schema.TABLE_ROWS` -- pelajaran 030),
jadi kode lama di worker tidak punya apa pun untuk dijalankan dan worker
SENGAJA tidak dimulai ulang. Hanya `wakhanza-web`:

```
pm2 restart wakhanza-web  -> online, pid 16352, restart_time=5
wakhanza-worker           -> TIDAK disentuh: pid 15312, uptime 91m, restart_time=80 (tetap)
curl /broadcast           -> HTTP 307 -> /login   (gerbang auth utuh)
curl /login               -> HTTP 200
```

Restart counter worker tetap 80 -- angka yang sama sejak pemulihan kaskade
restart sesi sebelumnya, jadi tidak ada kaskade baru yang terpicu.

**Yang masih tertunda dan wajib dikerjakan sebelum jadwal broadcast pertama
dibuat**: `pm2 stop wakhanza-worker` -> pastikan Chromium bersih -> `pm2 start
wakhanza-worker`. Tanpa itu jadwal yang memakai keempat variabel baru
mengirimkannya KOSONG tanpa satu pun galat.

## Pagar watermark: kursor tidak boleh melampaui waktu berjalan (`core/watermark.ts`)

Dijalankan 10 Agustus 2026.

**Keadaan awal: berkasnya ada, pemanggilnya tidak.** `src/core/watermark.ts`
tersisa tak terlacak dari sesi sebelumnya. Diukur atas seluruh repo (di luar
`.next/`), `batasiWatermark` dan `TOLERANSI_WATERMARK_MS` muncul **hanya di
berkas itu sendiri** -- nol impor, nol pemanggil, dan tidak ada
`watermark.test.ts`. `advanceCursor()` (`src/worker/cursor.ts:24`) masih menulis
`newCursorTs` apa adanya. Jadi lubangnya masih terbuka seluruhnya; yang ada cuma
obatnya, belum diminum.

Itu keadaan yang lebih berbahaya daripada berkasnya tidak ada sama sekali:
komentarnya rapi dan menjelaskan insiden sungguhan, sehingga pembaca berikutnya
menyimpulkan lubangnya sudah tertutup.

**Keadaan produksi saat diperiksa** (baca-saja lewat Sequelize, karena
`heartbeat_at`/`cursor_ts` disimpan UTC sementara `NOW()` MariaDB mengembalikan
WIB -- selisih 25.200 detik):

```
sekarang: 2026-08-10T02:45:13Z   (8 baris poll_cursor)
QUEUE_REG                2026-08-10T02:40:16Z     -5 menit
FARMASI_PENYERAHAN       2026-08-08T08:12:08Z  -2553 menit
FARMASI_VALIDASI         2026-08-05T10:01:21Z  -6764 menit
BILLING_READY / BOOKING_SCAN / PHARMACY_READY /
RESULT_READY_LAB / RESULT_READY_RADIOLOGI
                         2026-08-03T12:37:15Z  -9488 menit
0 baris melampaui waktu berjalan lebih dari toleransi 5 menit.
```

Kursor yang berumur hari BUKAN gejala: `runSisipCycle` keluar lebih dulu
("pemicu nonaktif atau template belum ada") sebelum memajukan kursornya, jadi
pemicu yang belum dinyalakan memang membekukan watermarknya. `QUEUE_REG` -5
menit menunjukkan jalur yang aktif memang bergerak.

Jadi bug-nya tidak sedang menyala, dan itu keadaan normalnya -- lubangnya
terbuka pada hari ada satu kolom jam salah ketik.

**Uji unit dibuktikan MENGGIGIT, bukan diasumsikan.** `src/core/watermark.test.ts`
berisi 9 kasus. Dengan implementasi utuh: 9 lolos. Dengan pagarnya dirusak
sengaja (baris `if (lampau <= 0)` diganti pengembalian tanpa syarat):

```
Tests: 5 failed, 4 passed, 9 total
```

Keempat yang tetap lolos memang kasus "lewatkan apa adanya", yang benar untuk
kedua versi. Dipulihkan: 9 lolos.

**Pemasangannya dibuktikan lewat `advanceCursor` SUNGGUHAN terhadap database
`wakhanza`**, memakai kunci buangan `ZZ_UJI_WATERMARK` yang tidak dibaca poller
mana pun, dihapus di `finally`:

```
diminta  : 2026-08-10T15:51:42Z  (+13 jam, meniru jam_reg 19:59 pada pendaftaran 06:15)
tersimpan: 2026-08-10T02:51:42Z  (+0 menit)

OK  nilai dipotong, tidak disimpan apa adanya
OK  tidak melampaui waktu berjalan
OK  waktu kejadian wajar (-45 menit) disimpan apa adanya

baris uji dibersihkan: ya
```

Berikut baris peringatannya, yang sebelumnya tidak pernah ada:

```
WARN watermark diminta melampaui waktu berjalan, dipotong -- periksa kolom jam di Khanza
     triggerCode: "ZZ_UJI_WATERMARK"  lampauMenit: 775  rowsSeen: 1
```

Pemeriksaan kedua (-45 menit lewat utuh) sama pentingnya dengan yang pertama:
pagar yang memotong segalanya sama rusaknya dengan pagar yang tidak ada, dan
akibatnya kursor mandek selamanya.

**Titik pemasangannya dipilih dari pengukuran, bukan selera.** `advanceCursor`
punya **enam pemanggil di empat berkas** -- `sisipCycle.ts:152`,
`pollerBooking.ts:63`, `farmasiRunner.ts:158` dan `:184`, `bpjsRunner.ts:159` dan
`:188` -- dan ia satu-satunya tempat `poll_cursor.cursor_ts` dimajukan.
`recordCursorError` menulis kolom yang sama tapi mempertahankan nilai lamanya
(`row?.cursorTs`), jadi ia tidak pernah memajukan dan tidak perlu pagar.

**Pagarnya MENYEMBUHKAN, bukan cuma mencegah**, dan itu terbukti dari bentuk
kodenya: ketiga runner menyemai `let maxTs = cursorTs` (`sisipCycle.ts:96`,
`farmasiRunner.ts:110`, `bpjsRunner.ts:126`), jadi kursor yang telanjur rusak
diserahkan kembali ke `advanceCursor` pada siklus berhasil berikutnya lalu
ditarik ke sekarang. Tanpa itu, keputusan "boleh mundur" di `core/watermark.ts`
tidak akan pernah terpakai.

`pollerBooking.ts:63` menyerahkan `now`, jadi pagarnya tidak pernah menggigit di
sana -- benar menurut rancangan, bukan pengecualian yang perlu ditulis.

**Pemeriksaan menyeluruh:**

```
npx jest             39 suite, 650 uji lolos   (+9 di watermark.test.ts, dari 641)
npm run test:int      3 suite,  46 uji lolos
npx tsc --noEmit     bersih
npx eslint           bersih
npm run build        Compiled successfully
npm run verify:db    lolos -- sik tulis DITOLAK, audit_log DELETE/UPDATE DITOLAK, wakhanza 23 tabel
npm run verify:plans lolos
```

**Pemasangan.** `pm2 stop wakhanza-worker` -> Chromium pemegang sesi tersisa
diperiksa dan hasilnya **nol** -> `pm2 start wakhanza-worker`. Satu restart, dan
**tidak ada kaskade**: penghitung restart tetap 8. Proses lama keluar lewat jalur
IPC yang benar, terbaca di log sebagai `wakhanza-worker berhenti...` (exitCode 0)
lalu `sesi WhatsApp ditutup rapi` -- bukan mati mendadak. Pengganti tunggal
mencapai siap dalam ~1,6 detik:

```
wakhanza-worker memulai...
koneksi database terverifikasi (read-only sik, read-write wakhanza)
memulai siklus poller   pollIntervalMs 60000  scanIntervalMs 300000
siklus polling selesai  triggerCode QUEUE_REG  rowsSeen 1
WhatsApp siap
```

Kesehatannya diperiksa lewat **umur denyut**, bukan kolom `status` (yang bisa
tertinggal `ready` walau prosesnya sudah mati): `wa_session` `ready`, denyut **5
detik**, `last_error` kosong. Tidak ada baris `warn` watermark di log startup --
benar, karena tidak ada satu pun kursor yang melampaui waktu berjalan.

**Kebersihan.** Ketiga skrip `.tmp-*.mts` (periksa kursor, bukti pemasangan,
periksa denyut) dihapus; `git status --short` tidak menyisakan satu pun.
`wakhanza-web` tidak ikut di-restart -- perubahannya murni jalur worker.

## Memilih pasien satu per satu (`core/pilihanPasien.ts`)

### Cara bayar: SUDAH ADA, tidak ditambahkan

Diperiksa lebih dulu supaya tidak membangun ulang yang sudah jalan. `CheckboxList name="pj"` ada di `/broadcast` maupun `/broadcast-terjadwal`, dan ia benar-benar menggigit di SQL pada KEDUA bentuk query (`innerFilter` bentuk berjendela, `kunjunganFilter` bentuk semua-waktu). Rencananya dijaga pemeriksaan tersendiri:

```
[ok] BROADCAST_SEGMENT_SEMUA_PJ r ref kd_pj  rows~1  (Using index)
[ok] BROADCAST_SEGMENT_SEMUA_PJ p0 eq_ref PRIMARY  rows~1
```

### Query bentuk ketiga tidak memindai `reg_periksa`

`npm run verify:plans`, baris baru:

```
[ok] BROADCAST_PILIH_RM   <derived2> (hasil subquery, sudah tersaring)  rows~2
[ok] BROADCAST_PILIH_RM   p eq_ref PRIMARY  rows~1
[ok] BROADCAST_PILIH_RM   lv eq_ref PRIMARY  rows~1
[ok] BROADCAST_PILIH_RM   pj eq_ref PRIMARY  rows~1
[ok] BROADCAST_PILIH_RM   kb eq_ref PRIMARY  rows~1
[ok] BROADCAST_PILIH_RM   kc eq_ref PRIMARY  rows~1
[ok] BROADCAST_PILIH_RM   kl eq_ref PRIMARY  rows~1
[ok] BROADCAST_PILIH_RM   r range no_rkm_medis  rows~2  (Using index)
```

`range no_rkm_medis (Using index)` -- tidak ada izin pindai penuh yang diberikan, dan tidak dibutuhkan.

### `fetchPatientsByRm` terhadap database produksi (baca-saja)

Dijalankan atas `alca`. Tidak satu pun data pasien dicetak; yang dilaporkan cuma jumlah dan kecocokan himpunan.

```
segmen 120 hari      : 1000 pasien
diminta              : 3 no. RM
dikembalikan         : 3
cocok persis         : true
satu baris per pasien: true
kolom lengkap        : true
4 diminta -> ketemu  : 3  (selisih inilah yang diperingatkan di layar)
daftar kosong        : 0 baris, tanpa query
sik tetap read-only  : ya
```

Baris keempat dari bawah adalah yang membuktikan peringatan "dicentang vs ketemu" di `PenerimaBar` bukan hiasan: satu no. RM karangan ikut diminta dan memang tidak dikembalikan. Baris terakhir dijalankan di skrip yang sama -- `CREATE TEMPORARY TABLE` terhadap `sik` tetap ditolak.

### Percabangan jadwal, termasuk yang paling mahal kalau salah

```
[ok] mode pilih terbaca dari FormData
[ok] noRkmMedis tersimpan utuh
[ok] penerima = daftar centang (4 dari 4)
[ok] tidak ada penyusup di luar daftar
[ok] pilih + followup -> followup DIMATIKAN
[ok] pilih tanpa centang bukan jadwal pilih
[ok] jadwal lama bukan mode pilih
[ok] jadwal lama tetap lewat jendela (564 vs 564)
```

Dijalankan lewat `parseScheduleFilters()` dengan bentuk FormData yang PERSIS dikirim `ScheduleForm`, lalu `fetchSegmentUntukJadwal()` -- rantai yang sama dipakai worker. Dua baris terakhir yang membuktikan nol perubahan perilaku: konfigurasi tanpa field `mode` sama sekali (bentuk seluruh jadwal yang dibuat sebelum fitur ini ada) tetap melewati jendela tanggal dan mengembalikan jumlah yang sama persis dengan `fetchPatientSegment` langsung.

### Gerbang

```
tsc --noEmit                 -> bersih
eslint .                     -> bersih
Test Suites: 41 passed, 41 total
Tests:       694 passed, 694 total     (dari 680; 14 uji baru di pilihanPasien.test.ts)
verify:db lolos.
verify:plans lolos.
next build -> Compiled successfully
```

Penanda baru benar-benar ada di build yang dilayani, bukan cuma di berkas sumber:

```
6  <- Hanya yang dicentang
4  <- Kosongkan centang
2  <- daftar centang tetap
2  <- Daftar pilihan,
2  <- menggantikan jendela tanggal
```

### Pemasangan: worker DIMULAI ULANG, dan kenapa kali ini tidak ditunda

Preseden yang tercatat untuk perubahan yang menyentuh `broadcastScheduleRunner.ts` adalah TIDAK menyalakan ulang worker (`broadcast_schedule` berisi 0 baris, jadi kode lamanya tidak punya apa pun untuk dijalankan). Preseden itu **tidak berlaku di sini**, dan bedanya bukan selera: kode worker LAMA membaca `filter_json` lewat `scheduleFiltersToSegment()`, yang mengabaikan `noRkmMedis` sepenuhnya lalu mengirim ke SELURUH jendela. Staf mencentang tiga orang, ratusan yang menerima, tanpa satu pun galat. Kegagalan sebelumnya cuma variabel kosong; yang ini salah kirim massal.

Keadaan sebelum operasi:

```
broadcast_schedule  : 0 baris, 0 aktif
wa_session status   : ready | umur denyut: 2 detik
```

Prosedur tiga langkah yang terdokumentasi, dari PowerShell:

```
pm2 restart wakhanza-web                       -> online
pm2 stop wakhanza-worker                       -> stopped
Chromium pemegang sesi tersisa: 0
pm2 start wakhanza-worker                      -> online
SIAP  status=ready denyut=14s  (percobaan 1)
```

Tanpa kaskade: penghitung restart TIDAK naik (`wakhanza-web` 7, `wakhanza-worker` 10 -- sama seperti sebelum operasi), pid stabil, sesi `ready` pada percobaan polling pertama.

Web dilayani instance PM2 sungguhnya di port 3100, dan gerbang autentikasinya tetap tegak:

```
/broadcast           -> HTTP 307  http://127.0.0.1:3100/login
/broadcast-terjadwal -> HTTP 307  http://127.0.0.1:3100/login
/ringkasan           -> HTTP 307  http://127.0.0.1:3100/login
```

### Yang TIDAK diverifikasi, dan sengaja dikatakan

Perilaku sesudah login (checkbox yang bertahan lintas pencarian, radio mode, tombol Terapkan) **tidak diuji lewat peramban**. Membuktikannya menuntut akun admin berhak penuh pada sistem yang memegang data pasien, dan aturan proyek ini menempuhnya hanya bila memang tidak ada jalan lain. Di sini ada: aturan yang gagal DIAM (`pilihanTersembunyi`) dipindah ke fungsi murni dan dijaga lima uji, sementara sisa kabelnya (atribut `form=`) gagal berisik pada pemakaian pertama -- tidak ada di antaranya yang bisa salah tanpa terlihat. Tidak ada pesan WhatsApp yang dikirim selama verifikasi ini, dan tidak satu pun baris `broadcast_schedule` dibuat.

## Kotak cari pasien DI ATAS TABEL, dan tombol submit bawaan yang wajib menyertainya

Diverifikasi 10 Agustus 2026. Nol pesan WhatsApp dikirim, nol baris ditulis ke database mana pun, dan `sik` tidak disentuh selain lewat gerbang baca-saja yang sudah ada.

### Perilaku Enter DIUKUR di Chromium, bukan dibaca dari spesifikasi

Replika struktur kedua halaman (deretan tombol preset bernama, lalu kotak cari) dilayani di `127.0.0.1:3211` lalu dijalankan di Chromium bawaan proyek. Yang diketik `Budi`, yang ditekan `Enter`:

```
/sebelum  -> ?dateFrom=2026-01-01&preset=1m&cari=Budi
             cari="Budi"  preset="1m" (rentang tanggal ditimpa)
/sesudah  -> ?dateFrom=2026-01-01&cari=Budi
             cari="Budi"  preset=TIDAK IKUT
```

`/sebelum` adalah bentuk yang berjalan di produksi sampai perubahan ini: `preset=1m` ikut terkirim tanpa seorang pun menekannya, dan `parseFilters` (`broadcast/filters.ts:80`) memberinya prioritas di atas `dateFrom`/`dateTo`. `parseScheduleFilters` (`broadcast-terjadwal/filters.ts:35`) melakukan hal yang sama terhadap `lookback`. `/sesudah` adalah bentuk dengan `TombolSubmitBawaan` sebagai anak pertama form.

### `sr-only` benar-benar dirender di CSS hasil build

Tombol bawaan harus DIRENDER supaya peramban memakainya; itu yang membedakannya dari `hidden`. Dari `.next/static/chunks/*.css` sesudah `npm run build`:

```
.sr-only{clip:rect(0, 0, 0, 0);white-space:nowrap;border-width:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}
```

Sama persis dengan gaya inline yang dipakai replika `/sesudah` di atas.

### Uji `hrefTanpa`, dan buktinya MENGGIGIT

```
PASS src/core/hrefFilter.test.ts
  hrefTanpa
    v membuang kunci yang diminta, menahan sisanya
    v bisa membuang beberapa kunci sekaligus
    v larik dipertahankan sebagai kunci BERULANG
    v undefined dilewati, larik kosong tidak meninggalkan kunci
    v tanpa sisa parameter -> tanpa tanda tanya
    v nilai disandikan, bukan disambung mentah
    v membuang kunci yang tidak ada tidak mengubah apa pun
Tests:       7 passed, 7 total
```

Aturan larik dirusak sengaja (`qs.append(kunci, nilai.join(','))`) lalu dipulihkan:

```
--- dirusak sengaja: larik digabung berkoma ---
Tests:       2 failed, 5 passed, 7 total
--- dipulihkan ---
Tests:       7 passed, 7 total
```

### Gerbang

```
tsc --noEmit                 -> bersih
eslint .                     -> bersih
Test Suites: 42 passed, 42 total
Tests:       701 passed, 701 total
verify:db lolos.
verify:plans lolos.
npm run build                -> sukses
```

Penanda kalimat baru ada di build: `grep -rlF "Nama, no. RM, atau no. pendaftaran" .next/server` menemukan `src_0-z232q._.js`.

### Pemasangan: web dimulai ulang, worker TIDAK -- dan kali ini itu yang benar

Perubahan ini seluruhnya di `src/app/(dashboard)/**` plus `src/core/hrefFilter.ts`, yang tidak diimpor satu pun berkas worker. Berbeda dari perubahan pemilihan pasien sebelumnya, di sini tidak ada kode worker yang berubah, jadi menyalakannya ulang cuma menanggung risiko kaskade restart tanpa imbalan apa pun.

```
pm2 restart wakhanza-web  -> [PM2] [wakhanza-web](4) v
wakhanza-web     online  uptime 4s   restart 9
wakhanza-worker  online  uptime 25m  restart 10   (tidak disentuh)
sesi worker: {"status":"ready","umur_detik":7}
```

Keempat halaman tetap dijaga gerbang autentikasi sesudah pemasangan:

```
/broadcast           : 307 -> http://127.0.0.1:3100/login
/broadcast-terjadwal : 307 -> http://127.0.0.1:3100/login
/nomor-bermasalah    : 307 -> http://127.0.0.1:3100/login
/antrean             : 307 -> http://127.0.0.1:3100/login
```

### Yang TIDAK diverifikasi, dan kenapa itu bisa diterima

Tampilan sesudah login tidak diuji lewat peramban -- itu menuntut akun admin berhak penuh pada sistem yang memegang data pasien. Yang bisa gagal DIAM di perubahan ini cuma dua, dan keduanya sudah ditutup dengan bukti tersendiri: perilaku Enter (diukur di Chromium atas replika strukturnya) dan perakitan URL "hapus pencarian" (uji unit yang dibuktikan menggigit). Sisanya -- letak kotak di dalam JSX, atribut `form=`, `readOnly` pada mode centang -- gagal BERISIK pada pemakaian pertama atau memang terlihat langsung di layar.

## Segmen pasien TIDAK dibaca sampai diminta (`core/segmentGate.ts`)

### Gerbangnya diuji unit, dan dibuktikan MENGGIGIT ke dua arah

```
npx jest src/core/segmentGate
PASS src/core/segmentGate.test.ts
Tests: 8 passed, 8 total
```

Delapan uji menutup: halaman polos tidak membaca apa pun, kunci filter yang ADA tapi kosong tetap bukan permintaan, pencarian membaca, Terapkan membaca, tombol preset membaca, mode pilih SELALU membaca, dan urutan menangnya (`pilih` > `cari` > `diminta`).

Dua kerusakan disengaja, masing-masing menjatuhkan uji yang memang menjaganya:

```
# 1. terisi() dibuat selalu true (yaitu: "ada kuncinya" dianggap "diminta")
Tests: 1 failed, 7 passed
  x pemicuSegmen > kunci filter yang ada tapi KOSONG tetap bukan permintaan

# 2. cabang modePilih dihapus
Tests: 2 failed, 6 passed
  x pemicuSegmen > mode pilih SELALU dibaca, walau tanpa pencarian maupun Terapkan
  x pemicuSegmen > mode pilih menang atas pencarian
```

Kerusakan pertama itulah yang paling perlu dijaga: form GET kedua halaman selalu mengirim `dateFrom`/`dateTo`/`kab`/`kec`/`pj` walau kosong, jadi gerbang yang menyimpulkan "ada filter -> baca" akan selalu lolos pada pemuatan pertama dan fiturnya mati DIAM -- tidak ada yang berubah di layar, cuma query yang tetap jalan seperti sebelumnya.

### `lookbackDays: 0` = tanpa batas bawah

```
npx jest src/core/schedule
PASS src/core/schedule.test.ts
Tests: 47 passed
```

Tiga uji baru: `lookbackDays: 0` menghasilkan `dateFrom === null` (dan `dateTo` tetap "sekarang" apa adanya), angka negatif diperlakukan sama, dan jendela bernilai tetap TIDAK berubah perilakunya. Ketiga puluh dua uji `resolveScheduleWindow`/`computeNextRunAt` yang sudah ada lolos tanpa satu asersi pun diubah -- yang berubah cuma penegasan non-null pada tipe barunya (`Date | null`).

### Celah diam di `parseFilters`, dan buktinya menggigit

```
npx jest -t "pencarian"
PASS src/app/(dashboard)/broadcast/filters.test.ts
```

Tiga uji baru: `?cari=Budi` tanpa kunci tanggal sama sekali menghasilkan semua-waktu; `?cari=` kosong tetap jatuh ke jendela bawaan; dan rentang yang benar-benar dipilih staf TIDAK dibatalkan oleh pencarian.

Dibuktikan menggigit dengan mengembalikan kondisinya ke bentuk lama:

```
Tests: 1 failed
  x parseFilters > pencarian tanpa kunci tanggal = semua waktu, bukan jendela bawaan
```

### Gerbang lengkap: seluruh suite

```
npm test
Test Suites: 43 passed, 43 total
Tests:       715 passed, 715 total
```

(dari 42 suite / 701 uji sebelum perubahan ini: +1 suite `segmentGate`, +14 uji)

```
npm run typecheck            -> bersih
npm run lint                 -> bersih
npm run verify:db            -> verify:db lolos.   (sik: tulis DITOLAK; audit_log: DELETE/UPDATE DITOLAK)
npm run verify:plans         -> verify:plans lolos.
npm run build                -> sukses, /broadcast-terjadwal/[id] terdaftar sebagai rute dinamis
```

`verify:plans` layak disebut tersendiri: bawaan jendela yang berubah jadi semua-waktu memindahkan bentuk query segmen dari `BROADCAST_SEGMENT` ke `BROADCAST_SEGMENT_SEMUA`, dan kedua bentuk itu sudah punya pemeriksaan rencananya masing-masing sejak rentang tanggal `/broadcast` jadi opsional. Tidak ada pemeriksaan baru yang perlu ditambahkan, dan itu KONFIRMASI bahwa perubahannya memang memakai jalan yang sudah dijaga alih-alih membuat jalan baru.

### Penanda di build

```
grep -rl "<penanda>" .next/server
[4 berkas]  Daftar pasien belum dibaca
[6 berkas]  Tampilkan dulu penerimanya
[2 berkas]  Jendela semua waktu
[11 berkas] seluruh riwayat kunjungan
```

## Detail jadwal tersimpan (`/broadcast-terjadwal/[id]`)

### Rute terdaftar dan tetap dijaga gerbang autentikasi

```
/broadcast              -> 307  http://127.0.0.1:3100/login
/broadcast-terjadwal    -> 307  http://127.0.0.1:3100/login
/broadcast-terjadwal/37 -> 307  http://127.0.0.1:3100/login
/broadcast-terjadwal/999-> 307  http://127.0.0.1:3100/login
```

Id yang tidak ada (999) ikut diperiksa: ia harus di-redirect ke login SEBELUM `notFound()`, bukan membocorkan ada-tidaknya sebuah jadwal kepada yang belum masuk. Perannya sendiri (admin) diperiksa di dalam halaman lewat `session.user.role`, pola yang sama dengan `/audit` dan `/broadcast`.

```
grep -rl "<penanda>" .next/server
[2 berkas] Bila jalan sekarang
[2 berkas] Lihat penerima
```

### Penanda di build

Halaman detail memakai `fetchSegmentUntukJadwal()` yang SAMA dipakai worker (`worker/broadcastScheduleRunner.ts`) dan `createScheduleAction`. Dibuktikan lewat pembacaan impor, bukan diasumsikan: ketiganya mengimpor dari `@/khanza/broadcastSchedule`, dan tidak ada cabang penerima kedua di mana pun.

## Pemasangan: worker DAN web dimulai ulang -- dan penundaan sebelumnya nyaris menggigit

Berbeda dari perubahan sebelumnya, kali ini worker WAJIB ikut: `resolveScheduleWindow()` berubah artinya untuk `lookbackDays: 0`. Kode LAMA menghitung `now - 0 hari` dan menghasilkan jendela SATU HARI; kode baru menghasilkan tanpa-batas. Jadwal yang disimpan lewat dashboard baru sementara worker masih memegang kode lama karena itu akan menyasar penerima yang sama sekali berbeda, tanpa satu pun galat.

Karena itu urutannya WORKER DULU, baru web -- kalau terbalik, ada jendela waktu tempat staf bisa menyimpan jadwal yang worker lama salah tafsirkan.

### Keadaan yang ditemukan, dan klaim `CLAUDE.md` yang terbukti basi

Berkas itu menyatakan penundaan restart sebelumnya aman "karena `broadcast_schedule` berisi 0 baris". Diperiksa langsung lewat koneksi aplikasi sendiri:

```
broadcast_schedule : 6      (seluruhnya AKTIF)
broadcast_campaign : 8
```

Keenamnya bermode `semua` dengan satu nama pasien di kotak cari -- yaitu persis alur kerja yang perubahan ini permudah. Jadi jalur yang dinilai "tidak punya apa pun untuk dijalankan" ternyata sudah berjalan. Klaimnya diperbaiki di `CLAUDE.md`.

### Prosedur tiga langkah, dijalankan apa adanya

```
pm2 stop wakhanza-worker                       -> [PM2] [wakhanza-worker](5) v
Get-CimInstance Win32_Process ... wwebjs_auth  -> Chromium sesi bersih: 0 proses
pm2 start wakhanza-worker                      -> online
pm2 restart wakhanza-web                       -> online
```

### Watchdog sesi terlihat bekerja UTUH untuk pertama kalinya

Sesi tidak langsung mencapai `ready` sesudah start -- ia tersangkut `authenticating`, persis mode kegagalan yang `sessionWatchdog()` ada untuk menangani. Kali ini seluruh rangkaiannya terekam:

```
19:53:25  WhatsApp terautentikasi, menunggu ready          (pid 13960)
19:54:24  sesi WhatsApp belum siap  diamDetik: 60
   ...    (peringatan tiap 60 detik, naik terus)
20:08:24  sesi WhatsApp belum siap  diamDetik: 720
20:08:26  wakhanza-worker berhenti...  alasan: "sesi tidak mencapai ready"  exitCode: 1
20:08:49  WhatsApp terautentikasi, menunggu ready          (pid 7272)
20:08:49  WhatsApp siap                                     <- 517 ms kemudian
```

Tiga hal yang terbukti di sini, dan ketiganya sebelumnya cuma tertulis sebagai rancangan:

1. **Ambang 15 menit benar-benar menyala** (900 detik; peringatan terakhir 720 detik lalu keluar).
2. **Keluarnya lewat `shutdown()`, bukan `process.exit()`** -- terbukti dari baris `"wakhanza-worker berhenti..."` yang memang baris pertama fungsi itu. Inilah yang membuat state sesi tidak setengah tertulis, dan karena itu penggantinya mencapai `ready` dalam setengah detik alih-alih tersangkut lagi.
3. **Tidak ada kaskade restart**: satu proses pengganti, satu kali. Penghitung restart 5 -> 6, bukan melompat.

Keadaan akhir, diperiksa 85 detik sesudahnya dan stabil:

```
wakhanza-web     online  uptime 16m   restart 1
wakhanza-worker  online  uptime 85s   restart 6
wa_session       ready   heartbeat umur 19 detik
```

## Yang TIDAK diverifikasi, dan kenapa itu bisa diterima

**Tampilan sesudah login tidak diuji lewat peramban.** Itu menuntut akun admin berhak penuh pada sistem yang memegang data pasien sungguhan. Yang bisa gagal DIAM di perubahan ini sudah dipagari dari sisi lain: keputusan "baca atau tidak" seluruhnya di fungsi murni yang diuji unit berikut bukti menggigitnya, bentuk query yang dipilihnya dijaga `verify:plans`, dan penanda kalimatnya dibuktikan ada di build.

**Halaman detail belum pernah dibuka atas jadwal sungguhan.** Query penerimanya adalah `fetchSegmentUntukJadwal()` yang sama dipakai worker dan sudah berjalan atas keenam jadwal itu; yang belum terbukti adalah perakitan tampilannya. Kegagalan di situ berisik (galat render), bukan diam.

**Jadwal dengan `lookbackDays: 0` belum pernah benar-benar dieksekusi worker.** Keenam jadwal yang ada menyimpan angka jendelanya sendiri (30 dan 180) dan tidak tersentuh perubahan ini; nilai 0 baru muncul pada jadwal yang dibuat sesudah ini. Yang sudah dibuktikan adalah keputusan turunannya (`dateFrom === null`, uji unit) dan bahwa bentuk query yang lahir dari situ sudah dijaga rencananya.

## Mengeluarkan seorang penerima dari sebuah jadwal (`core/penerimaJadwal.ts`)

### Keempat pagarnya diuji unit

```
npx jest src/core/penerimaJadwal
PASS src/core/penerimaJadwal.test.ts
Tests: 11 passed, 11 total
```

Sebelas uji menutup: konversi dari jadwal berfilter, pengurangan biasa pada jadwal yang sudah berdaftar, urutan sisa yang dipertahankan, penolakan penerima terakhir (pada KEDUA bentuk jadwal), penolakan tindak lanjut, `windowMode: 'followup'` yang TIDAK menghalangi jadwal yang sudah berdaftar, penolakan no. RM yang tidak ada, penolakan segmen kelewat besar, batas yang tidak berlaku pada jadwal yang sudah berdaftar, dan urutan menang antar-penolakan.

### Dua pagar dibuktikan MENGGIGIT

```
# 1. pagar "penerima terakhir" dilepas
Tests: 2 failed, 9 passed
  x hapusPenerima > penerima terakhir DITOLAK, dan alasannya menyebut akibatnya
  x hapusPenerima > penerima terakhir DITOLAK juga pada jadwal yang sudah berdaftar

# 2. pagar tindak lanjut dilepas
Tests: 1 failed, 10 passed
  x hapusPenerima > jadwal tindak lanjut DITOLAK, dan diarahkan ke daftar tolak
```

Yang pertama itulah yang paling mahal kalau hilang, dan bentuk kegagalannya perlu dinyatakan: daftar `pilih` yang KOSONG membuat `isPilihSchedule()` mengembalikan false, sehingga jadwalnya jatuh kembali menjadi jadwal berfilter. Mengeluarkan orang terakhir karena itu bukan menghasilkan "jadwal tanpa penerima" melainkan "jadwal yang mengirim lagi ke SELURUH hasil filter aslinya" -- kebalikan persis dari yang diminta, tanpa satu pun galat.

### Gerbang lengkap

```
npm test
Test Suites: 44 passed, 44 total
Tests:       726 passed, 726 total
```

(dari 43 suite / 715 uji sebelum penambahan ini: +1 suite `penerimaJadwal`, +11 uji)

```
npm run typecheck   -> bersih
npm run lint        -> bersih
npm run build       -> sukses
```

### Terpasang dan tetap dijaga gerbang autentikasi

```
pm2 restart wakhanza-web  -> online, restart 2
/broadcast-terjadwal      -> 307  http://127.0.0.1:3100/login
/broadcast-terjadwal/37   -> 307  http://127.0.0.1:3100/login
```

Penanda di build:

```
grep -rl "<penanda>" .next/server
[4] Keluarkan
[4] berisi pasien yang tersisa
[4] berhenti menjaring pasien baru
[4] broadcast_schedule_hapus_penerima
[2] Mengeluarkan...
[9] tidak dipakai lagi
```

`broadcast_schedule_hapus_penerima` layak disebut tersendiri: itu nama peristiwa `audit_log`-nya, jadi keberadaannya di build membuktikan jalur pencatatannya ikut terpasang -- bukan cuma tampilannya.

### Yang TIDAK diverifikasi, dan kenapa itu bisa diterima

**Tombolnya belum pernah ditekan atas jadwal sungguhan.** Menekannya berarti mengubah salah satu dari enam jadwal aktif milik RS -- pada jadwal berfilter perubahannya TIDAK bisa dikembalikan lewat tombol mana pun, jadi itu keputusan staf atas jadwalnya sendiri, bukan efek samping verifikasi. Yang bisa gagal DIAM sudah dipagari dari sisi lain: seluruh keputusannya ada di fungsi murni yang diuji berikut bukti menggigitnya, daftar acuannya dibaca ulang server lewat pintu yang sama dipakai worker, dan `broadcast_schedule` sudah punya grant `UPDATE` sejak `migrations/006` (dibuktikan berjalan oleh `toggleScheduleAction` yang memakai kolom lain di tabel yang sama).

**Konversi `semua` -> `pilih` belum pernah dijalankan worker.** Yang sesudah konversi dipakai adalah `fetchPatientsByRm()`, jalur yang sudah berjalan di produksi untuk broadcast manual bermode centang.

## Keterangan: empat tingkat, dan ikon hanya memikul satu di antaranya

Diverifikasi 12 Agustus 2026.

### Pengukuran yang mendasari keputusannya

Dihitung dari seluruh `src/app/(dashboard)/**/*.tsx` (isi `<Callout>`, isi `<p>`, string `hint`; tag JSX dan ekspresi dibuang):

```
halaman                 karakter   blok  callout
farmasi                    25361    157       12
administrasi               12539     62        9
bpjs                        5827     33        3
template                    3975     20        1
broadcast-terjadwal         2921     31        0
...
TOTAL                      58903    409       25
```

`/audit` dan `/log` nol karakter -- keduanya memang cuma tabel.

Pemakaian `title=` berisi kalimat, dipisah dari `title=` sebagai prop komponen:

```
title= sebagai TOOLTIP html  : 30   (9 di antaranya berisi kalimat)
title= sebagai PROP komponen : 79
```

Kesembilan itulah pemakai pertama `Petunjuk`: `farmasi/TargetTable.tsx` x6, `pesan-masuk/page.tsx` x2, `balasan-otomatis/RuleTable.tsx` x1.

### Kenapa popover native, bukan tooltip CSS -- hit-test, bukan bounding rect

Percobaan pertama mengukur `getBoundingClientRect` dan itu SALAH: rect tetap melaporkan posisi tata letak walau pikselnya tidak pernah dilukis. Yang menjawab "benar-benar terlihat" cuma `elementFromPoint`, yang menghormati pemotongan. Diuji terhadap salinan persis `tableWrapperClass`:

```
Chromium 146 | popover=true | anchor-positioning=true

a. Tooltip absolute biasa
   menggantung keluar pembungkus : true
   benar-benar terlihat di luar  : false   (titik uji kena: BODY)
   pembungkus melahirkan scrollbar vertikal : true

b. Popover native + anchor positioning (dibuka dengan Enter)
   terbuka lewat keyboard        : true
   benar-benar terlihat di luar  : true    (titik uji kena: DIV#pop)
   pembungkus melahirkan scrollbar vertikal : false
   Esc menutup                   : true

c. Batas yang tidak bisa ditutup:
   isi popover TERTUTUP terjangkau Ctrl+F  : false
```

Baris (c) itulah yang membuat tingkat B memakai `Callout collapsible` alih-alih `Petunjuk`: `<details>` dibuka sendiri oleh peramban saat kena Ctrl+F.

Degradasi tanpa anchor positioning diuji dengan `@supports`-nya sengaja dipalsukan -- ketiga skenario (desktop 1280px, tablet 768px, anchor dimatikan) sama-sama lolos: terbuka lewat Enter, terlihat utuh di luar tabel, tidak keluar tepi layar, Esc menutup.

### Perilaku di peramban, memakai CSS HASIL BUILD

CSS-nya diambil dari `.next/static/chunks/*.css` yang benar-benar dikirim ke peramban petugas, bukan ditulis ulang untuk uji. Blok `@supports` terbukti ikut ter-emit:

```
@supports (position-anchor:--x){.petunjuk-isi{position-anchor:var(--jangkar);position-area:bottom span-right;position-try-fallbacks:flip-block, flip-inline, flip-block flip-inline;margin-top:.25rem;position:absolute}}
```

Ketiga skenario lolos seluruhnya:

```
1) Tema TERANG, 1280px        2) Tema GELAP, 1280px        3) Tema GELAP, tablet 768px
  summary display        : list-item (segitiga selamat)
  indent isi             : 24px (harap 24px)
  ikon privasi           : ada=true 16px aria-hidden=true
  netral tanpa ikon      : true
  tombol Petunjuk        : 2, tanpa aria-label: 0
  gulir mendatar halaman : false
  popover buka(Enter)    : true | menggantung: true | terlihat: true
  popover bg/warna       : terang rgb(255,255,255) / gelap rgb(20,28,46)  (terisi: true)
  scrollbar tabel liar   : false | Esc menutup: true
```

`summary display : list-item` adalah asersi yang paling mudah terlewat: menjadikan `<summary>` flex akan menghapus segitiga pembukanya di Chromium, sehingga satu-satunya tanda bahwa kotak itu bisa dibuka ikut hilang.

### Gerbang yang menjaga pola lama tidak kembali

`src/components/ui/petunjuk.test.ts`, 4 uji, dan dua di antaranya membuktikan gerbangnya MENGGIGIT alih-alih sekadar hijau:

```
gerbang: keterangan tidak boleh disembunyikan di balik title=
  v tidak ada satu pun di seluruh halaman dashboard (11 ms)
  v MENGGIGIT pada bentuk yang dulu dipakai
  v menjaring juga bentuk berkurung kurawal dan template literal
  v MELOLOSKAN pemakaian yang sah
```

Yang sah dan tetap lolos: `title={t.chatId}` (nilai data), `<button title="...">` (elemen interaktif yang teksnya sudah terlihat), dan label pendek.

### Hasil akhir, terukur

```
Callout terbentang : 10 (6160 karakter terlihat)
Callout terlipat   : 15 (7471 karakter di balik lipatan)
Petunjuk           :  9 (2517 karakter di balik ikon)
---
Total tersembunyi  : 9988 karakter
```

Callout terlipat naik 12 -> 15; `title=` berisi kalimat 9 -> 0. Seluruh KESIMPULAN tetap terbaca sebagai teks biasa -- yang pindah ke balik lipatan/ikon cuma alasannya.

Klasifikasi 12 Callout yang sebelumnya terbentang: **7 tingkat A** (tetap terbentang, kini berjangkar ikon), **4 tingkat B** (dilipat), **1 penanda status** (`"Pengiriman dokumen masih dimatikan"` -- keadaan, bukan penjelasan). Lima di antaranya ditandai `variant="privasi"`.

### Gerbang lain

```
tsc --noEmit          bersih
eslint .              bersih
npm test              47 suite / 785 uji lolos
npm run build         Compiled successfully in 6.6s
pm2 restart wakhanza-web -> online, unstable restarts 0, /login HTTP 200
```

### Yang TIDAK dikerjakan, dan kenapa

**Tingkat D (hapus prosa alasan-implementasi) praktis tidak menghasilkan apa pun.** Perkiraan dari sampel memperkirakan ~6 blok; pembacaan sesungguhnya tidak menemukan satu pun yang jelas-jelas cuma berguna bagi penulis kodenya. Yang paling mendekati (angka pengukuran seperti "141 dari 348" pada ambang stok) ternyata menjelaskan ke staf KENAPA sebuah barang tidak ikut terhitung -- itu keterangan operasional, bukan catatan pengembang. Menghapusnya bukan keputusan yang aman diambil sepihak.

**Halaman dashboard-nya sendiri tidak dibuka lewat peramban ber-login.** Perilakunya dibuktikan lewat CSS hasil build plus markup yang bentuknya persis seperti keluaran komponennya; membuat akun admin sementara pada sistem yang memegang data pasien bukan harga yang sepadan untuk memeriksa tata letak.

### Lintasan kedua: menutup 77% prosa yang tidak pernah dibungkus apa pun

Lintasan pertama di atas dinilai selesai, dan pemakainya mengatakan sebaliknya
("kenapa masih belum semua menu"). Diukur, keberatan itu benar.

**Keadaan sebelum lintasan kedua**, dari `src/app/(dashboard)/**` -- prosa
(`<p>`/`<li>` >= 40 karakter setelah tag dan ekspresi `{..}` dibuang) dibagi
menurut WADAHNYA:

```
sudah terlipat (Callout collapsible)   6.624   14%
Callout terbentang (pagar, sengaja)    4.225    9%
PROSA TELANJANG, tanpa wadah          36.815   77%   <- 190 blok, 16 rute
```

Sembilan dari enam belas rute (`broadcast-terjadwal`, `balasan-otomatis`,
`pesan-masuk`, `broadcast`, `ringkasan`, `pengguna`, `profil`, `koneksi`,
`nomor-bermasalah`) tidak punya SATU pun `Callout`, jadi tidak ada tombol lipat
untuk ditekan di sana.

**Sesudah**, diukur dengan alat yang sama, membagi tiga ember (terbentang saat
halaman dibuka / di balik `<details>` / di balik ikon `Petunjuk`). Angka
"sebelum" diambil dengan `git stash` lalu menjalankan skrip yang sama persis,
bukan dari catatan:

```
                        sebelum   sesudah
terbentang saat dibuka   42.187    31.004   (-11.183, -26,5%)
dilipat                   8.238    13.533
di balik ikon               880     7.397
tersembunyi                 18%       40%
```

Per rute yang disentuh:

```
farmasi              page.tsx 2.811 -> 214 ; rute 43% tersembunyi
administrasi         45% tersembunyi
template             71% tersembunyi
pesan-masuk          55% tersembunyi
pengguna             54% tersembunyi
balasan-otomatis     47% tersembunyi
bpjs                 38% tersembunyi
broadcast-terjadwal  15% tersembunyi
```

**Pembagiannya mengikuti aturan empat tingkat, bukan panjang teksnya.** Intro
tab/halaman -> `Callout collapsible` dengan kesimpulan dinaikkan jadi judul.
Teks bantuan di bawah kotak isian -> `Petunjuk`, dipasang sebagai SAUDARA
`<label>` di dalam `<div className="mb-1 flex items-center gap-1">` -- tidak
pernah di dalam `<label>`, karena tombol di sana akan menyalakan kontrolnya saat
ikonnya ditekan.

**Yang sengaja TIDAK disentuh, dan itu jawaban atas "kenapa masih ada yang
panjang":** seluruh isi `*Switch.tsx` (apa yang terjadi saat dinyalakan, lantai
aktivasi yang tak terbalikkan, peringatan "belum ada tujuan"), instruksi
pemindaian QR di `/koneksi`, peringatan "Bukan untuk pertanyaan medis" di
`/balasan-otomatis`, dan angka laju 16-46 nota/hari di `PenjualanSwitch`.
Rute yang tetap 0% tersembunyi (`/broadcast`, `/ringkasan`, `/profil`,
`/koneksi`) isinya hampir seluruhnya pesan status bersyarat dan instruksi
berurutan.

**Gerbang, seluruhnya dijalankan sesudah perubahan:**

```
tsc --noEmit          bersih
eslint .              bersih
npm test              47 suite / 785 uji lolos
npm run build         Compiled successfully
```

`petunjuk.test.ts` (gerbang yang melarang `title=` berisi kalimat) ikut lolos --
`Petunjuk` naik dari **4 menjadi 33** tanpa satu pun mengembalikan pola lamanya
(dihitung dua kali: `git stash`, hitung, `git stash pop`). `verify:db` dan
`verify:plans` tidak dijalankan ulang: lintasan ini tidak menyentuh satu pun
berkas `khanza/` maupun koneksi database.

## Rekap harian resep (`migrations/042`) -- kembaran rekap penjualan, di atas tabel yang paling dijaga

Seluruh angka di bawah diukur langsung terhadap database Khanza produksi (`alca`)
lewat `wakhanza_ro` (SELECT saja), bukan disimpulkan dari bentuk tabel.

### Prefiks `no_resep` terbukti EKSAK terhadap `tgl_peresepan`

Ini yang menentukan boleh-tidaknya rentang harian dipangkas lewat PRIMARY KEY.

```
SELECT SUM(LEFT(no_resep,8) = DATE_FORMAT(tgl_peresepan,'%Y%m%d')) AS cocok, ...

  prefix vs tgl_peresepan    cocok 12353   beda 69   tgl_kosong 69
  prefix vs tgl_perawatan    cocok 12327   beda 95   tgl_kosong  1

SELECT DATEDIFF(tgl_peresepan, STR_TO_DATE(LEFT(no_resep,8),'%Y%m%d')) AS selisih_hari, COUNT(*)
  selisih_hari 0 -> 12353
```

Ke-69 "beda" pada baris pertama adalah persis baris yang `tgl_peresepan`-nya
kosong, bukan yang menyimpang: `DATEDIFF` menunjukkan **selisih nol hari pada
SELURUH 12.353 baris bertanggal sah**, nol menyimpang ke kedua arah. Sekelas
`nota_jual` (16.787/16.787), bukan sekelas `no_faktur` pengadaan (9 dari 910).

Baris kedua yang membuktikan pemilihan kolomnya benar: terhadap `tgl_perawatan`
(validasi apotek) prefiksnya menyimpang pada 94 baris, jadi memakai kolom itu
sebagai "hari" akan menggeser sebagian resep ke rekap hari lain tanpa galat.

### Sebaran jam yang mendasari jam bawaan 22:00

90 hari terakhir, `HOUR(jam_peresepan)`:

```
  07   1     12  49     17 312   <- puncaknya
  08 120     13 140     18 246
  09 116     14 205     19 243
  10 104     15 139     20  25
  11  64     16 174     21   1
```

Ekor sepanjang 2,5 tahun: jam 20 = 325, jam 21 = 12, jam 22 = 2, jam 23 = 1;
`MAX(jam_peresepan)` = **23:11:10**. Jadi TIDAK ADA jam yang nol -- berbeda dari
penjualan, tempat 21:00 benar-benar nol sepanjang 90 hari. Rekap 21:00 akan
melewatkan 15 dari 12.422 resep (~6 setahun), 22:00 melewatkan 3 (~1 setahun).
Itulah kenapa jam bawaannya sengaja berbeda dari milik penjualan.

### Dua rincian yang DITOLAK, dan pengukuran yang menolaknya

```
SELECT status, COUNT(*) FROM resep_obat GROUP BY status;
  ralan   12422        <- satu-satunya nilai yang pernah ada

SELECT YEAR(tgl_peresepan), COUNT(*) resep, SUM(divalidasi), SUM(diserahkan) ...
  2024   1782   1782    907
  2025   6130   6130   5608
  2026   4441   4440   3975
```

`{status_resep}` ditolak karena `status` selamanya `ralan`. `{jumlah_divalidasi}`
ditolak karena validasi terjadi pada praktis setiap resep sehingga angkanya akan
selalu sama dengan `{jumlah_resep}`. Yang justru bergerak adalah PENYERAHAN (51%
-> 91% -> 90%), dan itulah yang masuk ke pesan.

### Kasus batas yang membentuk `gabungRekapResep()`

```
resep tanpa satu baris resep_dokter pun      135
  di antaranya tanpa racikan juga             69   (jadi 66 racikan-saja)
racikan yatim (tanpa resep_obat)               0
kd_dokter berbeda sepanjang 12.422 baris       1
```

135 resep tanpa baris obat membuktikan sisi header WAJIB dipertahankan saat sisi
item kosong -- membuangnya membuat 66 resep racikan-saja lenyap dari hitungan.
Satu-satunya `kd_dokter` adalah alasan `{rincian_dokter}` dibiarkan sebagai
variabel yang bisa dihapus staf, bukan dilebur ke badan pesan.

Hari tanpa resep, yang menentukan bawaan "pesan saat kosong":

```
SELECT DAYNAME(tgl_peresepan), COUNT(DISTINCT tgl_peresepan) hari_ada, COUNT(*) resep
  Monday 13/511  Tuesday 12/314  Wednesday 12/279
  Thursday 13/340  Friday 13/332  Saturday 13/163
```

Minggu tidak muncul sama sekali: **nol resep pada seluruh 13 hari Minggu**.

### Rencana query: ketiganya `range`, tanpa izin pindai penuh

`npm run verify:plans`:

```
[ok] FARMASI_RESEP_REKAP_HEADER  ro range PRIMARY  rows~50
[ok] FARMASI_RESEP_REKAP_HEADER  d  eq_ref PRIMARY rows~1
[ok] FARMASI_RESEP_REKAP_ITEM    ro range PRIMARY  rows~50
[ok] FARMASI_RESEP_REKAP_ITEM    rd ref no_resep   rows~2
[ok] FARMASI_RESEP_REKAP_RACIKAN rr range PRIMARY  rows~2  (Using index)
[ok] FARMASI_RESEP_REKAP_RACIKAN ro eq_ref PRIMARY rows~1

verify:plans lolos.
```

Tidak satu pun `allowFullScan` ditambahkan, dan tidak akan dibutuhkan saat
tabelnya membesar: `no_resep` adalah PRIMARY KEY `resep_obat` dan
`resep_dokter_racikan`, serta indeks pada `resep_dokter`.

### `npm run dryrun:resep` terhadap data produksi

Hari sibuk (2026-08-10), dengan nama dokter dan identitas RS disunting di sini:

```
  kolom yang benar-benar terbaca: kd_dokter, nm_dokter, jml_resep, jml_serah,
                                  jml_baris, jml_obat, jml_racikan
  [ok] PAGAR PRIVASI -- tidak satu pun kolom pasien, obat, atau dosis terbaca
  50 resep, 235 baris obat (1435 satuan), 2 racikan; 36 diserahkan, 14 belum; 1 dokter
  [ok] diserahkan + belum = jumlah resep

*Rekap Resep Harian*
Tanggal : 10-08-2026
Jumlah resep : 50
Baris obat : 235 (1.435 satuan)
Racikan : 2
Sudah diserahkan : 36
Belum diserahkan : 14
*Rincian per dokter:*
- <nama dokter> : 50 resep, 235 baris obat, 2 racikan
```

Keenam angka itu cocok persis dengan pengukuran SQL langsung atas tanggal yang
sama (`COUNT(*)` = 50, `COUNT(*)`/`SUM(jml)` pada `resep_dokter` = 235/1435,
racikan = 2, penyerahan = 36). Jadi yang terbukti bukan cuma skripnya berjalan,
melainkan seluruh jalur query -> penggabungan -> render menghasilkan angka yang
sama dengan database.

Hari Minggu (2026-08-09) menempuh cabang yang lain:

```
  kolom yang benar-benar terbaca: (tidak ada baris)
  0 resep, ... ; 0 dokter
  Hari itu tidak ada resep, dan "pesan saat kosong" dibiarkan kosong
  -- jadi sistem sengaja DIAM.
```

### Dua gerbang dibuktikan MENGGIGIT, bukan diasumsikan

**1. Pagar privasi `dryrun:resep`.** `ro.no_rawat` ditambahkan ke daftar SELECT
header dengan sengaja, lalu dijalankan:

```
  kolom yang benar-benar terbaca: kd_dokter, no_rawat, nm_dokter, ...
  [BOCOR] kolom terlarang terbaca: no_rawat -- lihat komentar pembuka khanza/farmasiStaf.ts
  kode keluar skrip saat bocor = 1
  kode keluar sesudah dipulihkan = 0
```

`no_rawat` masuk daftar terlarang justru karena ia BUKAN identitas: ia kunci
menuju `reg_periksa`, jadi kehadirannya berarti jalan menuju pasien sudah
terbuka walau namanya belum ikut terbaca. Kode keluar 1 membuktikan ia bisa
menggagalkan pemeriksaan, bukan sekadar mencetak peringatan.

**2. Pendaftaran `{rincian_dokter}` di `MULTILINE_VARIABLES`.** Barisnya dihapus
dengan sengaja, lalu `npx jest src/core/resepRekap`:

```
x bertahan melewati renderTemplate tanpa dilipat atau dipotong
  Received length: 2
  Received array: ["Rincian:", "- Ani : 5 resep, 0 baris obat - Budi : 2 resep, 0 baris obat"]
```

Daftar tiga dokter melipat jadi SATU baris -- persis kegagalan diam yang uji itu
ada untuk menjaganya (dan pada daftar yang lebih panjang ia juga terpotong di 60
karakter). Uji ini sengaja memeriksa PERILAKU alih-alih keanggotaan himpunannya,
pola yang sama dipakai `stokDarurat`/`pengadaan`/`hibah`/`pemesanan`.

### Ekstraksi `core/rekapJadwal.ts` terbukti nol-perubahan-perilaku

`bacaJamRekap`/`tulisJamRekap`/`hariRekap` dipindah dan di-re-export dari
`core/penjualanRekap.ts`. Uji lama dijalankan tanpa satu asersi pun diubah:

```
npx jest src/core/penjualanRekap
  Tests: 30 passed, 30 total
```

Tidak satu pun impor yang sudah ada berubah, jadi `penjualanRekapRunner.ts` dan
`penjualanActions.ts` yang sedang berjalan di produksi tidak tersentuh.

### Gerbang lengkap

```
npm run migrate      -> 042_resep_rekap.sql diterapkan (1 migrasi)
npx tsc --noEmit     -> bersih
npx eslint .         -> bersih
npm test             -> 48 suite, 804 uji lolos   (dari 47 suite / 785 uji)
npm run verify:db    -> lolos (sik menolak tulisan, audit_log append-only tegak)
npm run verify:plans -> lolos
npm run build        -> sukses
```

### Yang TIDAK diverifikasi, dan kenapa

- **Pengiriman WhatsApp sungguhan.** `farmasi.resep_rekap_enabled` default MATI
  dan sengaja TIDAK dinyalakan: menyalakannya mengirim pesan ke grup/petugas
  sungguhan, dan yang memutuskan itu rumah sakit. Jalur enqueue-nya sendiri
  adalah `enqueueMessage()` yang sama dipakai sebelas kelas pemicu lain.
- **Perilaku saat ada lebih dari satu dokter peresep.** Tidak bisa diuji terhadap
  data mesin ini (`kd_dokter` cuma punya satu nilai), jadi dijamin lewat unit
  test `gabungRekapResep`/`formatRincianDokter` dengan tiga dokter buatan --
  termasuk urutannya dan baris per dokter.
- **Worker BELUM dimulai ulang.** Selama sakelarnya mati, perilaku kode lama dan
  baru identik, jadi tidak ada yang perlu dikejar hari ini. Tapi **sebelum
  sakelarnya dinyalakan, worker harus dimulai ulang** -- kalau tidak, sakelarnya
  menyala di dashboard sementara worker tidak pernah menjalankan siklus
  `resep-rekap`: gagal DIAM, tanpa satu pun galat. Sengaja tidak dilakukan
  sekarang: worker memegang sesi WhatsApp, dan restart yang tidak perlu adalah
  persis yang berulang kali menjatuhkannya ke crash loop.

### Web dimulai ulang, worker tidak

`npm run build` menimpa `.next` di disk sementara proses PM2 memegang kode lama
di memori -- keadaan yang tidak boleh dibiarkan, karena `next start` membaca
potongan rute dari `.next` saat berjalan. Prosedur yang sudah tercatat
(`npm run build` lalu `pm2 restart wakhanza-web`) dijalankan:

```
[PM2] [wakhanza-web](4) OK
curl /login                 -> HTTP 200
curl /farmasi?tab=resep     -> HTTP 307   (tanpa sesi, gerbang auth menahan)
```

Penanda fiturnya ada di build yang benar-benar dilayani:

```
grep -rl "resep_rekap_enabled" .next/server  -> src_app_(dashboard)_farmasi_*.js
grep -rl "Rekap resep harian"  .next/server  -> src_app_(dashboard)_farmasi_*.js
```

`wakhanza-worker` sengaja TIDAK disentuh (lihat butir di atas).

## Nilai rupiah pada rekap resep (`migrations/043`) -- angkanya dari tabel PENAGIHAN, bukan daftar harga

### `resep_dokter` tidak punya kolom harga sama sekali

Yang memaksa angkanya datang dari tabel lain, bukan pilihan gaya:

```
SHOW COLUMNS FROM resep_dokter
  no_resep:varchar(14)[MUL]  kode_brng:varchar(15)[MUL]  jml:double  aturan_pakai:varchar(150)
```

Empat kolom, nol di antaranya rupiah.

### Katalog vs yang benar-benar ditagihkan -- 2026-08-10, 50 resep

```
A.  katalog non-racik    SUM(rd.jml * databarang.ralan)     235 baris  Rp1.460.911
A2. katalog bahan racik  SUM(rrd.jml * databarang.ralan)      9 baris  Rp   10.915
    A total                                                 244 baris  Rp1.471.826

B.  SUM(detail_pemberian_obat.total) lewat join resep_obat  245 baris  Rp1.455.477
    rincian: obat 1.455.477 - embalase 0 - tuslah 0 - modal 996.336
```

Katalog meleset 244 vs 245 baris dan Rp16.349. Yang mematikannya bukan selisih itu
melainkan bahwa `databarang` menyimpan harga HARI INI sementara rekap boleh dibaca
untuk tanggal lampau (`farmasi.resep_rekap_offset_hari`, argumen tanggal `dryrun:resep`).

Cakupan join, 90 hari:

```
resep 1.939 - resep yang punya baris penagihan 1.934      (5 belum divalidasi)
resep 9.038 - tanpa dpo 5 - tanpa dpo DAN belum validasi 0
databarang.ralan untuk obat yang diresepkan: 8.803 baris, katalog_hilang 0, ralan_nol 0
```

### `total` berwenang, bukan rumusnya

```
SUM(ABS(total - (biaya_obat*jml + embalase + tuslah)) > 0.01)   21 dari 9.076 baris (90 hari)
SUM(embalase <> 0) / SUM(tuslah <> 0)                          0 / 0 dari 33.198 baris (365 hari)
```

Embalase dan tuslah nol seluruhnya, jadi keduanya tidak jadi variabel sendiri --
tapi sudah ikut terhitung di dalam `total`.

### Mustahil dobel hitung

```
SELECT COUNT(*) FROM (
  SELECT no_rawat, tgl_perawatan, jam, COUNT(*) n FROM resep_obat
  WHERE tgl_peresepan >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
  GROUP BY no_rawat, tgl_perawatan, jam HAVING n > 1) x
  -> kombinasi_dipakai_ulang = 0
```

### Rencana query -- tanpa izin pindai penuh

```
EXPLAIN (hari tersibuk):
  ro   range  PRIMARY  key_len 16  rows 50
  dpo  ref    PRIMARY  key_len 25  ref alca.ro.tgl_perawatan,alca.ro.jam,alca.ro.no_rawat  rows 2
  [31 ms]

npm run verify:plans
  [ok] FARMASI_RESEP_REKAP_NILAI ro range PRIMARY  rows~50
  [ok] FARMASI_RESEP_REKAP_NILAI dpo ref PRIMARY  rows~2
  verify:plans lolos.
```

### Migrasi menembus template CRLF

Nilai tersimpan SEBELUM (staf sudah menyuntingnya lewat form, jadi CRLF -- bukan LF
seperti yang di-seed 042):

```
...Sudah diserahkan : {jumlah_diserahkan}\r\nBelum diserahkan : {jumlah_belum_serah}\r\n\r\n*Rincian per dokter:*...
```

SESUDAH `npm run migrate` (`043_resep_rekap_nilai.sql`):

```
...Belum diserahkan : {jumlah_belum_serah}\r\n\r\n*Nilai obat : {nilai_obat}*\r\n\r\n*Rincian per dokter:*...
```

Baris yang disisipkan memakai CRLF, mengikuti gaya yang sudah dipakai baris di
sekitarnya -- bukan LF yang akan mencampur dua gaya dalam satu template.

### Pesan sungguhan (`npm run dryrun:resep -- alca 2026-08-10`)

```
kolom yang benar-benar terbaca: kd_dokter, nm_dokter, jml_resep, jml_serah,
                                jml_baris, jml_obat, jml_racikan, nilai_obat
[ok] PAGAR PRIVASI -- tidak satu pun kolom pasien, obat, atau dosis terbaca

50 resep, 235 baris obat (1435 satuan), 2 racikan; 36 diserahkan, 14 belum;
1 dokter; nilai Rp1.455.477
[ok] total rupiah = jumlah rupiah seluruh dokter
[ok] diserahkan + belum = jumlah resep

  Jumlah resep : 50
  Baris obat : 235 (1.435 satuan)
  Racikan : 2

  Sudah diserahkan : 36
  Belum diserahkan : 14

  *Nilai obat : Rp1.455.477*

  *Rincian per dokter:*
  - dr. (nama disamarkan) : 50 resep, 235 baris obat, 2 racikan, Rp1.455.477
```

Rp1.455.477 cocok persis dengan pengukuran SQL langsung di atas.

### Pagar privasi dibuktikan MENGGIGIT

`MAX(ro.no_rawat) AS no_rawat` ditambahkan ke daftar SELECT dengan sengaja:

```
kolom yang benar-benar terbaca: ..., no_rawat, nilai_obat
[BOCOR] kolom terlarang terbaca: no_rawat -- lihat komentar pembuka khanza/farmasiStaf.ts
exit=1
```

Dikembalikan sesudahnya.

### Unit test dibuktikan MENGGIGIT (dua arah)

```
1. bagian.push(formatRupiah(...))  ->  if (b.nilaiObat > 0) bagian.push(...)
   x SELALU menyebut rupiah, termasuk saat nol
   Tests: 1 failed, 22 passed

2. total diganti penurunan terpisah yang menyimpang (x2)
   x menjumlahkan keempat sisi per dokter
   x menghitung resep sekali per RESEP, bukan sekali per baris obat
   x tidak membuang sisi nilai yang dokternya tidak ada di header
   x menerima angka yang datang sebagai string dari mysql2
   x menjamin total rupiah = jumlah rupiah seluruh dokter
   Tests: 5 failed, 18 passed
```

Keduanya dikembalikan; 23 uji `core/resepRekap` lolos.

### Gerbang penuh

```
npm run typecheck    -> bersih
npm run lint         -> bersih
npm test             -> Test Suites: 48 passed, Tests: 808 passed
npm run verify:db    -> sik tulis DITOLAK, audit_log DELETE/UPDATE DITOLAK -- lolos
npm run verify:plans -> lolos
npm run build        -> Compiled successfully in 7.3s
```

### Pemasangan

`farmasi.resep_rekap_enabled` = `1` SEBELUM pekerjaan ini -- fiturnya sudah
berjalan, `resep_rekap_last_run` = `2026-08-12`. Jadi worker WAJIB dimulai ulang,
bukan boleh ditunda: template sudah memuat `{nilai_obat}` sementara kode lama tidak
mengenalnya.

```
pm2 restart wakhanza-web                     -> online
pm2 stop wakhanza-worker                     -> ok
Get-CimInstance ... chrome.exe *wwebjs_auth* -> Chromium sesi BERSIH, nol proses tersisa
pm2 start wakhanza-worker                    -> ok
wa_session: status ready - umur denyut 3 detik - last_error null
```

### JEBAKAN PENGUKURAN yang ikut terkoreksi: `CONVERT_TZ` bergantung pada KLIEN

CLAUDE.md sebelumnya menyatakan koreksi 25.200 detik itu **"SELALU"** perlu.
Terukur, itu keliru -- dan menerapkannya lewat Sequelize menghasilkan galat 7 jam
yang sama persis dengan tanda terbalik:

```
@@global.time_zone   SYSTEM
@@session.time_zone  +00:00        <- Sequelize menyetelnya sendiri
hb_mentah            2026-08-12T14:08:44.000Z
now_mariadb          2026-08-12T14:08:47.000Z
umur_mentah          3             <- BENAR
umur_convert         -25197        <- worker seolah berdenyut 7 jam di masa depan
```

Lewat CLI `mysql` sesinya `SYSTEM` (WIB) sehingga `CONVERT_TZ` memang perlu; lewat
Sequelize kedua sisinya sudah UTC. Kalimatnya di CLAUDE.md diperbaiki jadi tabel
per-klien.

### Yang TIDAK dikerjakan, sengaja

- **Sakelar `farmasi.resep_rekap_nilai`** -- ditolak, lihat CLAUDE.md; sakelar yang
  memutus angka agregat menyisakan `*Nilai obat : *` yang menggantung (pelajaran 031).
- **`{embalase}` / `{tuslah}` sebagai variabel sendiri** -- nol pada seluruh 33.198
  baris setahun; sudah terhitung di dalam `total`.
- **Modal/margin (`h_beli`)** -- terbaca Rp996.336 pada hari contoh, dan sengaja
  tidak diambil: itu harga beli dari pemasok, pertanyaan dagang tersendiri yang
  sudah punya tempatnya di PENGADAAN (`farmasi.pengadaan_harga`).


## Rekap resep dikirim manual di luar jadwal (12 Agustus 2026)

Atas permintaan eksplisit pemilik sistem, rekap resep hari itu dikirim di luar
jadwalnya supaya bentuk barunya (rupiah, migrations/043) terlihat malam itu juga
alih-alih menunggu jadwal besok.

**Kenapa tidak bisa sekadar memundurkan penandanya:** rekap hari itu SUDAH
terkirim pukul 20.48 WIB, tujuh belas menit SEBELUM migrations/043 diterapkan
pukul 21.05 -- jadi isinya memang belum memuat `{nilai_obat}`, dan itu benar
menurut urutan waktunya, bukan cacat kode:

```
schema_migrations : 2026-08-12T21:05:26  043_resep_rekap_nilai.sql  (WIB, ditulis NOW() MariaDB)
outbox #44112     : 2026-08-12T13:48:47Z (UTC, ditulis Sequelize) = 20:48 WIB
  -> body memuat 'Nilai obat' : TIDAK
```

Dua tabel di database yang sama, dua zona berbeda -- jebakan yang sama dengan
`heartbeat_at`, dan sebabnya sama: yang satu ditulis `NOW()` MariaDB di sesi WIB,
yang satu ditulis Sequelize di sesi ber-`timezone: '+00:00'`.

Kunci idempoten rekap sengaja TIDAK memuat waktu (satu hari = satu rekap,
ditegakkan `uq_idem`), jadi mengulanginya dengan kunci yang sama akan ditolak
diam-diam. Yang dipakai: rantai fungsi PRODUKSI yang sama persis
(`muatTargetAktif` -> `susunRekapResepHarian` -> `loadFarmasiContext` ->
`enqueueMessage`) dengan satu bagian stempel waktu ditambahkan ke kuncinya --
pola yang sama dipakai tombol "Kirim uji". **Tidak satu pun baris `outbox` yang
sudah ada dihapus atau diubah**, dan `farmasi.resep_rekap_last_run` sengaja tidak
disentuh supaya jadwal besok berjalan normal. Tercatat `audit_log` dengan aktor
`cli:resep_rekap_manual`, dibedakan dari `system:resep_rekap` milik worker.

Penghalangnya ternyata sesi, bukan kodenya. Riwayat `wa_session_event`
memperlihatkan pola normal `ready -> authenticating -> ready` yang selalu selesai
dalam 1-2 detik (penyuntikan ulang biasa), lalu satu yang tidak:

```
#62 2026-08-12T14:24:12Z ready -> authenticating     <- tersangkut
#61 2026-08-12T14:08:17Z authenticating -> ready     (2 detik)
#60 2026-08-12T14:08:15Z ready -> authenticating
#59 2026-08-12T13:38:49Z authenticating -> ready     (1 detik)
```

Denyutnya sehat sepanjang itu (berputar bersih 0->30 detik), jadi yang tersangkut
sesi WhatsApp-nya, bukan prosesnya -- pembedaan yang cuma bisa dibaca dari DUA
kolom sekaligus, bukan dari `status` saja.

**Watchdog sengaja TIDAK didahului restart manual.** Ambang 15 menit itu hasil
pengamatan bahwa penautan ulang terlalu sering justru memperlambat sinkronisasi
WhatsApp; restart di menit ke-6 adalah persis ketidaksabaran yang sudah tercatat
merugikan. Sesinya pulih SENDIRI pukul 14:35:44Z, sebelum watchdog (14:39:12Z)
sempat bertindak:

```
  2026-08-12T14:35:34.904Z  status=authenticating denyut=23s
  2026-08-12T14:35:39.909Z  status=authenticating denyut=0s
  2026-08-12T14:35:44.916Z  status=ready denyut=0s
[ok] sesi READY dan denyutnya segar
```

Pratinjau lebih dulu (`npm run dryrun:resep`, tidak mengirim apa pun):

```
kolom yang benar-benar terbaca: kd_dokter, nm_dokter, jml_resep, jml_serah,
                                jml_baris, jml_obat, jml_racikan, nilai_obat
[ok] PAGAR PRIVASI -- tidak satu pun kolom pasien, obat, atau dosis terbaca
31 resep, 141 baris obat (785 satuan), 4 racikan; 26 diserahkan, 5 belum;
1 dokter; nilai Rp860.362
[ok] total rupiah = jumlah rupiah seluruh dokter
[ok] diserahkan + belum = jumlah resep
```

Lalu dikirim, dan sampai pada percobaan PERTAMA:

```
#44211 status=sent percobaan=1 kirim=2026-08-12T14:37:05.000Z ack=1
send_log:
  percobaan 1 sent 201 ms
```

Isi yang benar-benar terkirim -- angkanya cocok persis dengan pratinjau:

```
*Rekap Resep Harian*
...
Jumlah resep : 31
Baris obat : 141 (785 satuan)
Racikan : 4

Sudah diserahkan : 26
Belum diserahkan : 5

*Nilai obat : Rp860.362*

*Rincian per dokter:*
- dr. (nama disamarkan) : 31 resep, 141 baris obat, 4 racikan, Rp860.362
```

Ini sekaligus kiriman pertama yang membawa `{nilai_obat}` ke penerima sungguhan.


## Design system: token DIUKUR, dan prosa yang pindah keluar kanvas

Seluruh angka di bawah hasil pengukuran atas kode yang berjalan, bukan perkiraan.

### Diagnosis: keadaan sebelum perubahan

Diukur atas `src/app/(dashboard)/**` + `src/components/**`:

```
=== ukuran teks dipakai ===
    477 text-xs
    186 text-sm
      3 text-lg
      1 text-xl
      1 text-base
      1 text-3xl
      1 text-2xl

=== font-weight ===
    474 font-medium
     13 font-semibold
      2 font-normal
      1 font-bold

=== shadow ===
      3 shadow-sm
      2 shadow-lg
```

Jadi **97% teks hidup di dua ukuran yang berjarak 2px** dan **97% teks bertekanan
punya berat yang sama**; elevasi 5 pemakaian di seluruh dashboard. `layout.tsx`
tidak memuat typeface sama sekali (diperiksa: tidak ada `next/font` maupun
`@font-face`).

Volume prosa, diukur lewat penghitung text-node JSX + literal kalimat:

```
rute                    karakter   blok  berkas
farmasi                    32039    320      19
administrasi                9334     83       5
bpjs                        6577     62       5
broadcast-terjadwal         6480     50       5
components/ui               5090     34       9
template                    4821     47       3
...
TOTAL                      83948    766
```

### Font: self-hosted, nol permintaan keluar

Sesudah `npm run build`:

```
=== berkas font self-hosted ===
.next/static/media/1bffadaabf893a1e-s.3-6t-g6q0vh0a.woff2
.next/static/media/2bbe8d2671613f1f-s.0k62hbripvv8p.woff2
(+3 lagi)

=== permintaan ke fonts.googleapis di hasil build ===
(nol -- tidak ada permintaan keluar)
```

Diverifikasi pada instance PM2 yang benar-benar melayani (port 3100), bukan pada
server uji terpisah:

```
<html lang="id" class="inter_31011fd-module__jtyeTG__variable">
--font-sans:"Inter", "Inter Fallback"
```

### Token baru hidup di CSS produksi

Dibaca dari berkas CSS yang benar-benar disajikan PM2:

```
--destructive-solid  --destructive-solid:0 72% 44%
--info               --info:213 90% 68%  --info:214 84% 44%
--shadow-strength    --shadow-strength:.05  --shadow-strength:.45
--surface-sunken     --surface-sunken:210 40% 98%  --surface-sunken:222 44% 10%
--font-sans          --font-sans:"Inter", "Inter Fallback"
```

`tabular-nums` juga ada (aturan pada `table` di `globals.css`).

### Kontras: DIHITUNG, di kedua mode secara terpisah

```
== TERANG (teks vs card) ==
  fg           17.87:1  AA        info          5.62:1  AA
  muted         4.70:1  AA        warning       5.05:1  AA
  primary       4.53:1  AA        success       5.08:1  AA
  destructive   4.80:1  AA
== GELAP (teks vs card) ==
  fg           15.52:1  AA        info          6.75:1  AA
  muted         6.63:1  AA        warning      10.04:1  AA
  primary       6.35:1  AA        success       9.76:1  AA
  destructive   4.91:1  AA
== LATAR terisi ==
  destructive-solid + teks putih  6.03:1  AA

[ok] SEMUA token lolos WCAG AA di KEDUA mode
```

### Cacat aksesibilitas yang ditemukan pengukuran, dan perbaikannya

`--destructive` di mode gelap bernilai `0 70% 60%` dan hanya mencapai **4,45:1**
terhadap `--card` — gagal AA sebesar 0,05. Terlalu tipis untuk terlihat saat
ditinjau dengan mata, dan hanya muncul karena rasionya dihitung.

Yang lebih buruk ada di peran keduanya. Token yang sama dipakai sebagai LATAR
terisi berteks putih pada tombol konfirmasi hapus (`ConfirmDialog`), dan di sana
putih di atasnya hanya **3,82:1** — gagal jelas, pada tombol yang justru paling
tidak boleh salah tekan.

Dijajaki seluruh rentang kecerahannya, dan **tidak ada satu pun nilai yang lolos
4,5:1 pada kedua peran sekaligus**:

```
L%   hex       teks-vs-card   putih-vs-bg
56   #dd4040       3.95          4.30
58   #df4949       4.20          4.05
60   #e05252       4.45          3.82   <- nilai lama
62   #e25a5a       4.73          3.59
64   #e36363       5.04          3.37
```

Karena itu tokennya DIPECAH menurut perannya: `--destructive` (teks/garis,
gelap dinaikkan ke 63% -> 4,91:1) dan `--destructive-solid` (latar terisi, 44%
-> putih 6,03:1, sama di kedua tema karena yang dilawannya teks di atasnya
bukan permukaan di belakangnya). Hanya SATU tempat di seluruh dashboard yang
memakai latar merah penuh (`grep -rn "bg-destructive[^/]"` -> 1 hasil), jadi
perubahannya berlingkup sempit dan terbukti.

### Prosa: pindah, bukan dihapus -- terukur di rute terberat

`/farmasi` (38% seluruh prosa dashboard, 8 tab dalam satu rute):

```
=== prosa per berkas di /farmasi (sesudah) ===
page.tsx          3133 karakter   33 blok
bantuan.tsx       5107 karakter   55 blok

=== page.tsx SEBELUM (dari git) ===
page.tsx          8205 karakter   86 blok
```

Jadi **8.205 -> 3.133 karakter tergambar di kanvas (-62%)**, **86 -> 33 blok
(-62%)**, `Callout` **21 -> 5 (-76%)**. Nol prosa hilang: 5.107 karakter pindah
ke `bantuan.tsx`, dirender di server ke dalam `HelpPanel`, jadi tetap ada di HTML
halaman dan tetap terjangkau Ctrl+F maupun pembaca layar.

Kelima `Callout` yang tinggal semuanya pagar, dan **dua di antaranya justru
DINAIKKAN** dari `collapsible` menjadi `variant="warning"` terbentang: "hibah
belum pernah tercatat" dan "menu pemesanan praktis tak dipakai". Keduanya
periksa-dulu-sebelum-menyalakan — menyalakan fitur yang tabel sumbernya kosong
menghasilkan sakelar menyala yang tidak pernah mengirim apa pun, gagal DIAM.

### Sapuan hierarki judul

```
48 judul dinaikkan di 29 berkas
```

`<h2>`/`<h3>` ber-`font-medium`/`text-sm` diganti peran (`text-title` /
`text-title-sm`). Skripnya menyentuh HANYA elemen `<h2>`/`<h3>` — penggantian
buta akan menaikkan label form ikut jadi judul.

### Gerbang penuh

```
npm run typecheck   -> bersih
npm run lint        -> bersih (0 error, 0 warning)
npm test            -> 48 suite, 808 uji, seluruhnya lolos
npm run build       -> Compiled successfully
```

`wakhanza-web` dimulai ulang lewat PM2 (bukan server uji terpisah — instalasi ini
berjalan di atas database produksi, jadi instance PM2 itulah lingkungan yang
sesungguhnya). Sesudah restart: `/login` 200, `/farmasi` 307 (redirect ke login,
otorisasi tetap tegak).

## ERM / PENILAIAN UMUM (`migrations/044`) -- pemicu pertama yang memberitakan sesuatu yang TIDAK terjadi

Seluruh angka di bawah hasil pengukuran terhadap database produksi (`alca`) pada
2026-08-13, bukan perkiraan.

### Bentuk data yang menentukan desainnya

```
-- status_lanjut x status_poli, SELURUH reg_periksa
Ralan / Lama   7485
Ralan / Baru   4869
Ranap / *         0      <- RS ini murni rawat jalan
```

Jadi `penilaian_awal_keperawatan_ralan` satu-satunya tabel asesmen yang relevan.
Dari 31 tabel `penilaian_awal_keperawatan_*` di Khanza, hanya itu yang berisi:

```
penilaian_awal_keperawatan_ralan            COUNT(*) = 1954
penilaian_awal_keperawatan_ralan_masalah    772
penilaian_awal_keperawatan_ralan_rencana    286
29 tabel lainnya                              0
```

`information_schema.TABLE_ROWS` melaporkan **1699** untuk tabel pertama; `COUNT(*)`
menjawab **1954**. Pelajaran migrations/030 terulang persis, dan angka perkiraan
InnoDB tidak dipakai untuk menyimpulkan apa pun.

### Cakupan: 65% pasien baru TIDAK punya asesmen sama sekali

```
-- 90 hari, status_poli='Baru' AND status_lanjut='Ralan'
total_baru  550
ada_asesmen 191   (34,7%)
tanpa       359   (65,3%)
```

Poli: `UMUM` **550 dari 550**. Tidak ada poli lain yang menerima pasien baru,
sehingga `erm.penilaian_poli` kosong dan `['UMUM']` menghasilkan daftar yang sama
persis hari ini.

### Kenapa "lengkap" TIDAK boleh berarti "semua kolom terisi"

Seluruh 57 kolom bertipe `NOT NULL`, jadi Khanza menyimpan STRING KOSONG. Diukur
pada 191 baris yang ADA:

```
keluhan_utama    0 kosong  (selalu diisi)
td              51 kosong  (27%)
suhu            53 kosong  (28%)
nadi            68 kosong  (36%)
rr              68 kosong  (36%)
bb             144 kosong  (75%)
tb             173 kosong  (91%)
```

`bb`/`tb` karena itu di LUAR kolom inti bawaan: memasukkannya membuat golongan
"terisi sebagian" menelan hampir seluruh golongan "lengkap".

Tabel turunan `_masalah` dan `_rencana` mengembalikan **NULL** (nol baris) untuk
seluruh 191 asesmen dalam 90 hari -- keduanya bukan bagian alur kerja sekarang,
jadi sengaja TIDAK masuk definisi kelengkapan.

### Jam rekap: 13:00 dan 19:30, DIUKUR

```
-- jeda registrasi -> asesmen (menit), 90 hari
n=191  min=0  rata=119  maks=3756  beda_hari=7
```

3.756 menit = 62 jam, dan 7 asesmen diisi pada hari yang berbeda dari
pendaftarannya. Rekap tunggal sore hari akan menuduh pasien "belum diisi" saat
perawatnya memang belum sempat.

```
-- sebaran HOUR(tanggal) pengisian asesmen, 90 hari
08:5  09:3  10:16 11:15 12:14 13:14 14:15 15:14
16:20 17:21 18:31 19:26 20:5  21+:0
```

Memuncak 18:00-19:00, jatuh ke 5 pada pukul 20, **nol sesudahnya**. Karena itu
13:00 = pengingat, 19:30 = hitungan akhir.

### Pemangkas `no_rawat` EKSAK, dan rencana query-nya

```
-- prefix no_rawat vs tgl_registrasi, SELURUH tabel
total 12354   cocok 12354   menyimpang 0
```

Bentuknya `YYYY/MM/DD/NNNNNN` -- GARIS MIRING, bukan tanda hubung. Sekelas
`nota_jual` (040), tanpa margin.

```
$ npm run verify:plans
[ok] ERM_PENILAIAN_AWAL   r  range PRIMARY  rows~668
[ok] ERM_PENILAIAN_AWAL   ps eq_ref PRIMARY rows~1
[ok] ERM_PENILAIAN_AWAL   pk eq_ref PRIMARY rows~1
[ok] ERM_PENILAIAN_AWAL   d  eq_ref PRIMARY rows~1
[ok] ERM_PENILAIAN_AWAL   p  eq_ref PRIMARY rows~1

verify:plans lolos.
```

TANPA izin pindai penuh. Ambangnya `MAX_ROWS_JENDELA_30_HARI` (3000), sekelas
QUEUE_REG -- bawaan 500 gagal pada 668 bukan karena query-nya buruk melainkan
karena angka itu tidak pernah dikalibrasi untuk tabel ini.

### Penyaring poli di SQL terbukti LEBIH MAHAL

Bentuk pertama memakai `AND r.kd_poli IN (:kdPoli)`. EXPLAIN-nya:

```
[ok] ERM_PENILAIAN_AWAL_POLI r ref|filter kd_poli|status_lanjut rows~5054 (7%)
```

5.054 baris diperiksa berbanding **668** lewat jendela tanggal saja -- optimizer
menilai `kd_poli` selektif padahal nyaris seluruh kunjungan bernilai `UMUM`.
Penyaringnya dipindah ke sisi Node, dan pemeriksaan rencana keduanya dihapus:
satu bentuk SQL berarti satu rencana yang dijaga.

### Rekap multi-slot: uji unit, dan KEDUANYA dibuktikan MENGGIGIT

```
$ npx jest src/core/rekapJadwal
Tests: 24 passed, 24 total
```

Dirusak sengaja untuk membuktikan asersinya bukan hiasan:

```
### RUSAK 1: perbandingan >  ->  !==
Tests: 1 failed, 23 passed, 24 total
   (gagal: "menghapus slot yang sudah berbunyi tidak membangkitkan kiriman lama")

### RUSAK 2: penanda bertanggal saja (pola jatuhTempoHarian)
Tests: 1 failed, 23 passed, 24 total
   (gagal: "penanda slot pertama TIDAK menahan slot kedua")

### dipulihkan:
Tests: 24 passed, 24 total
```

RUSAK 2 adalah bug yang fitur ini ada untuk menghindarinya: dengan penanda
bertanggal, rekap 19:30 tidak pernah berangkat.

### Sanitasi nama pasien -- kewajiban `MULTILINE_VARIABLES`

```
$ npx jest src/core/penilaianRekap
Tests: 17 passed, 17 total

### RUSAK: sanitizeValue dilepas dari nama pasien
  x sanitasi nama pasien -- kewajiban MULTILINE_VARIABLES >
    nama berisi baris baru TIDAK menambah baris pada hasil render
Tests: 1 failed, 16 passed, 17 total
```

### Pagar privasi diperiksa pada OBJEK BARISNYA

```
$ npm run dryrun:penilaian -- alca 2026-08-12

=== PAGAR PRIVASI ===
kolom yang benar-benar terbaca: noRawat, noRkmMedis, namaPasien, jamReg,
                                kdPoli, namaPoli, namaDokter, status, kosong, diisiPada
[ok] tidak satu pun kolom rekam medis ikut terbaca
```

Daftar terlarang yang diperiksa: `keluhan_utama`, `rpd`, `rpk`, `rpo`, `alergi`,
`status_psiko`, `ket_psiko`, `nyeri`, `skala_nyeri`, `lokasi`, `ekonomi`,
`hub_keluarga`, `tinggal_dengan`, `adl`, `total_hasil`, `hasil`. Skripnya keluar
dengan **kode 1** bila salah satunya muncul.

### Rekap sungguhan atas data produksi

```
=== RINGKASAN ===   (alca, 2026-08-12)
pasien baru      : 11
  lengkap        : 6
  belum diisi    : 1
  terisi sebagian: 4
perlu ditindak   : 5
```

Ketiga golongan muncul pada data nyata, jadi penggolongannya terbukti membedakan
sesuatu -- bukan cabang yang tidak pernah terpakai. Pesan yang dihasilkan 556
karakter, satu bagian (jauh di bawah batas 12.000 yang diukur di migrations/022).
Nama pasien sungguhnya sengaja TIDAK disalin ke berkas ini.

Satu cacat pratinjau ikut ditemukan dan diperbaiki di sini: dryrun mula-mula
merender `{nama_rs}` KOSONG, karena `identityVars()` disisipkan `enqueueMessage()`
sebagai dasar dan skripnya tidak memanggilnya. Pratinjau yang berbeda dari
kenyataan adalah persis yang membuat staf membuang variabel yang sebenarnya sudah
benar (pelajaran `worker/triggerVars.ts`). Sesudah diperbaiki, baris keduanya
terisi nama rumah sakit dari `sik.setting`.

### Grant: tidak diwarisi, untuk KETUJUH kalinya

Diuji empiris lewat koneksi `wakhanza_rw` yang sesungguhnya, SEBELUM grant:

```
[BISA]    INSERT
[BISA]    SELECT
[DITOLAK] UPDATE -- UPDATE command denied to user wakhanza_rw for table erm_target
[DITOLAK] DELETE -- DELETE command denied to user wakhanza_rw for table erm_target
```

Sesudah `GRANT UPDATE, DELETE ON wakhanza.erm_target` lewat root:

```
[BISA]   SELECT
[BISA]   UPDATE
[BISA]   DELETE
sisa baris uji: 0
```

(INSERT lalu ditolak `uq_chat` -- itu unique key bekerja, bukan grant.)

### Runner benar-benar berjalan, dan pagar tujuannya menahan

Diuji dengan sakelar dinyalakan SEMENTARA selagi `erm_target` KOSONG, sehingga
runner berhenti di pemeriksaan tujuan sebelum menyentuh `sik` -- nol risiko
mengirim apa pun:

```
tujuan terdaftar: 0
semula: erm=0 penilaian=0 jam=13:00,19:30
-- memanggil runPenilaianRekapIfDue() --
-- selesai tanpa melempar --
penanda sesudahnya: ""
[ok] penanda TIDAK maju -- benar: keadaan salah setel harus bisa dibetulkan lalu jalan lagi
sakelar dikembalikan ke keadaan semula.

WARN: rekap penilaian jatuh tempo tapi belum ada tujuan aktif  slot: "00:00"
```

Keadaan sesudahnya diperiksa: kesebelas kunci `erm.*` kembali ke nilai semula,
`erm_target` 0 baris, dan loop terdaftar (`src/worker/index.ts:564`).

### Gerbang penuh

```
npm run typecheck    -> bersih
npm run lint         -> bersih
npm test             -> 50 suite, 849 uji, seluruhnya lolos
npm run build        -> Compiled successfully (/erm dan /erm/penilaian-umum terdaftar)
npm run verify:db    -> lolos (sik tulis DITOLAK, audit_log append-only tegak)
npm run verify:plans -> lolos
```

`npm test` sempat GAGAL satu, dan itu gerbang yang bekerja:

```
x label pemicu di luar tabel template > setiap pemicu yang dipakai runner punya label manusianya
  + Array [ "ERM_PENILAIAN_UMUM" ]
```

`TRIGGER_LABEL` belum memuat pemicu barunya. Diperbaiki, bukan dilonggarkan.

### Dijalankan lewat PM2, bukan server uji terpisah

```
pm2 restart wakhanza-web
/login                 -> 200
/erm/penilaian-umum    -> 307 (redirect ke login; otorisasi tegak tanpa sesi)
penanda fitur di build -> .next/server/chunks/ssr/src_app_(dashboard)_erm_penilaian-umum_*.js
```

Worker dimulai ulang lewat prosedur tiga langkah yang terdokumentasi:

```
pm2 stop wakhanza-worker
Chromium pemegang sesi tersisa: 0
pm2 start wakhanza-worker
-> online, restart counter TETAP 8 (tidak ada kaskade)
-> wa_session.status = 'ready', heartbeat umur 4 detik, zona sesi '+00:00'
```

Umur denyut dibaca lewat `TIMESTAMPDIFF` MENTAH karena jalurnya Sequelize
(`@@session.time_zone = '+00:00'`, jadi `NOW()` ikut UTC). Memakai `CONVERT_TZ`
di jalur itu menghasilkan galat 7 jam dengan tanda terbalik.

### Tombol uji mengirim rekap PRODUKSI -- dibuktikan lewat tombolnya sendiri

Seluruh bukti di bawah diambil 2026-08-13 terhadap instance PM2 yang benar-benar
dipakai (`wakhanza-web`, port 3100) di atas database produksi. Bukan `next start`
di port terpisah -- lihat "Dijalankan lewat PM2" di atas.

#### Keadaan awal: fitur SUDAH menyala, dan tidak satu pun rekap pernah terkirim

```
erm.enabled              = "1"
erm.penilaian_enabled    = "1"
erm.penilaian_jam        = "13:00,19:30"
erm.penilaian_kolom_inti = "td,nadi,suhu,rr,keluhan_utama"
erm.penilaian_last_run   = "2026-08-13 13:00"
erm_target               : 1 baris (grup, aktif=true, terima=true)

outbox WHERE trigger_code = 'ERM_PENILAIAN_UMUM'  ->  0 baris
```

Penanda menyatakan slot 13:00 sudah berjalan sementara `outbox` kosong. Itu BUKAN
kegagalan melainkan cabang "sengaja diam" yang bekerja persis seperti rancangannya
-- dan sebabnya terukur:

```
tanggal      total  baru  ralan_baru
2026-08-13       3     0          0     <- ketiganya pasien LAMA
2026-08-12      30    11         11
2026-08-11      26     6          6
2026-08-10      48    13         13
```

Hari itu nol pasien baru, jadi `rekapKosong()` benar dan `template_penilaian_kosong`
memang dikosongkan. Yang salah bukan perilakunya melainkan bahwa **tidak ada satu
pun cara melihat buktinya**: tombol uji yang lama mengirim teks contoh.

#### Yang dikirim tombol LAMA vs tombol BARU

```
#46269  sent  ack=-  panjang= 137   <- teks contoh, ditekan 14:37
#46284  sent  ack=2  panjang= 819   <- rekap sungguhan, ditekan 14:50
```

`ack=2` (`ACK_DEVICE`) pada baris kedua adalah konfirmasi WhatsApp bahwa pesannya
sampai ke perangkat, bukan sekadar diterima servernya -- bukti yang lebih kuat
daripada `sent`, dan yang justru TIDAK dipunyai baris lama.

#### Tombolnya benar-benar ditekan, lewat peramban

Bukan memanggil server action dari skrip: yang perlu dibuktikan adalah TOMBOLNYA.
Akun admin sementara dibuat lewat `npm run users -- add`, dipakai, lalu dihapus di
alur yang sama (`npm run users -- list` sesudahnya kembali menampilkan dua akun
yang sah).

```
sesudah login  : http://127.0.0.1:3100/ringkasan
halaman        : http://127.0.0.1:3100/erm/penilaian-umum?dari=2026-08-12&sampai=2026-08-12
judul          : Penilaian umum
chip golongan  : Semua (11) | Belum diisi (1) | Terisi sebagian (4) | Lengkap (6)
tombol         : ditemukan, menekan...
dialog         : Kirim rekap uji / Asesmen akan menerima rekap 2026-08-12 -- sama
                 persis dengan yang berangkat terjadwal, termasuk nama pasien dan
                 nomor rekam medis, bukan kalimat contoh. Pesannya ditandai
                 [UJI COBA] di baris pertama.
konfirmasi     : menekan "Kirim sekarang"...

=== HASIL TOMBOL ===
Rekap 2026-08-12 diantrekan ke "Asesmen" -- 1 belum diisi, 4 terisi sebagian.
```

Angka pada pesan hasil (**1 belum, 4 sebagian**) cocok persis dengan chip saringan
yang dibaca dari halaman SEBELUM tombolnya ditekan. Itu yang membuktikan halaman
dan pesan berangkat dari penurunan yang sama, bukan dua hitungan yang kebetulan
mirip.

Dua penyaring yang wajib ada di skrip ujinya, keduanya pelajaran yang sudah dibayar:

- **Tombol disaring VISIBILITAS dan `!b.closest('dialog')`** -- halaman memuat
  `<dialog>` yang selalu ada di DOM, dan tombol di dalamnya berteks serupa
  (jebakan `/farmasi`).
- **Kondisi tunggu dibatasi ke elemen `<p>`, bukan `document.body`** -- halaman ini
  menjelaskan dirinya panjang lebar, dan teks statisnya nyaris selalu memuat kata
  yang sedang ditunggu (jebakan verifikasi kelima, `/farmasi`).

#### Isi pesan yang benar-benar masuk `outbox`

Nama pasien dan nomor rekam medis SENGAJA disamarkan di bawah -- berkas ini
tercatat di repositori publik. Yang disamarkan cuma identitasnya; strukturnya apa
adanya.

```
*[UJI COBA]* Kiriman ini ditekan manual dari dasbor, bukan rekap terjadwal.
Isinya data sungguhan hari ini -- silakan diperiksa, tapi jangan dianggap sebagai rekap resmi.

*Asesmen Awal Keperawatan*
<nama RS dari sik.setting>

Tanggal : 2026-08-12
Pasien baru : 11
Sudah lengkap : 6
Belum diisi : 1
Terisi sebagian : 4

*Belum diisi* (1)
- «nama disamarkan» / «RM» (13:18) - belum diisi

*Terisi sebagian* (4)
- «nama disamarkan» / «RM» (12:36) - belum: tekanan darah, nadi, pernapasan
- «nama disamarkan» / «RM» (16:30) - belum: tekanan darah, nadi, suhu, pernapasan
- «nama disamarkan» / «RM» (16:39) - belum: tekanan darah
- «nama disamarkan» / «RM» (17:16) - belum: tekanan darah, nadi, pernapasan

Mohon dilengkapi melalui SIMRS.

Kode Pengiriman : 2026-08-13 14:50:54 <kode>
```

Yang terbukti sekaligus di satu pesan ini: penanda `[UJI COBA]`, identitas RS
terisi dari `sik.setting` (bukan kosong -- pelajaran `identityVars()` di
`dryrun:penilaian`), kedua kelompok terpisah dengan judul dan jumlahnya, nama
kolom yang kurang diterjemahkan lewat `NAMA_KOLOM` ("td" -> "tekanan darah"), dan
baris kode pengiriman unik ikut ditempelkan.

Angka `6 + 1 + 4 = 11` berjumlah -- `jumlah_perlu_diisi` memang diturunkan, bukan
di-query terpisah.

#### Gerbang penuh sesudah perubahan

```
npm run typecheck    -> bersih
npm run lint         -> bersih
npm test             -> 50 suite, 849 uji, seluruhnya lolos
npm run build        -> Compiled successfully (/erm dan /erm/penilaian-umum terdaftar)
npm run verify:plans -> lolos
npm run verify:db    -> lolos (sik tulis DITOLAK, audit_log append-only tertegak)
pm2 restart wakhanza-web -> online
```

#### Yang BELUM terbukti, dan sengaja dikatakan

Jalur TERJADWAL (`runPenilaianRekapIfDue` -> `enqueueMessage`) belum pernah
menghasilkan satu baris `outbox` pun di produksi, karena satu-satunya slot yang
jatuh tempo sejak fiturnya dinyalakan jatuh pada hari yang nol pasien baru. Yang
sudah terbukti adalah SELURUH rantai di bawahnya -- `susunRekapPenilaian()`,
`loadFarmasiContext()`, `enqueueMessage()`, pemecahan bagian, dispatcher, dan ack
-- karena tombol uji memakai fungsi yang sama persis. Yang tersisa tak terbukti
tinggal `slotJatuhTempo()` yang benar-benar memicu pengiriman, dan itu pun sudah
terbukti separuh: penandanya memang maju ke `2026-08-13 13:00` sendiri.

Jangan membalik klaim ini ke arah sebaliknya: nol baris di sini BUKAN bukti bahwa
jalur terjadwalnya tidak bekerja.

---

## Audit kesesuaian fitur terhadap desain sistem (13 Agustus 2026)

Sasarannya dua: membuktikan fitur yang berjalan memang sesuai desain, dan menambal
bagian desain yang belum terdokumentasi. Hasilnya terbelah tajam -- **produknya
lolos setiap invarian yang dijaga mesin**, sementara dokumen desainnya
(`ARCHITECTURE.md`) berhenti di Fase 0-4.

### Gerbang: seluruhnya lolos

```
tsc --noEmit                    0 galat
eslint .                        0 galat
jest                            50 suite / 852 uji lolos   (sebelumnya 849)
jest --config jest.integration  3 suite / 46 uji lolos      (MariaDB sungguhan)

npm run verify:db
  [ok] sik      : tersambung, 1157 tabel, kolom lengkap
  [ok] sik      : tulis DITOLAK (benar)
  [ok] wakhanza : tersambung, 25 tabel
  [ok] audit_log: DELETE/UPDATE DITOLAK (benar)

npm run verify:plans            56 pemeriksaan, 239 baris EXPLAIN, lolos
```

### Temuan 1: gerbang label MENGKLAIM kelengkapan yang tidak dimilikinya

`labels.test.ts` menjaga setiap kode pemicu punya label manusia -- kegagalan yang
sudah terjadi TIGA kali (`FARMASI_PENGADAAN`/`_PEMESANAN`/`_HIBAH` hidup
berbulan-bulan tanpa label, sehingga Antrean dan Log menampilkan kode mentah).
Komentarnya menyatakan konstanta `TRIGGER_*` di `src/worker/*.ts` adalah
"satu-satunya sumber kebenaran soal kode mana yang bisa muncul di layar".

**Klaim itu keliru, dan terukur.** `outbox` produksi memuat 20 kode berbeda:

```sql
SELECT DISTINCT trigger_code FROM outbox ORDER BY 1;
-- ADMINISTRASI, AUTO_REPLY, BILLING_READY, BOOK_CANCEL, BPJS_BATAL, BROADCAST,
-- FARMASI_HIBAH, FARMASI_PENGADAAN, FARMASI_PENJUALAN, FARMASI_PENJUALAN_REKAP,
-- FARMASI_PENYERAHAN, FARMASI_RESEP_REKAP, FARMASI_STOK_DARURAT, FARMASI_UJI,
-- FARMASI_VALIDASI, KONTROL_TERBIT, LAB_REQUEST, PHARMACY_READY, QUEUE_REG,
-- RESULT_READY
```

Gerbang lamanya menjaring 12 kode dan **meloloskan delapan**:

```
gerbang lama menjaring: 12 kode
  BPJS_KONTROL        -> LOLOS (tak pernah diperiksa)
  BPJS_BATAL          -> LOLOS
  ADMINISTRASI        -> LOLOS
  AUTO_REPLY          -> LOLOS
  BROADCAST           -> LOLOS
  FARMASI_UJI         -> LOLOS
  FARMASI_VALIDASI    -> LOLOS
  FARMASI_PENYERAHAN  -> LOLOS
```

Sebabnya: `outbox.trigger_code` lahir dari `PipelineContext.triggerCode`, dan itu
diisi lewat **empat bentuk berbeda** -- konstanta runner, properti objek
(`triggerCode: 'BROADCAST'`), parameter berdefault (`triggerCode =
'ADMINISTRASI'` di `pipeline.ts`), dan argumen pertama `loadFarmasiContext()`.
Bentuk kedua justru yang paling gampang dipakai fitur berikutnya.

Kedelapannya kebetulan punya label hari ini, jadi **tidak ada bug yang sedang
berjalan** -- tapi kebetulan bukan penegakan. Gerbangnya kini menjaring keempat
bentuk (23 kode) dan sengaja TIDAK menjaring prefiks yang cuma dipakai sebagai
kunci idempoten (`BPJS_BATAL_REKAP`, `BROADCAST_FOLLOWUP`, `BOOKING_SCAN`),
karena ketiganya tidak pernah menjadi `trigger_code`.

**Dibuktikan MENGGIGIT**, bukan diasumsikan -- label `BPJS_KONTROL` (salah satu
dari delapan yang dulu lolos) dilepas sengaja lalu dikembalikan:

```
× setiap pemicu yang bisa masuk outbox punya label manusianya (2 ms)
  +   "BPJS_KONTROL"
Tests: 1 failed, 12 passed, 13 total
```

### Temuan 2: ERM_PENILAIAN_UMUM tertinggal dari daftar lewat jam tenang

Kelas WAKTU dengan jam yang dipilih staf sendiri melewati jam tenang -- aturan
yang sudah ditegakkan untuk `FARMASI_STOK_DARURAT`, `FARMASI_PENJUALAN_REKAP`,
dan `FARMASI_RESEP_REKAP`, dengan alasan yang sama: menundukkannya berarti
diam-diam mengabaikan jam yang baru saja mereka setel. `ERM_PENILAIAN_UMUM`
memenuhi setiap syaratnya dan **tidak ada di daftar**.

Itu KELALAIAN, bukan keputusan, dan dibuktikan dengan mencarinya:

```
grep -n "jam tenang|quiet|BYPASS" src/worker/penilaianRunner.ts \
      migrations/044_erm_penilaian.sql src/app/(dashboard)/erm/penilaian-umum/*.tsx
-> (kosong)
```

Tidak ada satu pun sebutan jam tenang di seluruh fitur itu. Kedua slot bawaannya
(13:00 dan 19:30) kebetulan jatuh di luar jam tenang, jadi ia bekerja benar apa
adanya -- dan justru itu yang membuat lubangnya tidak bergejala. Yang membukanya
`migrations/044` sendiri, yang menuliskan `erm.penilaian_jam` "menerima daftar
berapa pun": slot 21:30 karena itu pemakaian yang SAH menurut fiturnya sendiri,
dan tanpa perbaikan ini ia tertahan sampai 07:00 keesokan hari.

Ketiga rekap kini dipatok BERSAMA-SAMA, dan yang dijaga bukan nilai
masing-masing melainkan bahwa ketiganya SAMA. Dibuktikan menggigit dengan
mengomentari barisnya lalu mengembalikannya:

```
× ketiga rekap berjadwal sama-sama MELEWATI jam tenang (2 ms)
Tests: 1 failed, 17 passed, 18 total
```

**Nol perubahan di produksi**: `erm.penilaian_enabled` masih mati. Berbeda dari
keempat pemicu nota barang, yang komentarnya juga menyatakan "jam tenang
dilewati" sementara perilakunya tidak -- keempatnya sedang MENYALA, jadi itu
tetap tidak disentuh dan tetap keputusan pemilik sistem.

### Temuan 3: identitas pasien SUNGGUHAN di dalam berkas uji

`src/worker/bpjsRunner.int.test.ts` memakai `RISNAWATI`, `YESNI`, `LASTRI`, dan
no. RM `000130`/`007360`. Diperiksa terhadap `alca` dengan `COUNT(*)` saja --
tanpa menarik satu baris pun:

```
rm_000130_ada        1     <- nomor RM NYATA
nama_cocok_rm        0     <- tapi bukan bernama RISNAWATI
nama_risnawati_ada   2     <- nama itu ada pada 2 pasien sungguhan
nama_yesni_ada       0
nama_lastri_ada      7     <- dan ini pada 7 pasien sungguhan
rm_007360            1     <- nomor RM NYATA
```

Pasangannya memang tidak cocok, jadi ia bukan salinan utuh satu rekam -- tapi
nomor RM-nya nyata dan kedua namanya ada di tabel pasien. Berkas uji ikut
ter-commit dan terdorong ke remote, sementara ini persis yang §9.7 larang keluar
dari mesin ini. Kegagalannya tidak bergejala: uji itu hijau, dan hijau tidak
mengatakan apa pun soal ini.

Diganti dengan nilai yang terbukti nol baris di `pasien` (`PASIEN UJI SATU/DUA/
TIGA`, RM `UJI0001`/`UJI0002`), berikut catatan di kepala berkas supaya bentuknya
mustahil disalahpahami. `Jantung` sengaja DIBIARKAN: nama poli adalah katalog
layanan yang memang diumumkan RS, bukan identitas seseorang. Uji integrasinya
tetap lolos seluruhnya (46 uji, 3 suite) terhadap database sungguhan.

### Yang ditambal di ARCHITECTURE.md

Dokumen desainnya berhenti di Fase 0-4 sementara CLAUDE.md membawa seluruh
keputusan sesudahnya. Itu pembagian yang salah: CLAUDE.md dimuat ke SETIAP sesi,
sementara ARCHITECTURE.md justru yang ditunjuk sebagai bacaan wajib sebelum
menyentuh kode. Selisihnya diukur, bukan dikira:

| Seksi | Klaim lama | Kenyataan |
|---|---|---|
| §1 | "Next.js 14", "1.234 tabel", "node-cron (H-1, pembersihan)" | Next 16.2.12; 1157 tabel; 15 siklus pemicu |
| §3 | 11 tabel `001_init` | **24 tabel** + 8 kolom baru di `outbox`, 2 di `template`, 1 nilai enum status |
| §4.1 | "**Dua** kelas pemicu" | **enam** kelas, plus satu yang berkelas WAKTU tapi memberitakan KETIADAAN |
| §4.2 | 7 pemicu | **21 baris**, plus 4 aturan bentuk kunci yang ketiganya gagal DIAM bila dilanggar |
| §4.7 | 3 baris irama, "tiap query `LIMIT 200`" | dua angka interval + satu kekecualian terukur (0,07 ms); batas TIDAK seragam, dan yang mengikat adalah "batas yang tersentuh wajib terlihat" |
| §4.8 | pindai penuh cuma untuk `booking_registrasi` | **sembilan izin**, per TABEL bukan per query, dua di antaranya sementara |
| §5.2 | "**tanpa memandang daftar**" -- hasil/obat/diagnosis tidak pernah boleh masuk | **sudah tidak mutlak** sejak 026 dan 038, dan syarat yang membenarkannya |
| §6.2 | dikecualikan: `BOOK_CANCEL` | **sebelas kode**, lewat tiga alasan sah |
| §7 | diagram sesi sehat saja | + kunci port instance tunggal, probe `window.WWebJS`, watchdog 15 menit |
| §8 | `^(stop\|berhenti\|unsubscribe)$`, "pesan masuk lain diabaikan" | frasa tiga kata yang dicocokkan sebagai BAGIAN kalimat; balasan otomatis ADA |

Tiga di antaranya bukan sekadar tidak lengkap melainkan **menyesatkan**, dan itu
lebih berbahaya: §5.2, §6.2, dan §8 sama-sama menuliskan aturan MUTLAK yang
kodenya sudah punya kekecualian. Pembaca yang memercayainya akan menyimpulkan
sistem ini tidak bisa melakukan sesuatu yang sebenarnya bisa -- §5.2 khususnya,
karena yang dibantahnya adalah larangan privasi.

Yang sengaja TIDAK dilakukan: menyalin DDL 15 tabel ke dalam dokumen. DDL yang
disalin adalah DDL yang cepat atau lambat menyimpang dari migrasinya; yang
dituliskan adalah bentuk dan ALASAN tiap tabel berdiri sendiri.

## PERINTAH LEWAT WHATSAPP (`migrations/045`) -- arah masuk yang MENULIS

### Gerbang

```
tsc --noEmit                    0 galat
eslint .                        0 galat
jest                            51 suite / 896 uji lolos   (sebelumnya 852)
jest --config jest.integration  3 suite / 46 uji lolos      (MariaDB sungguhan)
next build                      lolos

npm run verify:db
  [ok] sik      : tersambung, 1157 tabel, kolom lengkap
  [ok] sik      : tulis DITOLAK (benar)
  [ok] wakhanza : tersambung, 27 tabel      <- 25 sebelum migrasi 045
  [ok] audit_log: DELETE/UPDATE DITOLAK (benar)

npm run verify:plans            lolos
```

### Grant per-tabel TIDAK diwarisi -- pembuktian kedelapan

Diperiksa EMPIRIS sebelum grant diterapkan, bukan diasumsikan:

```
INSERT INTO wa_command_admin ...            -> berhasil (grant skema-lebar)
UPDATE wa_command_admin SET label='X' ...   -> ERROR 1142 (42000): UPDATE command denied
DELETE FROM wa_command_session WHERE id=0;  -> ERROR 1142 (42000): DELETE command denied
```

Sesudah `GRANT UPDATE, DELETE` lewat root:

```
update_berhasil  1
delete_berhasil  1
sisa_admin  sisa_sesi
0           0            <- baris uji dibersihkan
```

### Uji END-TO-END terhadap database wakhanza SUNGGUHAN

Menjalankan `cobaPerintahWa()` yang SAMA dipakai worker -- bukan tiruan.
Tujuannya JID grup yang tidak ada, jadi tidak satu pun pesan sampai ke orang
sungguhan; seluruh baris dibersihkan di akhir.

```
1. Alamat TAK BERWENANG didiamkan
  [ok] tidak ditangani            [ok] sebabnya tak_berwenang
2. Pesan biasa dari alamat BERWENANG tetap lewat
  [ok] tidak ditangani
3. /tambah tiga langkah -> aturan tersimpan NONAKTIF
  [ok] langkah 1 dijawab          [ok] bertanya nama aturan
  [ok] bertanya kata kunci        [ok] bertanya isi balasan
  [ok] petunjuk variabel TIDAK dirender jadi nama RS
  [ok] aturan tersimpan           [ok] tersimpan NONAKTIF (sakelar mati)
  [ok] kata kunci ternormalisasi  [ok] pelaku tercatat sebagai wa:<alamat>
  [ok] sesi sudah dibersihkan
4. Penyerahan ulang pesan yang SAMA tidak memajukan apa pun
  [ok] ditandai diserahkan ulang  [ok] tidak membuka sesi baru
5. Nama ganda ditolak, langkah TIDAK maju
  [ok] ditolak dengan sebabnya    [ok] masih di langkah nama
  [ok] /batal menutup sesi
6. Variabel tak dikenal ditolak lewat chat, sama seperti dashboard
  [ok] menyebut variabel yang salah
  [ok] aturannya TIDAK tersimpan
7. /daftar dan /uji
  [ok] menyebut aturan yang baru dibuat
  [ok] aturan NONAKTIF tidak menjawab apa pun
8. /ubah -> aktifkan, lalu /uji menjawab
  [ok] aturan uji ada di daftar bernomor   [ok] aturan jadi AKTIF
  [ok] sekarang dijawab aturan itu         [ok] variabel dirender sungguhan
9. /hapus dengan konfirmasi
  [ok] minta konfirmasi YA
  [ok] jawaban selain YA tidak menghapus   [ok] YA menghapus
10. Sakelar mati -> perintah berhenti dilayani
  [ok] tidak ditangani            [ok] sebabnya mati
11. Semua balasan melewati outbox dengan kode pemicunya sendiri
  [ok] ada baris outbox WA_PERINTAH
  [ok] TIDAK ada yang menumpang AUTO_REPLY

bersih-bersih: 23 baris outbox, 0 aturan, sesi & daftar putih uji dihapus
=== 33 lolos, 0 gagal ===
```

Keadaan sesudahnya, diperiksa langsung:

```
autoreply.wa_perintah_enabled       0
autoreply.wa_sesi_timeout_menit     10
autoreply.wa_tambah_aktif_langsung  0

sisa_admin  sisa_sesi  sisa_outbox  sisa_aturan_uji
0           0          0            0
```

### Bug yang HANYA bisa ditemukan end-to-end

Percobaan pertama gagal pada SATU asersi, dan yang gagal itu bug sungguhan:
langkah 6 melaporkan `[GAGAL] menyebut variabel yang salah`.

Sebabnya: balasan wizard bukan template, tapi tetap melewati `renderTemplate()`
di dalam `enqueueMessage`. Variabel yang TIDAK dikenal dirender jadi string
KOSONG, jadi pesan

```
Variabel tidak dikenal: {nama_pasien}.
Yang tersedia: {nama_rs} {alamat_rs} ...
```

sampai ke staf sebagai `Variabel tidak dikenal: .` -- **kalimat yang ada justru
untuk menyebutkan kesalahannya menghapus kesalahannya sendiri**, dan staf tidak
punya cara mengetahui variabel mana yang harus dibetulkan.

Yang penting dicatat: **41 uji unit mesin keadaan LOLOS seluruhnya** atas kode
yang sama. Uji itu memeriksa nilai balik fungsi murni, yaitu SEBELUM perenderan
pernah terjadi -- jadi ia tidak bisa dan tidak akan pernah bisa menangkapnya.
Bentuk kegagalan yang sama pernah dibayar di bug `@lid` dan `@mention`: bagian
yang "terlalu kecil untuk salah" adalah persis bagian yang tidak diuji.

Diperbaiki lewat `varsBalasanApaAdanya()` (memetakan tiap variabel yang muncul
ke bentuk literalnya sendiri, sehingga perenderan jadi operasi identitas), dan
patokannya dipasang sebagai uji PERILAKU yang benar-benar merender:

```
√ petunjuk variabel tidak berubah jadi nilai sungguhannya
√ nama variabel yang SALAH tetap tersebut sesudah dirender
√ teks tanpa variabel tidak tersentuh
```

### Bite-proof: daftar bernomor yang dibekukan

Aturan bisa dihapus lewat dashboard di sela dua pesan. Kalau nomor pilihan
dibaca ulang dari daftar yang HIDUP alih-alih yang DITAMPILKAN, staf menghapus
aturan yang bukan dilihatnya. Dirusak sengaja lalu dikembalikan:

```
× nomor menunjuk aturan yang DITAMPILKAN, bukan urutan terbaru
  Expected: 20
  Received: 30
Tests: 1 failed, 40 passed, 41 total
```

### Bite-proof: gerbang label menangkap kode pemicu baru

`WA_PERINTAH` adalah kode pemicu PERTAMA yang ditambahkan sesudah gerbang
`labels.test.ts` diperbaiki (audit 13 Agustus 2026). Labelnya dilepas sengaja:

```
× setiap pemicu yang bisa masuk outbox punya label manusianya
  + Array [
  +   "WA_PERINTAH",
  + ]
Tests: 1 failed, 12 passed, 13 total
```

Ia dijaring lewat bentuk `triggerCode = 'WA_PERINTAH'` -- salah satu dari empat
bentuk yang gerbang LAMA tidak kenali sama sekali. Dengan gerbang lama, kode ini
akan lolos tanpa label persis seperti delapan kode sebelumnya.

### Jam tenang

`WA_PERINTAH` masuk `BYPASS_QUIET_HOURS`. Tanpa itu, staf yang mengetik nama
aturan pukul 21.30 tidak pernah ditanyai kata kuncinya -- dan sesinya sendiri
sudah kedaluwarsa (10 menit) jauh sebelum balasannya berangkat pukul 07.00, jadi
fiturnya bukan sekadar lambat melainkan MUSTAHIL DIPAKAI selama sepuluh jam
setiap hari. Kedua alasan sah pengecualian berlaku sekaligus di sini: ada orang
yang sedang menunggu, DAN penerimanya staf.

`OPT_OUT_TRIGGERS` sengaja TIDAK memuatnya -- tidak ada yang bisa "berhenti
berlangganan" dari percakapan yang ia mulai sendiri.

### `/bantuan` menerangkan keadaan, dan kemampuannya per-ALAMAT

Diverifikasi saat fiturnya SUDAH MENYALA di produksi (`wa_perintah_enabled` 1,
satu alamat terdaftar, enam aturan tersimpan -- salah satunya memang lahir lewat
WhatsApp, `created_by` berawalan `wa:`). Karena itu ujinya **tidak menyentuh satu
pun setelan**: yang dibuat cuma dua alamat uji berupa JID grup yang dibuktikan
lebih dulu tidak bertabrakan dengan apa pun (`wa_command_admin`, `farmasi_target`,
dan `wa_group` semuanya 0), lalu dihapus di akhir.

```
tsc --noEmit     0 galat
eslint .         0 galat
jest             51 suite / 907 uji lolos   (sebelumnya 896)
next build       lolos
npm run verify:db     [ok] wakhanza 27 tabel; sik tulis DITOLAK
npm run verify:plans  lolos
```

Uji end-to-end menjalankan `cobaPerintahWa()` yang SAMA dipakai worker, lalu
membaca teks yang benar-benar masuk `outbox` -- sesudah `renderTemplate()`, yaitu
celah tempat bug 045 hidup:

```
1. Alamat yang HANYA berwenang atas perintah
  [ok] dijawab                        [ok] menyebut alamatnya berwenang
  [ok] menyebut keadaan balasan otomatis
  [ok] menyebut jumlah aturan tersimpan   [ok] menyebut nasib aturan baru
  [ok] menyebut aturan yang SUDAH ada     [ok] setiap perintah disebut
  [ok] TIDAK menawarkan tanya stok        [ok] TIDAK menawarkan rekap gudang
  [ok] menyebut sebab dan jalan keluarnya
  [ok] variabel template TIDAK terender
2. Alamat yang JUGA boleh bertanya stok
  [ok] menawarkan tanya stok          [ok] menyebut kata kunci sungguhan
  [ok] menyebut kata tanya ketersediaan
  [ok] menyebut jawaban rinci untuk yang terdaftar
  [ok] menawarkan rekap gudang        [ok] menyebut frasa rekap sungguhan
3. /help dan /perintah sama dengan /bantuan
  [ok] /help sama persis              [ok] /perintah sama persis
4. Panjangnya masih wajar untuk satu pesan WhatsApp
  polos 1638 karakter, apotek 1834 karakter
  [ok] di bawah 4096
5. Tidak menyentuh apa pun milik produksi
  [ok] bantuan tidak membuka sesi

bersih-bersih: 4 baris outbox uji dihapus
=== 22 lolos, 0 gagal ===
```

Sesudahnya, diperiksa langsung: `sisa_admin` 0, `sisa_farmasi` 0, `sisa_sesi` 0,
`sisa_outbox` 0, sementara `admin_produksi` tetap 1 dan `aturan_produksi` tetap 6
-- sama persis dengan sebelum uji dijalankan.

**Bite-proof: bantuan tidak boleh menawarkan yang tidak dimiliki pembacanya.**
Pagar izinnya dilepas sengaja (`if (kemampuan.bolehTanyaStok)` -> `if (true)`):

```
× TIDAK menawarkan tanya stok kepada alamat yang tidak berhak
  Expected substring: not "Stok & harga obat"
Tests: 1 failed, 53 passed, 54 total
```

Ini kegagalan yang paling tidak bergejala di fitur ini: bantuannya tampil wajar,
orangnya mengetik apa yang disuruh, lalu tidak dijawab -- dan tidak ada satu pun
galat yang menyebut sebabnya, karena memang tidak ada yang salah selain
alamatnya. Wewenang perintah (`wa_command_admin`) dan wewenang bertanya stok
(`farmasi_target.boleh_tanya`) memang dua daftar terpisah, dan itu keputusan yang
paling ditekankan migrasi 045 sendiri.

**Refaktor `stokReply.ts` nol-perubahan-perilaku.** `izinTanyaStok()` dan
`izinTanyaDarurat()` diekspor lalu dipakai gerbangnya sendiri, supaya bantuan
menjawab lewat penurunan yang sama alih-alih menghitung ulang. Predikatnya
identik dan urutan hubung-singkatnya dipertahankan (`mode === 'mati'` lebih dulu;
`daruratTanyaAktif()` sebelum `count`); yang berpindah cuma penyusunan `asal`
yang murni. Fitur stok sedang MENYALA di mesin ini (`stok_mode` = `semua`,
`darurat_enabled` = 1), jadi ini bukan refaktor atas kode yang menganggur.

## Celah `initWaClient()`: denyut dan watchdog naik ke atas penautan

Perbaikan 14 Agustus 2026, langsung sesudah gangguan yang memperlihatkannya.

### Celahnya, terukur dari log produksi sebelum perbaikan

`await initWaClient()` ada di `worker/index.ts:346`; `loop('heartbeat', ...)` dan
`loop('session-watchdog', ...)` di baris 602 dan 604. Akibatnya proses yang
menggantung DI DALAM penautan tidak berdenyut dan tidak diawasi:

```
708231  pid 14228  wakhanza-worker memulai...
708231  pid 14228  koneksi database terverifikasi
        (325,8 detik tanpa satu baris pun; denyut tidak maju sama sekali)
708557  pid 14228  Runtime.callFunctionOn timed out ... -- worker gagal memulai
708563  pid 9340   wakhanza-worker memulai...          <- PM2 mengulang
```

Terulang persis pada pid 17180: 708895 -> 709220, **325,8 detik lagi**. Durasi
yang identik dua kali itulah yang membedakannya dari gangguan jaringan.

Yang paling mahal bukan matinya melainkan CARA matinya: galat itu jatuh ke
`main().catch()` lalu `process.exit(1)` TANPA lewat `shutdown()`, jadi Chromium
mati mendadak di tengah menulis state sesi dan start berikutnya mewarisi
kerusakannya.

### Bukti bahwa dua keadaan itu memang tak terbedakan tanpa denyut

Diukur berdampingan pada malam yang sama:

| Instance | `wa_session.status` | umur denyut | sebenarnya |
|---|---|---|---|
| pid 11980 | `authenticating` | 9 dtk (segar) | sudah lolos init, sesi tak kunjung `ready` -> watchdog menolong di menit ke-15 |
| pid 14228 | `authenticating` | 618 dtk dan tumbuh | masih DI DALAM init -> **tidak ada yang menolong** |

Kolom kedua identik. Hanya kolom ketiga yang membedakannya, dan justru itu yang
tidak tersedia sebelum perbaikan ini.

### Perbaikannya

`core/watchdog.ts` (fungsi murni) + urutan di `worker/index.ts`:

- `heartbeat` dan `session-watchdog` dipasang SEBELUM `await initWaClient()`.
- Fase `menautkan` jadi cabang tersendiri, batas `BATAS_INIT_MS` = 180 detik --
  lebih pendek daripada `protocolTimeout` 300 detik supaya keduanya tidak
  berlomba, dan jauh di atas penautan sehat (terukur 5-13 detik).
- Keluarnya lewat `shutdown()`, bukan dibiarkan sampai `protocolTimeout`.
- Status TIDAK dibaca selama penautan (baris `wa_session` masih milik proses
  sebelumnya).
- Peringatan `session_init_stuck`, terpisah dari `session_stuck`.
- `session-command` sengaja TIDAK ikut naik: ia mengosongkan kolom perintah
  sebelum bertindak, jadi menaikkannya menelan perintah dashboard diam-diam.

### Terbukti di produksi pada restart pemasangannya

```
+0 ms     wakhanza-worker memulai...
+66 ms    [warn] fase:"menautkan" status:null  "sesi WhatsApp masih menautkan"
+13,3 dtk memulai siklus poller
+15,6 dtk WhatsApp terautentikasi, menunggu ready
+15,8 dtk WhatsApp siap
```

Baris kedua adalah buktinya: watchdog berbunyi 66 ms sesudah proses mulai, di
dalam fase yang sebelumnya tidak diawasi sama sekali. `status:null` membuktikan
ia menolak membaca status basi dari database. Sesudahnya `wa_session` `ready`
dengan denyut 5 detik, PM2 `restarts 1`, tanpa kaskade.

### Bukti MENGGIGIT

Cabang `menautkan` dihapus dari `putusanWatchdog()` (mengembalikan perilaku
sebelum perbaikan):

```
× diam selama penautan masih di dalam batas
× keluar begitu penautan melewati batas
× TIDAK memeriksa kesehatan walau status basi berbunyi ready
× menyetel ulang jam kesiapan sepanjang penautan
Tests: 4 failed, 8 passed, 12 total
```

Asersi ketiga yang paling penting: tanpa cabang init, `status` basi berbunyi
`ready` mengirim watchdog memeriksa kesehatan klien yang belum jadi. Dipulihkan;
12 uji lolos.

### Gerbang

`tsc --noEmit` 0, `eslint` 0, **938 uji unit** (dari 926), `next build`,
`verify:db` (27 tabel, tulis ke `sik` ditolak), `verify:plans` lolos.

### Rekap BULANAN farmasi (`migrations/046`)

Seluruh bukti diambil 14 Agustus 2026 terhadap database produksi (`alca`) dan
instance PM2 yang benar-benar dipakai. Nama rumah sakit dan nilai rupiah
disamarkan seperlunya -- berkas ini tercatat di repositori publik.

#### `telaah_farmasi` ADA -- dugaan awal terbantah data

Permintaannya berbunyi "telaah ini yang belum ada sepertinya". Yang menjawabnya
daftar tabelnya sendiri:

```
telaah_farmasi                                 10463 baris
```

Strukturnya: PK `no_resep` (VARCHAR(14)), dua puluh kolom `enum('Ya','Tidak')`
hasil telaah, dan `nip` petugas. **Tidak ada satu pun kolom pasien** -- jadi
menghitungnya tidak melebarkan pagar privasi apa pun.

```
telaah yatim (baris telaah tanpa resep_obat) : 0
```

Nol itu yang membuktikan arah join-nya (`resep_obat` LEFT JOIN `telaah_farmasi`)
tidak menyembunyikan apa pun.

#### Angka yang mengubah bentuk fiturnya

```
bulan    resep  kunjungan  blm-validasi  blm-serah  tanpa-telaah
202602     467        441             0          9            30
202603     599        568             0         24            19
202604     629        593             0         35            13
202605     541        507             0         24            48
202606     629        589             0         99           100
202607     685        634             0        175           145
202608     349        328             0        103            53
```

Dua hal yang cuma terlihat dari periode BULAN:

- **TREN.** Belum diserahkan 9 → 175 (2% → 25,5%); belum ditelaah 30 → 145.
  Rekap harian menampilkan satu angka tanpa pembanding.
- **PASIEN vs KUNJUNGAN**, terukur berbeda 15%:

```
202605  kunjungan   507  pasien-unik   449  selisih 58
202606  kunjungan   589  pasien-unik   519  selisih 70
202607  kunjungan   634  pasien-unik   541  selisih 93
202608  kunjungan   328  pasien-unik   307  selisih 21
```

Keempat jalur barang, per bulan:

```
bulan   pengadaan          pemesanan   hibah   penjualan
202604   34 Rp31,80 jt      0 Rp0       0 Rp0    765
202605   31 Rp19,49 jt      0 Rp0       0 Rp0    732
202606   42 Rp26,07 jt      0 Rp0       0 Rp0    681
202607   26 Rp23,83 jt      0 Rp0       0 Rp0    716
202608   20 Rp15,73 jt      0 Rp0       0 Rp0    307
```

Pemesanan dan hibah NOL pada setiap bulan -- keduanya tetap dibaca dan tetap
ditampilkan sebagai 0, atas permintaan pemilik sistem.

#### Prefiks `no_resep` EKSAK

```
total 12466, cocok 12397, tgl_peresepan kosong 69, MENYIMPANG 0
```

Nol menyimpang atas seluruh tabel. Sekelas `nota_jual` penjualan, bukan sekelas
`no_faktur` pengadaan yang butuh margin -- tidak ada margin yang perlu
ditambahkan.

#### `belum_validasi` nol, dan itu bukan alasan membuangnya

```
tgl_perawatan: terisi 12465, nol 1, NULL 0
```

Satu baris bernilai nol. Jadi angkanya bukan konstanta struktural seperti
`{status_resep}` (yang ditolak migrations/042 karena 'ralan' pada SELURUH baris),
melainkan keadaan yang bisa berubah.

#### Rencana query: kesepuluhnya lolos, nol `type: ALL`

```
[ok] FARMASI_BULANAN_RESEP ro range PRIMARY  rows~685
[ok] FARMASI_BULANAN_RESEP tf eq_ref PRIMARY  rows~1  (Using index)
[ok] FARMASI_BULANAN_ITEM rd range no_resep  rows~3046  (Using index)
[ok] FARMASI_BULANAN_RACIKAN rr range PRIMARY  rows~24  (Using index)
[ok] FARMASI_BULANAN_NILAI ro range PRIMARY  rows~685
[ok] FARMASI_BULANAN_NILAI dpo ref PRIMARY  rows~2
[ok] FARMASI_BULANAN_PASIEN ro range idx_resep_obat_noresep_rawat  rows~685  (Using index)
[ok] FARMASI_BULANAN_PASIEN rp eq_ref PRIMARY  rows~1
[ok] FARMASI_BULANAN_PENGADAAN pb range PRIMARY  rows~26
[ok] FARMASI_BULANAN_PEMESANAN sp range PRIMARY  rows~1
[ok] FARMASI_BULANAN_HIBAH hb range PRIMARY  rows~1
[ok] FARMASI_BULANAN_PENJUALAN pj range PRIMARY  rows~716
[ok] FARMASI_BULANAN_PENJUALAN_NILAI pj range PRIMARY  rows~716  (Using index)
[ok] FARMASI_BULANAN_PENJUALAN_NILAI dj ref nota_jual  rows~1
verify:plans lolos.
```

TANPA satu pun izin pindai penuh.

#### Pagar privasi, diperiksa pada `Object.keys()` baris hasilnya

`npm run dryrun:bulanan -- alca 202607`:

```
kolom yang benar-benar terbaca: jml_resep, jml_kunjungan, belum_validasi,
  belum_serah, tanpa_telaah, jml_baris, jml_obat, jml_racikan, nilai_obat,
  jml_pasien, jml, nilai
[ok] PAGAR PRIVASI -- tidak satu pun kolom pasien, obat, dosis, atau hasil telaah terbaca
[ok] diserahkan + belum diserahkan = jumlah resep
[ok] ditelaah + belum ditelaah = jumlah resep
```

`no_rkm_medis` ada di daftar terlarang JUSTRU karena ia dipakai sebagai argumen
`COUNT(DISTINCT ...)` -- kalau suatu saat ia ikut jadi kolom hasil, pemeriksaan
inilah yang berbunyi.

#### Pesan yang benar-benar dirender

```
*Rekap Farmasi Bulanan*
<nama RS dari sik.setting>

Periode : Juli 2026

*Resep*
Jumlah resep : 685
Pasien berbeda : 541
Kunjungan : 634
Baris obat : 3.046
Racikan : 24
Sudah diserahkan : 510
Nilai obat : Rp17.539.001

*Perlu ditindaklanjuti*
• Belum divalidasi : 0 (0%)
• Belum diserahkan : 175 (25,5%)
• Belum ditelaah : 145 (21,2%)

*Barang*
• Pengadaan : 26 faktur, Rp23.832.476
• Pemesanan : 0 surat, Rp0
• Hibah : 0 penerimaan, Rp0
• Penjualan : 716 nota, Rp15.026.058

Rekap otomatis, dikirim Jumat, 14 Agustus 2026.

Kode Pengiriman : 2026-08-14 20:09:27 <kode>
```

`510 + 175 = 685` dan `540 + 145 = 685` -- keduanya berjumlah, karena diturunkan
bukan di-query terpisah.

#### Matematika bulanan: 22 uji, dan `setDate(1)` dibuktikan MENGGIGIT

`bulanRekap()` menyetel tanggal ke 1 sebelum mengurangi bulan. Dirusak sengaja:

```
× BENAR pada tanggal 29-31, tempat setMonth meluber
  Expected: "202602"
  Received: "202603"
Tests: 1 failed, 21 passed, 22 total
```

31 Maret dikurangi sebulan menghasilkan 3 Maret (Februari tidak punya tanggal
31), bukan Februari. Dikembalikan, 22 lolos.

#### Perilaku yang ditemukan saat VERIFIKASI, bukan saat merancang

```
sekarang            : 14/8/2026, 20.17.48
bulan yang direkap  : 202607 (Juli 2026)
jatuh tempo SEKARANG: 202607
simulasi 3/9/2026 pukul 08:00 -> 202608
```

Tanggal kirim 3 sudah lewat dan penanda kosong, jadi begitu sakelarnya dinyalakan
rekap Juli **langsung berangkat** -- bukan menunggu 3 September. Perilakunya benar
(rekap terlewat memang sengaja dikejar) dan berguna, tapi tak terduga bagi orang
yang menekan tombolnya. `BulananSwitch` sekarang membacakannya lebih dulu, lewat
`bulanJatuhTempo()` yang SAMA dipakai worker.

#### Sakelar mati = nol efek

```
outbox FARMASI_BULANAN: 0 -> 0
[ok] tidak menulis apa pun saat sakelarnya mati
```

#### Siklus BENAR-BENAR terdaftar di worker yang sedang berjalan

Dibuktikan dengan menyalakan sakelarnya SEMENTARA (nol tujuan mencentang
`terima_bulanan`), menunggu satu siklus pindai penuh, lalu mengembalikannya.
Aman karena bentuk kodenya: pemeriksaan tujuan ada SEBELUM `sik` disentuh.

Log worker produksi:

```json
{"level":40,"pid":17876,"bulan":"202607",
 "msg":"rekap bulanan farmasi jatuh tempo tapi belum ada tujuan yang mencentang \"terima rekap bulanan\""}
```

Satu baris itu membuktikan empat hal sekaligus: loop `farmasi-bulanan` terdaftar
dan berputar; `bulanJatuhTempo()` mendeteksi 202607 jatuh tempo; pemeriksaan
tujuan benar-benar di depan (`sik` tidak dibaca sama sekali); dan kegagalan
setelan bersuara `warn` alih-alih diam.

Keadaan sesudahnya:

```
sakelar dikembalikan ke "0"
outbox  : 0 -> 0
penanda : "" -> ""
  [ok] nol pesan, dan penanda TIDAK maju -- persis cabang "belum ada tujuan"
```

Penanda yang TIDAK maju itu yang penting: cabang "belum ada tujuan" sengaja tidak
memajukannya, karena ia keadaan salah setel yang bisa diperbaiki dalam hitungan
detik -- dan memajukannya berarti rekap SEBULAN PENUH hilang begitu saja.

#### Gerbang penuh

```
npm run typecheck    -> bersih
npm run lint         -> bersih
npm test             -> 55 suite, 979 uji, seluruhnya lolos
npm run build        -> Compiled successfully (/farmasi terdaftar)
npm run verify:plans -> lolos
npm run verify:db    -> lolos (sik tulis DITOLAK, audit_log append-only tertegak)
npm run migrate      -> 046_farmasi_bulanan.sql diterapkan
pm2 restart wakhanza-web    -> online
pm2 stop/start wakhanza-worker -> online, denyut 13 detik, status ready
```

Penanda fitur di build produksi:

```
HTTP /farmasi?tab=bulanan : 307 (redirect ke login -- rutenya ada, admin-only)
  'Rekap bulanan'   : 14 berkas
  'terima_bulanan'  : 3 berkas
  'bulanan_tanggal' : 3 berkas
  'rincian_mutu'    : 10 berkas
  'Kirim rekap uji' : 2 berkas
```

#### Dua jebakan migrasi, keduanya dibayar di jalan

1. **`app_setting` cuma `(k, v)`** -- tidak punya `updated_by`. INSERT gagal, dan
   karena DDL MariaDB tidak transaksional `ALTER TABLE` sudah terlanjur masuk
   sementara `schema_migrations` belum mencatat apa pun. Karena itu ALTER-nya
   memakai `ADD COLUMN IF NOT EXISTS` -- satu-satunya di `migrations/`.
2. **BOM.** `Set-Content -Encoding utf8` pada PowerShell 5.1 menulis BOM, dan
   MariaDB menolaknya dengan galat sintaks yang menunjuk baris 1. Diperbaiki lewat
   `[System.IO.File]::WriteAllText` dengan `UTF8Encoding($false)`.

#### Yang BELUM terbukti, dan sengaja dikatakan

Jalur TERJADWAL belum pernah menghasilkan satu baris `outbox` pun di produksi,
karena `farmasi.bulanan_enabled` masih MATI dan nol tujuan mencentang
`terima_bulanan` -- keduanya keputusan RS, bukan keputusan yang aman diambil
sepihak. Yang sudah terbukti adalah seluruh rantai di bawahnya: kesepuluh query,
penggabungan, perenderan, pagar privasi, dan matematika kejatuhtempoannya.

Jangan membalik klaim ini: nol baris di sini BUKAN bukti bahwa jalur terjadwalnya
tidak bekerja.

---

### Rekap BULANAN administrasi (`migrations/047`)

Judulnya sama persis dengan seksi di `CLAUDE.md`; ini buktinya.

#### Bentuk pemangkasnya

Prefiks `no_rawat` EKSAK terhadap `tgl_registrasi` — pengukuran yang sama sudah
dipakai migrations/044 dan tetap berlaku: 12.392 baris, cocok pada 12.392,
menyimpang **0**.

Rentang sebulan memakai bentuk prefiks pendek (`'2026/07/'` .. `'2026/08/'`),
dan itu diperiksa menghasilkan jumlah yang sama dengan bentuk penuh:

```
SELECT COUNT(*) FROM reg_periksa WHERE no_rawat>='2026/07/' AND no_rawat<'2026/08/';
+--------------------+
| dgn_prefiks_pendek |
|                668 |
+--------------------+
```

#### Kolom yang dipilih, dan kolom yang DITOLAK — keduanya diukur

`status_poli` versus `stts_daftar` (dipakai yang pertama):

```
+-------------+-------------+------+
| status_poli | stts_daftar |  n   |
+-------------+-------------+------+
| Lama        | Lama        | 7490 |
| Baru        | Baru        | 4817 |
| Baru        | Lama        |   59 |
| Lama        | Baru        |   26 |
+-------------+-------------+------+
```

85 baris dari 12.392 menyimpang. Yang dipakai `status_poli`, karena aturan
"pasien baru wajib punya asesmen awal" ditegakkan migrations/044 terhadap kolom
itu — memakai `stts_daftar` menghasilkan pembagi yang berbeda dari pembilangnya,
sehingga rekap dan halaman `/erm/penilaian-umum` menyebut dua angka berbeda untuk
satu pertanyaan pada hari yang sama.

`status_bayar` versus ketiadaan `nota_jalan` (dipakai yang pertama):

```
+-----------------------------+-----+
| belum bayar TAPI ada nota   |   1 |
| sudah bayar TAPI tanpa nota |   0 |
| belum bayar DAN tanpa nota  | 102 |
| total belum bayar           | 103 |
| total tanpa nota            | 102 |
+-----------------------------+-----+
```

Satu baris menyimpang dari 12.392 (0,008%). `status_bayar` dipilih karena ia
kolom pada tabel penggeraknya sendiri — nol join, terindeks, namanya menyebut
isinya.

#### Angka yang membenarkan fiturnya

```
+---------+-----------+--------+-------+------+-----------+--------+----------+-------+
| bln     | kunjungan | pasien | batal | baru | blm_bayar | soapie | diagnosa | resep |
+---------+-----------+--------+-------+------+-----------+--------+----------+-------+
| 2026/01 |       596 |    507 |     3 |  160 |         3 |    295 |        5 |   564 |
| 2026/02 |       471 |    393 |     8 |  116 |         8 |    268 |       25 |   441 |
| 2026/03 |       597 |    504 |     3 |  183 |         3 |    349 |       30 |   568 |
| 2026/04 |       631 |    549 |     4 |  170 |         4 |    269 |        3 |   593 |
| 2026/05 |       541 |    463 |     2 |  132 |         7 |    230 |       15 |   507 |
| 2026/06 |       644 |    539 |     6 |  188 |        15 |    232 |        7 |   589 |
| 2026/07 |       668 |    563 |     2 |  191 |        10 |    486 |        3 |   634 |
+---------+-----------+--------+-------+------+-----------+--------+----------+-------+
```

SOAPIE bergerak 49% → 73%; diagnosa tidak pernah melewati 6% dan pada Juli 0,4%.

Pasien berulang Juli 2026 — dihitung dari sebarannya, bukan diperkirakan:

```
kunjungan_per_pasien  jml_pasien
                   1         482
                   2          61
                   3          17
                   4           2
                   5           1
```

482·1 + 61·2 + 17·3 + 2·4 + 1·5 = 668 kunjungan; 563 pasien; **81 berulang,
menyumbang 186 kunjungan**.

#### Dua angka yang akan selalu nol — COUNT(*), bukan TABLE_ROWS

```
resume_pasien  resume_ranap  pemeriksaan_ralan  diagnosa_pasien  nota_jalan  suratsakit  reg_periksa
            0             0               5349             1344       12290          17        12392
```

Pelajaran migrations/030 dipatuhi: angkanya diambil dari `COUNT(*)`, bukan
`information_schema.TABLE_ROWS` yang membulat ke nol pada tabel kecil.

Surat kontrol di produksi: `skdp_bpjs` 1 baris, `bridging_surat_kontrol_bpjs` 0.
Query keduanya DIBUKTIKAN terhadap arsip `sik` yang berisi:

```
skdp_bpjs (arsip sik)          253 baris, 2023-02-28 .. 2024-02-29
bridging_surat_kontrol_bpjs  18843 baris, 2024-01-06 .. 2026-01-07

SELECT COUNT(*) FROM skdp_bpjs
  WHERE tanggal_rujukan >= '2024-01-01' AND tanggal_rujukan < '2024-02-01'   -> 176
SELECT COUNT(*) FROM bridging_surat_kontrol_bpjs
  WHERE tgl_surat >= '2025-10-01' AND tgl_surat < '2025-11-01'               -> 904
real 0m0.046s   (keduanya sekaligus)
```

Jadi yang belum terbukti bukan query-nya melainkan bahwa RS ini mencatat surat
kontrol. Jangan membalik klaim ini.

Surat sakit: 17 baris seluruhnya, prefiks `SKS20240805` .. `SKS20250218`, lalu
berhenti. Bulan prefiks nomor suratnya cocok dengan bulan kunjungannya pada
ketujuh belas baris — tapi yang dipakai sebagai pemangkas tetap `no_rawat`, karena
migrations/027 sudah mengukur bahwa tanggal di dalam `no_surat` berasal dari kotak
**Tanggal Awal** (mulai istirahat), bukan dari hari suratnya disimpan.

#### Rencana query — `npm run verify:plans`

```
[ok] ADM_BULANAN_KUNJUNGAN r range PRIMARY  rows~668
[ok] ADM_BULANAN_KUNJUNGAN p eq_ref PRIMARY  rows~1  (Using index)
[ok] ADM_BULANAN_KUNJUNGAN rs eq_ref PRIMARY  rows~1  (Using index)
[ok] ADM_BULANAN_KUNJUNGAN pr ref no_rawat  rows~1  (Using index)
[ok] ADM_BULANAN_KUNJUNGAN dp ref PRIMARY  rows~1  (Using index)
[ok] ADM_BULANAN_KUNJUNGAN ro ref no_rawat  rows~1  (Using index)
[ok] ADM_BULANAN_CARA_BAYAR r range idx_reg_periksa_rawat_rkm  rows~668  (Using index)
[ok] ADM_BULANAN_CARA_BAYAR pj eq_ref PRIMARY  rows~1
[ok] ADM_BULANAN_BERULANG <derived2> (hasil subquery, sudah tersaring)  rows~668
[ok] ADM_BULANAN_BERULANG r range idx_reg_periksa_rawat_rkm  rows~668  (Using index)
[ok] ADM_BULANAN_SURAT_SAKIT ss range no_rawat  rows~1  (Using index)
[--] ADM_BULANAN_KONTROL_SKDP s ALL — pemindaian penuh yang disengaja  rows~1
[--] ADM_BULANAN_KONTROL_BRIDGING b ALL — pemindaian penuh yang disengaja  rows~1

verify:plans lolos.
```

Query gabungannya terukur **62 ms** atas rentang 668 kunjungan. Kelima subquery
`EXISTS` masuk lewat indeks; tidak satu pun tabel dasar yang berangkat dari
`reg_periksa` butuh izin pindai penuh.

#### Pagar privasi — dibuktikan pada objek barisnya, dan MENGGIGIT

`npm run dryrun:adm-bulanan` terhadap produksi:

```
  kolom yang benar-benar terbaca: jml_kunjungan, jml_pasien, jml_batal, jml_baru,
  jml_belum_bayar, ada_resep, ada_diagnosa, ada_soapie, ada_resume,
  baru_tanpa_asesmen, kd_pj, png_jawab, jml_pasien_berulang,
  jml_kunjungan_berulang, jml
  [ok] PAGAR PRIVASI -- tidak satu pun kolom identitas, poli, atau isi rekam medis terbaca
```

Dirusak sengaja (`MAX(r.no_rawat) AS no_rawat` disisipkan ke daftar SELECT):

```
  [BOCOR] kolom terlarang terbaca: no_rawat -- lihat komentar pembuka khanza/administrasiBulanan.ts
EXIT SUNGGUHAN=1
=== dikembalikan ===
EXIT=0
```

Daftar terlarangnya sengaja mencakup keempat kolom klinis dari tabel yang
disentuh lewat `EXISTS` (`keluhan`, `penilaian`, `kd_penyakit`, `diagnosa_utama`,
dan seterusnya) — bukan karena kolomnya mungkin muncul hari ini, melainkan karena
kehadirannya berarti seseorang mengubah `EXISTS` jadi JOIN.

#### Invarian penjumlahan — janji yang dibaca orang dari pesannya

```
  [ok] baru + lama = kunjungan
  [ok] ada resep + tanpa resep = kunjungan
  [ok] asesmen terisi + belum = pasien baru
  [ok] jumlah pecahan cara bayar = jumlah kunjungan
```

Keempatnya MENGGAGALKAN skripnya (exit 1) bila salah, bukan sekadar dicetak.
Yang keempat menjaga `LEFT JOIN` pada `penjab`: dengan INNER, penjamin yang
masternya terhapus hilang dari layar dan pecahannya berhenti berjumlah tanpa satu
pun keterangan.

#### Pagar sanitasi dan multiline — keduanya MENGGIGIT

`rincian_cara_bayar` adalah satu-satunya variabel berbaris banyak di rekap ini
yang membawa nilai dari `sik` (`penjab.png_jawab`), jadi kewajiban menyanitasi
berlaku penuh — berbeda dari `rincian_barang`/`rincian_mutu` milik 046, yang aman
tanpa sanitasi karena tidak satu pun nilai `sik` masuk ke dalamnya.

Dilepas dari `MULTILINE_VARIABLES`:

```
× rincian_cara_bayar tetap DUA baris sesudah renderTemplate
Tests: 1 failed, 22 passed, 23 total
```

`sanitizeValue()` dilepas dari `gabungAdmBulanan()`:

```
× memangkas nama yang kelewat panjang
× nama penjamin berisi BARIS BARU tidak boleh menambah baris
× nama penjamin sudah bersih SEBELUM perakit teksnya dipanggil
Tests: 3 failed, 20 passed, 23 total
```

Keduanya kembali `23 passed` sesudah dipulihkan. Sanitasinya sengaja dikerjakan
di `gabungAdmBulanan()` dan bukan di perakit teksnya, supaya nilainya sudah bersih
juga di tabel pratinjau dashboard yang tidak melewati perakit itu sama sekali —
itu yang dipatok uji ketiga.

**Satu asersi saya sendiri yang keliru, dicatat karena pelajarannya berulang:**
percobaan pertama menuntut teks sisipan HILANG (`not.toContain('999')`).
`sanitizeValue()` melipat baris baru jadi SPASI, jadi teksnya memang tetap
terbaca — di dalam baris yang sama, sebagai bagian dari nama yang jelas rusak.
Yang dijaga adalah JUMLAH BARISNYA, bukan sensor isi; menuntut teksnya hilang
berarti menuntut sesuatu yang bukan tugas `sanitizeValue` dan tidak pernah bisa
lengkap. Asersinya diperbaiki jadi `not.toMatch(/\n\s*•/)`.

#### Grant per-tabel — kesembilan kalinya terbukti tidak diwarisi

```
SEBELUM grant:
  SELECT: 1                                  (lolos)
  UPDATE: ERROR 1142 (42000) ... denied to user 'wakhanza_rw'@'localhost'
                                  for table 'administrasi_target'
  DELETE: ERROR 1142 (42000) ... denied to user 'wakhanza_rw'@'localhost'
                                  for table 'administrasi_target'

GRANT UPDATE, DELETE ON wakhanza.administrasi_target TO 'wakhanza_rw'@'localhost';

SESUDAH grant:
  label      -> UJI GRANT 2     (UPDATE berhasil)
  sisa_baris -> 0               (DELETE berhasil, baris uji dibersihkan)
```

#### Kelima gerbang

```
tsc --noEmit            0 galat
eslint .                0 galat
jest                    56 suite, 1002 uji lolos
verify:db               sik tulis DITOLAK; audit_log DELETE/UPDATE DITOLAK
verify:plans            lolos (13 baris EXPLAIN untuk enam query baru)
next build              lolos
```

#### Pemasangan

`npm run migrate` menerapkan `047_administrasi_bulanan.sql` (1 migrasi).
`pm2 restart wakhanza-web` dijalankan dan sehat (`✓ Ready in 171ms`);
`GET /administrasi?tab=bulanan` menjawab **307** ke `/login` — gerbang admin
bekerja, dan halaman yang rusak akan menjawab 500. Penanda fiturnya ada di build:

```
grep -rl "Rekap bulanan administrasi" .next/server
  .next/server/chunks/ssr/src_app_(dashboard)_administrasi_*.js
```

`wakhanza-worker` dimulai ulang lewat prosedur tiga langkah yang terdokumentasi
(stop -> pastikan Chromium pemegang sesi bersih -> start), dari PowerShell:

```
Chromium pemegang sesi tersisa: 0
wakhanza-worker  fork  pid 3936  online  0 restart
wa_session: status=ready, umur denyut 20 dtk
```

Restart ini dikerjakan SEKARANG dan bukan ditunda, dengan alasan yang sudah
dibayar di migrations/038: selama sakelarnya mati perilaku kode lama dan baru
identik, tapi begitu staf menyalakannya pada worker yang belum dimulai ulang,
sakelarnya menyala di dasbor sementara worker tidak pernah mengerjakan apa pun --
gagal DIAM, tanpa satu pun galat.

**Siklus `administrasi-bulanan` sendiri belum menuliskan satu baris log pun, dan
itu SESUAI RANCANGAN**: `runAdministrasiBulananIfDue()` membaca sakelarnya di
baris pertama lalu kembali tanpa menyentuh apa pun selama ia mati. Jadi diamnya
log bukan bukti bahwa siklusnya tidak terpasang -- yang membuktikan pemasangannya
adalah `tsc`, `next build`, dan worker yang menyala bersih dengan pid baru
memakai build yang memuatnya.

**Pesan sungguhnya, dirender dari data produksi Juli 2026** (nama RS disamarkan
di catatan ini; keluaran aslinya memuat identitas RS apa adanya):

```
*Rekap Administrasi Bulanan*
<nama RS>

Periode : Juli 2026

*Kunjungan*
Total kunjungan : 668
Pasien berbeda : 563

• Pasien baru : 191 kunjungan (28,6%)
• Pasien lama : 477 kunjungan (71,4%)
• Datang lebih dari sekali bulan ini : 81 pasien (14,4%), 186 kunjungan
• Batal periksa : 2 (0,3%)

*Cara bayar*
• UMUM : 473 kunjungan (70,8%), 411 pasien
• BPJS Kesehatan : 195 kunjungan (29,2%), 156 pasien

*Kelengkapan berkas terisi*
• Resep : 634 (94,9%)
• SOAPIE : 486 (72,8%)
• Diagnosa : 3 (0,4%)
• Resume : 0 (0%)
• Asesmen awal : 94 dari 191 pasien baru (49,2%)

*Perlu ditindaklanjuti*
Asesmen awal belum diisi : 97
Kunjungan tanpa resep : 34
Belum closing billing : 10

*Surat*
Surat sakit : 0
Surat kontrol : 0
```

**Yang BELUM terbukti**: jalur terjadwalnya belum pernah benar-benar berbunyi ke
sebuah grup, karena `administrasi.bulanan_enabled` masih MATI dan belum ada satu
pun baris `administrasi_target`. Yang sudah terbukti adalah seluruh rantai di
bawahnya: keenam query, penggabungan, perenderan, pagar privasi, keempat invarian
penjumlahan, dan matematika kejatuhtempoannya — yang terakhir dipakai BERSAMA
dengan rekap bulanan farmasi yang sudah berjalan, jadi ia bukan kode yang belum
pernah dijalankan.

Jangan membalik klaim ini: nol baris di sini BUKAN bukti bahwa jalur terjadwalnya
tidak bekerja.

---

### Penyaring cara bayar untuk lampiran hasil & tagihan (`migrations/048`)

Judulnya sama persis dengan seksi di `CLAUDE.md`; ini buktinya.

#### Angka yang melahirkan fiturnya

Terukur atas 90 hari di database produksi:

```
NOTA (nota_jalan)          UMUM 1.324 · BPJS Kesehatan 574 · tanpa penjamin 2
LAB  (periksa_lab)         BPJS Kesehatan 11 · UMUM 0
RAD  (periksa_radiologi)   tabelnya memang kosong
```

Itu yang membuat penyaringnya **per jenis** dan bukan satu untuk seluruh tab:
rincian tagihan tidak menjawab apa pun bagi pasien yang tagihannya ditanggung
penjamin (30% dari seluruh nota), sementara hasil laboratorium sama pentingnya
bagi siapa pun. Satu penyaring untuk ketiganya memaksa dua pertanyaan berbeda
dijawab dengan satu jawaban.

Katalog `penjab`:

```
25 baris, 2 aktif
  A01 UMUM             status 1
  A02 BPJS Kesehatan   status 1
  A04..B00             status 0   -- belasan baris "Asuransi ..."
  -   -                status 0   -- penanda "tidak diisi" milik Khanza
```

Daftar pilihannya menampilkan SELURUHNYA kecuali `'-'` (`fetchPaymentOptions()`
sudah membuangnya sejak dulu). Menyaring ke yang aktif saja akan menyembunyikan
belasan baris asuransi, dan penyaring ini dicocokkan terhadap kunjungan yang
SUDAH terjadi -- asuransi yang dinonaktifkan bulan lalu tetap penjamin kunjungan
bulan lalu.

#### Bentuknya: penyaring LAMPIRAN, bukan penyaring pemicu

Yang tersaring tetap menerima pemberitahuannya, cuma tanpa berkas. Karena itu ia
duduk di `lolosSaring` pada `runSisipCycle`, bukan di query poller -- menyaring di
SQL akan membuat pasiennya berhenti diberi tahu sama sekali.

`lolosSaring` sengaja TERPISAH dari `buat()` yang juga bisa mengembalikan null,
dan log siklusnya menyebut `lampiranDisaringCaraBayar` tersendiri: keduanya
menghasilkan pesan tanpa lampiran, tapi yang satu KEPUTUSAN rumah sakit dan yang
satu KEGAGALAN.

Urutannya **penyaring dulu, kuota sesudahnya**. Baris yang tersaring tidak
meluncurkan Chromium, jadi ia tidak boleh memakan jatah yang ada justru untuk
membatasi peluncuran itu -- terbalik, satu jam sibuk penuh pasien BPJS cukup untuk
menahan lampiran pasien umum di belakangnya tanpa sebab yang terlihat.

#### `kd_pj` TETAP tidak masuk baris pemicu

Penyaringnya berkunci pada KODE, bukan nama: `penjab.png_jawab` bisa disunting
staf, dan penyaring yang berkunci padanya berhenti cocok DIAM-DIAM pada hari
seseorang mengganti "BPJS Kesehatan" jadi "BPJS".

Tapi menambahkan `kd_pj` ke baris pemicu akan membatalkan jaminan yang berlaku
sejak `{cara_bayar}` ada. Jalan keluarnya query kecil tersendiri di jalur
lampiran, dan rencananya terukur lebih baik daripada yang ditargetkan:

```
[ok] DOKUMEN_KD_PJ        r const PRIMARY  rows~1
```

`const`, bukan sekadar `eq_ref`. Dan ia **hanya dijalankan bila daftarnya
terisi** -- pada setelan bawaan (`[]`) nol query tambahan, sehingga migrasinya
benar-benar nol-perubahan.

#### Keputusan murninya, dan ketiga kasus pinggirnya

`lolosSaringPenjamin()` tinggal di `core/penjamin.ts` -- modul yang memang sudah
memegang penurunan penjamin, bukan modul baru. Tujuh uji ditambahkan (total suite
1.002 -> 1.009), dan yang dijaga bukan pencocokannya melainkan ketiga kasus
pinggirnya, yang bisa salah ke arah yang BERBEDA:

```
daftar kosong      salah -> lampiran yang sedang berjalan mati serentak
kode tak dikenal   salah -> daftar-izin yang meloloskan yang tidak diizinkan
penanda '-'        salah -> perilakunya berbeda dari namaPenjamin() tanpa sebab
```

Keduanya dibuktikan MENGGIGIT:

```
=== (1) daftar kosong dibalik jadi 'tidak ada yang lolos' ===
× daftar KOSONG meloloskan semuanya -- itu yang membuat migrasinya nol-perubahan
× penanda '-' tidak pernah lolos saat penyaringnya dipasang
Tests: 2 failed, 13 passed, 15 total

=== (2) kode tak dikenal dibalik jadi 'lolos' ===
× kode yang TIDAK diketahui ditolak, bukan diloloskan
Tests: 1 failed, 14 passed, 15 total

=== dikembalikan ===
Tests: 15 passed, 15 total
```

Satu uji khusus menjaga pencocokannya PERSIS dan bukan sebagian: kode di katalog
ini berbagi awalan (`A01`, `A02`, `A04`, ... `A58`), jadi pencocokan sebagian akan
meloloskan penjamin yang sama sekali lain.

#### Jalur lengkapnya, diuji terhadap data produksi

Query + keputusan dijalankan atas kunjungan sungguhan Juli 2026 (`no_rawat`
disamarkan; tidak menulis dan tidak mengirim apa pun):

```
setelan tersimpan sekarang:
  lab        -> [] (semua penjamin)
  radiologi  -> [] (semua penjamin)
  nota       -> [] (semua penjamin)

kunjungan contoh + keputusan penyaring:
  2026/07/…001  kd_pj=A01  terbaca=A01   []=true  [A01]=true   [A01,A02]=true
  2026/07/…008  kd_pj=A02  terbaca=A02   []=true  [A01]=false  [A01,A02]=true

  kunjungan yang TIDAK ADA -> [A01]=false  (daftar-izin gagal TERTUTUP)
  kunjungan yang TIDAK ADA -> []=true      (nol query, nol perubahan)
```

Baris terakhir yang paling penting: daftar-izin yang gagal ke arah "izinkan"
bukan daftar-izin. Kunjungan yang barisnya tidak ditemukan ditolak -- dan itu
konsisten dengan jalur lampirannya, yang beberapa langkah kemudian juga gagal
karena `ambilIdentitasKunjungan()` mengembalikan null untuk kunjungan yang sama.

#### Aksi simpan menolak kode asing, bukan menyaringnya diam-diam

Daftar-izin yang memuat kode yang tidak pernah cocok adalah daftar yang kelihatan
terisi sementara pasiennya tidak pernah menerima apa pun -- kegagalan senyap yang
persis sama jenisnya dengan menyaring lewat NAMA penjamin. Kodenya divalidasi
terhadap katalog `penjab` yang sungguhan, lalu diurutkan sebelum disimpan supaya
nilai tersimpannya tidak berubah hanya karena urutan centang berbeda.

Mengosongkan pilihan adalah tindakan yang SAH dan bukan galat: ia berarti
"kembalikan ke semua penjamin", bukan "jangan kirim ke siapa pun".

#### Kelima gerbang

```
tsc --noEmit            0 galat
eslint .                0 galat
jest                    56 suite, 1009 uji lolos (dari 1002)
verify:db               sik tulis DITOLAK; audit_log DELETE/UPDATE DITOLAK
verify:plans            lolos; DOKUMEN_KD_PJ const PRIMARY rows~1
next build              lolos (Compiled successfully in 7,4s)
```

#### Pemasangan

`npm run migrate` menerapkan `048_dokumen_cara_bayar.sql` (1 migrasi); ketiga
kunci tersimpan `[]`. `pm2 restart wakhanza-web` dijalankan dan sehat;
`GET /administrasi?tab=hasil` menjawab **307** ke `/login` (gerbang admin bekerja;
halaman yang rusak akan menjawab 500). Penanda fiturnya ada di build:

```
grep -rlE "Penyaring cara bayar" .next/server/chunks
  .next/server/chunks/ssr/src_app_(dashboard)_administrasi_*.js
```

**`wakhanza-worker` SENGAJA belum dimulai ulang.** Ketiga sakelar
`dokumen.*_enabled` terukur masih `0` dan ketiga penyaringnya `[]`, jadi perilaku
kode lama dan baru identik -- tidak ada yang perlu dikejar hari ini. Ditambah,
restart terakhirnya baru ~40 menit sebelumnya (untuk migrations/047), dan dua
restart berdekatan adalah persis yang pernah menjatuhkan worker ke crash loop 29
kali.

**Tapi sebelum sakelar dokumen pertama dinyalakan, worker HARUS dimulai ulang** --
kalau tidak, penyaringnya tersimpan di dasbor sementara worker tidak pernah
membacanya, dan lampiran tetap berangkat ke seluruh penjamin. Gagal DIAM, tanpa
satu pun galat. Pelajaran yang sama sudah ditulis untuk migrations/038.

**Yang BELUM terbukti**: penyaringnya belum pernah benar-benar menahan sebuah
lampiran di produksi, karena ketiga sakelar dokumennya masih mati. Yang sudah
terbukti adalah seluruh rantai di bawahnya: query `kd_pj`, keputusan murninya
berikut ketiga kasus pinggirnya, jalur `lolosCaraBayarDokumen()` terhadap
kunjungan sungguhan, dan rencana query-nya.

---

### Pecahan cara bayar pada rekap resep (`migrations/049`)

Judulnya sama persis dengan seksi di `CLAUDE.md`; ini buktinya.

#### Angka yang melahirkan fiturnya

Juli 2026, database produksi:

```
UMUM             500 resep   Rp15.357.316   <- kas
BPJS Kesehatan   185 resep    Rp2.181.685   <- piutang
------------------------------------------
total            685 resep   Rp17.539.001
```

12,4% dari angka yang selama ini dibaca sebagai satu kesatuan ternyata belum jadi
uang. Totalnya cocok dengan `nilaiObat` yang sudah dipatok di
`farmasiBulanan.test.ts` (17.539.001) dan dengan `COUNT(*)` `resep_obat` Juli
(685) — jadi pecahannya benar-benar membagi habis, bukan mendekati.

#### Tidak ada jalan lain menuju `kd_pj`

```
SHOW COLUMNS FROM detail_pemberian_obat;
  tgl_perawatan jam no_rawat kode_brng h_beli biaya_obat jml
  embalase tuslah total status kd_bangsal no_batch no_faktur
```

Nol kolom penjamin. `kd_pj` hanya hidup di `reg_periksa`, jadi pilihannya bukan
"cara lain yang lebih aman" melainkan antara menyediakan pecahan ini atau tidak
sama sekali.

#### Invarian 042 yang dilonggarkan, dan apa yang menggantikannya

`khanza/farmasiStaf.ts` menyatakan di atas query headernya bahwa `reg_periksa` dan
`pasien` TIDAK di-JOIN sama sekali. Query cara bayar MENYEBUT `reg_periksa`.
Pagarnya berpindah dari "tabelnya tidak disebut" ke bentuk kode:

1. Query TERSENDIRI, bukan join tambahan pada agregat yang sudah ada.
2. `pasien` tetap tidak disebut; `no_rkm_medis` tidak diambil.
3. Yang meninggalkan SQL cuma `kd_pj`, `png_jawab`, dan dua angka.

Ketiga klaim yang kini keliru sudah diperbaiki di tempatnya, bukan dibiarkan:
bullet 042 di `CLAUDE.md`, butir kebijakannya, dan `ARCHITECTURE.md` §5.2.
Dokumen yang menuliskan aturan MUTLAK sementara kodenya sudah punya kekecualian
adalah bentuk dokumen basi yang paling berbahaya — pembacanya menyimpulkan sistem
ini tidak bisa melakukan sesuatu yang sebenarnya bisa.

#### Rencana query

```
[ok] FARMASI_RESEP_REKAP_CARA_BAYAR ro range PRIMARY  rows~50
[ok] FARMASI_RESEP_REKAP_CARA_BAYAR r eq_ref PRIMARY  rows~1
[ok] FARMASI_RESEP_REKAP_CARA_BAYAR pj eq_ref PRIMARY  rows~1
[ok] FARMASI_RESEP_REKAP_CARA_BAYAR dpo ref PRIMARY  rows~2

verify:plans lolos.
```

Tanpa izin pindai penuh. `ro` masuk lewat prefiks `no_resep` (PRIMARY),
`reg_periksa` lewat `no_rawat` (PRIMARY), dan `detail_pemberian_obat` lewat tiga
kolom terdepan PRIMARY KEY-nya.

#### Dua jebakan SQL, keduanya dibuktikan

**(1) `COUNT(*)` salah 4,5 kali.** `detail_pemberian_obat` berisi satu baris per
BARANG, jadi join ke sana menggandakan baris resepnya:

```
png_jawab        COUNT(*)   COUNT(DISTINCT no_resep)
BPJS Kesehatan        605                        185
UMUM                 2503                        500
                    -----                      -----
                     3108                        685   <- resep sungguhan: 685
```

3.108 tetap terlihat wajar di dalam sebuah pesan. Dibuktikan MENGGIGIT dengan
mengganti `COUNT(DISTINCT)` jadi `COUNT(*)` di query produksinya:

```
[SALAH] 40 != jumlah per cara bayar 181
EXIT=1
```

**(2) LEFT JOIN, bukan INNER.** Satu query menghasilkan dua angka dengan pembagi
yang berbeda — jumlah resep harus berjumlah dengan `{jumlah_resep}` (SELURUH
resep), rupiahnya dengan `{nilai_obat}` (yang tertagih saja). INNER membuat
pecahan resepnya hanya menghitung yang sudah divalidasi.

#### Empat invarian penjumlahan, dijaga skripnya

`npm run dryrun:resep -- alca 2026-07-31`:

```
kolom yang benar-benar terbaca: kd_dokter, nm_dokter, jml_resep, jml_serah,
  jml_baris, jml_obat, nilai_obat, kd_pj, png_jawab
[ok] PAGAR PRIVASI -- tidak satu pun kolom pasien, obat, atau dosis terbaca

[ok] total rupiah = jumlah rupiah seluruh dokter
[ok] jumlah resep = jumlah resep seluruh cara bayar
[ok] total rupiah = jumlah rupiah seluruh cara bayar
[ok] diserahkan + belum = jumlah resep
```

Dua yang di tengah baru; keempatnya menggagalkan skripnya (exit 1) bila salah.
Perhatikan daftar kolomnya: yang bertambah HANYA `kd_pj` dan `png_jawab`.

#### Pesannya, dirender dari data produksi

```
*Nilai obat : Rp893.717*

*Rincian per cara bayar:*
• UMUM : 31 resep, Rp815.981
• BPJS Kesehatan : 9 resep, Rp77.736

*Rincian per dokter:*
• dr. Intan Rahma Dewi : 40 resep, 184 baris obat, Rp893.717
```

31 + 9 = 40 resep; Rp815.981 + Rp77.736 = Rp893.717. Ditaruh SEBELUM rincian per
dokter karena ia yang menerangkan angka tepat di atasnya: berapa dari jumlah itu
yang sudah jadi kas.

#### Pagar sanitasi — MENGGIGIT

`rincian_cara_bayar` sudah ada di `MULTILINE_VARIABLES` sejak migrations/047, dan
pengecualian itu berlaku untuk NAMA variabelnya — jadi perakit BARU yang memakai
nama yang sama mewarisinya tanpa satu baris pun perubahan di sana. Tidak ada satu
pun galat yang muncul bila perakitnya lupa menyanitasi; patokan ini yang
menggantikan galat itu.

`sanitizeValue()` dilepas dari pemetaan penjamin:

```
× nama penjamin berisi BARIS BARU tidak boleh menambah baris
Tests: 1 failed, 33 passed, 34 total
```

Kembali `34 passed` sesudah dipulihkan. 11 uji ditambahkan (suite 1.009 -> 1.020).

#### Kelima gerbang

```
tsc --noEmit            0 galat
eslint .                0 galat
jest                    56 suite, 1020 uji lolos (dari 1009)
verify:db               sik tulis DITOLAK; audit_log DELETE/UPDATE DITOLAK
verify:plans            lolos; empat baris EXPLAIN untuk query baru
next build              lolos (Compiled successfully in 7,2s)
```

#### Pemasangan — dan di sini restartnya WAJIB, bukan opsional

`npm run migrate` menerapkan `049_resep_rekap_cara_bayar.sql`. Template tersimpan
diperiksa sesudahnya dan benar memuat kedua baris barunya.

Migrasinya memakai jangkar TANPA baris baru (`*Nilai obat : {nilai_obat}*`)
berikut `IF(v LIKE '%\r\n%', ...)`. Diperiksa langsung sebelum berkas itu ditulis:

```
k                             pakai_crlf  sudah_ada
farmasi.template_resep_rekap           1          0
```

Template tersimpan memakai **CRLF** — karena staf menyimpannya lewat form dan
`<textarea>` mengirimkan CRLF sesuai spesifikasi HTML. `REPLACE()` yang
menambatkan diri pada teks ber-`\n` tidak akan cocok sama sekali, tanpa galat,
sementara migrasinya tetap tercatat "berhasil" (pelajaran migrations/043).

**Berbeda dari 048, di sini worker WAJIB dimulai ulang dan itu mendesak:**

```
farmasi.resep_rekap_enabled   1
farmasi.resep_rekap_jam       20:00
farmasi.resep_rekap_last_run  2026-08-14
```

Fiturnya SEDANG BERJALAN dan berbunyi hari itu juga pukul 20:00. Tanpa restart,
`{rincian_cara_bayar}` dirender kode lama yang tidak mengenalnya lalu menghasilkan
`*Rincian per cara bayar:*` yang menggantung — bentuk kegagalan yang sama persis
dengan label total hibah tanpa angka (031) dan `*Nilai obat : *` (043).

Dikerjakan lewat prosedur tiga langkah, dan sengaja DIKUMPULKAN dengan 048
supaya cukup sekali restart (aturan "jangan menyalakan ulang worker dua kali
berdekatan"):

```
Chromium pemegang sesi tersisa: 0
wakhanza-worker  fork  pid 9420  online  0 restart
wa_session: status=ready, umur denyut 23 dtk
```

**Yang BELUM terbukti**: pecahannya belum pernah ikut dalam rekap terjadwal yang
sungguhan — kiriman pertamanya jatuh pukul 20:00 pada hari migrasinya diterapkan.
Yang sudah terbukti adalah seluruh rantai di bawahnya: query-nya terhadap data
produksi, keempat invarian penjumlahannya, perenderan pesannya, pagar privasinya,
dan pagar sanitasinya.

## Rincian per tindakan, dan pengecualian yang MELIPAT (`migrations/050`)

Judulnya sama persis dengan seksi di `CLAUDE.md`.

### Tabel tindakan: yang ADA dan yang DIPAKAI

Diperiksa lewat `information_schema.TABLES` + `COUNT(*)` sungguhan — bukan
`TABLE_ROWS`, yang perkiraan pada InnoDB dan membulat ke nol pada tabel kecil
(pelajaran 030):

```
rawat_jl_dr              12215 baris
rawat_jl_pr                  0 baris
rawat_jl_drpr                3 baris
rawat_inap_dr                0 baris
rawat_inap_pr                0 baris
rawat_inap_drpr              0 baris
jns_perawatan             1312 baris
```

PK keenamnya, terbaca dari `information_schema.STATISTICS`:

```
rawat_jl_dr        (no_rawat, kd_jenis_prw, kd_dokter, tgl_perawatan, jam_rawat)
rawat_jl_pr        (no_rawat, kd_jenis_prw, nip, tgl_perawatan, jam_rawat)
rawat_jl_drpr      (no_rawat, kd_jenis_prw, kd_dokter, nip, tgl_perawatan, jam_rawat)
rawat_inap_dr      (no_rawat, kd_jenis_prw, kd_dokter, tgl_perawatan, jam_rawat)
rawat_inap_pr      (no_rawat, kd_jenis_prw, nip, tgl_perawatan, jam_rawat)
rawat_inap_drpr    (no_rawat, kd_jenis_prw, kd_dokter, nip, tgl_perawatan, jam_rawat)
```

`no_rawat` memimpin keenamnya — itulah yang membuat prefiks bulanan memangkas
lewat indeks tanpa izin pindai penuh, dan yang membuat kelima tabel kosong akan
beralih sendiri ke `range` begitu terisi.

`kd_jenis_prw` yang tidak ada di katalog: **0 kode** sepanjang seluruh riwayat.
`LEFT JOIN` tetap dipakai justru karena nol itu murah dijaga.

### Sebaran per bulan, dan sebaran Juli 2026 seutuhnya

```
202601  baris   541  jenis   14  kunjungan   363
202602  baris   437  jenis   14  kunjungan   309
202603  baris   592  jenis   16  kunjungan   410
202604  baris   615  jenis   16  kunjungan   424
202605  baris   556  jenis   20  kunjungan   363
202606  baris   648  jenis   16  kunjungan   443
202607  baris   649  jenis   15  kunjungan   470
```

Juli 2026, seluruh 15 jenis:

```
   473 ( 72.9%)  RJ24578 | konsultasi dokter umum
    65 ( 10.0%)  RJ24571 | Injeksi Obat
    30 (  4.6%)  RJ24581 | puyer
    17 (  2.6%)  RJ24575 | Gula Darah
    16 (  2.5%)  RJ24579 | nebulisasi
    13 (  2.0%)  RJ24576 | Asam Urat
     9 (  1.4%)  RJ24577 | Kolesterol
     9 (  1.4%)  RJ24568 | Woud toilet ringan
     6 (  0.9%)  RJ24567 | Pemasangan Infus
     4 (  0.6%)  RJ24588 | kunjungan rumah perawat
     2 (  0.3%)  RJ24574 | Hecting
     2 (  0.3%)  RJ24586 | operasi kecil
     1 (  0.2%)  RJ24573 | Kunjungan Rumah
     1 (  0.2%)  RJ24572 | Ekstraksi Benda Asing
     1 (  0.2%)  RJ24570 | Wound Toilet Besar
```

Ekor: **6 dari 15 jenis ≤5 kali**, menyumbang 11 baris. Kedua angka inilah yang
menjadi kedua alasan pengecualian ada — kebisingan (72,9%) dan privasi (ekor).

Kunjungan yang punya tindakan, terhadap total kunjungan bulan itu:

```
202601  363 dari 596 kunjungan punya tindakan (60.9%)
202604  424 dari 631 kunjungan punya tindakan (67.2%)
202607  470 dari 668 kunjungan punya tindakan (70.4%)
```

### Rencana query — nol izin pindai penuh baru

`npm run verify:plans`, exit **0**:

```
[ok] ADM_BULANAN_KUNJUNGAN r range PRIMARY  rows~668
[ok] ADM_BULANAN_KUNJUNGAN tk5 ref PRIMARY  rows~1  (Using index)
[ok] ADM_BULANAN_KUNJUNGAN tk4 ref no_rawat  rows~1  (Using index)
[ok] ADM_BULANAN_KUNJUNGAN tk3 ref no_rawat  rows~1  (Using index)
[ok] ADM_BULANAN_KUNJUNGAN tk2 ref no_rawat  rows~1  (Using index)
[ok] ADM_BULANAN_KUNJUNGAN tk1 ref no_rawat  rows~1  (Using index)
[ok] ADM_BULANAN_KUNJUNGAN tk0 ref no_rawat  rows~1  (Using index)
[ok] ADM_BULANAN_TINDAKAN <derived2> (hasil subquery, sudah tersaring)  rows~654
[ok] ADM_BULANAN_TINDAKAN j eq_ref PRIMARY  rows~1
[ok] ADM_BULANAN_TINDAKAN rawat_jl_dr range no_rawat  rows~649  (Using index)
[ok] ADM_BULANAN_TINDAKAN rawat_jl_pr index biaya_rawat  rows~1  (Using index)
[ok] ADM_BULANAN_TINDAKAN rawat_jl_drpr index rawat_jl_drpr_ibfk_2  rows~3  (Using index)
[ok] ADM_BULANAN_TINDAKAN rawat_inap_dr index tgl_perawatan  rows~1  (Using index)
[ok] ADM_BULANAN_TINDAKAN rawat_inap_pr index biaya_rawat  rows~1  (Using index)
[ok] ADM_BULANAN_TINDAKAN rawat_inap_drpr index rawat_inap_drpr_ibfk_2  rows~1  (Using index)
[ok] ADM_BULANAN_NAMA_TINDAKAN j range PRIMARY  rows~2
```

Keenam `EXISTS` yang ditambahkan ke query kunjungan seluruhnya `ref` +
`Using index`; tidak satu pun `ALL`, jadi `allowFullScan` TIDAK ditambahkan untuk
satu tabel pun. Waktu jalan query rincian, tiga kali berturut-turut pada kondisi
hangat: **3 ms, 2 ms, 2 ms**.

### Migrasi: CRLF diperiksa SEBELUM dijalankan, dan sisipannya dibuktikan

Template tersimpan sebelum migrasi:

```
panjang           : 560
punya CRLF        : true
punya jangkar     : true
sudah ada tindakan: false
```

CRLF terkonfirmasi — persis jebakan yang dibayar 043 dan 049. Sesudah
`npm run migrate` (`[migrate] selesai 050_administrasi_bulanan_tindakan.sql`):

```
panjang           : 719
punya CRLF        : true
punya jangkar     : true
sudah ada tindakan: true
```

Cuplikan hasilnya membuktikan baris baru yang disisipkan mengikuti gaya yang
sudah dipakai, bukan LF telanjang — CRLF di setiap sambungan:

```
..."*Cara bayar*\r\n{rincian_cara_bayar}\r\n\r\n*Tindakan*\r\nTotal tindakan :
{jumlah_tindakan} dari {jumlah_jenis_tindakan} jenis\r\nKunjungan tanpa tindakan :
{jumlah_tanpa_tindakan}\r\n\r\n{rincian_tindakan}\r\n\r\n*Kelengkapan berkas terisi*...
```

### Pesan yang benar-benar dirender, terhadap data produksi

`npm run dryrun:adm-bulanan`, exit **0**. Bagian tindakannya:

```
*Tindakan*
Total tindakan : 649 dari 15 jenis
Kunjungan tanpa tindakan : 198

• konsultasi dokter umum : 473 (72,9%)
• Injeksi Obat : 65 (10%)
• puyer : 30 (4,6%)
...
• Kunjungan Rumah : 1 (0,2%)

*Kelengkapan berkas terisi*
• Resep : 634 (94,9%)
• Tindakan : 470 (70,4%)
• SOAPIE : 486 (72,8%)
• Diagnosa : 3 (0,4%)
• Resume : 0 (0%)
• Asesmen awal : 94 dari 191 pasien baru (49,2%)
```

### Pagar privasi — diperiksa pada objek barisnya, dan dibuktikan MENGGIGIT

Kolom yang benar-benar terbaca dari ketujuh agregat:

```
jml_kunjungan, jml_pasien, jml_batal, jml_baru, jml_belum_bayar, ada_resep,
ada_diagnosa, ada_soapie, ada_resume, ada_tindakan, baru_tanpa_asesmen,
kd_pj, png_jawab, kd_jenis_prw, nm_perawatan, jml, jml_pasien_berulang,
jml_kunjungan_berulang

[ok] PAGAR PRIVASI -- tidak satu pun kolom identitas, poli, atau isi rekam medis terbaca
```

Dari keenam tabel tindakan yang menyeberang ke Node cuma `kd_jenis_prw`,
`nm_perawatan`, dan sebuah `COUNT`. `kd_dokter`, `nip`, dan `biaya_rawat`
ditambahkan ke daftar terlarang `dryrun:adm-bulanan`.

Dibuktikan menggigit dengan menambahkan `MAX(x.no_rawat) AS no_rawat` ke daftar
SELECT dengan sengaja:

```
[BOCOR] kolom terlarang terbaca: no_rawat -- lihat komentar pembuka khanza/administrasiBulanan.ts
exit code: 1
```

Dikembalikan sesudahnya.

### Invarian penjumlahan — tujuh, seluruhnya lolos

```
[ok] baru + lama = kunjungan
[ok] ada resep + tanpa resep = kunjungan
[ok] asesmen terisi + belum = pasien baru
[ok] ada tindakan + tanpa tindakan = kunjungan
[ok] tampil + dicentang + lewat batas = seluruh tindakan
[ok] jenis tampil + dicentang + lewat batas = seluruh jenis
[ok] jumlah pecahan cara bayar = jumlah kunjungan
```

Dua dari ketiga yang baru adalah yang menjaga janji "melipat, bukan membuang".
Dibuktikan MENGGIGIT dengan mengubah `jmlTindakan` supaya mengecualikan yang
dicentang:

```
Tests: 3 failed, 36 passed, 39 total
```

Dikembalikan sesudahnya.

### Pagar sanitasi `nm_perawatan` — dibuktikan MENGGIGIT

Dengan `sanitizeValue()` dilepas dari `bagiTindakan()`:

```
● pagar MULTILINE › nama tindakan berisi BARIS BARU tidak boleh menambah baris
● pagar MULTILINE › nama tindakan sudah bersih SEBELUM perakit teksnya dipanggil
Tests: 2 failed, 37 passed, 39 total
```

Dikembalikan sesudahnya. Uji keduanya berbentuk PERILAKU (jumlah baris sesudah
`renderTemplate`), bukan keanggotaan himpunan — kewajiban yang tertulis di
`MULTILINE_VARIABLES`.

### Gerbang

```
npm run typecheck     0 galat
npm run lint          0 galat
npm test              58 suite, 1052 uji lolos
npm run verify:db     lolos (sik tulis DITOLAK, audit_log DELETE/UPDATE DITOLAK)
npm run verify:plans  exit 0
npm run migrate       1 migrasi diterapkan
npm run build         lolos
```

### Pemasangan

`administrasi.bulanan_enabled` SUDAH bernilai `'1'` di mesin ini (tanggal kirim 5,
`administrasi.bulanan_last_run` = `202607`), jadi restart bukan opsional.

Sesi diperiksa SEHAT lebih dulu — `status: 'ready'`, `umur_denyut: 22` detik,
`last_error: null`, 176 baris `outbox` dua hari terakhir seluruhnya `sent`.
Dibaca lewat Sequelize, jadi `TIMESTAMPDIFF` MENTAH yang benar (zona sesinya
`+00:00`, `NOW()` ikut UTC).

Prosedur tiga langkah dari PowerShell:

```
pm2 stop wakhanza-worker
Chromium pemegang sesi tersisa: 0        <- shutdown IPC bersih, nol yatim
pm2 start wakhanza-worker
```

Log sesudahnya: satu pid (15204), `WhatsApp terautentikasi, menunggu ready` lalu
`WhatsApp siap` — nol pengulangan fase `menautkan`, nol kaskade restart. Sesi
diperiksa ulang: `ready`, denyut 22 detik.

`wakhanza-web` juga dimulai ulang sesudah `npm run build`. Buildnya terbukti
memuat perubahannya (`grep -rl "Tindakan yang dilipat" .next/server` menemukan
chunk `administrasi`), dan instance PM2 melayani: `/login` → 200,
`/administrasi?tab=bulanan` → 307 (dialihkan ke login, gerbang `proxy.ts` benar).

### Yang BELUM terbukti

Rekapnya belum pernah berangkat terjadwal dengan bagian tindakan di dalamnya —
`bulanJatuhTempo()` mengembalikan null hari ini (penanda `202607` sudah sama
dengan bulan targetnya), jadi kiriman berikutnya **5 September 2026** berisi rekap
Agustus. Yang sudah terbukti seluruh rantai di bawahnya: query terhadap data
produksi, ketujuh invarian penjumlahannya, perenderan pesannya, pagar privasinya,
pagar sanitasinya, dan sisipan migrasinya.

Belum ada satu pun tindakan yang dicentang, jadi cabang "Dikecualikan" dan cabang
batas baris belum pernah dirender terhadap data produksi — keduanya terbukti lewat
uji unit atas data Juli 2026 yang sebenarnya, termasuk cabang batas baris yang
menuntut 45 jenis buatan karena produksi cuma punya 15.

## FORMULIR LEWAT WHATSAPP (`migrations/051`)

Seluruh bukti di bawah diambil 16 Agustus 2026 terhadap database `wakhanza`
produksi di mesin ini.

### Migrasi dan grant

```
[migrate] jalankan 051_formulir.sql ...
[migrate] selesai  051_formulir.sql
[migrate] 1 migrasi diterapkan
```

Kolom `jenis` terpasang dengan bawaan yang membuat seluruh baris lama benar tanpa
disentuh:

```
{"Field":"jenis","Type":"varchar(16)","Null":"NO","Key":"","Default":"perintah","Extra":""}
```

Grant per-tabel terbukti **TIDAK diwarisi** — untuk kesepuluh kalinya di proyek
ini. Diuji empiris sebagai `wakhanza_rw`, SEBELUM grant diterapkan:

```
wa_form:        SELECT ok · UPDATE ER_TABLEACCESS_DENIED_ERROR · DELETE ER_TABLEACCESS_DENIED_ERROR
wa_form_field:  SELECT ok · UPDATE ER_TABLEACCESS_DENIED_ERROR · DELETE ER_TABLEACCESS_DENIED_ERROR
wa_form_entry:  SELECT ok · UPDATE ER_TABLEACCESS_DENIED_ERROR · DELETE ER_TABLEACCESS_DENIED_ERROR
```

Sesudah `GRANT UPDATE, DELETE` lewat root, ketiganya `OK` untuk UPDATE maupun
DELETE. `verify:db` melaporkan `wakhanza : tersambung, 31 tabel`.

### Percakapan penuh lewat jalur produksi — 29 pemeriksaan, 0 gagal

Dijalankan lewat `cobaFormulirWa()` yang SAMA dipakai `wa-client.ts`, bukan lewat
fungsi murninya. Tujuannya JID grup yang **tidak ada**
(`120363000000000000@g.us`), jadi tidak ada manusia yang menerima apa pun; kata
kuncinya `ujiformulirlimasatu`, yang tidak mungkin terketik orang. Seluruh baris
dibersihkan dan `formulir.enabled` dikembalikan ke `'0'` di blok `finally`.

Yang terbukti, dikelompokkan:

**Gerbang dan pelepasan**
- sakelar mati → `ditangani: false, sebab: 'mati'`
- pesan yang tidak cocok dilepas ke penanganan biasa (`ditangani: false`)

**Percakapan**
- `/ujiformulirlimasatu` memicu formulir — bentuk bergaris miring lewat kode yang sama
- sesi tersimpan dengan `jenis = 'formulir'`
- penyerahan ulang `waMessageId` yang sama → `sebab: 'diserahkan_ulang'`, langkah tidak maju
- jawaban `"dua strip"` untuk pertanyaan bertipe angka ditolak, dan **`indeks` tetap 1** — jawaban salah tidak memajukan keadaan
- `batal` mengakhiri pengisian, dan **tidak menyimpan apa pun** (jumlah entry tetap 1, bukan 2)
- sesi dibuang sesudah selesai maupun sesudah batal

**Pembekuan — dibuktikan melawan DATABASE, bukan hanya uji unit**
- pertanyaan ke-4 DIHAPUS dari `wa_form_field` di tengah percakapan, lalu percakapannya tetap menanyakannya dan menyelesaikannya (`sebab: 'tersimpan'`)
- `jawaban_json` memuat empat pasangan, dan pasangan keempat masih membawa pertanyaannya (`"Catatan tambahan"`) walau barisnya sudah tidak ada
- `form_nama` dibekukan

**Bentuk nilai yang tersimpan**
- teks apa adanya (`"Paracetamol 500mg"`)
- angka apa adanya (`"30"`) — tidak dinormalkan
- pilihan tersimpan sebagai **ISI** (`"BPJS"`), bukan nomor yang diketik (`"2"`)
- pertanyaan tak wajib yang dilewati tersimpan sebagai string kosong
- `status` awal `baru`; `phone_e164` NULL untuk grup

**Pipeline**
- 5 baris `outbox` ber-`trigger_code = 'FORMULIR'`, seluruhnya ber-`chat_id` grup dan `phone_e164` NULL
- setiap pesan membawa baris `Kode Pengiriman` — melewati `enqueueMessage()` yang sama, bukan `message.reply()`
- pesan penutup mengulang isian yang tercatat (`Paracetamol 500mg`, `BPJS`) dan memuat kalimat penutup staf
- `scheduled_at == event_at` pada seluruh baris → `BYPASS_QUIET_HOURS` menggigit

Pembersihan diperiksa sesudahnya: `wa_form` 0, `wa_form_field` 0, `wa_form_entry`
0, `outbox` ber-`FORMULIR` 0, sesi uji 0. Setelan akhir:

```
formulir.enabled                     0
formulir.maks_per_nomor_per_hari     3
formulir.sesi_timeout_menit          30
formulir.simpan_hari                 90
```

### Uji unit yang dibuktikan MENGGIGIT

`core/waFormulir.test.ts` — 24 uji. Dua di antaranya GAGAL pada versi pertama dan
menemukan bug sungguhan: `normalizeInbound('-')` menghasilkan string kosong, jadi
tanda `-` yang justru dianjurkan halaman ini tidak pernah cocok dengan daftar kata
lewati. Diperbaiki dengan menjadikan string kosong anggota `KATA_LEWATI` — yang
sekaligus menjaring pesan yang seluruhnya tanda baca atau emoji.

Uji pembekuan menyunting objek formulirnya SESUDAH `mulaiFormulir()` (menghapus
satu pertanyaan dan mengganti kalimat penutup) lalu menuntut percakapannya tidak
bergeser sedikit pun.

### Gerbang

```
tsc --noEmit                      bersih
eslint .                          bersih
npx jest                          61 suite, 1090 uji  (dari 1066)
npm run test:int                  3 suite, 46 uji
npm run verify:db                 lolos (sik tulis DITOLAK, audit_log DELETE/UPDATE DITOLAK)
npm run verify:plans              lolos
npm run build                     berhasil; rute /formulir terdaftar
npm run dryrun:formulir           berjalan; "Belum ada satu pun formulir tersimpan"
```

`labels.test.ts` ikut lolos, yang membuktikan `FORMULIR` terdaftar di
`TRIGGER_LABEL` — gerbang itu menjaring `export const TRIGGER_*` di
`src/worker/*.ts`.

### Yang BELUM terbukti

- **Belum pernah dijalankan terhadap pesan WhatsApp sungguhan.** Seluruh bukti di
  atas memanggil `cobaFormulirWa()` langsung dengan objek pesan yang disusun kode
  uji. Itu batas yang sama yang pernah dibayar mahal dua kali di proyek ini (bug
  `@lid`, dan `message.id._serialized` yang hilang pada pesan grup): **uji yang
  membangun sendiri objek pesannya tidak pernah bisa membuktikan batas sistem yang
  bentuk datanya ditentukan pihak luar.** Yang menolong di sini, dan sebabnya
  risikonya jauh lebih kecil daripada dua kasus itu: pemetaan dari `message` ke
  `PesanFormulirMasuk` di `wa-client.ts` memakai `kunciPesanMasuk()` dan
  `resolvePhoneE164()` yang SAMA sudah dipakai jalur perintah dan balasan otomatis
  yang terbukti berjalan.
- **Jalur PERORANGAN belum diuji end-to-end**, hanya jalur grup — sengaja, karena
  setiap nomor E.164 adalah nomor milik seseorang. Yang berbeda di jalur itu cuma
  dua cabang: `phoneOverride` alih-alih `chatId` saat enqueue, dan kuota per nomor
  yang memang dilewati untuk grup.
- **Kuota per nomor per hari belum menggigit** terhadap data sungguhan, karena
  jalur grup tidak punya nomor untuk dihitung.
- **`wakhanza-worker` belum dimulai ulang.** Selama `formulir.enabled` masih `'0'`
  perilaku kode lama dan baru identik, jadi tidak ada yang perlu dikejar hari ini.
  Tapi **sebelum sakelarnya dinyalakan, worker WAJIB dimulai ulang** — kalau tidak,
  sakelarnya menyala di dashboard sementara worker tidak pernah menjaring apa pun,
  dan itu gagal DIAM. Pelajaran yang sama sudah dibayar di migrations/038.

---

## FORMULIR di `/bantuan` lewat WhatsApp

Bukti di bawah diambil 16 Agustus 2026 terhadap database `wakhanza` produksi.

**Keadaan yang berlaku saat verifikasi, dan ia mengubah caranya.** Berbeda dari
sesi sebelumnya, `formulir.enabled` sudah bernilai `'1'` dan ada satu formulir
sungguhan buatan staf berikut **tiga entry dari pasien**. Jadi sakelarnya
**TIDAK disentuh sama sekali** — mematikannya sepersekian detik berarti pesan
pasien yang kebetulan datang di sela itu tidak dijaring formulir apa pun, tanpa
satu pun galat yang mengatakannya. Keadaan "sakelar mati" karena itu dipatok uji
unit, bukan uji database.

### Uji unit — 10 baru, dan keduanya dibuktikan MENGGIGIT

```
$ npx jest core/waCommand core/waFormulir
PASS src/core/waCommand.test.ts
PASS src/core/waFormulir.test.ts
Tests:       89 passed, 89 total
```

Dirusak sengaja untuk membuktikan ujinya benar-benar menjaga sesuatu:

| yang dirusak | uji yang gagal |
|---|---|
| `bagianFormulir()` kehilangan `if (!f.aktif) return null` | `DIAM sama sekali saat fiturnya mati, walau ada formulir tersimpan` |
| `formulirYangMenjawab()` kehilangan penyaring kata kunci | `menggugurkan formulir tanpa kata kunci yang berarti`, `yang digugurkan di sini juga tidak pernah cocok di cocokFormulir` |

```
$ npx jest core/waCommand core/waFormulir      # dengan kedua kerusakan di atas
  ● /bantuan … › formulir › DIAM sama sekali saat fiturnya mati, walau ada formulir tersimpan
  ● formulirYangMenjawab › menggugurkan formulir tanpa kata kunci yang berarti
  ● formulirYangMenjawab › yang digugurkan di sini juga tidak pernah cocok di cocokFormulir
Tests:       3 failed, 86 passed, 89 total
```

### Uji terhadap database sungguhan — lewat `cobaPerintahWa()`, bukan fungsi murninya

Yang belum teruji unit justru bagian yang menyentuh database
(`bacaKemampuanFormulir()`), jadi skrip sementara menjalankan `/bantuan` lewat
jalur produksi penuh lalu membaca `outbox.body` yang benar-benar dienqueue —
dicari lewat kunci idempoten yang PERSIS, bukan "baris terakhir", karena worker
sungguhan sedang berjalan dan bisa menyisipkan barisnya sendiri kapan saja.
Tujuannya JID grup yang **tidak ada**, jadi tidak seorang pun menerima apa pun.

```
formulir.enabled: 1 (TIDAK disentuh) · wa_form sebelum: 1

  OK    boleh_grup mati -> kata kuncinya TIDAK disebut di grup
  OK    boleh_grup mati -> namanya TIDAK disebut di grup
  OK    boleh_grup mati -> keberadaannya tetap diakui (adaKhususPribadi)
  OK    bagian bantuan yang lain tetap utuh
  OK    boleh_grup nyala -> menyebut nama formulirnya
  OK    boleh_grup nyala -> menyebut kata kuncinya
  OK    boleh_grup nyala -> menyebut jalan keluar batal
  OK    boleh_grup nyala -> tidak lagi mengaku ada yang khusus pribadi
  OK    formulir nonaktif -> tidak disebut
  OK    formulir tanpa pertanyaan -> tidak disebut

BERSIH: wa_form=1 (sebelum 1) · admin_uji=0 · outbox_uji=0 · formulir.enabled=1

10 lolos, 0 gagal
```

**Percobaan pertamanya GAGAL 3 dari 11, dan sebabnya fixture — bukan produk.**
Formulir ujinya dibuat dengan `kata_kunci` berupa string mentah, sementara
`parseKeywords()` hanya menerima JSON (`serializeKeywords()` yang dipakai
dashboard). Larik kata kuncinya jadi kosong, dan **penyaring kata kunci yang
baru ditambahkan itulah yang menangkapnya** — formulirnya benar tidak disebut,
karena ia memang tidak akan pernah dijaring pesan apa pun.

### Bentuk yang benar-benar terkirim

Potongan akhir `outbox.body` sungguhan, dengan konfigurasi RS apa adanya:

```
*Formulir yang bisa diisi dari sini* (1)

• *Permintaan Obat*
   ketik: request obat, permintaan obat

_Pertanyaannya datang satu per satu. Ketik *batal* untuk berhenti._

_Urutan prioritas dan mode pencocokan hanya bisa diatur di dashboard._

Kode Pengiriman : 2026-08-16 15:04:03 KRH600
```

Baris kode pengiriman membuktikan bagian ini menempuh `enqueueMessage()` yang
sama dengan setiap pesan keluar lain, bukan jalur pintas.

### Pembersihan

Skrip sementara dihapus. Seluruh `destroy` di dalamnya dipagari ke id formulir
yang dibuatnya sendiri dan ke alamat grup palsu — tidak ada satu pun `where`
yang bisa melebar ke formulir sungguhan buatan staf.

```sql
SELECT (SELECT COUNT(*) FROM wa_form) f, (SELECT COUNT(*) FROM wa_form_field) ff,
       (SELECT COUNT(*) FROM wa_form_entry) fe,
       (SELECT COUNT(*) FROM wa_command_admin WHERE chat_id LIKE '1203630000%') adm,
       (SELECT COUNT(*) FROM outbox WHERE chat_id LIKE '1203630000%') ob,
       (SELECT v FROM app_setting WHERE k='formulir.enabled') sw;
```
```
f  ff  fe  adm  ob  sw
1  2   3   0    0   1
```

Ketiga entry pasien dan satu formulir staf utuh; sakelarnya tetap seperti
semula.

### Pemasangan ke worker — dan restart kedua yang tersangkut

Perubahan ini hidup di worker (`commandReply.ts`), jadi ia baru berlaku sesudah
`wakhanza-worker` dimulai ulang. Sebelum restart, sesinya diperiksa dan sehat:

```
status  umur_denyut
ready   14

sesi_berjalan  0
antre          0
```

**Yang TIDAK diperiksa: `uptime` 13 menit** — artinya sudah ada yang menyalakannya
ulang tiga belas menit sebelumnya, sehingga restart ini adalah yang KEDUA dalam
setengah jam. Itu persis kondisi yang sudah didokumentasikan menyebabkan
penautan tersangkut. Angkanya ada di layar `pm2 list` yang sama dan terbaca
sebagai "sehat" alih-alih "baru saja dinyalakan ulang".

Dua percobaan berturut-turut tersangkut, dan **seluruh pagarnya bekerja
sebagaimana tertulis**:

```
{"alasan":"pesan shutdown PM2","exitCode":0,"msg":"wakhanza-worker berhenti..."}
{"msg":"sesi WhatsApp ditutup rapi"}                 <- proses lama bersih
{"msg":"wakhanza-worker memulai..."}
{"status":null,"fase":"menautkan","diamDetik":0}     <- status basi ditolak dibaca
{"status":null,"fase":"menautkan","diamDetik":60}
{"status":null,"fase":"menautkan","diamDetik":120}
{"kind":"session_init_stuck","msg":"peringatan terkirim ke webhook"}
{"alasan":"penautan sesi tidak selesai","exitCode":1,"msg":"wakhanza-worker berhenti..."}
{"message":"Protocol error (Runtime.callFunctionOn): Target closed",
 "msg":"main() gagal karena worker sedang berhenti -- kode keluar shutdown() dipertahankan"}
```

**State sesi TIDAK rusak, dan itu dibuktikan bukan diduga.** Dua hal: proses
pertama berhenti lewat `shutdown()` dengan `exitCode:0` dan `"sesi WhatsApp
ditutup rapi"` — jalur yang justru ada supaya Chromium tidak mati di tengah
menulis state; dan galat yang muncul `Runtime.callFunctionOn): Target closed`,
**bukan** `timed out`. Yang pertama memang akibat wajar `shutdown()` menutup
Chromium di bawah `initWaClient()` yang masih ditunggu; yang kedua adalah tanda
state rusak, dan nol kali muncul.

Perlu dicatat untuk diagnosis berikutnya: sejak `BATAS_INIT_MS` (180 dtk) ada,
ia SELALU mendahului `protocolTimeout` puppeteer (300 dtk), jadi tanda
`timed out` itu **tidak bisa lagi muncul** — pembedaannya sekarang harus lewat
cara proses sebelumnya berhenti, bukan lewat galat ini.

```
Chromium sesi tersisa setelah pm2 stop: 0
outbox pending/sending selama gangguan: 0 baris
```

Nol antrean tertahan: pemicunya kelas watermark/pindai, jadi kejadian selama
gangguan diambil kembali saat worker pulih. Pemulihannya **jeda lalu satu
start**, bukan restart berulang — penautan ulang yang terlalu sering justru
memperparah pelambatan dari sisi WhatsApp.

## Isi pesan di `/antrean`: yang ditampilkan dulu tidak pernah cukup untuk apa pun

**Angka yang membuka masalahnya** — diukur atas seluruh `outbox` produksi,
bukan atas contoh yang dipilih:

```
mysql> SELECT COUNT(*) baris, MIN(CHAR_LENGTH(body)) min_len,
              ROUND(AVG(CHAR_LENGTH(body))) rata, MAX(CHAR_LENGTH(body)) max_len,
              SUM(CHAR_LENGTH(body) > 40) lebih_40,
              SUM(body LIKE '%\n%') berbaris_banyak,
              SUM(last_error IS NOT NULL AND last_error <> '') ada_galat
       FROM outbox;

baris  min_len  rata  max_len  lebih_40  berbaris_banyak  ada_galat
885    40       258   9485     884       883              13
```

884 dari 885 lebih panjang daripada yang muat di `max-w-xs`, dan **883
berbaris banyak** sementara `truncate` meratakannya jadi satu baris. Yang
terpanjang bukan anomali melainkan fitur yang memang ada:

```
trigger_code           n    rata  maks
AUTO_REPLY             30   995   9485      <- balasan rekap darurat stok
FARMASI_STOK_DARURAT   1    9118  9118
WA_PERINTAH            12   573   1760
FARMASI_PENGADAAN      13   787   1550
```

**Verifikasi render lewat instance PM2 yang SEDANG BERJALAN** (`npm run build`
-> `pm2 restart wakhanza-web` -> port 3100), sesi dimint langsung dengan
`AUTH_SECRET` alih-alih membuat akun admin sementara — yang perlu dibuktikan
cuma RENDER-nya, dan skrip ujinya tidak menekan satu tombol pun sehingga tidak
ada baris `audit_log` yang lahir atas nama siapa pun:

```
[1] GET /antrean -> HTTP 200, mendarat di http://127.0.0.1:3100/antrean
[2] 50 baris, 50 tombol "Lihat" yang benar-benar terlihat
[3] sel bertitle panjang (tooltip lama): tidak ada
[4] <dialog> di DOM sebelum diklik: 0
[5] dialog terbuka: judul="Perintah lewat WhatsApp", isi 1760 huruf,
    pre-wrap=true, berbaris banyak=true, tombol salin=true
[6] fakta pengiriman yang ikut: Jenis pesan | Tujuan (grup/petugas) | No. RM |
    Status | Waktu kejadian | Dijadwalkan | Terkirim | Percobaan kirim
[7] Esc menutup dan dialog dilepas dari DOM

SEMUA LOLOS
```

Baris [2] diperiksa lewat `getBoundingClientRect()`, bukan sekadar ada di DOM —
tombol yang dirender di dalam sel tersembunyi tetap terhitung oleh selektor
biasa (pelajaran tombol di dalam `<dialog>` tertutup, migrations/021). Baris
[4] dan [7] membuktikan dialognya benar-benar dipasang-dan-dilepas, bukan 50
dialog menganggur.

**Sebab kegagalan, yang sebelumnya tidak ada di halaman ini sama sekali** —
diperiksa terhadap baris `failed_permanent` sungguhan:

```
[8]  kotak "Kenapa gagal" ada: true
[9]  sebabnya terbaca: "Cannot read properties of undefined (reading 'getChat')"
[10] Percobaan kirim: 3
```

Galat itu persis celah `window.WWebJS` yang sudah didokumentasikan (§ "`ready`
TIDAK berarti halamannya bisa mengirim") — tersimpan di `last_error` sejak
awal, dan sampai sekarang tidak pernah bisa dilihat siapa pun dari dashboard.

**Utilitas Tailwind-nya benar-benar dihasilkan** (bukan kelas yang tidak pernah
jadi CSS):

```
$ grep -o "\-webkit-line-clamp:2" .next/static/chunks/*.css
-webkit-line-clamp:2
```

**Gerbang yang lain**: `tsc --noEmit` 0 galat, `eslint .` 0 galat,
`npx jest components/ui` 17 lolos — termasuk `petunjuk.test.ts`, yang menjaga
keterangan tidak kembali dititipkan ke atribut `title`.

Skrip verifikasinya sementara (`scripts/_verif-antrean*.ts`) dan **dihapus di
alur yang sama**; `git status` sesudahnya cuma menyisakan kedua berkas yang
memang diubah.

---

## Penautan konfirmasi terkirim untuk alamat PERORANGAN (`core/tautPesanKeluar.ts`)

Cacat ditemukan lewat audit, bukan lewat keluhan: `outbox.wa_message_id` terisi
untuk grup tapi tidak pernah untuk nomor. Yang mengubahnya dari "kadang gagal"
menjadi satu baris kode adalah pemecahan menurut BENTUK ALAMAT — bukan menurut
waktu atau pemicu.

### Keadaan sebelum perbaikan, 30 hari

```
bentuk                 terkirim  tertaut  persen
grup  @g.us                 755      447    59.2
petugas @c.us                86        0     0.0
pasien (nomor saja)          28        0     0.0
```

**Nol dari 114 baris beralamat perorangan.** Angka gabungan 53% menyembunyikan
dua populasi berlawanan; grup sendiri justru sehat, dan pindahnya bersih:

```
tgl         n   tertaut
2026-08-03  17        0
2026-08-04  83        0
...
2026-08-10  92       92     <- sejak sini
2026-08-15  56       56
2026-08-17   3        3
```

447 dari 453 sejak 10 Agustus = **98,7%**. Yang sebelum itu mendahului fiturnya.

### Sebab, dibaca dari log produksi

Pendengar `message_create` sudah membawa diagnostiknya sendiri. Empat pola:

```
tujuan            kandidat  artinya
<grup>@g.us         0  manusia mengetik di grup (5-40 huruf)
****@broadcast           0  status WhatsApp
<id-a>@lid          0  manusia mengetik dari HP nomor RS
<id-b>@lid          1  <- CACATNYA
```

`kandidat: 1` yang menentukan: isi pesan cocok, jendela cocok, `wa_message_id`
kosong — yang gagal hanya perbandingan alamat. WhatsApp memantulkan `to`
percakapan perorangan sebagai `<id>@lid`, yang sengaja tidak memuat nomor
telepon, sehingga `${phoneE164}@c.us === tujuan` tidak pernah benar. Grup tidak
punya bentuk LID, jadi ia lolos. Cacat yang sama sudah pernah dibayar di arah
MASUK.

Hitungan akhiran di seluruh log worker: `@g.us` 870, `@lid` 354, `@c.us` 127 —
LID memang sudah jadi bentuk utama percakapan perorangan di sesi ini.

### Pengaman pengganti, dan buktinya kuat

Alamat LID tidak memuat apa pun yang bisa dibandingkan, jadi pengaman keduanya
berganti bentuk menjadi KETUNGGALAN. Yang menopangnya diukur, bukan diandaikan:

```
baris 30 hari : 888
isi berbeda   : 888
pasangan beridentik teks dalam jarak 30 menit satu sama lain : 0
```

Kode pengiriman unik per baris (`core/uniqueCode.ts`) yang menjaminnya.

### Uji unit — 13, dan MENGGIGIT

```
$ npx jest src/core/tautPesanKeluar
Tests: 13 passed, 13 total
```

Cabang LID dirusak sengaja (`if (true) return { baris: null, sebab: 'tak-cocok' }`):

```
× menautkan baris pasien walau nomornya tidak ada di alamat pantulan
× menautkan tujuan petugas ber-@c.us yang dipantulkan sebagai @lid
× MENOLAK bila ada lebih dari satu kandidat perorangan
× memilih SATU baris perorangan walau ada grup lain di daftar kandidat
Tests: 4 failed, 9 passed, 13 total
```

Sembilan yang TETAP lolos adalah uji grup dan kecocokan persis — itu yang
membuktikan perbaikannya MENAMBAH, bukan menulis ulang yang sudah bekerja.
Dikembalikan sesudahnya, 13/13 lolos, penanda sabotase 0 kemunculan.

### Putar ulang melawan baris produksi sungguhan

Tidak mengirim apa pun: 114 baris yang benar-benar gagal diambil dari `outbox`,
daftar kandidatnya dibangun lewat lapisan model yang SAMA dipakai
`catatIdPesanKeluar()`, lalu dicocokkan terhadap alamat `@lid`.

```
Baris perorangan yang gagal tertaut (30 hari): 114
  akan tertaut BENAR : 114
  ambigu (ditolak)   : 0
  tanpa kandidat     : 0
  tak cocok          : 0

Pagar silang: alamat grup jatuh ke baris pasien pada 0 dari 200 percobaan
```

Pagar silang itu yang paling penting: pada mode `pasien_dan_tujuan`, salinan ke
grup dan pesan ke pasien bisa berisi teks yang sama persis, dan menautkannya
silang berarti konfirmasi milik grup dilaporkan sebagai bukti pasien menerima.

**Jebakan yang menggigit skrip verifikasinya sendiri, bukan produknya**:
percobaan pertama melaporkan `akan tertaut BENAR: 0`. Sebabnya `created_at <=
:saat` dengan `Date` JS lewat SQL MENTAH — `kandidat TANPA saringan waktu = 1`
sementara dengan saringan `0`. Pelajaran yang sudah tercatat soal `Date` +
Sequelize + SQL mentah, dan ia berlaku untuk skrip pemeriksa juga. Diulang lewat
`Outbox.findAll` + `Op`, persis seperti produksi.

### Level log ikut dibetulkan

`tanpa-kandidat` turun dari `warn` ke `debug`. Nomor rumah sakit juga dipakai
MANUSIA — tiap pesan yang diketik petugas, tiap balasan di grup, dan tiap status
menghasilkan `message_create` yang memang tidak punya baris `outbox`. Terukur,
mayoritas peringatan lama adalah itu. Aturan yang sama sudah berlaku di
`catatAck()`.

### Pemasangan

Empat pemeriksaan sebelum restart: `status: ready`, denyut 6 detik, antrean
`pending`/`sending` **kosong**, uptime **12 jam**, nol sesi percakapan berjalan.

```
$ pm2 stop wakhanza-worker
Chromium sisa pemegang sesi: 0
$ pm2 start wakhanza-worker
... "WhatsApp terautentikasi, menunggu ready"
... "WhatsApp siap"      <- 3,5 detik sesudahnya, satu pid, tanpa loop penautan
```

**Gerbang**: `tsc --noEmit` 0, `eslint .` 0, `npm test` 62 suite / 1113 uji,
`npm run build` lolos.

---

## Diagnosis restart worker: kedua tersangka yang tercatat sudah gugur

Dikerjakan 17 Agustus 2026 karena `wa_session_event` — tabel yang dibuat
9 Agustus persis untuk menjawab "berapa jam gateway mati bulan lalu" — belum
pernah sekali pun ditanya.

### Yang dijawab tabel itu

```
transisi 14 hari
  authenticating -> ready          61
  ready -> authenticating          58
  qr_pending -> authenticating     16
  authenticating -> qr_pending      6
  ready -> qr_pending               3
  qr_pending -> disconnected        2
  disconnected -> authenticating    2

waktu di luar `ready` : 447 menit dari 14 hari = 97,8% uptime
selang >= 10 menit    : 7
  paling panjang      : 312 menit, 16 Agustus 08:07 UTC
```

**Nol `ready -> disconnected`** — WhatsApp tidak pernah memutus sendiri; yang
berulang selalu berangkat dari `ready -> authenticating`. Selang 312 menit itu
melewati `qr_pending`, artinya QR benar-benar dipindai ulang: insiden penautan
16 Agustus yang sudah tercatat, bukan mode kegagalan baru.

### Tersangka 1: versi PM2 tidak sama — GUGUR

```
$ pm2 --version
7.0.1
$ pm2 report | grep version
pm2d version : 7.0.1
node version : 22.22.0
```

Daemon dan CLI **sama**. Dokumentasi lama menyatakan `in-memory 5.2.2` vs
`local 7.0.1` dan menjadikannya kecurigaan utama kaskade restart; itu sudah
tidak berlaku, dan menelusurinya lagi buang waktu.

### Tersangka 2: `stop_exit_codes` absen dari proses berjalan — GUGUR

```
stop_exit_codes        = 75
restart_delay          = 5000
kill_timeout           = 20000
shutdown_with_message  = True
max_memory_restart     = 838860800
exec_mode              = fork_mode
instances              = 1
autorestart            = True
unstable_restarts      = 0
restart_time           = 35
```

Seluruh setelan daur hidup hadir. `unstable_restarts = 0` adalah penghitung
PM2 sendiri untuk loop restart — nolnya berarti tidak ada kaskade berjalan.

**Jebakan pengukurannya, dan ia sempat menghasilkan kesimpulan yang keliru**:
percobaan pertama memakai `pm2 prettylist` + regex dan melaporkan `<TIDAK ADA>`
untuk KESEMBILAN kunci — termasuk `exec_mode` dan `instances`, yang jelas ada
karena `pm2 list` menampilkan `fork`. Keluaran prettylist bukan JSON sah.
Diulang lewat `pm2 jlist` disalurkan ke berkas lalu diurai Python.

**Pagar yang menyertainya**: `pm2 jlist` memuat SELURUH env proses termasuk
kredensial database. Berkasnya gitignored dan dibuang di alur yang sama; yang
dicetak hanya daftar kunci terpilih, tidak pernah keluarannya utuh.

### Keadaan sesudah restart pemasangan perbaikan ack

```
$ pm2 stop wakhanza-worker      -> berhenti rapi
Chromium sisa pemegang sesi: 0
$ pm2 start wakhanza-worker
"WhatsApp terautentikasi, menunggu ready"
"WhatsApp siap"                 -> 3,5 detik, satu pid, tanpa loop penautan
```

### Kesimpulan

Kedua mekanisme yang didokumentasikan sebagai penyebab kaskade **sudah
tertutup**. Yang TERSISA sebagai mode kegagalan nyata di mesin ini adalah
kerapuhan penautan ulang sesi WhatsApp — yang menuntut akses fisik ke ponsel
nomor RS dan sama sekali bukan urusan PM2. Kalau kaskade muncul lagi, tersangka
pertamanya sesuatu yang belum tercatat, bukan kedua ini.
