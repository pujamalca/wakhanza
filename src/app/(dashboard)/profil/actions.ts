'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/authz';
import { ubahNamaSendiri, gantiSandiSendiri } from '@/lib/userAdmin';

export interface HasilForm {
  error?: string;
  sukses?: string;
}

/**
 * Sengaja `requireSession()` dan bukan `requireRole('admin')`: profil adalah
 * milik pemakainya, dan operator yang tidak bisa mengganti kata sandinya
 * sendiri akan berakhir memakai sandi yang diketikkan orang lain untuknya --
 * berbagi sandi justru yang paling merusak jejak audit, karena `actor` di
 * `audit_log` berhenti berarti "orang ini".
 *
 * Id diambil dari SESI, tidak pernah dari form. Menerima id dari form berarti
 * siapa pun yang bisa menekan tombol bisa mengganti kata sandi akun mana pun.
 */
export async function ubahNamaAction(_prev: HasilForm, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireSession();
  if (response) return { error: 'Tidak diizinkan.' };

  const hasil = await ubahNamaSendiri(Number(session!.user.id), String(formData.get('name') ?? ''), session!.user.username);
  if (!hasil.ok) return { error: hasil.error };

  revalidatePath('/profil');
  return { sukses: 'Nama tampilan tersimpan.' };
}

export async function gantiSandiAction(_prev: HasilForm, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireSession();
  if (response) return { error: 'Tidak diizinkan.' };

  const lama = String(formData.get('sandiLama') ?? '');
  const baru = String(formData.get('sandiBaru') ?? '');
  const ulangi = String(formData.get('sandiUlangi') ?? '');

  // Diperiksa juga di klien, tapi klien bisa dilewati -- dan ketikan yang
  // meleset di kotak kedua akan menghasilkan sandi yang tidak diketahui
  // siapa pun, termasuk pemiliknya.
  if (baru !== ulangi) return { error: 'Kata sandi baru dan ulangannya tidak sama.' };

  const hasil = await gantiSandiSendiri(Number(session!.user.id), lama, baru, session!.user.username);
  if (!hasil.ok) return { error: hasil.error };

  revalidatePath('/profil');
  return { sukses: 'Kata sandi diganti. Sesi yang sedang berjalan tidak terputus.' };
}
