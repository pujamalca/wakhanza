'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/authz';
import { buatPengguna, ubahPengguna, setelSandi, setelAktif, bukaKunci } from '@/lib/userAdmin';
import type { AppUserRole } from '@/core/userPolicy';

/**
 * Semuanya `requireRole('admin')`, dan itu bukan sekadar mengikuti pola.
 * Halaman ini adalah satu-satunya tempat di dashboard yang bisa MEMBERI akses
 * kepada orang lain: operator yang bisa membuat akun admin sudah menjadi admin
 * dengan langkah tambahan.
 *
 * Pagar isinya (admin terakhir, diri sendiri, panjang sandi) TIDAK diulang di
 * sini -- semuanya di `lib/userAdmin.ts` yang dipakai bersama CLI. Yang ada di
 * berkas ini hanya penerjemahan FormData dan otorisasi.
 */

export interface HasilForm {
  error?: string;
  sukses?: string;
}

function peranDari(formData: FormData): AppUserRole | null {
  const nilai = String(formData.get('role') ?? '');
  return nilai === 'admin' || nilai === 'operator' ? nilai : null;
}

function segarkan() {
  revalidatePath('/pengguna');
}

export async function buatPenggunaAction(_prev: HasilForm, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const role = peranDari(formData);
  if (!role) return { error: 'Peran tidak dikenal.' };

  const hasil = await buatPengguna(
    {
      username: String(formData.get('username') ?? ''),
      name: String(formData.get('name') ?? ''),
      role,
      password: String(formData.get('password') ?? ''),
    },
    session!.user.username,
  );
  if (!hasil.ok) return { error: hasil.error };

  segarkan();
  return { sukses: 'Pengguna dibuat.' };
}

export async function ubahPenggunaAction(id: number, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const role = peranDari(formData);
  if (!role) return { error: 'Peran tidak dikenal.' };

  const hasil = await ubahPengguna(
    id,
    { name: String(formData.get('name') ?? ''), role },
    session!.user.username,
    session!.user.username,
  );
  if (!hasil.ok) return { error: hasil.error };

  segarkan();
  return { sukses: 'Perubahan tersimpan.' };
}

export async function setelSandiAction(id: number, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const baru = String(formData.get('password') ?? '');
  const ulangi = String(formData.get('passwordUlangi') ?? '');
  if (baru !== ulangi) return { error: 'Kata sandi dan ulangannya tidak sama.' };

  const hasil = await setelSandi(id, baru, session!.user.username);
  if (!hasil.ok) return { error: hasil.error };

  segarkan();
  return { sukses: 'Kata sandi disetel ulang.' };
}

export async function setelAktifAction(id: number, aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const hasil = await setelAktif(id, aktif, session!.user.username, session!.user.username);
  if (!hasil.ok) return { error: hasil.error };

  segarkan();
  return { sukses: aktif ? 'Akun diaktifkan.' : 'Akun dinonaktifkan.' };
}

export async function bukaKunciAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const hasil = await bukaKunci(id, session!.user.username);
  if (!hasil.ok) return { error: hasil.error };

  segarkan();
  return { sukses: 'Kunci login dilepas.' };
}
