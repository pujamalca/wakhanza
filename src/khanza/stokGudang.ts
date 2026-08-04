/**
 * Satu penurunan "berapa stok barang ini", dipakai BERSAMA oleh balasan stok
 * (`stokObat.ts`) dan peringatan darurat stok (`stokDarurat.ts`).
 *
 * Berkas ini ada karena keduanya menjawab pertanyaan yang SAMA lewat dua query
 * berbeda, dan dua tempat yang menafsirkan sendiri satu hal yang sama adalah
 * bentuk kegagalan yang sudah dibayar berkali-kali di proyek ini
 * (`respectsOptOut()`, `core/outboxStatus.ts`, `kunciPesanMasuk()`). Di sini
 * akibatnya paling gampang lolos tanpa disadari: bukan galat, melainkan DUA
 * ANGKA STOK BERBEDA dari satu sistem -- pasien diberi tahu "tersedia" oleh
 * balasan otomatis pada menit yang sama apotek menerima peringatan "habis".
 *
 * Isinya menyalin dua penyaring yang dipakai Khanza sendiri di layar
 * persediaannya, dan keduanya sempat TIDAK ada di `stokObat.ts`:
 *
 * 1. `bangsal.status = '1'` -- gudang yang sudah dinonaktifkan tidak ikut
 *    dihitung. Barisnya tidak terhapus saat gudangnya ditutup, pelajaran yang
 *    sama persis dengan `p.status='1'` pada jadwal dokter dan `b.status='1'`
 *    pada katalog barang.
 * 2. Cabang batch. Khanza menghitung stok dari baris ber-`no_batch` ATAU dari
 *    baris tanpa batch, tidak pernah keduanya. Menjumlahkan semuanya akan
 *    menggandakan stok di apotek yang memakai batch.
 */

/**
 * Apakah instalasi Khanza ini memakai penomoran batch.
 *
 * Khanza menyimpannya di luar jangkauan yang bisa dibaca dengan andal dari
 * sini, jadi ia menjadi pengaturan `farmasi.stok_pakai_batch` di dashboard --
 * dan pemanggil yang membacanya, bukan modul ini. Modul `khanza/` tidak pernah
 * menyentuh database `wakhanza`; batas itu yang membuat `npm run verify:db`
 * bisa membuktikan `sik` hanya dibaca.
 *
 * Bawaannya `false` bukan tebakan: seluruh 907 baris `gudangbarang` di mesin
 * ini ber-`no_batch = ''`, jadi cabang inilah yang benar di sini. Instalasi
 * yang memakai batch WAJIB menyalakannya, kalau tidak setiap barang terbaca
 * berstok nol dan peringatan daruratnya menyebut seluruh katalog.
 */
export type ModeBatch = boolean;

/**
 * Kondisi ON untuk join ke `gudangbarang`.
 *
 * Diletakkan di ON, bukan WHERE, dan itu wajib: dengan `LEFT JOIN`, kondisi di
 * WHERE menggugurkan barang yang belum punya satu pun baris stok -- barang
 * yang justru paling perlu muncul di daftar darurat.
 */
export function kondisiBatchSql(pakaiBatch: ModeBatch): string {
  return pakaiBatch
    ? "g.no_batch <> '' AND g.no_faktur <> ''"
    : "g.no_batch = '' AND g.no_faktur = ''";
}

/**
 * Dua baris JOIN yang harus menyertai setiap perhitungan stok.
 *
 * `bangsal` di-LEFT JOIN (bukan INNER) dengan alasan yang sama seperti di atas:
 * INNER akan membuang barang tanpa baris stok sama sekali.
 */
export function joinGudangSql(pakaiBatch: ModeBatch): string {
  return `
    LEFT JOIN gudangbarang g ON g.kode_brng = b.kode_brng AND ${kondisiBatchSql(pakaiBatch)}
    LEFT JOIN bangsal bg ON bg.kd_bangsal = g.kd_bangsal`;
}

/**
 * Ekspresi jumlah stok yang boleh dihitung.
 *
 * `CASE` di dalam `SUM`, bukan penyaring `bg.status='1'` di WHERE: penyaring
 * akan menggugurkan seluruh barangnya begitu ia hanya punya stok di gudang
 * nonaktif, sehingga barang yang stok efektifnya NOL malah hilang dari daftar
 * darurat -- kebalikan persis dari yang dibutuhkan.
 */
export const JUMLAH_STOK_SQL = `COALESCE(SUM(CASE WHEN bg.status = '1' THEN g.stok END), 0)`;
