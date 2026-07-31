import { pollQueueReg, type QueueRegRow } from '@/khanza/antrian';
import { buildIdempotencyKey } from '@/core/idempotency';
import { runSisipCycle } from './sisipCycle';

function parseSikDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

/** PRD F1 QUEUE_REG: nomor antrian terbit di reg_periksa (kelas sisip). */
export async function runQueueRegCycle(): Promise<void> {
  await runSisipCycle<QueueRegRow>({
    triggerCode: 'QUEUE_REG',
    fetchRows: pollQueueReg,
    getEventAt: (row) => parseSikDateTime(row.tgl_registrasi, row.jam_reg),
    getIdempotencyKey: (row) => buildIdempotencyKey('QUEUE_REG', row.no_rawat),
    getNoRkmMedis: (row) => row.no_rkm_medis,
    getRawPhone: (row) => row.no_tlp,
    getKdPoli: (row) => row.kd_poli,
    getVars: (row) => ({
      nama_pasien: row.nm_pasien ?? '',
      no_rm: row.no_rkm_medis,
      no_antrian: row.no_reg,
      nama_poli: row.nm_poli ?? '',
      nama_dokter: row.nm_dokter ?? '',
      tanggal: row.tgl_registrasi,
      jam: row.jam_reg,
    }),
  });
}
