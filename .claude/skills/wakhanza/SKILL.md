---
name: wakhanza
description: Aturan kerja untuk repo wakhanza (gateway WhatsApp SIMRS Khanza). Dipakai SEBELUM menyentuh kode di repo ini - terutama saat menambah pemicu, mengubah query poller, menyentuh tampilan dashboard, menjalankan verifikasi, atau memulai ulang worker. Berisi jalur verifikasi yang benar, perintah pembuktian, dan kelas kegagalan yang sudah dibayar di sini.
---

# wakhanza

Alat produksi di sebuah rumah sakit. Ia membaca database SIMRS yang sedang
dipakai petugas, dan mengirim WhatsApp ke nomor sungguhan. Dua akibatnya
mengikat seluruh isi berkas ini: **tidak ada lingkungan uji**, dan **sebagian
kesalahan tidak bisa dibatalkan**.

## Yang paling sering salah di sini: kegagalan DIAM

Hampir setiap kelas kegagalan mahal di repo ini punya bentuk yang sama --
tidak ada galat, tidak ada baris merah, dan semua yang biasa dipakai untuk
menyimpulkan "sistem sehat" menunjukkan sehat:

- `saringKunciBaru()` memeriksa kunci yang tidak pernah ditulis -> 1.043 baris
  log melaporkan pesan terkirim sementara `outbox` berisi dua.
- Satu `jam_reg` salah ketik melempar watermark ke masa depan -> **13 pasien**
  tidak menerima nomor antriannya, log melaporkan `rowsSeen 0` tiap 60 detik.
- WhatsApp pindah ke alamat `@lid` -> setiap pesan masuk dibuang di baris kedua
  listener; `auto_reply_log` nol baris tanpa satu pun galat.
- `message.id._serialized` hilang pada pesan grup -> jalur balasan stok tidak
  pernah menjawab apa pun.

Akar yang berulang: **beberapa tempat berjauhan menafsirkan sendiri satu hal
yang sama**, dan cukup satu yang menyimpang. Karena itu aturan pertama di sini:
kalau sebuah keputusan sudah punya rumahnya (`respectsOptOut()`,
`core/outboxStatus.ts`, `core/tujuanPemicu.ts`, `core/pagination.ts`,
`core/waAddress.ts`, `worker/cursor.ts`), pakai rumah itu -- jangan menghitung
ulang di tempat baru.

## Sebelum push: `npm run preflight`

Sepuluh pemeriksaan STATIS (tanpa database, 1,4 detik) atas aturan yang
pelanggarannya tidak menghasilkan galat. Sudah terpasang di hook `pre-push`.

```
nomor         alamat-wa      token          <- kebocoran; TIDAK bisa dibatalkan sesudah push
tulis-khanza  skema          kursor         <- integritas data
zona-waktu    opt-out                       <- jebakan yang sudah pernah menggigit
primitif      batas-rute                    <- aturan tampilan
```

`npm run preflight -- <nama>` menjalankan satu saja. `-- --daftar` melihat
daftarnya. Kalau sebuah temuan ternyata sah, **daftarkan pengecualiannya**
(mis. `NOMOR_CONTOH` di `scripts/checks/bocor.ts`) -- jangan longgarkan polanya.

## Repo ini PUBLIK

`github.com/pujamalca/wakhanza`. Tidak boleh masuk ke berkas terlacak: nomor
telepon sungguhan, nama pasien, no. RM, nama dokter, JID grup, kredensial,
token bot. Nilai uji baru memakai bentuk `62812000000NN`.

Ini bukan kehati-hatian teoretis: tiga nomor berpola sungguhan dan satu JID
grup pernah ikut ter-commit sebagai nilai uji, dan riwayat git menyimpannya
walau berkasnya sudah diperbaiki. **Yang sudah ter-push tidak bisa ditarik.**

Berlaku juga untuk TERMINAL: jangan `tail` log worker tanpa penyaring
(`"phoneNumber"` muncul di baris `WhatsApp siap`), jangan mencetak baris
identitas nota apa adanya, jangan menampilkan `pm2 jlist` utuh (ia memuat
seluruh env berikut kredensial database).

## Membaca database

**Jangan pakai CLI `mysql` dengan sandi di baris perintah** -- ditolak di sini.
Tulis skrip sekali pakai `.tmp-<nama>.mts` di akar repo (gitignored, dan alias
`@/` tsconfig berlaku di sana), jalankan `npx tsx`, lalu hapus.

Jebakan zona waktu, dan arahnya BERGANTUNG PADA KLIEN:

| Lewat | `@@session.time_zone` | Yang benar |
|---|---|---|
| Sequelize | `+00:00` | `TIMESTAMPDIFF` MENTAH, tanpa CONVERT_TZ |
| CLI `mysql` | `SYSTEM` (WIB) | `CONVERT_TZ(kolom,'+00:00','+07:00')` |

Salah pilih menghasilkan galat **tepat 25.200 detik**, dan tandanya terbalik
antar jalur. Denyut 3 detik pernah terbaca sebagai worker yang mati tujuh jam,
dan seluruh diagnosis di atasnya keliru.

## Menambah pemicu baru

Yang WAJIB ikut, dan yang lupa tidak mendapat satu pun galat:

1. Baris `INSERT INTO template` di migrasi bernomor.
2. Keputusan opt-out di `src/core/optOut.ts` -- `OPT_OUT_TRIGGERS` (terikat)
   atau `PEMICU_SENGAJA_BEBAS` (tidak), berikut alasannya. Kode yang tidak
   terdaftar dianggap TIDAK terikat, tanpa peringatan.
3. `TRIGGER_LABEL` dan `TRIGGER_SOURCE` di `src/components/ui/labels.ts`.
4. Pakai `enqueueMessage()` di `worker/pipeline.ts` -- jangan menyusun jalur
   sendiri. Ia yang memasang pagar opt-out, privasi, jam tenang, kode unik.
5. Watermark hanya lewat `advanceCursor()`.

`npm run preflight` menegakkan butir 2 dan 5; `npm test` menegakkan butir 3.

## Query poller

Kolom tanggal Khanza yang tampak wajar TIDAK terindeks. Tiap query wajib dua
penyaring: prefiks `no_rawat` (lewat PK) untuk memangkas, DAN perbandingan
timestamp untuk ketepatan.

Sesudah menyentuh query atau koneksi mana pun:

```bash
npm run verify:db      # buktikan sik menolak tulisan + audit_log append-only
npm run verify:plans   # EXPLAIN tiap query; gagal bila ada type:ALL tak berizin
```

Keduanya menuntut MariaDB hidup, jadi keduanya SENGAJA tidak ada di pre-push.
Jalankan sendiri.

## Tampilan dashboard

- Primitif di `src/components/ui/`, varian lewat **prop**, tidak pernah menimpa
  warna/padding/ukuran lewat `className` (timpaan bisa KALAH tanpa galat,
  tergantung urutan Tailwind menghasilkan CSS).
- Token warna di `globals.css` (`:root` DAN `.dark`), bukan `dark:bg-slate-800`
  di halaman.
- Istilah mesin tidak pernah sampai ke mata petugas: `outboxStatusLabel()`,
  `triggerLabel()`, `waStatusLabel()`. Kode aslinya tetap berdampingan
  (atribut `title`) supaya tiket dukungan bisa dicocokkan.
- Halaman yang menunggu database wajib punya `loading.tsx` dan `error.tsx` --
  boleh di tingkat grup.

## Verifikasi HTTP

**Lewat instance PM2 yang SUDAH ADA**, bukan `next start` di port sendiri:
instalasi ini berjalan di atas database produksi, jadi PM2-lah lingkungan yang
sesungguhnya.

```bash
npm run build && pm2 restart wakhanza-web    # lalu uji lewat port 3100
```

`npm run dev` MEMAAFKAN justru kelas kesalahan yang mematikan di produksi
(`trustHost` membuat setiap `/api/auth/*` menjawab 500 tanpa itu). `.next` di
disk bisa sudah baru sementara proses PM2 masih memegang kode lama di memori.

## Memulai ulang worker

**Restart BUKAN operasi rutin di sini.** Ia punya kemungkinan nyata berakhir
menuntut pemindaian QR, yang menuntut akses fisik ke ponsel nomor RS.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/restart-worker.ps1
# bawaannya MEMERIKSA SAJA; tambahkan -Jalankan untuk benar-benar restart
```

Ia menjalankan keenam pemeriksaan (status sesi, umur denyut, bendera hapus
sesi, antrean, uptime PM2, ukuran Chromium) lalu `pm2 stop` + `pm2 start` --
**tidak pernah `pm2 restart`**, karena `stop` menutup Chromium lewat
`shutdown()` sampai tuntas sementara `restart` melahirkan pengganti sebelum
yang lama melepas direktori sesi.

Yang paling sering terlewat saat dikerjakan manual: **uptime**. Di bawah ~30
menit berarti ada yang sudah menyalakannya ulang, dan restart yang KEDUA-lah
yang tersangkut. Dan saat sesi tersangkut `menautkan`, periksa **ukuran
Chromium** -- ia tidak muncul di `pm2 list` sama sekali, dan 4.384 MB pernah
membuat sistem mati enam jam dengan log yang tidak menyebut memori sekali pun.

Sesudah restart: yang perlu dikerjakan biasanya **menunggu**, bukan
menyalakan ulang lagi.

## Setiap klaim "selesai" butuh keluaran perintah

Bukan "seharusnya jalan". Buktinya ditulis di `VERIFICATION.md` dengan judul
seksi yang sama persis dengan tempat klaimnya. Pemeriksaan baru harus
dibuktikan **MENGGIGIT**: rusak sengaja, lihat ia merah, pulihkan. Dua dari
sepuluh pemeriksaan di `preflight` ternyata tidak pernah bisa merah, dan itu
hanya ketahuan karena diuji begitu.

## Peta dokumen

| Kapan | Berkas |
|---|---|
| tiap sesi | `CLAUDE.md` -- yang MENGIKAT kode |
| sebelum mengubah fitur yang ada | `FITUR.md` -- kenapa bentuknya begini, apa yang ditolak |
| saat mempertanyakan sebuah klaim | `VERIFICATION.md` -- buktinya |
| menyentuh `components/ui` | `DESIGN_SYSTEM.md` |
| menjalankan, bukan menyentuh kode | `RUNBOOK.md` |
