/**
 * Penggantian variabel `{nama}` — satu lintasan, wajib (ARCHITECTURE §9.2).
 *
 * `nm_pasien`/`nm_poli`/`nm_dokter` di sik diisi manusia tanpa batasan format
 * (N9). Pasien bernama literal "{kontak_rs}" tidak boleh membuat nomor telepon
 * rumah sakit muncul di posisi namanya — itu sebabnya String.replace dengan
 * callback (satu pemindaian kiri-ke-kanan) dipakai, BUKAN perulangan sampai
 * tidak ada lagi `{...}` yang cocok. Hasil substitusi tidak pernah diperiksa
 * ulang untuk pola `{...}`.
 */
const VAR_RE = /\{(\w+)\}/g;

/**
 * Variabel untuk ketujuh template pemicu (`template`, satu baris per
 * trigger_code). Semuanya mengacu ke SATU kunjungan yang sedang terjadi.
 *
 * `{cara_bayar}` diisi `penjab.png_jawab` ("BPJS Kesehatan"), TIDAK PERNAH
 * `reg_periksa.kd_pj` ("A02") -- lihat core/penjamin.ts. Kodenya memang
 * dibutuhkan untuk join di khanza/*.ts, tapi tidak pernah ikut keluar dari
 * SQL, jadi ia tidak punya jalan untuk sampai ke sini.
 */
export const TRIGGER_TEMPLATE_VARIABLES = [
  'nama_pasien',
  'no_rm',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
  'no_antrian',
  'nama_poli',
  'nama_dokter',
  'tanggal',
  'jam',
  'jenis_layanan',
  'cara_bayar',
  /**
   * Ketiganya hanya terisi pada KONTROL_ULANG (pengingat surat kontrol
   * non-BPJS, migrations/032). Daftar ini memang dipakai bersama seluruh
   * pemicu pasien -- `{jenis_layanan}` sudah lebih dulu begitu, terisi pada
   * pemicu HASIL saja -- jadi variabel yang tidak berlaku bagi sebuah pemicu
   * dirender kosong, bukan ditolak saat disimpan.
   *
   * `{tanggal_kontrol}` dan `{sisa_hari}` sengaja bernama SAMA dengan milik
   * BPJS_KONTROL: keduanya berarti hal yang persis sama bagi pasien, dan nama
   * kedua untuk arti yang sama adalah cara paling murah membuat staf menyalin
   * template lalu mendapat pesan berlubang.
   */
  'tanggal_kontrol',
  'sisa_hari',
  /**
   * Nomor surat kontrol -- `skdp_bpjs.no_antrian`, tercetak sebagai "NO. SURAT"
   * pada surat yang dipegang pasien. TERPISAH dari `{no_antrian}` yang sudah
   * ada di atas: yang itu nomor antrian pendaftaran pada QUEUE_REG. Kolom
   * Khanza-nya kebetulan bernama sama, artinya bagi pasien sama sekali tidak.
   */
  'no_surat_kontrol',
] as const;

/**
 * BROADCAST tidak terikat satu kunjungan -- {no_antrian}/{nama_poli}/
 * {nama_dokter}/{jenis_layanan}/{cara_bayar} mengacu ke SATU kejadian spesifik
 * yang tidak well-defined untuk segmen pasien merentang banyak kunjungan.
 * Subset ini sengaja lebih sempit dari TRIGGER_TEMPLATE_VARIABLES.
 *
 * {cara_bayar} termasuk yang dikecualikan walau segmennya PUNYA png_jawab
 * (khanza/pasienSegment.ts mengambilnya untuk kolom tabel pratinjau): yang
 * ada di sana adalah penjamin pada SATU kunjungan terpilih lewat
 * MAX(no_rawat), sementara pasien yang sama bisa datang sebagai BPJS bulan
 * lalu dan umum minggu ini. Menyebutnya di dalam pengumuman berarti
 * menegaskan sesuatu yang kebetulan benar untuk satu baris, bukan untuk
 * orangnya -- persis alasan {nama_poli} juga tidak ada di sini.
 *
 * EMPAT yang BOLEH, dan garis pemisahnya bukan "berasal dari satu kunjungan"
 * melainkan APA YANG DIJANJIKAN NAMANYA:
 *
 *   {tanggal_kunjungan}                     kunjungan yang jadi dasar segmen
 *   {kelurahan} {kecamatan} {kabupaten}     wilayah pasien
 *
 * Ketiga wilayah itu melekat pada PASIEN (`pasien.kd_kab` dsb.), bukan pada
 * kunjungan, jadi keberatan di atas tidak berlaku sama sekali. `{tanggal_kunjungan}`
 * memang berasal dari satu kunjungan terpilih -- tapi ia tidak mengaku sebagai
 * sifat orangnya, ia mengaku sebagai tanggal sebuah kunjungan, dan itu memang
 * persis yang dikandungnya. Bandingkan `{cara_bayar}`, yang dibaca pasien
 * sebagai "cara bayar SAYA" padahal isinya cara bayar satu kunjungan. Keempatnya
 * sudah lebih dulu terbaca staf di kolom tabel pratinjau segmen, jadi tidak satu
 * pun kolom `sik` baru diambil untuk ini.
 *
 * {tanggal}/{jam} SENGAJA TETAP TIDAK ADA, dan ini yang paling menggoda
 * ditambahkan karena kedua nama itu sudah dipakai konteks lain. Pada BROADCAST
 * artinya mau tak mau "kapan pesan ini dikirim", dan jam tenang bisa menahan
 * satu kiriman dari pukul 22.00 sampai 07.00 keesokan harinya -- pesan yang
 * menyebut tanggalnya sendiri lalu menyebut tanggal KEMARIN, ke seluruh
 * penerima sekaligus, tanpa satu pun galat. Alasan yang sama membuat `{waktu}`
 * pada baris kode pengiriman diisi `scheduled_at` dan bukan waktu enqueue.
 * Staf yang menyusun broadcast sudah tahu tanggal yang dimaksudnya dan bisa
 * mengetiknya; variabel yang diam-diam salah sembilan jam sehari lebih buruk
 * daripada variabel yang tidak ada.
 */
export const BROADCAST_TEMPLATE_VARIABLES = [
  'nama_pasien',
  'no_rm',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
  'tanggal_kunjungan',
  'kelurahan',
  'kecamatan',
  'kabupaten',
] as const;

/**
 * BALASAN OTOMATIS berjalan ke arah sebaliknya: dipicu pesan MASUK dari nomor
 * yang belum tentu dikenali sebagai pasien mana pun, jadi {nama_pasien}/{no_rm}
 * sengaja TIDAK tersedia -- membalas dengan nama pasien ke nomor yang cuma
 * "nomor yang mengirim WhatsApp" berarti menerka identitas, dan nomor bisa
 * berpindah tangan.
 *
 * Sebagai gantinya ada tiga variabel yang isinya dibaca langsung dari sik saat
 * membalas (bukan dari kunjungan): {jadwal_dokter}, {jadwal_hari_ini},
 * {daftar_poli}. Ketiganya informasi layanan yang memang diumumkan RS, bukan
 * data satu pasien -- lihat khanza/jadwalDokter.ts.
 */
export const AUTOREPLY_TEMPLATE_VARIABLES = [
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
  'tanggal',
  'jam',
  'jadwal_dokter',
  'jadwal_hari_ini',
  'daftar_poli',
] as const;

/**
 * NOTIFIKASI FARMASI -- satu-satunya konteks yang penerimanya STAF, dan itu
 * membalik pertimbangannya.
 *
 * Tiga daftar di atas membatasi variabel demi PASIEN yang membacanya. Di sini
 * pembatasnya justru sebaliknya: yang dilindungi adalah pasien yang TIDAK
 * membaca pesan ini, karena isinya dibaca sekian orang di sebuah grup WhatsApp.
 *
 * {no_resep} ada karena itulah yang membuat pesannya berguna: satu nomor yang
 * bisa dibuka di SIMRS. Yang sengaja TIDAK ada dan jangan ditambahkan: nama
 * obat, jumlah, aturan pakai, dan diagnosis -- src/khanza/farmasiStaf.ts memang
 * tidak pernah mengambilnya dari `sik`, dan menambahkan variabelnya di sini
 * akan jadi alasan pertama untuk mulai mengambilnya.
 *
 * {jumlah_resep} hanya terisi pada pesan REKAP (lihat farmasi.max_per_cycle);
 * pada pesan satuan ia dirender jadi string kosong seperti variabel lain yang
 * tidak diisi.
 *
 * {cara_bayar} juga TIDAK ada di sini, dan ketiadaannya disengaja meski
 * penjamin jelas berguna bagi apotek (formularium BPJS berbeda dari pembelian
 * umum). Alasannya bukan kegunaan melainkan penerimanya: daftar ini dibaca
 * sekian orang di sebuah grup WhatsApp yang keanggotaannya diatur di luar
 * sistem ini, dan status penjaminan seseorang -- "DINAS SOSIAL", "JASA
 * RAHARJA" -- mengatakan hal yang lebih pribadi daripada sekadar bahwa ada
 * resep masuk. Apotek toh membacanya di SIMRS lewat {no_resep}, tempat
 * kendali aksesnya memang ada. Menambahkannya di sini akan membalik
 * pertimbangan yang membuat seluruh daftar ini sempit.
 */
export const FARMASI_TEMPLATE_VARIABLES = [
  'no_resep',
  'nama_pasien',
  'no_rm',
  'nama_poli',
  'nama_dokter',
  'tanggal',
  'jam',
  'jumlah_resep',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * BALASAN STOK OBAT (`/farmasi`) -- dijawab atas pertanyaan yang masuk, jadi
 * daftarnya sengaja BERBEDA dari FARMASI_TEMPLATE_VARIABLES di atas.
 *
 * Yang TIDAK ada di sini, dan ketiadaannya disengaja: `{nama_pasien}`,
 * `{no_rm}`, `{no_resep}`. Pemicunya adalah sebuah NOMOR yang mengirim
 * WhatsApp, yang belum tentu pasien terdaftar mana pun -- alasan yang sama
 * persis membuat AUTOREPLY_TEMPLATE_VARIABLES juga tidak punya keduanya.
 * Menyediakannya di sini akan jadi undangan untuk mulai mencari pasien dari
 * nomor pengirim, dan sejak itu jawaban katalog berubah menjadi data pasien.
 *
 * `{cari_obat}` adalah teks yang DIKETIK penanya, dikembalikan apa adanya
 * supaya pesan "tidak ditemukan" bisa menyebut apa yang dicari.
 */
export const STOK_TEMPLATE_VARIABLES = [
  'stok_obat',
  'cari_obat',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * DARURAT STOK (`/farmasi`) -- peringatan persediaan yang dikirim TANPA ada
 * yang bertanya, jadi ia lagi-lagi berbeda dari dua daftar farmasi di atas.
 *
 * Yang TIDAK ada, dan ketiadaannya adalah pagarnya: `{nama_pasien}`, `{no_rm}`,
 * `{no_resep}`. Peringatan persediaan gudang tidak berurusan dengan seorang
 * pasien pun; menyediakan variabelnya akan jadi alasan pertama untuk mulai
 * menggabungkan katalog dengan `resep_obat`, dan penggabungan itulah yang
 * mengubah daftar barang menjadi rekam medis (lihat khanza/stokObat.ts).
 *
 * `{daftar_stok}` berbentuk banyak baris dan karena itu masuk
 * MULTILINE_VARIABLES di bawah -- aman HANYA karena core/stokDarurat.ts
 * memanggil sanitizeValue() sendiri untuk tiap nama barang dan satuan.
 */
export const DARURAT_TEMPLATE_VARIABLES = [
  'daftar_stok',
  'jumlah_habis',
  'jumlah_menipis',
  'jumlah_total',
  'nama_jenis',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * PENGADAAN OBAT, ALKES & BHP MEDIS (`/farmasi`) -- nota pembelian langsung dari
 * pemasok, dikirim ke gudang/apotek begitu transaksinya disimpan di Khanza.
 *
 * Yang TIDAK ada, dan ketiadaannya adalah pagarnya: `{nama_pasien}`, `{no_rm}`,
 * `{no_resep}`, `{nama_poli}`. Sebuah pembelian tidak berurusan dengan seorang
 * pasien pun -- dan tidak BISA, karena `pembelian`/`detailbeli` tidak punya satu
 * kolom pun yang menautkannya. Menyediakan variabelnya di sini akan jadi alasan
 * pertama untuk mulai menggabungkannya dengan `resep_obat`, dan penggabungan
 * itulah yang mengubah nota pembelian menjadi rekam medis (lihat komentar
 * pembuka `khanza/pengadaan.ts`).
 *
 * `{daftar_barang}` berbentuk banyak baris dan karena itu masuk
 * MULTILINE_VARIABLES di bawah -- aman HANYA karena `core/pengadaan.ts`
 * memanggil sanitizeValue() sendiri untuk tiap nama barang dan satuan.
 *
 * `{harga_*}` sengaja TIDAK ada sebagai variabel tersendiri: harga per barang
 * hanya muncul di dalam `{daftar_barang}`, dan hanya bila
 * `farmasi.pengadaan_harga` menyala -- saat mati, kolomnya tidak di-SELECT sama
 * sekali sehingga merendernya mustahil, bukan sekadar terlarang (§5.2).
 * `{total}`/`{potongan}`/`{ppn}`/`{tagihan}` adalah angka HEADER, yang selalu
 * dibaca karena ia yang dicocokkan gudang dengan nota pemasok.
 */
export const PENGADAAN_TEMPLATE_VARIABLES = [
  'no_faktur',
  'tgl_beli',
  'nama_suplier',
  'nama_petugas',
  'nama_gudang',
  'daftar_barang',
  'jumlah_item',
  'total',
  'potongan',
  'ppn',
  'tagihan',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * HIBAH OBAT & BHP (`/farmasi`) -- barang medis yang DITERIMA sebagai pemberian.
 *
 * Kembaran PENGADAAN_TEMPLATE_VARIABLES, dan pagarnya sama persis: tidak ada
 * `{nama_pasien}`, `{no_rm}`, `{no_resep}`, maupun `{nama_poli}`, karena
 * `hibah_obat_bhp`/`detailhibah_obat_bhp` tidak punya satu kolom pun yang
 * menautkan penerimaan barang dengan seorang pasien.
 *
 * DUA angka penutup, bukan empat, dan itu langsung dari bentuk tabelnya: sebuah
 * hibah tidak punya potongan, PPN, maupun tagihan -- tidak ada yang dibayar.
 * Yang ada sebagai gantinya adalah dua penilaian atas barang yang sama:
 *
 *   {total_hibah}    "Total Nilai Hibah"                        -- disebut pemberi
 *   {total_diakui}   "Total Pengakuan Nilai Persediaan Hibah"   -- diakui RS, dan
 *                                                                 inilah yang
 *                                                                 dijurnal Khanza
 *
 * Keduanya HEADER dan SELALU dibaca, persis seperti `{tagihan}` pada pengadaan.
 * Nilai PER BARANG hanya muncul di dalam `{daftar_barang}`, dan hanya bila
 * `farmasi.hibah_nilai` menyala -- saat mati, kolomnya tidak di-SELECT sama
 * sekali sehingga merendernya mustahil, bukan sekadar terlarang (§5.2).
 *
 * Kenapa sakelarnya TIDAK ikut memutus kedua total: label keduanya ditulis di
 * template sebagai baris tersendiri, jadi memutusnya menyisakan "Total nilai
 * hibah :" tanpa angka -- baris menggantung yang terbaca sebagai sistem rusak.
 * RS yang tidak ingin satu pun angka beredar menghapus kedua variabel ini dari
 * templatenya, satu tindakan yang terlihat. Uraian lengkapnya di
 * `khanza/hibah.ts`.
 *
 * `{daftar_barang}` dipakai bersama pengadaan dan berbentuk banyak baris, karena
 * itu masuk MULTILINE_VARIABLES di bawah -- aman HANYA karena `core/hibah.ts`
 * memanggil sanitizeValue() sendiri untuk tiap nama barang dan satuan, persis
 * seperti `core/pengadaan.ts`.
 */
export const HIBAH_TEMPLATE_VARIABLES = [
  'no_hibah',
  'tgl_hibah',
  'nama_pemberi',
  'nama_petugas',
  'nama_gudang',
  'daftar_barang',
  'jumlah_item',
  'total_hibah',
  'total_diakui',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * SURAT PEMESANAN OBAT & BHP (`/farmasi`) -- pesanan yang DIKIRIM ke pemasok.
 *
 * Pasangan PENGADAAN_TEMPLATE_VARIABLES dari ujung yang lain: yang satu
 * memberitakan barang DIPESAN, yang satu barang DITERIMA. Pagarnya sama persis:
 * tidak ada `{nama_pasien}`, `{no_rm}`, `{no_resep}`, maupun `{nama_poli}`,
 * karena `surat_pemesanan_medis`/`detail_surat_pemesanan_medis` tidak punya satu
 * kolom pun yang menautkan sebuah pesanan dengan seorang pasien.
 *
 * TIGA hal yang berbeda dari daftar pengadaan, dan ketiganya berasal dari bentuk
 * tabelnya -- bukan dari selera:
 *
 *   1. **TIDAK ADA `{nama_gudang}`.** `surat_pemesanan_medis` tidak punya
 *      `kd_bangsal` sama sekali, karena sebuah pesanan belum menentukan gudang
 *      mana yang akan menerimanya -- itu baru diputuskan saat penerimaan. Jadi
 *      variabelnya bukan sekadar tidak dicantumkan: tidak ada kolom yang bisa
 *      mengisinya.
 *
 *   2. **ADA `{meterai}`.** Bea meterai tidak dipunyai `pembelian`, dan Khanza
 *      memasukkannya ke tagihan (`InventorySuratPemesanan.java:1205`:
 *      `tagihan = ttl + ppn + meterai`). Mencetak tagihan tanpa menyebutnya
 *      membuat angka penutupnya tidak bisa dicocokkan dengan penjumlahan di
 *      layar Khanza.
 *
 *   3. **ADA `{status}`.** enum('Proses Pesan','Sudah Datang'), satu-satunya
 *      kolom pemicu di proyek ini yang berubah sesudah barisnya tertulis. Ia
 *      dicetak sebagai KETERANGAN dan tidak pernah masuk kunci idempoten --
 *      staf membalikkannya lewat klik kanan, dan arah baliknya tanpa penjaga
 *      sama sekali. Uraiannya di `worker/pemesananRunner.ts`.
 *
 * `{tgl_pemesanan}`, bukan `{tanggal}`: kolomnya memang bernama `tanggal` di
 * Khanza, tapi nama itu sudah dipakai SELURUH pemicu untuk waktu pesannya
 * dikirim. Padanan `{tgl_beli}` pada pengadaan dan `{tgl_hibah}` pada hibah.
 *
 * Kelima angka penutup SELALU dibaca; `farmasi.pemesanan_harga` hanya memutus
 * harga PER BARANG di dalam `{daftar_barang}` -- saat mati, kolomnya tidak
 * di-SELECT sama sekali sehingga merendernya mustahil, bukan sekadar terlarang
 * (§5.2). Sebabnya sudah dibayar di hibah: label angka penutup ditulis di
 * template sebagai baris tersendiri, jadi memutusnya menyisakan baris
 * menggantung yang terbaca sebagai sistem rusak.
 *
 * `{daftar_barang}` dipakai bersama pengadaan dan hibah dan berbentuk banyak
 * baris, karena itu masuk MULTILINE_VARIABLES di bawah -- aman HANYA karena
 * `core/pemesanan.ts` memanggil sanitizeValue() sendiri untuk tiap nama barang
 * dan satuan.
 */
export const PEMESANAN_TEMPLATE_VARIABLES = [
  'no_pemesanan',
  'tgl_pemesanan',
  'nama_suplier',
  'nama_petugas',
  'status',
  'daftar_barang',
  'jumlah_item',
  'total',
  'potongan',
  'ppn',
  'meterai',
  'tagihan',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * PENJUALAN OBAT, ALKES & BHP (`/farmasi`) -- nota penjualan apotek.
 *
 * Daftar ini adalah tempat aturan privasi pemicu tersebut DITEGAKKAN untuk
 * kedua kalinya, dan pengulangannya disengaja.
 *
 * Ketiga nota barang lain (pengadaan, pemesanan, hibah) tidak punya variabel
 * pasien karena tabel sumbernya memang tidak punya kolomnya -- di sana
 * ketiadaan variabel cuma mengikuti kenyataan. `penjualan` BERBEDA: ia punya
 * `no_rkm_medis` DAN `nm_pasien`, dan `detailjual` punya nama obatnya. Digabung,
 * keduanya persis "obat APA yang diterima SIAPA".
 *
 * Jadi di sini ketiadaan `{nama_pasien}`/`{no_rm}` adalah KEPUTUSAN, bukan
 * kebetulan, dan ia dijaga dua lapis dengan alasan yang berbeda: query-nya tidak
 * pernah men-SELECT kolomnya (itu yang menentukan datanya sampai ke proses ini
 * atau tidak), dan daftar ini tidak punya variabelnya (itu yang dilihat orang
 * saat menyusun template, dan yang menolak simpan bila ada yang mengetiknya).
 * Pola yang sama dengan `status_prb` pada BPJS_KONTROL_TEMPLATE_VARIABLES.
 *
 * `{no_nota}` dan `{tgl_jual}` -- bukan `{no_faktur}`/`{tanggal}`. Yang pertama
 * karena Khanza menyebutnya nota, bukan faktur, dan menyamakannya dengan
 * pengadaan akan membuat dua nomor yang bentuknya mirip tapi artinya berlawanan
 * (yang satu dibeli, yang satu dijual) memakai nama yang sama. Yang kedua karena
 * `{tanggal}` sudah dipakai SELURUH pemicu untuk waktu pesannya dikirim --
 * padanan `{tgl_beli}` dan `{tgl_hibah}`.
 *
 * `{status_bayar}` (enum 'Belum Dibayar'/'Sudah Dibayar') dicetak sebagai
 * KETERANGAN dan tidak pernah masuk kunci idempoten, dengan alasan yang sama
 * persis seperti `{status}` pada surat pemesanan: ia sakelar alur kerja yang
 * bisa dibalik staf kapan saja, jadi memasukkannya ke kunci berarti satu orang
 * yang bolak-balik menandai lunas menghasilkan pesan tanpa batas.
 *
 * Kelima angka penutup SELALU dibaca; `farmasi.penjualan_harga` hanya memutus
 * harga PER BARANG di dalam `{daftar_barang}`. Sebabnya sudah dibayar di hibah:
 * label angka penutup ditulis di template sebagai baris tersendiri, jadi
 * memutusnya menyisakan "Total : " yang menggantung tanpa angka.
 *
 * `{subtotal}` DIJUMLAHKAN dari rinciannya, bukan dibaca -- `penjualan` tidak
 * menyimpan totalnya sama sekali, hanya `ppn` dan `ongkir`. Lihat
 * `hitungTotalNota()` di core/penjualan.ts.
 *
 * `{keterangan}` ADA di sini dan sengaja TIDAK ada di template bawaan, dan
 * pembedaan itu diukur bukan dikira. Kolomnya terisi pada 7.256 dari 16.859
 * nota, tapi 7.172 di antaranya cuma penanda '-' milik Khanza yang dibuang
 * `isianSurat()` -- jadi baris "Keterangan : {keterangan}" di template bawaan
 * akan menggantung tanpa isi pada sekitar 99,5% nota. Itu persis kegagalan yang
 * sudah dibayar dua kali (label total hibah tanpa angka di migrations/031, label
 * nilai obat di 043): label menggantung terbaca sebagai sistem rusak, dan sejak
 * itu baris yang benar pun tidak dipercaya.
 *
 * Bentuknya tetap NILAI BIASA, bukan variabel yang membawa labelnya sendiri.
 * Variabel yang diam-diam mencetak "Keterangan : " akan menghasilkan
 * "Keterangan : Keterangan : obat rutin" bagi siapa pun yang menulis labelnya
 * sendiri -- dan menulis labelnya sendiri adalah hal yang setiap variabel lain
 * di daftar ini mengajarkan.
 *
 * `{keterangan}` sengaja TIDAK ada di REKAP_PENJUALAN_TEMPLATE_VARIABLES: di
 * sana tidak ada satu nota pun untuk diambil keterangannya, dan menggabungkan
 * ratusan keterangan sehari adalah cara paling cepat memindahkan seluruh teks
 * bebas kasir ke dalam satu pesan.
 */
export const PENJUALAN_TEMPLATE_VARIABLES = [
  'no_nota',
  'tgl_jual',
  'jenis_jual',
  'status_bayar',
  'nama_gudang',
  'nama_petugas',
  'keterangan',
  'daftar_barang',
  'jumlah_item',
  'subtotal',
  'ongkir',
  'ppn',
  'total',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * REKAP HARIAN PENJUALAN (`/farmasi?tab=penjualan`, migrations/041) -- satu pesan
 * sehari berisi TOTALNYA, bukan satu pesan per nota.
 *
 * Daftar TERSENDIRI, bukan menumpang `PENJUALAN_TEMPLATE_VARIABLES`, dan itu
 * bukan kerapian: hampir seluruh variabel di sana menyebut SATU nota
 * (`{no_nota}`, `{nama_petugas}`, `{daftar_barang}`) dan sama sekali tidak punya
 * arti pada agregat sehari. Digabung, staf bisa menyimpan rekap yang memuat
 * `{no_nota}` lalu menerimanya kosong setiap hari tanpa satu pun galat -- persis
 * kelas kegagalan yang pemisahan daftar per konteks ada untuk mencegahnya.
 *
 * `{penyesuaian}` dan BUKAN `{ongkir}`: pada satu nota, nama itu menamai kolom
 * Khanza yang mengisinya sehingga angkanya bisa ditelusuri; pada rekap ia sudah
 * jumlah dari ratusan nota dan tidak menunjuk satu kolom pun. Terukur, isinya
 * campuran pembulatan, potongan harga (sampai -Rp21.000), dan ongkos kirim.
 *
 * Yang TIDAK ada, dan ketiadaannya adalah pagarnya: `{nama_pasien}`, `{no_rm}`,
 * `{nama_pembeli}`. `penjualan` PUNYA `no_rkm_medis` dan `nm_pasien` -- berbeda
 * dari ketiga nota barang lain -- jadi di sini ketiadaan variabelnya adalah
 * KEPUTUSAN, bukan akibat bentuk tabel. Query-nya pun tidak pernah men-SELECT
 * keduanya, sehingga merendernya mustahil dan bukan sekadar terlarang (§5.2).
 *
 * `{status_bayar}` juga tidak ada, dan itu diukur: `penjualan.status` bernilai
 * 'Sudah Dibayar' pada SELURUH 16.793 baris. Rincian yang selamanya mengatakan
 * hal yang sama mengajari pembacanya berhenti membaca.
 *
 * `{rincian_jenis}` masuk MULTILINE_VARIABLES di bawah -- aman HANYA karena
 * `core/penjualanRekap.ts` memanggil sanitizeValue() sendiri untuk tiap nama
 * jenis, dipatok unit test tersendiri di `penjualanRekap.test.ts`.
 */
export const REKAP_PENJUALAN_TEMPLATE_VARIABLES = [
  'tanggal_rekap',
  'jumlah_nota',
  'jumlah_item',
  'jumlah_barang',
  'subtotal',
  'penyesuaian',
  'ppn',
  'total',
  'rincian_jenis',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * REKAP HARIAN RESEP (`/farmasi?tab=resep`, migrations/042) -- agregat sehari
 * penuh atas resep yang DITULIS DOKTER, dikirim ke tujuan yang sama dengan
 * notifikasi resep per kejadian.
 *
 * TERPISAH dari `FARMASI_TEMPLATE_VARIABLES` dengan alasan yang sama yang
 * memisahkan rekap penjualan dari nota penjualan: hampir seluruh variabel di
 * sana menyebut SATU resep (`{no_resep}`, `{nama_pasien}`, `{no_rm}`,
 * `{nama_poli}`) dan tidak punya arti pada agregat sehari. Digabung, staf bisa
 * menyimpan rekap yang memuat `{no_resep}` lalu menerimanya kosong setiap hari
 * tanpa satu pun galat.
 *
 * Dan di sini pemisahan itu memikul lebih dari kerapian. Daftar farmasi memang
 * punya `{nama_pasien}`/`{no_rm}` -- itulah yang membuat `farmasi.enabled` jadi
 * keputusan privasi terberat di halaman Farmasi. Rekap ini tidak punya satu pun
 * di antaranya, dan tidak bisa punya: query-nya tidak menyentuh `reg_periksa`
 * maupun `pasien` sama sekali (§5.2). Jadi daftar yang terpisah inilah yang
 * membuat "rekap tidak menyebut pasien" jadi sifat yang ditegakkan, bukan
 * kebiasaan yang bisa berubah saat seseorang menambah satu variabel.
 *
 * `{jumlah_belum_serah}` DITURUNKAN dari `{jumlah_resep}` - `{jumlah_diserahkan}`,
 * bukan di-query sendiri, sehingga ketiganya dijamin berjumlah secara aritmetika
 * dan pembaca bisa menjumlahkannya sendiri di layar.
 *
 * Yang TIDAK ada, dan keduanya karena diukur: `{status_resep}` (`resep_obat.status`
 * bernilai 'ralan' pada SELURUH 12.422 baris) dan `{jumlah_divalidasi}` (validasi
 * apotek terjadi pada praktis setiap resep -- 2024 1.782/1.782, 2025 6.130/6.130,
 * 2026 4.440/4.441 -- sehingga angkanya akan selalu sama dengan `{jumlah_resep}`).
 * Rincian yang selamanya mengatakan hal yang sama mengajari pembacanya berhenti
 * membaca; yang justru bergerak adalah PENYERAHAN, dan itulah yang masuk.
 *
 * `{rincian_dokter}` masuk MULTILINE_VARIABLES di bawah -- aman HANYA karena
 * `core/resepRekap.ts` memanggil sanitizeValue() sendiri untuk tiap `nm_dokter`,
 * dipatok unit test tersendiri di `resepRekap.test.ts`.
 */
export const REKAP_RESEP_TEMPLATE_VARIABLES = [
  'tanggal_rekap',
  'jumlah_resep',
  'jumlah_item',
  'jumlah_obat',
  'jumlah_racikan',
  'jumlah_diserahkan',
  'jumlah_belum_serah',
  /**
   * Rupiah yang SUDAH masuk penagihan atas resep hari itu (migrations/043).
   *
   * Bukan harga katalog: ia dijumlahkan dari `detail_pemberian_obat.total`, yang
   * dibekukan Khanza saat apotek memvalidasi -- jadi rekap tanggal lampau tetap
   * menyebut angka yang benar-benar ditagihkan. Lihat
   * `khanza/farmasiStaf.ts`'s `buildRekapResepNilaiSql()` untuk kenapa katalog
   * ditolak.
   *
   * Sengaja TIDAK dipecah jadi `{embalase}`/`{tuslah}`: keduanya nol pada seluruh
   * 33.198 baris setahun di sini, dan variabel yang selamanya berbunyi "Rp0"
   * mengajari pembacanya melewati bagian itu. Keduanya sudah ikut terhitung di
   * dalam angka ini.
   */
  'nilai_obat',
  'rincian_dokter',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * REKAP ASESMEN AWAL KEPERAWATAN (`/erm/penilaian-umum`, migrations/044).
 *
 * Daftar pertama di berkas ini yang memuat NAMA PASIEN sementara penerimanya
 * BUKAN pasien itu sendiri -- dan itu memang inti fiturnya: rekap yang tidak
 * menyebut siapa tidak bisa ditindaklanjuti perawat mana pun. Pembatasannya
 * karena itu ada di tempat lain, bukan di daftar ini: `erm.penilaian_enabled`
 * default MATI, dan `erm.penilaian_rincian` bisa diturunkan jadi `ringkas`
 * sehingga `{daftar_pasien}` dirender kosong sementara angkanya tetap utuh.
 *
 * Yang TIDAK ada, dan ketiadaannya adalah pagarnya: seluruh isi asesmennya --
 * `{keluhan_utama}`, `{alergi}`, `{skala_nyeri}`, `{status_psiko}`, `{rpd}`.
 * `khanza/penilaianAwal.ts` memang tidak pernah men-SELECT satu pun, jadi
 * merendernya bukan terlarang melainkan MUSTAHIL (§5.2). Yang beredar cuma
 * apakah kolomnya KOSONG, tidak pernah isinya.
 *
 * `{daftar_pasien}` masuk MULTILINE_VARIABLES -- aman HANYA karena
 * `core/penilaianRekap.ts` memanggil sanitizeValue() sendiri untuk tiap
 * `nm_pasien`, dipatok unit test tersendiri di `penilaianRekap.test.ts`.
 */
export const REKAP_PENILAIAN_TEMPLATE_VARIABLES = [
  'tanggal_rekap',
  'jumlah_total',
  'jumlah_belum',
  'jumlah_sebagian',
  'jumlah_lengkap',
  'jumlah_perlu_diisi',
  'daftar_pasien',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;


/**
 * PEMBATALAN MOBILE JKN (`/bpjs`) -- penerimanya loket/pendaftaran, jadi
 * daftarnya lebih dekat ke FARMASI_TEMPLATE_VARIABLES daripada ke daftar
 * pemicu pasien.
 *
 * `{tanggal}`/`{jam}` di sini adalah jadwal yang DIBATALKAN, bukan waktu
 * pembatalannya -- itu `{tanggal_batal}`. Dua-duanya perlu: yang pertama
 * menentukan slot mana yang jadi kosong, yang kedua menjawab "apakah ini kabar
 * baru atau yang tadi pagi sudah diurus".
 *
 * `{keterangan}` adalah alasan batal apa adanya dari Khanza ("Dibatalkan Oleh
 * Admin"). Teks bebas dari sistem luar, jadi ia satu-baris dan WAJIB lewat
 * sanitizeValue -- karena itu ia sengaja TIDAK ada di MULTILINE_VARIABLES.
 */
export const BPJS_BATAL_TEMPLATE_VARIABLES = [
  'nama_pasien',
  'no_rm',
  'nama_poli',
  'nama_dokter',
  'tanggal',
  'jam',
  'tanggal_batal',
  'keterangan',
  'jumlah_batal',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * PENGINGAT SURAT KONTROL (`/bpjs`) -- satu-satunya daftar BPJS yang dibaca
 * PASIEN, jadi bentuknya mengikuti pemicu pasien.
 *
 * Yang TIDAK ada, dan ketiadaannya adalah pagarnya: apa pun yang klinis.
 * `bridging_surat_kontrol_bpjs` menyimpan diagnosis kronis pasien apa adanya di
 * `status_prb` ('01. Diabetes Melitus', '06. Skizofrenia', ...) berikut HBA1C,
 * GDP, eGFR, dan tekanan darah. Tidak satu pun punya variabelnya di sini, dan
 * `khanza/bpjsKontrol.ts` tidak pernah men-SELECT kolomnya -- dua lapis, karena
 * daftar ini yang dilihat orang saat menyusun template, dan query itu yang
 * menentukan datanya bahkan sampai ke proses ini atau tidak.
 *
 * `{sisa_hari}` sudah berbentuk kalimat ("besok", "7 hari lagi") dari
 * core/bpjs.ts, bukan angka telanjang -- "0 hari lagi" terbaca sebagai sistem
 * rusak.
 */
export const BPJS_KONTROL_TEMPLATE_VARIABLES = [
  'nama_pasien',
  'no_rm',
  'nama_poli',
  'nama_dokter',
  'tanggal_kontrol',
  'sisa_hari',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * Gabungan seluruh konteks -- INI yang dimengerti `renderTemplate`, bukan
 * daftar yang boleh dipakai di satu tempat tertentu. Pembatasan per konteks
 * terjadi saat template DISIMPAN lewat findUnknownVariables(body, <daftar>),
 * jadi satu renderer tetap melayani semua konteks tanpa cabang.
 */
export const KNOWN_TEMPLATE_VARIABLES = [
  ...new Set([
    ...TRIGGER_TEMPLATE_VARIABLES,
    ...BROADCAST_TEMPLATE_VARIABLES,
    ...AUTOREPLY_TEMPLATE_VARIABLES,
    ...FARMASI_TEMPLATE_VARIABLES,
    ...STOK_TEMPLATE_VARIABLES,
    ...DARURAT_TEMPLATE_VARIABLES,
    ...PENGADAAN_TEMPLATE_VARIABLES,
    ...PENJUALAN_TEMPLATE_VARIABLES,
    ...REKAP_PENJUALAN_TEMPLATE_VARIABLES,
    ...REKAP_RESEP_TEMPLATE_VARIABLES,
    ...REKAP_PENILAIAN_TEMPLATE_VARIABLES,
    ...HIBAH_TEMPLATE_VARIABLES,
    ...PEMESANAN_TEMPLATE_VARIABLES,
    ...BPJS_BATAL_TEMPLATE_VARIABLES,
    ...BPJS_KONTROL_TEMPLATE_VARIABLES,
  ]),
] as const;

export type TemplateVariable =
  | (typeof TRIGGER_TEMPLATE_VARIABLES)[number]
  | (typeof BROADCAST_TEMPLATE_VARIABLES)[number]
  | (typeof AUTOREPLY_TEMPLATE_VARIABLES)[number]
  | (typeof FARMASI_TEMPLATE_VARIABLES)[number]
  | (typeof STOK_TEMPLATE_VARIABLES)[number]
  | (typeof DARURAT_TEMPLATE_VARIABLES)[number]
  | (typeof PENGADAAN_TEMPLATE_VARIABLES)[number]
  | (typeof PENJUALAN_TEMPLATE_VARIABLES)[number]
  | (typeof REKAP_PENJUALAN_TEMPLATE_VARIABLES)[number]
  | (typeof REKAP_RESEP_TEMPLATE_VARIABLES)[number]
  | (typeof HIBAH_TEMPLATE_VARIABLES)[number]
  | (typeof PEMESANAN_TEMPLATE_VARIABLES)[number]
  | (typeof BPJS_BATAL_TEMPLATE_VARIABLES)[number]
  | (typeof BPJS_KONTROL_TEMPLATE_VARIABLES)[number];

export function extractVariables(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(VAR_RE)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names];
}

/** Dipanggil saat template DISIMPAN, bukan saat dikirim (ARCHITECTURE §5.3). */
export function findUnknownVariables(body: string, allowed: readonly string[] = TRIGGER_TEMPLATE_VARIABLES): string[] {
  const known = new Set<string>(allowed);
  return extractVariables(body).filter((v) => !known.has(v));
}

/**
 * Buang karakter kendali dan baris baru, rapikan spasi berlebih, batasi
 * panjang. Nama 40 karakter berisi baris baru bisa dipakai memalsukan
 * struktur pesan supaya tampak seperti pengumuman resmi RS (§9.2).
 */
export function sanitizeValue(value: string, maxLength = 60): string {
  const cleaned = value.replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, maxLength);
}

/**
 * Variabel yang isinya SUDAH dirangkai oleh kode kita sendiri dari beberapa
 * kolom terstruktur, berbentuk banyak baris, dan karena itu dikecualikan dari
 * sanitizeValue -- yang justru bertugas membuang baris baru dan memotong di 60
 * karakter.
 *
 * Pengecualian ini aman HANYA karena perangkainya (khanza/jadwalDokter.ts)
 * memanggil sanitizeValue sendiri untuk tiap nama dokter/poli sebelum
 * menyusunnya jadi daftar. Jangan pernah menambahkan variabel ke sini yang
 * isinya datang langsung dari satu kolom sik tanpa melewati sanitizeValue --
 * itu persis lubang §9.2 yang sanitizeValue ada untuk menutupnya.
 *
 * Aturan satu lintasan tetap utuh: String.replace dengan callback memindai
 * string ASLI sekali kiri-ke-kanan dan tidak pernah memeriksa ulang hasil
 * substitusi, jadi `{kontak_rs}` yang kebetulan ada di dalam daftar jadwal
 * tetap tampil apa adanya.
 */
const MULTILINE_VARIABLES = new Set<string>([
  'jadwal_dokter',
  'jadwal_hari_ini',
  'daftar_poli',
  'stok_obat',
  'daftar_stok',
  // Dipakai TIGA pemicu: pengadaan, hibah, dan surat pemesanan. Ketiganya
  // merakitnya lewat core/notaBarang.ts dan memanggil sanitizeValue() sendiri
  // untuk tiap nama barang dan satuan -- dipatok unit test tersendiri di
  // pengadaan.test.ts, hibah.test.ts, DAN pemesanan.test.ts.
  //
  // Pengecualian ini berlaku untuk NAMA variabelnya, jadi pemicu berikutnya yang
  // memakai nama yang sama ikut mewarisinya tanpa satu baris pun perubahan di
  // sini -- dan itu justru bahayanya: tidak ada satu pun galat yang muncul bila
  // perakit baru lupa menyanitasi. Yang menambahkannya wajib menulis patokannya
  // sendiri, seperti ketiga yang sudah ada.
  'daftar_barang',
  // Rekap harian penjualan (041). Dirakit `core/penjualanRekap.ts`, yang
  // memanggil sanitizeValue() sendiri untuk tiap nama `jns_jual` -- patokannya
  // ada di penjualanRekap.test.ts, sesuai kewajiban di atas.
  'rincian_jenis',
  // Rekap harian resep (042). Dirakit `core/resepRekap.ts`, yang memanggil
  // sanitizeValue() sendiri untuk tiap `nm_dokter` -- input bebas petugas
  // Khanza. Patokannya ada di resepRekap.test.ts, dan sengaja berbentuk uji
  // PERILAKU (daftar tiga dokter yang harus tetap tiga baris sesudah
  // renderTemplate) alih-alih memeriksa keanggotaan himpunan ini: yang perlu
  // dijaga adalah akibatnya, dan akibat itu gagal DIAM -- daftarnya cuma
  // terlipat jadi satu baris lalu terpotong di 60 karakter.
  'rincian_dokter',
  // Rekap asesmen awal keperawatan (044). Dirakit `core/penilaianRekap.ts`,
  // yang memanggil sanitizeValue() sendiri untuk tiap `nm_pasien` -- input
  // bebas petugas pendaftaran Khanza, dan di sini taruhannya lebih tinggi
  // daripada nama dokter: isinya NAMA PASIEN yang dikirim ke sebuah grup, jadi
  // nama yang memuat baris baru bisa menyisipkan barisnya sendiri ke dalam
  // pesan. Patokannya di penilaianRekap.test.ts, sesuai kewajiban di atas.
  'daftar_pasien',
]);

export function renderTemplate(body: string, vars: Partial<Record<TemplateVariable, string>>): string {
  return body.replace(VAR_RE, (_match, key: string) => {
    const value = vars[key as TemplateVariable];
    if (value === undefined) return '';
    return MULTILINE_VARIABLES.has(key) ? value : sanitizeValue(value);
  });
}
