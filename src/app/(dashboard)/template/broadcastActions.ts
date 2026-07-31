'use server';

import { revalidatePath } from 'next/cache';
import { BroadcastTemplate, logAudit } from '@/models';
import { findUnknownVariables, BROADCAST_TEMPLATE_VARIABLES } from '@/core/template';
import { requireRole } from '@/lib/authz';

/**
 * Halaman yang menampilkan pilihan template ini adalah /broadcast dan
 * /broadcast-terjadwal, jadi keduanya ikut disegarkan -- kalau tidak, staf
 * yang baru menyimpan template harus memuat ulang manual sebelum melihatnya
 * di dropdown.
 */
function revalidateAll() {
  revalidatePath('/template');
  revalidatePath('/broadcast');
  revalidatePath('/broadcast-terjadwal');
}

function validate(name: string, body: string): string | null {
  if (!name) return 'Nama template wajib diisi.';
  if (!body) return 'Isi pesan wajib diisi.';
  // Sama seperti template pemicu (ARCHITECTURE §5.3): variabel tak dikenal
  // ditolak SAAT DISIMPAN, bukan diam-diam jadi string kosong saat kirim.
  // Daftar yang diizinkan lebih sempit -- {no_antrian}/{nama_poli}/dst tidak
  // well-defined untuk segmen yang bisa merentang banyak kunjungan.
  const unknown = findUnknownVariables(body, BROADCAST_TEMPLATE_VARIABLES);
  if (unknown.length > 0) {
    return `Variabel tidak dikenal untuk broadcast: ${unknown.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${BROADCAST_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`;
  }
  return null;
}

export async function createBroadcastTemplateAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const name = String(formData.get('name') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const invalid = validate(name, body);
  if (invalid) return { error: invalid };

  // uq_name menegakkan keunikan di database; pemeriksaan ini hanya supaya
  // pesan errornya bisa dibaca staf alih-alih galat SQL mentah.
  if (await BroadcastTemplate.findOne({ where: { name } })) {
    return { error: `Sudah ada template bernama "${name}".` };
  }

  const created = await BroadcastTemplate.create({ name, body, createdBy: session!.user.username, updatedBy: null });
  await logAudit(session!.user.username, 'broadcast_template_create', String(created.id), name);
  revalidateAll();
  return { ok: true };
}

export async function updateBroadcastTemplateAction(id: number, formData: FormData): Promise<{ error?: string }> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const name = String(formData.get('name') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const isActive = formData.get('isActive') === 'on';
  const invalid = validate(name, body);
  if (invalid) return { error: invalid };

  const row = await BroadcastTemplate.findByPk(id);
  if (!row) return { error: 'Template tidak ditemukan.' };

  await row.update({ name, body, isActive, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'broadcast_template_update', String(id), name);
  revalidateAll();
  return {};
}

export async function deleteBroadcastTemplateAction(id: number): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  const row = await BroadcastTemplate.findByPk(id);
  if (!row) return;

  // Menghapus template TIDAK menyentuh pesan yang sudah terkirim maupun jadwal
  // yang memakainya: broadcast_schedule menyimpan SALINAN teks pesannya
  // (message_body), bukan acuan ke template. Template di sini murni alat bantu
  // penyusunan -- jadwal yang berjalan tidak akan berubah atau rusak.
  await row.destroy();
  await logAudit(session!.user.username, 'broadcast_template_delete', String(id), row.name);
  revalidateAll();
}
