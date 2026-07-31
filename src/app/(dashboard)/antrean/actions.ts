'use server';

import { revalidatePath } from 'next/cache';
import { Outbox, logAudit } from '@/models';
import { requireSession } from '@/lib/authz';

/** F6: "operator hanya kirim ulang dan koreksi nomor" (ARCHITECTURE §9.1) -- kedua peran boleh. */
export async function resendOutboxAction(id: number): Promise<void> {
  const { session, response } = await requireSession();
  if (response) throw new Error('unauthorized');

  const row = await Outbox.findByPk(id);
  if (!row) throw new Error('baris outbox tidak ditemukan');
  if (!['failed', 'failed_permanent', 'expired'].includes(row.status)) {
    throw new Error(`baris berstatus '${row.status}' tidak bisa dikirim ulang`);
  }

  await row.update({ status: 'pending', scheduledAt: new Date(), lastError: null });
  await logAudit(session!.user.username, 'outbox_resend', String(id), `trigger_code=${row.triggerCode}`);
  revalidatePath('/antrean');
}
