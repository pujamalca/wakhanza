import { pollBillingReady, type BillingReadyRow } from '@/khanza/billing';
import { buildIdempotencyKey } from '@/core/idempotency';
import { getSettingNumber } from '@/models';
import { dokumenAktif, bacaPesanDokumen, KUOTA_BAWAAN, SETTING_KUOTA } from '@/lib/dokumen';
import { runSisipCycle } from './sisipCycle';
import { siapkanLampiranDokumen } from './dokumenLampiran';
import { varsBillingReady } from './triggerVars';

function parseSikDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

// §4.2: kunci no_nota -- satu pesan per nota. no_nota nullable di skema sik;
// jatuh kembali ke no_rawat supaya tidak pernah membangun kunci kosong.
function kunciBilling(row: BillingReadyRow): string {
  return buildIdempotencyKey('BILLING_READY', row.no_nota ?? row.no_rawat);
}

/**
 * Lampiran PDF rincian tagihan (migrations/038), atau `undefined` bila belum
 * dinyalakan rumah sakit.
 *
 * `sumber` diteruskan apa adanya dari barisnya, bukan ditebak: rawat jalan dan
 * rawat inap punya tabel rincian pembayaran yang berbeda, dan nota rawat inap
 * yang belum punya rincian akan salah dibaca sebagai rawat jalan -- yang muncul
 * bukan galat melainkan bagian pembayaran yang diam-diam kosong.
 */
async function opsiLampiran() {
  if (!(await dokumenAktif('nota'))) return undefined;

  const [pesan, kuota] = await Promise.all([
    bacaPesanDokumen('nota'),
    getSettingNumber(SETTING_KUOTA, KUOTA_BAWAAN),
  ]);

  return {
    kuota,
    buat: (row: BillingReadyRow) =>
      siapkanLampiranDokumen(
        {
          jenis: 'nota' as const,
          noRawat: row.no_rawat,
          noNota: row.no_nota,
          tanggal: row.tanggal,
          sumber: row.sumber,
        },
        pesan,
        kunciBilling(row),
      ),
  };
}

/** PRD F1 BILLING_READY: nota terbit di nota_jalan/nota_inap (kelas sisip). */
export async function runBillingReadyCycle(): Promise<void> {
  await runSisipCycle<BillingReadyRow>({
    triggerCode: 'BILLING_READY',
    lampiran: await opsiLampiran(),
    fetchRows: pollBillingReady,
    getEventAt: (row) => parseSikDateTime(row.tanggal, row.jam),
    getIdempotencyKey: kunciBilling,
    getNoRkmMedis: (row) => row.no_rkm_medis,
    getRawPhone: (row) => row.no_tlp,
    getKdPoli: (row) => row.kd_poli,
    getVars: varsBillingReady,
  });
}
