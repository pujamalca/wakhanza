import { WaSession } from '@/models';
import { getClient } from './wa-client';
import { logger, safeError } from '@/lib/logger';

/**
 * ARCHITECTURE §1: dashboard menitip perintah lewat wa_session.command;
 * worker membacanya lalu mengosongkannya. Command dikonsumsi (di-set balik
 * ke 'none') SEBELUM dieksekusi supaya perintah yang gagal tidak diulang
 * tanpa henti tiap siklus.
 */
export async function processSessionCommand(): Promise<void> {
  const row = await WaSession.findByPk(1);
  if (!row || row.command === 'none') return;

  const command = row.command;
  await WaSession.update({ command: 'none' }, { where: { id: 1 } });

  try {
    const client = getClient();
    if (command === 'logout') {
      logger.warn('perintah logout diterima dari dashboard, memutus sesi WhatsApp');
      await client.logout();
      await WaSession.update(
        { status: 'qr_pending', phoneNumber: null, qrData: null, lastError: null },
        { where: { id: 1 } },
      );
      await client.initialize();
    } else if (command === 'reconnect') {
      logger.info('perintah sambung ulang diterima dari dashboard');
      await client.resetState();
    }
  } catch (err) {
    logger.error({ command, ...safeError(err) }, 'gagal menjalankan perintah sesi dari dashboard');
    await WaSession.update({ lastError: safeError(err).message }, { where: { id: 1 } });
  }
}
