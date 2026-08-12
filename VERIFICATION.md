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
DPP INTAN RAHMA DEWI & APOTEK ALCA

No. Faktur : PG20260807001
Tanggal : 07-08-2026
Pemasok : CV DURGA JAYA MEDIKA
Gudang : Apotek
Petugas : Apt. Amelia Eriska, S.Farm

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
  dr. Intan Rahma Dewi                                                  Rp0
  :                                                                Rp10.000
  :                                                                     Rp0
    konsultasi dokter umum                         Rp25.000    1     Rp25.000
  31,655                                                                Rp0
```

Judul kelompok berbunyi ":" dan subtotalnya jadi baris bernama "31,655" tanpa angka. Sesudah diperbaiki (`no` sebagai label, `Ttl*` dihitung ulang):

```
    [keterangan] dr. Intan Rahma Dewi
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

## Konfirmasi terkirim (`migrations/035`) -- dan kenapa BELUM terbukti

Skema diterapkan dan diperiksa:

```
[migrate] jalankan 035_konfirmasi_terkirim.sql ... selesai
```

`core/waAck.test.ts` -- 14 kasus lolos, termasuk yang memaku ketiga keputusan
sulitnya: tingkat hanya boleh maju, `ACK_ERROR` boleh menimpa dari bawah, dan
label grup berbeda dari perorangan.

**Yang TIDAK terbukti: penautan id.** Lima kiriman uji sungguhan ke nomor RS
sendiri (obrolan dengan diri sendiri, tidak mengganggu siapa pun) semuanya
berakhir `sent` dengan `wa_message_id` tetap NULL:

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
