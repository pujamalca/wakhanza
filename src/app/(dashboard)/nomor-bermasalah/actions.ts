'use server';

import { revalidatePath } from 'next/cache';
import { PatientContact, logAudit } from '@/models';
import { normalizePhone } from '@/core/phone';
import { requireSession } from '@/lib/authz';

/** F2.3 / §9.1: koreksi nomor -- diizinkan untuk admin maupun operator. */
export async function correctPhoneAction(noRkmMedis: string, formData: FormData): Promise<{ error?: string }> {
  const { session, response } = await requireSession();
  if (response) return { error: 'Tidak diizinkan.' };

  const raw = String(formData.get('phone') ?? '').trim();
  const result = normalizePhone(raw);
  if (!result.ok) {
    return { error: `Nomor tidak valid (${result.reason}). Periksa kembali sebelum menyimpan.` };
  }

  // F2.3: koreksi manual MENGALAHKAN hasil otomatis -- source='manual' membuat
  // siklus poller berikutnya tidak lagi menimpanya (worker/contactResolver.ts).
  await PatientContact.upsert({
    noRkmMedis,
    rawValue: raw.slice(0, 40),
    phoneE164: result.value,
    source: 'manual',
    reason: null,
    checkedAt: new Date(),
    updatedBy: session!.user.username,
  });
  await logAudit(session!.user.username, 'contact_correct', noRkmMedis, `-> ${result.value}`);
  revalidatePath('/nomor-bermasalah');
  return {};
}
