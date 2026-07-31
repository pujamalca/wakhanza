# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status proyek

Fase 0–4 dari `IMPLEMENTATION_PLAN.md` **sudah diimplementasikan dan diverifikasi** — bukan lagi rencana. Ketujuh pemicu (QUEUE_REG, BOOK_CONFIRM, BOOK_CANCEL, BOOK_REMIND, RESULT_READY, PHARMACY_READY, BILLING_READY) sudah terbukti berjalan end-to-end melawan database `sik` nyata di mesin ini, termasuk pengiriman WhatsApp sungguhan yang dikonfirmasi diterima. Dashboard (8 halaman + autentikasi + otorisasi berbasis peran) sudah dibangun dan diuji lewat HTTP asli (login, sesi terkunci setelah 5 kegagalan, operator ditolak 403 dari endpoint admin). `verify:db`, `verify:plans`, seluruh test Jest, `tsc --noEmit`, `next build`, dan `eslint` semuanya lolos bersih.

**Yang TIDAK bisa diselesaikan oleh siapa pun yang menulis kode**: Fase 5 (`IMPLEMENTATION_PLAN.md`) adalah uji coba bertahap ke pasien sungguhan selama berminggu-minggu, butuh volume RS yang sesungguhnya (PRD §9 poin 1), keputusan kebijakan RS (daftar layanan sensitif §F4.3, jam kirim H-1), dan dasar hukum persetujuan pasien (PRD §9 poin 4) — ini murni proses operasional rumah sakit, bukan sesuatu yang selesai lewat lebih banyak baris kode.

Ada database uji `TESTWA00001` (pasien) beserta beberapa `reg_periksa`/`periksa_lab`/`resep_obat`/`nota_jalan`/`booking_registrasi` terkait di `sik` — dibuat langsung lewat `mysql` (bukan lewat aplikasi Khanza) semata untuk memvalidasi pipeline selama pengembangan. Aman diabaikan atau dibersihkan; jangan bingung dengan data pasien sungguhan. Nomor teleponnya (`082283082916`) sengaja diisi nomor uji nyata milik pengembang -- dipakai ulang untuk membuktikan fitur BROADCAST (lihat di bawah), jadi jangan kaget bila menemukan `broadcast_campaign` id=1 / `outbox` bertanda `script-verify` di database `wakhanza`.

**Fitur tambahan pasca-Fase 4: BROADCAST.** Di luar tujuh pemicu reaktif dari PRD F1, dashboard punya `/broadcast` (admin-only) tempat staf memilih segmen pasien dari `reg_periksa`+`pasien` (rentang tanggal kunjungan, wilayah, cara bayar) lalu mengirim satu pesan ad-hoc ke seluruh segmen sekaligus. ***Ini bukan bagian PRD/ARSITEKTUR asli*** -- ditambahkan atas permintaan eksplisit setelah Fase 0-4 selesai, dan sengaja TIDAK mengubah desain "satu pesan = satu kejadian reaktif" untuk ketujuh pemicu lain. Lihat "Kelas ketiga: BROADCAST" di Arsitektur inti untuk detail teknis, dan §"Yang masih perlu keputusan rumah sakit" untuk batasan kebijakannya.

## Apa itu wakhanza

Gateway notifikasi WhatsApp satu-arah untuk SIMRS Khanza (sistem informasi rumah sakit). Membaca kejadian (booking, antrian, hasil lab/radiologi, obat siap, tagihan) dari database MariaDB `sik` milik SIMRS Khanza secara **read-only**, lalu mengirim WhatsApp ke pasien lewat whatsapp-web.js. Satu rumah sakit, satu nomor WhatsApp, dipasang on-premise di server RS. Tidak pernah menulis ke `sik` — nol perubahan pada SIMRS Khanza adalah sasaran desain nomor satu (PRD §3), dan ini **diverifikasi mesin** lewat grant MariaDB, bukan cuma disiplin kode (lihat `npm run verify:db`).

## Sebelum menyentuh kode

Baca dalam urutan ini — sebagian besar keputusan sulit (dan alasannya, termasuk pelajaran dari proyek sebelumnya "apiwa") ada di sana, dan beberapa detail teknis berubah selama implementasi (dicatat di bagian "Penyesuaian Implementasi" masing-masing dokumen):

1. `PRD.md` — kebutuhan fungsional (F1–F6), aturan privasi, kebutuhan non-fungsional (N1–N14)
2. `TECH_STACK.md` — pilihan teknologi + **"Penyesuaian Implementasi"** di bagian akhir (versi Next.js/NextAuth/dsb. yang benar-benar terpasang, dan kenapa berbeda dari rencana awal)
3. `ARCHITECTURE.md` — topologi proses, skema database, strategi polling, keamanan — termasuk §9.5 yang mendokumentasikan bug nyata di rencana grant MariaDB awal yang ditemukan saat implementasi
4. `IMPLEMENTATION_PLAN.md` — urutan fase; berguna untuk memahami URUTAN keputusan, meski isinya sudah dikerjakan

Aturan proses dari `IMPLEMENTATION_PLAN.md` yang tetap berlaku untuk pekerjaan lanjutan (Fase 5, atau perubahan pada Fase 0–4):

- **Setiap klaim "selesai" harus disertai keluaran perintah yang membuktikannya** — bukan "seharusnya jalan". Semua yang tercatat "selesai" di atas dibuktikan lewat perintah nyata terhadap database `sik`/`wakhanza` sungguhan, bukan diasumsikan.

## Perintah

```bash
npm run dev               # Next.js dev server, port 3100
npm run worker            # proses worker (poller + dispatcher + sesi WhatsApp) -- perlu scan QR pertama kali
npm run migrate           # terapkan migrations/*.sql yang belum jalan (skema wakhanza)
npm run verify:db         # buktikan sik menolak tulisan, dan audit_log append-only tertegak
npm run verify:plans      # EXPLAIN tiap query poller; gagal bila ada type:ALL selain booking_registrasi
npm run poll:dryrun       # cetak pesan yang AKAN terkirim untuk SEMUA pemicu tanpa mengirim/menulis apa pun
npm run seed:admin -- <username> "<nama>" <password>   # buat user dashboard pertama (role admin)
npm run harden:permissions  # icacls .env + .wwebjs_auth ke akun saat ini saja (jalankan ulang tiap sesi WA baru)
npx jest                  # semua test; `npx jest core/phone` untuk satu suite
npx tsc --noEmit
npm run lint
npm run build
npm audit --omit=dev      # lihat "Penyesuaian Implementasi" TECH_STACK.md -- tidak akan pernah 0 tanpa breaking change, dan itu didokumentasikan sengaja
```

Produksi: `ecosystem.config.js` (PM2, dua app: `wakhanza-worker` fork-mode 1 instance, `wakhanza-web`). `scripts/backup.ps1` + `scripts/restore-backup.ps1` untuk cadangan terenkripsi AES-256 database + sesi WhatsApp — **sudah diuji langsung** (dekripsi, ekstraksi, dan restore sungguhan ke database uji, lihat riwayat kerja Fase 4).

`verify:db` dan `verify:plans` bukan pemeriksaan opsional — keduanya menegakkan dua batasan paling gampang dilanggar tanpa sadar: menulis ke `sik`, dan query yang diam-diam berubah dari index seek menjadi full table scan. Jalankan keduanya setiap kali koneksi atau query poller disentuh.

## Arsitektur inti

### Dua koneksi database, dua tingkat kepercayaan
`src/db/sik.ts` memakai user MySQL `wakhanza_ro` — `GRANT SELECT` saja, `pool.max: 2` supaya tidak berebut koneksi dengan SIMRS yang sedang dipakai petugas. `src/db/wakhanza.ts` memakai `wakhanza_rw`. Pemisahan ditegakkan hak akses database, bukan disiplin kode: worker **wajib** mencoba `CREATE TEMPORARY TABLE` di `sik` saat mulai dan berhenti jalan bila berhasil (`src/db/guards.ts`, ARCHITECTURE §9.1). `sequelize.sync()` tidak boleh pernah dipanggil — skema `wakhanza` lewat migrasi SQL bernomor (`migrations/NNN_*.sql`) dijalankan `npm run migrate`.

**`wakhanza_rw` BUKAN `GRANT ALL PRIVILEGES`.** Rencana awal ternyata punya bug nyata (ditemukan & diperbaiki saat implementasi, ARCHITECTURE §9.5): MariaDB menyatukan hak akses lintas tingkatan, jadi `REVOKE DELETE, UPDATE ON audit_log` di atas fondasi `GRANT ALL` tidak menegakkan apa pun. Model yang benar: tanpa `UPDATE`/`DELETE` di tingkat database, diberikan satu per satu di tingkat tabel, `audit_log` dikecualikan selamanya. Diverifikasi ulang lewat `npm run verify:db`.

Dua gotcha koneksi:
- Koneksi `sik` wajib `dialectOptions: { dateStrings: true }`. `resep_obat.tgl_penyerahan` memakai `'0000-00-00'` sebagai penanda "belum diserahkan"; tanpa `dateStrings`, mysql2 mengubahnya jadi `Invalid Date`/`null` secara diam-diam (ARCHITECTURE §4.6, `src/khanza/farmasi.ts`).
- MariaDB di sini adalah **10.4, bukan MySQL 8** — tanpa CTE rekursif yang baik, tanpa `JSON_TABLE`, window function terbatas.

### Next.js 16, bukan 14 -- dan `proxy.ts`, bukan `middleware.ts`
TECH_STACK.md awalnya menetapkan Next.js 14/NextAuth v4; keduanya dinaikkan ke Next 16/NextAuth v5 (beta) saat implementasi karena Next 14 punya kerentanan tinggi tanpa patch lanjutan (detail di TECH_STACK.md "Penyesuaian Implementasi"). Konsekuensi konkret bagi siapa pun yang menyentuh `src/app/`: `params`/`searchParams`/`cookies()`/`headers()` bersifat `Promise` (async), dan gerbang autentikasi tingkat-request bernama **`src/proxy.ts`** (Next 16 mengganti nama dari `middleware.ts` -- fungsinya sama). Auth.js v5 dipecah dua berkas: `src/auth.config.ts` (tanpa provider, aman untuk Edge Runtime tempat `proxy.ts` berjalan) dan `src/auth.ts` (provider Credentials penuh + Sequelize/bcrypt, HANYA dipakai route handler/Server Component/Server Action). Jangan import `@/auth` dari `proxy.ts` -- Edge Runtime tidak mendukung Sequelize.

Otorisasi API ditegakkan DUA lapis dan keduanya perlu diperiksa saat menambah route baru: `proxy.ts` hanya menjaga HALAMAN (redirect ke `/login`); setiap route di `src/app/api/**/route.ts` memanggil `requireSession()`/`requireRole('admin')` dari `src/lib/authz.ts` sendiri dan mengembalikan 401/403 JSON. `/api/*` sengaja dikecualikan dari matcher `proxy.ts` -- kalau tidak, pemanggil API menerima redirect HTML alih-alih JSON.

### Topologi dua proses, koordinasi lewat tabel
`wakhanza-worker` (PM2, **wajib** `instances: 1, exec_mode: 'fork'`, tidak boleh `cluster` -- lihat `ecosystem.config.js`) memegang sesi whatsapp-web.js dan menjalankan poller + dispatcher + scheduler. `wakhanza-web` (Next.js) tidak memegang state sesi. Kedua proses **tidak pernah** berkomunikasi lewat HTTP — semua lewat tabel `wakhanza` (`wa_session` untuk QR/status/perintah lewat `src/worker/sessionCommand.ts`, `outbox` untuk status pesan), dengan konsekuensi tindakan petugas di dashboard tertunda hingga satu siklus (§1).

### Pipeline bersama: `src/worker/pipeline.ts` dan `src/worker/sisipCycle.ts`
`POLL → COALESCE → RESOLVE nomor → NORMALIZE → GATE (opt-out/invalid/nonaktif) → PRIVACY → RENDER → ENQUEUE` (langkah [3]-[8] ada di `pipeline.ts`'s `enqueueMessage()`, dipakai SEMUA pemicu -- jangan duplikasi logika ini saat menambah pemicu baru). Pemicu kelas sisip (QUEUE_REG, RESULT_READY, PHARMACY_READY, BILLING_READY) berbagi `runSisipCycle()` generik di `sisipCycle.ts`, dibedakan lewat parameter fetch/mapping per pemicu di `src/worker/poller*.ts`. `DISPATCH → SEND → LOG` (`dispatcher.ts`) mengambil dari `outbox` dengan `FOR UPDATE SKIP LOCKED`, terpisah total dari langkah enqueue -- kegagalan kirim tidak pernah menghapus jejak bahwa pemicunya terdeteksi.

RESULT_READY punya DUA watermark terpisah (`RESULT_READY_LAB`, `RESULT_READY_RADIOLOGI` di `poll_cursor`) walau satu `trigger_code` -- mencampur watermark dua sumber independen bisa membuat salah satunya melompati baris yang belum diproses.

### Kendala indeks yang membentuk setiap query poller
Kolom tanggal Khanza yang tampak wajar (`tgl_registrasi`, `tgl_periksa`, dst.) **tidak terindeks**. Solusinya: tanggal sudah ter-enkode di primary key, jadi tiap query poller wajib dua penyaring sekaligus:
```sql
WHERE no_rawat >= :lookback_prefix              -- pemangkas lewat indeks (PK)
  AND TIMESTAMP(tgl_periksa, jam) >= :cursor_ts  -- ketepatan
```
Diverifikasi EMPIRIS lewat `npm run verify:plans` terhadap `sik` sungguhan (bukan cuma diklaim di dokumen) -- setiap query poller menunjukkan `range`/`eq_ref`/`index`, tidak pernah `type: ALL` pada tabel dasar. Pengecualian satu-satunya yang disengaja: `booking_registrasi` (kelas pindai, interval 5 menit bukan 60 detik). `scripts/verify-plans.ts` juga mengecualikan hasil scan terhadap **tabel turunan/subquery** (`<derived2>` dsb.) dari pemeriksaan full-scan -- itu hasil yang sudah tersaring, bukan tabel dasar. Baca ARCHITECTURE §4.4 sebelum menyentuh query poller mana pun.

### Dua kelas pemicu: sisip vs pindai
`QUEUE_REG`, `RESULT_READY`, `PHARMACY_READY`, `BILLING_READY`, `BOOK_CONFIRM` = kelas **sisip** (watermark). `BOOK_CANCEL`, `BOOK_REMIND` = kelas **pindai** (`src/worker/pollerBooking.ts`, `scheduler.ts` -- scan ulang jendela terbatas; dedup murni lewat kunci idempoten yang menyertakan `status`). `BOOK_CONFIRM` dan `BOOK_CANCEL` berbagi SATU query (`khanza/booking.ts`'s `pollUpcomingBookings()`) dan SATU siklus (`pollerBooking.ts`), dibedakan lewat status baris dan idempotency key masing-masing -- bukan dua query terpisah. `event_at` untuk keduanya memakai waktu DETEKSI (sekarang), bukan `tanggal_booking` -- lihat komentar di `pollerBooking.ts` untuk kenapa memakai timestamp booking asli akan salah membuat konfirmasi jangka panjang tampak basi.

### Kelas ketiga: BROADCAST (dipicu staf, bukan sik)

`/broadcast` (`src/app/(dashboard)/broadcast/`) menambah kelas pemicu ketiga di luar sisip/pindai: **staf-inisiasi**. Tidak ada polling `sik` sama sekali -- staf memfilter `khanza/pasienSegment.ts`'s `fetchPatientSegment()` (join `reg_periksa`+`pasien`+`penjab`+`kabupaten`/`kecamatan`/`kelurahan`, satu baris per pasien lewat `MAX(no_rawat)` dalam rentang, dipangkas prefix `no_rawat` yang sama seperti pemicu lain -- diverifikasi `verify:plans` sebagai `BROADCAST_SEGMENT`, bukan dikecualikan) lalu mengetik pesan bebas. Keputusan desain kunci: **enqueue-nya memakai `enqueueMessage()` yang SAMA PERSIS** dengan ketujuh pemicu lain (`worker/pipeline.ts`'s `loadBroadcastContext()` cuma sumber `template.body`-nya beda -- teks staf, bukan `Template.findByPk()`), jadi privasi (`checkPrivacy`, fallback ke `privacy.generic_template`), opt-out, jam tenang, dan idempotency (`buildIdempotencyKey('BROADCAST', campaignId, no_rkm_medis)`) otomatis identik tanpa logika baru. Dashboard (proses web) HANYA menulis baris `outbox` -- pengiriman sungguhan tetap tugas dispatcher worker yang sudah berjalan, konsisten dengan "kedua proses tidak pernah lewat HTTP" (§ topologi dua proses).

Dua pagar yang tidak dipunyai pemicu lain: `broadcast.max_recipients` (app_setting, default 500) menolak kirim sebelum enqueue bila segmen kelewat besar (filter yang salah tidak boleh langsung jadi ribuan pesan), dan `broadcast_campaign` (insert-only, `outbox.campaign_id` menautkan balik) adalah jejak akuntabilitas siapa mengirim apa ke berapa orang kapan -- jumlah terkirim/gagal DIHITUNG LANGSUNG dari `outbox WHERE campaign_id=x` saat dibaca, tidak pernah disimpan sebagai penghitung yang bisa basi. Variabel template dibatasi `BROADCAST_TEMPLATE_VARIABLES` (`core/template.ts`) ke `nama_pasien`/`no_rm`/`nama_rs`/`alamat_rs`/`kontak_rs` saja -- `{nama_poli}`/`{jam}`/dst tidak well-defined untuk segmen yang bisa merentang banyak kunjungan.

Diverifikasi ulang lewat kombinasi: GET `/broadcast` (query+ringkasan+render) lewat HTTP asli dengan cookie sesi admin sungguhan; enqueue (`fetchPatientSegment`→`loadBroadcastContext`→`enqueueMessage`) lewat pemanggilan langsung fungsi produksi yang sama persis dipakai `actions.ts` (bukan reimplementasi); pengiriman sungguhan dikonfirmasi lewat `send_log`/`outbox.status='sent'` oleh worker yang sedang berjalan. POST server action `sendBroadcastAction` itu sendiri TIDAK berhasil direplikasi lewat `curl` mentah (Next.js menolak permintaan multipart hasil rekonstruksi manual dengan redirect ke `/login` -- kemungkinan pemeriksaan same-origin/RSC internal Next yang tidak sepenuhnya bisa ditiru dari luar browser); pola `requireRole('admin')`-nya identik dengan `template/actions.ts` yang sudah terbukti lewat browser sungguhan di Fase 3, jadi celah pembuktian ini murni keterbatasan alat uji command-line, bukan bagian yang belum tervalidasi secara logika.

### Privasi ditegakkan lewat kolom yang tidak pernah diambil
Query di `src/khanza/` tidak men-`SELECT` kolom sensitif sama sekali (nama pemeriksaan lab dari `jns_perawatan_lab`, nama obat, hasil, diagnosis) — bukan mengambil lalu menyaring saat render. `core/privacy.ts`'s `checkPrivacy()` menerima `kdJenisPrw` sebagai **kode** (bukan nama) dan bisa berupa larik (RESULT_READY yang digabung per kunjungan bisa punya beberapa kode sekaligus -- satu kode sensitif saja cukup membuat seluruh pesan diganti generik). Lihat ARCHITECTURE §5.2 dan PRD §F4 sebelum menambah variabel template baru atau mengambil kolom baru dari `sik`.

### Substitusi template wajib satu lintasan
`nm_pasien`, `nm_poli`, `nm_dokter` berasal dari input bebas petugas pendaftaran di Khanza. Substitusi `{variabel}` di `core/template.ts` **harus** satu lintasan kiri-ke-kanan, tidak boleh diulang sampai stabil — pasien bernama `{kontak_rs}` tidak boleh membuat nomor telepon RS muncul di posisi namanya sendiri (diuji unit di `template.test.ts`). Variabel tak dikenal ditolak SAAT TEMPLATE DISIMPAN (`src/app/(dashboard)/template/actions.ts`), bukan saat kirim.

### Design system dashboard -- `src/components/ui/`
Semua halaman `(dashboard)/**` dan `/login` memakai primitif dari `src/components/ui/` (barrel export lewat `index.ts`) alih-alih menulis ulang class Tailwind mentah per halaman: `Button`/`LinkButton` (varian `primary`/`secondary`/`destructive`/`ghost`, ukuran `xs`/`sm`/`md`), `Input`/`Textarea`/`Select` (prop `fieldSize`, BUKAN `size` -- `size` sudah jadi atribut HTML asli di `<select>`), `Card` (+ `cardClassName` string untuk kasus elemen bukan `<div>`, mis. `<form>`), `Badge` (+ `outboxStatusVariant()` untuk status `Outbox`), `PageHeader`, `FilterChip`, `EmptyState`, dan class helper tabel (`tableWrapperClass`/`theadClass`/`rowClass`/`cellClass`). `SidebarNav` (`src/components/SidebarNav.tsx`, client component terpisah karena butuh `usePathname()`) menyorot menu aktif di sidebar.

**Kenapa lewat props varian, bukan `className` untuk menimpa warna/padding/ukuran**: dua utility Tailwind untuk properti CSS yang SAMA (mis. `rounded-md` bawaan komponen ditimpa `rounded-full` lewat `className`) menang berdasarkan urutan Tailwind MENGHASILKAN CSS-nya (urutan di config/scale), bukan urutan kemunculan di string `className` -- override lewat `className` bisa diam-diam KALAH. Karena itu Button/Input/Textarea/Select/Badge menerima varian sebagai prop terpisah (`variant`, `size`/`fieldSize`) yang tidak pernah tumpang tindih dengan apa pun yang boleh dikirim lewat `className` (lebar, margin, dsb. saja). Jangan tambah `px-*`/`py-*`/`text-*`/`bg-*`/`rounded-*` lewat `className` ke komponen ini -- kalau ukuran/warna yang ada tidak cukup, tambah varian baru di komponennya, jangan ditimpa dari luar.

Token warna (`src/app/globals.css`'s `:root`/`.dark`, dipetakan di `tailwind.config.ts`): `background`, `foreground`, `primary`, `muted`, `destructive`, `card` (permukaan panel, sedikit lebih terang dari `background` di mode gelap supaya card terlihat "terangkat"), `ring` (fokus). Tambah token warna baru di SINI (dua tempat: `:root` dan `.dark`), jangan hardcode `dark:bg-slate-800` dsb. langsung di komponen halaman kecuali kasus yang MEMANG sengaja tidak ikut tema (contoh: QR code di `KoneksiClient.tsx` tetap `bg-white` di kedua tema karena butuh kontras penuh untuk bisa dipindai -- ada komentar di kode yang menjelaskan ini).

## Keputusan yang dulu terbuka, sudah diputuskan saat implementasi

- **`core/phone.ts`**: diimplementasikan **ketat** -- persis 7 langkah ARCHITECTURE §5.1, tanpa heuristik tambahan. Diverifikasi terhadap seluruh 8.117 baris `sik.pasien` nyata: 59,5% langsung valid (melampaui baseline 45% di PRD), sisanya masuk `patient_contact` dengan alasan penolakan untuk dikoreksi manual lewat dashboard.
- **`BILLING_READY` — kirim ke pasien atau penanggung jawab?** (PRD §10 #3) Ternyata pertanyaan ini tidak berdampak teknis: `reg_periksa.p_jawab` cuma berisi NAMA, bukan nomor kontak terpisah. Satu-satunya nomor yang tersedia tetap `pasien.no_tlp`, apa pun jawabannya (lihat komentar di `khanza/billing.ts`).

## Yang masih perlu keputusan rumah sakit (bukan teknis)

- **Daftar layanan/poli sensitif** (F4.3) dan **kode pemeriksaan sensitif**: default kosong (`[]`), diisi lewat halaman Pengaturan dashboard (`/pengaturan`, admin-only) begitu RS memutuskan.
- **Jam kirim pengingat H-1** (PRD §10 #4): default 18:00 WIB (`schedule.book_remind_hour` di `app_setting`), dapat diubah dari dashboard tanpa restart.
- **Volume harian sesungguhnya** (PRD §9 #1): database dev berisi riwayat historis tapi bukan cerminan beban nyata -- baru terjawab saat Fase 5 (uji coba `dryrun` terhadap salinan data RS sungguhan).
- **Dasar hukum BROADCAST**: fitur ini mengirim pesan ke pasien berdasarkan riwayat kunjungan lampau, bukan kejadian yang sedang berlangsung seperti ketujuh pemicu reaktif -- secara kebijakan ini lebih dekat ke pemberitahuan/ajakan daripada notifikasi transaksional. Kode TIDAK membedakan keduanya secara hukum (memakai mekanisme privasi/opt-out yang sama), jadi RS yang harus memutuskan pemakaian macam apa yang sesuai basis persetujuan pasien yang ada, sebelum dipakai ke pasien sungguhan dalam jumlah besar.

## Yang sengaja ditolak — jangan diusulkan ulang tanpa alasan baru

Docker, Redis/BullMQ, Prisma, trigger MySQL di `sik`, Baileys, vendor WA pihak ketiga (Fonnte/Wablas), `--no-sandbox` pada Puppeteer, `bcryptjs`. Lihat tabel "Yang Ditolak" di `TECH_STACK.md`.

## Peta dokumen

| Berkas | Isi |
|---|---|
| `PRD.md` | Kebutuhan (F1–F6), aturan privasi, risiko, ukuran keberhasilan, pertanyaan terbuka |
| `TECH_STACK.md` | Stack + **"Penyesuaian Implementasi"** (versi nyata yang terpasang & kenapa berbeda dari rencana) |
| `ARCHITECTURE.md` | Topologi proses, skema SQL, strategi polling (§4), keamanan (§9, termasuk bug grant yang ditemukan & diperbaiki), mode kegagalan (§10), kinerja (§12) |
| `IMPLEMENTATION_PLAN.md` | Urutan fase asli -- Fase 0–4 sudah selesai, Fase 5 murni operasional RS |
