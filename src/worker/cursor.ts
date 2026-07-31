import { PollCursor } from '@/models';
import { lookbackDate } from '@/khanza/common';

/**
 * ARCHITECTURE §4.5: cursor_ts_baru = waktu kejadian maksimum yang terbaca
 * (bukan NOW()), query berikutnya memakai >= (bukan >). Baris di batas terbaca
 * ulang tiap siklus — disengaja dan aman karena kunci idempoten menolak
 * duplikatnya; alternatifnya (>) bisa kehilangan baris secara permanen.
 *
 * Belum ada cursor row (pemasangan pertama) -> mulai dari batas lookback,
 * BUKAN dari awal waktu. Ini mencegah siklus pertama mencoba memindai seluruh
 * riwayat; sisa data lama di dalam jendela lookback yang kadung basi akan
 * ditandai `expired` oleh dispatcher (F5.3), bukan dikirim.
 */
export async function getCursor(triggerCode: string, lookbackDays: number): Promise<Date> {
  const row = await PollCursor.findByPk(triggerCode);
  if (row) return row.cursorTs;

  const initial = lookbackDate(lookbackDays);
  await PollCursor.create({ triggerCode, cursorTs: initial, rowsSeen: 0 });
  return initial;
}

export async function advanceCursor(triggerCode: string, newCursorTs: Date, rowsSeen: number): Promise<void> {
  await PollCursor.upsert({
    triggerCode,
    cursorTs: newCursorTs,
    lastRunAt: new Date(),
    lastError: null,
    rowsSeen,
  });
}

export async function recordCursorError(triggerCode: string, message: string): Promise<void> {
  const row = await PollCursor.findByPk(triggerCode);
  await PollCursor.upsert({
    triggerCode,
    cursorTs: row?.cursorTs ?? lookbackDate(30),
    lastRunAt: new Date(),
    lastError: message.slice(0, 2000),
    rowsSeen: row?.rowsSeen ?? 0,
  });
}
