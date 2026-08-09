import type { TemplateVariable } from '@/core/template';
import type { HospitalIdentity } from '@/khanza/common';
import { getSettingNumber } from '@/models';
import {
  loadPipelineContext,
  enqueuePemicuPasien,
  identityVars,
  saringKunciBaruPemicuPasien,
} from './pipeline';
import type { LampiranDokumen } from './dokumenLampiran';
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
  /**
   * Lampiran PDF opsional untuk baris PASIEN (migrations/038).
   *
   * Diserahkan sebagai fungsi yang mengembalikan `null` untuk "tidak jadi
   * dilampirkan", bukan sebagai bendera boolean: yang memutuskan bisa-tidaknya
   * sebuah dokumen dirakit ada di `worker/dokumenLampiran.ts`, dan siklus di
   * sini tidak perlu tahu apa pun tentang Chromium, PDF, maupun pengaturan.
   *
   * Absen = perilaku persis seperti sebelum fitur ini ada, dan itulah keadaan
   * ketiga pemicunya selama sakelarnya mati.
   */
  lampiran?: {
    /**
     * Kuota render per siklus.
     *
     * Satu dokumen = satu peluncuran Chromium (~480 ms) DI DALAM proses yang
     * juga memegang sesi WhatsApp, dan Chromium yatim di proses itulah yang
     * pernah menjatuhkan worker ke crash loop 29 kali beruntun. Berbeda dari
     * `suratRunner` yang berjalan tiap 5 menit, siklus sisip berjalan tiap 60
     * detik -- jadi angkanya lebih kecil.
     *
     * Yang tidak kebagian kuota TETAP masuk `outbox` sebagai pesan biasa,
     * bukan ditunda. Menahan barisnya berarti membuat pemberitahuan yang sudah
     * berjalan sejak Fase 1 jadi lebih lambat gara-gara tempelan opsionalnya --
     * arah yang salah, dan alasan yang sama membuat kegagalan render juga
     * menghasilkan pesan tanpa lampiran alih-alih tidak ada pesan.
     */
    kuota: number;
    buat: (row: TRow) => Promise<LampiranDokumen | null>;
  };
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

  /**
   * Baris yang belum pernah ditulis ke `outbox` -- dihitung SEKALI di depan,
   * dan HANYA saat ada lampiran.
   *
   * `uq_idem` tetap yang menolak duplikatnya, jadi ini bukan penjaga kebenaran
   * melainkan penghemat: tanpa ini, jendela yang tumpang tindih antar siklus
   * membuat satu hasil lab dirender ulang jadi PDF berkali-kali untuk baris
   * yang toh ditolak di mesin database. Alasan yang sama persis dengan
   * `SURAT_SAKIT` di `saringKunciBaru()`.
   *
   * Sengaja TIDAK dipakai untuk menyaring `rows` itu sendiri: `maxTs` dihitung
   * dari SELURUH baris yang terbaca, dan mempersempitnya ke baris baru saja
   * bisa membuat watermark tertahan di belakang baris yang sudah selesai.
   */
  const kunciBaru = params.lampiran
    ? new Set(
        (await saringKunciBaruPemicuPasien(rows, params.getIdempotencyKey, ctx)).map(params.getIdempotencyKey),
      )
    : null;

  let dilampirkan = 0;
  let kuotaHabis = 0;

  for (const row of rows) {
    const eventAt = params.getEventAt(row);
    if (eventAt > maxTs) maxTs = eventAt;

    const idempotencyKey = params.getIdempotencyKey(row);

    let lampiranPasien: LampiranDokumen | null = null;
    if (params.lampiran && kunciBaru?.has(idempotencyKey)) {
      if (dilampirkan < params.lampiran.kuota) {
        lampiranPasien = await params.lampiran.buat(row);
        if (lampiranPasien) dilampirkan++;
      } else {
        kuotaHabis++;
      }
    }

    await enqueuePemicuPasien(
      {
        idempotencyKey,
        noRkmMedis: params.getNoRkmMedis(row),
        rawPhone: params.getRawPhone(row),
        eventAt,
        kdPoli: params.getKdPoli?.(row),
        kdJenisPrw: params.getKdJenisPrw?.(row),
        vars: { ...identityVars(ctx.identity), ...params.getVars(row, ctx.identity) },
        lampiranPasien,
      },
      ctx,
    );
  }

  await advanceCursor(cursorKey, maxTs, rows.length);
  logger.info(
    {
      triggerCode: params.triggerCode,
      cursorKey,
      rowsSeen: rows.length,
      ...(params.lampiran ? { dilampirkan, ...(kuotaHabis ? { lampiranKuotaHabis: kuotaHabis } : {}) } : {}),
    },
    'siklus polling selesai',
  );
}
