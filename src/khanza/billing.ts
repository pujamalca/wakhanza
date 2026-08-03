import { sikSelect } from '@/db/sik';
import { registerPlanCheck, MAX_ROWS_JENDELA_30_HARI } from './planChecks';
import { lookbackDate, formatSqlDate } from './common';

export interface BillingReadyRow {
  no_rawat: string;
  no_nota: string | null;
  tanggal: string;
  jam: string;
  sumber: 'rajal' | 'ranap';
  no_rkm_medis: string;
  kd_poli: string | null;
  nm_pasien: string | null;
  no_tlp: string | null;
}

/**
 * nota_jalan/nota_inap adalah SATU-SATUNYA tabel Khanza dengan kolom tanggal
 * yang benar-benar terindeks sendiri (ARCHITECTURE §4.4 tabel) -- diverifikasi
 * lewat EXPLAIN (`key: tanggal`), bukan cuma dipercaya dari dokumen. Karena
 * itu di sini TIDAK perlu trik pemangkas lewat primary key seperti tabel lain.
 *
 * PRD §10 pertanyaan #3 ("kirim ke pasien atau ke penanggung jawab
 * reg_periksa.p_jawab?") ternyata tidak berdampak teknis: p_jawab hanya
 * berisi NAMA, bukan nomor kontak terpisah -- satu-satunya nomor yang
 * tersedia tetap pasien.no_tlp, apa pun jawabannya.
 *
 * Kedua sumber (rawat jalan & rawat inap) dipakai bersama satu idempotency
 * key berbasis no_nota (§4.2), jadi digabung lewat UNION ALL sebelum di-join
 * ke reg_periksa/pasien.
 */
function buildBillingReadySql() {
  return `
    SELECT x.no_rawat, x.no_nota, x.tanggal, x.jam, x.sumber,
           r.no_rkm_medis, r.kd_poli,
           p.nm_pasien, p.no_tlp
    FROM (
      SELECT no_rawat, no_nota, tanggal, jam, 'rajal' AS sumber
      FROM nota_jalan
      WHERE tanggal >= :cutoffDate AND TIMESTAMP(tanggal, jam) >= :cursorTs
      UNION ALL
      SELECT no_rawat, no_nota, tanggal, jam, 'ranap' AS sumber
      FROM nota_inap
      WHERE tanggal >= :cutoffDate AND TIMESTAMP(tanggal, jam) >= :cursorTs
    ) x
    JOIN reg_periksa r ON r.no_rawat = x.no_rawat
    LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
    ORDER BY x.tanggal, x.jam
    LIMIT 200
  `;
}

/** PRD F1 BILLING_READY: nota terbit di nota_jalan (rawat jalan) atau nota_inap (rawat inap). */
export async function pollBillingReady(cursorTs: Date, lookbackDays: number): Promise<BillingReadyRow[]> {
  const replacements = {
    cutoffDate: formatSqlDate(lookbackDate(lookbackDays)),
    cursorTs,
  };
  return sikSelect<BillingReadyRow>(buildBillingReadySql(), replacements);
}

registerPlanCheck({
  name: 'BILLING_READY',
  sql: buildBillingReadySql(),
  replacements: { cutoffDate: formatSqlDate(lookbackDate(30)), cursorTs: new Date() },
  maxRows: MAX_ROWS_JENDELA_30_HARI,
});
