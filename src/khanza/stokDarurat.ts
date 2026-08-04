import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { JUMLAH_STOK_SQL, joinGudangSql, type ModeBatch } from './stokGudang';
import type { BarisDaruratStok } from '@/core/stokDarurat';

/**
 * DARURAT STOK -- daftar barang yang stoknya sudah menyentuh atau turun di
 * bawah ambang minimal apotek.
 *
 * Menjawab pertanyaan yang berlawanan arah dengan `stokObat.ts`: yang itu
 * ditanya "berapa stok X", yang ini menjawab "apa saja yang hampir habis"
 * tanpa ada yang bertanya. Sumber datanya tetap KATALOG barang, bukan
 * `resep_obat` -- larangan "nama obat tidak pernah diambil dari sik" tetap utuh
 * (lihat komentar panjang di `stokObat.ts`), dan tidak ada satu pun kolom di
 * sini yang menautkan barang dengan seorang pasien.
 *
 * ## Kenapa satu query, sementara Khanza memakai N+1
 *
 * Layar persediaan Khanza membaca seluruh katalog, lalu untuk SETIAP baris
 * menjalankan satu query jumlah stok tersendiri di dalam `while(rs.next())`.
 * Untuk 887 barang itu 888 perjalanan ke MariaDB. Itu wajar untuk aplikasi
 * desktop yang seorang petugas jalankan sesekali; ia sama sekali tidak wajar
 * untuk proses latar yang berbagi database dengan SIMRS yang sedang dipakai
 * melayani pasien (`pool.max: 2`, ARCHITECTURE §9.1). Satu `GROUP BY ... HAVING`
 * memberi jawaban yang sama dalam satu perjalanan.
 *
 * ## Kenapa `stokminimal > 0`, padahal Khanza tidak menyaringnya
 *
 * Khanza membandingkan `stok <= stokminimal` apa adanya, sehingga barang yang
 * `stokminimal`-nya 0 dan stoknya 0 ikut terhitung darurat. Diukur terhadap
 * katalog di mesin ini: 348 baris cocok, dan 141 di antaranya adalah barang
 * ber-`stokminimal = 0` -- yaitu barang yang apoteknya memang tidak pernah
 * menetapkan ambang untuknya. "Stok 0, minimum 0" bukan keadaan darurat, itu
 * entri katalog yang belum pernah distok.
 *
 * Bedanya menentukan apakah fitur ini dipakai atau diabaikan: peringatan berisi
 * 348 baris yang 141 di antaranya kebisingan akan berhenti dibaca dalam
 * seminggu, dan peringatan yang tidak dibaca sama saja dengan tidak ada -- pelajaran
 * yang sama sudah dibayar pada pemisahan level log `debug`/`warn` di
 * `wa-client.ts`. Yang tersisa sesudah penyaringan: 207 baris (111 habis, 96
 * menipis), semuanya barang yang seseorang di apotek pernah putuskan ambangnya.
 */

/**
 * `ORDER BY stok / stokminimal` menaruh yang HABIS lebih dulu (rasio 0), lalu
 * yang paling dekat ke habis. Bukan urutan abjad seperti Khanza: daftarnya
 * dipotong `LIMIT`, jadi urutannya menentukan barang mana yang terlihat -- dan
 * yang harus terlihat adalah yang paling kritis, bukan yang namanya berawalan A.
 *
 * `HAVING` (bukan `WHERE`) karena `stok` adalah hasil agregasi; ia belum ada
 * saat WHERE dievaluasi.
 */
function buildDaruratSql(pakaiBatch: ModeBatch, saringJenis: boolean): string {
  return `
    SELECT b.kode_brng, b.nama_brng, b.stokminimal,
           COALESCE(s.satuan, '') AS satuan,
           COALESCE(j.nama, '') AS jenis,
           ${JUMLAH_STOK_SQL} AS stok
    FROM databarang b
    LEFT JOIN kodesatuan s ON s.kode_sat = b.kode_sat
    LEFT JOIN jenis j ON j.kdjns = b.kdjns${joinGudangSql(pakaiBatch)}
    WHERE b.status = '1'
      AND b.stokminimal > 0${saringJenis ? '\n      AND b.kdjns = :kdjns' : ''}
    GROUP BY b.kode_brng, b.nama_brng, b.stokminimal, s.satuan, j.nama
    HAVING stok <= b.stokminimal
    ORDER BY stok / b.stokminimal, b.nama_brng
    LIMIT :limit
  `;
}

export interface OpsiDaruratStok {
  pakaiBatch: ModeBatch;
  /** Kode jenis barang (`jenis.kdjns`), kosong = seluruh jenis. */
  kdJenis?: string | null;
  /** Dibaca pemanggil sebagai `maks + 1` supaya "terpotong" bisa dibedakan dari "pas". */
  limit: number;
}

/**
 * Barang yang stoknya sudah menyentuh ambang minimal, paling kritis lebih dulu.
 */
export async function cariDaruratStok(opsi: OpsiDaruratStok): Promise<BarisDaruratStok[]> {
  const kdJenis = (opsi.kdJenis ?? '').trim();
  const saringJenis = kdJenis !== '';
  const replacements: Record<string, unknown> = { limit: opsi.limit };
  if (saringJenis) replacements.kdjns = kdJenis;
  return sikSelect<BarisDaruratStok>(buildDaruratSql(opsi.pakaiBatch, saringJenis), replacements);
}

/**
 * Daftar jenis barang untuk pemilih di dashboard.
 *
 * Hanya jenis yang benar-benar dipakai barang aktif -- `jenis` di Khanza memuat
 * baris peninggalan yang tidak menaungi satu barang pun, dan menawarkannya di
 * dropdown menghasilkan jadwal yang selamanya nol hasil tanpa satu pun tanda
 * bahwa penyebabnya pilihan jenisnya.
 */
export async function daftarJenisBarang(): Promise<{ kdjns: string; nama: string; jumlah: number }[]> {
  return sikSelect<{ kdjns: string; nama: string; jumlah: number }>(
    `
      SELECT j.kdjns, j.nama, COUNT(*) AS jumlah
      FROM databarang b
      JOIN jenis j ON j.kdjns = b.kdjns
      WHERE b.status = '1'
      GROUP BY j.kdjns, j.nama
      ORDER BY j.nama
    `,
    {},
  );
}

/**
 * TANPA izin pindai penuh, dan itu temuan dari EXPLAIN -- bukan target yang
 * dikejar.
 *
 * Dugaan awalnya query ini butuh izin yang sama seperti `FARMASI_STOK` (alias
 * `b` = `databarang`), karena pertanyaannya terdengar seperti "baca seluruh
 * katalog lalu bandingkan". Ternyata tidak: `b.stokminimal > 0` dilayani indeks
 * yang sudah ada, dan MariaDB menjawabnya `range` berikut `Using index`
 * (~514 baris dari 887). Penyaring itu ada karena alasan kebenaran -- barang
 * tanpa ambang bukan keadaan darurat -- dan kebetulan sekaligus membuat
 * query-nya lebih murah daripada balasan stok yang `LIKE '%..%'`.
 *
 * Izinnya sengaja TIDAK ditulis walau "aman kalau ada". Izin pindai penuh yang
 * menganggur adalah izin yang diam-diam menutupi kemunduran berikutnya: begitu
 * seseorang mengubah query ini sampai ia benar-benar memindai katalog, tidak
 * satu pun pemeriksaan akan berbunyi. Dengan tidak menuliskannya, perubahan itu
 * gagal berisik di `npm run verify:plans` -- persis yang pemeriksaan ini ada
 * untuknya.
 */
registerPlanCheck({
  name: 'FARMASI_STOK_DARURAT',
  sql: buildDaruratSql(false, false),
  replacements: { limit: 31 },
  maxRows: 5000,
});

/**
 * Varian bersaringan jenis didaftarkan TERPISAH -- bentuk SQL-nya berbeda
 * (`AND b.kdjns = :kdjns` mengubah indeks yang dipilih menjadi `kdjns`), dan
 * bentuk yang berbeda adalah bentuk yang belum terperiksa.
 *
 * Nilai contohnya sengaja `'OBT'`, kode jenis yang belum tentu ada di database
 * mana pun. Itu keadaan NORMAL untuk pemeriksaan rencana, bukan kekecualian --
 * lihat catatan `table = NULL` di CLAUDE.md.
 */
registerPlanCheck({
  name: 'FARMASI_STOK_DARURAT_JENIS',
  sql: buildDaruratSql(false, true),
  replacements: { limit: 31, kdjns: 'OBT' },
  maxRows: 5000,
});
