# IMPLEMENTATION_PLAN — wakhanza

Rencana ini disusun **secara vertikal, bukan horizontal.** Fase 1 menembus seluruh pipeline dengan satu pemicu saja sampai benar-benar mengirim WhatsApp nyata. Baru setelah terbukti, fase-fase berikutnya menambah lebar.

Alasannya: bila membangun semua poller dulu, lalu semua template, lalu dispatcher, maka kegagalan pertama yang sesungguhnya baru terlihat setelah pekerjaan berminggu-minggu — dan bisa membatalkan sebagian besarnya. Irisan vertikal memindahkan risiko terbesar ke depan.

**Aturan yang berlaku sepanjang rencana:** setiap klaim "selesai" harus disertai keluaran perintah yang membuktikannya. Bukan "seharusnya jalan".

---

## Fase 0 — Fondasi

**Sasaran:** proyek berjalan, dua koneksi database hidup, dan prinsip read-only terbukti ditegakkan mesin.

| # | Pekerjaan | Keluaran |
|---|---|---|
| 0.1 | Inisiasi proyek Next.js 14 + TypeScript + Tailwind | `npm run dev` menyala di port 3100 |
| 0.2 | `.gitignore` — wajib memuat `.env`, `.wwebjs_auth/`, `node_modules/`, `.next/`, `logs/` | — |
| 0.3 | Buat pengguna MySQL `wakhanza_ro` (SELECT saja) dan `wakhanza_rw`, lalu `REVOKE DELETE, UPDATE ON wakhanza.audit_log` | — |
| 0.4 | `CREATE DATABASE wakhanza` + pelari migrasi + `001_init.sql` | 10 tabel terbentuk |
| 0.5 | `src/db/sik.ts` + `src/db/wakhanza.ts`, `dateStrings: true`, `pool.max: 2`, batas waktu query 5 detik | — |
| 0.6 | **Pengaman read-only**: saat mulai, coba `CREATE TEMPORARY TABLE` di `sik`; berhenti bila berhasil | — |
| 0.7 | Pemeriksa skema: pastikan seluruh kolom yang dibutuhkan ada di `sik` | — |
| 0.8 | pino + berkas log berputar + penyamar nomor telepon | — |
| 0.9 | **`verify:plans`** — jalankan `EXPLAIN` pada tiap query poller, gagalkan bila `type: ALL` | ARCHITECTURE §4.8 |
| 0.10 | `npm audit` bersih; versi Chromium Puppeteer disematkan | — |
| 0.11 | Batasi izin `.env` dan `.wwebjs_auth/` lewat `icacls` | — |

**Definition of Done**

```bash
npm run verify:db
# harus mencetak:
#   [ok] sik      : tersambung, 1234 tabel, kolom lengkap
#   [ok] sik      : tulis DITOLAK (benar)
#   [ok] wakhanza : tersambung, 10 tabel
#   [ok] audit_log: DELETE/UPDATE DITOLAK (benar)

npm run verify:plans
#   [ok] QUEUE_REG      range PRIMARY  rows~3
#   [ok] RESULT_READY   range PRIMARY  rows~1   (Using index)
#   [ok] PHARMACY_READY range PRIMARY
#   [ok] BILLING_READY  range tanggal
#   [--] BOOK_CANCEL    ALL — pemindaian penuh yang disengaja, §4.4

npm audit --omit=dev      # 0 kerentanan tinggi/kritis
```

Langkah 0.6 adalah bagian terpenting seluruh fase ini. Prinsip read-only yang hanya ditulis di dokumen akan bocor pada hari seseorang menyalin kredensial root ke `.env` karena "biar cepat". Pemeriksaan saat mulai membuat kesalahan itu mustahil lolos ke produksi.

Langkah 0.9 melindungi hal yang berbeda tetapi dengan cara yang sama. Menulis `WHERE tgl_registrasi >= …` terlihat lebih jelas dibaca daripada `WHERE no_rawat >= …`, tidak menghasilkan error, dan lolos seluruh uji — sambil membuat query 11.000 kali lebih mahal di basis data rumah sakit. Satu-satunya yang menangkapnya adalah pemeriksaan rencana query yang berjalan otomatis.

---

## Fase 1 — Irisan Vertikal: `QUEUE_REG`

**Sasaran:** satu pemicu menembus seluruh pipeline dan mengirim WhatsApp sungguhan ke nomor pengembang.

Dipilih `QUEUE_REG` (nomor antrian dari `reg_periksa`) karena paling sederhana: watermark lugas pada `(tgl_registrasi, jam_reg)`, kunci alami tunggal `no_rawat`, dan tidak butuh penggabungan.

| # | Pekerjaan | Catatan |
|---|---|---|
| 1.1 | `core/phone.ts` — normalisasi + uji unit | **Perlu keputusan Anda, lihat di bawah** |
| 1.2 | `core/idempotency.ts` — pembentuk kunci SHA1 | |
| 1.3 | `core/template.ts` — pengganti `{variabel}` | |
| 1.4 | `khanza/antrian.ts` — query `reg_periksa` + join `pasien`/`poliklinik`/`dokter` | SQL mentah, bukan model |
| 1.5 | `worker/poller.ts` — siklus + watermark + `INSERT IGNORE` | |
| 1.6 | `worker/wa-client.ts` — pembungkus whatsapp-web.js, QR ke `wa_session` | |
| 1.7 | `worker/dispatcher.ts` — ambil → kirim → catat | |
| 1.8 | `worker/index.ts` — titik masuk + penanganan sinyal | |
| 1.9 | Halaman QR minimal (satu halaman, tanpa autentikasi dulu) | dibuang di Fase 3 |

### 1.1 memerlukan keputusan Anda

`core/phone.ts` bukan pekerjaan mekanis — ada penilaian yang hanya Anda yang tahu jawabannya, dan pilihannya menentukan berapa banyak pasien yang bisa dihubungi.

Kerangkanya sudah jelas dari ARCHITECTURE §5.1. Yang belum diputuskan adalah **seberapa agresif menyelamatkan nomor yang tidak baku**:

```ts
/**
 * Menormalkan nomor telepon Indonesia ke E.164 (628xxxxxxxxx).
 *
 * Data nyata yang harus dihadapi (dari 8.117 baris sik.pasien):
 *   '081200000048'  → jelas, 08 di depan
 *   '81200000086'   → kehilangan 0 di depan
 *   '2341231231'    → bukan nomor seluler
 *   '-' / ''        → tidak diisi
 *
 * PERTIMBANGAN — ini yang perlu Anda putuskan:
 *
 *   Longgar : selamatkan sebanyak mungkin. Lebih banyak pasien terjangkau,
 *             tetapi tebakan yang salah mengirim informasi layanan seorang
 *             pasien KE NOMOR ORANG LAIN.
 *
 *   Ketat   : hanya terima yang benar-benar meyakinkan. Lebih banyak pasien
 *             masuk antrean koreksi manual, tetapi salah kirim mendekati nol.
 *
 * Kasus konkret yang membelah keduanya:
 *   '812345678'    9 digit — terlalu pendek untuk nomor Indonesia yang sah.
 *                  Terima sebagai 62812345678, atau tolak?
 *   '6281200000048 ' spasi di ujung — jelas aman dirapikan.
 *   '0812-0000-0048' bertanda hubung — jelas aman dirapikan.
 *   '081200000048/081234567890' dua nomor di satu kolom. Ambil yang pertama,
 *                  atau tolak seluruhnya?
 */
export function normalizePhone(raw: string | null): PhoneResult {
  // TODO(Anda): terapkan langkah 1-7 dari ARCHITECTURE §5.1
}
```

Saya sarankan **ketat**, karena akibat salah kirim di konteks rumah sakit tidak sebanding dengan keuntungan menjangkau beberapa pasien tambahan — dan halaman koreksi di Fase 3 memberi jalan keluar yang aman. Tetapi Anda yang tahu seberapa sering petugas benar-benar akan membuka halaman koreksi itu. Kalau jawabannya "jarang", perhitungannya berubah.

Kasus `'081200000048/081234567890'` layak diperiksa dulu ke data sungguhan sebelum diputuskan — bila polanya sering muncul, ia perlu penanganan tersendiri.

**Definition of Done**

```bash
npx jest core/phone          # seluruh uji lolos, termasuk 4 kasus nyata di atas
npm run worker               # QR muncul, dipindai, status ready
# lalu: daftarkan satu pasien uji di Khanza dengan nomor Anda sendiri
# dalam ≤ 60 detik WhatsApp masuk berisi nomor antrian yang benar
```

Dan pembuktian yang paling menentukan:

```sql
-- jalankan poller dua kali berturut-turut pada data yang sama
SELECT COUNT(*) FROM outbox WHERE trigger_code='QUEUE_REG';
-- angkanya TIDAK BOLEH bertambah pada jalan kedua
```

---

## Fase 2 — Pemicu Selebihnya

Pipeline sudah terbukti. Fase ini menambah lebar dengan pola yang sama.

| # | Pemicu | Kerumitan khusus |
|---|---|---|
| 2.1 | `BOOK_CONFIRM` | lugas |
| 2.2 | `BOOK_CANCEL` | **kelas pindai** — tanpa watermark, kunci idempoten menyertakan `status` |
| 2.3 | `BOOK_REMIND` | dijadwalkan node-cron, bukan polling |
| 2.4 | `RESULT_READY` | **penggabungan** per `(no_rawat, jenis, tgl_periksa)` — hindari belasan pesan untuk satu panel lab |
| 2.5 | `PHARMACY_READY` | **zero-date** `tgl_penyerahan <> '0000-00-00'` |
| 2.6 | `BILLING_READY` | perlu keputusan: kirim ke pasien atau ke `reg_periksa.p_jawab`? (PRD §10 nomor 3) |

**Definition of Done**

```bash
npx jest                     # seluruh uji pemicu lolos
npm run poll:dryrun          # cetak apa yang AKAN dikirim, tanpa mengirim
```

Mode `dryrun` bukan tambahan opsional. Ia satu-satunya cara mengarahkan poller ke salinan data rumah sakit sungguhan dan memeriksa hasilnya tanpa risiko mengirim ratusan WhatsApp keliru.

Uji khusus yang wajib ada di fase ini:

- `RESULT_READY`: satu kunjungan dengan 8 baris `periksa_lab` harus menghasilkan **tepat 1** baris outbox
- `BOOK_CANCEL`: perubahan status `'Belum'` → `'Dokter Berhalangan'` menghasilkan pesan baru; pindaian berikutnya tidak
- `PHARMACY_READY`: baris `'0000-00-00'` tidak pernah menghasilkan pesan

---

## Fase 3 — Dashboard

| # | Halaman | Isi |
|---|---|---|
| 3.1 | Autentikasi | NextAuth Credentials + `app_user`, peran `admin`/`operator`, `bcrypt` native cost 12, sesi 8 jam, kunci 15 menit setelah 5 kegagalan, ikat ke `127.0.0.1` |
| 3.2 | Koneksi | QR, status, sambung ulang, keluar |
| 3.3 | Antrean | tabel `outbox` dengan saringan status, kirim ulang manual |
| 3.4 | Template | sunting per pemicu, pratinjau data contoh, validasi nama variabel |
| 3.5 | Nomor bermasalah | daftar dari `patient_contact`, dikelompokkan per alasan, form koreksi |
| 3.6 | Daftar tolak | lihat & tambah manual |
| 3.7 | Pengaturan | interval, jam tenang, laju kirim, daftar layanan sensitif, ambang basi |
| 3.8 | Log | riwayat + alasan gagal |
| 3.9 | Audit | catatan tindakan petugas |

Halaman 3.5 adalah yang menentukan apakah sasaran "45% → 70% pasien punya nomor valid" tercapai. Rancang untuk penggunaan berulang oleh petugas pendaftaran: dapat dicari berdasarkan nama atau nomor RM, satu form per baris, tanpa perlu berpindah halaman.

**Definition of Done**

```bash
npx tsc --noEmit             # exit 0
npm run lint                 # 0 error
npm run build                # exit 0
```

Ditambah pemeriksaan yang harus benar-benar dijalankan, bukan diasumsikan:

| Diuji | Cara | Harapan |
|---|---|---|
| Otorisasi peran | Buka Pengaturan dan Audit sebagai `operator` | Ditolak |
| Otorisasi di API, bukan hanya UI | Panggil endpoint pengaturan langsung dengan cookie `operator` | 403, bukan 200 |
| Kunci tebak paksa | 6 kali login salah | Terkunci pada percobaan ke-6, tercatat di audit |
| Pengikatan jaringan | `curl http://<IP-LAN>:3100` dari komputer lain | Tidak terhubung |
| Sesi kedaluwarsa | Majukan jam 9 jam | Diminta masuk ulang |
| Penyuntikan template | Ubah `nm_pasien` uji menjadi `{kontak_rs}`, pratinjau | Tercetak apa adanya, tidak tergantikan |

Baris terakhir menguji ARCHITECTURE §9.2. Bila nomor telepon rumah sakit muncul di tempat nama pasien, mesin template melakukan penggantian berulang dan harus diperbaiki sebelum lanjut.

Baris kedua penting karena menyembunyikan tombol di antarmuka bukan otorisasi. Pemeriksaan peran harus ada di sisi server pada setiap route yang mengubah data.

---

## Fase 4 — Pengamanan Operasional

Semua yang membuat sistem selamat di dunia nyata.

| # | Pekerjaan |
|---|---|
| 4.1 | Jam tenang + penundaan, dengan `BOOK_CANCEL` dikecualikan |
| 4.2 | Ambang basi per pemicu |
| 4.3 | Pembatas laju + jeda acak 3–8 detik + kuota per jam |
| 4.4 | Percobaan ulang berjenjang; pemisahan gagal sementara vs permanen |
| 4.5 | Pendengar `STOP`/`BERHENTI` + balasan konfirmasi |
| 4.6 | Penyaring layanan sensitif + template generik |
| 4.7 | Denyut jantung + pemeriksaan kesehatan + restart otomatis saat Chromium menggantung |
| 4.8 | node-cron pembersihan berkala |
| 4.9 | `ecosystem.config.js` — `wakhanza-worker` **wajib** `instances: 1, exec_mode: 'fork'`, `max_memory_restart: '800M'` |
| 4.10 | Skrip cadangan **terenkripsi**: database `wakhanza` **dan** direktori `.wwebjs_auth`, plus uji pemulihan |
| 4.11 | Pemeriksaan daftar tolak kedua, tepat sebelum kirim (ARCHITECTURE §9.8) |
| 4.12 | Resolusi kontak berkelompok + muat `poliklinik`/`dokter`/`setting` ke memori (§12.2) |
| 4.13 | Paginasi sisi basis data untuk outbox, log, dan nomor bermasalah (§12.5) |
| 4.14 | Puppeteer tanpa `--no-sandbox`; worker berjalan sebagai akun layanan non-Administrator (§9.6) |

**Definition of Done** — masing-masing dibuktikan, bukan diasumsikan:

| Diuji | Cara |
|---|---|
| Jam tenang | majukan jam sistem ke 22.00, pastikan pesan tertunda bukan terkirim |
| Ambang basi | sisipkan baris outbox dengan `event_at` 8 jam lalu, pastikan menjadi `expired` |
| Berhenti berlangganan | balas `STOP` dari HP uji, pastikan pesan berikutnya `skipped_opt_out` |
| Layanan sensitif | masukkan satu poli ke daftar, pastikan isi pesan berubah generik |
| Percobaan ulang | matikan jaringan saat mengirim, pastikan diulang lalu berhasil |
| Restart | `pm2 restart wakhanza-worker` di tengah antrean — tidak ada pesan hilang, tidak ada yang ganda |
| Berhenti saat tertunda | Balas `STOP` selagi ada pesan tertahan jam tenang, pastikan tidak terkirim saat jendela buka |
| Batas memori | Biarkan worker jalan semalam, pastikan restart karena memori pulih tanpa scan QR ulang |
| Anggaran query | `poll_cursor.last_run_at` sepanjang sehari — tidak ada siklus melampaui 500 ms |
| Pemulihan cadangan | Pulihkan ke mesin bersih, pastikan sesi WhatsApp hidup tanpa scan ulang |

Baris "restart" adalah uji yang paling banyak menemukan bug. Baris "berhenti saat tertunda" menguji hal yang mudah terlewat: daftar tolak diperiksa saat memasukkan ke antrean, tetapi pesan bisa menunggu berjam-jam sebelum terkirim.

Baris "pemulihan cadangan" adalah satu-satunya bukti bahwa cadangan benar-benar berfungsi. Cadangan yang tidak pernah diuji bukan cadangan.

---

## Fase 5 — Uji Coba Terbatas

Jangan langsung menyalakan ke seluruh pasien.

| Tahap | Cakupan | Lama | Yang diamati |
|---|---|---|---|
| 5.1 | Hanya `dryrun` pada salinan data RS | 3 hari | Volume nyata, isi pesan, berapa banyak yang gagal normalisasi |
| 5.2 | Nyala untuk **satu poli** saja, satu pemicu (`QUEUE_REG`) | 1 minggu | Keluhan pasien, laporan spam, kesehatan nomor |
| 5.3 | Tambah pemicu satu per satu | 2 minggu | Duplikat, salah sasaran, beban server |
| 5.4 | Seluruh poli, seluruh pemicu | — | Metrik PRD §8 |

Tahap 5.1 juga menjawab pertanyaan terbuka PRD §10 nomor 1 (volume harian sesungguhnya) — angka yang menentukan laju kirim dan interval polling, dan yang **tidak bisa** diambil dari database pengembangan ini. Basis data yang diperiksa berisi 34.235 baris `reg_periksa` historis tetapi hanya 1–2 registrasi per hari belakangan; itu jelas salinan pengembangan, bukan cerminan beban nyata.

**Kriteria berhenti** — bila salah satu terjadi, matikan dan selidiki:

- Ada pasien menerima pesan ganda
- Ada pesan sampai ke nomor yang salah
- WhatsApp memberi peringatan pada nomor RS
- Beban query wakhanza terlihat mengganggu SIMRS

---

## Urutan Pengerjaan & Ketergantungan

```
Fase 0 ──► Fase 1 ──► Fase 2 ──┐
                │              ├──► Fase 5
                └──► Fase 3 ───┤
                     Fase 4 ───┘
```

Fase 3 dan 4 boleh berjalan paralel setelah Fase 1 selesai. Fase 5 menuntut keempatnya rampung.

**Fase 1 adalah penghalang mutlak.** Sebelum satu WhatsApp sungguhan berhasil terkirim dari data `reg_periksa` nyata, jangan menulis pemicu kedua. Setiap asumsi yang salah tentang bentuk data Khanza, perilaku whatsapp-web.js, atau alur idempotensi akan terlihat di sana — dan memperbaikinya saat baru ada satu pemicu jauh lebih murah daripada saat sudah ada enam.

---

## Yang Sengaja Ditunda

| Ditunda | Kapan ditinjau ulang |
|---|---|
| Redis / BullMQ | bila volume melampaui ±50.000 pesan/hari |
| Multi rumah sakit | bila ada RS kedua yang benar-benar meminta |
| Lampiran hasil (PDF) | bila RS menerima risiko hukumnya secara tertulis |
| Balasan otomatis di luar `STOP` | bila ada penanggung jawab klinis yang bersedia memilikinya |
| Menulis nomor bersih kembali ke `sik` | kemungkinan besar tidak pernah — melanggar prinsip read-only |

---

## Berkas Rujukan

| Berkas | Isi |
|---|---|
| `PRD.md` | Apa yang dibangun dan mengapa, aturan privasi, risiko, ukuran keberhasilan |
| `TECH_STACK.md` | Teknologi yang dipakai, alasannya, dan apa yang ditolak |
| `ARCHITECTURE.md` | Cara kerjanya: proses, skema, strategi polling, mode kegagalan |
| `IMPLEMENTATION_PLAN.md` | Dokumen ini — urutan pengerjaan |

Ketiga dokumen sebelumnya harus dibaca sebelum menulis kode. Sebagian besar keputusan sulit sudah diambil di sana, lengkap dengan alasannya — termasuk alasan-alasan yang berasal dari kesalahan yang sudah terjadi pada proyek apiwa.
