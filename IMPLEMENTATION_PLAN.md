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
| 0.3 | Buat pengguna MySQL `wakhanza_ro` (SELECT saja) dan `wakhanza_rw` | — |
| 0.4 | `CREATE DATABASE wakhanza` + pelari migrasi + `001_init.sql` | 10 tabel terbentuk |
| 0.5 | `src/db/sik.ts` + `src/db/wakhanza.ts`, `dateStrings: true`, `pool.max: 2` untuk `sik` | — |
| 0.6 | **Pengaman read-only**: saat mulai, coba `CREATE TEMPORARY TABLE` di `sik`; berhenti bila berhasil | — |
| 0.7 | Pemeriksa skema: pastikan seluruh kolom yang dibutuhkan ada di `sik` | — |
| 0.8 | pino + berkas log berputar | — |

**Definition of Done**

```bash
npm run verify:db
# harus mencetak:
#   [ok] sik   : tersambung, 1234 tabel, kolom lengkap
#   [ok] sik   : tulis DITOLAK (benar)
#   [ok] wakhanza: tersambung, 10 tabel
```

Langkah 0.6 adalah bagian terpenting seluruh fase ini. Prinsip read-only yang hanya ditulis di dokumen akan bocor pada hari seseorang menyalin kredensial root ke `.env` karena "biar cepat". Pemeriksaan saat mulai membuat kesalahan itu mustahil lolos ke produksi.

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
 *   '085267496048'  → jelas, 08 di depan
 *   '81363222286'   → kehilangan 0 di depan
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
 *   '6285267496048 ' spasi di ujung — jelas aman dirapikan.
 *   '0852-6749-6048' bertanda hubung — jelas aman dirapikan.
 *   '085267496048/081234567890' dua nomor di satu kolom. Ambil yang pertama,
 *                  atau tolak seluruhnya?
 */
export function normalizePhone(raw: string | null): PhoneResult {
  // TODO(Anda): terapkan langkah 1-7 dari ARCHITECTURE §5.1
}
```

Saya sarankan **ketat**, karena akibat salah kirim di konteks rumah sakit tidak sebanding dengan keuntungan menjangkau beberapa pasien tambahan — dan halaman koreksi di Fase 3 memberi jalan keluar yang aman. Tetapi Anda yang tahu seberapa sering petugas benar-benar akan membuka halaman koreksi itu. Kalau jawabannya "jarang", perhitungannya berubah.

Kasus `'085267496048/081234567890'` layak diperiksa dulu ke data sungguhan sebelum diputuskan — bila polanya sering muncul, ia perlu penanganan tersendiri.

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
| 3.1 | Autentikasi | NextAuth Credentials + `app_user`, peran `admin`/`operator` |
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

Ditambah pemeriksaan manual: buka setiap halaman sebagai `operator`, pastikan halaman Pengaturan dan Audit **tidak** dapat diakses.

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
| 4.9 | `ecosystem.config.js` — `wakhanza-worker` **wajib** `instances: 1, exec_mode: 'fork'` |
| 4.10 | Skrip cadangan: database `wakhanza` **dan** direktori `.wwebjs_auth` |

**Definition of Done** — masing-masing dibuktikan, bukan diasumsikan:

| Diuji | Cara |
|---|---|
| Jam tenang | majukan jam sistem ke 22.00, pastikan pesan tertunda bukan terkirim |
| Ambang basi | sisipkan baris outbox dengan `event_at` 8 jam lalu, pastikan menjadi `expired` |
| Berhenti berlangganan | balas `STOP` dari HP uji, pastikan pesan berikutnya `skipped_opt_out` |
| Layanan sensitif | masukkan satu poli ke daftar, pastikan isi pesan berubah generik |
| Percobaan ulang | matikan jaringan saat mengirim, pastikan diulang lalu berhasil |
| Restart | `pm2 restart wakhanza-worker` di tengah antrean — tidak ada pesan hilang, tidak ada yang ganda |

Baris terakhir adalah uji yang paling banyak menemukan bug.

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
