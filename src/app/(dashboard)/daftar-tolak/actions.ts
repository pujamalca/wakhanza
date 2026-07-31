'use server';

import { revalidatePath } from 'next/cache';
import { OptOut, logAudit } from '@/models';
import { normalizePhone } from '@/core/phone';
import { requireRole } from '@/lib/authz';

/** ARCHITECTURE §9.1: bukan "kirim ulang" atau "koreksi nomor" -- admin-only. */
export async function addOptOutAction(formData: FormData): Promise<{ error?: string }> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const raw = String(formData.get('phone') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim().slice(0, 200);

  const result = normalizePhone(raw);
  if (!result.ok) return { error: `Nomor tidak valid (${result.reason}).` };

  await OptOut.upsert({ phoneE164: result.value, source: 'manual', note: note || null });
  await logAudit(session!.user.username, 'opt_out_add', result.value, note || undefined);
  revalidatePath('/daftar-tolak');
  return {};
}

export async function removeOptOutAction(phoneE164: string): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) throw new Error('unauthorized');

  await OptOut.destroy({ where: { phoneE164 } });
  await logAudit(session!.user.username, 'opt_out_remove', phoneE164);
  revalidatePath('/daftar-tolak');
}
