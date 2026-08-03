'use server';

import { revalidatePath } from 'next/cache';
import { logAudit, setSetting } from '@/models';
import { mintaSyncGrup, type HasilSyncGrup } from '@/lib/waGroups';
import { requireRole } from '@/lib/authz';

export type HasilAksi = HasilSyncGrup;

export async function muatDaftarGrupAction(): Promise<HasilAksi> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const hasil = await mintaSyncGrup(session!.user.username);
  revalidatePath('/pesan-masuk');
  revalidatePath('/farmasi'); // daftar grup dipakai di kedua halaman
  return hasil;
}

/**
 * Sakelar penyimpanan ISI pesan masuk.
 *
 * Dicatat ke `audit_log` sebagai peristiwanya sendiri, bukan lewat
 * `/api/settings` -- pola yang sama dengan `autoreply.enabled` dan
 * `farmasi.enabled`. Ini keputusan tentang menyimpan kalimat yang diketik
 * pasien, kadang berisi keluhan medis; ia harus bisa dicari di audit sebagai
 * peristiwa tersendiri, bukan tenggelam sebagai satu nama kunci di dalam
 * daftar `settings_update`.
 */
export async function toggleSimpanTeksAction(aktif: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('inbox.simpan_teks', aktif ? '1' : '0');
  await logAudit(session!.user.username, 'inbox_simpan_teks_toggle', 'inbox.simpan_teks', aktif ? 'nyala' : 'mati');
  revalidatePath('/pesan-masuk');
}
