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
import { runDueBroadcastSchedules } from './broadcastScheduleRunner';
import { startScheduler } from './scheduler';
import { dispatchTick, recoverInterruptedSends } from './dispatcher';
import { initWaClient, isWaReady, getWaSessionStatus, updateHeartbeat, getClient, checkHealth } from './wa-client';
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

let sedangBerhenti = false;

/**
 * Penutupan rapi -- dan bagian TERPENTINGNYA adalah `client.destroy()`.
 *
 * whatsapp-web.js menyimpan state sesi di `.wwebjs_auth` lewat LevelDB milik
 * Chromium. Membunuh Chromium di tengah penulisan meninggalkan state yang tidak
 * konsisten, dan gejalanya baru muncul pada start BERIKUTNYA: `authenticated`
 * menyala lalu `ready` tidak pernah datang -- sesi menggantung tanpa batas
 * waktu. Itu bukan teori: baris pertama fungsi ini ("wakhanza-worker
 * berhenti...") tidak pernah muncul SEKALI PUN di log, di seluruh restart yang
 * pernah terjadi, sementara sesi berulang kali tersangkut di `authenticating`.
 *
 * Dua sebab, dan keduanya khas Windows -- karena itu tidak pernah terlihat
 * selama pengembangan dengan Ctrl+C di terminal:
 *
 * 1. Windows tidak punya sinyal POSIX. PM2 tidak benar-benar mengirim SIGTERM;
 *    `process.on('SIGTERM')` di bawah praktis tidak pernah menyala. Jalan
 *    resminya adalah `shutdown_with_message: true` di ecosystem.config.js, yang
 *    mengirim pesan IPC `'shutdown'` -- ditangani di bawah.
 * 2. `kill_timeout` bawaan PM2 hanya 1600 ms. Menutup Chromium dan menuntaskan
 *    flush LevelDB tidak pernah selesai secepat itu, jadi bahkan bila sinyalnya
 *    sampai, SIGKILL tetap datang di tengah jalan. Dinaikkan di config.
 */
async function shutdown(alasan: string, exitCode = 0): Promise<void> {
  if (sedangBerhenti) return; // sinyal + pesan IPC bisa datang berbarengan
  sedangBerhenti = true;

  logger.info({ alasan, exitCode }, 'wakhanza-worker berhenti...');
  running = false;
  try {
    // Batas waktu sendiri, karena sebagian pemanggil justru keluar BECAUSE
    // Chromium menggantung -- dan `destroy()` pada Chromium yang menggantung
    // bisa ikut menggantung. Tanpa batas ini, proses yang seharusnya keluar
    // supaya disupervisi ulang malah berhenti di tempat tanpa keluar sama
    // sekali, yaitu persis kegagalan yang sedang coba dipulihkan.
    await Promise.race([
      getClient().destroy(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('destroy melewati batas waktu')), 15_000)),
    ]);
    logger.info('sesi WhatsApp ditutup rapi');
  } catch (err) {
    // Klien mungkin belum terinisialisasi -- itu wajar saat berhenti dini.
    // Kegagalan LAIN tetap dicatat: penutupan yang gagal di sinilah yang
    // merusak sesi untuk start berikutnya, jadi ia tidak boleh diam-diam.
    logger.warn(safeError(err), 'sesi WhatsApp tidak bisa ditutup rapi');
  }
  await sik.close();
  await db.close();
  process.exit(exitCode);
}

/** Semua pemicu kelas sisip (ARCHITECTURE §4.1) -- watermark, interval rapat (POLL_INTERVAL_MS). */
async function runAllSisipCycles(): Promise<void> {
  await runQueueRegCycle();
  await runResultReadyCycle();
  await runPharmacyReadyCycle();
  await runBillingReadyCycle();
}

/**
 * Batas waktu sesi WhatsApp boleh berada DI LUAR status `ready`.
 *
 * Transisi sehat berlangsung di bawah satu detik. Yang benar-benar terjadi di
 * mesin ini adalah sesi tersangkut di `authenticating` **berjam-jam**: worker
 * hidup, poller tetap berputar, PM2 melaporkan `online`, dan tidak satu pun
 * notifikasi bisa terkirim atau diterima. Dashboard memang menandainya (lihat
 * SystemStatus di /ringkasan), tapi itu mengandalkan ada orang yang membuka
 * dashboard -- dan kejadiannya jam 01:25 dini hari, ditemukan 14 jam kemudian.
 *
 * Pemeriksaan kesehatan yang lama tidak menangkapnya karena ia berhenti lebih
 * dulu (`if (!isWaReady()) return`): ia hanya menjaga sesi yang SUDAH siap dari
 * Chromium yang menggantung, bukan sesi yang tidak pernah sampai siap.
 */
const BATAS_TIDAK_SIAP_MS = 15 * 60 * 1000;

/**
 * Kenapa 15 menit dan bukan lebih pendek, padahal transisi sehatnya di bawah
 * satu detik: menyalakan ulang lebih agresif justru bisa memperpanjang matinya.
 * Bukti yang terkumpul di mesin ini menunjukkan penautan ulang yang terlalu
 * sering membuat WhatsApp memperlambat sinkronisasi -- satu start setelah jeda
 * panjang mencapai `ready` dalam 5 detik, sementara empat start beruntun
 * sesudahnya semuanya tersangkut. Watchdog yang menyala tiap 5 menit akan
 * menjadi sumber masalahnya sendiri, bukan pemulihannya.
 *
 * 15 menit adalah kompromi yang sengaja: masih membatasi pemadaman jauh di
 * bawah 14 jam yang pernah terjadi, tapi cukup jarang untuk tidak menjadi
 * rentetan penautan ulang.
 */

/**
 * `qr_pending` SENGAJA dikecualikan: itu bukan macet, melainkan sistem yang
 * benar sedang menunggu manusia memindai QR -- bisa berjam-jam saat pemasangan
 * pertama, dan keluar-lalu-restart di tengahnya justru menerbitkan QR baru
 * sehingga kode yang sedang dipindai petugas jadi kedaluwarsa.
 */
const STATUS_MENUNGGU_MANUSIA = new Set<string>(['qr_pending']);

let sesiSiapTerakhirAt = Date.now();

async function sessionWatchdog(): Promise<void> {
  const status = await getWaSessionStatus();

  if (status === 'ready') {
    sesiSiapTerakhirAt = Date.now();
    // ARCHITECTURE §10: Chromium yang menggantung adalah mode kegagalan nyata
    // yang tidak terlihat dari status 'ready' semata. outbox bersifat permanen
    // (§12.4), jadi keluar dan biarkan PM2 menyalakan ulang -- tidak ada pesan
    // yang hilang karena restart.
    if (!(await checkHealth())) {
      logger.fatal('pemeriksaan kesehatan gagal, keluar supaya proses disupervisi ulang');
      // Lewat shutdown(), BUKAN process.exit() langsung: keluar tanpa menutup
      // Chromium meninggalkan state sesi setengah tertulis, sehingga proses
      // pengganti menggantung di `authenticating` -- pemulihan yang justru
      // menciptakan kegagalan berikutnya.
      await shutdown('pemeriksaan kesehatan gagal', 1);
    }
    return;
  }

  if (status !== null && STATUS_MENUNGGU_MANUSIA.has(status)) {
    sesiSiapTerakhirAt = Date.now();
    return;
  }

  const diamMs = Date.now() - sesiSiapTerakhirAt;
  if (diamMs >= BATAS_TIDAK_SIAP_MS) {
    logger.fatal(
      { status, diamMenit: Math.round(diamMs / 60_000) },
      'sesi WhatsApp tidak mencapai `ready` melewati batas, keluar supaya proses disupervisi ulang',
    );
    await shutdown('sesi tidak mencapai ready', 1);
    return;
  }
  logger.warn({ status, diamDetik: Math.round(diamMs / 1000) }, 'sesi WhatsApp belum siap');
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

  // Dijalankan SEBELUM dispatcher menyala, supaya baris tersangkut dari proses
  // sebelumnya sudah beres sebelum ada baris `sending` baru yang sah.
  await recoverInterruptedSends();

  await initWaClient();

  const pollIntervalMs = await getSettingNumber('polling.interval_ms', 60_000);
  const scanIntervalMs = await getSettingNumber('polling.scan_interval_ms', 300_000);
  logger.info({ pollIntervalMs, scanIntervalMs }, 'memulai siklus poller');

  void loop('poller:sisip', runAllSisipCycles, pollIntervalMs);
  // ARCHITECTURE §4.7: kelas pindai (booking) di interval lebih longgar --
  // memindai penuh booking_registrasi tiap 60 detik = 1.440x/hari untuk
  // keuntungan yang tidak terasa siapa pun.
  void loop('poller:booking', runBookingCycle, scanIntervalMs);
  // Kelas ketiga (BROADCAST terjadwal/berulang, CLAUDE.md) -- interval sama
  // seperti kelas pindai, karena sama-sama scan tabel penuh (broadcast_schedule
  // jauh lebih kecil dari booking_registrasi, jadi ini longgar, bukan ketat).
  void loop('broadcast-schedule', runDueBroadcastSchedules, scanIntervalMs);
  void dispatcherLoop();
  void loop(
    'heartbeat',
    async () => {
      if (await isWaReady()) await updateHeartbeat();
    },
    30_000,
  );
  void loop('session-command', processSessionCommand, 5_000);
  void loop('session-watchdog', sessionWatchdog, 60_000);

  await startScheduler();
  startCleanupSchedule();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
// Jalur yang benar-benar terpakai di Windows (shutdown_with_message: true).
// SIGINT/SIGTERM di atas tetap ada untuk `npm run worker` + Ctrl+C dan untuk
// pemasangan di Linux.
process.on('message', (msg) => {
  if (msg === 'shutdown') void shutdown('pesan shutdown PM2');
});

main().catch((err) => {
  logger.fatal(safeError(err), 'worker gagal memulai');
  process.exit(1);
});
