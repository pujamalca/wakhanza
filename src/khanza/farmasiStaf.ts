import { sikSelect } from '@/db/sik';
import { registerPlanCheck, MAX_ROWS_JENDELA_30_HARI } from './planChecks';
import { formatResepPrefix, lookbackDate } from './common';

/**
 * Dua langkah kerja APOTEK di `resep_obat`, untuk diberitahukan ke grup/petugas
 * farmasi -- bukan ke pasien.
 *
 * Kolom mana yang berarti apa dibuktikan dari data `sik` di mesin ini, bukan
 * ditebak dari namanya (nama `tgl_perawatan` sama sekali tidak mengisyaratkan
 * "validasi"):
 *
 *   dokter menulis resep   tgl_peresepan + jam_peresepan
 *   VALIDASI apotek        tgl_perawatan + jam              rata-rata +5,3 menit
 *   PENYERAHAN             tgl_penyerahan + jam_penyerahan  rata-rata +12,4 menit
 *
 * Yang memastikan `jam` benar-benar langkah tersendiri dan bukan salinan waktu
 * penyerahan: 3.214 resep yang BELUM diserahkan (`tgl_penyerahan='0000-00-00'`)
 * sudah punya `tgl_perawatan`/`jam` terisi, dan dari ~28 ribu baris yang sudah
 * diserahkan hanya 1 yang urutannya terbalik.
 *
 * PRIVASI: `no_tlp` sengaja TIDAK diambil sama sekali. Tujuan pesan ini adalah
 * staf, jadi nomor pasien tidak pernah dibutuhkan -- dan kolom yang tidak
 * pernah dibaca tidak mungkin bocor (ARCHITECTURE §5.2). Nama obat, jumlah, dan
 * aturan pakai juga tidak diambil: apotek membacanya di SIMRS, dan daftar obat
 * seseorang adalah justru bagian yang paling tidak boleh berpindah ke grup WhatsApp.
 */
export interface ResepStafRow {
  no_resep: string;
  no_rawat: string;
  no_rkm_medis: string;
  kd_poli: string | null;
  nm_pasien: string | null;
  nm_poli: string | null;
  nm_dokter: string | null;
  /** Tanggal+jam kejadian yang sedang dipantau (validasi ATAU penyerahan). */
  tgl_kejadian: string;
  jam_kejadian: string;
}

/**
 * Satu bentuk SQL untuk kedua pemicu, dibedakan lewat pasangan kolom waktunya.
 *
 * Ditulis begini alih-alih dua fungsi terpisah karena keduanya menyaring baris
 * yang SAMA dari tabel yang sama dengan bentuk kondisi yang sama -- dua salinan
 * yang berbeda satu nama kolom adalah cara paling gampang membuat perbaikan
 * pada satu pemicu diam-diam tidak ikut berlaku pada satunya.
 *
 * Nama kolom di sini dari daftar tetap di bawah, TIDAK PERNAH dari input
 * pengguna -- lihat pemanggilnya.
 */
function buildResepStafSql(kolomTgl: string, kolomJam: string, filterTambahan: string) {
  return `
    SELECT
      ro.no_resep, ro.no_rawat,
      r.no_rkm_medis, r.kd_poli,
      p.nm_pasien,
      pk.nm_poli,
      d.nm_dokter,
      ro.${kolomTgl} AS tgl_kejadian,
      ro.${kolomJam} AS jam_kejadian
    FROM resep_obat ro
    JOIN reg_periksa r ON r.no_rawat = ro.no_rawat
    LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
    LEFT JOIN poliklinik pk ON pk.kd_poli = r.kd_poli
    LEFT JOIN dokter d ON d.kd_dokter = ro.kd_dokter
    WHERE ro.no_resep >= :lookbackPrefix
      ${filterTambahan}
      AND TIMESTAMP(ro.${kolomTgl}, ro.${kolomJam}) >= :cursorTs
    ORDER BY ro.${kolomTgl}, ro.${kolomJam}
    LIMIT 200
  `;
}

/**
 * `tgl_perawatan` NULLABLE dan berisi '0000-00-00' pada 13 baris lama -- sebuah
 * resep yang belum pernah disentuh apotek. Keduanya harus disaring eksplisit:
 * TIMESTAMP('0000-00-00', ...) menghasilkan NULL dan baris itu akan lolos ke
 * pemetaan tanggal sebagai Invalid Date.
 */
const SQL_VALIDASI = buildResepStafSql(
  'tgl_perawatan',
  'jam',
  `AND ro.tgl_perawatan IS NOT NULL AND ro.tgl_perawatan <> '0000-00-00'`,
);

const SQL_PENYERAHAN = buildResepStafSql(
  'tgl_penyerahan',
  'jam_penyerahan',
  `AND ro.tgl_penyerahan <> '0000-00-00'`,
);

export async function pollResepValidasi(cursorTs: Date, lookbackDays: number): Promise<ResepStafRow[]> {
  return sikSelect<ResepStafRow>(SQL_VALIDASI, {
    lookbackPrefix: formatResepPrefix(lookbackDate(lookbackDays)),
    cursorTs,
  });
}

export async function pollResepPenyerahan(cursorTs: Date, lookbackDays: number): Promise<ResepStafRow[]> {
  return sikSelect<ResepStafRow>(SQL_PENYERAHAN, {
    lookbackPrefix: formatResepPrefix(lookbackDate(lookbackDays)),
    cursorTs,
  });
}

const replacementsContoh = { lookbackPrefix: formatResepPrefix(lookbackDate(30)), cursorTs: new Date() };

registerPlanCheck({ name: 'FARMASI_VALIDASI', sql: SQL_VALIDASI, replacements: replacementsContoh, maxRows: MAX_ROWS_JENDELA_30_HARI });
registerPlanCheck({ name: 'FARMASI_PENYERAHAN', sql: SQL_PENYERAHAN, replacements: replacementsContoh, maxRows: MAX_ROWS_JENDELA_30_HARI });
