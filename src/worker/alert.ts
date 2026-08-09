import os from 'node:os';
import { getSetting, getSettingNumber } from '@/models';
import { logger, safeError } from '@/lib/logger';

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
 * TIDAK PERNAH melempar. Peringatan yang gagal terkirim tidak boleh menjatuhkan
 * proses yang sedang berusaha melaporkan masalahnya sendiri -- itu akan menukar
 * satu gangguan dengan dua.
 *
 * @returns true bila benar-benar terkirim.
 */
export async function sendAlert(payload: AlertPayload): Promise<boolean> {
  try {
    const url = await alertWebhookUrl();
    if (!url) return false;

    const jedaMenit = await getSettingNumber('alert.min_interval_minutes', JEDA_DEFAULT_MENIT);
    const sebelumnya = terakhirDikirim.get(payload.kind);
    if (payload.kind !== 'test' && sebelumnya && Date.now() - sebelumnya < jedaMenit * 60_000) {
      logger.debug({ kind: payload.kind }, 'peringatan ditahan (masih dalam jeda)');
      return false;
    }

    const body = JSON.stringify({
      // `text` diletakkan di depan dan diberi nama itu supaya payload yang sama
      // langsung terpakai apa adanya oleh Slack/Discord/Telegram tanpa adaptor.
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
      logger.warn({ kind: payload.kind, status: res.status }, 'webhook peringatan menolak');
      return false;
    }

    terakhirDikirim.set(payload.kind, Date.now());
    logger.info({ kind: payload.kind }, 'peringatan terkirim ke webhook');
    return true;
  } catch (err) {
    logger.warn({ kind: payload.kind, ...safeError(err) }, 'peringatan gagal dikirim');
    return false;
  }
}
