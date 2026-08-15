'use server';

import { revalidatePath } from 'next/cache';
import { InboundMessage, logAudit, setSetting } from '@/models';
import { mintaSyncGrup, type HasilSyncGrup } from '@/lib/waGroups';
import { requireRole } from '@/lib/authz';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadBalasanContext, enqueueMessage } from '@/worker/pipeline';
import { varsBalasanApaAdanya } from '@/core/waCommand';
import { MAX_PANJANG_BALASAN } from '@/core/percakapan';

export type HasilAksi = HasilSyncGrup;

export interface HasilBalas {
  ok?: true;
  error?: string;
}

/**
 * Membalas satu percakapan dari `/pesan-masuk`.
 *
 * ==========================================================================
 * Klien menyerahkan ID PERCAKAPAN saja, tidak pernah alamat tujuannya
 * ==========================================================================
 *
 * Nomor dan jenis chat dibaca ULANG di sini dari `inbound_message`, dan itu
 * bukan kehati-hatian kosong: alamat yang dipercaya dari klien adalah alamat
 * yang bisa disunting menjadi nomor mana pun, sehingga halaman ini berubah
 * menjadi alat mengirim WhatsApp ke siapa saja atas nama rumah sakit. Aturan
 * "hasil pratinjau tidak pernah jadi sumber kebenaran" yang sudah dibayar di
 * `/broadcast` dan `/broadcast-terjadwal` berlaku utuh di sini.
 *
 * Percakapan yang belum pernah mengirim apa pun karena itu TIDAK bisa dibalas
 * -- dan itu memang batasnya: ini halaman membalas, bukan halaman memulai.
 */
export async function kirimBalasanAction(chatId: string, teks: string): Promise<HasilBalas> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const isi = teks.trim();
  if (!isi) return { error: 'Isi balasan masih kosong.' };
  if (isi.length > MAX_PANJANG_BALASAN) {
    return { error: `Balasan terlalu panjang (${isi.length} karakter, batas ${MAX_PANJANG_BALASAN}).` };
  }

  const terakhir = await InboundMessage.findOne({ where: { chatId }, order: [['id', 'DESC']] });
  if (!terakhir) return { error: 'Percakapan ini tidak ada di catatan pesan masuk.' };

  /**
   * GRUP lewat `chat_id`, PERORANGAN lewat nomornya.
   *
   * Bukan seragam, dan bedanya menentukan. `chat_id` melewati pemeriksaan
   * pendaftaran WhatsApp (`getNumberId()`) dengan sengaja -- benar untuk grup,
   * yang memang tidak punya nomor. Dipakai juga untuk perorangan, nomor yang
   * sudah tidak aktif akan diterima tanpa keluhan lalu tidak pernah sampai.
   *
   * Perorangan yang nomornya tidak terpetakan (`@lid`) karena itu DITOLAK di
   * sini alih-alih dikirim lewat `chat_id` sebagai jalan pintas: yang didapat
   * dari jalan pintas itu bukan balasan yang sampai, melainkan balasan yang
   * gagalnya tidak terlihat.
   */
  const keGrup = terakhir.jenis === 'grup';
  if (!keGrup && !terakhir.phoneE164) {
    return {
      error:
        'Nomor pengirimnya tidak bisa dipetakan (pengalamatan @lid), jadi balasan tidak bisa dialamatkan. Balas lewat aplikasi WhatsApp di ponsel rumah sakit.',
    };
  }

  const ctx = await loadBalasanContext(isi);
  await enqueueMessage(
    {
      // Stempel waktu ikut ke kunci: petugas memang boleh mengirim kalimat yang
      // sama dua kali, dan menolaknya sebagai duplikat berarti halaman menjawab
      // "terkirim" sementara tidak ada apa pun yang keluar. Pola yang sama
      // dipakai ADMINISTRASI, dan alasannya sama -- yang memutuskan tiap kalinya
      // adalah manusia.
      idempotencyKey: buildIdempotencyKey('BALAS_MANUAL', chatId, Date.now()),
      noRkmMedis: null,
      rawPhone: null,
      eventAt: new Date(),
      // Balasan manual tidak berangkat dari sebuah kunjungan, jadi tidak ada
      // poli maupun jenis pemeriksaan untuk diperiksa terhadap daftar sensitif.
      kdPoli: null,
      kdJenisPrw: null,
      // Teks bebas yang diketik petugas, BUKAN template. Tanpa pemetaan ini,
      // `{` yang kebetulan terketik akan dirender jadi string kosong -- kalimat
      // yang berubah diam-diam antara yang dilihat petugas dan yang diterima
      // pasien. `renderTemplate` jadi operasi identitas, dan itu aman hanya
      // karena substitusinya dijamin satu lintasan.
      vars: varsBalasanApaAdanya(isi),
      phoneOverride: keGrup ? null : terakhir.phoneE164,
      chatId: keGrup ? chatId : null,
    },
    ctx,
  );

  await logAudit(
    session!.user.username,
    'balas_manual',
    chatId,
    `${keGrup ? 'grup' : 'perorangan'}, ${isi.length} karakter`,
  );

  revalidatePath('/pesan-masuk');
  revalidatePath(`/pesan-masuk/${encodeURIComponent(chatId)}`);
  return { ok: true };
}

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
