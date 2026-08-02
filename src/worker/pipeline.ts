import { Outbox, OptOut, Template, getSettingNumber, getSettingBool, getSettingJson, getSetting } from '@/models';
import type { OutboxStatus } from '@/models';
import { getHospitalIdentity, type HospitalIdentity } from '@/khanza/common';
import { renderTemplate, type TemplateVariable } from '@/core/template';
import { appendUniqueCode, buildUniqueCodeFooter, DEFAULT_UNIQUE_CODE_TEMPLATE } from '@/core/uniqueCode';
import { checkPrivacy } from '@/core/privacy';
import { computeScheduledAt } from '@/core/quietHours';
import { respectsOptOut } from '@/core/optOut';
import { resolvePhone } from './contactResolver';
import { logger, safeError, maskPhone } from '@/lib/logger';

/**
 * Konteks yang sama dipakai seluruh baris dalam satu siklus poller untuk satu
 * pemicu -- dimuat sekali per siklus (bukan per baris) supaya tidak membaca
 * app_setting/template berulang-ulang untuk ratusan baris yang sama.
 */
export interface PipelineContext {
  triggerCode: string;
  /** Bentuk minimal yang benar-benar dibaca di bawah -- baris Template asli maupun teks ad-hoc (BROADCAST) sama-sama cocok. */
  template: { body: string };
  genericTemplate: string;
  identity: HospitalIdentity;
  quietStart: number;
  quietEnd: number;
  sensitivePoli: string[];
  sensitiveExam: string[];
  /** Berlaku untuk SEMUA pemicu, termasuk BROADCAST -- lihat core/uniqueCode.ts. */
  uniqueCodeTemplate: string;
}

/**
 * Sakelar dan teks digabung jadi SATU nilai: template kosong sudah berarti
 * "tidak ada footer" di appendUniqueCode, jadi tidak perlu dua cabang terpisah
 * di enqueueMessage yang bisa tidak sinkron satu sama lain.
 */
export async function loadUniqueCodeTemplate(): Promise<string> {
  const [enabled, template] = await Promise.all([
    getSettingBool('dispatch.unique_code_enabled', true),
    getSetting('dispatch.unique_code_template', DEFAULT_UNIQUE_CODE_TEMPLATE),
  ]);
  return enabled ? (template ?? DEFAULT_UNIQUE_CODE_TEMPLATE) : '';
}

/**
 * Pratinjau dashboard (BROADCAST dan BROADCAST TERJADWAL) harus menampilkan
 * pesan yang SAMA dengan yang diterima pasien, termasuk baris kode unik yang
 * ditambahkan otomatis. Membaca pengaturan lewat fungsi yang sama dengan
 * enqueueMessage supaya pratinjau tidak bisa menyimpang dari kenyataan saat
 * pengaturannya diubah.
 *
 * @returns null bila fitur sedang dimatikan.
 */
export async function previewUniqueCodeFooter(seed: string): Promise<string | null> {
  // Waktu pratinjau = sekarang. Pesan sungguhan memakai waktu KIRIM-nya
  // sendiri, jadi angka di pratinjau memang bukan angka yang akan terkirim --
  // yang diperlihatkan adalah BENTUKNYA, supaya staf tahu baris ini akan ada.
  return buildUniqueCodeFooter(seed, await loadUniqueCodeTemplate(), new Date());
}

async function loadSharedSettings() {
  const [quietStart, quietEnd, sensitivePoli, sensitiveExam, genericTemplate, identity, uniqueCodeTemplate] = await Promise.all([
    getSettingNumber('dispatch.quiet_hours_start', 21),
    getSettingNumber('dispatch.quiet_hours_end', 7),
    getSettingJson<string[]>('privacy.sensitive_poli_codes', []),
    getSettingJson<string[]>('privacy.sensitive_exam_codes', []),
    getSetting('privacy.generic_template'),
    getHospitalIdentity(),
    loadUniqueCodeTemplate(),
  ]);
  return { quietStart, quietEnd, sensitivePoli, sensitiveExam, genericTemplate, identity, uniqueCodeTemplate };
}

export async function loadPipelineContext(triggerCode: string): Promise<PipelineContext | null> {
  const template = await Template.findByPk(triggerCode);
  if (!template || !template.isActive) return null;

  const shared = await loadSharedSettings();

  return {
    triggerCode,
    template,
    genericTemplate: shared.genericTemplate ?? template.body,
    identity: shared.identity,
    quietStart: shared.quietStart,
    quietEnd: shared.quietEnd,
    sensitivePoli: shared.sensitivePoli,
    sensitiveExam: shared.sensitiveExam,
    uniqueCodeTemplate: shared.uniqueCodeTemplate,
  };
}

/**
 * Konteks untuk BROADCAST: staf memilih segmen pasien di dashboard lalu
 * mengetik isi pesan saat itu juga -- tidak ada baris `template` tersimpan
 * untuk dimuat lewat Template.findByPk seperti ketujuh pemicu lain. Tetap
 * memakai enqueueMessage() yang sama persis sesudah ini supaya privasi,
 * opt-out, jam tenang, dan idempotency identik dengan pemicu reaktif --
 * satu-satunya beda adalah ASAL isi pesan.
 */
export async function loadBroadcastContext(body: string): Promise<PipelineContext> {
  const shared = await loadSharedSettings();
  return {
    triggerCode: 'BROADCAST',
    template: { body },
    genericTemplate: shared.genericTemplate ?? body,
    identity: shared.identity,
    quietStart: shared.quietStart,
    quietEnd: shared.quietEnd,
    sensitivePoli: shared.sensitivePoli,
    sensitiveExam: shared.sensitiveExam,
    uniqueCodeTemplate: shared.uniqueCodeTemplate,
  };
}

/**
 * Konteks untuk BALASAN OTOMATIS: isi pesannya berasal dari baris
 * `auto_reply_rule` yang cocok, bukan dari `template` maupun ketikan staf saat
 * itu juga. Sesudah ini tetap lewat enqueueMessage() yang sama seperti sembilan
 * pemicu lain -- kecuali satu hal: AUTO_REPLY TIDAK tunduk pada opt-out
 * (core/optOut.ts). Frasa yang dipakai pasien adalah "Berhenti Kirim Otomatis",
 * dan jawaban atas pesan yang ia kirim sendiri barusan bukan kiriman otomatis
 * -- mendiamkan orang yang baru saja bertanya membuat sistem tampak rusak, dan
 * bukan itu yang ia minta.
 */
export async function loadAutoReplyContext(body: string): Promise<PipelineContext> {
  const shared = await loadSharedSettings();
  return {
    triggerCode: 'AUTO_REPLY',
    template: { body },
    genericTemplate: shared.genericTemplate ?? body,
    identity: shared.identity,
    quietStart: shared.quietStart,
    quietEnd: shared.quietEnd,
    sensitivePoli: shared.sensitivePoli,
    sensitiveExam: shared.sensitiveExam,
    uniqueCodeTemplate: shared.uniqueCodeTemplate,
  };
}

export interface EnqueueInput {
  idempotencyKey: string;
  /**
   * null hanya untuk AUTO_REPLY: yang mengirim pesan adalah sebuah NOMOR, dan
   * nomor itu belum tentu terhubung ke pasien mana pun di sik.
   */
  noRkmMedis: string | null;
  rawPhone: string | null;
  eventAt: Date;
  kdPoli?: string | null;
  kdJenisPrw?: string | string[] | null;
  vars: Partial<Record<TemplateVariable, string>>;
  /** Hanya diisi BROADCAST -- menautkan baris outbox ke broadcast_campaign asalnya. */
  campaignId?: number | null;
  /**
   * Nomor tujuan yang SUDAH pasti, melewati resolvePhone sepenuhnya.
   *
   * Dipakai AUTO_REPLY saja. Untuk sembilan pemicu lain, nomor tujuan adalah
   * hasil tebakan atas kolom `pasien.no_tlp` yang diketik bebas -- di situlah
   * resolvePhone bekerja. Untuk balasan otomatis, tujuannya adalah nomor yang
   * BARU SAJA mengirim pesan lewat WhatsApp: tidak ada yang perlu dinormalisasi
   * (WhatsApp sudah menyerahkannya dalam bentuk E.164), dan tidak ada pasien
   * yang boleh diklaim memilikinya. Melewatkannya ke resolvePhone justru akan
   * menulis baris patient_contact atas nama pasien yang belum tentu benar.
   */
  phoneOverride?: string | null;
  /**
   * Lampiran gambar/dokumen. HANYA diisi BROADCAST manual -- di sana selalu ada
   * staf yang melihat lampirannya sebelum menekan Kirim. Pemicu lain mengirim
   * tanpa peninjauan tiap kali, jadi sengaja tidak punya jalur ini.
   */
  media?: { path: string; mime: string; name: string } | null;
}

/**
 * ARCHITECTURE §2 langkah [3]-[8]: RESOLVE -> NORMALIZE -> GATE -> PRIVACY ->
 * RENDER -> ENQUEUE. Sama untuk semua pemicu -- yang berbeda antar pemicu
 * hanya query sik (src/khanza/*.ts) dan pemetaan variabel template.
 */
export async function enqueueMessage(input: EnqueueInput, ctx: PipelineContext): Promise<void> {
  let phoneE164: string | null;
  if (input.phoneOverride) {
    phoneE164 = input.phoneOverride;
  } else if (input.noRkmMedis) {
    phoneE164 = (await resolvePhone(input.noRkmMedis, input.rawPhone)).phoneE164;
  } else {
    // Tanpa nomor pasti dan tanpa pasien untuk dicari nomornya, tidak ada
    // tujuan yang bisa ditentukan. Tetap dicatat sebagai baris outbox
    // skipped_no_contact di bawah, bukan dibuang diam-diam.
    phoneE164 = null;
  }

  const privacyCheck = checkPrivacy(
    { kdPoli: input.kdPoli, kdJenisPrw: input.kdJenisPrw },
    ctx.sensitivePoli,
    ctx.sensitiveExam,
  );
  const rendered = renderTemplate(privacyCheck.safe ? ctx.template.body : ctx.genericTemplate, input.vars);

  // scheduledAt dihitung SEBELUM body, karena baris kode pengiriman memuat
  // {waktu} dan yang benar untuk diisikan adalah waktu KIRIM, bukan waktu
  // masuk antrean. Pesan yang muncul pukul 22.00 lalu ditahan jam tenang
  // sampai 07.00 harus menyebut 07.00 -- kalau tidak, pasien membaca stempel
  // sembilan jam sebelum pesannya benar-benar tiba.
  const scheduledAt = computeScheduledAt(input.eventAt, ctx.triggerCode, ctx.quietStart, ctx.quietEnd);

  // Kode unik disisipkan di sini (ENQUEUE), bukan di dispatcher (SEND),
  // supaya `outbox.body` tetap persis sama dengan yang benar-benar dikirim --
  // halaman Log menampilkan teks sungguhan, dan percobaan kirim ulang
  // mengirim teks yang identik alih-alih pesan yang tampak baru.
  const body = appendUniqueCode(rendered, input.idempotencyKey, ctx.uniqueCodeTemplate, scheduledAt);

  let status: OutboxStatus = 'pending';
  if (!phoneE164) {
    status = 'skipped_no_contact';
  } else if (respectsOptOut(ctx.triggerCode) && (await OptOut.findByPk(phoneE164))) {
    // respectsOptOut() DILETAKKAN DI DEPAN pemeriksaan database, bukan
    // sesudahnya: untuk BROADCAST ke ratusan penerima, itu menghemat satu
    // query per baris yang hasilnya toh tidak dipakai.
    status = 'skipped_opt_out';
  }

  try {
    await Outbox.create(
      {
        idempotencyKey: input.idempotencyKey,
        triggerCode: ctx.triggerCode,
        campaignId: input.campaignId ?? null,
        noRkmMedis: input.noRkmMedis,
        phoneE164: phoneE164,
        body,
        mediaPath: input.media?.path ?? null,
        mediaMime: input.media?.mime ?? null,
        mediaName: input.media?.name ?? null,
        status,
        eventAt: input.eventAt,
        scheduledAt,
      },
      { ignoreDuplicates: true },
    );
  } catch (err) {
    logger.error(
      { triggerCode: ctx.triggerCode, noRkmMedis: input.noRkmMedis, phone: maskPhone(phoneE164), ...safeError(err) },
      'gagal enqueue satu baris outbox',
    );
  }
}

/** Variabel identitas RS yang sama untuk semua template (F3.2). */
export function identityVars(identity: HospitalIdentity): Partial<Record<TemplateVariable, string>> {
  return { nama_rs: identity.namaRs, alamat_rs: identity.alamatRs, kontak_rs: identity.kontakRs };
}
