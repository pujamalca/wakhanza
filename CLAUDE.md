# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status proyek

Fase 0–4 dari `IMPLEMENTATION_PLAN.md` sudah diimplementasikan dan diverifikasi
— bukan lagi rencana. Di atasnya tumbuh **enam belas kelas pemicu** dan 51
migrasi; riwayat penambahannya berikut alasan tiap keputusan ada di
**`FITUR.md`**, bukan di sini.

**Yang TIDAK bisa diselesaikan siapa pun yang menulis kode**: Fase 5 adalah uji
coba bertahap ke pasien sungguhan, butuh keputusan kebijakan RS (daftar layanan
sensitif §F4.3, jam kirim H-1) dan dasar hukum persetujuan pasien (PRD §9 poin
4). Lihat "Yang masih perlu keputusan rumah sakit" di bawah.

### Keadaan produksi yang terukur (17 Agustus 2026)

Angka-angka ini **diukur, bukan diingat**, dan yang paling penting yang pertama.

**Fase 5 DIBUKA lalu DITUTUP lagi pada hari yang sama, 17 Agustus 2026 — dan
penutupannya keputusan RS, bukan kegagalan teknis.** Sampai pagi itu tidak satu
pun pasien pernah menerima pesan: keempat baris `template` yang aktif seluruhnya
bermode `tujuan` (hanya ke grup staf), delapan sisanya `is_active = 0`, dan
`template.batas_pasien_harian` yang dibuat `migrations/036` persis untuk memulai
bertahap masih `0` di kedua belas baris.

Urutannya, terbaca dari `audit_log`:

| WIB | oleh | apa |
|---|---|---|
| 08:57 | `cli:audit-…` | body ditulis ulang bersuara pasien, `batas_pasien_harian = 5` |
| 08:57 | `cli:audit-…` | `tujuan_mode` → `pasien_dan_tujuan` |
| ~09:0x | — | **dua pasien dikirimi**; satu `ack_level = 2` (sampai ke HP), satu ditolak benar karena nomornya tidak terdaftar di WhatsApp |
| 09:35 | `puja` | `tujuan_mode` → **`tujuan`** kembali |
| 12:53 | `puja` | body dikembalikan ke bentuk yang menyapa dokter |

**Keadaan sekarang: `QUEUE_REG` bermode `tujuan`, hanya ke grup Pendaftaran.**
`batas_pasien_harian = 5` tetap tersimpan tapi tidak berlaku apa pun selama
modenya `tujuan`. Body-nya `Ada Pasien Dok {nama_pasien}-{no_antrian}-…` tanpa
frasa berhenti — dan itu **BENAR untuk grup staf**, bukan sisa yang belum
dirapikan. `BOOK_REMIND`, `KONTROL_TERBIT`, `KONTROL_ULANG` juga masih `tujuan`.

Jadi sampai ada keputusan RS berikutnya, **nol pesan otomatis ke pasien** —
dengan pengecualian dua pesan pada 17 Agustus pagi yang tidak bisa ditarik.

**Yang WAJIB dikerjakan bila suatu saat dinyalakan lagi**, dan ini pelajaran
yang sudah dibayar sekali: body untuk grup staf dan body untuk pasien BUKAN
teks yang sama, dan kolomnya cuma satu. `Ada Pasien Dok` menyapa DOKTER;
memindahkan `tujuan_mode` tanpa menyentuh isinya mengirimi pasien pesan yang
memberitahunya bahwa ada pasien. Ia satu-satunya dari keenam template pasien
yang begitu — kelima lainnya sudah bersuara pasien (`Bpk/Ibu {nama_pasien},
...`). Jadi tiap kali modenya dipindahkan, **isinya harus ikut dipindahkan**,
kedua arah, dan yang bersuara pasien wajib berakhiran frasa berhenti.

**Memindahkannya satu baris**, tanpa restart worker — `tujuan_mode` dan
`batas_pasien_harian` dibaca ulang tiap siklus, dan pesan yang telanjur terkirim
tidak ikut tertarik:

```sql
-- MENYALAKAN ke pasien (isi body wajib ditulis ulang bersuara pasien LEBIH DULU):
UPDATE template SET tujuan_mode = 'pasien_dan_tujuan' WHERE trigger_code = 'QUEUE_REG';
-- MENUTUP kembali ke grup staf saja:
UPDATE template SET tujuan_mode = 'tujuan' WHERE trigger_code = 'QUEUE_REG';
```

Tidak perlu restart worker — `tujuan_mode` dan `batas_pasien_harian` dibaca
ulang tiap siklus. Kelengkapan variabelnya diukur sebelum dinyalakan: dari 685
pendaftaran 30 hari, **0** yang `nama_poli`, `nama_dokter`, atau `no_antrian`-nya
kosong, jadi tidak ada label menggantung. Yang TIDAK bisa dihilangkan: **37 dari
200** kandidat tidak punya nomor yang terpakai (18,5%) — mereka masuk `outbox`
sebagai `skipped_no_contact`, terlihat di `/antrean`, bukan hilang diam-diam.

| | |
|---|---|
| sakelar fitur MENYALA | balasan otomatis, perintah WA, formulir, ERM penilaian, farmasi (penyerahan, darurat, pengadaan, pemesanan, hibah, penjualan + rekapnya, resep rekap, bulanan), administrasi bulanan |
| sakelar MATI | dokumen hasil (lab/rad/nota), BPJS (batal + kontrol), surat sakit otomatis, farmasi validasi |
| `outbox` 30 hari | 888 baris; terbanyak `QUEUE_REG` 378, `FARMASI_PENYERAHAN` 226, `FARMASI_PENJUALAN` 104 |
| pesan masuk 30 hari | 277 perorangan (**14 dibalas**), 296 grup (35 dibalas) |
| kontak pasien | 4.857 baris — 3.907 terpakai, 863 kosong, 88 bermasalah lain |
| sesi WhatsApp 14 hari | 447 menit di luar `ready` = **97,8%**; selang terpanjang 312 menit (16 Agustus, menuntut pindai QR ulang) |

**`farmasi.stok_mode = "semua"`** — persediaan dan harga sudah terbuka untuk
nomor umum. Itu keputusan RS yang sudah diambil; pastikan katalog harganya
memang mutakhir (lihat butir kebijakannya).

**Database uji `TESTWA00001`** beserta `reg_periksa`/`periksa_lab`/`resep_obat`
terkait ada di `sik`, dibuat langsung lewat `mysql` semata untuk memvalidasi
pipeline. Aman diabaikan; jangan bingung dengan data pasien sungguhan.

### Yang masih terbuka dan sudah terukur

- **Tidak ada satu pun pemicu pasien yang menyala.** `QUEUE_REG` sempat dibuka
  17 Agustus 2026 pagi lalu ditutup lagi hari itu juga atas keputusan RS
  (`audit_log`, `puja`, 09:35 WIB); dua pesan telanjur terkirim dan tidak bisa
  ditarik. Menyalakannya lagi keputusan RS, bukan teknis — dan yang WAJIB
  dikerjakan bersamaan tiap kali adalah **menukar isi templatenya**, karena
  body untuk grup staf dan body untuk pasien bukan teks yang sama sementara
  kolomnya cuma satu. `QUEUE_REG` sekarang berbunyi `Ada Pasien Dok ...` tanpa
  frasa berhenti, dan itu benar selama modenya `tujuan`.
- **`resume_pasien` COUNT(\*) = 0** dan surat kontrol praktis kosong di
  produksi, jadi dua angka di rekap bulanan administrasi akan selalu nol.
- **`npm run audit` tidak akan pernah 0** tanpa perubahan yang memutus:
  11 kerentanan, seluruhnya rantai `sequelize` → `uuid`, dan perbaikannya
  memundurkan `sequelize` ke mayor 3. Didokumentasikan sengaja di TECH_STACK.
- **Memori Chromium melebihi `max_memory_restart` dan PM2 buta terhadapnya**
  (ia hanya mengukur proses Node yang dilacaknya, bukan keturunannya). Kalimat
  di tempat ini dulu berbunyi "belum jadi insiden"; **itu terbukti keliru pada
  17 Agustus 2026**, dan cara ia menjadi insiden penting diketahui karena
  gejalanya sama sekali tidak menyebut memori.

  Sesi mati **enam jam** (13.41–19.55) tersangkut `authenticating`. Yang terlihat
  di log cuma `Execution context was destroyed, most likely because of a
  navigation` dari `Client.inject()` — balapan di dalam whatsapp-web.js, tempat
  `framenavigated` menjalankan ulang `inject()` tanpa penjaga tumpang tindih.
  `ready` dipancarkan di ujung `inject()`, jadi injeksi yang mati di tengah
  berarti `ready` tidak pernah datang. **`Runtime.callFunctionOn timed out`
  NOL kemunculan**, jadi ini BUKAN kelas "state sesi rusak" dan mengosongkan
  `.wwebjs_auth` bukan obatnya.

  Yang menyembuhkannya: **Chromium segar**. Terukur, bukan dikira —
  `4384 MB / 33 proses` sebelum, `1155 MB / 10 proses` sesudah, dan penautan
  yang tadi gagal berjam-jam selesai **di bawah 20 detik**. Chromium yang
  membengkak membuat navigasi halaman lambat, dan balapan `inject()` vs
  navigasi jadi hampir selalu kalah.

  **Pemulihannya `pm2 stop` lalu `pm2 start` — bukan `pm2 restart`**, dan
  bedanya bukan gaya: `stop` menutup Chromium lewat `shutdown()` sampai tuntas
  (dibuktikan: 0 proses tersisa untuk dimatikan paksa sesudahnya), sementara
  `restart` melahirkan pengganti sebelum yang lama benar-benar melepas
  direktori sesi. Penyaring `CommandLine -like "*wwebjs_auth*"` tetap WAJIB
  kalau ada yang perlu dimatikan paksa — di mesin ini ada 16 proses
  `chrome.exe` lain milik pemakai.

  **Yang harus diperiksa saat sesi tersangkut menautkan: ukuran Chromium**,
  bukan cuma status dan denyut. Ia tidak muncul di `pm2 list` sama sekali.

## Apa itu wakhanza

Gateway notifikasi WhatsApp satu-arah untuk SIMRS Khanza (sistem informasi rumah sakit). Membaca kejadian (booking, antrian, hasil lab/radiologi, obat siap, tagihan) dari database MariaDB Khanza secara **read-only**, lalu mengirim WhatsApp ke pasien lewat whatsapp-web.js. Satu rumah sakit, satu nomor WhatsApp, dipasang on-premise di server RS. Tidak pernah menulis ke database itu — nol perubahan pada SIMRS Khanza adalah sasaran desain nomor satu (PRD §3), dan ini **diverifikasi mesin** lewat grant MariaDB, bukan cuma disiplin kode (lihat `npm run verify:db`).

**Berkas ini menyebut database Khanza sebagai `sik`, dan di mesin ini namanya BUKAN itu.** `SIK_DB_NAME` menunjuk **`alca`** — itulah yang dibaca produksi. `sik` masih ada di server yang sama sebagai salinan berisi riwayat, dan justru lebih berguna untuk MELIHAT bentuk data: beberapa tabel (`referensi_mobilejkn_bpjs_batal`, `bridging_surat_kontrol_bpjs`) masih kosong di `alca` tapi berisi ribuan baris di `sik`. Jadi "`sik`" di sepanjang berkas ini berarti "database Khanza", bukan nama harfiahnya; jangan menaruh nama database mana pun di kode (semuanya lewat `SIK_DB_NAME`), dan jangan menyimpulkan sebuah query salah hanya karena ia mengembalikan nol baris terhadap `alca`.

## Sebelum menyentuh kode

Baca dalam urutan ini — sebagian besar keputusan sulit (dan alasannya, termasuk pelajaran dari proyek sebelumnya "apiwa") ada di sana, dan beberapa detail teknis berubah selama implementasi (dicatat di bagian "Penyesuaian Implementasi" masing-masing dokumen):

1. `PRD.md` — kebutuhan fungsional (F1–F6), aturan privasi, kebutuhan non-fungsional (N1–N14)
2. `TECH_STACK.md` — pilihan teknologi + **"Penyesuaian Implementasi"** di bagian akhir (versi Next.js/NextAuth/dsb. yang benar-benar terpasang, dan kenapa berbeda dari rencana awal)
3. `ARCHITECTURE.md` — topologi proses, skema database, strategi polling, keamanan — termasuk §9.5 yang mendokumentasikan bug nyata di rencana grant MariaDB awal yang ditemukan saat implementasi. **Disegarkan 13 Agustus 2026 sampai `migrations/044`**; sebelum itu ia berhenti di Fase 0-4 dan tiga seksinya menuliskan aturan MUTLAK yang kodenya sudah punya kekecualian (§5.2 privasi, §6.2 jam tenang, §8 frasa berhenti) — bentuk paling berbahaya dari dokumen basi, karena pembacanya menyimpulkan sistem ini tidak bisa melakukan sesuatu yang sebenarnya bisa
4. `IMPLEMENTATION_PLAN.md` — urutan fase; berguna untuk memahami URUTAN keputusan, meski isinya sudah dikerjakan

**Dan satu lagi yang dibaca SAAT DIPERLUKAN, bukan di muka: `FITUR.md`** — kenapa tiap fitur berbentuk seperti sekarang, berikut pengukuran yang mendasarinya dan bentuk yang ditolak. Isinya dulu ada di berkas ini dan dipindahkan utuh pada 17 Agustus 2026, karena berkas ini dimuat ke SETIAP sesi sementara alasan sebuah fitur hanya perlu dibaca saat fitur itu disentuh. **Wajib dibuka sebelum mengubah fitur yang sudah ada, atau sebelum menyimpulkan "kenapa tidak dibuat lebih sederhana"** — jawabannya hampir selalu di sana, dan hampir selalu karena cara yang lebih sederhana sudah dicoba lalu gagal DIAM.

Aturan proses dari `IMPLEMENTATION_PLAN.md` yang tetap berlaku untuk pekerjaan lanjutan (Fase 5, atau perubahan pada Fase 0–4):

- **Setiap klaim "selesai" harus disertai keluaran perintah yang membuktikannya** — bukan "seharusnya jalan". Semua yang tercatat "selesai" di atas dibuktikan lewat perintah nyata terhadap database `sik`/`wakhanza` sungguhan, bukan diasumsikan.
- **Buktinya ada di `VERIFICATION.md`, bukan di berkas ini.** Judul seksi di sana dibuat sama persis dengan judul seksi di sini **atau di `FITUR.md`**, jadi bukti sebuah klaim dicari lewat judul seksi tempat klaim itu ditulis. Dipisah karena berkas ini dimuat ke SETIAP sesi sementara bukti hanya dibaca saat ada yang mempertanyakan satu klaim tertentu. **Menambah perilaku baru berarti menambah buktinya di sana** — aturan di atas tidak berubah, cuma pindah tempat.

## Perintah

```bash
npm run dev               # Next.js dev server, port 3100
npm run worker            # proses worker (poller + dispatcher + sesi WhatsApp) -- perlu scan QR pertama kali
npm run migrate           # terapkan migrations/*.sql yang belum jalan (skema wakhanza)
npm run verify:db         # buktikan sik menolak tulisan, dan audit_log append-only tertegak
npm run verify:plans      # EXPLAIN tiap query poller; gagal bila ada type:ALL selain booking_registrasi
npm run poll:dryrun       # cetak pesan yang AKAN terkirim untuk SEMUA pemicu tanpa mengirim/menulis apa pun
npm run dryrun:bpjs -- <database> [tanggal]   # sama, tapi bisa diarahkan ke database Khanza LAIN -- tabel BPJS sering kosong di instalasi baru
npm run dryrun:surat -- [database] [no_surat|no_rawat]   # pratinjau surat sakit/sehat + BUKTIKAN PDF-nya terbentuk (meluncurkan Chromium)
npm run dryrun:hibah -- [database]            # nota hibah; tabelnya kosong di alca, jadi arahkan ke database lain
npm run dryrun:kontrol -- [database] [tanggal]  # pengingat kontrol non-BPJS; TANGGAL acuan bisa diserahkan karena pemicunya harian H-N
npm run dryrun:dokumen -- [database] [no_rawat]  # hasil lab/radiologi/nota sebagai PDF; MELUNCURKAN Chromium, tidak mengirim apa pun
npm run dryrun:penjualan -- [database]        # nota penjualan + pesan pembatalannya; sekaligus memeriksa pagar privasinya pada objek barisnya
npm run dryrun:resep -- [database] [tanggal]  # rekap resep harian; TANGGAL bisa diserahkan karena hari Minggu memang nol resep di sini
npm run dryrun:bulanan -- [database] [YYYYMM]  # rekap BULANAN farmasi; memeriksa pagar privasinya pada objek barisnya, exit 1 bila bocor
npm run dryrun:adm-bulanan -- [database] [YYYYMM]  # rekap BULANAN administrasi (kunjungan); pagar privasi + keempat invarian penjumlahannya, exit 1 bila salah
npm run dryrun:penilaian -- [database] [tanggal]  # rekap asesmen awal keperawatan; memeriksa pagar privasinya pada objek barisnya, exit 1 bila bocor
npm run dryrun:stok -- ["pertanyaan" ...]     # balasan stok/ketersediaan: dijawab atau dilepas, dan bentuknya untuk petugas VS nomor umum
npm run dryrun:formulir -- ["kalimat" ...]    # mainkan percakapan formulir apa adanya tanpa mengirim/menulis; exit 1 bila ada formulir AKTIF yang tak akan pernah menjawab
npm run scan:contacts -- --dry-run   # hitung nomor pasien yang tidak terpakai, tanpa menulis
npm run scan:contacts     # isi patient_contact untuk SELURUH pasien sekaligus (lihat di bawah)
npm run seed:admin -- <username> "<nama>" <password>   # buat user dashboard pertama (role admin)
npm run users -- list                # daftar akun dashboard + status aktif/terkunci
npm run users -- add <username> "<nama>" <admin|operator> <sandi>   # sama dengan tombol di /pengguna
npm run users -- disable <username>  # juga: enable / unlock / passwd <username> <sandi-baru>
npm run users -- delete <username>   # permanen; pakai disable kalau akunnya mungkin dipakai lagi
npm run harden:permissions  # icacls .env + .wwebjs_auth ke akun saat ini + SYSTEM (jalankan ulang tiap sesi WA baru)
powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1   # daftarkan cadangan harian (lihat di bawah)
powershell -ExecutionPolicy Bypass -File scripts/install-git-hooks.ps1    # pasang hook pre-push (typecheck+lint+test, ~16 dtk)
npm test                  # semua test unit (fungsi murni, TIDAK butuh database); `npm test -- core/phone` untuk satu suite
npm run test:int          # uji integrasi enqueueMessage() -- BUTUH MariaDB hidup, lihat di bawah
npm run typecheck         # tsc --noEmit
npm run lint
npm run build
npm run audit             # npm audit --omit=dev; lihat "Penyesuaian Implementasi" TECH_STACK.md -- tidak akan pernah 0 tanpa breaking change, dan itu didokumentasikan sengaja
```

`npm run worker:dev` = `npm run worker` + tsx watch. **Jangan dipakai saat sesi WhatsApp hidup** -- tiap penulisan berkas menyalakan ulang proses, dan restart beruntun adalah persis yang merusak state sesi (lihat "Operasi produksi" di bawah).

`verify:db` dan `verify:plans` bukan pemeriksaan opsional — keduanya menegakkan dua batasan paling gampang dilanggar tanpa sadar: menulis ke `sik`, dan query yang diam-diam berubah dari index seek menjadi full table scan. Jalankan keduanya setiap kali koneksi atau query poller disentuh.

**Izin pindai penuh diberikan per TABEL, bukan per query** (`PlanCheck.allowFullScan`, berisi alias sebagaimana muncul di kolom `table` EXPLAIN — `b`/`d`/`p0`, bukan nama tabel aslinya). Bentuk lamanya `boolean`, dan itu terlalu tumpul dalam dua arah sekaligus: satu query menyentuh banyak tabel, jadi mengizinkan pemindaian pada SATU di antaranya berarti berhenti menjaga SEMUANYA — query jadwal dokter menyentuh tiga tabel padahal yang memang kecil cuma `dokter`. `maxRows`-nya pun tidak pernah benar-benar jalan: pemeriksaannya keburu dilewati oleh `continue`, jadi jaring pengaman yang tertulis di komentarnya sebenarnya tidak ada. Sekarang izinnya menggugurkan tepat dua pemeriksaan yang jadi tidak berlaku (`type=ALL` dan `key=NULL`) sementara `maxRows` tetap ditegakkan untuk semua — justru pada tabel yang boleh dipindai penuh itulah asumsi "tabel ini kecil" perlu gagal berisik saat ternyata keliru.

Satu jebakan lagi di skrip yang sama: **baris EXPLAIN dengan `table = NULL` bukan pemindaian penuh, melainkan kebalikannya** ("Impossible WHERE noticed after reading const tables", "Select tables optimized away") — optimizer sudah membuktikan hasilnya tanpa membaca apa pun. Dulu `type ?? 'ALL'` membacanya sebagai full scan, sehingga pemeriksaan GAGAL untuk query yang justru paling murah. Ketahuan lewat query pencarian no. pendaftaran, yang nilai contohnya memang sengaja tidak ada di database mana pun — dan nilai contoh yang tidak cocok dengan data nyata adalah keadaan NORMAL untuk pemeriksaan rencana, bukan kekecualian.

## Operasi produksi: PM2, sesi WhatsApp, cadangan

Seluruh isi seksi ini hanya berlaku saat menjalankan lewat **PM2** atau menyentuh daur hidup sesi WhatsApp. Kalau yang dikerjakan cuma menulis query poller atau halaman dashboard, lompati saja.

Produksi: `ecosystem.config.js` (PM2, dua app: `wakhanza-worker` fork-mode 1 instance, `wakhanza-web`) -- `pm2 start ecosystem.config.js` lalu `pm2 save`. **Enam jebakan Windows di jalur ini, semuanya baru ketahuan saat PM2 benar-benar dipakai** (`npm run worker` tidak pernah menyentuhnya) dan semuanya sudah diperbaiki:

1. **`script` tidak boleh menunjuk `node_modules/.bin/<apa pun>`** -- berkas di `.bin` tanpa ekstensi adalah skrip `/bin/sh` (npm menaruh pembungkus `.cmd`/`.ps1` terpisah untuk Windows), sedangkan PM2 menjalankan `script` dengan node -> `SyntaxError: missing ) after argument list`, berulang tanpa henti karena `autorestart`. Kena pada KEDUA app. Sekarang menunjuk berkas JS/TS sungguhan + `interpreter: 'node'` eksplisit.
2. **Worker memakai `node --import tsx berkas.ts`, bukan CLI `tsx`** -- CLI menjalankan kode di proses ANAK, sehingga PM2 hanya mengawasi pembungkusnya: `max_memory_restart: '800M'` akan mengukur pembungkus yang selalu kecil alih-alih Chromium yang merembes (satu-satunya alasan angka itu ada), dan SIGTERM berhenti di pembungkus tanpa sampai ke handler shutdown yang menutup sesi WhatsApp dan pool database.
3. **`.env`/`.wwebjs_auth` wajib memberi akses ke SYSTEM** -- lihat TECH_STACK.md §"Izin Berkas". Gejalanya menyesatkan: worker mati berulang dengan `SIK_DB_HOST wajib diisi` padahal berkasnya ada.
4. **Handler shutdown TIDAK PERNAH jalan, dan itu merusak sesi WhatsApp.** Windows tidak punya sinyal POSIX; PM2 tidak benar-benar mengirim SIGTERM, jadi `process.on('SIGTERM')` praktis tak pernah menyala. Ditemukan dengan cara paling sederhana: baris pertama `shutdown()` (`"wakhanza-worker berhenti..."`) muncul **0 kali** di seluruh log, di semua restart yang pernah terjadi. Akibatnya Chromium mati mendadak di tengah penulisan state sesi (`.wwebjs_auth`, LevelDB) -- dan kerusakannya baru muncul pada start BERIKUTNYA: `authenticated` menyala, lalu `ready` **tidak pernah datang**. Perbaikannya dua bagian, keduanya perlu: `shutdown_with_message: true` (PM2 mengirim pesan IPC `'shutdown'`, ditangani lewat `process.on('message')`) DAN `kill_timeout: 20000` (bawaannya 1600 ms -- menutup Chromium plus flush LevelDB tidak selesai secepat itu, jadi SIGKILL tetap datang di tengah jalan sekalipun pesannya sampai). **`pm2 restart` tidak membaca ulang `ecosystem.config.js`** -- perubahan di atas baru berlaku setelah `pm2 delete` + `pm2 start ecosystem.config.js`.

5. **Satu perintah `pm2 restart` meluncurkan DUA proses, dan yang bekerja justru jadi tak terlihat.** Terukur dari log: 47 kali start tapi `shutdown()` hanya 5 kali, dan 16 kali `browser is already running`. Jalur IPC shutdown-nya sendiri BENAR -- kelima kalinya menutup Chromium dengan bersih. Masalahnya, keluarnya proses lama itu sendiri dihitung PM2 sebagai exit yang perlu `autorestart`, **di atas** restart yang sedang ia jalankan:

   ```
   06:34:43  proses lama shutdown rapi (exit 0)
   06:34:45  PM2 meluncurkan pengganti #1  -> berhasil, memegang Chromium
   06:34:50  PM2 meluncurkan pengganti #2  -> kalah, "browser is already running"
   ```

   Pengganti #2 mati dengan exit 1 -> autorestart -> kalah lagi -> berputar tiap 5 detik (`restart_delay`) tanpa akhir. Dan karena PM2 selalu menganggap proses TERBARU sebagai miliknya, pengganti #1 yang justru bekerja menjadi **yatim**: `pm2 list` menampilkan pid lain, `pm2 stop` tidak menyentuhnya, dan worker terus mengirim WhatsApp di luar kendali. Dibuktikan langsung -- sesudah `pm2 stop`, prosesnya masih hidup dan `wa_session.heartbeat_at` masih diperbarui.

   Perbaikannya `src/worker/singleInstance.ts`, dipanggil PALING AWAL di `main()` (sebelum database, sebelum Chromium -- yang diperebutkan adalah direktori sesi, jadi yang kalah harus tahu sebelum menyentuhnya). Tiga keputusan yang menempel:

   - **Yang kalah MEMINTA pemegangnya mundur, bukan keluar dan bukan sekadar menunggu.** Keluar adalah persis yang memberi makan loop-nya. Tapi sekadar menunggu juga salah ujungnya: PM2 berakhir melacak si penunggu sementara pemegang sesi tetap yatim, sehingga `pm2 restart` berikutnya hanya mengganti penunggunya dan **kode baru tidak pernah benar-benar dijalankan** -- kegagalan yang lebih senyap daripada loop yang berisik. Dengan meminta mundur, ujungnya benar: proses yang dilacak PM2 adalah proses yang memegang sesi.
   - **Pemegang yang mundur WAJIB lewat `shutdown()`**, bukan `process.exit()` -- kalau tidak ia meninggalkan state sesi setengah tertulis untuk yang mengambil alih, yaitu persis kerusakan di poin 4.
   - **Kuncinya PORT (`WORKER_LOCK_PORT`, default 3101), bukan berkas kunci.** Port dilepas sistem operasi saat proses mati, termasuk SIGKILL dan listrik padam; berkas kunci berisi pid meninggalkan kunci basi sesudah kematian mendadak -- dan kematian mendadak justru mode kegagalan paling sering di sini. Soketnya sekalian jadi jalur permintaan mundur. Ini **bukan** pelanggaran "kedua proses tidak pernah berkomunikasi lewat HTTP": aturan itu tentang koordinasi APLIKASI (antrean pesan, status sesi) yang tetap sepenuhnya lewat tabel; yang lewat sini cuma satu kata kendali daur hidup, antara dua instance worker yang sama, di loopback.

6. **`pm2 start` WAJIB dari PowerShell, bukan git-bash.** Dijalankan dari git-bash, worker mati berulang dengan `Variabel lingkungan SIK_DB_HOST wajib diisi` -- gejala yang IDENTIK dengan jebakan izin berkas di poin 3, sehingga menyesatkan ke arah `harden:permissions` padahal `icacls .env` sudah benar (`SYSTEM:(R)` dan akun saat ini `(R)`), berkasnya ada, dan `process.loadEnvFile()` atas lintasan absolut yang sama berhasil bila diuji langsung dari shell itu juga. Perintah yang sama persis dari PowerShell langsung `online` dengan 0 restart. Terukur, bukan dikira: `pm2 delete` + `pm2 start ecosystem.config.js --only wakhanza-worker` dicoba di kedua shell berturut-turut dengan konfigurasi yang tidak disentuh. Jangan buang waktu pada izin berkas sebelum mencoba PowerShell lebih dulu.

**`ready` TIDAK berarti halamannya bisa mengirim, dan ketiga sinyal kesiapan buta pada bedanya.** whatsapp-web.js menaruh objek pembantunya, `window.WWebJS`, ke dalam halaman lewat `Client.inject()`. Objek itu **dihapus setiap kali frame bernavigasi** dan disuntikkan ulang secara ASINKRON (`pupPage.on('framenavigated', async () => { await this.inject(); })`), tanpa satu pun event yang menandainya. Di sela itu `Client.sendMessage()` -- yang memanggil `window.WWebJS.getChat(chatId, ...)` di dalam halaman -- gagal dengan `Cannot read properties of undefined (reading 'getChat')`. Yang undefined bukan chat-nya, melainkan seluruh objek suntikan kita.

| Sinyal | Yang dibacanya | Melihat celahnya? |
|---|---|---|
| `isWaReady()` | baris `wa_session` yang ditulis saat event READY | tidak — keadaan HISTORIS, bukan sekarang |
| `checkHealth()` → `getState()` | `window.require('WAWebSocketModel')` | tidak — modul milik WhatsApp SENDIRI, selamat dari navigasi |
| `window.WWebJS` | objek suntikan whatsapp-web.js | inilah yang hilang |

Akibatnya bukan satu baris log yang mengganggu: tiap kejadian menghabiskan **satu dari hanya tiga** percobaan (`core/retry.ts`), dan startup justru saat antrean paling menumpuk. Tiga kali seperti itu menandai notifikasi pasien `failed_permanent`, yang sejak itu hanya bergerak kalau ada manusia menekan "Kirim ulang" — gangguan halaman beberapa detik berubah jadi pesan yang tidak pernah sampai. Perbaikannya tiga lapis, dan ketiganya perlu:

- **`core/waError.ts`'s `galatHalamanBelumSiap()`** memisahkan "belum sempat mencoba" dari "sudah dicoba dan gagal". Yang pertama TIDAK menaikkan `attempts` dan TIDAK menulis `send_log` — baris log percobaan yang tidak pernah terjadi hanya membuat riwayatnya berbohong. Dicocokkan lewat TEKS galat karena galatnya lahir di dalam Chromium lalu diseberangkan puppeteer, jadi sudah luruh jadi pesan (alasan yang sama dengan `galatBerkasTerkunci()`). Daftar penandanya sengaja **sempit**: yang terlalu longgar membuat kegagalan sungguhan dicoba ulang tanpa batas tanpa pernah muncul di panel "perlu ditinjau" — persis kelas kegagalan yang sudah dibayar di `core/outboxStatus.ts`.
- **`tungguHalamanSiap()`** menjajaki `window.WWebJS` langsung ke halaman, dipakai gerbang dispatcher (anggaran 2 detik, lewati siklus) DAN `checkHealth()` (anggaran panjang, supaya sela penyuntikan yang normal — biasanya di bawah satu detik — tidak dibaca sebagai gangguan lalu memicu restart; penautan ulang yang terlalu sering justru memperlambat sinkronisasi WhatsApp). **Probe yang tidak bisa dijalankan dianggap SIAP, bukan sebaliknya**: `pupPage` bukan tipe publik, dan gagal-tertutup berarti dispatcher berhenti mengirim selamanya tanpa satu pun galat kalau bentuk pustakanya berubah — jauh lebih buruk daripada bug yang sedang diperbaiki. Jaring pengaman sebenarnya ada di sisi tangkapan.
- **Tidak ada risiko berputar selamanya**, dan itu tidak perlu mekanisme baru: `isStale()` (F5.3) tetap membatalkan pesan yang pemicunya kelewat tua, dan halaman yang tidak pernah tersuntik lagi kini dijaring `checkHealth()` lalu worker dimulai ulang.

**Sesi yang tersangkut `authenticating` tidak pulih sendiri, dan itu pernah membuat sistem mati 14 jam.** Pemeriksaan kesehatan yang lama berhenti lebih dulu (`if (!isWaReady()) return`): ia hanya menjaga sesi yang SUDAH siap dari Chromium yang menggantung, bukan sesi yang tidak pernah sampai siap. Sementara itu poller tetap berputar, PM2 melaporkan `online`, dan tidak satu pun pesan bisa terkirim maupun diterima. Dashboard memang menandainya (`SystemStatus` di `/ringkasan` menampilkan panel peringatan + "Perbaiki sekarang"), tapi itu mengandalkan ada orang yang membukanya -- kejadiannya jam 01:25 dini hari dan baru ketahuan 14 jam kemudian. Sekarang `sessionWatchdog()` (`worker/index.ts`) keluar bila sesi berada di luar `ready` lebih dari **15 menit**, dan PM2 menyalakan ulang. Tiga hal yang menempel padanya:

- **`qr_pending` sengaja dikecualikan**: itu bukan macet melainkan sistem yang benar sedang menunggu manusia memindai QR (bisa berjam-jam saat pemasangan pertama), dan restart di tengahnya justru menerbitkan QR baru sehingga kode yang sedang dipindai petugas jadi kedaluwarsa.
- **15 menit, bukan 5, dan itu bukan kehati-hatian melainkan pengamatan**: penautan ulang yang terlalu sering tampaknya membuat WhatsApp memperlambat sinkronisasi. Satu start setelah jeda panjang mencapai `ready` dalam 5 detik; empat start beruntun sesudahnya semuanya tersangkut. Watchdog yang menyala tiap 5 menit akan menjadi sumber masalahnya sendiri alih-alih pemulihannya.
- **Keluarnya WAJIB lewat `shutdown()`, bukan `process.exit()` langsung.** Ini sempat salah pada versi pertama watchdog-nya: keluar tanpa menutup Chromium meninggalkan state sesi setengah tertulis, sehingga proses penggantinya menggantung di `authenticating` -- pemulihan yang justru menciptakan kegagalan berikutnya. `shutdown()` juga memberi `destroy()` batas waktunya sendiri (15 detik), karena sebagian pemanggilnya keluar JUSTRU karena Chromium menggantung, dan `destroy()` pada Chromium yang menggantung bisa ikut menggantung selamanya.

**Celah "tersangkut DI DALAM `initWaClient()`" -- ditemukan DAN ditutup 14 Agustus 2026.** Dulu `await initWaClient()` ada di `worker/index.ts:346` sementara `loop('heartbeat', ...)` dan `loop('session-watchdog', ...)` baru dipasang di baris 602 dan 604, jadi kedua jaring pengaman itu baru terbentang SESUDAH penautan berhasil. Sekarang keduanya dipasang SEBELUMNYA. Pembedaan di bawah tetap ditulis lengkap karena ia yang menjelaskan kenapa urutannya begitu -- dan karena gejalanya masih akan terlihat sama dari luar:

| Tersangkut `authenticating` dengan... | Artinya | Yang menolong |
|---|---|---|
| denyut SEGAR (< 40 dtk) | sudah lolos `initWaClient()`, sesi tak kunjung `ready` | `sessionWatchdog()` di menit ke-15 |
| denyut BASI dan terus tumbuh | masih DI DALAM `initWaClient()` | **tidak ada** -- sampai `protocolTimeout` puppeteer menjatuhkannya |

Yang dulu menyudahinya bukan watchdog melainkan batas waktu protokol puppeteer (`Runtime.callFunctionOn timed out`, terukur 325,8 detik dua kali), dan **cara matinya itulah kerusakan sebenarnya**: galat itu jatuh ke `main().catch()` lalu `process.exit(1)` **TANPA lewat `shutdown()`**, sehingga Chromium mati mendadak di tengah menulis state sesi dan start berikutnya mewarisi kerusakannya. Loop yang memberi makan dirinya sendiri.

**Perbaikannya (`core/watchdog.ts` + urutan di `worker/index.ts`), dan yang dibeli bukan kecepatan matinya melainkan CARA matinya:**

- **`heartbeat` dan `session-watchdog` naik ke ATAS `await initWaClient()`.** Denyut yang berjalan selama penautan itulah satu-satunya yang membedakan kedua keadaan di tabel di atas, dan sebelumnya ia justru tidak ada persis saat dibutuhkan.
- **Fase `menautkan` jadi cabang tersendiri berbatas `BATAS_INIT_MS` (180 detik), lebih pendek daripada `protocolTimeout` 300 detik.** Jarak dua menitnya disengaja supaya keduanya tidak pernah berlomba; penautan sehat terukur 5-13 detik, jadi 180 detik jauh di atasnya. Keluarnya lewat `shutdown()`, yang menutup Chromium rapi -- itulah yang memutus rantai kerusakannya.
- **Status TIDAK dibaca selama penautan.** `wa_session` masih memuat status milik proses SEBELUMNYA, jadi `ready` yang basi akan mengirim watchdog memeriksa kesehatan klien yang belum jadi. Dibuktikan MENGGIGIT: cabang init dihapus -> uji "TIDAK memeriksa kesehatan walau status basi berbunyi ready" gagal.
- **Peringatan `session_init_stuck` TERPISAH dari `session_stuck`**, karena tindakannya berbeda: yang itu pulih sendiri lewat restart, yang ini tidak pulih berapa kali pun sampai direktori sesi dikosongkan dan QR dipindai ulang.
- **`session-command` AKHIRNYA ikut naik, dan kalimat di tempat ini dulu berbunyi kebalikannya.** Dua keberatan aslinya masih benar dan tidak dicabut: ia memanggil `getClient().logout()`/`resetState()` yang menuntut halaman yang sudah jadi, dan ia MENGOSONGKAN kolom perintah sebelum bertindak -- jadi menaikkannya BEGITU SAJA berarti perintah dari dashboard ditelan diam-diam tepat pada keadaan yang paling membutuhkannya. Yang KELIRU adalah kesimpulan yang dulu ditarik darinya: "perintah yang datang selama penautan tetap tersimpan dan dijalankan begitu sesi hidup" hanya benar bila sesinya AKHIRNYA hidup. Saat penautan gagal berulang, loopnya tidak pernah ada sama sekali -- terukur 15 Agustus 2026, empat puluh menit tanpa satu pun perintah dashboard terbaca, sementara tombol "Sambung ulang"/"Keluar sesi" ditekan berkali-kali. Kedua keberatan itu sekarang ditutup DI DALAM `processSessionCommand()` lewat parameter `fase`, bukan dihindari dengan menaruh loopnya di bawah: selama `menautkan` ia tidak pernah menyentuh `getClient()`, dan perintah yang belum bisa dikerjakan TIDAK dikonsumsi. Yang berubah perilakunya cuma `reconnect`, dan justru itu yang dicari orang.

Terbukti di produksi pada restart pemasangannya: `wakhanza-worker memulai...` lalu **66 ms kemudian** `fase:"menautkan" status:null "sesi WhatsApp masih menautkan"` -- watchdog berbunyi di dalam fase yang sebelumnya tidak diawasi sama sekali, dan `status:null` membuktikan ia menolak membaca status basi.

**Yang MENYEMBUHKANNYA: mengosongkan `.wwebjs_auth`, bukan jeda.** Ini perlu ditulis tegas karena dugaan pertama saya keliru dan menghabiskan setengah jam: gejalanya (penautan yang tak kunjung jadi sesudah belasan start beruntun) sama persis dengan throttling yang dijelaskan bullet "15 menit, bukan 5" di atas, jadi jeda tampak seperti obatnya. Bukan. Yang membuktikannya satu angka: sesudah direktori sesi dipindahkan, `initWaClient()` yang tadi menggantung 5,4 menit **berulang kali** menerbitkan QR dalam **di bawah 5 detik**. Kalau sebabnya throttling, start itu akan menggantung juga.

Jadi urutan diagnosisnya: **umur denyut** memisahkan "tersangkut di dalam init" dari "tersangkut sesudah init" (tabel di atas), lalu `Runtime.callFunctionOn timed out` yang BERULANG pada durasi yang sama persis (325,8 dtk dua kali, sama dengan `protocolTimeout: 300_000` di `wa-client.ts` plus ongkosnya) menandai state sesi yang rusak -- bukan jaringan dan bukan throttling. **Menaikkan `protocolTimeout` bukan perbaikannya**, ia cuma memperpanjang tiap percobaan yang menggantung.

**Pemulihannya menuntut akses fisik ke ponsel nomor RS**, jadi ia langkah terakhir, bukan pertama: hentikan worker, PINDAHKAN (jangan hapus) `.wwebjs_auth` ke `.wwebjs_auth.bak-<stempel>`, nyalakan, lalu pindai QR di `/koneksi`. Dipindahkan supaya masih bisa dikembalikan bila ternyata bukan itu sebabnya. **Tombol logout di `/koneksi` TIDAK bisa dipakai untuk ini**, dan kesimpulan itu tetap berlaku walau ALASAN yang dulu ditulis di sini sudah tidak berlaku: `loop('session-command', ...)` sekarang memang ikut naik. Yang menahannya bukan lagi ketiadaan loop melainkan parameter `fase` -- selama `menautkan`, `logout` sengaja DITUNDA (bukan ditelan) karena ia menuntut halaman yang sudah jadi, dan halaman itulah yang justru tidak pernah jadi. Halaman `/koneksi` sekarang mengatakannya apa adanya: `tindakanKoneksi()` mematikan tombolnya berikut sebabnya, alih-alih membiarkannya ditekan sia-sia. Yang menggantikannya bukan tombol melainkan peringatan `session_init_stuck` yang menyebutkan langkah ini apa adanya.

**Di mesin ini penautan ulang GAGAL jauh lebih sering daripada yang diandaikan seluruh seksi di atas, dan itu terbaca dari jejak yang sudah ada.** Diukur 16 Agustus 2026: ada TIGA cadangan `.wwebjs_auth.bak-*` bertanggal 14 Agustus 21:48, 15 Agustus 07:56, dan 15 Agustus 19:49 -- artinya prosedur "pindahkan lalu pindai QR" sudah ditempuh tiga kali dalam tiga hari, dan `wa_session_event` mengonfirmasi yang terakhir (`disconnected → authenticating → qr_pending → authenticating → ready` pada 19:49-19:50). Sesudah restart pada 16 Agustus 15:07, tiga percobaan berturut-turut tersangkut di `fase:"menautkan"` sampai batas 180 detik -- termasuk satu sesudah jeda enam menit -- padahal pagi harinya penautan yang sama berhasil dalam **5 detik** (08:56) lalu **37 detik** (09:03).

Tiga akibatnya, dan ketiganya mengubah cara memperlakukan restart di sini:

- **Restart BUKAN operasi rutin di instalasi ini.** Ia punya kemungkinan nyata berakhir menuntut pemindaian QR, yang menuntut ponsel nomor RS. Jadi "restart dulu, lihat hasilnya" adalah rencana yang bisa mendaratkan sistem notifikasi pada keadaan yang cuma bisa dipulihkan manusia dengan ponsel di tangan. Kumpulkan perubahan, restart sekali, dan pastikan ada yang bisa memindai QR bila perlu.
- **Ukuran direktori BUKAN penjelasannya.** Keempatnya diukur: 110M, 158M, 50M, dan 123M saat gagal -- yang 50M ikut gagal, jadi kembung bukan sebabnya dan memangkasnya bukan obatnya.
- **Jaringan juga bukan.** `web.whatsapp.com` menjawab HTTP 200 dari mesin ini pada saat penautannya gagal.

**`.gitignore` sempat tidak menutupi cadangannya.** Polanya `.wwebjs_auth/` cocok dengan nama persis itu saja, sehingga `.wwebjs_auth.bak-*` berisi kredensial WhatsApp 73 MB terlihat oleh git. Sudah ditambahkan; periksa lagi bila suatu saat pola cadangannya berubah.

Aman ditinggalkan berhenti selama pemulihan: pesan yang tertahan tetap `pending` dan diambil dispatcher saat worker kembali, sementara ambang basi (6-12 jam) jauh di atas gangguan sepanjang ini.

**DUA `pm2 restart` berdekatan bisa menjatuhkan worker ke crash loop, dan `pm2 stop` TIDAK cukup untuk keluar darinya.** Terjadi sungguhan: worker di-restart dua kali dalam satu jam (perubahan kode, lalu perbaikan atas perubahan itu), dan sesudah yang kedua ia gagal start berulang dengan `{"msg":"worker gagal memulai","message":"Protocol error (Runtime.callFunctionOn): Target closed"}` -- 29 restart beruntun, ditambah baris `ERROR: The process with PID ... could not be terminated`. Bedanya dari ketiga mode kegagalan sesi di atas: bukan sesi yang tersangkut `authenticating`, bukan `window.WWebJS` yang hilang, dan bukan dua instance yang berebut (`singleInstance.ts` bekerja normal) -- melainkan **Chromium yatim yang selamat dari matinya proses induk** dan tetap memegang direktori sesi, sehingga tiap proses baru mati sebelum sempat apa pun.

Yang paling menyesatkan: `wa_session.status` tetap `ready` sepanjang gangguan, karena baris itu ditulis proses yang SUDAH mati dan tidak ada yang membatalkannya. Yang membocorkannya adalah **`heartbeat_at` yang basi** -- 195 detik pada loop yang seharusnya 30 detik. Jadi saat memeriksa kesehatan sesudah restart, `status` saja tidak cukup; yang menjawab "apakah ada proses yang hidup sekarang" hanya umur heartbeat-nya.

Pemulihannya tiga langkah, dan urutannya mengikat:

1. `pm2 stop wakhanza-worker` -- menghentikan loop-nya dulu, kalau tidak proses baru terus lahir di tengah pembersihan.
2. Matikan **hanya** Chromium yang memegang direktori sesi, disaring lewat baris perintahnya: `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*wwebjs_auth*" }`. Penyaring itu bukan kerapian -- di mesin ini ada 14 proses `chrome.exe` lain milik pemakai, dan `Stop-Process -Name chrome` akan menutup peramban orang di tengah kerja.
3. `pm2 start wakhanza-worker`, lalu tunggu heartbeat kembali di bawah 40 detik.

Pelajaran yang menempel: **jangan menyalakan ulang worker dua kali berdekatan.** Kalau ada perubahan susulan, kumpulkan dulu lalu restart sekali -- biayanya menunggu beberapa menit, sementara biaya yang satunya adalah sistem notifikasi mati sampai ada yang menyadarinya.

**Dan yang menjawab "apakah ini restart kedua" adalah kolom `uptime`/`↺` di `pm2 list`, BUKAN kesehatan sesinya.** Ditemukan dengan cara paling mahal (16 Agustus 2026): sebelum restart, sesinya diperiksa dan seluruhnya sehat -- `status: ready`, denyut 14 detik, nol sesi percakapan berjalan, antrean kosong. Yang TIDAK diperiksa: `uptime` **13 menit**, yang artinya ada yang sudah menyalakannya ulang tiga belas menit sebelumnya. Restart berikutnya karena itu adalah yang KEDUA, dan penautannya tersangkut persis seperti yang tertulis di paragraf ini. Angka itu ada di layar `pm2 list` yang sama yang dibaca untuk memastikan prosesnya hidup, dan gampang terbaca sebagai "sehat" alih-alih "baru saja dinyalakan ulang". **Pemeriksaan sebelum restart karena itu empat, bukan tiga: status sesi, umur denyut, antrean, DAN uptime.** Uptime di bawah ~30 menit berarti tunggu dulu.

Yang terjadi sesudahnya BUKAN mode kegagalan baru, dan seluruh pagarnya bekerja sebagaimana tertulis -- itu bagian yang layak dicatat: proses lama berhenti RAPI (`exitCode:0`, `"sesi WhatsApp ditutup rapi"`) sehingga state sesi tidak rusak, penggantinya tersangkut di `fase:"menautkan"` dengan `status:null` (watchdog menolak membaca status basi), lalu `BATAS_INIT_MS` menjatuhkannya pada detik ke-180 lewat `shutdown()` berikut peringatan `session_init_stuck` ke webhook -- dan `main().catch()` MEMPERTAHANKAN kode keluar shutdown alih-alih menimpanya. Jadi yang perlu dikerjakan orang cuma satu: **menunggu**, bukan menyalakan ulang lagi. Mengosongkan `.wwebjs_auth` adalah langkah TERAKHIR dan menuntut akses fisik ke ponsel nomor RS; ia hanya berlaku bila `Runtime.callFunctionOn timed out` berulang pada durasi yang sama persis, bukan untuk penautan yang sekadar lambat.

**Tapi SATU restart pun bisa berkaskade, dan itu ditemukan belakangan (9 Agustus 2026, penilaian teknis).** Bentuknya BERBEDA dari kedua mode di atas -- bukan Chromium yatim, bukan dua proses berebut yang salah satunya jadi yatim (`singleInstance.ts` terbukti benar di setiap serah terima). Kecurigaan kuat waktu itu: versi PM2 daemon (`in-memory`, 5.2.2) tidak sama dengan versi CLI (`local`, 7.0.1), dan jarak antar instance yang muncul (~5 detik) sama persis dengan `restart_delay`. Lihat bullet "Kaskade restart dari SATU pm2 restart" di `FITUR.md` untuk detail lengkap dan kenapa `pm2 update` TIDAK dijalankan sepihak. Pemulihannya tetap prosedur tiga langkah yang sama di atas.

**KEDUA tersangkanya sudah gugur, diukur 17 Agustus 2026 — jangan buang waktu menelusurinya lagi.** `pm2 report` menjawab `pm2d version: 7.0.1` sama dengan CLI `7.0.1`, jadi ketidakcocokan versi itu **sudah tidak ada**. Dan seluruh setelan daur hidup benar-benar ADA di proses yang berjalan, dibaca dari `pm2 jlist`:

```
stop_exit_codes = 75          restart_delay = 5000
kill_timeout    = 20000       shutdown_with_message = True
exec_mode       = fork_mode   instances = 1
unstable_restarts = 0
```

`unstable_restarts = 0` itu penghitung PM2 sendiri untuk loop restart, dan nolnya berarti tidak ada kaskade yang sedang berjalan. **Yang TERSISA sebagai mode kegagalan nyata di mesin ini bukan PM2 melainkan penautan ulang sesi** — lihat seksi berikutnya. Kalau kaskade muncul lagi, tersangka pertamanya sesuatu yang BELUM tercatat di sini, bukan kedua ini.

**Cara membacanya, dan satu pagar:** `pm2 jlist` memuat SELURUH env proses termasuk kredensial database, jadi jangan pernah menampilkannya utuh ke layar atau menempelkannya ke tiket — salurkan ke berkas gitignored lalu cetak hanya kunci yang dicari. `pm2 prettylist` sekilas lebih mudah tapi bentuknya bukan JSON sah, dan penguraian sembarangan atasnya melaporkan `<TIDAK ADA>` untuk setelan yang sebenarnya ada (terjadi saat pengukuran ini, dan sempat menghasilkan kesimpulan yang keliru).

`scripts/backup.ps1` + `scripts/restore-backup.ps1` untuk cadangan terenkripsi AES-256 database + sesi WhatsApp — **sudah diuji langsung berulang kali**, terakhir 9 Agustus 2026 atas cadangan produksi (`wakhanza-backup-20260809-020947.enc`): dekripsi, ekstraksi, restore sungguhan ke `wakhanza_restore_test` (22 tabel, `outbox` 420 baris, `patient_contact` 4.858 baris), lalu `DROP DATABASE`. Sejak `scripts/install-backup-task.ps1` ada, **benar-benar terjadwal** alih-alih menunggu seseorang ingat menjalankannya (§ berikutnya). `backup.ps1` sekarang juga membandingkan ukuran dengan cadangan sebelumnya dan mengirim peringatan lewat `alert.webhook_url` bila selisihnya di luar ±40% -- lihat "Sebelas perbaikan operasional" di `FITUR.md`.

### Cadangan harian: dijadwalkan sebagai SYSTEM, dan satu jebakan stderr

Skrip cadangannya sudah ada sejak Fase 4 tapi **tidak pernah dijadwalkan** — direktori `backups\` bahkan belum pernah terbentuk. Yang hilang bila disk mati bukan cuma riwayat: `opt_out` adalah catatan permintaan berhenti dari pasien dan tidak bisa direkonstruksi dari mana pun, `audit_log` sengaja append-only, dan `.wwebjs_auth` yang lenyap berarti scan QR ulang dengan akses fisik ke ponsel nomor RS.

`install-backup-task.ps1` mendaftarkannya ke Task Scheduler, harian pukul 01:00 (sesudah lalu lintas pasien reda, dan **sebelum** pembersihan berkala worker jam 02:00 — jadi cadangan hari itu masih memuat baris yang beberapa jam kemudian dipangkas). Berjalan sebagai **SYSTEM**: tidak perlu menyimpan password akun di Task Scheduler, tetap jalan saat tidak ada yang login, dan `.env`/`.wwebjs_auth` memang sudah memberi akses ke SYSTEM lewat `harden:permissions`. `mysqldump` wajib ada di PATH tingkat **MESIN** — SYSTEM tidak membaca PATH milik user — dan skrip pemasangnya memeriksa itu di muka supaya kegagalannya tidak baru muncul jam 01:00.

**Frasa sandinya dibaca dari `.env`.** Task Scheduler tidak punya sesi interaktif, jadi tidak ada tempat mengetiknya; `.env` sudah jadi tempat rahasia lain, gitignored, dan terkunci ke akun saat ini + SYSTEM. Konsekuensi yang harus disadari dan **tidak bisa diselesaikan kode**: menyimpan frasa itu HANYA di `.env` berarti disk mati menghapus cadangan beserta kuncinya sekaligus. Catat di luar mesin.

**Jebakan yang membuat percobaan pertama gagal, dan bentuknya persis seperti `trustHost`:** `mysqldump` MariaDB 10.4 menulis satu peringatan tak berbahaya ke stderr tiap kali jalan (`option 'max_allowed_packet': ... adjusted to ...`). PowerShell 5.1 membungkus tiap baris stderr proses native jadi `ErrorRecord`, dan dengan `$ErrorActionPreference='Stop'` itu MENGHENTIKAN skrip walau kode keluar mysqldump 0 dan dump-nya berhasil. Dijalankan manual dari shell, peringatannya lewat begitu saja dan cadangan terbentuk normal; dijalankan Task Scheduler, skripnya mati di langkah 1 dan **tidak ada berkas cadangan yang terbentuk sama sekali** — setiap hari, jam 01:00, tanpa seorang pun melihat. Sekarang berhasil/gagal ditentukan **kode keluar mysqldump plus ukuran berkas hasilnya**, bukan ada-tidaknya tulisan di stderr. Sekali lagi pelajaran yang sama: verifikasi lewat jalur yang benar-benar dipakai produksi, bukan lewat cara yang paling gampang dijalankan dengan tangan.

Cadangan lama dipangkas sendiri (`-KeepDays`, default 30) **sesudah** cadangan baru berhasil ditulis, tidak pernah sebelumnya — kalau dump gagal, skrip sudah berhenti di atas dan tidak ada cadangan lama yang telanjur hilang. Tanpa pemangkasan, direktori cadangan tumbuh sampai disk penuh, dan disk penuh menghentikan MariaDB — justru bencana yang cadangan ini ada untuk menghadapinya.

## Arsitektur inti

### Dua koneksi database, dua tingkat kepercayaan
`src/db/sik.ts` memakai user MySQL `wakhanza_ro` — `GRANT SELECT` saja, `pool.max: 2` supaya tidak berebut koneksi dengan SIMRS yang sedang dipakai petugas. `src/db/wakhanza.ts` memakai `wakhanza_rw`. Pemisahan ditegakkan hak akses database, bukan disiplin kode: worker **wajib** mencoba `CREATE TEMPORARY TABLE` di `sik` saat mulai dan berhenti jalan bila berhasil (`src/db/guards.ts`, ARCHITECTURE §9.1). `sequelize.sync()` tidak boleh pernah dipanggil — skema `wakhanza` lewat migrasi SQL bernomor (`migrations/NNN_*.sql`) dijalankan `npm run migrate`.

**`wakhanza_rw` BUKAN `GRANT ALL PRIVILEGES`.** Rencana awal ternyata punya bug nyata (ditemukan & diperbaiki saat implementasi, ARCHITECTURE §9.5): MariaDB menyatukan hak akses lintas tingkatan, jadi `REVOKE DELETE, UPDATE ON audit_log` di atas fondasi `GRANT ALL` tidak menegakkan apa pun. Model yang benar: tanpa `UPDATE`/`DELETE` di tingkat database, diberikan satu per satu di tingkat tabel, `audit_log` dikecualikan selamanya. Diverifikasi ulang lewat `npm run verify:db`.

Dua gotcha koneksi:
- Koneksi `sik` wajib `dialectOptions: { dateStrings: true }`. `resep_obat.tgl_penyerahan` memakai `'0000-00-00'` sebagai penanda "belum diserahkan"; tanpa `dateStrings`, mysql2 mengubahnya jadi `Invalid Date`/`null` secara diam-diam (ARCHITECTURE §4.6, `src/khanza/farmasi.ts`).
- MariaDB di sini adalah **10.4, bukan MySQL 8** — tanpa CTE rekursif yang baik, tanpa `JSON_TABLE`, window function terbatas.

### Zona waktu: kolom `DATETIME` di `wakhanza` menyimpan UTC, bukan WIB

**SEBABNYA, ditemukan belakangan: kolom `DATETIME` di `wakhanza` menyimpan UTC, bukan WIB.** Sequelize memakai `timezone: '+00:00'` (bawaannya), jadi `Date` JS pukul 20:16 WIB tersimpan sebagai `'13:16:27'` dan dibaca balik menjadi 20:16 WIB lagi — konsisten, dan **tidak ada yang perlu diperbaiki di kode**. Yang perlu diketahui adalah konsekuensi bacanya: **nilai yang terlihat di CLI `mysql` bukan jam dinding WIB**, jadi menghitung selisih waktu dari angka mentah itu meleset 7 jam. Pakai `CONVERT_TZ(kolom,'+00:00','+07:00')` saat memeriksa lewat `mysql`, atau baca lewat Sequelize. Semua model menulis `created_at` sendiri (`defaultValue: DataTypes.NOW`) alih-alih membiarkan `DEFAULT current_timestamp()` milik MariaDB mengisinya — itulah yang menjaga tulis/baca tetap sepasang. Baris yang di-INSERT lewat SQL mentah melewati pasangan itu, dan di situlah gotcha di atas lahir.

**Gotcha uji manual, dicatat supaya tidak terulang**: baris `broadcast_schedule` yang `next_run_at`-nya di-INSERT lewat `mysql` mentah (mis. `NOW() - INTERVAL 10 SECOND`) TIDAK cocok dengan query `Op.lte` Sequelize milik worker, walau `SELECT next_run_at <= NOW()` lewat SQL biasa menunjukkan `1` (benar). Sequelize/mysql2 menerjemahkan `Date` JS dan nilai `DATETIME` MySQL secara konsisten satu sama lain (tulis-lewat-Sequelize lalu baca-lewat-Sequelize cocok), tapi TIDAK konsisten dengan nilai yang ditulis langsung lewat klien `mysql` di luar Sequelize. Saat menguji fitur berbasis tanggal/jam secara manual, buat baris ujinya lewat kode aplikasi (`Model.create()` atau server action/skrip yang memanggilnya), jangan lewat `INSERT` SQL mentah untuk kolom yang nanti dibandingkan lewat Sequelize.

### Next.js 16, bukan 14 -- dan `proxy.ts`, bukan `middleware.ts`
TECH_STACK.md awalnya menetapkan Next.js 14/NextAuth v4; keduanya dinaikkan ke Next 16/NextAuth v5 (beta) saat implementasi karena Next 14 punya kerentanan tinggi tanpa patch lanjutan (detail di TECH_STACK.md "Penyesuaian Implementasi"). Konsekuensi konkret bagi siapa pun yang menyentuh `src/app/`: `params`/`searchParams`/`cookies()`/`headers()` bersifat `Promise` (async), dan gerbang autentikasi tingkat-request bernama **`src/proxy.ts`** (Next 16 mengganti nama dari `middleware.ts` -- fungsinya sama). Auth.js v5 dipecah dua berkas: `src/auth.config.ts` (tanpa provider, aman untuk Edge Runtime tempat `proxy.ts` berjalan) dan `src/auth.ts` (provider Credentials penuh + Sequelize/bcrypt, HANYA dipakai route handler/Server Component/Server Action). Jangan import `@/auth` dari `proxy.ts` -- Edge Runtime tidak mendukung Sequelize.

**`trustHost: true` di `auth.config.ts` WAJIB, dan sempat luput.** Auth.js v5 hanya memercayai Host header secara otomatis saat `next dev`. Pada build produksi -- persis yang dijalankan PM2 lewat `ecosystem.config.js` -- tanpa baris itu SETIAP permintaan ke `/api/auth/*` ditolak `UntrustedHost` dan dijawab HTTP 500, sehingga tidak seorang pun bisa masuk. Perbedaan dev/produksi ini tidak pernah muncul selama pengujian memakai `npm run dev`; ia baru ketahuan saat dashboard diuji lewat `npm start`. **Verifikasi HTTP apa pun yang menyangkut login harus lewat `npm run build && npm start`, bukan `npm run dev`** -- dev server memaafkan justru kelas kesalahan yang mematikan di produksi. Aman di sini karena topologinya tetap: satu server RS, prosesnya diikat ke 127.0.0.1 (`next start -H 127.0.0.1`), tidak melayani banyak host.

Otorisasi API ditegakkan DUA lapis dan keduanya perlu diperiksa saat menambah route baru: `proxy.ts` hanya menjaga HALAMAN (redirect ke `/login`); setiap route di `src/app/api/**/route.ts` memanggil `requireSession()`/`requireRole('admin')` dari `src/lib/authz.ts` sendiri dan mengembalikan 401/403 JSON. `/api/*` sengaja dikecualikan dari matcher `proxy.ts` -- kalau tidak, pemanggil API menerima redirect HTML alih-alih JSON.

### Topologi dua proses, koordinasi lewat tabel
`wakhanza-worker` (PM2, **wajib** `instances: 1, exec_mode: 'fork'`, tidak boleh `cluster` -- lihat `ecosystem.config.js`) memegang sesi whatsapp-web.js dan menjalankan poller + dispatcher + scheduler. `wakhanza-web` (Next.js) tidak memegang state sesi. Kedua proses **tidak pernah** berkomunikasi lewat HTTP — semua lewat tabel `wakhanza` (`wa_session` untuk QR/status/perintah lewat `src/worker/sessionCommand.ts`, `outbox` untuk status pesan), dengan konsekuensi tindakan petugas di dashboard tertunda hingga satu siklus (§1).

### Pipeline bersama: `src/worker/pipeline.ts` dan `src/worker/sisipCycle.ts`
`POLL → COALESCE → RESOLVE nomor → NORMALIZE → GATE (opt-out/invalid/nonaktif) → PRIVACY → RENDER → ENQUEUE` (langkah [3]-[8] ada di `pipeline.ts`'s `enqueueMessage()`, dipakai SEMUA pemicu -- jangan duplikasi logika ini saat menambah pemicu baru). Pemicu kelas sisip (QUEUE_REG, RESULT_READY, PHARMACY_READY, BILLING_READY) berbagi `runSisipCycle()` generik di `sisipCycle.ts`, dibedakan lewat parameter fetch/mapping per pemicu di `src/worker/poller*.ts`. `DISPATCH → SEND → LOG` (`dispatcher.ts`) mengambil dari `outbox` dengan `FOR UPDATE SKIP LOCKED`, terpisah total dari langkah enqueue -- kegagalan kirim tidak pernah menghapus jejak bahwa pemicunya terdeteksi.

**Kode unik per pesan disisipkan di langkah RENDER, bukan SEND.** `core/uniqueCode.ts` menambahkan satu baris pendek (`Kode Pengiriman : 2026-08-02 20:18:41 5QVC9G`, default `dispatch.unique_code_template` = `Kode Pengiriman : {waktu} {kode}`) ke SETIAP pesan keluar, termasuk BROADCAST -- karena laju rendah (jeda acak 3-8 detik + kuota per jam, PRD F5.2) hanya menangani separuh pemicu deteksi spam WhatsApp; separuh lainnya adalah banyak pesan berteks IDENTIK, dan template tetap membuat puluhan pesan sehari nyaris sama. Dua keputusan yang menempel di sini dan gampang dirusak tanpa sadar:

- **Diturunkan dari `idempotency_key`, bukan acak.** Dispatcher mencoba ulang sampai beberapa kali (`core/retry.ts`); kode acak akan membuat percobaan kedua tampak sebagai pesan BARU bagi pasien maupun bagi WhatsApp -- persis kebalikan dari tujuannya.
- **`{waktu}` saja TIDAK cukup, dan `{kode}` bukan hiasan di sampingnya.** Satu broadcast meng-enqueue seluruh penerimanya dalam perulangan rapat, jadi ratusan pesan mendapat detik yang SAMA; digabung dengan isi broadcast yang memang identik, seluruh kiriman jadi identik karakter per karakter -- persis pola yang fitur ini ada untuk mencegahnya. Karena itu `{kode}` tetap ditempelkan walau admin menghapusnya dari template; `{waktu}` tidak diperlakukan begitu karena ia tidak menjamin apa pun.
- **`{waktu}` diisi `scheduled_at`, bukan waktu enqueue.** Pesan yang muncul pukul 22.00 lalu ditahan jam tenang sampai 07.00 harus menyebut 07.00 -- kalau tidak, pasien membaca stempel sembilan jam sebelum pesannya tiba. Karena itu `computeScheduledAt()` dipanggil SEBELUM body dirender di `enqueueMessage()`.
- **Disisipkan saat ENQUEUE (`pipeline.ts`), bukan saat SEND (`dispatcher.ts`).** Menyisipkannya di dispatcher akan membuat `outbox.body` berbeda dari yang benar-benar terkirim -- halaman Log berhenti menunjukkan teks sungguhan, dan kode yang disebut pasien lewat telepon tidak bisa lagi dicari (`outbox.body LIKE '%KODE%'`, satu-satunya cara -- kodenya sengaja TIDAK disimpan di kolom terpisah).

Substitusi footer-nya SENGAJA terpisah dari `renderTemplate()`: menggabungkan footer ke body lalu merender ulang sekali lagi akan melanggar aturan satu-lintasan (§ substitusi template di bawah). Alfabetnya Crockford Base32 -- tepat 32 karakter (tanpa bias modulo) dan tanpa I/L/O/U supaya tidak tertukar saat dibacakan lewat telepon. Kalau admin menghapus `{kode}` dari templatenya, kodenya TETAP ditempelkan di akhir (`buildUniqueCodeFooter`) -- tanpa itu seluruh pesan berakhiran teks identik dan fitur ini mati diam-diam tanpa satu pun pesan error.

Pratinjau `/broadcast`, `/broadcast-terjadwal`, dan `npm run poll:dryrun` semuanya membaca pengaturannya lewat `loadUniqueCodeTemplate()`/`previewUniqueCodeFooter()` yang SAMA dipakai `enqueueMessage()` -- pratinjau tidak boleh menampilkan bentuk pesan yang berbeda dari yang benar-benar terkirim.

**Uji integrasi pipeline (`worker/pipeline.int.test.ts`, `npm run test:int`).** Sampai berkas ini ada, seluruh suite uji proyek ini menguji `src/core/` saja -- fungsi murni yang tidak menyentuh database. Bagian yang MENGGABUNGKAN semuanya, dan satu-satunya jalur yang dilewati keempat kelas pemicu, hanya pernah divalidasi manual satu per satu setiap kali ada yang berubah. Tiga hal yang menempel padanya:

- **Config terpisah** (`jest.integration.config.js`, berkas `*.int.test.ts`, dikecualikan dari `jest.config.js`). `npx jest` harus tetap bisa dijalankan di mana saja tanpa database dan selesai dalam hitungan detik -- begitu ia butuh MariaDB hidup, ia berhenti dipakai sebagai pemeriksaan cepat. `maxWorkers: 1` karena beberapa uji sengaja mengubah pengaturan bersama.
- **Menulis ke database `wakhanza` SUNGGUHAN**, bukan database uji hasil `sync()`. Yang perlu dibuktikan justru perilaku terhadap skema, grant, dan UNIQUE KEY yang benar-benar berlaku -- dan `sequelize.sync()` memang tidak pernah dipanggil di proyek ini. Baris ujinya ditandai pada `idempotency_key` dan dibersihkan di `afterAll`.
- **`.env` harus dimuat lewat `setupFiles`, dan sebabnya halus.** `process.loadEnvFile()` adalah fungsi native yang menulis ke `process.env` milik proses SUNGGUHAN, sementara berkas uji berjalan di sandbox VM yang memegang salinannya sendiri: pemuatannya "berhasil" tanpa galat, lalu `WA_DB_HOST` tetap undefined. Karena itu setup-nya membaca `.env` dan menulis nilainya satu per satu.

**Dan uji ini langsung menemukan satu perangkap**: `PipelineContext.identity` ada tapi `enqueueMessage()` tidak pernah membacanya -- kelima pemanggil kebetulan menyisipkan `identityVars()` sendiri ke `vars`, jadi kebenarannya bergantung pada kelimanya mengingat itu. Yang membuatnya berbahaya bukan pemicunya melainkan **template generik**: isinya ditulis admin di halaman Pengaturan dan memang memuat `{nama_rs}`/`{kontak_rs}`, sementara ia menggantikan pesan untuk jalur privasi mana pun -- termasuk pemicu baru yang penulisnya tidak tahu kewajiban itu. Pesannya akan berbunyi "ada informasi dari ." tanpa satu pun galat. Sekarang `enqueueMessage()` menyisipkannya sendiri sebagai dasar dan `input.vars` tetap menimpa, jadi pemanggil lama menghasilkan pesan yang sama persis.

Hasil penunjang punya DUA watermark terpisah (`RESULT_READY_LAB`, `RESULT_READY_RADIOLOGI` di `poll_cursor`) -- mencampur watermark dua sumber independen bisa membuat salah satunya melompati baris yang belum diproses. Nama kunci itu **peninggalan dari sebelum `migrations/034`** dan sengaja TIDAK diselaraskan dengan kode pemicunya yang baru (`LAB_RESULT`/`RAD_RESULT`): kunci watermark adalah identitas BARIS, jadi menggantinya sama artinya dengan membuangnya -- `getCursor` jatuh ke `now - polling.lookback_days` lalu poller mengirim ulang sebulan penuh hasil pemeriksaan.

### Status `outbox`: terminal vs aktif, dan tiga kebocoran yang lahir dari selisih tafsir

`core/outboxStatus.ts` memegang daftar status sekaligus pembagiannya. Ia dibuat karena tiga tempat yang berjauhan -- dispatcher (memilih yang dikerjakan), cleanup (memangkas yang selesai), Ringkasan (menampilkan yang menunggu orang) -- masing-masing menafsirkan sendiri "baris ini masih akan bergerak atau tidak", dan ketiganya ternyata tidak sepakat. Akibatnya persis kelas kegagalan termahal di proyek ini: baris yang tidak dikerjakan siapa pun, tidak ditampilkan di mana pun, dan tidak pernah dihapus. **Aktif hanya `pending` dan `sending`**; sisanya terminal. Tidak ada status "gagal tapi nanti dicoba lagi" -- percobaan ulang bekerja dengan mengembalikan baris ke `pending` berikut `scheduled_at` mundur, bukan lewat status tersendiri. Uji `outboxStatus.test.ts` menjaga kedua golongan itu MEMBAGI HABIS ENUM-nya, supaya status baru memaksa keputusannya diambil sadar-sadar alih-alih diam di celah.

Tiga hal yang diperbaiki bersamaan, dan ketiganya bergejala sama: tidak ada pesan error di mana pun.

- **Pemangkasan dulu hanya `status='sent' AND sent_at < cutoff`.** Setiap baris yang TIDAK pernah terkirim punya `sent_at` NULL, jadi `skipped_no_contact`/`skipped_opt_out`/`failed`/`failed_permanent`/`expired` menetap selamanya di tabel yang paling cepat tumbuh -- dan justru itu yang paling banyak: satu broadcast ke 500 pasien di RS yang ~40% nomornya tidak terpakai meninggalkan ~200 baris abadi sekali kirim. Sekarang memangkas seluruh status terminal menurut `created_at`. **Akibat lanjutannya**: baris `skipped_*` ikut menyimpan `media_path`, sementara `cleanupOrphanMedia()` hanya menghapus berkas yang tak ditunjuk baris mana pun -- selama baris abadi itu ada, lampiran broadcast **tidak pernah bisa dihapus dari disk**. Memperbaiki pemangkasan barisnya sekaligus memperbaiki yang ini; keduanya tidak bisa dipisah.
- **Percobaan-habis dulu ditulis `failed`, bukan `failed_permanent`.** `NEEDS_REVIEW` di `ringkasan/queries.ts` cuma memuat `failed_permanent` dan `expired`, dan label `failed` berbunyi "masih akan dicoba ulang otomatis" padahal dispatcher hanya mengambil `pending`. Jadi notifikasi pasien yang gagal tiga kali berturut-turut berhenti diam-diam: tidak dicoba ulang, tidak tampil di panel mana pun, tidak ada yang tahu. `failed` tetap ada di ENUM demi baris peninggalan dan **ikut dimasukkan ke `NEEDS_REVIEW`** -- baris lama yang selama ini tak terlihat harus muncul ke permukaan, bukan ikut terkubur oleh perbaikannya.
- **Baris tersangkut `sending` tidak pernah pulih.** `sending` ditulis di dalam transaksi tepat sebelum kirim; kalau worker mati di antaranya (SIGKILL setelah `kill_timeout`, listrik padam), barisnya tinggal di sana selamanya. `recoverInterruptedSends()` dijalankan di startup SEBELUM dispatcher menyala. **Sengaja TIDAK dikembalikan ke `pending`**: kegagalannya terjadi di satu-satunya titik yang hasilnya tidak bisa kita ketahui -- pesannya mungkin sudah sampai ke WhatsApp sebelum prosesnya mati -- jadi kirim ulang otomatis berarti sebagian pasien menerima pesan sama dua kali tanpa ada yang memutuskan. Ditandai `failed_permanent` supaya muncul berikut tombol Kirim ulang. Aman di startup karena worker dijamin instance tunggal (`instances: 1, exec_mode: 'fork'`).

### Kendala indeks yang membentuk setiap query poller
Kolom tanggal Khanza yang tampak wajar (`tgl_registrasi`, `tgl_periksa`, dst.) **tidak terindeks**. Solusinya: tanggal sudah ter-enkode di primary key, jadi tiap query poller wajib dua penyaring sekaligus:
```sql
WHERE no_rawat >= :lookback_prefix              -- pemangkas lewat indeks (PK)
  AND TIMESTAMP(tgl_periksa, jam) >= :cursor_ts  -- ketepatan
```
Setiap query poller wajib menunjukkan `range`/`eq_ref`/`index`, tidak pernah `type: ALL` pada tabel dasar — ditegakkan `npm run verify:plans`. Pengecualian satu-satunya yang disengaja: `booking_registrasi` (kelas pindai, interval 5 menit bukan 60 detik). `scripts/verify-plans.ts` juga mengecualikan hasil scan terhadap **tabel turunan/subquery** (`<derived2>` dsb.) dari pemeriksaan full-scan -- itu hasil yang sudah tersaring, bukan tabel dasar. Baca ARCHITECTURE §4.4 sebelum menyentuh query poller mana pun.

### Dua kelas pemicu: sisip vs pindai
`QUEUE_REG`, `LAB_RESULT`, `RAD_RESULT`, `LAB_REQUEST`, `RAD_REQUEST`, `PHARMACY_READY`, `BILLING_READY`, `BOOK_CONFIRM` = kelas **sisip** (watermark). `BOOK_CANCEL`, `BOOK_REMIND` = kelas **pindai** (`src/worker/pollerBooking.ts`, `scheduler.ts` -- scan ulang jendela terbatas; dedup murni lewat kunci idempoten yang menyertakan `status`). `BOOK_CONFIRM` dan `BOOK_CANCEL` berbagi SATU query (`khanza/booking.ts`'s `pollUpcomingBookings()`) dan SATU siklus (`pollerBooking.ts`), dibedakan lewat status baris dan idempotency key masing-masing -- bukan dua query terpisah. `event_at` untuk keduanya memakai waktu DETEKSI (sekarang), bukan `tanggal_booking` -- lihat komentar di `pollerBooking.ts` untuk kenapa memakai timestamp booking asli akan salah membuat konfirmasi jangka panjang tampak basi.

### Pagar watermark: kursor tidak boleh melampaui waktu berjalan (`core/watermark.ts`)

Watermark kelas sisip artinya "semua yang waktunya <= T sudah diproses", dan yang menentukan T adalah waktu kejadian TERBESAR yang terbaca. Waktu itu datang dari kolom yang **diketik manusia** di Khanza (`jam_reg`, `jam`, `jam_penyerahan`), bukan dari jam server -- jadi satu digit yang meleset cukup untuk melempar kursornya ke masa depan.

Terjadi sungguhan: satu pendaftaran dibuat pukul 06:15 dengan `jam_reg` **19:59:46**. Watermark maju ke 19:59:46, dan sejak itu SELURUH pendaftaran hari itu -- 09:11 sampai 17:11, semuanya lebih awal menurut jam dinding -- jatuh di bawahnya lalu dilewati. **Tiga belas pasien tidak menerima nomor antriannya.** Tidak ada galat, tidak ada baris `outbox`, dan log-nya melaporkan `rowsSeen 0` tiap 60 detik seolah memang tidak ada yang perlu dikerjakan.

**Pagarnya dipasang di `advanceCursor()` (`worker/cursor.ts`), BUKAN di pemanggilnya.** Ada enam pemanggil di empat berkas (`sisipCycle`, `pollerBooking`, `farmasiRunner` ×2, `bpjsRunner` ×2), dan `advanceCursor` satu-satunya tempat `poll_cursor.cursor_ts` dimajukan. Menaruhnya di pemanggil berarti enam tempat yang harus mengingatnya, sementara poller berikutnya ditulis orang yang tidak pernah mendengar aturan ini -- dan yang lupa tidak mendapat satu pun galat. Bentuk kegagalan yang sama sudah berkali-kali dibayar (`respectsOptOut()`, `core/outboxStatus.ts`, `kunciPesanMasuk()`, `core/tujuanPemicu.ts`).

Tiga keputusan yang menempel:

- **Barisnya TETAP diproses.** Yang dibatasi cuma seberapa jauh watermarknya maju. Pendaftaran bertanggal maju tetap kunjungan sah dan pasiennya tetap dikirimi; ia hanya tidak boleh ikut menutup pintu bagi baris di belakangnya. Pemotongannya dicatat `warn` dan tidak menggagalkan siklus.
- **Boleh MUNDUR, dan itu yang membuatnya menyembuhkan alih-alih cuma mencegah.** Ketiga runner menyemai `maxTs = cursorTs`, jadi kursor yang telanjur rusak diserahkan kembali ke `advanceCursor` pada siklus berhasil berikutnya lalu ditarik ke sekarang. Menahannya di tempat berarti kerusakannya tetap berumur sehari penuh. Membaca ulang baris yang sudah diproses aman -- kunci idempoten menolaknya di mesin database.
- **Toleransi 5 menit, dan ia bukan kelonggaran yang malas.** Stempel waktunya ditulis workstation Khanza dan dibaca di sini, jadi kedua jamnya tidak pernah persis sama. Tanpa toleransi, selisih beberapa detik yang sepenuhnya normal dilaporkan sebagai anomali setiap hari -- dan peringatan yang muncul setiap hari berhenti dibaca, persis alasan level log dipisah `debug`/`warn` di `wa-client.ts`. Yang perlu ditangkap pagar ini berjarak jam, bukan detik. Nilainya mendarat di **sekarang**, bukan di batas toleransi: toleransi ada untuk memutuskan "ini anomali atau bukan", bukan untuk jadi tempat kursornya mendarat.

**`core/watermark.ts` sempat ada TANPA satu pun pemanggil**, dan itu keadaan yang lebih berbahaya daripada tidak ada sama sekali: berkas berkomentar rapi yang TAMPAK menutup lubangnya sementara `advanceCursor` tetap menulis apa adanya. Pembaca berikutnya membacanya lalu menyimpulkan masalahnya sudah selesai. Yang membuktikan pemasangannya bukan pembacaan kode melainkan panggilan `advanceCursor` sungguhan atas kunci buangan: +13 jam dipotong ke sekarang, -45 menit lewat utuh.

### Dedup pemicu pasien, dan dua cacat daur hidup worker

Tiga cacat yang ditemukan dari log produksi pada 2026-08-09, semuanya gagal DIAM.

**`saringKunciBaru()` memeriksa kunci yang TIDAK PERNAH DITULIS.** Pada `tujuan_mode = 'tujuan'`, `enqueuePemicuPasien()` hanya menulis kunci TURUNAN per alamat (`turunkanKunciTujuan`); kunci dasarnya tidak pernah masuk `outbox` sama sekali. Penyaring depan yang memeriksa kunci dasar karena itu tidak pernah menyaring apa pun, dan akibatnya berlapis: jendela pindai diproses ULANG seutuhnya tiap siklus selamanya, kuota per siklus dimakan baris yang sudah dikabarkan kemarin -- yaitu PERSIS kegagalan yang komentar "dedup dulu, kuota belakangan" ada untuk mencegah -- dan angka `baru`/`terkirim` di log menghitung pesan yang tidak pernah dibuat. Terukur: **1.043** baris `siklus surat kontrol terbit selesai` ber-`terkirim:1` sementara `outbox` berisi tepat **2** baris.

Aturan penyebarannya pindah ke **`core/tujuanPemicu.ts`** dan dipakai BERSAMA oleh yang MENULIS (`enqueuePemicuPasien`) dan yang MENYARING (`saringKunciBaruPemicuPasien`). Dua tempat yang menghitung sendiri "ke mana pemicu ini pergi" adalah sebab bug ini, dan bentuk kegagalan yang sama sudah berkali-kali dibayar (`respectsOptOut()`, `core/outboxStatus.ts`, `kunciPesanMasuk()`). Baris DIPERTAHANKAN bila MASIH ADA satu kunci yang belum tertulis, bukan hanya bila seluruhnya belum -- bedanya menggigit tepat saat staf menambah tujuan baru, karena membuang barisnya berarti grup yang baru dipasang tidak pernah menerima apa pun.

**`main().catch()` MENIMPA kode keluar `shutdown()`.** `shutdown()` memanggil `getClient().destroy()`, yang menutup Chromium DI BAWAH `initWaClient()` yang mungkin masih ditunggu `main()`; yang menyusul adalah `Protocol error (Runtime.callFunctionOn): Target closed`, ditangkap di sana, lalu `process.exit(1)`. Kode 75 (`KODE_KELUAR_DIGANTIKAN`) ada di `stop_exit_codes` supaya instance yang diminta mundur TIDAK dinyalakan ulang; kode 1 tidak. Jadi tiap pemegang yang mundur justru dilahirkan kembali, mengusir penggantinya, lalu mundur lagi -- instance baru tiap ~7,5 detik tanpa konvergen. Ini **bukan** bug yang sama dengan yang tercatat di `singleInstance.ts`: perbaikan di sana benar dan tetap berlaku, ia cuma tidak pernah sempat dipakai karena kode keluarnya ditimpa sebelum PM2 melihatnya.

**`stop_exit_codes` pernah TIDAK ADA di proses yang berjalan walau tertulis di `ecosystem.config.js` — SUDAH TIDAK begitu sejak diukur 17 Agustus 2026 (`stop_exit_codes = 75`), tapi cara mengeceknya tetap wajib diketahui.** Sebabnya aturan yang sudah tercatat: `pm2 restart` tidak membaca ulang berkas konfigurasi, jadi setiap perubahan `ecosystem.config.js` menuntut `pm2 delete` + `pm2 start ecosystem.config.js --only wakhanza-worker` dari PowerShell, lalu `pm2 save` karena PM2 di mesin ini berjalan sebagai layanan. **Periksa lewat `pm2 jlist` yang disalurkan ke berkas lalu diurai, bukan `pm2 prettylist`** — keluaran prettylist bukan JSON sah dan penguraian sembarangan atasnya melaporkan setelan yang ada sebagai tidak ada.

**`shutdown()` menutup kolam database selagi siklus masih berjalan** (`ConnectionManager.getConnection was called after the connection manager was closed!` pada loop `heartbeat` dan `poller:sisip`). `running = false` hanya menghentikan siklus BERIKUTNYA. Sekarang `tungguSiklusSelesai()` menunggu dengan anggaran 8 detik -- wajib berbatas, karena sebagian pemanggil `shutdown()` keluar JUSTRU karena ada yang menggantung.

**Denyut ditulis TANPA SYARAT.** Sebelumnya digerbangi `isWaReady()`, sehingga membeku juga saat sesi terputus padahal prosesnya sehat -- "basi" tidak bisa dibedakan dari "sesi bermasalah", dua keadaan yang menuntut tindakan berbeda. Sekarang artinya tunggal: **basi = tidak ada proses worker yang hidup**, dan `SystemStatus` membedakan ketiga keadaannya alih-alih menyuruh petugas menautkan ulang sesi saat yang mati justru prosesnya.

**JEBAKAN PENGUKURAN yang menelan satu diagnosis utuh, dan ia sudah tertulis di berkas ini sebelumnya.** `heartbeat_at` ditulis Sequelize ber-`timezone: '+00:00'` (UTC), jadi `TIMESTAMPDIFF(SECOND, heartbeat_at, NOW())` yang dijalankan lewat CLI `mysql` melebihkan umurnya tepat **25.200 detik**. Angkanya terbaca persis seperti worker yang mati tujuh jam padahal denyutnya delapan detik, dan seluruh diagnosis yang dibangun di atasnya keliru.

**Tapi koreksinya BERGANTUNG PADA KLIEN, dan versi lama kalimat ini menulis "SELALU" -- itu keliru, dan kekeliruannya menggigit persis seperti bug aslinya.** Yang menentukan bukan kolomnya melainkan `@@session.time_zone`:

| Dibaca lewat | `@@session.time_zone` | `NOW()` | Yang benar |
|---|---|---|---|
| CLI `mysql` | `SYSTEM` (WIB) | WIB | `CONVERT_TZ(heartbeat_at,'+00:00','+07:00')` |
| Sequelize | **`+00:00`** | **UTC** | `TIMESTAMPDIFF` MENTAH, tanpa CONVERT_TZ |

Sequelize menyetel zona SESINYA sendiri ke `+00:00`, jadi di sana `NOW()` ikut UTC dan kedua sisinya sudah sezona. Menerapkan `CONVERT_TZ` di jalur itu menghasilkan galat **7 jam yang sama persis, cuma dengan tanda terbalik** -- denyut 3 detik terbaca `-25.197`, yaitu worker yang seolah berdenyut tujuh jam di masa depan. Terukur: `hb_mentah 14:08:44Z`, `now_mariadb 14:08:47Z`, `umur_mentah 3`, `umur_convert -25197`. Sebelum memakai salah satunya, periksa dulu `@@session.time_zone` di jalur yang sedang dipakai.

### Alamat pengirim: `@lid`, bukan cuma `@c.us` (`core/waAddress.ts`)

Sampai suatu titik `message.from` selalu `<nomor>@c.us`, jadi penyaringnya cukup `endsWith('@c.us')` (menolak grup) dan nomornya diambil dengan `replace('@c.us','')`. WhatsApp memindahkan percakapan ke pengalamatan **LID** (`<id>@lid`) — identitas stabil per pengguna yang SENGAJA tidak memuat nomor telepon — dan sejak itu setiap pesan dari nomor yang sudah dipindahkan **dibuang di baris kedua listener**.

**Gejalanya adalah yang paling menyesatkan yang mungkin**, dan itu bagian terpenting untuk diingat: PM2 online, `wa_session` `ready`, kirim keluar normal, `autoreply.enabled` menyala, aturan kata kunci benar, `verify:db`/`verify:plans` lolos — dan `auto_reply_log` **0 baris**. Bukan karena diproses lalu gagal, tapi karena pesannya dibuang sebelum ada satu pun kode yang mencatatnya. Semua yang biasa dipakai untuk menyimpulkan "sistem sehat" menunjukkan sehat.

Tiga hal yang menempel di sini:

- **Penyaringnya daftar-IZIN (`c.us`, `lid`), bukan daftar-tolak grup.** Server baru yang belum dikenal ditolak sampai ada yang memutuskan sadar-sadar — tapi ditolak dengan `warn`, bukan diam (lihat di bawah).
- **Bagian `user` sebuah LID BUKAN nomor telepon, padahal bentuknya persis nomor**: `280925422235727` itu 15 digit, lolos pemeriksaan "8–15 digit" apa pun. Karena itu nomor HANYA diambil berdasarkan SERVER-nya (`phoneFromAddress` mengembalikan null untuk `@lid`), tidak pernah berdasarkan bentuk angkanya. Salah di titik ini berarti balasan terkirim ke nomor asing, daftar tolak tercatat atas nomor yang salah, dan kuota orang lain yang termakan — semuanya tanpa error. Dipatok unit test tersendiri.
- **Nomor E.164 wajib diperoleh sebelum apa pun dikerjakan**, karena semua yang di hilir berkunci pada nomor dan bukan pada identitas obrolan: `opt_out.phone_e164`, kuota `auto_reply_log`, dan pengiriman (`<nomor>@c.us`). Untuk `@lid`, `resolvePhoneE164()` di `wa-client.ts` mencoba tiga jalur berurutan (`kontak.id` → `kontak.number` → `WWebJS.enforceLidAndPnRetrieval`) dan **mencatat jalur mana yang berhasil**, supaya perubahan WhatsApp berikutnya memberi tahu jalur mana yang tumbang alih-alih cuma "tidak membalas". Gagal ketiganya = pesan **dilewati dengan peringatan**, bukan ditebak.

**Level log dipilih supaya peringatan tetap berarti.** Nomor WhatsApp RS menerima status/story dari SETIAP kontaknya (`@broadcast`), ditambah grup dan saluran — mencatat semuanya sebagai `warn` membuat `warn` tidak berarti apa-apa dalam sehari. Karena itu `isKnownNonIndividualAddress()` memisahkan "bukan perorangan dan itu wajar" (`debug`) dari "server belum pernah dilihat" (`warn`). Jejak amplop (`info`) hanya untuk lalu lintas perorangan — jenis, akhiran alamat, panjang teks; **tidak pernah isinya** (§9.7, alasan yang sama dengan `autoreply.log_inbound_text` yang default mati). Jejak inilah yang absen dan membuat bug ini butuh berjam-jam plus tiga pesan pasien yang hilang untuk ditemukan.

### `kunciPesanMasuk()` -- id pesan yang tidak selalu ada, dan tiga tafsir yang berbeda

`message.id._serialized` **sering hilang pada pesan grup**, dan itu bukan kelainan yang bisa diperbaiki: whatsapp-web.js mengisi `Message.id` apa adanya dari objek `MsgKey` milik WhatsApp Web (`this.id = data.id`), sementara `_serialized` di sana adalah **getter pada PROTOTYPE**. Objeknya menyeberang dari Chromium ke Node lewat serialisasi puppeteer, dan getter prototipe tidak ikut menyeberang -- jadi ada-tidaknya bergantung pada jalur mana yang kebetulan dipakai untuk pesan itu.

Dua jalur lama (`inboundLog.ts`, `wa-client.ts`) sudah memakai cadangan `from:timestamp` sejak awal justru karena ini. Jalur balasan stok grup yang ditambahkan belakangan adalah **satu-satunya yang memperlakukannya sebagai fatal lalu diam** -- sehingga tidak satu pun pertanyaan dari grup pernah dijawab, tanpa satu pun galat di mana pun. Yang terlihat di dashboard: `inbound_message` terisi normal (pencatatannya memakai cadangan), `outbox` kosong, sistem tampak sehat.

Bentuk kegagalannya sama persis dengan yang sudah dibayar di `respectsOptOut()` dan `core/outboxStatus.ts`: **tiga tempat berjauhan menafsirkan sendiri satu hal yang sama, dan cukup satu yang berbeda untuk membuat satu jalur diam-diam berperilaku lain.** Karena itu perbaikannya bukan menyalin cadangan ke tempat ketiga melainkan satu fungsi di `core/waAddress.ts` yang dipakai ketiganya.

Tabrakan cadangannya -- dua pesan BERBEDA dari obrolan yang sama pada detik yang sama -- gagal ke arah yang aman: satu pesan tidak dijawab, bukan satu pesan dijawab dua kali. Untuk keperluan sebenarnya (pesan yang SAMA diserahkan ulang sesudah sesi dipulihkan) kuncinya tetap stabil.

### Tiga tabel template yang sengaja TIDAK digabung

`template` (PK `trigger_code`, **satu baris per pemicu** -- jumlahnya sengaja TIDAK dicatat di sini, angkanya sudah dua kali basi; hitung dari `INSERT INTO template` di `migrations/`) dipilih **otomatis oleh worker** lewat `Template.findByPk(triggerCode)` saat pemicunya terdeteksi di `sik` -- staf tidak pernah memilihnya. Jumlahnya bertambah hanya saat ada PEMICU baru, tidak pernah seiring pemakaian; itu yang membuatnya tetap tidak perlu paginasi. `broadcast_template` (PK `id` auto-increment, sebanyak yang staf mau, `migrations/008`) dipilih **manual** dari dropdown di `/broadcast` dan `/broadcast-terjadwal`. Keduanya dikelola di halaman `/template` yang sama tapi di dua bagian berlabel jelas. `auto_reply_rule` (`migrations/010`) dipilih **oleh kata kunci pada pesan pasien**, dikelola di `/balasan-otomatis` -- bukan di `/template`, karena yang disunting bukan cuma teksnya melainkan juga kapan ia terpakai.

Menggabungkannya akan memaksa `trigger_code` palsu untuk baris broadcast, dan membuat `findByPk()` milik worker bisa tidak sengaja mengambil pesan broadcast.

**Tiap baris pemicu menyebut TABEL Khanza asalnya, dan daftarnya dijaga oleh migrasinya sendiri** (`TRIGGER_SOURCE` di `components/ui/labels.ts`). Sampai ini ada, "pemicu ini berangkat dari mana" hanya terjawab dengan membuka `src/khanza/` -- pertanyaan yang justru paling sering datang dari orang yang tidak menyentuh kode: staf yang ingin tahu kenapa pesannya belum keluar, dan IT RS yang ingin memastikan sistem ini tidak menulis apa-apa. Sekarang tiap baris di `/template` membawa nama tabelnya (mis. `reg_periksa`, `nota_jalan + nota_inap`) berikut satu kalimat kapan ia berbunyi. Empat hal yang menempel:

- **Ditaruh berdampingan dengan `TRIGGER_LABEL`, bukan di berkas sendiri.** Keduanya keterangan STATIS berkunci kode pemicu; berjauhan berarti pemicu berikutnya punya dua tempat yang harus diingat, dan yang lupa diisi **tidak menghasilkan satu pun galat** -- cuma baris tabel yang diam-diam kehilangan keterangannya.
- **Daftar acuannya DIURAI DARI `migrations/*.sql`, bukan disalin jadi daftar ketiga.** `labels.test.ts` membaca tiap `INSERT INTO template` -- bentuk `VALUES` maupun `INSERT ... SELECT` -- **dan juga `DELETE FROM template`, dalam urutan berkasnya**, lalu menuntut daftarnya MEMBAGI HABIS: pemicu tanpa keterangan gagal, dan keterangan untuk pemicu yang bukan baris `template` juga gagal. Kedua arah dibuktikan menggigit, bukan diasumsikan. Migrasi adalah satu-satunya sumber kebenaran soal baris mana yang benar-benar ada, dan ia berkas -- jadi ujinya tetap tidak butuh database.
- **Hanya baris `template`.** `FARMASI_*`, `BPJS_*`, `ADMINISTRASI`, `SURAT_SAKIT` punya halamannya sendiri berikut keterangannya sendiri di sana; mencantumkannya di sini menjanjikan baris yang tidak pernah muncul di halaman Template.
- **`catatan` hanya di modal, tidak di tabel.** Ia bahan baca-sekali (mis. akhiran `_bpjs` pada `skdp_bpjs` yang menyesatkan, atau kenapa panel darah lengkap tetap satu pesan); mengulangnya di sebelas baris menenggelamkan kolom yang lain. `tabel` + `kapan` yang menempel pada nama pemicunya, **bukan jadi kolom keenam** -- kolom keenam tersembunyi di bawah `xl` persis seperti yang terjadi pada centang tujuan di `/farmasi`, sehingga keterangan yang sengaja ditambahkan berakhir tak pernah terlihat.

**Variabel divalidasi per konteks, dengan satu renderer.** `core/template.ts` punya tiga daftar: `TRIGGER_TEMPLATE_VARIABLES` (default `findUnknownVariables`), `BROADCAST_TEMPLATE_VARIABLES`, `AUTOREPLY_TEMPLATE_VARIABLES`. **Jumlah masing-masing sengaja TIDAK ditulis di sini** -- angka "11/5/8" yang dulu ada di kalimat ini sudah basi dua kali (`migrations/032`/`033` menambah tiga variabel pemicu, lalu broadcast melebar), dan angka di dalam prosa adalah angka yang cepat atau lambat berbohong; hitung dari berkasnya. `KNOWN_TEMPLATE_VARIABLES` sekarang gabungan ketiganya -- itu yang DIMENGERTI `renderTemplate`, bukan yang BOLEH dipakai di satu tempat. Semua ditolak SAAT DISIMPAN, bukan saat kirim. Balasan otomatis sengaja **tidak** punya `{nama_pasien}`/`{no_rm}`: pemicunya nomor yang mengirim WhatsApp, yang belum tentu pasien terdaftar mana pun, dan nomor bisa berpindah tangan.

**Template broadcast DISALIN, bukan diacu.** Memilih template mengisi kotak teks; `broadcast_campaign.message_body` dan `broadcast_schedule.message_body` menyimpan salinannya sendiri. Tidak ada foreign key ke `broadcast_template`, jadi menyunting atau menghapus template TIDAK mengubah jadwal yang sedang berjalan maupun pesan yang sudah terkirim -- template murni alat bantu penyusunan. Itu sebabnya `deleteBroadcastTemplateAction` aman tanpa pemeriksaan "sedang dipakai jadwal mana".

`broadcast_template` butuh grant `UPDATE`/`DELETE` per-tabel (sunting/hapus staf), sama seperti `broadcast_schedule` -- dan sekali lagi terbukti tidak diwarisi: `INSERT` lolos lewat grant skema-lebar, `UPDATE` ditolak `ERROR 1142` sampai grant eksplisitnya diterapkan lewat root.

### Berhenti berlangganan: frasanya, dan CAKUPANNYA yang sengaja sempit

`core/optOut.ts` memegang dua hal sekaligus, dan sengaja satu berkas karena keduanya menyusun **satu janji** ke pasien yang tidak boleh terpecah dua tempat: frasa yang dikenali, dan daftar pemicu yang tunduk padanya.

**Frasanya `"Berhenti Kirim Otomatis"`**, menggantikan `stop`/`berhenti`/`unsubscribe`. Tiga kata, bukan satu -- dan justru karena panjang, ia boleh dicocokkan sebagai BAGIAN dari kalimat alih-alih harus sama persis dengan seluruh pesan. Pola lama `^(stop|berhenti)$` terpaksa ketat karena satu kata seperti "berhenti" gampang muncul di kalimat biasa; akibatnya `"stop dong"` dan `"saya mau berhenti"` TIDAK berhenti padahal maksud pasiennya jelas. Frasa sepanjang ini praktis mustahil terketik tanpa sengaja, jadi pencocokan yang lebih longgar justru lebih aman **sekaligus** lebih memaafkan. Konsekuensi yang harus disadari: **`STOP` polos tidak lagi memberhentikan apa pun** -- ia jatuh ke pencocokan balasan otomatis seperti pesan biasa.

**Hanya pemicu otomatis KE PASIEN yang terikat** (`OPT_OUT_TRIGGERS`): QUEUE_REG, BOOK_CONFIRM, BOOK_CANCEL, BOOK_REMIND, LAB_RESULT, RAD_RESULT, PHARMACY_READY, BILLING_READY, BPJS_KONTROL, KONTROL_ULANG, KONTROL_TERBIT, LAB_REQUEST, RAD_REQUEST, SURAT_SAKIT -- ditambah `RESULT_READY` sebagai **peninggalan**, karena baris `outbox` yang terlanjur mengantre dengan kode lama itu tetap harus tercoret saat pasiennya meminta berhenti. Jumlahnya sengaja tidak ditulis di sini; ia bertambah tiap ada pemicu pasien baru, dan angka di dalam prosa adalah angka yang cepat atau lambat basi. **BROADCAST dan AUTO_REPLY sengaja TIDAK** -- keputusan rumah sakit, bukan default teknis:

- BROADCAST/broadcast terjadwal = pengumuman yang disusun staf, kanal berbeda dari notifikasi kunjungan.
- AUTO_REPLY = jawaban atas pesan yang pasiennya sendiri kirim barusan. Mendiamkan orang yang baru saja bertanya bukan menghormati permintaannya, melainkan membuat sistem tampak rusak.

`respectsOptOut()` adalah SATU-SATUNYA sumber kebenarannya, dipakai di tiga tempat: `enqueueMessage()`, dispatcher (pemeriksaan kedua sebelum kirim), dan pencoretan antrean saat permintaan berhenti masuk. Kalau ketiganya menafsirkan sendiri-sendiri, cukup satu yang lupa diperbarui untuk membocorkan pesan ke pasien yang sudah minta berhenti. Kode pemicu yang tidak terdaftar dianggap **tidak terikat** -- pemicu baru harus didaftarkan secara sadar, karena default "terikat" akan membuat kanal baru diam-diam berhenti terkirim tanpa ada yang memutuskan.

**Pencoretan antrean saat opt-out masuk WAJIB menyertakan `triggerCode`.** Tanpa itu, broadcast dan balasan otomatis yang kebetulan sedang mengantre untuk nomor itu ikut tercoret -- membuat cakupannya bergantung pada kebetulan waktu: yang telanjur mengantre hilang, yang belum tetap terkirim.

**Teks yang dibaca pasien tidak boleh menjanjikan lebih luas dari yang dijalankan mesin -- maupun lebih sempit.** `OPT_OUT_CONFIRMATION` menyebut "pengingat kontrol" tanpa kata BPJS sejak `migrations/032`, karena sejak itu ADA DUA pemicu pengingat kontrol yang terikat: menyebut salah satunya membuat pasien non-BPJS wajar menyimpulkan pengingatnya tidak ikut berhenti, lalu mengeluh justru saat sistemnya bekerja benar. Tiga tempat ikut berubah dan harus tetap sinkron: teks konfirmasi (`OPT_OUT_CONFIRMATION` di `wa-client.ts`, menyebut eksplisit apa yang berhenti DAN apa yang tetap datang), isi ketujuh template (`migrations/011` mengganti "Balas STOP..." lewat `REPLACE()` agar suntingan staf tidak hilang), dan deskripsi halaman `/daftar-tolak` yang dulu berbunyi "seluruh pengiriman berikutnya dilewati" -- kalimat yang kini keliru.

### `inbound_message` memuat DUA arah, dan setiap pembacanya wajib menyaring

Sisi keluar sebuah percakapan dulu dibaca dari `outbox` saja, dan itu benar hanya selama pesan keluar lahir di sini. Ternyata tidak: yang benar-benar dipakai rumah sakit ini adalah membalas dari aplikasi WhatsApp di ponsel nomor RS, dan pesan itu tidak pernah melewati antrean kirim. Terukur 17 Agustus 2026 dan angkanya membalik dugaan — `outbox.trigger_code = 'BALAS_MANUAL'` (tombol balas di dashboard) **nol baris selamanya**, sementara log worker membuang **19 pesan keluar manusia dalam 4 hari**. Halaman percakapan karena itu menampilkan pertanyaan pasien berderet tanpa satu pun jawaban, padahal jawabannya sudah diberikan.

Sejak `migrations/052` balasan itu ikut tercatat di `inbound_message` lewat kolom **`arah ENUM('masuk','keluar')`**. Alasan ia menumpang tabel ini alih-alih tabel sendiri ada di `FITUR.md`; yang MENGIKAT kode tiga hal:

- **Setiap kueri yang berarti "pesan masuk" wajib menyaring `arah: 'masuk'`.** Bawaannya `'masuk'` supaya baris lama tidak berubah arti — dan itu juga berarti kueri yang lupa menyaring tidak mendapat satu pun galat, cuma diam-diam menghitung balasan kita sendiri sebagai pertanyaan pasien. Dua tempat yang paling menggigit: saringan "Belum dibalas" di `/pesan-masuk` (baris keluar selalu `dibalas = 0`, jadi tiap balasan petugas muncul sebagai pertanyaan yang menunggu jawaban) dan usulan kata kunci di `/balasan-otomatis` (kata-kata kita sendiri diusulkan sebagai kata kunci pasien). Satu-satunya kueri yang SENGAJA tidak menyaring adalah penghitung baris kedaluwarsa — pemangkasannya memang menghapus kedua arah.
- **Yang dicatat HANYA `sebab: 'tanpa-kandidat'` dari `pilihBarisTertaut()`**, dan keputusannya tinggal di `core/tautPesanKeluar.ts`'s `layakCatatSebagaiBalasanManual()`. `tak-cocok`/`ambigu` berarti barisnya ADA di `outbox` — pesannya buatan mesin dan sudah tampil di sisi keluar; mencatatnya lagi menggandakan gelembungnya. Pagar ketiganya menyentuh database jadi tinggal di `catatPesanKeluarManual()`: isi yang sama diperiksa sekali lagi terhadap SELURUH `outbox` tanpa batas waktu, karena pesan yang tertahan jam tenang semalaman berangkat jauh di luar jendela penautan 30 menit dan tanpa itu akan terbaca sebagai ketikan manusia.
- **`gabungPercakapan()` menerima arah DI DALAM barisnya, bukan lewat larik ketiga.** Bentuk `gabungPercakapan(masuk, keluar, manual)` membuat pemanggil yang lupa mengisi larik ketiga tetap lolos `tsc` dan tetap menampilkan percakapan sebelah — persis cacat yang sedang diperbaiki. Awalan kunci mengikuti TABEL asalnya (`cat-`/`out-`), bukan arahnya, karena tabel itulah yang menjamin id-nya unik.

`inbox.simpan_teks` dan `inbox.simpan_hari` berlaku apa adanya untuk kedua arah — balasan petugas kepada pasien sama sensitifnya dengan pertanyaan pasien.

### Privasi ditegakkan lewat kolom yang tidak pernah diambil
Query di `src/khanza/` tidak men-`SELECT` kolom sensitif sama sekali (nama pemeriksaan lab dari `jns_perawatan_lab`, nama obat, hasil, diagnosis) — bukan mengambil lalu menyaring saat render. `core/privacy.ts`'s `checkPrivacy()` menerima `kdJenisPrw` sebagai **kode** (bukan nama) dan bisa berupa larik (RESULT_READY yang digabung per kunjungan bisa punya beberapa kode sekaligus -- satu kode sensitif saja cukup membuat seluruh pesan diganti generik). Lihat ARCHITECTURE §5.2 dan PRD §F4 sebelum menambah variabel template baru atau mengambil kolom baru dari `sik`.

### Substitusi template wajib satu lintasan
`nm_pasien`, `nm_poli`, `nm_dokter` berasal dari input bebas petugas pendaftaran di Khanza. Substitusi `{variabel}` di `core/template.ts` **harus** satu lintasan kiri-ke-kanan, tidak boleh diulang sampai stabil — pasien bernama `{kontak_rs}` tidak boleh membuat nomor telepon RS muncul di posisi namanya sendiri (diuji unit di `template.test.ts`). Variabel tak dikenal ditolak SAAT TEMPLATE DISIMPAN (`src/app/(dashboard)/template/actions.ts`), bukan saat kirim.

### Paginasi: satu penurunan, `src/core/pagination.ts`

Komponen `Pagination` sudah dipakai bersama sejak Fase 3 -- tapi itu TAMPILANNYA saja. Penurunan angkanya (baca `?page`, hitung offset, hitung total halaman) disalin di tiap halaman dengan tiga nama konstanta berbeda (`PAGE_SIZE`, `JUMLAH_PER_HALAMAN`, `PER_HALAMAN`) dan **dua tafsir yang berbeda** -- bentuk kegagalan yang sama persis dengan `respectsOptOut()`, `core/outboxStatus.ts`, dan `kunciPesanMasuk()`: beberapa tempat berjauhan menafsirkan sendiri satu hal yang sama, dan cukup satu yang berbeda untuk membuat satu halaman diam-diam berperilaku lain.

**Tiga cacat yang lahir dari selisih itu, ketiganya tanpa satu pun galat:**

- **Nomor halaman tak berbatas ATAS.** `/audit`, `/log`, `/antrean` memakai `Math.max(1, Number(pageParam) || 1)` tanpa `Math.min`; hanya `/nomor-bermasalah` menjepit. `?page=999` menampilkan tabel kosong berikut tombol "Sebelumnya" menuju 998 -- juga kosong. Tidak ada jalan kembali selain menyunting URL sendiri, dan yang terlihat di layar persis sama dengan "memang tidak ada datanya".
- **`/daftar-tolak` memotong pada `limit: 200` tanpa kendali apa pun.** Nomor ke-201 tidak pernah bisa dilihat, tanpa galat dan tanpa keterangan. Mesin tetap menghormatinya (`respectsOptOut()` membaca database, bukan halaman), tapi petugas yang mencarinya untuk MENGHAPUS tidak akan pernah menemukannya.
- **`/pesan-masuk` memotong pada 100.** Ia memang menampilkan "Menampilkan 100 terbaru dari N", tapi tidak menyediakan satu pun cara menjangkau sisanya -- keterangan yang menyebut masalahnya lalu berhenti di situ.
- **`/administrasi` memotong pada 200, dan itu yang paling dekat menggigit.** Kedua tabnya memakai `LIMIT 200` mati di `khanza/suratPasien.ts` tanpa `?page` sama sekali; peringatannya berbentuk sama dengan `/pesan-masuk` -- menyebut masalahnya lalu menyuruh mempersempit rentang. **Terukur, dan angkanya membalik dugaan**: tab Surat SAKIT cuma **1 baris dalam 365 hari** (paginasi di sana upacara kosong), sementara tab Surat SEHAT menghasilkan **197 baris pada rentang BAWAAN 7 hari** -- tiga baris di bawah tutupnya, jadi satu minggu agak ramai memotongnya diam-diam; pada 30 hari **727 baris, 73% tak pernah bisa dilihat**. Sekarang berpaginasi lewat `core/pagination.ts` yang sama.

  **Yang membuat perbaikannya tidak sepele: COUNT-nya TIDAK boleh `COUNT(*) FROM suratsakit`.** `IDENTITAS_JOIN` dibuka `JOIN reg_periksa` -- INNER, bukan LEFT -- jadi surat yang kunjungannya sudah tidak ada dibuang daftarnya sementara COUNT polos tetap menghitungnya. Yang muncul bukan galat melainkan "Halaman 1 dari 5" pada daftar yang halaman kelimanya kosong. Karena itu kedua bentuk lahir dari SATU fragmen bersama (`SAKIT_FROM_JOIN`, `SEHAT_FROM_WHERE`) alih-alih dua SQL berdampingan -- bentuk kegagalan yang sama yang sudah dibayar di `respectsOptOut()` dan `core/tujuanPemicu.ts`. Dibuktikan dengan menelusuri SELURUH 15 halaman: COUNT 727 == 727 kunci unik terkumpul, nol tumpang tindih, `?page=999` dijepit ke halaman 15 berisi 27 baris.

  **Penghitungnya didaftarkan TERPISAH di `verify:plans`, dan itu bukan pemeriksaan kembar** -- membuang daftar SELECT mengubah apa yang boleh dipilih optimizer. Terukur pada `ADMINISTRASI_SURAT_SEHAT_JUMLAH`: `sks` jadi `ref no_rawat (Using index)` sementara daftarnya tetap `ALL`. Karena itu izin `allowFullScan: ['sks']` **sengaja TIDAK disalin** ke penghitungnya: izin pindai penuh yang menganggur adalah izin yang diam-diam menutupi kemunduran berikutnya.

**DUA fungsi, bukan satu, dan itu bukan selera.** Menjepit halaman ke `totalHalaman` menuntut `count` sudah diketahui, sementara query barisnya menuntut `offset` sudah diketahui. Karena itu `bacaHalaman(param)` -> `count` -> `hitungPaginasi(diminta, jumlah, ukuran)` -> `findAll({ limit, offset })`. Tetap dua query, persis seperti `findAndCountAll` yang digantikannya; yang berubah cuma urutannya, dan itu yang membuat jepitannya mungkin. `/nomor-bermasalah` menyerahkan jumlahnya dari GROUP BY yang sudah ada alih-alih COUNT tersendiri -- `hitungPaginasi` menerima angka dari mana saja, jadi penghematan itu tidak hilang saat ikut pola bersama.

**Ukuran dinamai menurut JENIS daftarnya** (`UKURAN_HALAMAN.riwayat` 50, `.konfigurasi` 25), bukan angka telanjang di tiap halaman: `25` di dalam berkas halaman tidak memberi tahu siapa pun kenapa ia bukan 50. Barisnya pun memang beda bentuk -- baris konfigurasi memuat tombol aksi dan teks berbaris-baris.

**`hrefHalaman()` punya dua hal yang gampang dikira hiasan:**

- **Larik dipertahankan sebagai kunci berulang** (`?kab=A&kab=B`), bukan digabung berkoma. Di `/broadcast-terjadwal` akibatnya lebih dari sekadar saringan hilang: query string yang sama juga mengisi form "Buat jadwal baru", jadi menekan Berikutnya akan mengosongkan form yang sedang disusun staf.
- **Nama parameternya bisa diganti** (`namaParam`, default `page`). Aturan "`page` ditulis terakhir supaya menang" benar untuk satu tabel per halaman dan **diam-diam salah** begitu ada dua: `/pesan-masuk` memuat tabel pesan (`page`) DAN tabel grup (`gpage`), masing-masing membawa halaman tabel satunya. Satu nama bersama membuat tombol di satu tabel ikut menggeser tabel satunya, dan yang terlihat petugas adalah baris yang hilang tanpa sebab.

**Yang SENGAJA tidak dipaginasi, dan alasannya harus dibaca sebelum "menyeragamkannya":** tabel `template` (satu baris per pemicu, PK-nya `trigger_code` -- bertambah hanya saat ada pemicu BARU, tidak pernah seiring pemakaian, jadi kendali halamannya tidak akan pernah bisa berpindah. Dulu tertulis "tepat tujuh baris selamanya", dan `migrations/025` membuktikan kata "selamanya" itu keliru: yang benar sejak awal adalah satu per pemicu); `WaGroup.findAll()` di `/farmasi` dan `/template` (mengisi DROPDOWN pemilih grup, bukan tabel -- daftar pilihan terpotong menyembunyikan grup tanpa satu pun tanda, dan staf menyimpulkan grupnya belum tersinkron); `TemplateTarget.findAll()` di `/template` (mengisi modal Tujuan per pemicu); dan `hitungAdminAktif()` yang **wajib** menghitung seluruh tabel -- ia menyalakan peringatan "tinggal satu admin" DAN jadi masukan pagar `core/userPolicy.ts`, jadi mempersempitnya ke satu halaman bisa membuat pagarnya menolak penonaktifan yang sah.

**Satu jebakan verifikasi yang hampir menipu, dan ia bentuknya persis seperti jebakan `trustHost`:** percobaan pertama menjalankan `npm start` sementara PM2 `wakhanza-web` sudah memegang port 3100. `next start` mati dengan `EADDRINUSE`, `curl` tetap menjawab 200 dari proses PM2, dan seluruh uji berjalan melawan **build LAMA** -- 29 "kegagalan" atas kode yang sebenarnya benar. Sejak itu skrip ujinya memeriksa lebih dulu bahwa halaman yang fiturnya BARU memang punya penandanya, lalu `exit 2` bila tidak. Perlu diketahui juga: `.next` di disk sudah build baru sementara proses PM2 masih memegang kode lama di memori -- `pm2 restart wakhanza-web` diperlukan supaya dashboard yang dipakai petugas ikut berubah.

**Verifikasi HTTP dijalankan lewat instance PM2 yang SUDAH ADA, bukan `next start` di port sendiri.** Nasihat sebelumnya di tempat ini berbunyi kebalikannya ("jalankan di port sendiri, jangan berebut dengan PM2"), dan itu **dicabut atas permintaan pemilik sistem** dengan alasan yang mengalahkan alasan aslinya: instalasi ini berjalan di atas **database produksi**, jadi instance PM2 itulah lingkungan yang sesungguhnya -- server uji terpisah membuktikan sesuatu yang tidak dipakai siapa pun. Urutannya `npm run build` lalu `pm2 restart wakhanza-web`, dan diuji lewat port 3100.

Nasihat lama itu juga terbukti melahirkan bentuk barunya sendiri dari jebakan yang justru ia maksudkan untuk dicegah: `pkill -f "next start -p 3197"` TIDAK mematikan servernya (npx melahirkan proses anak dengan baris perintah lain), port tetap dipegang proses lama, dan seluruh uji berikutnya berjalan melawan build lama -- tanpa satu pun galat, dan dengan seluruh asersi lain tetap hijau karena yang berubah cuma satu kalimat. Yang membocorkannya cuma `Get-Process -Id <pid> | Select StartTime`. **Kalau toh terpaksa memakai port sendiri, matikan lewat PID dan buktikan portnya KOSONG sebelum start -- `pkill` atas baris perintah `npx` tidak cukup.**

**Perubahan yang tidak bisa dibuktikan tanpa login, dibuktikan lewat `.next`, bukan lewat akun uji.** `grep -rl "<penanda>" .next/server` menjawab "apakah build ini memuat perubahannya" tanpa menyentuh `app_user` sama sekali. Membuat akun admin sementara untuk uji peramban bisa dilakukan lewat `npm run users` dan memang reversibel, tapi ia menambah akun berhak penuh ke sistem yang memegang data pasien -- tempuh hanya bila yang diuji memang perilaku sesudah login, dan hapus di alur yang sama.

### Design system dashboard -- `src/components/ui/`
Semua halaman `(dashboard)/**` dan `/login` memakai primitif dari `src/components/ui/` (barrel export lewat `index.ts`) alih-alih menulis ulang class Tailwind mentah per halaman: `Button`/`LinkButton` (varian `primary`/`secondary`/`destructive`/`ghost`, ukuran `xs`/`sm`/`md`), `Input`/`Textarea`/`Select` (prop `fieldSize`, BUKAN `size` -- `size` sudah jadi atribut HTML asli di `<select>`), `Card` (+ `cardClassName` string untuk kasus elemen bukan `<div>`, mis. `<form>`), `Badge` (+ `outboxStatusVariant()` untuk status `Outbox`), `PageHeader`, `FilterChip`, `CheckboxList` (pengganti `<select multiple>` asli -- checklist + "pilih semua" + pencarian-jika->8 opsi, dipakai filter wilayah/cara-bayar di `/broadcast` dan `/broadcast-terjadwal`), `EmptyState` (opsional `icon`/`title`/`action` -- bentuk lama `<EmptyState>teks</EmptyState>` tetap berlaku), `Section` (judul + jarak vertikal bertingkat `rapat`/`normal`/`longgar`), `HelpPanel`/`HelpSection` (laci bantuan, satu pintu per halaman -- lihat "Design system: token DIUKUR" di `FITUR.md`), `Tabs` (tab berbasis URL; `<nav>` + `aria-current`, **bukan** `role="tablist"` -- kontrak ARIA untuk tab menjanjikan panel bertukar TANPA navigasi plus panah kiri/kanan; ini tautan yang benar-benar bernavigasi, jadi menandainya `tablist` berarti menjanjikan perilaku yang tidak ada kepada orang yang paling bergantung pada janji itu) dan `Callout` (kotak keterangan berjudul, opsional dilipat lewat `<details>` asli), `StatCard` (kotak KPI + sparkline), `Pagination`, `Skeleton`/`SkeletonTable`, `icons.tsx` (~20 ikon garis 24-grid, digambar sendiri alih-alih menambah paket ikon yang menarik ribuan modul ke bundel klien), dan class helper tabel (`tableWrapperClass`/`theadClass`/`rowClass`/`cellClass`). `WindowModeFields` (`/broadcast-terjadwal`) menerima daftar preset lewat **prop**, bukan mengimpor `./filters` -- modul itu menarik `khanza/*` yang berujung ke koneksi database dan tidak boleh masuk bundel klien.

**Istilah mesin tidak pernah sampai ke mata petugas** (`src/components/ui/labels.ts`). `skipped_no_contact`, `failed_permanent`, `QUEUE_REG`, `qr_pending` adalah kunci enum dan kode pemicu -- bentuk yang benar untuk database, log, dan kunci idempoten, tapi bukan untuk petugas pendaftaran. Semua tampilan memakai `outboxStatusLabel()`/`triggerLabel()`/`waStatusLabel()`, dan kode aslinya TETAP tersedia berdampingan (atribut `title`, atau teks mono kecil di halaman Koneksi) supaya tiket dukungan dan baris log masih bisa dicocokkan. Label statusnya murni presentasi -- tidak satu pun dipakai untuk perbandingan, penyaringan, atau disimpan; `href` filter tetap memakai kode mesin. `TRIGGER_LABEL` sengaja statis, bukan join ke `template.label`: halaman Antrean/Log memuat ribuan baris (satu join per halaman tanpa manfaat) dan `BROADCAST` memang tidak punya baris `template`.

**Aturan yang sama berlaku untuk SATUAN: milidetik disimpan, detik ditampilkan** (`src/core/duration.ts`). Milidetik benar untuk mesin -- `send_log.duration_ms` diisi `Date.now() - startedAt`, `polling.interval_ms` diserahkan apa adanya ke `setTimeout` -- tapi "300000" tidak memberi tahu siapa pun bahwa itu lima menit. Konversinya ada di BATAS TAMPILAN saja: kunci `app_setting` tetap `*_ms`, isinya tetap milidetik, `getSettingNumber()` di worker tidak berubah sama sekali. Tiga hal yang menempel di sini:

- **Konversi HANYA di dua titik**: saat isi form Pengaturan disiapkan, dan saat dikirim balik (`petakan()` di `PengaturanClient.tsx`, kunci ditandai `storedAsMs: true`). **Jangan** mengonversi di dalam `onChange` -- staf yang mengetik "1,5" kehilangan komanya begitu "1," dibolak-balik jadi angka di tiap ketukan.
- **Keduanya wajib persis kebalikan satu sama lain**, dan itu bukan kerapian melainkan syarat kebenaran: form Pengaturan mengirim ULANG seluruh kunci saat Simpan ditekan, termasuk yang tidak disentuh. Konversi yang meleset sedikit akan menggeser nilai hanya karena halaman dibuka lalu disimpan. Karena itu nilai yang BUKAN angka (kosong, teks, negatif) diteruskan apa adanya, tidak dijadikan `0`/`NaN`. Diuji `duration.test.ts` ("bolak-balik tanpa berubah") DAN dibuktikan lewat browser: dua kali Simpan tanpa menyentuh apa pun, keempat nilai tetap `60000/300000/3000/8000`.
- **Mengetik menerima koma maupun titik**, menampilkan koma (id-ID). Menolak salah satunya hanya menghasilkan nilai tersimpan yang salah tanpa satu pun pesan galat.

Di halaman Log, `formatDurationSeconds()` memakai satu desimal di bawah 10 detik dan bilangan bulat di atasnya ("12,3 s" tidak menambah apa pun atas "12 s"), dan yang lebih cepat dari satu desimal terkecil ditulis `<0,1 s` -- bukan dibulatkan jadi `0,0 s`, yang terbaca seperti nol atau gagal. Nilai milidetiknya tetap ada di atribut `title`, sama seperti kode pemicu.

**Kerangka halaman `src/components/AppShell.tsx`** (menggantikan `SidebarNav.tsx` yang dihapus). Sidebar tetap di `lg:` ke atas; di bawah itu jadi bilah atas + laci yang menutup layar, karena sidebar `w-56` tetap memakan setengah lebar tablet. Tiga hal yang gampang dirusak tanpa sadar saat menyentuhnya:

- Laci tertutup memakai `invisible`, BUKAN sekadar `-translate-x-full`. Elemen yang hanya digeser keluar layar tetap bisa dijangkau Tab, sehingga fokus keyboard bisa "hilang" ke menu tak terlihat.
- Laci ditutup saat pindah halaman lewat **penyesuaian state saat render** (`if (pathname !== lastPath)`), bukan `useEffect(() => setOpen(false), [pathname])`. Yang kedua memicu render berantai dan ditolak aturan lint `react-hooks/set-state-in-effect`; ia juga tidak menangani tombol maju/mundur peramban kalau diganti `onClick` per tautan.
- Ikon menu dikirim dari layout sebagai **kunci string**, bukan elemen React. Layout adalah Server Component; mengirim elemen ikon lintas batas server-klien ikut mengirim penanda komponennya di payload RSC untuk tiap menu.

`main` di AppShell wajib `min-w-0`: tanpa itu tabel dengan `overflow-x-auto` memaksa flex item melebar dan SELURUH halaman ikut bergeser ke samping.

**Kenapa lewat props varian, bukan `className` untuk menimpa warna/padding/ukuran**: dua utility Tailwind untuk properti CSS yang SAMA (mis. `rounded-md` bawaan komponen ditimpa `rounded-full` lewat `className`) menang berdasarkan urutan Tailwind MENGHASILKAN CSS-nya (urutan di config/scale), bukan urutan kemunculan di string `className` -- override lewat `className` bisa diam-diam KALAH. Karena itu Button/Input/Textarea/Select/Badge menerima varian sebagai prop terpisah (`variant`, `size`/`fieldSize`) yang tidak pernah tumpang tindih dengan apa pun yang boleh dikirim lewat `className` (lebar, margin, dsb. saja). Jangan tambah `px-*`/`py-*`/`text-*`/`bg-*`/`rounded-*` lewat `className` ke komponen ini -- kalau ukuran/warna yang ada tidak cukup, tambah varian baru di komponennya, jangan ditimpa dari luar.

Token warna (`src/app/globals.css`'s `:root`/`.dark`, dipetakan di `tailwind.config.ts`): `background`, `foreground`, `primary`, `muted`, `destructive`, `card` (permukaan panel, sedikit lebih terang dari `background` di mode gelap supaya card terlihat "terangkat"), `ring` (fokus), `success`/`warning` (status selain bahaya -- dulu dihardcode `green-600`/`amber-500` di `Badge`, melanggar aturan di bawah), `chart-sent`/`chart-failed` (lihat "Halaman Ringkasan" di `FITUR.md` -- nilainya divalidasi buta warna lewat skrip, jangan diubah tanpa menjalankan ulang validasinya). Tambah token warna baru di SINI (dua tempat: `:root` dan `.dark`), jangan hardcode `dark:bg-slate-800` dsb. langsung di komponen halaman kecuali kasus yang MEMANG sengaja tidak ikut tema (contoh: QR code di `KoneksiClient.tsx` tetap `bg-white` di kedua tema karena butuh kontras penuh untuk bisa dipindai -- ada komentar di kode yang menjelaskan ini).

## Keputusan yang dulu terbuka, sudah diputuskan saat implementasi

- **`core/phone.ts`**: diimplementasikan **ketat** -- persis 7 langkah ARCHITECTURE §5.1, tanpa heuristik tambahan. Diverifikasi terhadap seluruh 8.117 baris `sik.pasien` nyata: 59,5% langsung valid (melampaui baseline 45% di PRD), sisanya masuk `patient_contact` dengan alasan penolakan untuk dikoreksi manual lewat dashboard.

### `npm run scan:contacts` -- kenapa pemindaian awal perlu ada terpisah

`worker/contactResolver.ts` menulis satu baris `patient_contact` hanya SAAT sebuah pemicu sudah melewati pasien itu. Konsekuensinya luput cukup lama: di hari pertama produksi halaman `/nomor-bermasalah` kosong, lalu terisi seorang demi seorang **sesudah** tiap pasien gagal dikirimi. Nomor yang tidak terpakai baru ketahuan setelah pesannya telanjur hilang -- padahal daftarnya bisa diketahui seluruhnya di muka. `scripts/scan-contacts.ts` membaca `sik.pasien` sekali jalan (SELECT saja, keyset pagination lewat PK + jeda antar batch supaya tidak berebut koneksi dengan SIMRS) dan mengisi semuanya. **Baris `source='manual'` tidak pernah ditimpa** -- koreksi petugas mengalahkan normalisasi otomatis (F2.1-F2.3), dan skrip ini tidak boleh membatalkan pekerjaan orang. Aman dijalankan berulang; punya `--dry-run`.

Hasil nyata di database ini: 8.118 pasien, 4.834 (59,5%) terpakai -- **angka yang sama persis dengan verifikasi `core/phone.ts` dulu**, jadi sekalian membuktikan skripnya memakai normalisasi yang sama, bukan salinan yang menyimpang.

**Sebarannya timpang, dan itu mengubah bentuk halamannya.** Dari 3.284 nomor bermasalah, 3.166 beralasan `empty` -- pasien yang di Khanza memang tidak punya nomor sama sekali. Itu bukan salah ketik yang bisa dibetulkan sambil menatap layar; nomornya harus diminta saat pasien datang lagi. Yang benar-benar bisa dikerjakan petugas dari mejanya cuma 118 (`too_short` 55, `not_mobile` 52, `unparseable` 11). Karena chip saringan dulu diurutkan mengikuti urutan kunci enum, `Kosong` tampil lebih dulu dan mengubur 118 baris itu. Sekarang chip-nya **diurutkan yang bisa dikerjakan lebih dulu, membawa jumlah masing-masing**, ditambah keterangan "menampilkan 100 dari N" (halamannya berbatas 100 baris dan dulu tidak mengatakannya) dan satu kalimat khusus pada saringan `Kosong` yang menjelaskan kenapa tidak ada yang bisa dikoreksi di situ.

- **`BILLING_READY` — kirim ke pasien atau penanggung jawab?** (PRD §10 #3) Ternyata pertanyaan ini tidak berdampak teknis: `reg_periksa.p_jawab` cuma berisi NAMA, bukan nomor kontak terpisah. Satu-satunya nomor yang tersedia tetap `pasien.no_tlp`, apa pun jawabannya (lihat komentar di `khanza/billing.ts`).

## Yang masih perlu keputusan rumah sakit (bukan teknis)

Dua puluh enam keputusan, dan **tidak satu pun boleh diambil sepihak oleh siapa
pun yang menulis kode** — semuanya menentukan data siapa mengalir ke mana, atau
mengirim pesan sungguhan ke pihak ketiga sungguhan. Kode sudah membatasi diri
sejauh yang bisa dilakukan kode; sisanya kebijakan.

**Alasan lengkap tiap butir ada di `FITUR.md`** — apa yang sudah diukur, bentuk
apa yang ditolak, dan jalan tengah apa yang tersedia. Tabel ini indeksnya.

| Yang harus diputuskan | Kunci | Keadaan |
|---|---|---|
| Daftar poli & pemeriksaan sensitif (F4.3) | `privacy.sensitive_poli_codes` | kosong; kandidat sudah diinvestigasi baca-saja |
| Jam kirim pengingat H-1 | `schedule.book_remind_hour` | 18:00 WIB |
| Volume harian sesungguhnya (PRD §9 #1) | — | baru terjawab saat Fase 5 |
| Dasar hukum BROADCAST | — | dipakai; belum ada dasar tertulis |
| Dasar hukum BROADCAST TERJADWAL (lebih ketat) | — | tanpa peninjau tiap kali jalan |
| Siapa yang boleh ada di grup apotek | `farmasi.enabled` | MATI |
| Mana dari dua pemicu kontrol yang dipakai | `KONTROL_ULANG` vs `BOOK_REMIND` | keduanya bisa tabrakan |
| Persediaan & harga boleh dijawab ke siapa | `farmasi.stok_mode` | **`semua`** — sudah terbuka |
| Rincian apa yang disebut ke nomor umum | `farmasi.stok_rincian_umum` | `ringkas` |
| Siapa boleh minta REKAP kekurangan gudang | `farmasi.darurat_tanya` | MENYALA |
| Harga beli pemasok boleh beredar? | `farmasi.pengadaan_harga` | menyala di bawah sakelar utamanya |
| Rencana pembelian boleh beredar sebelum barangnya ada? | `farmasi.pemesanan_enabled` | menyala |
| Nilai & pemberi hibah boleh disebut? | `farmasi.hibah_enabled` | menyala; tabelnya kosong di produksi |
| PENJUALAN: sanggupkah grup menerima 16–46 pesan/hari | `farmasi.penjualan_enabled` | menyala |
| PENJUALAN: omzet loket boleh dibaca di WhatsApp? | idem | idem |
| PENJUALAN: aturan pengisian kotak `keterangan` kasir | `{keterangan}` | tidak di template bawaan |
| REKAP RESEP: nama dokter + rupiah per dokter ke grup | `farmasi.resep_rekap_enabled` | menyala |
| REKAP BULANAN FARMASI: siapa membaca angka mutu apotek | `farmasi.bulanan_enabled` | menyala |
| REKAP BULANAN ADM: siapa membaca angka mutu rekam medis | `administrasi.bulanan_enabled` | menyala |
| REKAP BULANAN ADM: tindakan mana yang dilipat | `administrasi.bulanan_tindakan_kecuali` | kosong — belum satu pun dicentang |
| REKAP ASESMEN: daftar NAMA PASIEN ke grup keperawatan | `erm.penilaian_enabled` | menyala; `erm.penilaian_rincian` bisa `ringkas` |
| Pemicu pasien: salinan ke grup, dan mode `tujuan` | `template.tujuan_mode` | keempat yang aktif bermode `tujuan` |
| Penjamin pasien boleh disebut di pesan? | `{cara_bayar}` | tidak di template bawaan |
| BPJS: pembatalan ke loket, pengingat ke pasien | `bpjs.enabled` | MATI |
| ADMINISTRASI: sahkah surat lewat WhatsApp; diagnosa ikut?; surat sehat boleh diterbitkan?; sidik jari di QR? | `administrasi.*` | MATI |
| SURAT SAKIT OTOMATIS: berkas berangkat tanpa peninjau | `administrasi.auto_enabled` | MATI |
| DOKUMEN HASIL: hasil lab / narasi radiologi / rincian obat ke pasien | `dokumen.*_enabled` | ketiganya MATI |
| BALASAN OTOMATIS: siapa bertanggung jawab atas isinya | `autoreply.enabled` | MENYALA |
| PERINTAH WA: siapa boleh menulis aturan, dari alamat apa | `wa_command_admin` | menyala; aturan baru lahir nonaktif |
| FORMULIR: apa yang boleh diminta pasien tuliskan | `formulir.enabled` | MENYALA |
| FORMULIR: ke grup mana jawabannya dikabarkan, dan apakah ISI jawaban ikut | `wa_form_target` + `wa_form.tujuan_rincian` | belum ada satu tujuan pun; bawaan `ringkas` |

## Yang sengaja ditolak — jangan diusulkan ulang tanpa alasan baru

Docker, Redis/BullMQ, Prisma, trigger MySQL di `sik`, Baileys, vendor WA pihak ketiga (Fonnte/Wablas), `--no-sandbox` pada Puppeteer, `bcryptjs`. Lihat tabel "Yang Ditolak" di `TECH_STACK.md`.

## Peta dokumen

| Berkas | Isi |
|---|---|
| `PRD.md` | Kebutuhan (F1–F6), aturan privasi, risiko, ukuran keberhasilan, pertanyaan terbuka |
| `TECH_STACK.md` | Stack + **"Penyesuaian Implementasi"** (versi nyata yang terpasang & kenapa berbeda dari rencana) |
| `ARCHITECTURE.md` | Topologi proses, skema SQL, strategi polling (§4), keamanan (§9, termasuk bug grant yang ditemukan & diperbaiki), mode kegagalan (§10), kinerja (§12) |
| `IMPLEMENTATION_PLAN.md` | Urutan fase asli -- Fase 0–4 sudah selesai, Fase 5 murni operasional RS |
| **`FITUR.md`** | **Kenapa tiap fitur berbentuk seperti sekarang**: pengukuran yang mendasarinya, bentuk yang ditolak, jebakan yang sudah dibayar, dan alasan lengkap tiap keputusan RS yang di sini cuma jadi baris tabel. Dipisahkan dari berkas ini 17 Agustus 2026 supaya yang dimuat tiap sesi tinggal yang MENGIKAT kode. Wajib dibuka sebelum mengubah fitur yang sudah ada |
| `README.md` | Orientasi untuk yang BARU melihat repo ini: apa yang dikerjakan & sengaja tidak, diagram arsitektur, pemasangan dari nol |
| `DESIGN_SYSTEM.md` | Aturan tampilan: skala tipografi, warna, elevasi, kerapatan, dan **empat tingkat prosa** berikut tempatnya masing-masing. Baca sebelum menyentuh `src/components/ui/` atau menambah keterangan ke sebuah halaman |
| `RUNBOOK.md` | Untuk petugas & IT RS yang **menjalankan**, bukan yang menyentuh kode: pemeriksaan harian, gejala → tindakan. Jangan taruh isi kode di sini |
| `VERIFICATION.md` | Bukti tiap klaim "selesai" di berkas ini **maupun di `FITUR.md`**, judul seksinya dibuat sama persis. Tambah perilaku baru = tambah buktinya di sana |
