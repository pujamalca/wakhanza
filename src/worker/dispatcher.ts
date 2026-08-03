import { Op } from 'sequelize';
import { db } from '@/db/wakhanza';
import { Outbox, OptOut, SendLog, getSettingNumber, getSettingJson } from '@/models';
import { isPermanentAfter, retryDelayMs, isStale } from '@/core/retry';
import { respectsOptOut } from '@/core/optOut';
import { isChatIdValid } from '@/core/farmasiTarget';
import { isWaReady, sendWhatsAppMessage, isRegisteredOnWhatsApp } from './wa-client';
import { logger, safeError, maskPhone, maskChatId } from '@/lib/logger';

const DEFAULT_STALE_HOURS: Record<string, number> = {};

async function staleThresholdFor(triggerCode: string): Promise<number> {
  const byTrigger = await getSettingJson<Record<string, number>>('dispatch.stale_hours_by_trigger', DEFAULT_STALE_HOURS);
  const fallback = await getSettingNumber('dispatch.stale_threshold_hours_default', 6);
  return byTrigger[triggerCode] ?? fallback;
}

/**
 * Baris yang tertinggal berstatus `sending` dari proses sebelumnya.
 *
 * `sending` ditulis di dalam transaksi tepat sebelum kirim, lalu diganti oleh
 * hasilnya. Kalau worker mati di antara keduanya -- SIGKILL setelah
 * `kill_timeout`, listrik padam, Chromium menggantung -- barisnya tinggal di
 * `sending` selamanya: dispatcher hanya mengambil `pending`, cleanup dulu hanya
 * memangkas `sent`, dan halaman Ringkasan menghitungnya sebagai "menunggu".
 * Satu pesan pasien hilang tanpa jejak kesalahan.
 *
 * SENGAJA TIDAK dikembalikan ke `pending` secara otomatis. Kegagalan terjadi di
 * satu-satunya titik yang tidak bisa kita ketahui hasilnya: pesannya mungkin
 * sudah sampai ke WhatsApp sebelum prosesnya mati. Mengirim ulang sendiri
 * berarti sebagian pasien menerima pesan yang sama dua kali tanpa ada yang
 * memutuskan itu. Jadi baris ini ditandai `failed_permanent` supaya muncul di
 * daftar "perlu ditinjau" berikut tombol Kirim ulang -- keputusannya
 * dikembalikan ke manusia, konsisten dengan cara pemicu lain menangani
 * kegagalan yang ambigu.
 *
 * Aman dilakukan di startup karena worker dijamin instance tunggal
 * (`instances: 1, exec_mode: 'fork'` di ecosystem.config.js): tidak ada proses
 * lain yang mungkin sedang memegang baris `sending` saat ini dijalankan.
 */
export async function recoverInterruptedSends(): Promise<number> {
  const [affected] = await Outbox.update(
    {
      status: 'failed_permanent',
      lastError: 'worker berhenti saat pengiriman berlangsung; hasil kirim tidak diketahui',
    },
    { where: { status: 'sending' } },
  );
  if (affected > 0) {
    logger.warn({ affected }, 'baris outbox tersangkut "sending" dari proses sebelumnya, ditandai perlu ditinjau');
  }
  return affected;
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

  /**
   * Alamat tujuan. Baris notifikasi farmasi sudah membawanya lengkap (grup atau
   * petugas apotek); sembilan pemicu lain merakitnya dari nomor pasien seperti
   * sebelumnya.
   */
  const chatId = row.chatId ?? (row.phoneE164 ? `${row.phoneE164}@c.us` : null);

  if (!chatId) {
    // Seharusnya tidak pernah pending tanpa tujuan (poller sudah menandai
    // skipped_no_contact) -- jaring pengaman, bukan alur normal.
    await row.update({ status: 'skipped_no_contact' });
    return true;
  }

  /**
   * Penjaga terakhir sebelum sebuah nilai dari database diserahkan ke WhatsApp,
   * alasan yang sama persis dengan `resolveMediaPath()` pada lampiran: nilainya
   * sudah pulang-pergi lewat database, dan inilah yang memastikan satu baris
   * yang disunting lewat SQL tidak bisa mengarahkan pengiriman ke jenis alamat
   * yang tidak pernah diputuskan siapa pun (mis. `status@broadcast`).
   */
  if (row.chatId && !isChatIdValid(row.chatId)) {
    await row.update({ status: 'failed_permanent', lastError: `alamat tujuan ditolak: ${row.chatId}` });
    logger.error({ tujuan: maskChatId(row.chatId), triggerCode: row.triggerCode }, 'alamat tujuan tidak sah, ditolak');
    return true;
  }

  const startedAt = Date.now();
  const attempts = row.attempts + 1;

  try {
    /**
     * Pemeriksaan pendaftaran hanya berlaku untuk alamat PERORANGAN, dan
     * diturunkan dari alamatnya -- bukan dari ada-tidaknya `phone_e164`,
     * supaya tujuan personal farmasi (yang `phone_e164`-nya sengaja NULL)
     * tetap ikut terjaga.
     *
     * Sebuah JID grup dijawab `getNumberId()` sebagai "tidak terdaftar", dan
     * tanpa cabang ini setiap notifikasi ke grup akan ditandai gagal permanen
     * dengan alasan yang tidak ada hubungannya dengan sebab sebenarnya.
     */
    const nomorPerorangan = chatId.endsWith('@c.us') ? chatId.slice(0, -'@c.us'.length) : null;
    if (nomorPerorangan) {
      const registered = await isRegisteredOnWhatsApp(nomorPerorangan);
      if (!registered) {
        await row.update({ status: 'failed_permanent', attempts, lastError: 'nomor tidak terdaftar di WhatsApp' });
        await SendLog.create({
          outboxId: row.id,
          attempt: attempts,
          outcome: 'error',
          detail: 'not_registered_on_whatsapp',
          durationMs: Date.now() - startedAt,
        });
        logger.warn({ phone: maskPhone(nomorPerorangan) }, 'nomor tidak terdaftar di WhatsApp, ditandai permanen');
        return true;
      }
    }

    await sendWhatsAppMessage(
      chatId,
      row.body,
      row.mediaPath ? { path: row.mediaPath, name: row.mediaName ?? '' } : null,
    );
    await row.update({ status: 'sent', sentAt: new Date(), attempts });
    await SendLog.create({ outboxId: row.id, attempt: attempts, outcome: 'sent', durationMs: Date.now() - startedAt });
    logger.info(
      { triggerCode: row.triggerCode, tujuan: maskChatId(chatId), berlampiran: !!row.mediaPath },
      'pesan terkirim',
    );
  } catch (err) {
    const e = safeError(err);
    const permanent = isPermanentAfter(attempts);
    /**
     * Saat percobaan habis, statusnya `failed_permanent` -- BUKAN `failed`.
     *
     * Bentuk lamanya menulis `failed`, dan itu membuat pesan yang benar-benar
     * menyerah menghilang dari pandangan: `ringkasan/queries.ts`'s NEEDS_REVIEW
     * hanya memuat `failed_permanent` dan `expired`, sementara label `failed`
     * berbunyi "masih akan dicoba ulang otomatis" padahal dispatcher cuma
     * mengambil baris `pending` dan tidak akan pernah menyentuhnya lagi.
     * Hasilnya: notifikasi pasien yang gagal tiga kali berturut-turut berhenti
     * diam-diam -- tidak dicoba ulang, tidak ditampilkan, tidak ada yang tahu.
     *
     * `failed` tetap ada di ENUM demi baris lama, dan sekarang ikut terhitung
     * "perlu ditinjau" supaya baris peninggalan itu pun muncul ke permukaan.
     */
    await row.update({
      status: permanent ? 'failed_permanent' : 'pending',
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
    logger.error({ triggerCode: row.triggerCode, tujuan: maskChatId(chatId), attempts, permanent, ...e }, 'pengiriman gagal');
  }

  return true;
}
