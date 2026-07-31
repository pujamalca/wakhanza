import { normalizePhone } from '@/core/phone';
import { PatientContact } from '@/models';

export interface ResolvedContact {
  phoneE164: string | null;
  reason?: string;
}

/**
 * F2.1-F2.3: koreksi manual (dashboard, source='manual') mengalahkan hasil
 * normalisasi otomatis. sik.pasien TIDAK PERNAH diubah (F2.4) — perbaikan
 * hanya tersimpan di patient_contact milik wakhanza.
 */
export async function resolvePhone(noRkmMedis: string, rawValue: string | null): Promise<ResolvedContact> {
  const existing = await PatientContact.findByPk(noRkmMedis);
  if (existing?.source === 'manual') {
    return { phoneE164: existing.phoneE164, reason: existing.reason ?? undefined };
  }

  const result = normalizePhone(rawValue);
  const phoneE164 = result.ok ? result.value : null;
  const reason = result.ok ? null : result.reason;

  await PatientContact.upsert({
    noRkmMedis,
    rawValue: rawValue?.slice(0, 40) ?? null,
    phoneE164,
    source: 'auto',
    reason,
    checkedAt: new Date(),
  });

  return { phoneE164, reason: reason ?? undefined };
}
