'use server';

import { revalidatePath } from 'next/cache';
import { FarmasiTarget, WaSession, logAudit, setSetting } from '@/models';
import { findUnknownVariables, FARMASI_TEMPLATE_VARIABLES } from '@/core/template';
import { parseTarget, type JenisTarget } from '@/core/farmasiTarget';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadFarmasiContext, enqueueMessage } from '@/worker/pipeline';
import { requireRole } from '@/lib/authz';

const VARS_HINT = FARMASI_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ');

export interface HasilForm {
  error?: string;
  sukses?: string;
}

function segarkan(): void {
  revalidatePath('/farmasi');
}

/**
 * Sakelar utama, dicatat ke `audit_log` sebagai peristiwanya sendiri -- pola
 * yang sama dengan `auto_reply_toggle` dan karena alasan yang sama: inilah
 * momen data pasien mulai mengalir ke sebuah GRUP WhatsApp. Menenggelamkannya
 * sebagai satu nama kunci di dalam `settings_update` akan membuat perubahan
 * paling berkonsekuensi di halaman ini jadi yang paling sulit ditelusuri.
 */
export async function toggleFarmasiAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('farmasi.enabled', enabled ? '1' : '0');
  await logAudit(session!.user.username, 'farmasi_toggle', 'farmasi.enabled', enabled ? 'nyala' : 'mati');
  segarkan();
}

// ---------------------------------------------------------------------------
// Tujuan
// ---------------------------------------------------------------------------

export async function tambahTargetAction(_prev: HasilForm, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const jenis: JenisTarget = formData.get('jenis') === 'personal' ? 'personal' : 'grup';
  const label = String(formData.get('label') ?? '').trim();
  const nilai = String(formData.get('nilai') ?? '');

  if (!label) return { error: 'Beri nama tujuan ini, mis. "Grup Apotek" — supaya bisa dikenali di daftar.' };
  if (label.length > 80) return { error: 'Nama tujuan maksimal 80 karakter.' };

  const hasil = parseTarget(jenis, nilai);
  if (!hasil.ok) return { error: hasil.error };

  if (await FarmasiTarget.findOne({ where: { chatId: hasil.chatId } })) {
    return { error: 'Tujuan itu sudah ada di daftar. Menambahkannya dua kali membuat tiap resep terkirim dua kali.' };
  }

  const dibuat = await FarmasiTarget.create({
    jenis: hasil.jenis,
    chatId: hasil.chatId,
    label,
    createdBy: session!.user.username,
    updatedBy: null,
  });
  await logAudit(session!.user.username, 'farmasi_target_create', String(dibuat.id), `${hasil.jenis} ${hasil.chatId} (${label})`);
  segarkan();
  return { sukses: `Tujuan "${label}" ditambahkan. Kirim pesan uji untuk memastikan pesannya benar-benar sampai.` };
}

export async function ubahTargetAction(id: number, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const label = String(formData.get('label') ?? '').trim();
  if (!label) return { error: 'Nama tujuan wajib diisi.' };
  if (label.length > 80) return { error: 'Nama tujuan maksimal 80 karakter.' };

  await row.update({ label, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'farmasi_target_update', String(id), label);
  segarkan();
  return { sukses: 'Nama tujuan diperbarui.' };
}

/**
 * Alamatnya sendiri sengaja TIDAK bisa disunting -- hanya namanya.
 *
 * Mengubah alamat di tempat berarti riwayat pengiriman yang sudah ada di
 * `outbox` menunjuk baris tujuan yang kini berarti grup lain, sehingga "pesan
 * ini dulu dikirim ke mana" berubah jawabannya secara surut. Menghapus lalu
 * menambah baru meninggalkan dua baris `audit_log` yang jujur.
 */
export async function hapusTargetAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await logAudit(session!.user.username, 'farmasi_target_delete', String(id), `${row.jenis} ${row.chatId} (${row.label})`);
  await row.destroy();
  segarkan();
  return { sukses: `Tujuan "${row.label}" dihapus.` };
}

export async function toggleTargetAction(id: number, aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ isActive: aktif, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'farmasi_target_toggle', String(id), aktif ? 'aktif' : 'nonaktif');
  segarkan();
  return { sukses: aktif ? `"${row.label}" diaktifkan.` : `"${row.label}" dinonaktifkan.` };
}

// ---------------------------------------------------------------------------
// Daftar grup
// ---------------------------------------------------------------------------

/**
 * Menitipkan perintah ke worker lewat `wa_session.command` -- proses web tidak
 * memegang sesi WhatsApp dan kedua proses tidak pernah bicara lewat HTTP
 * (ARCHITECTURE §1). Konsekuensinya sama seperti tombol sambung ulang: hasilnya
 * baru muncul setelah worker mengambil perintahnya (paling lama 5 detik), jadi
 * halaman perlu dimuat ulang -- dan tombolnya mengatakan itu.
 */
export async function mintaSyncGrupAction(): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const sesi = await WaSession.findByPk(1);
  if (sesi?.status !== 'ready') {
    return { error: 'WhatsApp belum tersambung, jadi daftar grup tidak bisa dibaca. Buka halaman Koneksi dulu.' };
  }

  await WaSession.update({ command: 'sync_groups' }, { where: { id: 1 } });
  await logAudit(session!.user.username, 'farmasi_sync_grup', 'wa_session', 'diminta');
  segarkan();
  return { sukses: 'Permintaan dikirim ke worker. Muat ulang halaman ini beberapa detik lagi.' };
}

// ---------------------------------------------------------------------------
// Pesan
// ---------------------------------------------------------------------------

const KUNCI_PESAN = [
  'farmasi.template_validasi',
  'farmasi.template_penyerahan',
  'farmasi.template_generic',
  'farmasi.template_rekap',
] as const;

export async function simpanPesanAction(_prev: HasilForm, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const nilai: Record<string, string> = {};
  for (const kunci of KUNCI_PESAN) {
    const body = String(formData.get(kunci) ?? '').trim();
    if (!body) return { error: 'Semua isi pesan wajib diisi.' };

    // Sama seperti tiga jenis template lain: variabel tak dikenal ditolak SAAT
    // DISIMPAN, bukan diam-diam jadi string kosong di pesan yang sudah terkirim.
    const takDikenal = findUnknownVariables(body, FARMASI_TEMPLATE_VARIABLES);
    if (takDikenal.length > 0) {
      return {
        error: `Variabel tidak dikenal: ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${VARS_HINT}`,
      };
    }
    nilai[kunci] = body;
  }

  const maxPerCycle = Number(formData.get('farmasi.max_per_cycle') ?? 20);
  if (!Number.isInteger(maxPerCycle) || maxPerCycle < 1 || maxPerCycle > 200) {
    return { error: 'Ambang rekap harus bilangan bulat 1-200.' };
  }

  for (const [kunci, body] of Object.entries(nilai)) await setSetting(kunci, body);
  await setSetting('farmasi.max_per_cycle', String(maxPerCycle));
  await setSetting('farmasi.validasi_enabled', formData.get('farmasi.validasi_enabled') === 'on' ? '1' : '0');
  await setSetting('farmasi.penyerahan_enabled', formData.get('farmasi.penyerahan_enabled') === 'on' ? '1' : '0');

  await logAudit(session!.user.username, 'farmasi_pesan_update', 'app_setting', KUNCI_PESAN.join(','));
  segarkan();
  return { sukses: 'Pengaturan pesan disimpan.' };
}

// ---------------------------------------------------------------------------
// Kirim uji
// ---------------------------------------------------------------------------

/**
 * Tujuan yang tidak pernah dicoba sama saja dengan tidak ada.
 *
 * Kode grup yang salah GAGAL DIAM-DIAM: barisnya masuk antrean, dikirim,
 * ditolak WhatsApp, lalu tampil di halaman Antrean seperti gangguan jaringan
 * biasa. Pelajaran yang sama sudah pernah dibayar di tombol uji webhook
 * peringatan -- URL salah ketik, bot yang belum diundang ke grup, dan token
 * kedaluwarsa semuanya diam sampai saat paling buruk untuk menemukannya.
 *
 * Lewat `enqueueMessage()` yang SAMA dipakai worker, bukan `client.sendMessage`
 * langsung: yang perlu dibuktikan bukan cuma "grupnya ada", melainkan seluruh
 * lintasan sampai grup itu menerima -- termasuk dispatcher, jeda acak, kuota,
 * dan baris kode pengiriman.
 */
export async function kirimUjiAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const sesi = await WaSession.findByPk(1);
  if (sesi?.status !== 'ready') {
    return { error: 'WhatsApp belum tersambung, jadi pesan uji tidak akan terkirim. Buka halaman Koneksi dulu.' };
  }

  // {nama_rs} tidak perlu diisi di sini -- enqueueMessage() menyisipkan
  // identitas RS sendiri sebagai dasar untuk semua pemicu.
  const body =
    'Pesan uji dari sistem notifikasi farmasi {nama_rs}.\n\n' +
    'Kalau pesan ini terbaca, berarti tujuan ini sudah benar dan siap menerima ' +
    'pemberitahuan resep divalidasi serta obat diserahkan.';

  const ctx = await loadFarmasiContext('FARMASI_UJI', body, body);
  await enqueueMessage(
    {
      // Stempel waktu ikut ke dalam kunci supaya tombolnya bisa ditekan
      // BERULANG. Staf yang sedang membetulkan kode grup harus bisa mencoba
      // lagi dan lagi -- alasan yang sama seperti `kind: 'test'` dikecualikan
      // dari jeda peringatan gangguan.
      idempotencyKey: buildIdempotencyKey('FARMASI_UJI', row.chatId, new Date().toISOString()),
      noRkmMedis: null,
      rawPhone: null,
      chatId: row.chatId,
      eventAt: new Date(),
      vars: {},
    },
    ctx,
  );

  await logAudit(session!.user.username, 'farmasi_kirim_uji', String(id), row.chatId);
  segarkan();
  return {
    sukses: `Pesan uji dimasukkan ke antrean untuk "${row.label}". Biasanya sampai dalam beberapa detik — periksa halaman Antrean bila tidak.`,
  };
}
