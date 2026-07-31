# TECH_STACK — wakhanza

Setiap pilihan di sini punya alasan yang terikat pada kenyataan lapangan: **server rumah sakit, satu instansi, tanpa devops, harus hidup terus.** Bila alasan itu tidak lagi berlaku, pilihannya boleh ditinjau ulang.

Prinsip pemandu: **sesedikit mungkin komponen yang bisa rusak.** Setiap dependensi tambahan adalah sesuatu yang harus diperbaiki admin IT rumah sakit jam 2 pagi.

---

## Lingkungan Terverifikasi

Diperiksa pada mesin pengembangan, 31 Juli 2026:

| Komponen | Versi |
|---|---|
| Node.js | v22.22.0 |
| npm | 10.9.4 |
| MariaDB | 10.4.20 |
| Database `sik` | 1.234 tabel |

MariaDB 10.4 penting dicatat: **tidak mendukung CTE rekursif dengan baik, tidak punya `JSON_TABLE`, dan tidak punya window function selengkap MySQL 8.** Query poller harus tetap dalam SQL sederhana. Jangan mengasumsikan fitur MySQL 8.

---

## Inti

| Komponen | Pilihan | Alasan |
|---|---|---|
| Runtime | **Node.js 22 LTS** | Dipaksa oleh whatsapp-web.js yang hanya ada di ekosistem Node. Versi 22 LTS sudah terpasang |
| Bahasa | **TypeScript 5.9** | Baris di `sik` punya bentuk tak intuitif (`stts`, `stts_daftar`, `status_lanjut` — tiga kolom status berbeda di satu tabel). Tipe eksplisit mencegah salah pakai kolom |
| Database aplikasi | **MariaDB** (skema `wakhanza`) | Sudah berjalan di server RS untuk Khanza. Menambah PostgreSQL berarti menambah layanan yang harus dirawat |
| Akses DB | **Sequelize 6 + mysql2** | Sama seperti apiwa, sehingga pola dan potongan kode bisa dipakai ulang. Dua koneksi terpisah — lihat di bawah |
| Pengiriman WA | **whatsapp-web.js 1.23** | Ditetapkan: gratis, tanpa verifikasi badan usaha, bebas kirim tanpa template yang perlu persetujuan Meta |
| Dashboard | **Next.js 14 App Router** | Ditetapkan. Stack yang sudah dikuasai dari apiwa |
| Autentikasi | **NextAuth v4, provider Credentials** | Pengguna internal RS saja. Tidak perlu OAuth |
| Hashing sandi | **`bcrypt` binding native** (bukan `bcryptjs`) | `bcryptjs` adalah JavaScript murni sehingga hashing berjalan di event loop. Pada apiwa, cost 12 terbukti menahan event loop cukup lama sampai login berbarengan menggantung hingga timeout. Binding native menjalankannya di thread pool libuv. Cost 12 tetap — yang berubah tempat eksekusinya |
| UI | **Tailwind 3 + shadcn/ui + Radix** | Sama dengan apiwa |
| Ambil data di klien | **TanStack Query 5** | Halaman antrean dan QR butuh polling berkala — inilah yang dilakukan TanStack Query dengan baik |
| Validasi | **Zod 3** | Memvalidasi baris mentah dari `sik` sebelum masuk template. Data `sik` kotor (`no_tlp` berisi `-`, `jns_perawatan_lab` berisi `1111111111111111`) |
| Log | **pino** | Log terstruktur, dibutuhkan saat menelusuri kenapa satu pesan tidak terkirim |
| Proses | **PM2** | Ditetapkan. Dua aplikasi di satu `ecosystem.config.js` |
| Uji | **Jest 29** | Normalisasi nomor dan idempotency wajib diuji unit — di situlah bug paling mahal |

---

## Dua Koneksi Database yang Sengaja Dipisah

Bagian terpenting dari seluruh stack.

```ts
// src/db/sik.ts — HANYA BACA
export const sik = new Sequelize(process.env.SIK_DB_NAME!, process.env.SIK_DB_USER!, ..., {
  dialect: 'mysql',
  logging: false,
  pool: { max: 2 },      // dibatasi: jangan rebutan koneksi dengan SIMRS
});

// src/db/wakhanza.ts — BACA & TULIS
export const db = new Sequelize(process.env.WA_DB_NAME!, process.env.WA_DB_USER!, ..., {
  dialect: 'mysql',
  define: { underscored: true },
});
```

Pemisahan ini ditegakkan **di tingkat MariaDB**, bukan sekadar disiplin kode:

```sql
CREATE USER 'wakhanza_ro'@'localhost' IDENTIFIED BY '...';
GRANT SELECT ON sik.* TO 'wakhanza_ro'@'localhost';

CREATE USER 'wakhanza_rw'@'localhost' IDENTIFIED BY '...';
GRANT ALL PRIVILEGES ON wakhanza.* TO 'wakhanza_rw'@'localhost';

-- Riwayat audit tidak boleh dapat diubah oleh aplikasi itu sendiri.
REVOKE DELETE, UPDATE ON wakhanza.audit_log FROM 'wakhanza_rw'@'localhost';
```

Kalau suatu hari ada kode yang keliru menjalankan `UPDATE sik.pasien`, MariaDB menolaknya dengan error hak akses. Keselamatan database rumah sakit tidak boleh bergantung pada ingatan programmer.

`pool.max: 2` juga bukan angka asal — SIMRS Khanza desktop membuka banyak koneksi dari tiap komputer petugas. Poller tidak boleh ikut menghabiskan jatah `max_connections`.

---

## Model Khanza: Definisi, Bukan Sinkronisasi

Model Sequelize untuk tabel `sik` didefinisikan dengan:

```ts
{ tableName: 'reg_periksa', timestamps: false, freezeTableName: true }
```

`timestamps: false` wajib — tabel Khanza tidak punya `created_at`/`updated_at`. Sequelize akan menambahkannya sendiri bila tidak dimatikan, lalu setiap query gagal.

**`sequelize.sync()` tidak boleh pernah dipanggil pada koneksi `sik`.** Hanya untuk skema `wakhanza`. Ini kesalahan yang paling mudah terjadi dan paling merusak: `sync({ alter: true })` pada `sik` akan mencoba mengubah 1.234 tabel database rumah sakit.

Praktik yang lebih aman lagi: untuk query poller, pakai `sik.query(sql, { type: QueryTypes.SELECT })` dengan SQL mentah. Poller cuma butuh membaca dan menggabungkan tabel — abstraksi model justru menyembunyikan biaya query.

---

## Migrasi Skema: Berbeda dari apiwa

apiwa memakai `sequelize.sync({ alter: true })` tanpa migrasi. Di sana konsekuensinya ditanggung sendiri. Di rumah sakit tidak boleh:

| | apiwa | wakhanza |
|---|---|---|
| Skema dibentuk oleh | `sync({ alter: true })` | **file migrasi SQL bernomor** |
| Pemulihan bila salah | jalankan ulang seed | jalankan migrasi turun |

Alasannya: `alter: true` pernah menghapus kolom saat mendeteksi perbedaan tipe. Di database yang berisi riwayat notifikasi pasien, itu tidak dapat dipulihkan tanpa backup. Migrasi bernomor sederhana (`migrations/001_init.sql`, `002_*.sql`) dengan tabel pencatat versi sudah cukup — tidak perlu Umzug atau Prisma.

---

## Antrean: Tabel, Bukan Redis

apiwa memakai BullMQ + ioredis. wakhanza tidak.

| | BullMQ + Redis | Tabel `outbox` |
|---|---|---|
| Layanan tambahan | Redis harus dipasang & dirawat | tidak ada |
| Bila layanan mati | job hilang bila Redis tanpa persistensi | tidak ada yang hilang |
| Ikut backup DB | tidak | ya |
| Inspeksi oleh admin RS | butuh redis-cli | `SELECT * FROM outbox` |
| Konsumen paralel | kuat | satu saja |

Poin terakhir yang menentukan: WhatsApp harus dikirim **pelan dan berurutan** (jeda 3–8 detik) supaya nomor tidak diblokir. Keunggulan utama Redis — banyak konsumen paralel — justru hal yang harus dihindari di sini. Membayar biaya operasional Redis untuk kemampuan yang sengaja tidak dipakai adalah kerugian bersih.

Batas kelayakannya: pada volume di atas ±50.000 pesan per hari, polling tabel mulai kalah. Rumah sakit satu instansi tidak akan mendekati angka itu.

---

## Penjadwalan: node-cron di Dalam Proses

Pengingat H-1 dan pembersihan berkala memakai `node-cron` di dalam proses worker. Bukan Task Scheduler Windows, bukan proses cron terpisah.

Alasan: satu proses yang hidup lebih sedikit hal yang bisa salah dikonfigurasi, dan pekerjaan terjadwal butuh akses ke koneksi database serta klien WhatsApp yang sama.

---

## Yang Ditolak

| Ditolak | Sebab |
|---|---|
| **Docker** | IT rumah sakit sering menolak memasang Docker Desktop/WSL2 di server produksi. PM2 di atas Node telanjang lebih mungkin disetujui |
| **Redis / BullMQ** | Lihat bagian antrean |
| **Prisma** | ORM-nya bagus, tapi introspeksi 1.234 tabel `sik` menghasilkan skema raksasa, dan Prisma mendorong ke arah migrasi yang dikelolanya sendiri — berbahaya bila salah diarahkan ke `sik` |
| **Trigger MySQL di `sik`** | Ditolak di tingkat kebutuhan: mengubah database produksi RS, hilang saat Khanza diperbarui, dan trigger yang error bisa menggagalkan transaksi SIMRS |
| **Baileys** (alternatif whatsapp-web.js) | Lebih ringan karena tanpa Chromium, tapi lebih dekat ke protokol internal WhatsApp sehingga lebih sering rusak saat WhatsApp berubah. Untuk sistem yang jarang disentuh, stabilitas mengalahkan efisiensi |
| **Vendor lokal (Fonnte/Wablas)** | Data pasien akan melewati server pihak ketiga. Ditolak karena kerahasiaan rekam medis |
| **Menumpang tabel di skema `sik`** | Pembaruan SIMRS Khanza bisa menghapusnya, dan mengaburkan batas kepemilikan data |
| **Sentry / telemetri keluar** | Jejak kesalahan bisa memuat data pasien. Log tetap di dalam server RS |
| **Monorepo / dua repositori** | Berlebihan untuk dua proses yang berbagi model dan tipe yang sama |

---

## Struktur Direktori

```
wakhanza/
├── ecosystem.config.js         # PM2: wakhanza-web + wakhanza-worker
├── migrations/                 # 001_init.sql, 002_*.sql — hanya skema wakhanza
├── src/
│   ├── db/
│   │   ├── sik.ts              # koneksi read-only ke sik
│   │   └── wakhanza.ts         # koneksi baca-tulis
│   ├── models/                 # model skema wakhanza
│   ├── khanza/                 # query baca ke sik, satu file per pemicu
│   │   ├── booking.ts
│   │   ├── antrian.ts
│   │   ├── penunjang.ts
│   │   ├── farmasi.ts
│   │   └── billing.ts
│   ├── core/                   # logika murni, mudah diuji
│   │   ├── phone.ts            # normalisasi nomor
│   │   ├── idempotency.ts      # pembentukan kunci
│   │   ├── template.ts         # penggantian variabel
│   │   └── privacy.ts          # penyaringan layanan sensitif
│   ├── worker/
│   │   ├── index.ts            # titik masuk worker
│   │   ├── poller.ts           # siklus polling
│   │   ├── dispatcher.ts       # ambil outbox → kirim
│   │   └── wa-client.ts        # pembungkus whatsapp-web.js
│   ├── app/                    # Next.js App Router
│   └── lib/
└── __tests__/
```

`src/core/` sengaja berisi fungsi murni tanpa akses database maupun jaringan. Di situlah letak logika yang paling mudah salah dan paling mahal bila salah — dan justru bagian yang paling murah untuk diuji menyeluruh.

---

## Variabel Lingkungan

```bash
# Database SIMRS Khanza — WAJIB pengguna read-only
SIK_DB_HOST=localhost
SIK_DB_PORT=3306
SIK_DB_NAME=sik
SIK_DB_USER=wakhanza_ro
SIK_DB_PASS=

# Database wakhanza
WA_DB_HOST=localhost
WA_DB_PORT=3306
WA_DB_NAME=wakhanza
WA_DB_USER=wakhanza_rw
WA_DB_PASS=

# WhatsApp
WA_SESSION_PATH=./.wwebjs_auth
WA_SEND_MIN_DELAY_MS=3000
WA_SEND_MAX_DELAY_MS=8000
WA_MAX_PER_HOUR=200

# Pemicu
POLL_INTERVAL_MS=60000          # pemicu kelas sisip
SCAN_INTERVAL_MS=300000         # pemicu kelas pindai (booking) — lebih longgar
LOOKBACK_DAYS=30                # jendela mundur pemangkas indeks, ARCHITECTURE §4.4
QUERY_TIMEOUT_SEC=5
QUIET_HOURS_START=21
QUIET_HOURS_END=7
STALE_THRESHOLD_HOURS=6

# Dashboard
NEXTAUTH_SECRET=                # minimal 32 byte acak
NEXTAUTH_URL=http://127.0.0.1:3100
SESSION_MAX_AGE_HOURS=8         # satu giliran kerja, bukan 30 hari
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
HOST=127.0.0.1
PORT=3100
```

Port 3100 dipilih agar tidak bertabrakan dengan project lain di mesin yang sama (apiwa memakai 3000/3001).

`LOOKBACK_DAYS` bukan pengaturan kinerja belaka. Nilai yang terlalu kecil membuat pemicu untuk pasien rawat inap lama **hilang tanpa error** — kegagalan senyap yang hanya ketahuan dari keluhan pasien. Sesuaikan dengan lama rawat terpanjang di rumah sakit, lalu lebihkan.

`HOST=127.0.0.1` juga bukan sekadar kerapian. Next.js yang dijalankan tanpa `-H` mengikat ke seluruh antarmuka jaringan, sehingga dashboard berisi nama dan nomor telepon pasien langsung terbuka bagi seluruh jaringan rumah sakit — tanpa ada yang menyadarinya. Lihat ARCHITECTURE §9.4.

## Pengerasan Puppeteer

```ts
puppeteer: {
  headless: true,
  args: ['--disable-dev-shm-usage'],   // TIDAK ADA --no-sandbox
}
```

apiwa memakai `--no-sandbox`. wakhanza tidak boleh. Flag itu penanganan darurat untuk kontainer Linux; di Windows sandbox Chromium bekerja tanpa perlu diapa-apakan. Chromium di sini memuat `web.whatsapp.com` — konten jarak jauh — pada server yang satu jaringan dengan basis data rekam medis. Lihat ARCHITECTURE §9.6.

Worker dijalankan sebagai akun layanan khusus, bukan Administrator.

## Izin Berkas

```powershell
icacls .env            /inheritance:r /grant:r "$env:USERNAME:(R)"
icacls .wwebjs_auth    /inheritance:r /grant:r "$env:USERNAME:(F)" /T
```

`.wwebjs_auth` berisi sesi WhatsApp aktif — setara kredensial. Siapa pun yang menyalinnya dapat menyamar sebagai nomor WhatsApp rumah sakit.

Saat proses mulai, worker **wajib memverifikasi** bahwa `SIK_DB_USER` benar-benar tidak punya hak tulis, dengan mencoba operasi tulis pada tabel sementara dan memastikan operasi itu ditolak. Bila justru berhasil, worker berhenti dan menolak jalan. Salah konfigurasi kredensial adalah satu-satunya cara prinsip read-only bisa bocor — jadi periksa, jangan percaya.
