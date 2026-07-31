import { pollBillingReady, type BillingReadyRow } from '@/khanza/billing';
import { buildIdempotencyKey } from '@/core/idempotency';
import { runSisipCycle } from './sisipCycle';

function parseSikDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

/** PRD F1 BILLING_READY: nota terbit di nota_jalan/nota_inap (kelas sisip). */
export async function runBillingReadyCycle(): Promise<void> {
  await runSisipCycle<BillingReadyRow>({
    triggerCode: 'BILLING_READY',
    fetchRows: pollBillingReady,
    getEventAt: (row) => parseSikDateTime(row.tanggal, row.jam),
    // §4.2: kunci no_nota -- satu pesan per nota. no_nota nullable di skema
    // sik; jatuh kembali ke no_rawat supaya tidak pernah membangun kunci kosong.
    getIdempotencyKey: (row) => buildIdempotencyKey('BILLING_READY', row.no_nota ?? row.no_rawat),
    getNoRkmMedis: (row) => row.no_rkm_medis,
    getRawPhone: (row) => row.no_tlp,
    getKdPoli: (row) => row.kd_poli,
    getVars: (row) => ({
      nama_pasien: row.nm_pasien ?? '',
      no_rm: row.no_rkm_medis,
      tanggal: row.tanggal,
      jam: row.jam,
      jenis_layanan: 'Kasir',
    }),
  });
}
