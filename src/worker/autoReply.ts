import { Op } from 'sequelize';
import {
  AutoReplyRule,
  AutoReplyLog,
  Outbox,
  parseKeywords,
  getSetting,
  getSettingBool,
  getSettingNumber,
  getSettingJson,
  type AutoReplyOutcome,
} from '@/models';
import { matchRule, detectPoli, normalizeInbound, type MatchableRule } from '@/core/autoReply';
import { extractVariables } from '@/core/template';
import { buildIdempotencyKey } from '@/core/idempotency';
import {
  fetchJadwalDokter,
  fetchPoliWithJadwal,
  fetchPoliAktif,
  formatJadwal,
  formatDaftarPoli,
  hariKerjaOf,
} from '@/khanza/jadwalDokter';
import { loadAutoReplyContext, identityVars, enqueueMessage } from './pipeline';
import { logger, safeError, maskPhone } from '@/lib/logger';

/**
 * BALASAN OTOMATIS -- kelas pemicu keempat, dan satu-satunya yang berjalan ke
 * arah berlawanan dari semua yang lain.
 *
 * Tiga kelas sebelumnya berangkat dari sesuatu yang TERJADI di rumah sakit
 * (sisip/pindai dari sik) atau dari staf yang menekan tombol (broadcast). Yang
 * ini berangkat dari PASIEN yang mengirim pesan. Konsekuensinya: lajunya sama
 * sekali tidak dikendalikan rumah sakit, dan itu yang membentuk hampir seluruh
 * isi berkas ini (kuota per nomor, jeda pesan cadangan, kunci idempoten per
 * pesan WhatsApp).
 *
 * Yang TIDAK dikerjakan di sini, dan itu disengaja: pengiriman. Fungsi ini
 * berhenti setelah baris outbox tertulis, persis seperti poller lain --
 * dispatcher yang mengirim, dengan jeda acak, kuota per jam, dan pencatatan
 * send_log yang sama. Membalas langsung lewat message.reply() akan melewati
 * semua itu sekaligus membuat halaman Log berbohong.
 */

export interface InboundMessage {
  /** id pesan dari whatsapp-web.js -- dasar kunci idempoten. */
  waMessageId: string;
  phoneE164: string;
  text: string;
}

export interface AutoReplyResult {
  outcome: AutoReplyOutcome | 'disabled';
  ruleId?: number;
  ruleLabel?: string;
}

/** Variabel jadwal hanya dibaca dari sik bila templatenya memang menyebutnya. */
const JADWAL_VARS = ['jadwal_dokter', 'jadwal_hari_ini', 'daftar_poli'];

/**
 * Menyusun nilai {jadwal_dokter}/{jadwal_hari_ini}/{daftar_poli}.
 *
 * `inbound` ikut masuk supaya "jadwal dokter jantung" bisa dijawab dengan
 * jadwal poli jantung saja alih-alih seluruh daftar. Kalau poli yang dimaksud
 * tidak jelas, detectPoli mengembalikan null dan yang dikirim adalah seluruh
 * jadwal -- jawaban yang lebih panjang tapi tidak pernah salah.
 */
async function buildJadwalVars(
  body: string,
  inbound: string,
  kontakRs: string,
): Promise<Partial<Record<'jadwal_dokter' | 'jadwal_hari_ini' | 'daftar_poli', string>>> {
  const used = new Set(extractVariables(body));
  if (!JADWAL_VARS.some((v) => used.has(v))) return {};

  const maxRows = await getSettingNumber('autoreply.schedule_max_rows', 60);
  const sensitivePoli = await getSettingJson<string[]>('privacy.sensitive_poli_codes', []);
  const vars: Partial<Record<'jadwal_dokter' | 'jadwal_hari_ini' | 'daftar_poli', string>> = {};

  if (used.has('jadwal_dokter') || used.has('jadwal_hari_ini')) {
    const poliOptions = await fetchPoliWithJadwal();
    const poli = detectPoli(inbound, poliOptions);

    // maxRows + 1 dibaca supaya "ada yang terpotong" bisa dibedakan dari
    // "kebetulan pas". Tanpa itu, jadwal yang jumlahnya persis maxRows akan
    // ikut diberi catatan pemotongan yang keliru.
    const query = { limit: maxRows + 1, kdPoli: poli?.kdPoli ?? null, excludeKdPoli: sensitivePoli };

    if (used.has('jadwal_dokter')) {
      const rows = await fetchJadwalDokter(query);
      const shown = rows.slice(0, maxRows);
      vars.jadwal_dokter =
        formatJadwal(shown, { truncatedFrom: rows.length, kontakRs }) ||
        'Belum ada jadwal praktik yang tercatat. Silakan hubungi kami di ' + kontakRs + '.';
    }

    if (used.has('jadwal_hari_ini')) {
      const rows = await fetchJadwalDokter({ ...query, hariKerja: hariKerjaOf(new Date()) });
      const shown = rows.slice(0, maxRows);
      vars.jadwal_hari_ini =
        formatJadwal(shown, { truncatedFrom: rows.length, kontakRs }) ||
        'Tidak ada jadwal praktik dokter hari ini.';
    }
  }

  if (used.has('daftar_poli')) {
    const poli = await fetchPoliAktif();
    vars.daftar_poli = formatDaftarPoli(poli) || '(belum ada data)';
  }

  return vars;
}

function formatTanggal(d: Date): string {
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatJamSekarang(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}

async function writeLog(
  phoneE164: string,
  outcome: AutoReplyOutcome,
  ruleId: number | null,
  inboundText: string,
): Promise<void> {
  const keepText = await getSettingBool('autoreply.log_inbound_text', false);
  await AutoReplyLog.create({
    phoneE164,
    ruleId,
    outcome,
    inboundPreview: keepText ? inboundText.slice(0, 120) : null,
  });
}

/**
 * Kuota balasan per nomor per jam. Dihitung dari auto_reply_log, bukan outbox:
 * yang perlu dibatasi adalah seberapa sering kita MENJAWAB nomor ini, dan
 * pesan lain ke nomor yang sama (notifikasi antrian, hasil lab) tidak boleh
 * ikut memakan jatah itu.
 */
async function isRateLimited(phoneE164: string): Promise<boolean> {
  const max = await getSettingNumber('autoreply.max_per_number_per_hour', 5);
  if (max <= 0) return true;
  const sejak = new Date(Date.now() - 60 * 60 * 1000);
  const jumlah = await AutoReplyLog.count({
    where: { phoneE164, outcome: { [Op.in]: ['matched', 'fallback'] }, createdAt: { [Op.gte]: sejak } },
  });
  return jumlah >= max;
}

/** Pesan cadangan punya jeda sendiri, jauh lebih panjang dari kuota biasa -- lihat migrations/010. */
async function fallbackOnCooldown(phoneE164: string): Promise<boolean> {
  const menit = await getSettingNumber('autoreply.fallback_cooldown_minutes', 180);
  if (menit <= 0) return false;
  const sejak = new Date(Date.now() - menit * 60 * 1000);
  const terakhir = await AutoReplyLog.count({
    where: { phoneE164, outcome: 'fallback', createdAt: { [Op.gte]: sejak } },
  });
  return terakhir > 0;
}

export async function loadActiveRules(): Promise<Array<MatchableRule & { label: string; body: string }>> {
  const rows = await AutoReplyRule.findAll({ where: { isActive: true }, order: [['priority', 'ASC']] });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    body: r.body,
    keywords: parseKeywords(r.keywords),
    matchMode: r.matchMode,
    priority: r.priority,
  }));
}

/**
 * Menyusun teks balasan lengkap untuk satu aturan. Dipakai worker DAN kotak
 * uji coba di dashboard -- pratinjau yang berbeda dari yang benar-benar
 * terkirim lebih buruk daripada tidak ada pratinjau sama sekali.
 */
export async function buildReplyVars(body: string, inbound: string, identity: { namaRs: string; alamatRs: string; kontakRs: string }) {
  const now = new Date();
  return {
    ...identityVars(identity),
    tanggal: formatTanggal(now),
    jam: formatJamSekarang(now),
    ...(await buildJadwalVars(body, inbound, identity.kontakRs)),
  };
}

/**
 * Titik masuk dari wa-client.ts. Mengembalikan hasilnya alih-alih melempar --
 * satu pesan aneh dari satu nomor tidak boleh menjatuhkan pendengar pesan
 * masuk untuk semua nomor lain.
 */
export async function handleInboundMessage(msg: InboundMessage): Promise<AutoReplyResult> {
  if (!(await getSettingBool('autoreply.enabled', false))) return { outcome: 'disabled' };

  // Pesan tanpa satu pun huruf atau angka -- stiker, "👍", foto tanpa
  // keterangan. Bukan pertanyaan, jadi tidak dibalas DAN tidak dicatat: satu
  // jempol tidak layak membuat baris di tabel log maupun memakan kuota nomor.
  if (!normalizeInbound(msg.text)) return { outcome: 'no_match' };

  // Kunci berbasis id pesan WhatsApp. UNIQUE KEY uq_idem di mesin database
  // adalah penjaga terakhirnya -- baris outbox kedua memang akan ditolak di
  // sana. Tapi penolakan itu terjadi TERLALU BELAKANGAN untuk dua hal yang
  // sudah terlanjur terjadi sebelum insert: satu baris auto_reply_log bertanda
  // `matched` yang tidak pernah menghasilkan pesan, dan satu jatah kuota
  // pasien yang termakan. whatsapp-web.js menyerahkan ulang pesan lama secara
  // rutin setiap sesi dipulihkan, jadi tanpa pemeriksaan di depan ini, satu
  // kali restart worker bisa menghabiskan kuota nomor yang tidak mengirim apa
  // pun hari itu. Terlihat saat pengujian, bukan diperkirakan.
  const idempotencyKey = buildIdempotencyKey('AUTO_REPLY', msg.waMessageId);
  if (await Outbox.findOne({ where: { idempotencyKey }, attributes: ['id'] })) {
    await writeLog(msg.phoneE164, 'duplicate', null, msg.text);
    logger.info({ phone: maskPhone(msg.phoneE164) }, 'balasan otomatis: pesan yang sama diserahkan ulang, dilewati');
    return { outcome: 'duplicate' };
  }

  if (await isRateLimited(msg.phoneE164)) {
    await writeLog(msg.phoneE164, 'rate_limited', null, msg.text);
    logger.warn({ phone: maskPhone(msg.phoneE164) }, 'balasan otomatis: kuota per nomor habis');
    return { outcome: 'rate_limited' };
  }

  const hit = matchRule(msg.text, await loadActiveRules());

  if (!hit) {
    const fallback = (await getSetting('autoreply.fallback_body', '')) ?? '';
    if (!fallback.trim() || (await fallbackOnCooldown(msg.phoneE164))) {
      await writeLog(msg.phoneE164, 'no_match', null, msg.text);
      return { outcome: 'no_match' };
    }
    const ctx = await loadAutoReplyContext(fallback);
    await enqueueMessage(
      {
        idempotencyKey,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: msg.phoneE164,
        eventAt: new Date(),
        vars: await buildReplyVars(fallback, msg.text, ctx.identity),
      },
      ctx,
    );
    await writeLog(msg.phoneE164, 'fallback', null, msg.text);
    logger.info({ phone: maskPhone(msg.phoneE164) }, 'balasan otomatis: pesan cadangan');
    return { outcome: 'fallback' };
  }

  const ctx = await loadAutoReplyContext(hit.rule.body);
  await enqueueMessage(
    {
      idempotencyKey,
      noRkmMedis: null,
      rawPhone: null,
      phoneOverride: msg.phoneE164,
      eventAt: new Date(),
      vars: await buildReplyVars(hit.rule.body, msg.text, ctx.identity),
    },
    ctx,
  );
  await writeLog(msg.phoneE164, 'matched', hit.rule.id, msg.text);
  logger.info(
    { phone: maskPhone(msg.phoneE164), rule: hit.rule.label, keyword: hit.keyword },
    'balasan otomatis: aturan cocok',
  );
  return { outcome: 'matched', ruleId: hit.rule.id, ruleLabel: hit.rule.label };
}

/**
 * Pembungkus yang tidak pernah melempar -- dipanggil dari pendengar event
 * whatsapp-web.js.
 *
 * MENGEMBALIKAN hasilnya (bukan void) karena pemanggil memakainya untuk mengisi
 * `inbound_message.dibalas` saat mencatat. Kegagalan dilaporkan sebagai
 * `no_match`: yang pasti benar dalam keadaan itu adalah tidak ada balasan yang
 * terkirim, dan mencatatnya sebagai "dibalas" akan menyembunyikan justru
 * pertanyaan yang perlu dijawab manusia.
 */
export async function handleInboundMessageSafely(msg: InboundMessage): Promise<AutoReplyResult> {
  try {
    return await handleInboundMessage(msg);
  } catch (err) {
    logger.error({ phone: maskPhone(msg.phoneE164), ...safeError(err) }, 'balasan otomatis gagal diproses');
    return { outcome: 'no_match' };
  }
}
