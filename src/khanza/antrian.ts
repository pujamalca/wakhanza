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
  png_jawab: string | null;
}

/**
 * `pj.png_jawab` diambil, `r.kd_pj` TIDAK -- lihat core/penjamin.ts. Kodenya
 * cuma dipakai sebagai kondisi join dan tidak pernah ikut keluar dari SQL,
 * jadi tidak ada jalan bagi "A02" untuk sampai ke pesan pasien.
 *
 * LEFT JOIN, bukan JOIN: `kd_pj` bisa berisi penanda '-' dan barisnya tetap
 * kunjungan sah yang pasiennya harus tetap dikirimi notifikasi antrian.
 * Penyaring `pj.status` sengaja TIDAK ada -- penjamin sebuah kunjungan yang
 * sudah terjadi tidak berubah hanya karena asuransinya kini dinonaktifkan.
 */
function buildQueueRegSql() {
  return `
    SELECT
      r.no_rawat, r.no_reg, r.tgl_registrasi, r.jam_reg, r.no_rkm_medis, r.kd_poli,
      p.nm_pasien, p.no_tlp,
      pk.nm_poli,
      d.nm_dokter,
      pj.png_jawab
    FROM reg_periksa r
    LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
    LEFT JOIN poliklinik pk ON pk.kd_poli = r.kd_poli
    LEFT JOIN dokter d ON d.kd_dokter = r.kd_dokter
    LEFT JOIN penjab pj ON pj.kd_pj = r.kd_pj
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
