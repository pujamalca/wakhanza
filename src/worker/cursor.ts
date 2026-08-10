import { PollCursor } from '@/models';
import { lookbackDate } from '@/khanza/common';
import { batasiWatermark } from '@/core/watermark';
import { logger } from '@/lib/logger';

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

/**
 * SATU-SATUNYA tempat `poll_cursor.cursor_ts` dimajukan, dan karena itu
 * satu-satunya tempat pagar `batasiWatermark()` perlu dipasang.
 *
 * Enam pemanggil di empat berkas (`sisipCycle`, `pollerBooking`, `farmasiRunner`
 * ×2, `bpjsRunner` ×2) menyerahkan waktu kejadian terbesar yang terbaca -- dan
 * waktu itu datang dari kolom yang DIKETIK MANUSIA di Khanza (`jam_reg`, `jam`,
 * `jam_penyerahan`), bukan dari jam server. Menaruh pagarnya di pemanggil
 * berarti enam tempat yang harus mengingatnya, dan poller berikutnya ditulis
 * orang yang tidak pernah mendengar aturan ini; yang lupa tidak mendapat satu
 * pun galat, cuma pemicu yang membeku sampai tengah malam. Bentuk kegagalan
 * yang sama sudah berkali-kali dibayar di proyek ini (`respectsOptOut()`,
 * `core/outboxStatus.ts`, `kunciPesanMasuk()`, `core/tujuanPemicu.ts`).
 *
 * `pollerBooking` menyerahkan `now` dan karena itu tidak pernah tersentuh
 * pagarnya -- itu benar, bukan pengecualian yang perlu ditulis.
 *
 * Pemotongannya dicatat `warn` dan TIDAK menggagalkan siklus: barisnya sendiri
 * sudah diproses di hulu dan pasiennya tetap dikirimi (lihat `core/watermark.ts`).
 * Yang dibatasi hanya seberapa jauh watermarknya boleh maju.
 */
export async function advanceCursor(triggerCode: string, newCursorTs: Date, rowsSeen: number): Promise<void> {
  const sekarang = new Date();
  const batas = batasiWatermark(newCursorTs, sekarang);
  if (batas.lampauMs > 0) {
    logger.warn(
      {
        triggerCode,
        diminta: newCursorTs.toISOString(),
        disimpan: batas.nilai.toISOString(),
        lampauMenit: Math.round(batas.lampauMs / 60000),
        rowsSeen,
      },
      'watermark diminta melampaui waktu berjalan, dipotong -- periksa kolom jam di Khanza',
    );
  }

  await PollCursor.upsert({
    triggerCode,
    cursorTs: batas.nilai,
    lastRunAt: sekarang,
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
