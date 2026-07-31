import * as cron from 'node-cron';
import { pollBookingsForDate } from '@/khanza/booking';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadPipelineContext, enqueueMessage, identityVars } from './pipeline';
import { getSettingNumber } from '@/models';
import { logger, safeError } from '@/lib/logger';

/** PRD F1 BOOK_REMIND: tanggal_periksa = besok, status='Belum'. IMPLEMENTATION_PLAN §2.3: node-cron, bukan polling. */
export async function runBookRemindJob(): Promise<void> {
  const ctx = await loadPipelineContext('BOOK_REMIND');
  if (!ctx) {
    logger.info('BOOK_REMIND nonaktif, lewati');
    return;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  let rows;
  try {
    rows = await pollBookingsForDate(tomorrow);
  } catch (err) {
    logger.error(safeError(err), 'gagal mengambil booking H-1');
    return;
  }

  const now = new Date();
  let sent = 0;
  for (const row of rows) {
    if (row.status !== 'Belum') continue;
    await enqueueMessage(
      {
        idempotencyKey: buildIdempotencyKey('BOOK_REMIND', row.no_rkm_medis, row.tanggal_periksa),
        noRkmMedis: row.no_rkm_medis,
        rawPhone: row.no_tlp,
        eventAt: now,
        kdPoli: row.kd_poli,
        vars: {
          ...identityVars(ctx.identity),
          nama_pasien: row.nm_pasien ?? '',
          no_rm: row.no_rkm_medis,
          nama_poli: row.nm_poli ?? '',
          nama_dokter: row.nm_dokter ?? '',
          tanggal: row.tanggal_periksa,
          jam: row.jam_booking ?? '',
        },
      },
      ctx,
    );
    sent++;
  }
  logger.info({ candidates: rows.length, sent }, 'siklus BOOK_REMIND selesai');
}

/**
 * PRD §10 pertanyaan #4 (jam kirim H-1) belum dijawab RS -- dibaca dari
 * app_setting (schedule.book_remind_hour, default 18) supaya bisa diubah
 * lewat dashboard tanpa redeploy begitu RS memutuskan.
 *
 * timezone dipatok eksplisit ke Asia/Jakarta -- jangan bergantung pada zona
 * waktu sistem server Windows RS yang mungkin tidak dikonfigurasi WIB (N6).
 */
export async function startScheduler(): Promise<void> {
  const hour = await getSettingNumber('schedule.book_remind_hour', 18);
  const expr = `0 ${hour} * * *`;

  cron.schedule(
    expr,
    () => {
      runBookRemindJob().catch((err) => logger.error(safeError(err), 'BOOK_REMIND cron job gagal tak terduga'));
    },
    { timezone: 'Asia/Jakarta' },
  );

  logger.info({ cronExpr: expr, timezone: 'Asia/Jakarta' }, 'penjadwal BOOK_REMIND aktif');
}
