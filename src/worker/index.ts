import { sik } from '@/db/sik';
import { db } from '@/db/wakhanza';
import { assertSikReadOnly, assertAuditLogAppendOnly, assertRequiredSikColumnsExist } from '@/db/guards';
import { getSettingNumber, WaSession } from '@/models';
import { logger, safeError } from '@/lib/logger';
import { runQueueRegCycle } from './poller';
import { runResultReadyCycle } from './pollerResultReady';
import { runPharmacyReadyCycle } from './pollerPharmacy';
import { runBillingReadyCycle } from './pollerBilling';
import { runBookingCycle } from './pollerBooking';
import { runFarmasiCycles } from './farmasiRunner';
import { runDueBroadcastSchedules } from './broadcastScheduleRunner';
import { runBpjsBatalCycles, runBpjsKontrolIfDue } from './bpjsRunner';
import { runKontrolUlangIfDue } from './kontrolUlangRunner';
import { runKontrolTerbitCycle } from './kontrolTerbitRunner';
import { runPermintaanCycle } from './pollerPermintaan';
import { runDueStokDarurat } from './stokDaruratRunner';
import { runSuratOtomatisCycle } from './suratRunner';
import { runPengadaanCycle } from './pengadaanRunner';
import { runPenjualanCycle } from './penjualanRunner';
import { runPenjualanRekapIfDue } from './penjualanRekapRunner';
import { runResepRekapIfDue } from './resepRekapRunner';
import { runFarmasiBulananIfDue } from './farmasiBulananRunner';
import { runAdministrasiBulananIfDue } from './administrasiBulananRunner';
import { runPenilaianRekapIfDue } from './penilaianRunner';
import { runHibahCycle } from './hibahRunner';
import { runPemesananCycle } from './pemesananRunner';
import { runAckWatchdog } from './ackWatchdog';
import { startScheduler } from './scheduler';
import { dispatchTick, recoverInterruptedSends } from './dispatcher';
import {
  initWaClient,
  getWaSessionStatus,
  updateHeartbeat,
  getClient,
  checkHealth,
  bersihkanDirektoriSesi,
} from './wa-client';
import { processSessionCommand } from './sessionCommand';
import { startCleanupSchedule } from './cleanup';
import { sendAlert } from './alert';
import { putusanWatchdog } from '@/core/watchdog';
import { acquireWorkerLock, releaseWorkerLock, KODE_KELUAR_DIGANTIKAN } from './singleInstance';
import { randomDelayMs } from '@/core/retry';

let running = true;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Berapa siklus yang sedang BERADA DI DALAM `fn()` saat ini.
 *
 * Ada supaya `shutdown()` bisa menunggu mereka selesai sebelum menutup kolam
 * database. Tanpa itu penutupannya membalap siklus yang masih berjalan, dan
 * yang muncul di log adalah `ConnectionManager.getConnection was called after
 * the connection manager was closed!` -- terlihat pada loop `heartbeat` dan
 * `poller:sisip` di produksi 2026-08-09.
 *
 * Yang membuatnya lebih dari sekadar berisik: galat itu lahir DI TENGAH sebuah
 * siklus, jadi pekerjaan yang setengah jalan ditinggalkan pada titik sembarang.
 * Untuk pemicu kelas sisip, watermark-nya sudah mungkin termajukan sementara
 * pesannya belum sempat masuk `outbox` -- baris yang lompat itu tidak akan
 * pernah dibaca lagi, tanpa satu pun tanda.
 */
let siklusBerjalan = 0;

async function jalankanSiklus(name: string, fn: () => Promise<void>): Promise<void> {
  siklusBerjalan++;
  try {
    await fn();
  } catch (err) {
    logger.error({ loop: name, ...safeError(err) }, 'loop error tak tertangani');
  } finally {
    siklusBerjalan--;
  }
}

async function loop(name: string, fn: () => Promise<void>, intervalMs: number): Promise<void> {
  while (running) {
    const startedAt = Date.now();
    await jalankanSiklus(name, fn);
    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(intervalMs - elapsed, 0));
  }
}

async function dispatcherLoop(): Promise<void> {
  const minDelay = Number(process.env.WA_SEND_MIN_DELAY_MS ?? '3000');
  const maxDelay = Number(process.env.WA_SEND_MAX_DELAY_MS ?? '8000');
  while (running) {
    let didWork = false;
    // Ikut dihitung `siklusBerjalan`: justru inilah loop yang paling mahal
    // dipotong di tengah, karena titik yang tidak bisa kita ketahui hasilnya
    // (`sending` sudah ditulis, pesannya mungkin sudah sampai ke WhatsApp) ada
    // di dalamnya -- lihat recoverInterruptedSends().
    await jalankanSiklus('dispatcher', async () => {
      didWork = await dispatchTick();
    });
    // F5.2: jeda acak 3-8 detik HANYA setelah percobaan kirim sungguhan, supaya
    // pengiriman beruntun cepat (pola pemicu deteksi spam WhatsApp) tidak terjadi.
    await sleep(didWork ? randomDelayMs(minDelay, maxDelay) : 5000);
  }
}

/**
 * Menunggu siklus yang sedang berjalan selesai, dengan anggaran.
 *
 * Anggarannya WAJIB ada dan wajib lebih pendek dari `kill_timeout` PM2 (20
 * detik): sebagian pemanggil `shutdown()` keluar JUSTRU karena ada yang
 * menggantung, dan menunggu tanpa batas berarti proses yang seharusnya
 * disupervisi ulang malah berhenti di tempat -- persis kegagalan yang sedang
 * dipulihkan. Lewat anggaran, kolam tetap ditutup: satu galat koneksi pada
 * siklus yang memang sudah macet lebih murah daripada tidak pernah keluar.
 */
async function tungguSiklusSelesai(budgetMs = 8_000): Promise<void> {
  const batas = Date.now() + budgetMs;
  while (siklusBerjalan > 0 && Date.now() < batas) {
    await sleep(100);
  }
  if (siklusBerjalan > 0) {
    logger.warn({ siklusBerjalan }, 'siklus masih berjalan saat kolam database ditutup -- galat koneksi mungkin menyusul');
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
  // `running = false` di atas hanya menghentikan siklus BERIKUTNYA; yang sedang
  // berada di dalam `fn()` tidak terpengaruh sama sekali. Menutup kolam di sini
  // tanpa menunggu adalah yang menghasilkan `ConnectionManager ... closed` di
  // tengah siklus, berikut pekerjaan setengah jalan yang ditinggalkannya.
  await tungguSiklusSelesai();
  await sik.close();
  await db.close();
  // Dilepas SESUDAH sesi ditutup: pengganti yang sedang menunggu tidak boleh
  // menyentuh direktori sesi sebelum Chromium di sini benar-benar selesai
  // menulis. Sistem operasi juga melepasnya sendiri saat proses mati, jadi ini
  // hanya mempercepat peralihan -- bukan syarat kebenaran.
  await releaseWorkerLock();
  process.exit(exitCode);
}

/** Semua pemicu kelas sisip (ARCHITECTURE §4.1) -- watermark, interval rapat (POLL_INTERVAL_MS). */
async function runAllSisipCycles(): Promise<void> {
  await runQueueRegCycle();
  // Permintaan lab/radiologi ditaruh SEBELUM hasilnya, mengikuti urutan
  // kejadiannya di dunia nyata: pemeriksaan dipesan dulu, hasilnya menyusul.
  // Urutan di dalam satu siklus tidak menentukan apa pun secara teknis (tiap
  // pemicu punya watermarknya sendiri), tapi urutan yang mengikuti alur kerja
  // membuat log satu siklus bisa dibaca sebagai cerita.
  await runPermintaanCycle();
  await runResultReadyCycle();
  await runPharmacyReadyCycle();
  await runBillingReadyCycle();
  // Notifikasi farmasi ikut di sini karena sumbernya sama-sama `resep_obat` dan
  // kelasnya sama-sama sisip (watermark). Bedanya cuma tujuannya: staf apotek,
  // bukan pasien. Ia menjaga sakelarnya sendiri (`farmasi.enabled`, default
  // MATI), jadi aman dipanggil tiap siklus tanpa syarat di sini.
  await runFarmasiCycles();
  // Pembatalan Mobile JKN: kelas pindai (tabelnya tidak punya indeks waktu --
  // lihat khanza/bpjsBatal.ts), tapi diletakkan di siklus RAPAT dan bukan di
  // siklus pindai bersama booking. Alasannya bukan besarnya tabel melainkan
  // gunanya: slot yang batal ada supaya bisa ditawarkan ke pasien lain, dan
  // kabar itu basi kalau datang lima menit kemudian. Tabelnya sendiri bertambah
  // ~2,8 baris per hari, jadi biayanya tidak sebanding dengan booking.
  // Menjaga sakelarnya sendiri (`bpjs.enabled`, default MATI).
  await runBpjsBatalCycles();
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
 * Batas waktu PENAUTAN, dan ia sengaja lebih pendek daripada `protocolTimeout`
 * (300 detik di `wa-client.ts`).
 *
 * Yang dibeli bukan kecepatan matinya melainkan CARA matinya. Dibiarkan sampai
 * `protocolTimeout`, init yang menggantung dilempar sebagai galat ke
 * `main().catch()` lalu `process.exit(1)` -- TANPA lewat `shutdown()`, sehingga
 * Chromium mati mendadak di tengah menulis state sesi dan start berikutnya
 * mewarisi kerusakannya. Terukur pada gangguan 14 Agustus 2026: percobaan demi
 * percobaan menggantung tepat 325,8 detik, dan baru berhenti setelah direktori
 * sesi dikosongkan.
 *
 * 180 detik memberi jarak dua menit dari `protocolTimeout` -- cukup lebar supaya
 * keduanya tidak pernah berlomba, dan jauh di atas penautan yang sehat: terukur
 * 5 detik sampai QR terbit maupun sampai poller menyala.
 */
const BATAS_INIT_MS = 180_000;

let sesiSiapTerakhirAt = Date.now();
let initMulaiAt = Date.now();
let initSelesai = false;

async function sessionWatchdog(): Promise<void> {
  /**
   * Status TIDAK dibaca selama penautan, dan itu bukan penghematan query:
   * `wa_session` masih memuat status milik proses SEBELUMNYA, jadi membacanya
   * bukan menjawab pertanyaan melainkan menjawab pertanyaan yang salah.
   */
  const status = initSelesai ? await getWaSessionStatus() : null;
  const putusan = putusanWatchdog({
    initSelesai,
    msSejakInitMulai: Date.now() - initMulaiAt,
    batasInitMs: BATAS_INIT_MS,
    status,
    msSejakSiapTerakhir: Date.now() - sesiSiapTerakhirAt,
    batasTidakSiapMs: BATAS_TIDAK_SIAP_MS,
  });

  if (putusan.aksi === 'periksa-kesehatan') {
    sesiSiapTerakhirAt = Date.now();
    // ARCHITECTURE §10: Chromium yang menggantung adalah mode kegagalan nyata
    // yang tidak terlihat dari status 'ready' semata. outbox bersifat permanen
    // (§12.4), jadi keluar dan biarkan PM2 menyalakan ulang -- tidak ada pesan
    // yang hilang karena restart.
    if (!(await checkHealth())) {
      logger.fatal('pemeriksaan kesehatan gagal, keluar supaya proses disupervisi ulang');
      // Dikirim SEBELUM shutdown(): sesudahnya prosesnya sudah tidak ada.
      // Ditunggu (bukan void) karena batas waktunya sudah keras 10 detik dan
      // peringatan yang belum sempat terkirim sama saja dengan tidak ada.
      await sendAlert({
        kind: 'health_check_failed',
        message: 'Sesi WhatsApp lulus status `ready` tapi tidak menjawab -- worker dimulai ulang.',
        detail: 'Bila berulang, buka /koneksi dan periksa apakah sesi perlu ditautkan ulang.',
      });
      // Lewat shutdown(), BUKAN process.exit() langsung: keluar tanpa menutup
      // Chromium meninggalkan state sesi setengah tertulis, sehingga proses
      // pengganti menggantung di `authenticating` -- pemulihan yang justru
      // menciptakan kegagalan berikutnya.
      await shutdown('pemeriksaan kesehatan gagal', 1);
    }
    return;
  }

  if (putusan.aksi === 'diam') {
    if (putusan.setelUlangJamSiap) sesiSiapTerakhirAt = Date.now();
    // Penautan yang sehat selesai jauh sebelum tick pertama (60 detik), jadi
    // baris ini hanya muncul saat ada yang tidak beres -- dan justru itulah
    // kejadian yang selama ini berlangsung tanpa satu pun baris log.
    if (putusan.fase !== 'menunggu-manusia') {
      logger.warn(
        { status, fase: putusan.fase, diamDetik: Math.round(putusan.diamMs / 1000) },
        putusan.fase === 'menautkan' ? 'sesi WhatsApp masih menautkan' : 'sesi WhatsApp belum siap',
      );
    }
    return;
  }

  const menit = Math.round(putusan.diamMs / 60_000);
  if (putusan.fase === 'menautkan') {
    logger.fatal(
      { diamMenit: menit },
      'penautan sesi WhatsApp tidak selesai melewati batas, keluar supaya proses disupervisi ulang',
    );
    // Peringatan TERSENDIRI dari `session_stuck`, dan pemisahannya menentukan
    // tindakan: yang itu pulih sendiri lewat restart, yang ini biasanya TIDAK --
    // ia berulang sampai direktori sesi dikosongkan dan QR dipindai ulang, dan
    // itu menuntut akses fisik ke ponsel nomor RS.
    await sendAlert({
      kind: 'session_init_stuck',
      message: `Penautan sesi WhatsApp tidak selesai dalam ${menit} menit -- worker dimulai ulang.`,
      detail:
        'Bila peringatan ini berulang, state sesi kemungkinan rusak: hentikan worker, pindahkan folder .wwebjs_auth, jalankan lagi, lalu pindai QR di /koneksi.',
    });
    await shutdown('penautan sesi tidak selesai', 1);
    return;
  }

  logger.fatal(
    { status, diamMenit: menit },
    'sesi WhatsApp tidak mencapai `ready` melewati batas, keluar supaya proses disupervisi ulang',
  );
  // Inilah kejadian yang dulu berlangsung 14 jam tanpa ada yang tahu.
  // Watchdog memang memulihkannya sendiri, tapi kalau pemulihannya gagal
  // berulang, peringatan inilah satu-satunya yang membedakan "pulih dalam 15
  // menit" dari "mati semalaman".
  await sendAlert({
    kind: 'session_stuck',
    message: `Sesi WhatsApp tersangkut di status "${status ?? 'tidak diketahui'}" lebih dari ${Math.round(BATAS_TIDAK_SIAP_MS / 60_000)} menit -- worker dimulai ulang.`,
    detail: 'Tidak ada pesan yang bisa dikirim maupun diterima selama ini. Buka /koneksi bila peringatan ini berulang.',
  });
  await shutdown('sesi tidak mencapai ready', 1);
}

/**
 * Menghapus direktori sesi yang dititipkan `logout` (054), bila ada.
 *
 * TIDAK PERNAH melempar. Kegagalannya tidak boleh menjatuhkan worker: yang
 * hilang cuma pembersihan yang bisa dicoba lagi pada start berikutnya,
 * sementara worker yang gagal menyala menghentikan seluruh notifikasi.
 */
async function kerjakanHapusSesiTertunda(): Promise<void> {
  try {
    const row = await WaSession.findByPk(1);
    if (!row?.hapusSesiSaatMulai) return;

    logger.warn('direktori sesi dititipkan untuk dihapus, dikerjakan sebelum Chromium menyala');
    const berhasil = await bersihkanDirektoriSesi();

    if (berhasil) {
      await WaSession.update(
        {
          hapusSesiSaatMulai: false,
          // Dikosongkan: kalimat "akan dihapus otomatis" sudah tidak benar lagi
          // begitu ia benar-benar terhapus, dan keterangan basi di halaman
          // Koneksi terbaca sebagai gangguan yang masih berlangsung.
          lastError: null,
        },
        { where: { id: 1 } },
      );
      logger.info('direktori sesi tertunda berhasil dihapus, sesi akan dimulai dari nol');
      return;
    }

    // Bendera SENGAJA dibiarkan menyala: start berikutnya mencoba lagi. Yang
    // tidak boleh terjadi adalah bendera padam sementara direktorinya masih ada.
    await WaSession.update(
      {
        lastError:
          'Berkas sesi lama masih belum bisa dihapus walau worker baru menyala. Biasanya ada pemindai virus yang sedang membacanya — worker akan mencoba lagi tiap kali menyala.',
      },
      { where: { id: 1 } },
    );
    logger.error('direktori sesi tertunda TETAP gagal dihapus, bendera dibiarkan menyala');
  } catch (err) {
    logger.error(safeError(err), 'gagal mengerjakan penghapusan sesi tertunda');
  }
}

async function main(): Promise<void> {
  logger.info('wakhanza-worker memulai...');

  // PALING AWAL, sebelum database dan sebelum Chromium: yang diperebutkan
  // adalah direktori sesi, dan instance yang kalah harus tahu SEBELUM
  // menyentuhnya sama sekali. Lihat singleInstance.ts untuk kenapa yang kalah
  // MEMINTA pemegangnya mundur alih-alih keluar (keluar memberi makan loop
  // restart PM2) atau sekadar menunggu (PM2 berakhir melacak proses yang tidak
  // memegang sesi, sehingga restart tidak pernah menjalankan kode baru).
  //
  // Keluarnya WAJIB lewat shutdown(), bukan process.exit(): pemegang yang
  // mundur harus menutup Chromium dengan rapi, kalau tidak ia meninggalkan
  // state sesi setengah tertulis untuk instance yang mengambil alih -- persis
  // kerusakan yang membuat sesi menggantung di `authenticating`.
  // Kode keluarnya BUKAN 0, dan itu bagian dari perbaikannya -- lihat
  // KODE_KELUAR_DIGANTIKAN di singleInstance.ts. Mundur dengan exit 0 membuat
  // PM2 meluncurkan pengganti, yang mengusir pemegang berikutnya, yang mundur:
  // loop yang tidak pernah konvergen (115 restart dalam 15 menit).
  await acquireWorkerLock(
    () => void shutdown('diminta mundur oleh instance worker yang lebih baru', KODE_KELUAR_DIGANTIKAN),
  );

  // N1 / ARCHITECTURE §9.1: worker menolak jalan bila prinsip read-only atau
  // append-only audit_log ternyata tidak ditegakkan mesin. Periksa, jangan percaya.
  try {
    await assertSikReadOnly();
    await assertAuditLogAppendOnly();
    await assertRequiredSikColumnsExist();
  } catch (err) {
    const e = safeError(err);
    logger.fatal(e, 'PEMERIKSAAN KEAMANAN STARTUP GAGAL -- worker menolak jalan');
    // Kegagalan paling senyap dari semuanya: worker menolak jalan, PM2 terus
    // menyalakannya ulang, dan dashboard tetap tampil normal karena proses web
    // memang hidup sendiri. Tidak satu pun pesan terkirim, tanpa ada yang tahu.
    await sendAlert({
      kind: 'startup_failed',
      message: 'Worker MENOLAK JALAN -- pemeriksaan keamanan startup gagal.',
      detail: `${e.message}\nTidak ada pesan yang akan terkirim sampai ini diperbaiki.`,
    });
    process.exit(1);
  }

  await sik.authenticate();
  await db.authenticate();
  logger.info('koneksi database terverifikasi (read-only sik, read-write wakhanza)');

  // Dijalankan SEBELUM dispatcher menyala, supaya baris tersangkut dari proses
  // sebelumnya sudah beres sebelum ada baris `sending` baru yang sah.
  await recoverInterruptedSends();

  /**
   * DENYUT dan WATCHDOG dipasang SEBELUM penautan, dan urutan ini bagian dari
   * perbaikan -- bukan kerapian.
   *
   * Keduanya dulu ada di bawah `await initWaClient()`, sehingga proses yang
   * menggantung DI DALAM penautan tidak berdenyut dan tidak diawasi siapa pun.
   * Akibatnya dua keadaan yang menuntut tindakan berlawanan terlihat sama persis
   * dari luar -- keduanya `authenticating`, keduanya PM2 `online`, keduanya nol
   * pesan keluar -- dan satu-satunya yang membedakannya (umur denyut) justru
   * tidak tersedia. Terukur pada gangguan 14 Agustus 2026, dan mendiagnosisnya
   * memakan setengah jam yang seharusnya cukup satu query.
   *
   * Aman dijalankan lebih dulu karena keduanya cuma menyentuh `wa_session` lewat
   * Sequelize: `updateHeartbeat()` satu UPDATE, dan `sessionWatchdog()` bahkan
   * TIDAK membaca statusnya selama penautan (lihat `core/watchdog.ts`).
   *
   * `session-command` IKUT NAIK, dan itu koreksi atas keputusan sebelumnya.
   *
   * Dulu ia sengaja ditinggal di bawah dengan dua alasan yang MASIH benar: ia
   * memanggil `getClient()` yang menuntut halaman jadi, dan ia mengosongkan
   * kolom perintah sebelum bertindak, sehingga menaikkannya begitu saja berarti
   * perintah staf ditelan diam-diam. Yang KELIRU adalah kesimpulannya --
   * "perintah yang datang selama penautan tetap tersimpan dan dijalankan begitu
   * sesi hidup" hanya benar bila sesinya AKHIRNYA hidup. Saat penautan gagal
   * berulang, loopnya tidak pernah ada, dan tombol "Sambung ulang"/"Keluar
   * sesi" berhenti dibaca tepat pada keadaan yang paling membuat orang
   * menekannya. Terukur pada gangguan 15 Agustus 2026: empat puluh menit tanpa
   * satu pun perintah dashboard terbaca.
   *
   * Kedua alasan aslinya kini ditutup DI DALAM `processSessionCommand()` lewat
   * parameter fase, bukan dihindari dengan menaruh loopnya di bawah: selama
   * `menautkan` ia tidak pernah menyentuh `getClient()`, dan perintah yang belum
   * bisa dikerjakan TIDAK dikonsumsi.
   */
  void loop('heartbeat', updateHeartbeat, 30_000);
  void loop('session-watchdog', sessionWatchdog, 60_000);
  void loop(
    'session-command',
    async () => {
      // `initSelesai` dibaca SAAT DIPANGGIL, bukan ditangkap sekali saat loopnya
      // dipasang -- kalau tidak, ia selamanya bernilai false.
      const hasil = await processSessionCommand(initSelesai ? 'siap' : 'menautkan');
      if (hasil === 'minta-restart') {
        // Lewat `shutdown()`, BUKAN `process.exit()`: keluar tanpa menutup
        // Chromium meninggalkan state sesi setengah tertulis, dan proses
        // penggantinya mewarisi kerusakannya. Pelajaran yang sama sudah dibayar
        // sessionWatchdog().
        await shutdown('perintah sesi dari dashboard', 1);
      }
    },
    5_000,
  );

  /**
   * Direktori sesi yang dititipkan `logout` untuk dihapus (054) -- dikerjakan
   * DI SINI, dan tempatnya menentukan seluruh gunanya.
   *
   * Ini satu-satunya momen yang dijamin tidak ada pemegang handle: sesudah
   * baris di bawah, Chromium meluncur dan mengunci direktori itu lagi. Karena
   * itu ia harus di atas `initWaClient()`, bukan di dekat penanganan logout --
   * di sana penghapusannya sudah dicoba sampai ~45 detik dan gagal justru
   * karena prosesnya sendiri masih hidup.
   *
   * Bendera dipadamkan berdasarkan hasilnya, bukan selalu: kalau kali ini pun
   * gagal, ia tetap menyala supaya start berikutnya mencoba lagi. Yang tidak
   * boleh terjadi adalah bendera yang padam sementara direktorinya masih ada --
   * itu mengembalikan keadaan yang justru sedang diperbaiki, diam-diam.
   */
  await kerjakanHapusSesiTertunda();


  initMulaiAt = Date.now();
  await initWaClient();
  initSelesai = true;

  const pollIntervalMs = await getSettingNumber('polling.interval_ms', 60_000);
  const scanIntervalMs = await getSettingNumber('polling.scan_interval_ms', 300_000);
  logger.info({ pollIntervalMs, scanIntervalMs }, 'memulai siklus poller');

  /**
   * Jaring pengaman ketiga, dan letaknya SESUDAH `initWaClient()` bukan di atas
   * bersama kedua watchdog sesi -- itu syarat kebenaran, bukan kerapian.
   *
   * Selama penautan, `wa_session.status` masih memuat status milik proses
   * SEBELUMNYA dan bisa saja berbunyi `ready`, sementara baris `ready` terakhir
   * di `wa_session_event` juga masih milik sesi itu. Dijalankan di sana, ia akan
   * menilai pesan-pesan yang dikirim sesi lama -- yang memang tidak akan pernah
   * berkabar, karena ack hanya tiba selama sesi pengirimnya hidup -- lalu
   * mengalarmkan keadaan yang justru paling lazim sesudah setiap restart.
   * Perangkap yang sama persis sudah dibayar `core/watchdog.ts`.
   *
   * Lima menit, bukan 60 detik: ambangnya sendiri 10 menit, jadi memeriksanya
   * lebih rapat tidak mempercepat apa pun selain jumlah query.
   */
  void loop('ack-watchdog', runAckWatchdog, scanIntervalMs);

  void loop('poller:sisip', runAllSisipCycles, pollIntervalMs);
  // ARCHITECTURE §4.7: kelas pindai (booking) di interval lebih longgar --
  // memindai penuh booking_registrasi tiap 60 detik = 1.440x/hari untuk
  // keuntungan yang tidak terasa siapa pun.
  void loop('poller:booking', runBookingCycle, scanIntervalMs);
  // Kelas ketiga (BROADCAST terjadwal/berulang, FITUR.md) -- interval sama
  // seperti kelas pindai, karena sama-sama scan tabel penuh (broadcast_schedule
  // jauh lebih kecil dari booking_registrasi, jadi ini longgar, bukan ketat).
  void loop('broadcast-schedule', runDueBroadcastSchedules, scanIntervalMs);
  // DARURAT STOK -- interval pindai, bukan interval poller. Yang dipindai tiap
  // siklus cuma `stok_alert_schedule` (beberapa baris); pemindaian katalog yang
  // mahal baru terjadi saat ada jadwal yang benar-benar jatuh tempo, dan
  // `next_run_at` dimajukan bahkan ketika pesannya tidak jadi dikirim justru
  // supaya itu tetap sekali sehari alih-alih tiap siklus.
  void loop('stok-darurat', runDueStokDarurat, scanIntervalMs);
  // Pengingat surat kontrol BPJS -- sekali sehari, tapi kejatuhtempoannya
  // diperiksa tiap siklus pindai alih-alih dipatok node-cron seperti
  // BOOK_REMIND. Bedanya menentukan: jam kirimnya dibaca ULANG tiap siklus,
  // jadi mengubahnya di dashboard berlaku hari itu juga alih-alih menunggu
  // worker dimulai ulang oleh orang yang tidak tahu ia perlu melakukannya.
  void loop('bpjs-kontrol', runBpjsKontrolIfDue, scanIntervalMs);
  /**
   * Pengingat surat kontrol NON-BPJS -- padanan siklus tepat di atasnya, dan
   * SIKLUS TERSENDIRI alih-alih menumpang di sana.
   *
   * Keduanya membaca tabel yang berbeda dan punya sakelar yang berbeda
   * (`bpjs.kontrol_enabled` versus `template.is_active`), jadi satu siklus
   * gabungan yang gagal pada paruh pertamanya akan menghentikan paruh yang
   * satunya -- kanal yang dimatikan rumah sakit bisa menjatuhkan kanal yang
   * dinyalakannya. Alasan yang sama memisahkan siklus hibah dari pengadaan.
   */
  void loop('kontrol-ulang', runKontrolUlangIfDue, scanIntervalMs);
  /**
   * Surat kontrol DITERBITKAN -- pasangan siklus tepat di atasnya, dan sekali
   * lagi siklus tersendiri.
   *
   * Yang satu jadwal harian, yang satu jendela pindai; menggabungkannya berarti
   * pemberitahuan "surat Anda sudah dibuat" ikut menunggu pukul 09:00 esok hari,
   * padahal seluruh gunanya justru datang saat pasien masih memegang kertasnya.
   *
   * ==========================================================================
   * `pollIntervalMs` (60 detik), BUKAN `scanIntervalMs` -- dan ini pengecualian
   * ==========================================================================
   *
   * Keenam siklus pindai di atas memakai interval 5 menit dengan alasan yang
   * sama: mereka membaca ULANG seluruh jendelanya tiap kali jalan, jadi interval
   * rapat berarti mengulang pekerjaan yang sama belasan kali tanpa hasil
   * tambahan. Alasan itu berlaku penuh di sini juga -- yang berbeda BIAYANYA.
   *
   * Diukur langsung, tiga kali berturut-turut pada kondisi hangat:
   *
   *   alca  (1 baris)    0,07 ms
   *   sik   (253 baris)  0,07 ms
   *
   * 1.440 kali sehari berjumlah sekitar SEPERSEPULUH DETIK waktu database.
   * Bandingkan `runBpjsKontrolIfDue`, yang biaya sekali bacanya ~35 ms dan tetap
   * dinilai layak diulang sepanjang hari. Yang membuat pemindaian penuh di sini
   * murah bukan keberuntungan melainkan bentuk tabelnya: `skdp_bpjs` bertambah
   * hanya saat poliklinik menerbitkan surat kontrol (~4/hari pada puncaknya),
   * jadi ia tetap tabel berukuran ratusan baris selama bertahun-tahun.
   *
   * Yang DIBELI dengan itu: pemberitahuan sampai dalam hitungan menit sesudah
   * petugas menekan simpan, bukan sesudah lima menit -- selaras dengan QUEUE_REG
   * yang juga 60 detik, dan itulah pengalaman yang dibandingkan orang ("kenapa
   * yang registrasi langsung masuk, yang ini tidak").
   *
   * Kalau `maxRows` pada plan check-nya suatu saat berbunyi, YANG PERTAMA
   * ditinjau adalah mengembalikan siklus ini ke `scanIntervalMs` -- bukan
   * menaikkan angkanya.
   */
  void loop('kontrol-terbit', runKontrolTerbitCycle, pollIntervalMs);
  /**
   * Surat sakit otomatis -- siklus PINDAI, dan di sini pilihan intervalnya
   * punya alasan yang tidak dipunyai keempat siklus di atas: satu surat berarti
   * satu peluncuran Chromium (~480 ms) DI DALAM proses yang juga memegang sesi
   * WhatsApp. Chromium yatim di proses inilah yang pernah menjatuhkan worker ke
   * crash loop 29 kali beruntun, jadi menjalankannya tiap 60 detik berarti
   * memperbesar peluang itu untuk keuntungan empat menit yang tidak terasa
   * pasien yang baru meninggalkan loket. Ia menjaga sakelarnya sendiri
   * (bertingkat, keduanya default MATI), jadi aman dipanggil tanpa syarat.
   */
  void loop('surat-otomatis', runSuratOtomatisCycle, scanIntervalMs);
  /**
   * Pengadaan -- siklus PINDAI, dan alasannya sama dengan booking: jendelanya
   * dibaca ULANG seluruhnya tiap kali jalan, jadi interval rapat berarti
   * mengulang pekerjaan yang sama 1.440x sehari untuk keuntungan yang tidak
   * terasa siapa pun. Diukur 2,21 faktur per hari aktif di RS ini; selisih empat
   * menit pada nota pembelian tidak berarti apa-apa bagi gudang.
   *
   * Ia menjaga sakelarnya sendiri (default MATI) dan memeriksa tujuan sebelum
   * menyentuh `sik`, jadi aman dipanggil tanpa syarat.
   */
  void loop('pengadaan', runPengadaanCycle, scanIntervalMs);
  /**
   * HIBAH -- siklus terpisah dari pengadaan, bukan digabung ke dalamnya.
   *
   * Menggabungkannya menggoda (keduanya nota barang, keduanya kelas pindai,
   * keduanya jalan pada interval yang sama), dan justru itu yang membuatnya
   * salah: sakelarnya terpisah, jadi satu siklus gabungan yang gagal pada
   * setengah pertamanya akan menghentikan setengah yang satunya -- fitur yang
   * dimatikan RS bisa menjatuhkan fitur yang dinyalakannya. `loop()` menangkap
   * galat per siklus, dan itu perlindungan yang hilang begitu dua fitur berbagi
   * satu siklus.
   *
   * Ia menjaga sakelarnya sendiri (default MATI) dan memeriksa tujuan sebelum
   * menyentuh `sik`, jadi aman dipanggil tanpa syarat.
   */
  void loop('hibah', runHibahCycle, scanIntervalMs);
  /**
   * SURAT PEMESANAN -- siklus keenam di keluarga farmasi, dan sekali lagi
   * TERPISAH, bukan digabung ke dalam siklus pengadaan.
   *
   * Menggabungkannya lebih menggoda di sini daripada pada hibah, karena keduanya
   * membaca dua ujung dari alur pengadaan yang sama. Justru itu yang membuatnya
   * salah: sakelarnya terpisah dan RS sangat mungkin menyalakan yang satu tanpa
   * yang lain, sehingga satu siklus gabungan yang gagal pada setengah pertamanya
   * akan menghentikan setengah yang satunya -- fitur yang dimatikan bisa
   * menjatuhkan fitur yang dinyalakan. `loop()` menangkap galat per siklus, dan
   * itu perlindungan yang hilang begitu dua fitur berbagi satu siklus.
   *
   * Ia menjaga sakelarnya sendiri (default MATI) dan memeriksa tujuan sebelum
   * menyentuh `sik`, jadi aman dipanggil tanpa syarat.
   */
  void loop('pemesanan', runPemesananCycle, scanIntervalMs);
  /**
   * PENJUALAN -- siklus ketujuh di keluarga farmasi, dan sekali lagi TERPISAH.
   *
   * Alasan pemisahannya sama dengan hibah dan surat pemesanan, PLUS satu yang
   * khas: ia satu-satunya siklus farmasi yang MENULIS ke database `wakhanza`
   * (buku pantau `penjualan_pantau`) sebagai bagian dari pekerjaannya. Digabung
   * ke siklus lain, galat pada paruh yang lain bisa memutus siklus ini tepat di
   * antara "pesan sudah masuk outbox" dan "notanya dicatat di buku pantau" --
   * dan celah itu persis yang membuat sebuah nota dikabarkan tapi penghapusannya
   * tidak pernah bisa terdeteksi.
   *
   * Interval PINDAI (5 menit), bukan 60 detik: jendelanya dibaca ULANG
   * seluruhnya tiap kali jalan. Selisih beberapa menit pada nota penjualan tidak
   * berarti apa-apa bagi gudang, sementara lajunya jauh lebih tinggi daripada
   * nota barang lain (16-46 nota per hari) sehingga pengulangan rapat justru
   * paling mahal di sini.
   *
   * Ia menjaga sakelarnya sendiri (default MATI) dan memeriksa tujuan sebelum
   * menyentuh `sik`, jadi aman dipanggil tanpa syarat.
   */
  void loop('penjualan', runPenjualanCycle, scanIntervalMs);
  /**
   * REKAP HARIAN PENJUALAN -- siklus TERPISAH dari `penjualan` tepat di atasnya,
   * dan pemisahan itu lebih tajam daripada keenam pemisahan farmasi sebelumnya.
   *
   * Yang di atas kelas PINDAI (jendela dibaca ulang, dipicu baris baru di `sik`);
   * yang ini kelas WAKTU (dipicu jam dinding, seperti `bpjs-kontrol` dan
   * `stok-darurat`). Dua kelas pemicu berbeda di satu siklus berarti kegagalan
   * salah satunya menjatuhkan yang lain -- dan di sini taruhannya bukan simetris:
   * `runPenjualanCycle` BERHENTI TOTAL saat jendelanya terbaca penuh, jadi satu
   * siklus gabungan akan membuat rekap harian ikut hilang karena sebab yang tidak
   * ada hubungannya dengannya.
   *
   * Sakelarnya pun berdiri sendiri (`farmasi.penjualan_rekap_enabled` BUKAN anak
   * dari `farmasi.penjualan_enabled`), justru supaya RS bisa memilih rekap saja
   * tanpa 16-46 pesan sehari. Siklus gabungan akan membuat pilihan itu mustahil.
   *
   * Interval pindai, bukan poller: yang dikerjakan tiap siklus cuma membaca satu
   * pengaturan dan membandingkan jam. Pembacaan `sik` yang sesungguhnya (2-33 ms)
   * baru terjadi pada siklus yang benar-benar jatuh tempo, dan penandanya
   * dimajukan sesudahnya supaya itu sekali sehari alih-alih tiap siklus.
   *
   * Ia menjaga sakelarnya sendiri (default MATI) dan memeriksa tujuan sebelum
   * menyentuh `sik`, jadi aman dipanggil tanpa syarat.
   */
  void loop('penjualan-rekap', runPenjualanRekapIfDue, scanIntervalMs);
  /**
   * REKAP HARIAN RESEP -- siklus TERPISAH dari `farmasi` (FARMASI_VALIDASI /
   * FARMASI_PENYERAHAN), lewat pembedaan yang sama persis dengan pasangan
   * penjualan di atas: yang itu kelas SISIP (watermark, dipicu baris yang
   * melewati kursornya), yang ini kelas WAKTU.
   *
   * Sakelarnya berdiri sendiri (`farmasi.resep_rekap_enabled` BUKAN anak dari
   * `farmasi.enabled`), dan di sini alasannya lebih berat daripada di penjualan:
   * `farmasi.enabled` menyalakan pesan yang memuat nama pasien, nomor rekam
   * medis, dan poli ke sebuah grup. Siklus gabungan akan membuat rekap berisi
   * ANGKA mustahil didapat tanpa lebih dulu mengambil keputusan privasi itu.
   *
   * Interval pindai, bukan poller: yang dikerjakan tiap siklus cuma membaca satu
   * pengaturan dan membandingkan jam. Pembacaan `sik` yang sesungguhnya baru
   * terjadi pada siklus yang benar-benar jatuh tempo, dan penandanya dimajukan
   * sesudahnya supaya itu sekali sehari alih-alih tiap siklus.
   *
   * Ia menjaga sakelarnya sendiri (default MATI) dan memeriksa tujuan sebelum
   * menyentuh `sik`, jadi aman dipanggil tanpa syarat.
   */
  void loop('resep-rekap', runResepRekapIfDue, scanIntervalMs);

  /**
   * REKAP BULANAN FARMASI (`/farmasi?tab=bulanan`, migrations/046) -- kelas WAKTU
   * seperti kedua rekap di atasnya, tapi periodenya BULAN.
   *
   * Siklus TERPISAH dari keduanya, dan bukan demi kerapian: `runResepRekapIfDue`
   * membaca `resep_obat` sehari, yang ini membaca SEPULUH agregat atas rentang
   * sebulan. Siklus gabungan yang gagal pada bagian pertamanya akan menghentikan
   * bagian yang satunya -- fitur yang dimatikan RS bisa menjatuhkan fitur yang
   * dinyalakannya. Pelajaran yang sama sudah dibayar saat siklus hibah dipisah
   * dari pengadaan (031).
   *
   * Interval PINDAI, sama seperti tetangganya: yang dikerjakan tiap siklus cuma
   * membaca tiga pengaturan dan membandingkan tanggal. Pembacaan `sik` yang
   * sesungguhnya terjadi SEKALI SEBULAN, pada siklus yang benar-benar jatuh
   * tempo.
   *
   * Ia menjaga sakelarnya sendiri (`farmasi.bulanan_enabled`, default MATI) dan
   * memeriksa tujuan sebelum menyentuh `sik`, jadi aman dipanggil tanpa syarat.
   */
  void loop('farmasi-bulanan', runFarmasiBulananIfDue, scanIntervalMs);

  /**
   * REKAP ASESMEN AWAL KEPERAWATAN (`/erm/penilaian-umum`, migrations/044) --
   * kelas WAKTU seperti kedua rekap farmasi di atas, tapi dengan satu perbedaan
   * yang tidak dipunyai satu pun siklus lain di berkas ini: ia bisa berbunyi
   * BEBERAPA KALI dalam sehari.
   *
   * Ketiga rekap lain memakai `jatuhTempoHarian()`, yang penandanya bertanggal
   * -- begitu rekap pertama menulis "hari ini", yang kedua membacanya sebagai
   * "sudah" dan tidak pernah berangkat. Yang ini memakai `slotJatuhTempo()`
   * dengan penanda bertanggal BERIKUT SLOTNYA, dan kunci idempotennya memuat
   * slot itu. Lihat `core/rekapJadwal.ts`.
   *
   * Interval pindai, dengan alasan yang sama: yang dikerjakan tiap siklus cuma
   * membaca pengaturan dan membandingkan jam. Pembacaan `sik` baru terjadi pada
   * siklus yang benar-benar jatuh tempo.
   *
   * Ia menjaga KEDUA sakelarnya sendiri (`erm.enabled` dan
   * `erm.penilaian_enabled`, keduanya default MATI) dan memeriksa tujuan sebelum
   * menyentuh `sik`, jadi aman dipanggil tanpa syarat.
   */
  void loop('erm-penilaian', runPenilaianRekapIfDue, scanIntervalMs);

  /**
   * REKAP BULANAN ADMINISTRASI (`/administrasi?tab=bulanan`, migrations/047) --
   * kembaran `farmasi-bulanan` di atas, dan seluruh matematika jadwalnya memang
   * dipakai bersama lewat `core/rekapBulan.ts`.
   *
   * Siklusnya TERPISAH, bukan digabung dengan tetangganya, dan alasannya sama
   * yang memisahkan `hibah` dari `pengadaan`: sakelarnya berdiri sendiri, jadi
   * satu siklus gabungan yang gagal pada setengah pertamanya akan menghentikan
   * setengah yang satunya -- fitur yang dimatikan RS bisa menjatuhkan fitur yang
   * dinyalakannya.
   *
   * Ia menjaga sakelarnya sendiri (`administrasi.bulanan_enabled`, default MATI)
   * dan memeriksa tujuan sebelum menyentuh `sik`, jadi aman dipanggil tanpa
   * syarat.
   */
  void loop('administrasi-bulanan', runAdministrasiBulananIfDue, scanIntervalMs);
  void dispatcherLoop();

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
  /**
   * SAAT worker sedang berhenti, kegagalan `main()` adalah AKIBAT penutupan itu
   * sendiri -- bukan sebab tersendiri, dan bukan alasan untuk memilih kode
   * keluar.
   *
   * `shutdown()` memanggil `getClient().destroy()`, yang menutup Chromium DI
   * BAWAH `initWaClient()` yang mungkin masih ditunggu `main()`. Yang menyusul
   * adalah `Protocol error (Runtime.callFunctionOn): Target closed`, ditangkap
   * di sini, lalu `process.exit(1)` -- MENIMPA kode keluar yang sudah dipilih
   * `shutdown()`.
   *
   * Akibatnya fatal dan tidak kelihatan: kode 75 (KODE_KELUAR_DIGANTIKAN) ada di
   * `stop_exit_codes` PM2 supaya instance yang diminta mundur TIDAK dinyalakan
   * ulang; kode 1 tidak. Jadi tiap pemegang yang mundur justru dilahirkan
   * kembali, mengusir penggantinya, lalu mundur lagi -- loop yang tidak pernah
   * konvergen. Terlihat langsung pada 2026-08-09: instance baru tiap ~7,5 detik,
   * masing-masing menuliskan "berhenti..." (exitCode 75) yang diikuti "worker
   * gagal memulai" pada pid yang sama tujuh milidetik kemudian.
   *
   * Ini BUKAN bug yang sama dengan yang sudah tercatat di singleInstance.ts.
   * Yang di sana tentang exit 0 yang memberi makan `autorestart`; perbaikannya
   * (kode keluar 75 + `stop_exit_codes`) benar dan tetap berlaku -- ia cuma
   * tidak pernah sempat dipakai, karena kode keluarnya ditimpa di sini sebelum
   * PM2 sempat melihatnya.
   */
  if (sedangBerhenti) {
    logger.warn(safeError(err), 'main() gagal karena worker sedang berhenti -- kode keluar shutdown() dipertahankan');
    return;
  }
  logger.fatal(safeError(err), 'worker gagal memulai');
  process.exit(1);
});
