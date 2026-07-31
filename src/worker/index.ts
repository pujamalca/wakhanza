import { sik } from '@/db/sik';
import { db } from '@/db/wakhanza';
import { assertSikReadOnly, assertAuditLogAppendOnly, assertRequiredSikColumnsExist } from '@/db/guards';
import { getSettingNumber } from '@/models';
import { logger, safeError } from '@/lib/logger';
import { runQueueRegCycle } from './poller';
import { runResultReadyCycle } from './pollerResultReady';
import { runPharmacyReadyCycle } from './pollerPharmacy';
import { runBillingReadyCycle } from './pollerBilling';
import { runBookingCycle } from './pollerBooking';
import { startScheduler } from './scheduler';
import { dispatchTick } from './dispatcher';
import { initWaClient, isWaReady, updateHeartbeat, getClient, checkHealth } from './wa-client';
import { processSessionCommand } from './sessionCommand';
import { startCleanupSchedule } from './cleanup';
import { randomDelayMs } from '@/core/retry';

let running = true;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loop(name: string, fn: () => Promise<void>, intervalMs: number): Promise<void> {
  while (running) {
    const startedAt = Date.now();
    try {
      await fn();
    } catch (err) {
      logger.error({ loop: name, ...safeError(err) }, 'loop error tak tertangani');
    }
    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(intervalMs - elapsed, 0));
  }
}

async function dispatcherLoop(): Promise<void> {
  const minDelay = Number(process.env.WA_SEND_MIN_DELAY_MS ?? '3000');
  const maxDelay = Number(process.env.WA_SEND_MAX_DELAY_MS ?? '8000');
  while (running) {
    let didWork = false;
    try {
      didWork = await dispatchTick();
    } catch (err) {
      logger.error({ loop: 'dispatcher', ...safeError(err) }, 'dispatcher tick error');
    }
    // F5.2: jeda acak 3-8 detik HANYA setelah percobaan kirim sungguhan, supaya
    // pengiriman beruntun cepat (pola pemicu deteksi spam WhatsApp) tidak terjadi.
    await sleep(didWork ? randomDelayMs(minDelay, maxDelay) : 5000);
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'wakhanza-worker berhenti...');
  running = false;
  try {
    await getClient().destroy();
  } catch {
    // klien mungkin belum terinisialisasi -- aman diabaikan saat shutdown.
  }
  await sik.close();
  await db.close();
  process.exit(0);
}

/** Semua pemicu kelas sisip (ARCHITECTURE §4.1) -- watermark, interval rapat (POLL_INTERVAL_MS). */
async function runAllSisipCycles(): Promise<void> {
  await runQueueRegCycle();
  await runResultReadyCycle();
  await runPharmacyReadyCycle();
  await runBillingReadyCycle();
}

async function main(): Promise<void> {
  logger.info('wakhanza-worker memulai...');

  // N1 / ARCHITECTURE §9.1: worker menolak jalan bila prinsip read-only atau
  // append-only audit_log ternyata tidak ditegakkan mesin. Periksa, jangan percaya.
  try {
    await assertSikReadOnly();
    await assertAuditLogAppendOnly();
    await assertRequiredSikColumnsExist();
  } catch (err) {
    logger.fatal(safeError(err), 'PEMERIKSAAN KEAMANAN STARTUP GAGAL -- worker menolak jalan');
    process.exit(1);
  }

  await sik.authenticate();
  await db.authenticate();
  logger.info('koneksi database terverifikasi (read-only sik, read-write wakhanza)');

  await initWaClient();

  const pollIntervalMs = await getSettingNumber('polling.interval_ms', 60_000);
  const scanIntervalMs = await getSettingNumber('polling.scan_interval_ms', 300_000);
  logger.info({ pollIntervalMs, scanIntervalMs }, 'memulai siklus poller');

  void loop('poller:sisip', runAllSisipCycles, pollIntervalMs);
  // ARCHITECTURE §4.7: kelas pindai (booking) di interval lebih longgar --
  // memindai penuh booking_registrasi tiap 60 detik = 1.440x/hari untuk
  // keuntungan yang tidak terasa siapa pun.
  void loop('poller:booking', runBookingCycle, scanIntervalMs);
  void dispatcherLoop();
  void loop(
    'heartbeat',
    async () => {
      if (await isWaReady()) await updateHeartbeat();
    },
    30_000,
  );
  void loop('session-command', processSessionCommand, 5_000);
  void loop(
    'health-check',
    async () => {
      if (!(await isWaReady())) return;
      const healthy = await checkHealth();
      if (!healthy) {
        // ARCHITECTURE §10: Chromium yang menggantung adalah mode kegagalan
        // nyata yang tidak terlihat dari status 'ready' semata. outbox
        // bersifat permanen (§12.4), jadi keluar dan biarkan PM2
        // (ecosystem.config.js, max_memory_restart/autorestart) menyalakan
        // ulang -- tidak ada pesan yang hilang karena restart.
        logger.fatal('pemeriksaan kesehatan gagal berturut-turut, keluar supaya proses disupervisi ulang');
        process.exit(1);
      }
    },
    120_000,
  );

  await startScheduler();
  startCleanupSchedule();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err) => {
  logger.fatal(safeError(err), 'worker gagal memulai');
  process.exit(1);
});
