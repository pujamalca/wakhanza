import { pollResultReady, type ResultReadyRow, type PenunjangJenis } from '@/khanza/penunjang';
import { buildIdempotencyKey } from '@/core/idempotency';
import { runSisipCycle } from './sisipCycle';

const JENIS_LAYANAN: Record<PenunjangJenis, string> = {
  lab: 'Laboratorium',
  radiologi: 'Radiologi',
};

function parseSikDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

async function runOne(jenis: PenunjangJenis): Promise<void> {
  await runSisipCycle<ResultReadyRow>({
    triggerCode: 'RESULT_READY',
    // Watermark terpisah per sumber (§4.3 komentar di khanza/penunjang.ts) --
    // lab dan radiologi tidak boleh berbagi satu cursor_ts.
    cursorKey: `RESULT_READY_${jenis.toUpperCase()}`,
    fetchRows: (cursorTs, lookbackDays) => pollResultReady(jenis, cursorTs, lookbackDays),
    getEventAt: (row) => parseSikDateTime(row.tgl_periksa, row.jam_terakhir),
    // §4.2: kunci (no_rawat, jenis, tgl_periksa) -- satu pesan per kunjungan per hari per jenis.
    getIdempotencyKey: (row) => buildIdempotencyKey('RESULT_READY', row.no_rawat, jenis, row.tgl_periksa),
    getNoRkmMedis: (row) => row.no_rkm_medis,
    getRawPhone: (row) => row.no_tlp,
    getKdPoli: (row) => row.kd_poli,
    // jumlah_item TIDAK PERNAH dikirim ke pasien (§4.3: jumlah pemeriksaan pun petunjuk medis).
    getKdJenisPrw: (row) => row.kd_jenis_prw_list?.split(',') ?? [],
    getVars: (row) => ({
      nama_pasien: row.nm_pasien ?? '',
      no_rm: row.no_rkm_medis,
      nama_poli: row.nm_poli ?? '',
      tanggal: row.tgl_periksa,
      jam: row.jam_terakhir,
      jenis_layanan: JENIS_LAYANAN[jenis],
    }),
  });
}

/** PRD F1 RESULT_READY: hasil lab/radiologi selesai (kelas sisip, digabung per kunjungan). */
export async function runResultReadyCycle(): Promise<void> {
  await runOne('lab');
  await runOne('radiologi');
}
