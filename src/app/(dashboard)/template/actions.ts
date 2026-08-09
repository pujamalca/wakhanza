'use server';

import { revalidatePath } from 'next/cache';
import { Template, logAudit } from '@/models';
import { findUnknownVariables } from '@/core/template';
import { BATAS_MAKSIMAL, batasSah } from '@/core/ujiTerbatas';
import { requireRole } from '@/lib/authz';

/** ARCHITECTURE §9.1: mengubah template = "mengubah pengaturan", admin-only. */
export async function updateTemplateAction(triggerCode: string, formData: FormData): Promise<{ error?: string }> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const label = String(formData.get('label') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const isActive = formData.get('isActive') === 'on';

  if (!label || !body) return { error: 'Label dan isi wajib diisi.' };

  /**
   * MODE UJI TERBATAS (migrations/036). Diperiksa lewat `batasSah()` yang SAMA
   * dipakai uji unitnya -- bukan dengan perbandingan yang ditulis ulang di sini,
   * karena batas atasnya bukan angka teknis melainkan pernyataan (di atas itu ia
   * bukan lagi uji terbatas, dan yang dimaksud staf sebenarnya 0).
   *
   * Kolom kosong dibaca sebagai 0 = tanpa batas, sama seperti bawaan kolomnya.
   */
  const batasMentah = String(formData.get('batasPasienHarian') ?? '').trim();
  const batasPasienHarian = batasMentah === '' ? 0 : Number(batasMentah);
  if (!batasSah(batasPasienHarian)) {
    return { error: `Batas pasien per hari harus bilangan bulat 0 sampai ${BATAS_MAKSIMAL} (0 = tanpa batas).` };
  }

  // ARCHITECTURE §5.3: variabel tak dikenal ditolak SAAT DISIMPAN, bukan menghasilkan
  // string kosong saat kirim -- kesalahan harus muncul ke petugas yang menyunting.
  const unknown = findUnknownVariables(body);
  if (unknown.length > 0) {
    return { error: `Variabel tidak dikenal: ${unknown.map((v) => `{${v}}`).join(', ')}` };
  }

  await Template.update(
    { label, body, isActive, batasPasienHarian, updatedBy: session!.user.username },
    { where: { triggerCode } },
  );
  await logAudit(session!.user.username, 'template_update', triggerCode);
  revalidatePath('/template');
  return {};
}
