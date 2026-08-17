import { Op } from 'sequelize';
import { BroadcastSchedule, BroadcastCampaign, getSettingNumber, logAudit } from '@/models';
import { type PatientSegmentRow } from '@/khanza/pasienSegment';
import { fetchSegmentUntukJadwal, isFollowupSchedule, isPilihSchedule, type ScheduleFilterConfig } from '@/khanza/broadcastSchedule';
import { getHospitalIdentity } from '@/khanza/common';
import { loadBroadcastContext, enqueueMessage, saringKunciBaru } from './pipeline';
import { broadcastVars } from '@/core/broadcastVars';
import { buildIdempotencyKey } from '@/core/idempotency';
import { computeNextRunAt, SCHEDULE_ACTOR, scheduleActor } from '@/core/schedule';
import { logger, safeError } from '@/lib/logger';

/**
 * Dipanggil periodik dari worker (index.ts). Ini bukan pemicu sisip/pindai
 * dari `sik` (ARCHITECTURE §4) -- ini kelas ketiga (BROADCAST, lihat
 * FITUR.md) yang dijalankan otomatis alih-alih diklik staf. Segmen dan
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

/**
 * Buang kunjungan yang kunci idempotennya sudah ada di outbox. Kuncinya
 * dihitung dengan rumus yang SAMA dipakai saat enqueue di bawah -- kalau
 * keduanya sampai berbeda, penyaringan ini cuma jadi tidak berguna (semua
 * lolos) dan UNIQUE KEY tetap menahan pesan gandanya; tidak ada kasus di mana
 * perbedaan itu justru melewatkan pesan yang seharusnya terkirim.
 */
async function filterAlreadySent(scheduleId: number, rows: PatientSegmentRow[]): Promise<PatientSegmentRow[]> {
  return saringKunciBaru(rows, (row) => buildIdempotencyKey('BROADCAST_FOLLOWUP', scheduleId, row.no_rawat));
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
  // isFollowupSchedule() sendiri yang menegakkan bahwa daftar pilihan dan mode
  // tindak lanjut saling meniadakan -- lihat alasannya di khanza/broadcastSchedule.ts.
  // Percabangan itu TIDAK diulang di sini justru supaya tidak bisa menyimpang.
  const followup = isFollowupSchedule(filterConfig);
  // Pintu yang SAMA dipakai pratinjau dashboard: daftar centang menggantikan
  // jendela tanggal, dan datanya tetap dibaca ulang dari `sik` tiap kali jalan.
  const matched = await fetchSegmentUntukJadwal(filterConfig);
  const maxRecipients = await getSettingNumber('broadcast.max_recipients', 500);

  // Mode tindak lanjut: buang lebih dulu kunjungan yang PERNAH dikirimi oleh
  // jadwal ini. UNIQUE KEY uq_idem tetap penjaga terakhirnya, tapi menyaring
  // di sini membuat broadcast_campaign jujur -- tanpa ini, jadwal harian
  // menumpuk baris kampanye yang mengaku punya penerima padahal tidak satu pun
  // pesan baru masuk outbox (broadcast_campaign insert-only, jadi angka yang
  // sudah terlanjur salah tidak bisa dikoreksi belakangan).
  const recipients = followup ? await filterAlreadySent(schedule.id, matched) : matched;

  if (recipients.length === 0) {
    logger.info(
      { scheduleId: schedule.id, name: schedule.name, matched: matched.length },
      matched.length > 0
        ? 'broadcast_schedule: semua kunjungan yang cocok sudah pernah dikirimi, lewati'
        : 'broadcast_schedule: tidak ada pasien cocok pada siklus ini, lewati',
    );
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
      createdBy: scheduleActor(schedule.id),
      filterJson: schedule.filterJson,
      messageBody: schedule.messageBody,
      recipientCount: recipients.length,
    });

    // Kunci idempoten berbeda per mode, dan bedanya menentukan berapa kali
    // seorang pasien bisa menerima pesan dari jadwal ini:
    //
    // - rolling : mengandung campaign.id yang BARU tiap kali jalan, jadi tiap
    //   siklus memang mengirim ulang ke siapa pun yang saat itu masuk jendela.
    //   Itu memang yang diminta pola "pengumuman berkala ke segmen".
    // - followup: mengandung schedule.id + no_rawat, TANPA campaign.id -- satu
    //   kunjungan hanya pernah memicu satu pesan tindak lanjut, selamanya.
    //   Ini jaring pengaman yang sungguhan: jadwal yang tidak sengaja jalan
    //   dua kali (worker restart, jam server mundur, staf menekan aktifkan
    //   berulang) TIDAK mengirimi pasien pesan kedua -- INSERT-nya ditolak
    //   UNIQUE KEY uq_idem di mesin database, bukan oleh disiplin kode.
    for (const row of recipients) {
      await enqueueMessage(
        {
          idempotencyKey: followup
            ? buildIdempotencyKey('BROADCAST_FOLLOWUP', schedule.id, row.no_rawat)
            : buildIdempotencyKey('BROADCAST', campaign.id, row.no_rkm_medis),
          noRkmMedis: row.no_rkm_medis,
          rawPhone: row.no_tlp,
          eventAt: now,
          kdPoli: row.kd_poli,
          vars: broadcastVars(row, identity),
          campaignId: campaign.id,
        },
        ctx,
      );
    }

    logger.info(
      {
        scheduleId: schedule.id,
        name: schedule.name,
        campaignId: campaign.id,
        recipients: recipients.length,
        mode: isPilihSchedule(filterConfig) ? 'pilih' : followup ? 'followup' : 'rolling',
      },
      'broadcast_schedule terkirim',
    );
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
