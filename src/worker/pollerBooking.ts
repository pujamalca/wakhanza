import { pollUpcomingBookings, type BookingRow } from '@/khanza/booking';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadPipelineContext, enqueueMessage, identityVars, type PipelineContext } from './pipeline';
import { advanceCursor, recordCursorError } from './cursor';
import { logger, safeError } from '@/lib/logger';

const SCAN_TRACKING_CODE = 'BOOKING_SCAN'; // observability saja (poll_cursor.last_run_at) -- bukan watermark

/**
 * ARCHITECTURE §4.1: booking_registrasi tidak punya updated_at, jadi
 * BOOK_CONFIRM dan BOOK_CANCEL berbagi SATU pemindaian penuh per siklus,
 * dibedakan oleh idempotency key masing-masing (§4.2). Ini kelas PINDAI,
 * bukan sisip -- tidak ada poll_cursor watermark yang menyaring baris.
 *
 * event_at sengaja memakai waktu SEKARANG (deteksi), bukan tanggal_booking.
 * Relevansi baris sudah dijamin oleh filter query (tanggal_periksa >= hari
 * ini) -- memakai tanggal_booking yang mungkin berminggu-minggu lalu sebagai
 * event_at akan salah membuat konfirmasi booking jangka panjang tampak basi
 * dan tidak terkirim (F5.3 dirancang untuk kejadian sisip macam nomor
 * antrian, bukan status yang baru diketahui lewat pindaian).
 */
export async function runBookingCycle(): Promise<void> {
  const confirmCtx = await loadPipelineContext('BOOK_CONFIRM');
  const cancelCtx = await loadPipelineContext('BOOK_CANCEL');

  if (!confirmCtx && !cancelCtx) {
    logger.info('BOOK_CONFIRM dan BOOK_CANCEL nonaktif, lewati siklus pindai');
    return;
  }

  let rows: BookingRow[];
  try {
    rows = await pollUpcomingBookings();
  } catch (err) {
    const e = safeError(err);
    logger.error(e, 'siklus pindai booking gagal');
    await recordCursorError(SCAN_TRACKING_CODE, e.message);
    return;
  }

  const now = new Date();

  for (const row of rows) {
    const baseVars = {
      nama_pasien: row.nm_pasien ?? '',
      no_rm: row.no_rkm_medis,
      nama_poli: row.nm_poli ?? '',
      nama_dokter: row.nm_dokter ?? '',
      tanggal: row.tanggal_periksa,
      jam: row.jam_booking ?? '',
    };

    if (confirmCtx && row.status === 'Belum') {
      await enqueueBooking(confirmCtx, row, baseVars, buildIdempotencyKey('BOOK_CONFIRM', row.no_rkm_medis, row.tanggal_periksa), now);
    }

    if (cancelCtx && (row.status === 'Batal' || row.status === 'Dokter Berhalangan')) {
      await enqueueBooking(
        cancelCtx,
        row,
        baseVars,
        buildIdempotencyKey('BOOK_CANCEL', row.no_rkm_medis, row.tanggal_periksa, row.status),
        now,
      );
    }
  }

  await advanceCursor(SCAN_TRACKING_CODE, now, rows.length);
  logger.info({ rowsScanned: rows.length }, 'siklus pindai booking selesai');
}

async function enqueueBooking(
  ctx: PipelineContext,
  row: BookingRow,
  baseVars: Record<string, string>,
  idempotencyKey: string,
  eventAt: Date,
): Promise<void> {
  await enqueueMessage(
    {
      idempotencyKey,
      noRkmMedis: row.no_rkm_medis,
      rawPhone: row.no_tlp,
      eventAt,
      kdPoli: row.kd_poli,
      vars: { ...identityVars(ctx.identity), ...baseVars },
    },
    ctx,
  );
}
