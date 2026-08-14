import os from 'node:os';
import { getSetting, getSettingNumber } from '@/models';
import { logger, safeError } from '@/lib/logger';
import { jelaskanKegagalanWebhook, jelaskanKegagalanJaringan } from '@/core/alertError';

/**
 * Peringatan ke LUAR dashboard.
 *
 * Alasannya satu kejadian nyata: sesi WhatsApp tersangkut jam 01:25 dan baru
 * ketahuan 14 jam kemudian. `SystemStatus` di /ringkasan memang menampilkan
 * panel peringatan, tapi itu mengandalkan ada orang yang membuka halamannya --
 * dan pada jam segitu tidak ada. `sessionWatchdog()` sekarang memulihkan sendiri
 * dengan restart, tapi kalau pemulihannya pun gagal berulang, tidak ada satu
 * pun jalur yang memberi tahu siapa-siapa.
 *
 * **Tidak bisa lewat WhatsApp**, dan itu bukan detail kecil: hampir semua yang
 * layak dialarmkan di sistem ini adalah "WhatsApp tidak jalan". Jalur pemberi
 * tahu harus jalur yang tidak ikut mati bersama yang diberitakannya.
 *
 * Bentuknya webhook HTTP generik, bukan SMTP: nol dependensi baru (fetch sudah
 * bawaan Node), dan satu URL yang sama bisa diarahkan ke bot Telegram, webhook
 * Slack/Discord, atau endpoint apa pun milik IT rumah sakit. Menambah klien
 * SMTP berarti menambah paket yang harus dipasang dan dirawat di server RS --
 * bertentangan dengan "sesedikit mungkin komponen yang bisa rusak"
 * (TECH_STACK.md).
 *
 * **Default kosong = tidak ada peringatan yang dikirim**, konsisten dengan
 * sakelar lain di proyek ini: fitur yang menghubungi dunia luar dinyalakan
 * sadar-sadar, bukan menyala karena terpasang.
 */

export type AlertKind =
  | 'session_stuck'
  /**
   * TERPISAH dari `session_stuck`, dan pemisahannya menentukan TINDAKAN.
   *
   * `session_stuck` berarti sesi sudah tertaut lalu tersangkut; restart hampir
   * selalu memulihkannya sendiri, jadi peringatannya bersifat "kalau berulang".
   * Yang ini berarti penautannya sendiri tidak pernah selesai -- terukur pada
   * gangguan 14 Agustus 2026, keadaan itu TIDAK pulih lewat restart berapa kali
   * pun, dan baru berhenti sesudah direktori sesi dikosongkan lalu QR dipindai
   * ulang. Itu menuntut akses fisik ke ponsel nomor RS, jadi orangnya harus
   * diberi tahu pada kejadian pertama, bukan sesudah pola terlihat.
   */
  | 'session_init_stuck'
  | 'health_check_failed'
  | 'startup_failed'
  /** Dua worker hidup sekaligus -- satu di antaranya lepas dari kendali PM2. */
  | 'duplicate_worker'
  /**
   * BUKAN dikirim dari sini -- `scripts/backup.ps1` mem-POST langsung ke
   * `alert.webhook_url` dengan bentuk payload yang SAMA PERSIS (lihat
   * `Send-BackupAlert` di sana), karena skrip cadangan PowerShell tidak
   * mengimpor kode Node/TS aplikasi ini. Tetap didaftarkan di sini supaya
   * daftar jenis peringatan yang bisa tiba di webhook tetap lengkap satu
   * tempat, bukan sebagian bersembunyi di berkas lain.
   */
  | 'backup_size_anomaly'
  | 'test';

/**
 * Isi peringatan SENGAJA cuma keadaan sistem -- tidak pernah nomor pasien,
 * nama, atau isi pesan. Webhook mengirim ke pihak ketiga (bot Telegram, server
 * chat) yang berada di luar kendali RS, jadi aturan §9.7 soal isi log berlaku
 * lebih ketat lagi di sini.
 */
export interface AlertPayload {
  kind: AlertKind;
  message: string;
  detail?: string;
}

/**
 * Jeda minimum per JENIS peringatan.
 *
 * Watchdog menyala tiap 15 menit selama sesi belum pulih; tanpa jeda, satu
 * gangguan semalaman menjadi ratusan pesan dan penerimanya berhenti membacanya
 * -- persis alasan `isKnownNonIndividualAddress()` ada di wa-client.ts.
 * Disimpan di memori, bukan database: satu proses worker, dan peringatan yang
 * hilang saat restart justru YANG BENAR (restart itu sendiri kejadian baru).
 */
const JEDA_DEFAULT_MENIT = 15;
const terakhirDikirim = new Map<AlertKind, number>();

/** Batas waktu keras. Endpoint yang menggantung tidak boleh ikut menahan worker. */
const BATAS_WAKTU_MS = 10_000;

export async function alertWebhookUrl(): Promise<string | null> {
  const url = (await getSetting('alert.webhook_url')) ?? process.env.ALERT_WEBHOOK_URL ?? '';
  const bersih = url.trim();
  if (!bersih) return null;
  if (!/^https?:\/\//i.test(bersih)) {
    logger.warn('alert.webhook_url diisi tapi bukan URL http/https -- diabaikan');
    return null;
  }
  return bersih;
}

/**
 * `alasan` HANYA diisi saat gagal, dan ia untuk MATA MANUSIA -- tombol uji di
 * `/pengaturan`. Ketiga pemanggil di worker (watchdog, pemeriksaan kesehatan,
 * kegagalan startup) mengabaikan nilai balik ini seluruhnya: pada jam 01:25
 * tidak ada yang membaca apa pun, dan itu justru alasan jalur peringatan ini
 * ada. Mereka tetap mendapatkannya lewat `logger.warn` seperti sebelumnya.
 */
export interface HasilKirimPeringatan {
  terkirim: boolean;
  alasan?: string;
}

/**
 * TIDAK PERNAH melempar. Peringatan yang gagal terkirim tidak boleh menjatuhkan
 * proses yang sedang berusaha melaporkan masalahnya sendiri -- itu akan menukar
 * satu gangguan dengan dua.
 *
 * Nilai baliknya sengaja diperlebar dari `boolean` alih-alih menambah fungsi
 * kedua yang mengembalikan alasan: dua jalur kirim akan menyimpang, dan yang
 * menyimpang di sini berarti tombol uji membuktikan jalur yang BUKAN dipakai
 * worker saat gangguan sungguhan datang -- persis yang sudah dihindari dengan
 * menguji nilai TERSIMPAN, bukan isi kotak yang sedang diketik.
 */
export async function sendAlert(payload: AlertPayload): Promise<HasilKirimPeringatan> {
  try {
    const url = await alertWebhookUrl();
    if (!url) return { terkirim: false, alasan: 'URL webhook belum diisi atau bukan URL http/https.' };

    const jedaMenit = await getSettingNumber('alert.min_interval_minutes', JEDA_DEFAULT_MENIT);
    const sebelumnya = terakhirDikirim.get(payload.kind);
    if (payload.kind !== 'test' && sebelumnya && Date.now() - sebelumnya < jedaMenit * 60_000) {
      logger.debug({ kind: payload.kind }, 'peringatan ditahan (masih dalam jeda)');
      return { terkirim: false, alasan: `Ditahan jeda antar peringatan sejenis (${jedaMenit} menit).` };
    }

    const body = JSON.stringify({
      // `text` diletakkan di depan dan diberi nama itu supaya payload yang sama
      // langsung terpakai apa adanya oleh Slack/Discord/Telegram tanpa adaptor.
      //
      // TELEGRAM, diukur langsung terhadap api.telegram.org (bukan dibaca dari
      // dokumentasi): `sendMessage` MEWAJIBKAN `chat_id`, yang tidak ada di
      // payload ini dan sengaja tidak ditambahkan -- ia bagian dari TUJUAN,
      // bukan bagian dari isi peringatan. Tempatnya di URL:
      //   https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>
      // Telegram membaca parameter dari query string WALAU body-nya JSON
      // (dibuktikan: chat_id palsu di query -> "chat not found", sedangkan
      // tanpanya -> "chat_id is empty"; dua galat yang berbeda), dan field
      // asing kita (`kind`, `host`, `at`, ...) diabaikannya tanpa menolak.
      // Karena itu bentuk generik ini tetap utuh: nol cabang per-tujuan.
      text: `[wakhanza/${os.hostname()}] ${payload.message}${payload.detail ? `\n${payload.detail}` : ''}`,
      kind: payload.kind,
      message: payload.message,
      detail: payload.detail ?? null,
      host: os.hostname(),
      at: new Date().toISOString(),
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(BATAS_WAKTU_MS),
    });

    if (!res.ok) {
      // Badan jawaban dibaca HANYA saat gagal, dan kegagalan membacanya tidak
      // boleh menutupi status yang sudah di tangan -- itu menukar keterangan
      // lengkap dengan tidak ada keterangan sama sekali.
      let jawaban = '';
      try {
        jawaban = await res.text();
      } catch {
        jawaban = '';
      }
      const alasan = jelaskanKegagalanWebhook(res.status, jawaban);
      logger.warn({ kind: payload.kind, status: res.status, alasan }, 'webhook peringatan menolak');
      return { terkirim: false, alasan };
    }

    terakhirDikirim.set(payload.kind, Date.now());
    logger.info({ kind: payload.kind }, 'peringatan terkirim ke webhook');
    return { terkirim: true };
  } catch (err) {
    const { message } = safeError(err);
    logger.warn({ kind: payload.kind, ...safeError(err) }, 'peringatan gagal dikirim');
    return { terkirim: false, alasan: jelaskanKegagalanJaringan(message) };
  }
}
