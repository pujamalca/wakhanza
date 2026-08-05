import { pollPharmacyReady, type PharmacyReadyRow } from '@/khanza/farmasi';
import { buildIdempotencyKey } from '@/core/idempotency';
import { runSisipCycle } from './sisipCycle';
import { varsPharmacyReady } from './triggerVars';

function parseSikDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

/** PRD F1 PHARMACY_READY: resep_obat.tgl_penyerahan terisi (kelas sisip). */
export async function runPharmacyReadyCycle(): Promise<void> {
  await runSisipCycle<PharmacyReadyRow>({
    triggerCode: 'PHARMACY_READY',
    fetchRows: pollPharmacyReady,
    getEventAt: (row) => parseSikDateTime(row.tgl_penyerahan, row.jam_penyerahan),
    getIdempotencyKey: (row) => buildIdempotencyKey('PHARMACY_READY', row.no_resep),
    getNoRkmMedis: (row) => row.no_rkm_medis,
    getRawPhone: (row) => row.no_tlp,
    getKdPoli: (row) => row.kd_poli,
    getVars: varsPharmacyReady,
  });
}
