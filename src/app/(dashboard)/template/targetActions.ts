'use server';

import { revalidatePath } from 'next/cache';
import { Template, TemplateTarget, WaSession, logAudit, type TujuanMode } from '@/models';
import { parseTarget, type JenisTarget } from '@/core/farmasiTarget';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadFarmasiContext, enqueueMessage } from '@/worker/pipeline';
import { mintaSyncGrup } from '@/lib/waGroups';
import { requireRole } from '@/lib/authz';

export interface HasilForm {
  error?: string;
  sukses?: string;
}

function segarkan(): void {
  revalidatePath('/template');
}

const MODE_SAH: TujuanMode[] = ['pasien', 'pasien_dan_tujuan', 'tujuan'];

const NAMA_MODE: Record<TujuanMode, string> = {
  pasien: 'hanya pasien',
  pasien_dan_tujuan: 'pasien + tujuan tambahan',
  tujuan: 'hanya tujuan tambahan',
};

// ---------------------------------------------------------------------------
// Mode tujuan
// ---------------------------------------------------------------------------

/**
 * Dicatat ke `audit_log` sebagai peristiwanya SENDIRI, bukan ikut menumpang
 * `template_update`.
 *
 * Alasannya sama seperti `farmasi_toggle` dan `auto_reply_toggle`: inilah momen
 * penerima sebuah notifikasi berubah -- dari nomor pribadi seorang pasien
 * menjadi (atau ditambah) sebuah grup WhatsApp yang keanggotaannya diatur di
 * luar sistem ini. Menenggelamkannya sebagai satu kolom di dalam penyuntingan
 * template membuat perubahan paling berkonsekuensi di halaman ini justru yang
 * paling sulit ditelusuri belakangan.
 */
export async function setTujuanModeAction(triggerCode: string, mode: string): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  if (!MODE_SAH.includes(mode as TujuanMode)) return { error: 'Mode tujuan tidak dikenal.' };
  const modeBaru = mode as TujuanMode;

  const template = await Template.findByPk(triggerCode);
  if (!template) return { error: 'Pemicu tidak ditemukan.' };

  /**
   * Mode yang MELIBATKAN tujuan tambahan ditolak selama belum ada tujuan aktif.
   *
   * Untuk 'tujuan' ini keharusan mutlak: pesannya tidak akan pergi ke mana pun,
   * dan tidak ada satu pun baris `outbox` yang menandainya karena tidak ada
   * baris yang dibuat sama sekali. Untuk 'pasien_dan_tujuan' pesannya memang
   * masih sampai ke pasien, tapi staf yang menyimpannya jelas mengharapkan grup
   * ikut menerima -- membiarkannya tersimpan berarti ia baru tahu berbulan-bulan
   * kemudian bahwa tidak ada yang pernah sampai ke sana.
   */
  if (modeBaru !== 'pasien') {
    const aktif = await TemplateTarget.count({ where: { triggerCode, isActive: true } });
    if (aktif === 0) {
      return {
        error:
          'Belum ada tujuan tambahan yang aktif untuk pemicu ini. Tambahkan tujuannya dulu, baru ubah modenya — ' +
          'kalau tidak, pesannya tidak akan sampai ke grup mana pun.',
      };
    }
  }

  await template.update({ tujuanMode: modeBaru, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'template_tujuan_mode', triggerCode, NAMA_MODE[modeBaru]);
  segarkan();
  return { sukses: `Tujuan pemicu ini sekarang: ${NAMA_MODE[modeBaru]}.` };
}

// ---------------------------------------------------------------------------
// Tujuan tambahan
// ---------------------------------------------------------------------------

export async function tambahTemplateTargetAction(triggerCode: string, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  if (!(await Template.findByPk(triggerCode))) return { error: 'Pemicu tidak ditemukan.' };

  const jenis: JenisTarget = formData.get('jenis') === 'personal' ? 'personal' : 'grup';
  const label = String(formData.get('label') ?? '').trim();
  const nilai = String(formData.get('nilai') ?? '');

  if (!label) return { error: 'Beri nama tujuan ini, mis. "Grup Loket" — supaya bisa dikenali di daftar.' };
  if (label.length > 80) return { error: 'Nama tujuan maksimal 80 karakter.' };

  const hasil = parseTarget(jenis, nilai);
  if (!hasil.ok) return { error: hasil.error };

  // Unik per (pemicu, tujuan) -- grup yang sama BOLEH dipasang di pemicu lain.
  if (await TemplateTarget.findOne({ where: { triggerCode, chatId: hasil.chatId } })) {
    return {
      error: 'Tujuan itu sudah terpasang di pemicu ini. Menambahkannya dua kali membuat tiap kejadian terkirim dua kali.',
    };
  }

  const dibuat = await TemplateTarget.create({
    triggerCode,
    jenis: hasil.jenis,
    chatId: hasil.chatId,
    label,
    createdBy: session!.user.username,
    updatedBy: null,
  });
  await logAudit(
    session!.user.username,
    'template_target_create',
    String(dibuat.id),
    `${triggerCode} ${hasil.jenis} ${hasil.chatId} (${label})`,
  );
  segarkan();
  return {
    sukses: `Tujuan "${label}" ditambahkan. Kirim pesan uji untuk memastikan pesannya benar-benar sampai, lalu ubah mode tujuannya.`,
  };
}

/**
 * Alamatnya sengaja TIDAK bisa disunting -- hanya namanya. Sama seperti
 * `farmasi_target`: mengubah alamat di tempat membuat riwayat `outbox` yang
 * sudah ada menunjuk baris yang kini berarti grup lain, sehingga "pesan ini
 * dulu dikirim ke mana" berubah jawabannya secara surut.
 */
export async function ubahTemplateTargetAction(id: number, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await TemplateTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const label = String(formData.get('label') ?? '').trim();
  if (!label) return { error: 'Nama tujuan wajib diisi.' };
  if (label.length > 80) return { error: 'Nama tujuan maksimal 80 karakter.' };

  await row.update({ label, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'template_target_update', String(id), label);
  segarkan();
  return { sukses: 'Nama tujuan diperbarui.' };
}

export async function hapusTemplateTargetAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await TemplateTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const sisa = await pastikanBukanTujuanTerakhir(row.triggerCode, row.id);
  if (sisa) return sisa;

  await logAudit(
    session!.user.username,
    'template_target_delete',
    String(id),
    `${row.triggerCode} ${row.jenis} ${row.chatId} (${row.label})`,
  );
  await row.destroy();
  segarkan();
  return { sukses: `Tujuan "${row.label}" dihapus.` };
}

export async function toggleTemplateTargetAction(id: number, aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await TemplateTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  if (!aktif) {
    const sisa = await pastikanBukanTujuanTerakhir(row.triggerCode, row.id);
    if (sisa) return sisa;
  }

  await row.update({ isActive: aktif, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'template_target_toggle', String(id), aktif ? 'aktif' : 'nonaktif');
  segarkan();
  return { sukses: aktif ? `"${row.label}" diaktifkan.` : `"${row.label}" dinonaktifkan.` };
}

/**
 * Menolak membuang tujuan AKTIF terakhir selama pemicunya masih disetel
 * 'tujuan'.
 *
 * Tanpa penjagaan ini, satu klik Nonaktifkan membuat pemicunya berhenti
 * mengirim ke mana pun -- bukan ke grup, dan bukan pula ke pasien, karena mode
 * 'tujuan' memang sudah mencoret pasien sebagai penerima. Yang membuatnya mahal
 * adalah bentuk kegagalannya: tidak ada baris `outbox` yang dibuat, jadi tidak
 * ada yang muncul di halaman Antrean maupun Ringkasan. Pemicunya sekadar diam.
 *
 * Pagar yang sama dipakai Hapus dan Nonaktifkan karena keduanya berujung sama;
 * yang membedakan cuma bisa-tidaknya ditarik kembali.
 */
async function pastikanBukanTujuanTerakhir(triggerCode: string, idIni: number): Promise<HasilForm | null> {
  const template = await Template.findByPk(triggerCode);
  if (template?.tujuanMode !== 'tujuan') return null;

  const aktifLain = await TemplateTarget.count({
    where: { triggerCode, isActive: true },
  });
  const row = await TemplateTarget.findByPk(idIni);
  const iniAktif = row?.isActive ?? false;

  if (iniAktif && aktifLain <= 1) {
    return {
      error:
        'Ini tujuan aktif terakhir, sementara pemicunya disetel hanya-tujuan — membuangnya berarti pesannya tidak ' +
        'dikirim ke mana pun, tanpa jejak di halaman Antrean. Ubah mode tujuannya lebih dulu, atau tambahkan tujuan lain.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Daftar grup
// ---------------------------------------------------------------------------

export async function mintaSyncGrupTemplateAction(): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const hasil = await mintaSyncGrup(session!.user.username);
  segarkan();
  // Daftar grup yang sama dipakai tiga halaman.
  revalidatePath('/farmasi');
  revalidatePath('/pesan-masuk');
  return hasil;
}

// ---------------------------------------------------------------------------
// Kirim uji
// ---------------------------------------------------------------------------

/**
 * Tujuan yang tidak pernah dicoba sama saja dengan tidak ada -- kode grup yang
 * salah diterima WhatsApp TANPA galat apa pun (dibuktikan langsung saat fitur
 * farmasi dibangun: kiriman ke grup yang tidak ada tetap berstatus `sent`).
 * Satu-satunya cara membuktikan sebuah kode benar adalah ada manusia yang
 * melihat pesannya muncul di grup.
 *
 * Memakai `loadFarmasiContext('FARMASI_UJI', ...)` — bukan konteks pemicunya
 * sendiri — dan itu disengaja: pesan uji tidak boleh memakai `trigger_code`
 * pemicu sungguhan, karena baris `outbox`-nya akan tercampur dengan notifikasi
 * pasien di halaman Antrean dan Ringkasan, lalu ikut terhitung sebagai
 * pengiriman pemicu itu. `FARMASI_UJI` sudah ada, sudah melewati jam tenang,
 * dan sudah dikenali sebagai kelas uji.
 */
export async function kirimUjiTemplateTargetAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await TemplateTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const sesi = await WaSession.findByPk(1);
  if (sesi?.status !== 'ready') {
    return { error: 'WhatsApp belum tersambung, jadi pesan uji tidak akan terkirim. Buka halaman Koneksi dulu.' };
  }

  const body =
    'Pesan uji dari {nama_rs}.\n\n' +
    `Kalau pesan ini terbaca, berarti tujuan ini sudah benar dan siap menerima notifikasi "${row.triggerCode}".`;

  const ctx = await loadFarmasiContext('FARMASI_UJI', body, body);
  await enqueueMessage(
    {
      // Stempel waktu ikut ke dalam kunci supaya tombolnya bisa ditekan
      // BERULANG -- staf yang sedang membetulkan kode grup harus bisa mencoba
      // lagi tanpa ditolak uq_idem.
      idempotencyKey: buildIdempotencyKey('FARMASI_UJI', row.chatId, new Date().toISOString()),
      noRkmMedis: null,
      rawPhone: null,
      chatId: row.chatId,
      eventAt: new Date(),
      vars: {},
    },
    ctx,
  );

  await logAudit(session!.user.username, 'template_target_kirim_uji', String(id), `${row.triggerCode} ${row.chatId}`);
  segarkan();
  return {
    sukses: `Pesan uji dimasukkan ke antrean untuk "${row.label}". Biasanya sampai dalam beberapa detik — periksa halaman Antrean bila tidak.`,
  };
}
