'use server';

import { revalidatePath } from 'next/cache';
import { Template, logAudit } from '@/models';
import { findUnknownVariables } from '@/core/template';
import { requireRole } from '@/lib/authz';

/** ARCHITECTURE §9.1: mengubah template = "mengubah pengaturan", admin-only. */
export async function updateTemplateAction(triggerCode: string, formData: FormData): Promise<{ error?: string }> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const label = String(formData.get('label') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const isActive = formData.get('isActive') === 'on';

  if (!label || !body) return { error: 'Label dan isi wajib diisi.' };

  // ARCHITECTURE §5.3: variabel tak dikenal ditolak SAAT DISIMPAN, bukan menghasilkan
  // string kosong saat kirim -- kesalahan harus muncul ke petugas yang menyunting.
  const unknown = findUnknownVariables(body);
  if (unknown.length > 0) {
    return { error: `Variabel tidak dikenal: ${unknown.map((v) => `{${v}}`).join(', ')}` };
  }

  await Template.update(
    { label, body, isActive, updatedBy: session!.user.username },
    { where: { triggerCode } },
  );
  await logAudit(session!.user.username, 'template_update', triggerCode);
  revalidatePath('/template');
  return {};
}
