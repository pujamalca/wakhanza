import { sikSelect } from '@/db/sik';
import { registerPlanCheck, MAX_ROWS_JENDELA_30_HARI } from './planChecks';
import { formatResepPrefix, lookbackDate } from './common';

export interface PharmacyReadyRow {
  no_resep: string;
  no_rawat: string;
  tgl_penyerahan: string;
  jam_penyerahan: string;
  no_rkm_medis: string;
  kd_poli: string | null;
  nm_pasien: string | null;
  no_tlp: string | null;
  nm_poli: string | null;
  png_jawab: string | null;
}

/**
 * ARCHITECTURE §4.6: resep_obat.tgl_penyerahan bertipe DATE NOT NULL dan
 * berisi '0000-00-00' untuk resep yang BELUM diserahkan -- itu cara Khanza
 * menandai "belum", bukan NULL. Wajib disaring eksplisit, dan koneksi sik
 * wajib dateStrings:true (src/db/sik.ts) supaya nilai ini tidak diam-diam
 * jadi Invalid Date.
 */
function buildPharmacyReadySql() {
  return `
    SELECT
      ro.no_resep, ro.no_rawat, ro.tgl_penyerahan, ro.jam_penyerahan,
      r.no_rkm_medis, r.kd_poli,
      p.nm_pasien, p.no_tlp,
      pk.nm_poli,
      pj.png_jawab
    FROM resep_obat ro
    JOIN reg_periksa r ON r.no_rawat = ro.no_rawat
    LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
    LEFT JOIN poliklinik pk ON pk.kd_poli = r.kd_poli
    LEFT JOIN penjab pj ON pj.kd_pj = r.kd_pj
    WHERE ro.no_resep >= :lookbackPrefix
      AND ro.tgl_penyerahan <> '0000-00-00'
      AND TIMESTAMP(ro.tgl_penyerahan, ro.jam_penyerahan) >= :cursorTs
    ORDER BY ro.tgl_penyerahan, ro.jam_penyerahan
    LIMIT 200
  `;
}

/** PRD F1 PHARMACY_READY: resep_obat.tgl_penyerahan terisi (obat diserahkan). */
export async function pollPharmacyReady(cursorTs: Date, lookbackDays: number): Promise<PharmacyReadyRow[]> {
  const replacements = {
    lookbackPrefix: formatResepPrefix(lookbackDate(lookbackDays)),
    cursorTs,
  };
  return sikSelect<PharmacyReadyRow>(buildPharmacyReadySql(), replacements);
}

registerPlanCheck({
  name: 'PHARMACY_READY',
  sql: buildPharmacyReadySql(),
  replacements: { lookbackPrefix: formatResepPrefix(lookbackDate(30)), cursorTs: new Date() },
  maxRows: MAX_ROWS_JENDELA_30_HARI,
});
