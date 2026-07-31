import * as cron from 'node-cron';
import { Op, QueryTypes } from 'sequelize';
import { Outbox, SendLog, PatientContact } from '@/models';
import { sik } from '@/db/sik';
import { normalizePhone } from '@/core/phone';
import { logger, safeError } from '@/lib/logger';

const RETENTION_DAYS = 90;

/**
 * ARCHITECTURE §11. audit_log SENGAJA tidak disentuh di sini -- pengecualian
 * itu sudah ditegakkan hak akses MariaDB (§9.5), bukan cuma kode ini yang
 * "lupa" menghapusnya.
 */
async function cleanupOldRecords(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const deletedOutbox = await Outbox.destroy({ where: { status: 'sent', sentAt: { [Op.lt]: cutoff } } });
  const deletedLogs = await SendLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });

  logger.info({ deletedOutbox, deletedLogs }, 'pembersihan berkala: outbox & send_log lama dihapus');
}

/** ARCHITECTURE §11: patient_contact bersumber 'auto' dihitung ulang bila raw_value di sik berubah. */
async function refreshChangedContacts(): Promise<void> {
  const autoContacts = await PatientContact.findAll({ where: { source: 'auto' } });
  if (autoContacts.length === 0) return;

  const rmList = autoContacts.map((c) => c.noRkmMedis);
  const sikRows = await sik.query<{ no_rkm_medis: string; no_tlp: string | null }>(
    'SELECT no_rkm_medis, no_tlp FROM pasien WHERE no_rkm_medis IN (:rmList)',
    { replacements: { rmList }, type: QueryTypes.SELECT },
  );
  const sikMap = new Map(sikRows.map((r) => [r.no_rkm_medis, r.no_tlp]));

  let refreshed = 0;
  for (const contact of autoContacts) {
    const currentRaw = sikMap.get(contact.noRkmMedis) ?? null;
    if (currentRaw === contact.rawValue) continue;

    const result = normalizePhone(currentRaw);
    await contact.update({
      rawValue: currentRaw?.slice(0, 40) ?? null,
      phoneE164: result.ok ? result.value : null,
      reason: result.ok ? null : result.reason,
      checkedAt: new Date(),
    });
    refreshed++;
  }
  if (refreshed > 0) logger.info({ refreshed }, 'pembersihan berkala: patient_contact auto dihitung ulang');
}

export async function runCleanup(): Promise<void> {
  try {
    await cleanupOldRecords();
    await refreshChangedContacts();
  } catch (err) {
    logger.error(safeError(err), 'pembersihan berkala gagal');
  }
}

export function startCleanupSchedule(): void {
  cron.schedule('0 2 * * *', () => void runCleanup(), { timezone: 'Asia/Jakarta' });
  logger.info('penjadwal pembersihan berkala aktif (02:00 WIB)');
}
