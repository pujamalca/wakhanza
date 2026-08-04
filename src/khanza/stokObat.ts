import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { JUMLAH_STOK_SQL, joinGudangSql, type ModeBatch } from './stokGudang';
import type { BarisStokObat } from '@/core/stokObat';

/**
 * Stok dan harga obat -- sumber data untuk BALASAN STOK OBAT di `/farmasi`.
 *
 * Modul khanza/ KEDUA yang tidak membaca kejadian seorang pasien (yang pertama
 * `jadwalDokter.ts`). Yang dibaca di sini adalah KATALOG barang milik apotek:
 * `databarang` (daftar obat + harga) dan `gudangbarang` (stok per batch).
 * Tidak ada satu pun kolom yang menghubungkan sebuah obat dengan seorang
 * pasien, dan itu perbedaan yang menentukan.
 *
 * PENTING supaya tidak tertukar dengan larangan di CLAUDE.md: aturan "nama obat
 * tidak pernah diambil dari sik" berlaku untuk `resep_obat` -- obat APA yang
 * diterima SIAPA. Itu rekam medis. Sebuah katalog harga dan stok gudang bukan
 * milik siapa pun; ia setara daftar harga yang ditempel di loket apotek. Jangan
 * pernah menggabungkan modul ini dengan `resep_obat`/`detail_pemberian_obat`,
 * karena penggabungan itulah yang mengubahnya menjadi data pasien.
 */

/**
 * `status='1'` menyaring barang yang sudah dinonaktifkan di Khanza.
 *
 * Tanpa itu, obat yang sudah tidak dijual lagi tetap dijawab lengkap dengan
 * harga lamanya -- dan pasien datang menanyakan barang yang tidak ada. Sama
 * persis dengan pelajaran `p.status='1'` pada query jadwal dokter: baris lama
 * tidak ikut terhapus saat layanannya dihentikan.
 *
 * `LEFT JOIN` pada gudangbarang, bukan INNER: obat yang belum pernah punya
 * baris stok sama sekali harus tetap muncul dengan stok 0. INNER JOIN akan
 * membuatnya hilang dari hasil, sehingga jawabannya berbunyi "tidak ditemukan"
 * padahal obatnya ada di katalog -- dua keadaan yang sangat berbeda bagi orang
 * yang bertanya.
 *
 * Penjumlahan stoknya diturunkan dari `stokGudang.ts`, BERSAMA dengan
 * peringatan darurat stok. Sampai berkas itu ada, query ini menjumlahkan
 * seluruh baris `gudangbarang` tanpa menyaring gudang nonaktif maupun cabang
 * batch -- dua penyaring yang dipakai Khanza sendiri. Di database ini hasilnya
 * kebetulan sama (seluruh 907 baris ada di bangsal aktif dan tanpa batch),
 * tapi "kebetulan sama hari ini" bukan alasan membiarkan dua penurunan hidup
 * berdampingan: yang muncul kalau keduanya menyimpang bukan galat, melainkan
 * pasien diberi tahu "tersedia" pada menit yang sama apotek menerima
 * peringatan "habis".
 */
function buildStokSql(pakaiBatch: ModeBatch): string {
  return `
    SELECT b.kode_brng, b.nama_brng, b.ralan, b.jualbebas, b.stokminimal,
           COALESCE(s.satuan, '') AS satuan,
           ${JUMLAH_STOK_SQL} AS stok
    FROM databarang b
    LEFT JOIN kodesatuan s ON s.kode_sat = b.kode_sat${joinGudangSql(pakaiBatch)}
    WHERE b.status = '1'
      AND b.nama_brng LIKE :cari
    GROUP BY b.kode_brng, b.nama_brng, b.ralan, b.jualbebas, b.stokminimal, s.satuan
    ORDER BY b.nama_brng
    LIMIT :limit
  `;
}

/**
 * Mencari obat berdasarkan potongan nama.
 *
 * `limit` dibaca pemanggil sebagai `maks + 1` supaya "ada yang terpotong" bisa
 * dibedakan dari "kebetulan pas" -- pola yang sama dipakai jadwal dokter.
 */
export async function cariStokObat(cari: string, limit: number, pakaiBatch: ModeBatch): Promise<BarisStokObat[]> {
  // Karakter wildcard SQL yang kebetulan diketik pasien dinetralkan. Tanpa ini,
  // pesan berisi '%' cocok dengan SELURUH katalog dan jawabannya jadi daftar
  // acak sepanjang limit -- bukan celah keamanan (parameternya tetap terikat),
  // tapi jawaban yang membingungkan.
  const aman = cari.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sikSelect<BarisStokObat>(buildStokSql(pakaiBatch), { cari: `%${aman}%`, limit });
}

registerPlanCheck({
  name: 'FARMASI_STOK',
  sql: buildStokSql(false),
  replacements: { cari: '%paracetamol%', limit: 6 },
  /**
   * Alias `b` = `databarang`. Pemindaian penuh di sini TIDAK bisa dihindari:
   * pencariannya `LIKE '%potongan%'`, dan tidak ada indeks B-tree yang bisa
   * melayani pola berawalan wildcard.
   *
   * Yang membuatnya tetap dapat diterima adalah sifat tabelnya, alasan yang
   * sama seperti `dokter` pada AUTOREPLY_JADWAL: `databarang` adalah KATALOG.
   * Ia tumbuh seiring jenis barang yang dijual apotek (ratusan), bukan seiring
   * jumlah pasien atau jumlah kunjungan. `gudangbarang` -- yang justru bertambah
   * per batch pembelian -- TIDAK diberi izin ini dan memang tidak
   * membutuhkannya: ia masuk lewat PRIMARY/`kode_brng`.
   *
   * `maxRows` tetap ditegakkan supaya asumsi "katalog itu kecil" gagal berisik
   * saat ternyata keliru.
   */
  allowFullScan: ['b'],
  maxRows: 5000,
});

/**
 * Cabang batch didaftarkan TERPISAH, bukan diasumsikan sama rencananya.
 *
 * Bentuk SQL-nya berbeda pada kondisi ON join `gudangbarang`, dan kondisi ON
 * adalah persis tempat optimizer memutuskan memakai indeks atau tidak. Instalasi
 * yang menyalakan `farmasi.stok_pakai_batch` menjalankan query INI, bukan yang
 * di atas -- membiarkannya tak terperiksa berarti pemeriksaan rencananya hijau
 * untuk jalur yang justru tidak dipakai di sana.
 */
registerPlanCheck({
  name: 'FARMASI_STOK_BATCH',
  sql: buildStokSql(true),
  replacements: { cari: '%paracetamol%', limit: 6 },
  allowFullScan: ['b'],
  maxRows: 5000,
});
