import * as cron from 'node-cron';
import { Op, QueryTypes } from 'sequelize';
import {
  Outbox,
  SendLog,
  PatientContact,
  AutoReplyLog,
  InboundMessage,
  WaSessionEvent,
  PenjualanPantau,
  getSettingNumber,
} from '@/models';
import { sik } from '@/db/sik';
import { TERMINAL_OUTBOX_STATUSES } from '@/core/outboxStatus';
import { normalizePhone } from '@/core/phone';
import { logger, safeError } from '@/lib/logger';
import { daftarBerkasMedia, hapusBerkasLampiran } from '@/lib/mediaStorage';
import { pangkasSesiPerintah } from './commandReply';

const RETENTION_DAYS = 90;

/**
 * ARCHITECTURE §11. audit_log SENGAJA tidak disentuh di sini -- pengecualian
 * itu sudah ditegakkan hak akses MariaDB (§9.5), bukan cuma kode ini yang
 * "lupa" menghapusnya.
 */
async function cleanupOldRecords(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  /**
   * Dipangkas menurut `created_at` untuk SELURUH status terminal, bukan menurut
   * `sent_at` untuk `sent` saja.
   *
   * Bentuk lamanya (`status='sent' AND sent_at < cutoff`) meninggalkan setiap
   * baris yang tidak pernah berhasil terkirim -- `skipped_no_contact`,
   * `skipped_opt_out`, `failed`, `failed_permanent`, `expired` -- di tabel
   * selamanya, karena `sent_at` memang NULL pada semuanya. Justru baris itulah
   * yang paling banyak: satu broadcast ke 500 pasien di RS yang ~40% nomornya
   * tidak terpakai meninggalkan ~200 baris abadi sekali kirim.
   *
   * Akibat lanjutannya lebih halus dan itu yang membuatnya perlu diperbaiki
   * sekaligus: baris `skipped_*` ikut menyimpan `media_path`, sedangkan
   * `cleanupOrphanMedia()` di bawah hanya menghapus berkas yang sudah tidak
   * ditunjuk baris mana pun. Selama baris abadi itu ada, berkas lampirannya
   * tidak pernah bisa dihapus dari disk.
   *
   * `pending`/`sending` sengaja tidak ikut: keduanya masih dipegang dispatcher.
   */
  const deletedOutbox = await Outbox.destroy({
    where: { status: { [Op.in]: [...TERMINAL_OUTBOX_STATUSES] }, createdAt: { [Op.lt]: cutoff } },
  });
  const deletedLogs = await SendLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
  // auto_reply_log tumbuh seiring pesan MASUK -- laju yang tidak dikendalikan
  // rumah sakit sama sekali, beda dari tabel lain di sini. Ikut dipangkas
  // dengan masa simpan yang sama.
  const deletedAutoReply = await AutoReplyLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
  // wa_session_event (migrations/037): masa simpan yang sama sudah mencakup
  // satu kuartal penuh -- cukup untuk membandingkan uptime sebelum/sesudah
  // sebuah perbaikan, yaitu tujuan tabel ini ada.
  const deletedSessionEvents = await WaSessionEvent.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });

  /**
   * `inbound_message` punya masa simpannya SENDIRI, dan sengaja lebih pendek
   * (default 30 hari, `inbox.simpan_hari`).
   *
   * Isinya kalimat yang diketik pasien -- bisa memuat keluhan medis, dan tabel
   * ini bukan rekam medis. Yang dibutuhkan untuk pekerjaan sehari-hari ("siapa
   * yang mengirim kemarin, apa id grupnya") jauh lebih pendek umurnya daripada
   * bukti pengiriman di `outbox`, sementara isinya jauh lebih sensitif. Memakai
   * 90 hari yang sama berarti menyimpan yang paling sensitif paling lama tanpa
   * ada yang memutuskan begitu.
   */
  const hariInbox = await getSettingNumber('inbox.simpan_hari', 30);
  const cutoffInbox = new Date(Date.now() - hariInbox * 24 * 60 * 60 * 1000);
  const deletedInbound = await InboundMessage.destroy({ where: { createdAt: { [Op.lt]: cutoffInbox } } });


  /**
   * Buku pantau penjualan (migrations/040) dipangkas menurut UMUR NOTANYA, bukan
   * `dikabarkan_at`.
   *
   * Sebuah baris berhenti berguna begitu nomornya jatuh di luar jendela pindai --
   * sejak saat itu `bandingkanPantau()` tidak pernah melihatnya lagi, jadi ia
   * tidak bisa menghasilkan kabar apa pun. Yang menentukan itu tanggal di dalam
   * NOMORNYA, dan bukan kapan kami mengabarkannya.
   *
   * Ambangnya sengaja jauh lebih longgar daripada jendelanya (90 hari berbanding
   * 7): memangkas terlalu rapat berarti nota yang dihapus tepat setelah barisnya
   * dibuang akan terlihat sebagai nota yang tidak pernah ada, dan biaya menyimpan
   * satu baris berisi satu nomor selama tiga bulan praktis nol (~33 baris sehari).
   */
  const cutoffNota = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const prefixNota = `PJ${cutoffNota.getFullYear()}${String(cutoffNota.getMonth() + 1).padStart(2, '0')}${String(
    cutoffNota.getDate(),
  ).padStart(2, '0')}000`;
  const deletedPantau = await PenjualanPantau.destroy({ where: { notaJual: { [Op.lt]: prefixNota } } });

  /**
   * Sesi wizard perintah (migrations/045) dipangkas jauh lebih rapat: SEHARI,
   * bukan 90 hari.
   *
   * Ia bukan riwayat melainkan keadaan sesaat, dan umur berlakunya sudah
   * ditegakkan di tempat lain (`autoreply.wa_sesi_timeout_menit`, bawaan 10
   * menit) -- baris yang lebih tua dari itu sudah pasti diabaikan `bacaSesi()`.
   * Yang dikerjakan di sini cuma membuang bangkainya supaya tabelnya tidak
   * tumbuh satu baris per percakapan yang pernah ditinggalkan di tengah.
   *
   * Sehari, bukan sepuluh menit, semata-mata supaya baris yang masih dipegang
   * percakapan berjalan mustahil ikut terbawa kalau batas waktunya kelak
   * dinaikkan staf.
   */
  const deletedSesiPerintah = await pangkasSesiPerintah(new Date(Date.now() - 24 * 60 * 60 * 1000));

  logger.info(
    {
      deletedOutbox,
      deletedLogs,
      deletedAutoReply,
      deletedInbound,
      deletedSessionEvents,
      deletedPantau,
      deletedSesiPerintah,
      hariInbox,
    },
    'pembersihan berkala: outbox, send_log, auto_reply_log, inbound_message, wa_session_event, penjualan_pantau & wa_command_session lama dihapus',
  );

  await cleanupOrphanMedia();
}

/**
 * Berkas lampiran broadcast yang barisnya sudah ikut terpangkas di atas.
 *
 * Satu berkas ditunjuk oleh SELURUH baris outbox satu kampanye, jadi ia hanya
 * boleh dihapus setelah tidak ada satu pun baris yang menunjuknya lagi --
 * menghapus per baris akan membuat kiriman ke pasien ke-2 sampai ke-500 gagal
 * karena berkasnya sudah lenyap saat gilirannya tiba.
 *
 * `broadcast_campaign` sengaja TIDAK ikut diperiksa: ia insert-only dan tidak
 * pernah dipangkas, jadi memakainya sebagai acuan berarti tidak ada berkas yang
 * pernah bisa dihapus. Catatan nama berkas di sana tetap utuh sebagai jejak
 * akuntabilitas walau berkasnya sudah tidak ada.
 */
async function cleanupOrphanMedia(): Promise<void> {
  // Ambang usia melindungi berkas yang BARU diunggah tapi baris outbox-nya
  // belum sempat ditulis (jeda beberapa detik saat broadcast besar).
  const kandidat = await daftarBerkasMedia(24 * 60 * 60 * 1000);
  if (kandidat.length === 0) return;

  let dihapus = 0;
  for (const nama of kandidat) {
    const masihDipakai = await Outbox.count({ where: { mediaPath: nama } });
    if (masihDipakai > 0) continue;
    await hapusBerkasLampiran(nama);
    dihapus++;
  }
  if (dihapus > 0) logger.info({ dihapus }, 'pembersihan berkala: berkas lampiran tanpa pemilik dihapus');
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
