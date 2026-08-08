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
   * RESULT_READY saja -- jadi variabel yang tidak berlaku bagi sebuah pemicu
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
 * {nama_dokter}/{tanggal}/{jam}/{jenis_layanan}/{cara_bayar} mengacu ke SATU
 * kejadian spesifik yang tidak well-defined untuk segmen pasien merentang
 * banyak kunjungan. Subset ini sengaja lebih sempit dari
 * TRIGGER_TEMPLATE_VARIABLES.
 *
 * {cara_bayar} termasuk yang dikecualikan walau segmennya PUNYA png_jawab
 * (khanza/pasienSegment.ts mengambilnya untuk kolom tabel pratinjau): yang
 * ada di sana adalah penjamin pada SATU kunjungan terpilih lewat
 * MAX(no_rawat), sementara pasien yang sama bisa datang sebagai BPJS bulan
 * lalu dan umum minggu ini. Menyebutnya di dalam pengumuman berarti
 * menegaskan sesuatu yang kebetulan benar untuk satu baris, bukan untuk
 * orangnya -- persis alasan {nama_poli} juga tidak ada di sini.
 */
export const BROADCAST_TEMPLATE_VARIABLES = ['nama_pasien', 'no_rm', 'nama_rs', 'alamat_rs', 'kontak_rs'] as const;

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
]);

export function renderTemplate(body: string, vars: Partial<Record<TemplateVariable, string>>): string {
  return body.replace(VAR_RE, (_match, key: string) => {
    const value = vars[key as TemplateVariable];
    if (value === undefined) return '';
    return MULTILINE_VARIABLES.has(key) ? value : sanitizeValue(value);
  });
}
