import net from 'node:net';
import { logger, safeError } from '@/lib/logger';
import { sendAlert } from './alert';

/**
 * Kunci instance-tunggal untuk worker, berikut serah-terima kepemilikan sesi.
 *
 * MASALAH YANG DIPECAHKAN, terukur dari log (47 kali start, `shutdown()` hanya
 * 5 kali, 16 kali "browser is already running"):
 *
 * `pm2 restart wakhanza-worker` menutup proses lama dengan rapi -- jalur IPC
 * `shutdown` memang bekerja, kelima kalinya berhasil menutup Chromium. Tapi
 * keluarnya proses lama itu SENDIRI dihitung PM2 sebagai exit yang perlu
 * `autorestart`, DI ATAS restart yang sedang ia jalankan. Hasilnya dua
 * peluncuran untuk satu perintah restart:
 *
 *   06:34:43  proses lama shutdown rapi (exit 0)
 *   06:34:45  PM2 meluncurkan pengganti #1  -> berhasil, memegang Chromium
 *   06:34:50  PM2 meluncurkan pengganti #2  -> kalah, "browser is already running"
 *
 * Pengganti #2 mati dengan exit 1, memicu autorestart lagi, kalah lagi --
 * berputar tiap 5 detik tanpa akhir. Dan karena PM2 selalu menganggap proses
 * TERBARU sebagai miliknya, pengganti #1 yang justru bekerja menjadi tidak
 * terlihat: `pm2 stop` tidak menyentuhnya, `pm2 list` menampilkan pid lain, dan
 * worker terus mengirim WhatsApp di luar kendali. Terbukti langsung: sesudah
 * `pm2 stop`, prosesnya masih hidup dan `wa_session.heartbeat_at` masih
 * diperbarui.
 *
 * KENAPA TIDAK CUKUP SEKADAR MENUNGGU. Instance yang kalah lalu menunggu memang
 * memutus loop-nya -- PM2 melihat satu proses hidup dan berhenti meluncurkan
 * pengganti. Tapi ujungnya salah: yang DILACAK PM2 adalah si penunggu,
 * sementara yang memegang sesi tetap yatim. `pm2 restart` berikutnya hanya
 * mengganti penunggunya, jadi kode baru TIDAK PERNAH benar-benar dijalankan --
 * kegagalan yang lebih senyap daripada loop yang berisik.
 *
 * KARENA ITU: yang kalah MEMINTA pemegangnya mundur. Pemegang menutup sesi
 * dengan rapi (jalur `shutdown()` yang sama, yang terbukti bersih 5 dari 5
 * kali), lalu yang kalah mengambil alih. Ujungnya benar: proses yang dilacak
 * PM2 adalah proses yang memegang sesi.
 *
 * KENAPA PORT, BUKAN BERKAS KUNCI: port yang di-bind dilepas SISTEM OPERASI
 * saat proses mati, termasuk saat SIGKILL dan listrik padam. Berkas kunci
 * berisi pid meninggalkan kunci basi sesudah kematian mendadak -- dan kematian
 * mendadak justru mode kegagalan paling sering di sini (lihat `kill_timeout` di
 * ecosystem.config.js). Soket ini juga sekalian menjadi jalur permintaan mundur
 * itu.
 *
 * Ini BUKAN pelanggaran "kedua proses tidak pernah berkomunikasi lewat HTTP":
 * aturan itu tentang koordinasi APLIKASI (antrean pesan, status sesi), yang
 * tetap sepenuhnya lewat tabel. Yang lewat sini cuma satu kata kendali daur
 * hidup proses, antara dua instance worker yang sama, di loopback.
 */

/**
 * Kode keluar khusus untuk instance yang MUNDUR karena digantikan.
 *
 * KENAPA PERLU KODE TERSENDIRI -- ini menutup lubang yang membuat seluruh
 * mekanisme di berkas ini justru berbalik jadi sumber masalahnya sendiri.
 *
 * Serah-terima di bawah memindahkan sesi dengan benar, tapi mundurnya pemegang
 * ITU SENDIRI adalah sebuah exit, dan `autorestart` PM2 meluncurkan pengganti
 * untuk setiap exit. Pengganti itu lalu mengusir pemegang berikutnya, yang
 * mundur, yang memicu pengganti lagi. Sekali dua proses berdampingan,
 * populasinya tidak pernah turun -- terukur 3 Agustus 2026: 115 restart dalam
 * 15 menit, satu peralihan tiap 5-7 detik, sampai `pm2 delete`.
 *
 * `MAKS_PERMINTAAN_MUNDUR` di bawah tidak menolong dan tidak akan pernah:
 * ia membatasi berapa kali SATU proses meminta, sedangkan yang terjadi adalah
 * aliran proses BARU yang masing-masing meminta sekali. Seluruh 108 baris
 * perebutan di log bertanda `permintaanKe: 1` -- tidak pernah 2.
 *
 * Karena itu keluarnya harus bisa dibedakan PM2 dari exit lain, lewat
 * `stop_exit_codes` di ecosystem.config.js. Exit 0 (shutdown biasa) dan exit 1
 * (watchdog, pemeriksaan kesehatan) tetap memicu restart seperti sebelumnya --
 * hanya kode ini yang tidak.
 *
 * HARGA YANG DIBAYAR, sadar-sadar: proses yang diusir tidak bisa tahu SIAPA
 * yang mengusirnya. Worker manual yang dijalankan orang di luar PM2 kini
 * MENANG -- PM2 tidak lagi merebut sesinya kembali seperti yang dijelaskan di
 * RUNBOOK. Ditukar dengan sengaja: mengalahnya terlihat jelas (`pm2 list`
 * menampilkan worker `stopped`), sementara churn-nya tidak terlihat sama
 * sekali dan merusak state sesi tiap putaran.
 */
export const KODE_KELUAR_DIGANTIKAN = 75;

const PORT = Number(process.env.WORKER_LOCK_PORT ?? '3101');
const HOST = '127.0.0.1';

/** Satu-satunya pesan yang dikenali. Apa pun selain ini diabaikan. */
const PESAN_MUNDUR = 'MUNDUR';

/** Jeda antar percobaan bind. */
const JEDA_COBA_MS = 3_000;

/**
 * Permintaan mundur dikirim paling banyak sekian kali, lalu instance ini
 * berhenti meminta dan sekadar menunggu.
 *
 * Batas ini yang mencegah dua instance saling menyuruh mundur tanpa henti bila
 * suatu saat ada tiga proses sekaligus. Serah-terima yang sehat selesai jauh di
 * bawah angka ini -- menutup Chromium hitungan detik, bukan menit.
 */
const MAKS_PERMINTAAN_MUNDUR = 3;

/**
 * Setelah selama ini masih ada pemegang lain, kirim peringatan SEKALI.
 *
 * Pemegang yang tidak mundur walau sudah diminta berarti ia menggantung -- dan
 * itu keadaan yang dulu sama sekali tidak terlihat. Lima menit cukup lama untuk
 * melewati serah-terima normal, cukup singkat untuk masih berguna.
 */
const AMBANG_PERINGATAN_MS = 5 * 60_000;

let pemegang: net.Server | null = null;

function buatPemegang(onMundur: () => void): net.Server {
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buf = '';
    socket.on('data', (chunk: string) => {
      buf += chunk;
      if (!buf.includes(PESAN_MUNDUR)) return;
      logger.warn('instance worker lain meminta mengambil alih sesi -- menutup diri dengan rapi');
      socket.end();
      onMundur();
    });
    // Koneksi yang diam tidak boleh menumpuk.
    socket.setTimeout(5_000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
  });
  return server;
}

function cobaBind(onMundur: () => void): Promise<net.Server | null> {
  return new Promise((resolve, reject) => {
    const server = buatPemegang(onMundur);
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(null); // ada pemegang lain -- bukan galat, ini jawabannya
        return;
      }
      reject(err);
    });
    server.once('listening', () => resolve(server));
    // `unref()` TIDAK dipakai: soket ini justru harus ikut menahan proses
    // sebagai penanda "instance ini hidup".
    server.listen(PORT, HOST);
  });
}

/** Meminta pemegang saat ini mundur. Diam-diam gagal -- pemanggilnya toh akan mencoba bind lagi. */
function mintaMundur(): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: PORT, host: HOST });
    const selesai = () => {
      socket.destroy();
      resolve();
    };
    socket.setTimeout(3_000, selesai);
    socket.on('error', selesai);
    socket.on('connect', () => {
      socket.write(PESAN_MUNDUR, () => selesai());
    });
  });
}

/**
 * Menahan sampai instance ini menjadi satu-satunya worker.
 *
 * Dipanggil PALING AWAL di `main()` -- sebelum koneksi database, sebelum
 * Chromium. Pemeriksaan yang datang belakangan tidak ada gunanya: yang
 * diperebutkan adalah direktori sesi, dan yang kalah harus tahu sebelum
 * menyentuhnya sama sekali.
 *
 * @param onMundur dipanggil bila NANTI ada instance lebih baru yang meminta
 *                 instance ini mundur. Wajib menutup sesi dengan rapi
 *                 (`shutdown()`), bukan `process.exit()` langsung.
 */
export async function acquireWorkerLock(onMundur: () => void): Promise<void> {
  const mulai = Date.now();
  let permintaanMundur = 0;
  let sudahMengalarmkan = false;

  for (;;) {
    const server = await cobaBind(onMundur);
    if (server) {
      pemegang = server;
      const menungguMs = Date.now() - mulai;
      if (menungguMs > JEDA_COBA_MS) {
        logger.info({ menungguDetik: Math.round(menungguMs / 1000) }, 'kunci worker didapat, sesi diambil alih');
      }
      return;
    }

    if (permintaanMundur < MAKS_PERMINTAAN_MUNDUR) {
      permintaanMundur++;
      logger.warn(
        { port: PORT, permintaanKe: permintaanMundur },
        'worker lain masih memegang sesi -- meminta ia mundur supaya proses yang dikelola PM2 yang memegangnya',
      );
      await mintaMundur();
    }

    if (!sudahMengalarmkan && Date.now() - mulai >= AMBANG_PERINGATAN_MS) {
      sudahMengalarmkan = true;
      await sendAlert({
        kind: 'duplicate_worker',
        message: `Worker lain memegang sesi WhatsApp lebih dari ${Math.round(AMBANG_PERINGATAN_MS / 60_000)} menit dan tidak mundur walau diminta.`,
        detail:
          'Pengiriman kemungkinan masih jalan lewat proses lama, tapi `pm2 restart`/`pm2 stop` tidak mengendalikannya. Cocokkan pid di `pm2 list` dengan proses node yang benar-benar hidup.',
      });
    }

    await new Promise((r) => setTimeout(r, JEDA_COBA_MS));
  }
}

/**
 * Melepas kunci. Dipanggil di `shutdown()` SESUDAH sesi ditutup.
 *
 * Urutannya penting: pengganti yang sedang menunggu tidak boleh menyentuh
 * direktori sesi sebelum Chromium di sini benar-benar selesai menulis. Sistem
 * operasi juga melepasnya sendiri saat proses mati, jadi ini mempercepat
 * peralihan -- bukan syarat kebenaran.
 */
export async function releaseWorkerLock(): Promise<void> {
  if (!pemegang) return;
  const server = pemegang;
  pemegang = null;
  try {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Tidak menunggu selamanya: penutupan soket tidak boleh menahan shutdown
      // yang justru sedang berpacu dengan `kill_timeout`.
      setTimeout(resolve, 1_000);
    });
  } catch (err) {
    logger.warn(safeError(err), 'kunci worker gagal dilepas rapi');
  }
}
