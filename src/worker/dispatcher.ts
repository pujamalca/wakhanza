import { Op } from 'sequelize';
import { db } from '@/db/wakhanza';
import { Outbox, OptOut, SendLog, getSettingNumber, getSettingJson } from '@/models';
import { isPermanentAfter, retryDelayMs, isStale } from '@/core/retry';
import { respectsOptOut } from '@/core/optOut';
import { isWaReady, sendWhatsAppMessage, isRegisteredOnWhatsApp } from './wa-client';
import { logger, safeError, maskPhone } from '@/lib/logger';

const DEFAULT_STALE_HOURS: Record<string, number> = {};

async function staleThresholdFor(triggerCode: string): Promise<number> {
  const byTrigger = await getSettingJson<Record<string, number>>('dispatch.stale_hours_by_trigger', DEFAULT_STALE_HOURS);
  const fallback = await getSettingNumber('dispatch.stale_threshold_hours_default', 6);
  return byTrigger[triggerCode] ?? fallback;
}

/**
 * ARCHITECTURE §6.1. Satu baris per panggilan — pengiriman beruntun cepat
 * adalah pola yang memicu deteksi spam WhatsApp (F5.2), jeda acak antar
 * pesan diterapkan oleh pemanggil (worker/index.ts) berdasarkan nilai balik
 * fungsi ini.
 *
 * @returns true bila satu percobaan kirim (atau keputusan expired/opt-out)
 *          terjadi -- pemanggil harus menjeda sebelum tick berikutnya.
 *          false bila tidak ada yang dikerjakan (idle).
 */
export async function dispatchTick(): Promise<boolean> {
  if (!(await isWaReady())) return false;

  const maxPerHour = await getSettingNumber('dispatch.max_per_hour', 200);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const sentLastHour = await Outbox.count({ where: { status: 'sent', sentAt: { [Op.gte]: oneHourAgo } } });
  if (sentLastHour >= maxPerHour) {
    logger.warn({ sentLastHour, maxPerHour }, 'kuota kirim per jam habis, tunggu');
    return false;
  }

  const row = await db.transaction(async (t) => {
    const candidate = await Outbox.findOne({
      where: { status: 'pending', scheduledAt: { [Op.lte]: new Date() } },
      order: [['scheduledAt', 'ASC']],
      lock: t.LOCK.UPDATE,
      skipLocked: true,
      transaction: t,
    });
    if (!candidate) return null;
    await candidate.update({ status: 'sending' }, { transaction: t });
    return candidate;
  });

  if (!row) return false;

  // §9.8: opt-out diperiksa dua kali -- sekali saat enqueue, sekali lagi tepat
  // sebelum kirim. Jeda antara masuk antrean dan terkirim bisa panjang saat
  // jam tenang; pasien yang meminta berhenti di sela itu tidak boleh tetap
  // dikirimi. respectsOptOut() dipakai di KEDUA tempat lewat fungsi yang sama,
  // supaya cakupannya tidak bisa berbeda antara saat menyusun dan saat kirim.
  if (row.phoneE164 && respectsOptOut(row.triggerCode) && (await OptOut.findByPk(row.phoneE164))) {
    await row.update({ status: 'skipped_opt_out' });
    logger.info({ triggerCode: row.triggerCode, phone: maskPhone(row.phoneE164) }, 'dilewati: opt-out terdeteksi sebelum kirim');
    return true;
  }

  const staleHours = await staleThresholdFor(row.triggerCode);
  if (isStale(row.eventAt, staleHours)) {
    await row.update({ status: 'expired' });
    logger.info({ triggerCode: row.triggerCode, staleHours }, 'dilewati: pesan sudah basi');
    return true;
  }

  if (!row.phoneE164) {
    // Seharusnya tidak pernah pending tanpa nomor (poller sudah menandai
    // skipped_no_contact) -- jaring pengaman, bukan alur normal.
    await row.update({ status: 'skipped_no_contact' });
    return true;
  }

  const startedAt = Date.now();
  const attempts = row.attempts + 1;

  try {
    const registered = await isRegisteredOnWhatsApp(row.phoneE164);
    if (!registered) {
      await row.update({ status: 'failed_permanent', attempts, lastError: 'nomor tidak terdaftar di WhatsApp' });
      await SendLog.create({
        outboxId: row.id,
        attempt: attempts,
        outcome: 'error',
        detail: 'not_registered_on_whatsapp',
        durationMs: Date.now() - startedAt,
      });
      logger.warn({ phone: maskPhone(row.phoneE164) }, 'nomor tidak terdaftar di WhatsApp, ditandai permanen');
      return true;
    }

    await sendWhatsAppMessage(
      row.phoneE164,
      row.body,
      row.mediaPath ? { path: row.mediaPath, name: row.mediaName ?? '' } : null,
    );
    await row.update({ status: 'sent', sentAt: new Date(), attempts });
    await SendLog.create({ outboxId: row.id, attempt: attempts, outcome: 'sent', durationMs: Date.now() - startedAt });
    logger.info(
      { triggerCode: row.triggerCode, phone: maskPhone(row.phoneE164), berlampiran: !!row.mediaPath },
      'pesan terkirim',
    );
  } catch (err) {
    const e = safeError(err);
    const permanent = isPermanentAfter(attempts);
    await row.update({
      status: permanent ? 'failed' : 'pending',
      attempts,
      lastError: e.message,
      scheduledAt: permanent ? row.scheduledAt : new Date(Date.now() + retryDelayMs(attempts)),
    });
    await SendLog.create({
      outboxId: row.id,
      attempt: attempts,
      outcome: 'error',
      detail: e.message,
      durationMs: Date.now() - startedAt,
    });
    logger.error({ triggerCode: row.triggerCode, phone: maskPhone(row.phoneE164), attempts, permanent, ...e }, 'pengiriman gagal');
  }

  return true;
}
