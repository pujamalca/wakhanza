# RUNBOOK wakhanza — untuk petugas & IT rumah sakit

Dokumen lain di repo ini (`CLAUDE.md`, `ARCHITECTURE.md`, `PRD.md`) ditulis untuk yang **menyentuh kodenya**. Yang ini untuk yang **menjalankannya sehari-hari**. Tidak perlu paham kodenya untuk memakai halaman ini.

Kalau ragu antara dua tindakan, pilih yang tidak mengubah apa pun lalu hubungi pengembang. Sistem ini dirancang supaya pesan **tertahan, bukan hilang**, saat ada yang mati — jadi menunggu hampir selalu lebih aman daripada menebak.

---

## 1. Apa yang berjalan di mesin ini

| Nama | Tugas | Kalau mati, akibatnya |
|---|---|---|
| `wakhanza-worker` | Membaca kejadian dari SIMRS, memegang sambungan WhatsApp, mengirim pesan | **Tidak ada pesan terkirim.** Antrean menumpuk tapi tidak hilang |
| `wakhanza-web` | Dashboard di `http://127.0.0.1:3100` | Petugas tidak bisa membuka dashboard. Pengiriman TETAP jalan |
| `pm2.exe` (service Windows) | Menyalakan kedua proses di atas, termasuk setelah mesin reboot | Keduanya tidak menyala lagi setelah restart mesin |
| Tugas `wakhanza-backup-harian` | Cadangan terenkripsi tiap 01:00 | Tidak ada cadangan baru |

Sistem ini **hanya membaca** database SIMRS Khanza. Ia tidak pernah bisa menulis, mengubah, atau menghapus apa pun di sana — ditegakkan oleh hak akses database, bukan sekadar janji. Jadi tidak ada tindakan di runbook ini yang bisa merusak data SIMRS.

---

## 2. Pemeriksaan harian (2 menit)

Buka **`http://127.0.0.1:3100/ringkasan`**. Tiga hal yang dilihat, berurutan:

1. **Panel status paling atas** — harus hijau/normal. Kalau ada peringatan, ikuti tombol "Perbaiki sekarang" di panel itu.
2. **Panel "pesan masuk"** tepat di bawahnya — nol pesan masuk seharian di nomor yang dipakai pasien adalah **tanda rusak, bukan hari sepi**.
3. **Kotak "Perlu ditinjau"** — kalau tidak nol, buka daftarnya dan lihat kenapa gagal. Ada tombol Kirim ulang di sana.

Kalau ketiganya beres, sistemnya sehat. Tidak perlu membuka apa pun lagi.

---

## 3. Gejala → tindakan

Semua perintah dijalankan dari folder `D:\laragon\www\wakhanza`.

### "Pesan tidak terkirim sama sekali"

```
pm2 list
```

- **`wakhanza-worker` tidak ada / `stopped` / `errored`** → `pm2 restart wakhanza-worker`, tunggu 1 menit, cek `/ringkasan`.
- **`online` tapi tetap tidak mengirim** → lihat halaman **Koneksi** di dashboard. Statusnya menjelaskan sendiri:
  - `qr_pending` → WhatsApp minta ditautkan ulang. Lihat bagian 4.
  - `authenticating` lebih dari 15 menit → sistem akan menyalakan ulang sendiri. Tunggu. Kalau berulang terus lebih dari satu jam, hubungi pengembang.
  - `ready` tapi antrean tidak jalan → cek jam. Pesan **sengaja ditahan pukul 21:00–07:00** (jam tenang) dan akan terkirim otomatis pagi harinya. Ini bukan kerusakan.

### "Dashboard tidak bisa dibuka"

```
pm2 restart wakhanza-web
```
Pengiriman WhatsApp **tidak terganggu** oleh ini — kedua proses berdiri sendiri.

### "Pesan tidak sampai ke satu pasien tertentu"

Buka halaman **Antrean pesan** dan ketik di kotak pencarian. Satu kotak itu menerima **tiga hal**, karena penelepon biasanya cuma tahu salah satunya:

- **No. RM** pasien
- **Nomor WhatsApp**-nya — boleh ditulis `0822...`, `62822...`, atau `+62822...`, semuanya dikenali
- **Kode pengiriman** — enam huruf/angka di baris terakhir tiap pesan (mis. `5QVC9G`). Kalau pasien bisa membacakan ini lewat telepon, inilah cara tercepat menemukan pesannya

Statusnya menjelaskan sebabnya:

| Status di layar | Artinya | Tindakan |
|---|---|---|
| Terkirim | Sudah sampai ke WhatsApp | — |
| Tanpa nomor valid | Nomor di Khanza kosong/salah bentuk | Perbaiki di halaman **Nomor bermasalah** atau minta nomornya saat pasien datang |
| Sudah berhenti | Pasien minta berhenti dikirimi | Jangan dikirim ulang — itu permintaannya |
| Gagal permanen | Sudah dicoba beberapa kali, tetap gagal | Ada tombol Kirim ulang |
| Menunggu | Masih dalam antrean / jam tenang | Tunggu |

Pesan yang lebih tua dari **90 hari** sudah dipangkas otomatis. Tidak ketemu di sini tidak berarti dulu tidak pernah terkirim.

### "Pasien minta berhenti dikirimi"

Pasien cukup membalas **`Berhenti Kirim Otomatis`** ke nomor RS. Tidak perlu tindakan petugas. Daftarnya bisa dilihat di halaman **Daftar tolak**.

Perlu diketahui: yang berhenti adalah **notifikasi otomatis** (antrean, hasil, obat, tagihan, booking). Pengumuman broadcast dan balasan otomatis TETAP berjalan — begitu memang dirancangnya, dan teks konfirmasinya menyebutkan itu ke pasien.

---

## 4. Menautkan ulang WhatsApp (scan QR)

Perlu **ponsel yang memegang nomor WhatsApp RS** ada di tangan.

1. Buka `http://127.0.0.1:3100/koneksi`. Tombolnya **hanya muncul untuk akun admin**.
2. Kalau tidak muncul QR, tekan **Sambung ulang** dan tunggu sampai satu siklus (paling lama 1 menit).
3. Di ponsel: WhatsApp → **Perangkat tertaut** → **Tautkan perangkat** → pindai QR di layar.
4. Tunggu status berubah jadi **siap**. Bisa memakan waktu beberapa menit pada penautan pertama.
5. Setelah berhasil, jalankan sekali:
   ```
   npm run harden:permissions
   ```

Tombol merah **Keluar sesi** di halaman yang sama memutus tautan WhatsApp dan **menghentikan semua notifikasi** sampai QR dipindai ulang dengan ponsel nomor RS. Jangan menekannya kecuali memang itu yang diinginkan.

**Jangan menautkan ulang berulang-ulang.** Penautan yang terlalu sering membuat WhatsApp memperlambat sinkronisasi, sehingga sesinya justru makin sering tersangkut. Kalau gagal, tunggu 15 menit sebelum mencoba lagi.

---

## 5. Cadangan dan pemulihan

Cadangan terenkripsi otomatis tiap hari **01:00**, disimpan di `backups\`, yang lebih tua dari 30 hari dipangkas sendiri.

**Memeriksa cadangan masih berjalan** (lakukan sebulan sekali):
```
dir backups
```
Harus ada berkas bertanggal kemarin/hari ini, ukurannya puluhan MB. Kalau berkas terbaru sudah berumur berhari-hari, cadangannya berhenti — hubungi pengembang.

**Memulihkan** (hanya saat benar-benar perlu, dan sebaiknya didampingi pengembang):
```
powershell -ExecutionPolicy Bypass -File scripts/restore-backup.ps1
```

> ### Yang wajib diketahui sekarang, bukan saat bencana
>
> Frasa sandi cadangan disimpan di berkas `.env` **di mesin ini juga**. Artinya: kalau disk mesin ini mati, cadangan **dan** kuncinya hilang bersamaan, dan berkas cadangan yang tersalin ke mana pun tidak bisa dibuka lagi selamanya.
>
> **Salin frasa sandi itu ke luar mesin ini** — brankas, pengelola sandi RS, atau amplop tersegel di ruang IT. Ini tidak bisa diselesaikan oleh kode.

---

## 6. Akun dashboard

```
npm run users -- list                            # lihat semua akun
npm run users -- passwd <username> <sandi-baru>  # ganti sandi
npm run users -- disable <username>              # petugas pindah/keluar
npm run users -- enable <username>
npm run users -- unlock <username>               # akun terkunci karena salah sandi 5x
```

Dua hal yang membatasi dan perlu diketahui sebelum dibutuhkan:

- **Menonaktifkan akun menghentikan LOGIN BERIKUTNYA, bukan sesi yang sedang berjalan.** Petugas yang sudah masuk tetap bisa memakai dashboard sampai sesinya habis (8 jam). Kalau harus diputus saat itu juga, hubungi pengembang — caranya membatalkan sesi SEMUA orang sekaligus.
- **Admin aktif terakhir tidak bisa dinonaktifkan.** Ini disengaja: tanpa admin, halaman pengaturan/template/broadcast tidak bisa dibuka siapa pun lagi.

---

## 7. Jangan lakukan ini

- **Jangan menjalankan `npm run worker` secara manual** saat PM2 sudah menjalankannya. Dua worker memperebutkan satu sesi WhatsApp. (Sistem akan menyelesaikannya sendiri, tapi tidak ada gunanya membuat keadaan itu.)
- **Jangan menghapus folder `.wwebjs_auth`.** Itu sesi WhatsApp — menghapusnya berarti harus scan QR ulang dengan ponsel nomor RS.
- **Jangan mengubah data lewat SQL langsung.** Semua yang perlu diubah ada di dashboard, dan lewat dashboard perubahannya tercatat di jejak audit.
- **Jangan mematikan service `pm2.exe`** di Services Windows. Itu yang menyalakan semuanya kembali setelah mesin reboot.
- **Jangan menyalakan jadwal broadcast berulang** ke banyak pasien sebelum RS memutuskan dasar persetujuannya (lihat bagian 8).

---

## 8. Keputusan yang menunggu rumah sakit (bukan urusan teknis)

Empat hal ini **sengaja dibiarkan kosong/mati** karena bukan pengembang yang berhak memutuskannya.

1. **Daftar layanan sensitif** (`/pengaturan`). Saat ini kosong. Poli yang bisa dipilih di RS ini:

   | Kode | Poliklinik |
   |---|---|
   | `U0012` | Poliklinik Jantung |
   | `U0028` | Poliklinik Mata |
   | `U0027` | Poliklinik Paru |
   | `U0003` | Poliklinik Penyakit Dalam |
   | `U0009` | Poliklinik Umum |
   | `UMU` | UMUM |

   Poli yang masuk daftar ini akan membuat pesannya diganti kalimat umum tanpa menyebut layanannya — melindungi pasien bila ponselnya dibaca orang lain.

2. **Siapa yang bertanggung jawab atas isi balasan otomatis.** Fitur ini **sedang menyala**. Pasien wajar menganggap jawaban dari nomor resmi RS sebagai jawaban RS. Perlu ada orang yang ditunjuk untuk meninjau bahwa isi tiap aturan tetap benar saat jadwal/layanan berubah.

3. **Dasar hukum broadcast**, terutama yang terjadwal berulang. Notifikasi tujuh pemicu adalah reaksi atas kejadian pasien itu sendiri; broadcast adalah pengumuman ke riwayat kunjungan lampau. Keduanya berbeda secara kebijakan walau memakai mekanisme teknis yang sama.

4. **Jam kirim pengingat H-1**, sekarang 18:00. Bisa diubah di `/pengaturan` tanpa restart.

---

## 9. Kalau harus menghubungi pengembang

Sertakan ini supaya tidak bolak-balik:

```
pm2 list
```
dan keluaran ini (30 baris terakhir catatan sistem):
```
powershell -Command "Get-Content logs\wakhanza.1.log -Tail 30"
```

Plus: sejak kapan gejalanya muncul, apakah ada yang berubah di mesin ini (update Windows, mati listrik, ganti jaringan), dan apa yang terlihat di `/ringkasan`.
