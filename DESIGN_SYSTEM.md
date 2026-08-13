# DESIGN_SYSTEM.md

Aturan tampilan untuk `src/app/(dashboard)/**` dan `src/components/ui/**`.

Berkas ini **bukan** daftar selera. Tiap aturan di bawah lahir dari sesuatu yang
diukur di dashboard ini sendiri, dan angkanya ditulis supaya keputusannya bisa
dibantah dengan pengukuran ulang — bukan dengan pendapat.

Peta dokumen lain ada di `CLAUDE.md`. Yang menyangkut **kenapa sebuah kalimat ada
di layar** tinggal di sini; yang menyangkut **apa yang dilakukan sistemnya**
tinggal di `PRD.md`/`ARCHITECTURE.md`.

---

## Keadaan yang memicu berkas ini

Diukur atas seluruh `src/app/(dashboard)/**` + `src/components/**` sebelum
perubahan apa pun:

| Yang diukur | Angka | Artinya |
|---|---|---|
| `text-xs` | **477×** | badan teks 12px |
| `text-sm` | 186× | |
| seluruh ukuran lain | **7×** | display/title/heading praktis tidak ada |
| `font-medium` | **474×** | |
| `font-semibold` | 13× | |
| `shadow-*` | **5×** total | bukan skala elevasi, lima kebetulan |
| prosa | **83.948 karakter di 766 blok** | 32.039 (38%) di `/farmasi` saja |
| typeface | **tidak ada** | `layout.tsx` tidak memuat font sama sekali |

Kesimpulan yang ditopang angka itu: **97% teks hidup di dua ukuran yang berjarak
2px, dan 97% teks bertekanan punya berat yang sama.** Jadi judul bagian dan
keterangan di bawahnya terlihat sederajat — tidak ada yang memimpin, tidak ada
yang mundur. Itu sebab MEKANIS halaman terbaca sebagai dinding abu-abu.

**Banyaknya prosa memperparah, tapi bukan sebab tunggalnya.** Itu penting karena
dua lintasan sebelumnya menyerang prosanya saja (melipat ke `<details>`, lalu
menyembunyikan ke balik ikon `Petunjuk`) dan keduanya menurunkan angka tanpa
menyelesaikan keluhannya. Halaman yang seluruh teksnya 12px dengan berat yang
sama tetap tidak terbaca walau prosanya dipotong separuh.

---

## 1. Tipografi — peran, bukan angka

Tangganya ada di `tailwind.config.ts` sebagai `fontSize`, dan namanya menyebut
PERANNYA. Itu disengaja: "ini judul bagian" tidak boleh bisa ditulis dengan
ukuran badan teks tanpa terlihat salah saat kodenya dibaca ulang.

| Kelas | Ukuran / tinggi baris | Berat | Dipakai untuk |
|---|---|---|---|
| `text-display` | 28px / 1.2 | 600 | judul halaman, **satu** per halaman (`<h1>`) |
| `text-title` | 18px / 1.35 | 600 | judul bagian (`<h2>`) |
| `text-title-sm` | 15px / 1.4 | 600 | judul kartu / sub-bagian (`<h3>`) |
| `text-body` | 14px / 1.6 | 400 | **bawaan** antarmuka |
| `text-prose` | 14px / 1.7 | 400 | teks untuk DIBACA (bantuan, keterangan) |
| `text-label` | 13px / 1.4 | 500 | label form, kepala tabel |
| `text-caption` | 12px / 1.5 | 400 | **hanya** metadata: stempel waktu, kode mesin |

**`text-caption` bukan pengganti `text-xs`.** 12px berhenti menjadi badan teks.
Kalimat yang ditaruh di sana terbaca sebagai catatan kaki yang boleh dilewati —
yang persis kebalikan dari gunanya pada peringatan.

`text-xs`/`text-sm` bawaan Tailwind **sengaja dibiarkan ada** (skalanya di
`extend`), supaya 663 pemakaian yang sudah jalan tidak berubah arti dalam satu
malam dan perpindahannya bisa dikerjakan per halaman.

### Typeface

**Inter**, lewat `next/font` di `layout.tsx`. Dipilih karena **angka tabular**
(`tnum`), bukan karena rupanya: hampir seluruh isi dashboard ini kolom angka.
Dengan angka proporsional lebar tiap digit berbeda, sehingga kolom yang
seharusnya rata bergoyang baris demi baris — terbaca sebagai "berantakan" tanpa
pembacanya bisa menunjuk sebabnya, dan tidak ada penataan spasi yang bisa
memperbaikinya karena sebabnya di dalam fontnya.

`font-variant-numeric: tabular-nums` dipasang ke `table` di `globals.css`, jadi
setiap tabel data mendapatnya tanpa satu pun halaman perlu mengingatnya. Untuk
angka di luar tabel (kotak KPI): kelas `.tabular`.

Diunduh saat **build**, disajikan dari server sendiri — nol permintaan ke Google
saat halaman dibuka, jadi tidak ada data pemakaian yang bocor ke pihak ketiga.
Konsekuensinya: mesin yang mem-BUILD butuh internet sekali; yang MENJALANKAN
tidak. Dibuktikan pada hasil build: berkas `.woff2` ada di `.next/static/media/`,
`fonts.googleapis.com` **nol** kemunculan.

### Panjang baris

`.measure` = `max-width: 68ch`. Wajib untuk apa pun yang berisi kalimat.

Di monitor loket 1920px, satu paragraf selebar halaman menghasilkan baris ~180
karakter. Mata kehilangan tempatnya saat kembali ke awal baris, jadi paragrafnya
berhenti terbaca **justru karena ruangnya berlimpah**.

---

## 2. Warna

Merek TIDAK diubah. `--primary` tetap hijau (158 64% 32%), dan warna grafik tetap
nilai yang sudah lolos validasi buta warna (lihat catatan di `globals.css` —
mengubah salah satunya berarti menjalankan ulang validasinya, bukan menebak).

Yang ditambahkan:

| Token | Terang | Gelap | Kenapa |
|---|---|---|---|
| `--info` | 214 84% 44% | 213 90% 68% | `Callout variant="info"` dulu memakai `--primary`, sehingga kotak yang cuma menerangkan sesuatu berwarna sama dengan tombol yang minta ditekan — dua peran berlawanan, satu tanda visual |
| `--surface-raised` | = card | lebih terang | permukaan terangkat |
| `--surface-sunken` | 210 40% 98% | lebih gelap | kepala tabel, panel bersarang |
| `--shadow-color` / `--shadow-strength` | 0,05 | **0,45** | lihat §3 |

### Hierarki teks: DUA warna, bukan tiga

`--foreground` dan `--muted-foreground`. Tingkat ketiga yang lebih pudar sengaja
**tidak** ditambahkan: ia akan jatuh di bawah 4,5:1 dan gagal WCAG AA.

Yang menggantikannya **ukuran dan berat**, bukan lebih banyak abu-abu. Itu juga
aturan yang benar secara umum — hierarki lewat warna saja gagal untuk pembaca
dengan gangguan penglihatan warna.

### Yang belum diputuskan, dan sengaja dicatat

`--primary` (hijau 158°) dan `--success` (hijau 142°) berjarak **16 derajat** —
praktis tidak bisa dibedakan berdampingan. Badge "Aktif" karena itu terlihat
seperti tombol tindakan utama.

**Tidak diperbaiki di sini**, karena satu-satunya perbaikan sungguhan adalah
menggeser warna merek, dan itu keputusan pemilik sistem — bukan efek samping
pekerjaan tipografi. Yang menahan akibatnya sementara ini adalah aturan yang
sudah berlaku: status tidak pernah disampaikan warna saja, selalu berikut teks
atau ikon.

---

## 3. Elevasi

`shadow-xs` / `sm` / `md` / `lg`, warna dan kekuatannya **token per tema**.

Bayangan bawaan Tailwind hitam beropasitas rendah, dan di atas bidang gelap itu
praktis tidak terbaca — sehingga card di mode gelap kehilangan satu-satunya tanda
bahwa ia terangkat. Karena itu `--shadow-strength` 0,05 di terang dan **0,45** di
gelap. Bukan penyetelan halus; syarat supaya elevasi ada sama sekali di tema itu.

| Tingkat | Untuk |
|---|---|
| `xs` | baris/chip yang cuma perlu terpisah tipis |
| `sm` | kartu (bawaan `Card`) |
| `md` | popover, dropdown |
| `lg` | modal, laci |

---

## 4. Jarak dan kerapatan

Irama 4/8. Yang menentukan HUBUNGAN antar blok adalah jaraknya, jadi tingkatnya
punya arti — bukan pilihan bebas (`Section`, prop `jarak`):

| | Jarak | Artinya |
|---|---|---|
| `rapat` | 16px | bagian di dalam satu kartu |
| `normal` | 24px | bagian sederajat di satu halaman |
| `longgar` | 40px | wilayah yang berbeda urusannya |

### Tinggi kontrol DIPAKU

`h-9` (36px) untuk `Button size="md"`, `Input`, dan `Select` ukuran `md`.

Sebelumnya tinggi lahir dari padding + ukuran font, jadi tombol, kotak isian, dan
dropdown yang berdiri bersebelahan di satu baris saringan berakhir dengan tiga
tinggi yang berbeda beberapa piksel — cukup untuk terbaca sebagai "tidak rapi",
tidak cukup untuk siapa pun bisa menunjuk sebabnya.

### Kotak isian 16px di layar kecil

`text-base sm:text-body`. Safari iOS memperbesar halaman sendiri begitu kotak
isian yang di-fokus berukuran di bawah 16px, lalu tidak mengembalikannya. Di
tablet loket, tiap sentuhan ke kotak pencarian membuat halaman melompat — gejala
yang terbaca sebagai "aplikasinya rusak", bukan sebagai setelan tipografi.

### Tabel

`px-3 py-2` — 12px mendatar, 8px menurun. Sebelumnya `p-2` seragam, dan padding
mendatar yang sama dengan menurun membuat kolom bersebelahan nyaris bersentuhan
sehingga mata membaca dua sel sebagai satu. Tabel padat butuh kebalikannya:
rapat ke bawah (banyak baris terlihat sekaligus), lapang ke samping (kolomnya
terpisah).

Kepala tabel `text-label` di atas `bg-surface-sunken` — bidang PENUH, bukan
`bg-muted/50` yang tembus pandang dan berubah warna mengikuti apa pun yang
kebetulan ada di belakangnya.

---

## 5. Prosa — empat tingkat, dan tempatnya masing-masing

Ini bagian yang paling menentukan, dan yang paling gampang dilanggar tanpa sadar.

Halaman di proyek ini **sengaja** menuliskan alasannya di depan staf, bukan cuma
di komentar kode. **Keputusan itu dipertahankan.** Yang salah bukan adanya prosa,
melainkan TEMPATNYA: keterangan yang dibaca sekali seumur pemasangan duduk di
jalur yang dilewati petugas puluhan kali sehari.

Ujinya satu kalimat: *kalau staf menekan kontrolnya tanpa membaca ini, apakah ada
yang tidak bisa ditarik kembali?*

| Tingkat | Isi | Tempatnya | Bentuk |
|---|---|---|---|
| **A — pagar** | dibaca SEBELUM tindakan tak terbalikkan | tetap di halaman, **terbentang** | `Callout variant="warning"\|"privasi"` |
| **B — orientasi** | "halaman ini apa", "kenapa begini" | **keluar dari kanvas** | `HelpPanel` |
| **C — rujukan** | "centang ini artinya apa" | menempel pada kontrolnya | `Petunjuk` |
| **D — alasan implementasi** | kenapa kodenya begini | **keluar dari bundel** | komentar kode / `CLAUDE.md` |

### Aturan yang mengikat

- **Tingkat A tidak boleh pindah ke `HelpPanel`.** Memindahkannya menukar halaman
  yang lebih pendek dengan keputusan yang diambil tanpa keterangan. Peringatan
  data pasien dan sakelar tak terbalikkan tetap terbentang, selamanya.
- **Satu `HelpPanel` per halaman.** Bukan satu per bagian — dua pintu bantuan di
  satu layar mengembalikan persis kebisingan yang ia ada untuk menghilangkan.
- **Judul `Callout` harus utuh sendirian.** Yang selalu terlihat cuma judulnya,
  jadi judul berbunyi "Catatan" menyembunyikan seluruh pesan di balik satu klik
  yang tidak ada alasan untuk ditekan. Judul memuat KESIMPULAN, isinya ALASAN.
- **Prosa `HelpPanel` dirender di SERVER.** Ia tetap ada di HTML — bisa dicari
  Ctrl+F, bisa dibaca pembaca layar — hanya tidak tergambar sampai diminta.
  Itu yang membedakannya dari menghapus prosa.

### Kenapa melipat saja tidak cukup

Prosa yang dilipat **tetap di halaman**: masih memakan satu baris judul, masih
memutus aliran antara satu kontrol dan berikutnya. Pada halaman berisi belasan
lipatan, deretan judul terlipat itu sendiri menjadi kebisingan yang baru.
`/farmasi` punya 21 `Callout` + 27 `Petunjuk` — 48 titik keterangan di satu rute.

---

## 6. Daftar periksa sebelum menyerahkan halaman

- [ ] Satu `<h1>` (`text-display`), judul bagian `text-title`, tidak ada lompatan tingkat
- [ ] Tidak ada kalimat di `text-caption`
- [ ] Apa pun yang berisi paragraf memakai `.measure`
- [ ] Prosa tingkat B ada di `HelpPanel`, bukan di kanvas
- [ ] Peringatan tingkat A **terbentang**, tidak dilipat
- [ ] Kontrol sebaris punya tinggi sama (`h-9`)
- [ ] Status tidak pernah disampaikan warna saja
- [ ] Diperiksa di mode gelap **secara terpisah**, bukan disimpulkan dari terang
- [ ] Diperiksa pada 375 / 768 / 1024 / 1440 px
- [ ] Fokus keyboard terlihat pada semua kontrol
