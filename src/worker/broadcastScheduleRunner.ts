import { Op } from 'sequelize';
import { BroadcastSchedule, BroadcastCampaign, getSettingNumber, logAudit } from '@/models';
import { fetchPatientSegment } from '@/khanza/pasienSegment';
import { scheduleFiltersToSegment, type ScheduleFilterConfig } from '@/khanza/broadcastSchedule';
import { getHospitalIdentity } from '@/khanza/common';
import { loadBroadcastContext, enqueueMessage, identityVars } from './pipeline';
import { buildIdempotencyKey } from '@/core/idempotency';
import { computeNextRunAt } from '@/core/schedule';
import { logger, safeError } from '@/lib/logger';

/** Dipakai sebagai `actor` di audit_log dan `created_by` di broadcast_campaign -- membedakan jalan otomatis dari kirim manual staf (username asli). */
const SCHEDULE_ACTOR = 'system:broadcast_schedule';

/**
 * Dipanggil periodik dari worker (index.ts). Ini bukan pemicu sisip/pindai
 * dari `sik` (ARCHITECTURE §4) -- ini kelas ketiga (BROADCAST, lihat
 * CLAUDE.md) yang dijalankan otomatis alih-alih diklik staf. Segmen dan
 * pengiriman memakai fungsi produksi yang SAMA PERSIS dengan broadcast
 * manual (fetchPatientSegment, loadBroadcastContext, enqueueMessage) --
 * satu-satunya beda adalah apa yang MEMICU pemanggilannya.
 */
export async function runDueBroadcastSchedules(): Promise<void> {
  const now = new Date();
  const due = await BroadcastSchedule.findAll({
    where: { isActive: true, nextRunAt: { [Op.lte]: now } },
  });

  for (const schedule of due) {
    await runOneSchedule(schedule, now).catch((err) => {
      logger.error({ scheduleId: schedule.id, name: schedule.name, ...safeError(err) }, 'gagal menjalankan broadcast_schedule');
    });
  }
}

async function runOneSchedule(schedule: BroadcastSchedule, now: Date): Promise<void> {
  // Pagar keselamatan: berhenti otomatis lewat stop_after_date walau
  // is_active masih 1 -- supaya "atur lalu lupa" tidak berjalan tanpa batas.
  // new Date(...) di sini SENGAJA, bukan berlebihan: DATEONLY Sequelize tidak
  // selalu konsisten dikembalikan sebagai instance Date (tergantung versi) --
  // membungkusnya membuat perbandingan `>` benar apa pun bentuk aslinya.
  if (schedule.stopAfterDate && now > new Date(schedule.stopAfterDate)) {
    await schedule.update({ isActive: false, nextRunAt: null });
    logger.info({ scheduleId: schedule.id, name: schedule.name }, 'broadcast_schedule dinonaktifkan otomatis (lewat stop_after_date)');
    return;
  }

  const filterConfig: ScheduleFilterConfig = JSON.parse(schedule.filterJson);
  const segmentFilters = scheduleFiltersToSegment(filterConfig);
  const recipients = await fetchPatientSegment(segmentFilters);
  const maxRecipients = await getSettingNumber('broadcast.max_recipients', 500);

  if (recipients.length === 0) {
    logger.info({ scheduleId: schedule.id, name: schedule.name }, 'broadcast_schedule: tidak ada pasien cocok pada siklus ini, lewati');
  } else if (recipients.length > maxRecipients) {
    // TIDAK mengirim sebagian -- sama seperti sendBroadcastAction (kirim
    // manual), kesalahan filter tidak boleh diam-diam terpotong jadi
    // "hanya sebagian terkirim". Jadwal TETAP aktif -- staf perlu meninjau
    // dan mempersempit filter, atau menaikkan broadcast.max_recipients.
    logger.warn(
      { scheduleId: schedule.id, name: schedule.name, matched: recipients.length, maxRecipients },
      'broadcast_schedule: segmen melebihi broadcast.max_recipients, LEWATI siklus ini',
    );
    await logAudit(
      SCHEDULE_ACTOR,
      'broadcast_schedule_skip_too_large',
      String(schedule.id),
      `${recipients.length} pasien cocok > batas ${maxRecipients}`,
    );
  } else {
    const identity = await getHospitalIdentity();
    const ctx = await loadBroadcastContext(schedule.messageBody);

    const campaign = await BroadcastCampaign.create({
      createdBy: `${SCHEDULE_ACTOR}:${schedule.id}`,
      filterJson: schedule.filterJson,
      messageBody: schedule.messageBody,
      recipientCount: recipients.length,
    });

    for (const row of recipients) {
      await enqueueMessage(
        {
          idempotencyKey: buildIdempotencyKey('BROADCAST', campaign.id, row.no_rkm_medis),
          noRkmMedis: row.no_rkm_medis,
          rawPhone: row.no_tlp,
          eventAt: now,
          kdPoli: row.kd_poli,
          vars: { ...identityVars(identity), nama_pasien: row.nm_pasien ?? '', no_rm: row.no_rkm_medis },
          campaignId: campaign.id,
        },
        ctx,
      );
    }

    logger.info({ scheduleId: schedule.id, name: schedule.name, campaignId: campaign.id, recipients: recipients.length }, 'broadcast_schedule terkirim');
    await logAudit(SCHEDULE_ACTOR, 'broadcast_schedule_run', String(schedule.id), `kampanye #${campaign.id}, ${recipients.length} penerima`);
    await schedule.update({ lastRunAt: now, lastCampaignId: campaign.id });
  }

  const next = computeNextRunAt(
    {
      repeatKind: schedule.repeatKind,
      timeOfDay: schedule.timeOfDay,
      dayOfWeek: schedule.dayOfWeek,
      dayOfMonth: schedule.dayOfMonth,
      runOnceAt: schedule.runOnceAt,
    },
    now,
  );
  // 'once' yang baru saja jalan tidak punya jadwal berikutnya -> nonaktifkan
  // supaya daftar jadwal jelas membedakan "selesai" dari "masih aktif".
  await schedule.update({ nextRunAt: next, isActive: next ? schedule.isActive : false });
}
