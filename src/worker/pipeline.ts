import { Outbox, OptOut, Template, getSettingNumber, getSettingJson, getSetting } from '@/models';
import type { OutboxStatus } from '@/models';
import { getHospitalIdentity, type HospitalIdentity } from '@/khanza/common';
import { renderTemplate, type TemplateVariable } from '@/core/template';
import { checkPrivacy } from '@/core/privacy';
import { computeScheduledAt } from '@/core/quietHours';
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
}

async function loadSharedSettings() {
  const [quietStart, quietEnd, sensitivePoli, sensitiveExam, genericTemplate, identity] = await Promise.all([
    getSettingNumber('dispatch.quiet_hours_start', 21),
    getSettingNumber('dispatch.quiet_hours_end', 7),
    getSettingJson<string[]>('privacy.sensitive_poli_codes', []),
    getSettingJson<string[]>('privacy.sensitive_exam_codes', []),
    getSetting('privacy.generic_template'),
    getHospitalIdentity(),
  ]);
  return { quietStart, quietEnd, sensitivePoli, sensitiveExam, genericTemplate, identity };
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
  };
}

export interface EnqueueInput {
  idempotencyKey: string;
  noRkmMedis: string;
  rawPhone: string | null;
  eventAt: Date;
  kdPoli?: string | null;
  kdJenisPrw?: string | string[] | null;
  vars: Partial<Record<TemplateVariable, string>>;
  /** Hanya diisi BROADCAST -- menautkan baris outbox ke broadcast_campaign asalnya. */
  campaignId?: number | null;
}

/**
 * ARCHITECTURE §2 langkah [3]-[8]: RESOLVE -> NORMALIZE -> GATE -> PRIVACY ->
 * RENDER -> ENQUEUE. Sama untuk semua pemicu -- yang berbeda antar pemicu
 * hanya query sik (src/khanza/*.ts) dan pemetaan variabel template.
 */
export async function enqueueMessage(input: EnqueueInput, ctx: PipelineContext): Promise<void> {
  const contact = await resolvePhone(input.noRkmMedis, input.rawPhone);

  const privacyCheck = checkPrivacy(
    { kdPoli: input.kdPoli, kdJenisPrw: input.kdJenisPrw },
    ctx.sensitivePoli,
    ctx.sensitiveExam,
  );
  const body = renderTemplate(privacyCheck.safe ? ctx.template.body : ctx.genericTemplate, input.vars);

  let status: OutboxStatus = 'pending';
  if (!contact.phoneE164) {
    status = 'skipped_no_contact';
  } else if (await OptOut.findByPk(contact.phoneE164)) {
    status = 'skipped_opt_out';
  }

  const scheduledAt = computeScheduledAt(input.eventAt, ctx.triggerCode, ctx.quietStart, ctx.quietEnd);

  try {
    await Outbox.create(
      {
        idempotencyKey: input.idempotencyKey,
        triggerCode: ctx.triggerCode,
        campaignId: input.campaignId ?? null,
        noRkmMedis: input.noRkmMedis,
        phoneE164: contact.phoneE164,
        body,
        status,
        eventAt: input.eventAt,
        scheduledAt,
      },
      { ignoreDuplicates: true },
    );
  } catch (err) {
    logger.error(
      { triggerCode: ctx.triggerCode, noRkmMedis: input.noRkmMedis, phone: maskPhone(contact.phoneE164), ...safeError(err) },
      'gagal enqueue satu baris outbox',
    );
  }
}

/** Variabel identitas RS yang sama untuk semua template (F3.2). */
export function identityVars(identity: HospitalIdentity): Partial<Record<TemplateVariable, string>> {
  return { nama_rs: identity.namaRs, alamat_rs: identity.alamatRs, kontak_rs: identity.kontakRs };
}
