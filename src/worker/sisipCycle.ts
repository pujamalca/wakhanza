import type { TemplateVariable } from '@/core/template';
import type { HospitalIdentity } from '@/khanza/common';
import { getSettingNumber } from '@/models';
import { loadPipelineContext, enqueuePemicuPasien, identityVars } from './pipeline';
import { getCursor, advanceCursor, recordCursorError } from './cursor';
import { logger, safeError } from '@/lib/logger';

export interface SisipCycleParams<TRow> {
  /** Nama pemicu untuk template/privacy/outbox.trigger_code (mis. 'QUEUE_REG'). */
  triggerCode: string;
  /**
   * Kunci watermark poll_cursor. Default = triggerCode.
   *
   * Dipisahkan dari triggerCode saat nama barisnya di `poll_cursor` memang
   * BERBEDA dari kode pemicunya. Satu-satunya pemakainya sekarang
   * `pollerResultReady.ts`: watermarknya dibuat waktu lab dan radiologi masih
   * berbagi satu `trigger_code`, dan namanya (`RESULT_READY_LAB` /
   * `RESULT_READY_RADIOLOGI`) sengaja TIDAK ikut diganti saat pemicunya dipecah
   * (migrations/034) -- kunci ini identitas baris, dan mengganti nama baris
   * watermark sama artinya dengan membuangnya.
   *
   * Yang tetap wajib apa pun namanya: dua sumber sik yang lajunya berbeda tidak
   * boleh berbagi satu cursor_ts, karena watermark tercampur bisa membuat salah
   * satunya "melompati" baris yang belum diproses.
   */
  cursorKey?: string;
  fetchRows: (cursorTs: Date, lookbackDays: number) => Promise<TRow[]>;
  getEventAt: (row: TRow) => Date;
  getIdempotencyKey: (row: TRow) => string;
  getNoRkmMedis: (row: TRow) => string;
  getRawPhone: (row: TRow) => string | null;
  getKdPoli?: (row: TRow) => string | null | undefined;
  getKdJenisPrw?: (row: TRow) => string | string[] | null | undefined;
  getVars: (row: TRow, identity: HospitalIdentity) => Partial<Record<TemplateVariable, string>>;
}

/** Bentuk siklus yang sama untuk semua pemicu kelas sisip (ARCHITECTURE §2, §4.1). */
export async function runSisipCycle<TRow>(params: SisipCycleParams<TRow>): Promise<void> {
  const cursorKey = params.cursorKey ?? params.triggerCode;

  const ctx = await loadPipelineContext(params.triggerCode);
  if (!ctx) {
    logger.info({ triggerCode: params.triggerCode }, 'pemicu nonaktif atau template belum ada, lewati siklus');
    return;
  }

  const lookbackDays = await getSettingNumber('polling.lookback_days', 30);
  const cursorTs = await getCursor(cursorKey, lookbackDays);

  let rows: TRow[];
  try {
    rows = await params.fetchRows(cursorTs, lookbackDays);
  } catch (err) {
    const e = safeError(err);
    logger.error({ triggerCode: params.triggerCode, ...e }, 'siklus polling gagal, watermark tidak dimajukan');
    await recordCursorError(cursorKey, e.message);
    return;
  }

  let maxTs = cursorTs;

  for (const row of rows) {
    const eventAt = params.getEventAt(row);
    if (eventAt > maxTs) maxTs = eventAt;

    await enqueuePemicuPasien(
      {
        idempotencyKey: params.getIdempotencyKey(row),
        noRkmMedis: params.getNoRkmMedis(row),
        rawPhone: params.getRawPhone(row),
        eventAt,
        kdPoli: params.getKdPoli?.(row),
        kdJenisPrw: params.getKdJenisPrw?.(row),
        vars: { ...identityVars(ctx.identity), ...params.getVars(row, ctx.identity) },
      },
      ctx,
    );
  }

  await advanceCursor(cursorKey, maxTs, rows.length);
  logger.info({ triggerCode: params.triggerCode, cursorKey, rowsSeen: rows.length }, 'siklus polling selesai');
}
