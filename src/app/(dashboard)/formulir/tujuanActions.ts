'use server';

import { revalidatePath } from 'next/cache';
import { WaForm, WaFormEntry, WaFormTarget, WaSession, parseJawaban, logAudit } from '@/models';
import { parseTarget, type JenisTarget } from '@/core/farmasiTarget';
import { bacaRincian, isRincianTujuan, susunPemberitahuanFormulir } from '@/core/waFormulirTujuan';
import { isGroupAddress } from '@/core/waAddress';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadFarmasiContext, enqueueMessage } from '@/worker/pipeline';
import { mintaSyncGrup } from '@/lib/waGroups';
import { requireRole } from '@/lib/authz';

export interface HasilForm {
  error?: string;
  sukses?: string;
}

function segarkan(): void {
  revalidatePath('/formulir');
}

const NAMA_RINCIAN = {
  ringkas: 'ringkas (tanpa isi jawaban)',
  lengkap: 'lengkap (seluruh jawaban ikut)',
} as const;

// ---------------------------------------------------------------------------
// Seberapa rinci
// ---------------------------------------------------------------------------

/**
 * Dicatat ke `audit_log` sebagai peristiwanya SENDIRI, bukan menumpang
 * `wa_form_update`.
 *
 * Alasannya sama dengan `template_tujuan_mode`: inilah momen isi yang diketik
 * pasien mulai (atau berhenti) beredar di sebuah grup WhatsApp yang
 * keanggotaannya diatur di luar sistem ini. Menenggelamkannya sebagai satu
 * kolom di dalam penyuntingan formulir membuat perubahan paling berkonsekuensi
 * di halaman ini justru yang paling sulit ditelusuri belakangan.
 */
export async function setRincianTujuanAction(formId: number, rincian: string): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  if (!isRincianTujuan(rincian)) return { error: 'Pilihan rincian tidak dikenal.' };

  const form = await WaForm.findByPk(formId);
  if (!form) return { error: 'Formulir itu sudah tidak ada.' };

  await form.update({ tujuanRincian: rincian, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'wa_form_tujuan_rincian', String(formId), `${form.nama}: ${rincian}`);
  segarkan();
  return { sukses: `Yang dikirim ke tujuan sekarang: ${NAMA_RINCIAN[rincian]}.` };
}

// ---------------------------------------------------------------------------
// Tujuan
// ---------------------------------------------------------------------------

export async function tambahFormTargetAction(formId: number, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const form = await WaForm.findByPk(formId);
  if (!form) return { error: 'Formulir itu sudah tidak ada.' };

  const jenis: JenisTarget = formData.get('jenis') === 'personal' ? 'personal' : 'grup';
  const label = String(formData.get('label') ?? '').trim();
  const nilai = String(formData.get('nilai') ?? '');

  if (!label) return { error: 'Beri nama tujuan ini, mis. "Grup Apotek" — supaya bisa dikenali di daftar.' };
  if (label.length > 80) return { error: 'Nama tujuan maksimal 80 karakter.' };

  const hasil = parseTarget(jenis, nilai);
  if (!hasil.ok) return { error: hasil.error };

  // Unik per (formulir, tujuan) -- grup yang sama BOLEH dipasang di formulir lain.
  if (await WaFormTarget.findOne({ where: { formId, chatId: hasil.chatId } })) {
    return {
      error:
        'Tujuan itu sudah terpasang di formulir ini. Menambahkannya dua kali membuat tiap jawaban dikabarkan dua kali.',
    };
  }

  const dibuat = await WaFormTarget.create({
    formId,
    jenis: hasil.jenis,
    chatId: hasil.chatId,
    label,
    createdBy: session!.user.username,
    updatedBy: null,
  });
  await logAudit(
    session!.user.username,
    'wa_form_target_create',
    String(dibuat.id),
    `${form.nama} ${hasil.jenis} ${hasil.chatId} (${label})`,
  );
  segarkan();
  return {
    sukses: `Tujuan "${label}" ditambahkan. Kirim pesan uji untuk memastikan pesannya benar-benar sampai — dan untuk melihat sendiri seberapa banyak yang beredar.`,
  };
}

/**
 * Alamatnya sengaja TIDAK bisa disunting -- hanya namanya. Sama seperti
 * `farmasi_target` dan `template_target`: mengubah alamat di tempat membuat
 * riwayat `outbox` yang sudah ada menunjuk baris yang kini berarti grup lain,
 * sehingga "pesan ini dulu dikirim ke mana" berubah jawabannya secara surut.
 */
export async function ubahFormTargetAction(id: number, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await WaFormTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const label = String(formData.get('label') ?? '').trim();
  if (!label) return { error: 'Nama tujuan wajib diisi.' };
  if (label.length > 80) return { error: 'Nama tujuan maksimal 80 karakter.' };

  await row.update({ label, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'wa_form_target_update', String(id), label);
  segarkan();
  return { sukses: 'Nama tujuan diperbarui.' };
}

/**
 * Hapus dan Nonaktifkan SENGAJA tanpa pagar "tujuan aktif terakhir" yang ada di
 * `template_target`.
 *
 * Di sana pagar itu perlu karena mode `tujuan` sudah mencoret pasien sebagai
 * penerima, sehingga membuang tujuan terakhir membuat pemicunya berhenti
 * mengirim ke MANA PUN tanpa satu baris `outbox` pun sebagai jejak. Di sini
 * tidak ada mode yang setara: jawabannya selalu tersimpan ke `wa_form_entry` dan
 * selalu terlihat di tab Masuk, dengan atau tanpa tujuan. Membuang tujuan
 * terakhir cuma mengembalikan perilaku 051 apa adanya, yaitu keadaan yang
 * berjalan berbulan-bulan dan yang tidak menghilangkan satu permintaan pun.
 */
export async function hapusFormTargetAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await WaFormTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await logAudit(
    session!.user.username,
    'wa_form_target_delete',
    String(id),
    `form ${row.formId} ${row.jenis} ${row.chatId} (${row.label})`,
  );
  await row.destroy();
  segarkan();
  return { sukses: `Tujuan "${row.label}" dihapus. Jawaban yang masuk tetap tersimpan dan terlihat di tab Masuk.` };
}

export async function toggleFormTargetAction(id: number, aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await WaFormTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ isActive: aktif, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'wa_form_target_toggle', String(id), aktif ? 'aktif' : 'nonaktif');
  segarkan();
  return { sukses: aktif ? `"${row.label}" diaktifkan.` : `"${row.label}" dinonaktifkan.` };
}

export async function mintaSyncGrupFormulirAction(): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const hasil = await mintaSyncGrup(session!.user.username);
  segarkan();
  // Daftar grup yang sama dipakai beberapa halaman.
  revalidatePath('/farmasi');
  revalidatePath('/template');
  revalidatePath('/pesan-masuk');
  return hasil;
}

// ---------------------------------------------------------------------------
// Kirim uji
// ---------------------------------------------------------------------------

/**
 * Mengirim pesan uji lewat PENYUSUN YANG SAMA dipakai worker, atas JAWABAN
 * SUNGGUHAN yang terakhir masuk.
 *
 * Kalimat contoh yang ditulis di sini akan membuktikan lebih sedikit daripada
 * yang dikira orang yang menekan tombolnya. Dua pertanyaan yang benar-benar
 * ingin dijawab admin adalah "apakah kode grupnya benar" DAN "seberapa banyak
 * yang akan beredar di sana" -- dan yang kedua hanya terjawab kalau yang
 * dikirim persis bentuk yang nanti dikirim worker, berikut setelan rinciannya
 * apa adanya. Pratinjau yang berbeda dari yang sungguhan adalah pratinjau yang
 * menenangkan orang tentang sesuatu yang belum pernah diperiksa.
 *
 * Kode grup yang salah diterima WhatsApp TANPA galat apa pun (dibuktikan
 * langsung saat fitur farmasi dibangun: kiriman ke grup yang tidak ada tetap
 * berstatus `sent`), jadi satu-satunya cara membuktikan sebuah kode benar
 * adalah ada manusia yang melihat pesannya muncul di grup.
 *
 * Memakai `FARMASI_UJI`, bukan `FORMULIR_MASUK`: baris `outbox` pesan uji tidak
 * boleh tercampur dengan pengabaran sungguhan di halaman Antrean dan Ringkasan,
 * lalu ikut terhitung sebagai jawaban formulir yang pernah dikabarkan.
 */
export async function kirimUjiFormTargetAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await WaFormTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const form = await WaForm.findByPk(row.formId);
  if (!form) return { error: 'Formulir itu sudah tidak ada.' };

  const sesi = await WaSession.findByPk(1);
  if (sesi?.status !== 'ready') {
    return { error: 'WhatsApp belum tersambung, jadi pesan uji tidak akan terkirim. Buka halaman Koneksi dulu.' };
  }

  const terakhir = await WaFormEntry.findOne({
    where: { formId: row.formId },
    order: [['id', 'DESC']],
  });

  const rincian = bacaRincian(form.tujuanRincian);

  /**
   * Belum ada satu jawaban pun: yang dikirim adalah kalimat yang MENGATAKAN
   * ITU, bukan contoh karangan. Contoh karangan di sini menyesatkan dua arah
   * sekaligus -- ia memperlihatkan rincian yang belum tentu sama dengan jawaban
   * sungguhan, dan ia menyembunyikan fakta bahwa formulirnya memang belum
   * pernah dipakai.
   */
  const body = terakhir
    ? susunPemberitahuanFormulir(
        {
          formNama: terakhir.formNama,
          waktu: terakhir.createdAt,
          phoneE164: terakhir.phoneE164,
          dariGrup: isGroupAddress(terakhir.chatId),
          jawaban: parseJawaban(terakhir.jawabanJson),
        },
        rincian,
      )
    : `[Formulir] ${form.nama}\n\n` +
      'Pesan uji dari {nama_rs}. Kalau terbaca, tujuan ini sudah benar.\n\n' +
      'Belum ada satu jawaban pun yang masuk lewat formulir ini, jadi belum ada yang bisa diperlihatkan bentuk aslinya.';

  const ctx = await loadFarmasiContext('FARMASI_UJI', body, body);
  await enqueueMessage(
    {
      // Stempel waktu ikut ke dalam kunci supaya tombolnya bisa ditekan
      // BERULANG -- admin yang sedang membetulkan kode grup, atau yang sedang
      // membandingkan ringkas vs lengkap, harus bisa mencoba lagi tanpa
      // ditolak uq_idem.
      idempotencyKey: buildIdempotencyKey('FARMASI_UJI', row.chatId, new Date().toISOString()),
      noRkmMedis: null,
      rawPhone: null,
      chatId: row.chatId,
      eventAt: new Date(),
      vars: {},
    },
    ctx,
  );

  await logAudit(session!.user.username, 'wa_form_target_kirim_uji', String(id), `${form.nama} ${row.chatId}`);
  segarkan();
  return {
    sukses: terakhir
      ? `Pesan uji dimasukkan ke antrean untuk "${row.label}" — isinya jawaban sungguhan yang terakhir masuk, dalam mode ${rincian}. Periksa grupnya.`
      : `Pesan uji dimasukkan ke antrean untuk "${row.label}". Formulir ini belum punya jawaban, jadi yang dikirim baru pemeriksaan alamat.`,
  };
}
