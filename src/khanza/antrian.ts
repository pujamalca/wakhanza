import { sikSelect } from '@/db/sik';
import { registerPlanCheck, MAX_ROWS_JENDELA_30_HARI } from './planChecks';
import { formatRawatPrefix, lookbackDate } from './common';

export interface QueueRegRow {
  no_rawat: string;
  no_reg: string;
  tgl_registrasi: string;
  jam_reg: string;
  no_rkm_medis: string;
  kd_poli: string | null;
  nm_pasien: string | null;
  no_tlp: string | null;
  nm_poli: string | null;
  nm_dokter: string | null;
}

function buildQueueRegSql() {
  return `
    SELECT
      r.no_rawat, r.no_reg, r.tgl_registrasi, r.jam_reg, r.no_rkm_medis, r.kd_poli,
      p.nm_pasien, p.no_tlp,
      pk.nm_poli,
      d.nm_dokter
    FROM reg_periksa r
    LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
    LEFT JOIN poliklinik pk ON pk.kd_poli = r.kd_poli
    LEFT JOIN dokter d ON d.kd_dokter = r.kd_dokter
    WHERE r.no_rawat >= :lookbackPrefix
      AND TIMESTAMP(r.tgl_registrasi, r.jam_reg) >= :cursorTs
      AND r.no_reg IS NOT NULL AND r.no_reg <> ''
    ORDER BY r.tgl_registrasi, r.jam_reg
    LIMIT 200
  `;
}

/** PRD F1 QUEUE_REG: nomor antrian terbit di reg_periksa, baris baru hari ini, no_reg terisi. */
export async function pollQueueReg(cursorTs: Date, lookbackDays: number): Promise<QueueRegRow[]> {
  const replacements = {
    lookbackPrefix: formatRawatPrefix(lookbackDate(lookbackDays)),
    cursorTs,
  };
  return sikSelect<QueueRegRow>(buildQueueRegSql(), replacements);
}

registerPlanCheck({
  name: 'QUEUE_REG',
  sql: buildQueueRegSql(),
  replacements: { lookbackPrefix: formatRawatPrefix(lookbackDate(30)), cursorTs: new Date() },
  maxRows: MAX_ROWS_JENDELA_30_HARI,
});
