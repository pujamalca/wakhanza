# PRD — wakhanza

**Gateway notifikasi WhatsApp untuk SIMRS Khanza**

| | |
|---|---|
| Versi | 1.0 (draf desain) |
| Tanggal | 31 Juli 2026 |
| Status | Belum diimplementasi |
| Pemilik | Puja M Alca |

---

## 1. Ringkasan

wakhanza membaca kejadian di database SIMRS Khanza (`sik`) dan mengirim notifikasi WhatsApp ke pasien secara otomatis — tanpa mengubah satu baris pun kode maupun skema SIMRS Khanza.

Dipasang di server rumah sakit itu sendiri (on-premise), untuk satu rumah sakit, satu nomor WhatsApp.

---

## 2. Masalah

SIMRS Khanza tidak punya kanal keluar ke pasien. Tabel `sms` dan `setsms` memang ada di skema `sik`, tetapi:

- `sik.sms` adalah tabel **pesan masuk** (`sms_masuk`, `no_hp`, `pdu_pesan`) — bukan antrean kirim
- Di database yang diperiksa, `sik.sms` berisi **0 baris** dan `sik.setsms` kosong

Artinya tidak ada mekanisme notifikasi keluar yang berjalan, dan tidak ada pola outbox bawaan yang bisa diikuti.

Akibatnya di lapangan:

| Kejadian | Kondisi sekarang |
|---|---|
| Pasien booking online | Tidak ada konfirmasi. Pasien tidak yakin bookingnya masuk |
| Dokter berhalangan | Enum `booking_registrasi.status = 'Dokter Berhalangan'` diisi petugas, tapi pasien tetap datang karena tidak diberi tahu |
| Hasil lab/radiologi selesai | Pasien menunggu tanpa kepastian, atau bolak-balik menanyakan ke loket |
| Obat sudah disiapkan | Pasien menunggu di depan farmasi tanpa tahu antreannya |
| Tagihan terbit | Keluarga pasien baru tahu nominal saat di kasir |

Beban ini jatuh ke petugas: telepon manual satu per satu, atau tidak diberitahukan sama sekali.

## 3. Sasaran & Bukan Sasaran

### Sasaran

1. Notifikasi otomatis untuk 4 alur: booking, antrian, hasil penunjang, obat & tagihan
2. **Nol perubahan** pada SIMRS Khanza — tidak menulis ke `sik`, tidak menambah trigger, tidak mengubah aplikasi Java
3. Petugas non-teknis bisa mengoperasikan sendiri: scan QR, ubah template, perbaiki nomor pasien, lihat riwayat
4. Data rekam medis tidak keluar dari jaringan rumah sakit selain isi pesan yang sudah disaring

### Bukan Sasaran (versi 1)

| Tidak dikerjakan | Alasan |
|---|---|
| Multi rumah sakit / SaaS | Ditetapkan single-tenant on-prem. Menambah multi-tenancy sekarang = kompleksitas tanpa pemakai |
| Balasan otomatis / chatbot | Butuh penanganan percakapan dan tanggung jawab klinis. Versi 1 hanya satu arah keluar |
| Kirim gambar / PDF hasil | Melampirkan hasil = mengirim rekam medis lewat pihak ketiga. Ditolak di tingkat kebijakan, bukan teknis |
| Integrasi BPJS / Satusehat | Ada project terpisah (`pcare`, `bridging-apotek-online-bpjs`) |
| Menulis balik nomor telepon ke `sik` | Melanggar prinsip read-only |
| Penagihan / langganan | Ini alat internal RS, bukan produk berlangganan |

---

## 4. Pengguna

| Peran | Kebutuhan |
|---|---|
| **Pasien / keluarga** | Tahu status layanan tanpa harus bertanya ke loket. Bisa berhenti berlangganan notifikasi |
| **Petugas pendaftaran** | Tidak lagi menelepon manual saat dokter berhalangan |
| **Petugas farmasi / lab** | Tidak diinterupsi pertanyaan "sudah jadi belum?" |
| **Admin IT RS** | Memastikan layanan hidup, scan ulang QR saat sesi putus, lihat kenapa pesan gagal |

---

## 5. Kebutuhan Fungsional

### F1 — Pemantauan Kejadian

Sistem membaca `sik` secara berkala (default 60 detik) memakai koneksi **read-only**, dan mendeteksi 7 pemicu:

| Kode | Pemicu | Sumber | Kondisi |
|---|---|---|---|
| `BOOK_CONFIRM` | Booking masuk | `booking_registrasi` | baris baru, `status='Belum'` |
| `BOOK_REMIND` | Pengingat H-1 | `booking_registrasi` | `tanggal_periksa` = besok, `status='Belum'` |
| `BOOK_CANCEL` | Dokter berhalangan / batal | `booking_registrasi` | `status` berubah ke `'Batal'` atau `'Dokter Berhalangan'` |
| `QUEUE_REG` | Nomor antrian terbit | `reg_periksa` | baris baru hari ini, `no_reg` terisi |
| `RESULT_READY` | Hasil penunjang selesai | `periksa_lab`, `periksa_radiologi` | baris baru |
| `PHARMACY_READY` | Obat diserahkan | `resep_obat` | `tgl_penyerahan` terisi |
| `BILLING_READY` | Nota terbit | `nota_jalan`, `nota_inap` | baris baru |

**F1.1** Setiap pemicu wajib punya kunci idempoten. Pesan yang sama tidak boleh terkirim dua kali walaupun poller restart, berjalan tumpang tindih, atau membaca ulang rentang waktu yang sama.

**F1.2** Posisi baca terakhir per pemicu disimpan permanen, sehingga layanan mati semalam tidak menyebabkan banjir pesan susulan saat dinyalakan (lihat F5.3).

### F2 — Resolusi & Normalisasi Nomor

**F2.1** Nomor diambil dari `sik.pasien.no_tlp`. Kondisi nyata pada database yang diperiksa (8.117 pasien):

| Kondisi | Jumlah | Porsi |
|---|---|---|
| Kosong / `-` | 3.165 | 39,0% |
| Diawali `08` | 3.677 | 45,3% |
| Diawali `628` atau `+62` | 0 | 0% |
| Format lain (`81200000086`, `2341231231`) | 1.275 | 15,7% |

**F2.2** Normalisasi otomatis ke E.164 (`628xxxxxxxxx`): buang non-digit, `0…` → `62…`, `8…` → `628…`, tolak sisanya.

**F2.3** Nomor yang gagal dinormalisasi masuk daftar koreksi di database wakhanza. Petugas bisa memperbaiki lewat dashboard. Koreksi manual mengalahkan hasil otomatis.

**F2.4** `sik.pasien` **tidak pernah** diubah. Perbaikan hanya tersimpan di database wakhanza.

**F2.5** Pesan untuk pasien tanpa nomor valid dicatat berstatus `skipped_no_contact`, bukan dianggap terkirim dan bukan pula error.

### F3 — Penyusunan & Pengiriman Pesan

**F3.1** Template disimpan di database dan dapat diubah dari dashboard tanpa menyentuh kode maupun restart.

**F3.2** Variabel yang tersedia:

| Variabel | Sumber |
|---|---|
| `{nama_pasien}` | `pasien.nm_pasien` |
| `{no_rm}` | `pasien.no_rkm_medis` |
| `{nama_rs}`, `{alamat_rs}`, `{kontak_rs}` | `setting.nama_instansi` / `alamat_instansi` / `kontak` |
| `{no_antrian}` | `reg_periksa.no_reg` |
| `{nama_poli}` | `poliklinik.nm_poli` |
| `{nama_dokter}` | `dokter.nm_dokter` |
| `{tanggal}`, `{jam}` | dari baris pemicu |
| `{jenis_layanan}` | konstanta: `Laboratorium`, `Radiologi`, `Farmasi`, `Kasir` |

**F3.3** Nama rumah sakit **tidak boleh** ditulis tetap di kode — selalu dibaca dari `sik.setting`.

### F4 — Aturan Privasi Isi Pesan

Tingkat yang dipilih: **sedang — sebut layanan, jangan sebut hasil.**

**F4.1 Dilarang muncul di pesan:**

- Nilai/hasil pemeriksaan apa pun
- Nama pemeriksaan spesifik. `sik.jns_perawatan_lab` berisi antara lain `Anti HBs Ag` — mengirimkannya sama dengan membocorkan status skrining hepatitis
- Nama obat, dosis, atau jumlah
- Diagnosis, kode ICD, atau catatan medis
- Rincian tindakan pada pesan tagihan (nominal total saja)

**F4.2 Boleh muncul:** nama pasien, nomor RM, nomor antrian, nama poli, nama dokter, tanggal/jam, jenis layanan tingkat kategori, nominal total tagihan.

**F4.3 Daftar layanan sensitif.** Poli dan jenis pemeriksaan tertentu (VCT/HIV, jiwa, kulit & kelamin, onkologi, dan lain-lain sesuai keputusan RS) masuk daftar hitam yang dapat diatur. Bila pemicu berasal dari layanan tersebut, sistem **mengganti seluruh isi dengan pesan generik** tanpa menyebut poli maupun jenis layanan:

> "Bpk/Ibu {nama_pasien}, ada informasi dari {nama_rs} terkait kunjungan Anda. Silakan menghubungi {kontak_rs} atau datang ke bagian informasi."

**F4.4** Nomor tujuan wajib dipastikan milik pasien yang bersangkutan. Bila satu nomor terdaftar pada lebih dari satu nomor rekam medis (kasus lazim: satu HP untuk sekeluarga), sistem tetap mengirim tetapi mencatatnya di log berbagi-nomor untuk audit.

### F5 — Pengendalian Pengiriman

**F5.1 Jam tenang.** Default kirim hanya 07.00–21.00 WIB. Pesan di luar jam itu ditahan sampai jendela berikutnya, tidak dibuang.

**F5.2 Pembatasan laju.** Jeda acak 3–8 detik antar pesan, dan batas maksimum per jam yang dapat dikonfigurasi. Ini melindungi nomor dari deteksi spam WhatsApp.

**F5.2b Kode unik per pesan.** *(ditambahkan saat implementasi — lihat "Penyesuaian Implementasi")* F5.2 menekan **laju** kirim, tetapi tidak menyentuh pemicu deteksi spam yang kedua: banyak pesan dengan **teks yang identik**. Template tetap membuat puluhan pesan sehari hanya berbeda di nama dan nomor antrian, dan broadcast tanpa `{nama_pasien}` bisa benar-benar identik karakter per karakter untuk ratusan pasien. Setiap pesan keluar karena itu diberi kode singkat pada baris terakhir (default `Ref: {kode}`, mis. `Ref: FS3E5G`), diturunkan dari kunci idempoten pesan itu sehingga percobaan kirim ulang mengirim teks yang sama persis. Dapat diubah formatnya atau dimatikan dari dashboard Pengaturan.

**F5.3 Ambang basi.** Pesan yang pemicunya lebih tua dari ambang tertentu (default 6 jam) dibatalkan dengan status `expired`. Ini mencegah pasien menerima "nomor antrian Anda 12" keesokan paginya setelah layanan mati semalam.

**F5.4 Percobaan ulang.** Kegagalan sementara diulang maksimum 3 kali dengan jeda menaik. Kegagalan permanen (nomor tidak terdaftar di WhatsApp) langsung ditandai `failed_permanent` tanpa diulang.

**F5.5 Berhenti berlangganan.** Pasien membalas `STOP` atau `BERHENTI` → nomor masuk daftar tolak, seluruh pengiriman berikutnya ke nomor itu dilewati. Setiap pesan menyertakan cara berhenti.

### F6 — Dashboard

| Halaman | Isi |
|---|---|
| Koneksi | QR untuk scan, status sesi, tombol putus/sambung ulang |
| Antrean | Isi outbox: menunggu, terkirim, gagal, dilewati. Bisa kirim ulang manual |
| Template | Sunting template per pemicu, pratinjau dengan data contoh, aktif/nonaktif per pemicu |
| Nomor bermasalah | Daftar pasien dengan nomor tidak valid + form koreksi |
| Daftar tolak | Nomor yang berhenti berlangganan, bisa ditambah manual atas permintaan pasien |
| Pengaturan | Interval polling, jam tenang, laju kirim, daftar layanan sensitif |
| Log | Riwayat kirim dengan alasan kegagalan |

**F6.1** Dashboard wajib berautentikasi. Isinya nama pasien dan nomor telepon — ini data pribadi.

**F6.2** Setiap tindakan petugas (ubah template, koreksi nomor, kirim ulang) tercatat di log audit beserta identitas pelakunya.

---

## 6. Kebutuhan Non-Fungsional

| Kode | Kebutuhan | Ukuran |
|---|---|---|
| N1 | Tidak menulis apa pun ke `sik` | Ditegakkan hak akses MySQL, diperiksa saat proses mulai — bukan konvensi kode |
| N2 | Beban query ke `sik` tidak mengganggu SIMRS | Siklus polling < 500 ms. **Tidak ada query yang memindai tabel penuh** kecuali `booking_registrasi` — dijaga otomatis oleh `verify:plans` |
| N3 | Sesi WhatsApp bertahan melewati pembaruan dashboard | Proses web dan proses WhatsApp terpisah |
| N4 | Bertahan saat server reboot | PM2 dengan resurrect saat startup |
| N5 | Layanan mati tidak menyebabkan kehilangan pemicu | Watermark tersimpan permanen; pemicu basi dibatalkan sesuai F5.3 |
| N6 | Berjalan di server Windows RS | Node.js LTS + Chromium bundel Puppeteer |
| N7 | Data pasien tidak keluar jaringan RS | Tanpa layanan pihak ketiga, tanpa telemetri keluar |
| N8 | Query lambat tidak menumpuk di basis data RS | Batas waktu eksekusi 5 detik; siklus yang melewati batas dilewati, bukan mengantre |
| N9 | Data dari `sik` tidak dapat mengubah struktur pesan | Penggantian template satu lintasan + pembersihan nilai. Nama pasien diisi manusia dan tidak tepercaya |
| N10 | Dashboard tahan tebak paksa dari dalam jaringan RS | Kunci 15 menit setelah 5 kegagalan per nama pengguna; setiap penguncian tercatat di audit |
| N11 | Riwayat audit tidak dapat diubah aplikasi | `REVOKE DELETE, UPDATE` pada `audit_log` di tingkat MariaDB |
| N12 | Log tidak memuat data yang dapat mengidentifikasi pasien | Nomor disamarkan, nama tidak pernah dicatat, objek kesalahan Sequelize tidak pernah dicatat utuh |
| N13 | Sesi WhatsApp tidak dapat dicuri dari server | `.wwebjs_auth` berizin terbatas, dicadangkan terenkripsi, tidak pernah masuk git |
| N14 | Batas pengaman Chromium tetap aktif | Dilarang memakai `--no-sandbox`; worker berjalan sebagai akun layanan non-Administrator |

---

## 7. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| **Nomor WhatsApp RS diblokir** | Layanan mati total; nomor bisa hilang permanen | whatsapp-web.js tidak resmi — ini risiko yang diterima secara sadar. Ditekan lewat F5.2 (laju rendah), isi pesan transaksional bukan promosi, dan F5.5. Gunakan nomor khusus, **bukan** nomor utama RS |
| **39% pasien tanpa nomor** | Notifikasi tidak sampai ke sebagian besar pasien | F2.3 memberi jalur koreksi. Perlu perbaikan proses pendaftaran di RS — di luar cakupan perangkat lunak |
| **Nomor dipakai bersama satu keluarga** | Informasi layanan pasien terlihat anggota keluarga lain | F4.1–F4.3 membatasi isi. F4.4 mencatat untuk audit |
| **Pembaruan SIMRS Khanza mengubah skema `sik`** | Poller error atau salah baca | Database terpisah sehingga tidak ikut terhapus. Uji keberadaan kolom saat mulai; berhenti dengan pesan jelas bila skema berubah |
| **Chromium Puppeteer mati/menggantung** | Pesan menumpuk di outbox | Pemeriksaan kesehatan berkala; outbox bersifat permanen sehingga tidak ada pesan hilang saat proses direstart |
| **Sesi putus karena HP tidak online** | Perlu scan QR ulang | whatsapp-web.js butuh ponsel tertaut aktif berkala. Dashboard memberi peringatan status sebelum sesi benar-benar mati |
| **Nomor pasien salah → pesan ke orang lain** | Kebocoran data ke pihak tak berhak | F4 membatasi isi sehingga dampak kebocoran minimal. Koreksi manual dicatat pelakunya |
| **Query polling memperlambat SIMRS** | Petugas merasakannya saat melayani pasien | Kolom tanggal Khanza tidak terindeks; query karena itu disaring lewat primary key yang memuat tanggal. Dijaga `verify:plans` agar tidak diam-diam berubah kembali (ARCHITECTURE §4.4, §4.8) |
| **Dashboard diakses dari jaringan RS tanpa TLS** | Cookie sesi dan nama pasien terbaca di jaringan | Diikat ke `127.0.0.1` secara bawaan. Akses dari loket memerlukan reverse proxy ber-TLS — keputusan sadar rumah sakit (ARCHITECTURE §9.4) |
| **Chromium dieksploitasi lewat konten jarak jauh** | Eksekusi kode di server yang satu jaringan dengan rekam medis | Sandbox Chromium wajib aktif, akun layanan non-Administrator, versi Chromium disematkan dan diperbarui secara sengaja |

---

## 8. Ukuran Keberhasilan

| Metrik | Target |
|---|---|
| Pesan terkirim / pesan layak kirim | ≥ 95% |
| Pesan duplikat diterima pasien | 0 |
| Jeda dari kejadian sampai terkirim | ≤ 3 menit (di dalam jam tenang) |
| Baris ditulis ke `sik` | 0, selamanya |
| Pasien dengan nomor valid | naik dari 45% menjadi ≥ 70% dalam 3 bulan lewat halaman koreksi |
| Nomor WhatsApp RS diblokir | 0 kejadian |

---

## 9. Asumsi

1. Volume nyata rumah sakit target belum diketahui. Database yang diperiksa berisi 34.235 baris `reg_periksa` historis tetapi hanya 1–2 registrasi per hari belakangan — jelas salinan pengembangan. Perencanaan kapasitas harus memakai angka RS sesungguhnya sebelum dipasang.
2. Rumah sakit menyediakan satu nomor WhatsApp khusus notifikasi, terpisah dari nomor operasional.
3. Server rumah sakit dapat menjalankan Node.js dan Chromium, serta punya akses jaringan ke MariaDB `sik`.
4. Rumah sakit bertanggung jawab atas dasar hukum pengiriman notifikasi ke pasien (UU 27/2022 tentang Pelindungan Data Pribadi). Persetujuan pasien dikumpulkan lewat proses pendaftaran RS, bukan oleh perangkat lunak ini.

---

## 10. Pertanyaan Terbuka

| # | Pertanyaan | Perlu dijawab sebelum |
|---|---|---|
| 1 | Volume registrasi harian RS sesungguhnya? | Menetapkan laju kirim dan interval polling |
| 2 | Poli/pemeriksaan mana yang masuk daftar sensitif? | Mengisi konfigurasi F4.3 |
| 3 | Notifikasi tagihan: ke pasien atau ke penanggung jawab (`reg_periksa.p_jawab`)? | Implementasi `BILLING_READY` |
| 4 | Pengingat H-1 dikirim jam berapa? | Penjadwalan `BOOK_REMIND` |
| 5 | Apakah RS sudah punya persetujuan pasien untuk dihubungi via WhatsApp? | Peluncuran ke pasien nyata |
