'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/authz';
import { fetchPatientSegment } from '@/khanza/pasienSegment';
import { getHospitalIdentity, formatSqlDate } from '@/khanza/common';
import { findUnknownVariables, BROADCAST_TEMPLATE_VARIABLES } from '@/core/template';
import { segmentScope, PESAN_TANPA_BATAS } from '@/core/segmentScope';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadBroadcastContext, enqueueMessage, identityVars, previewUniqueCodeFooter } from '@/worker/pipeline';
import { periksaBerkasLampiran, periksaPanjangKeterangan, MAX_LAMPIRAN_MB } from '@/core/media';
import { simpanBerkasLampiran } from '@/lib/mediaStorage';
import { BroadcastCampaign, getSettingNumber, logAudit } from '@/models';
import { parseFilters, type RawFilterInput } from './filters';

/**
 * ARCHITECTURE §9.1 pola sama seperti updateTemplateAction: admin-only,
 * validasi sebelum tulis. Bedanya di sini query segmen DIJALANKAN ULANG di
 * server dari filter yang dikirim form (bukan memakai daftar dari klien) --
 * hasil pratinjau di halaman TIDAK PERNAH jadi sumber kebenaran untuk siapa
 * yang benar-benar dikirimi pesan.
 */
export async function sendBroadcastAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const messageBody = String(formData.get('messageBody') ?? '').trim();
  if (!messageBody) return { error: 'Isi pesan wajib diisi.' };

  const unknown = findUnknownVariables(messageBody, BROADCAST_TEMPLATE_VARIABLES);
  if (unknown.length > 0) {
    return { error: `Variabel tidak dikenal untuk broadcast: ${unknown.map((v) => `{${v}}`).join(', ')}` };
  }

  const raw: RawFilterInput = {
    dateFrom: String(formData.get('dateFrom') ?? ''),
    dateTo: String(formData.get('dateTo') ?? ''),
    kab: formData.getAll('kab').map(String),
    kec: formData.getAll('kec').map(String),
    pj: formData.getAll('pj').map(String),
    cari: String(formData.get('cari') ?? ''),
  };
  const filters = parseFilters(raw);
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return { error: 'Tanggal mulai tidak boleh setelah tanggal akhir.' };
  }
  // fetchPatientSegment mengembalikan larik kosong untuk cakupan ini, jadi
  // pesannya akan jatuh ke "tidak ada pasien yang cocok" -- benar hasilnya,
  // tapi menyesatkan sebabnya: filternya bukan terlalu sempit, melainkan tidak
  // ada sama sekali.
  if (segmentScope(filters) === 'tanpa-batas') {
    return { error: PESAN_TANPA_BATAS };
  }

  const recipients = await fetchPatientSegment(filters);
  if (recipients.length === 0) {
    return { error: 'Tidak ada pasien yang cocok dengan filter ini -- tidak ada yang dikirim.' };
  }

  const maxRecipients = await getSettingNumber('broadcast.max_recipients', 500);
  if (recipients.length > maxRecipients) {
    return {
      error: `${recipients.length} pasien cocok, melebihi batas ${maxRecipients} sekali kirim (bisa diubah di Pengaturan). Persempit filter atau kirim bertahap.`,
    };
  }

  // Lampiran diperiksa SEBELUM apa pun ditulis: berkas disimpan hanya setelah
  // seluruh validasi lolos, supaya penolakan tidak meninggalkan berkas yatim.
  const unggahan = formData.get('media');
  const berkas = unggahan instanceof File && unggahan.size > 0 ? unggahan : null;
  let media: { path: string; mime: string; name: string } | null = null;

  if (berkas) {
    const maxMb = await getSettingNumber('broadcast.max_media_mb', MAX_LAMPIRAN_MB);
    const periksa = periksaBerkasLampiran(berkas.name, berkas.type, berkas.size, maxMb);
    if (!periksa.ok) return { error: periksa.error };

    // Panjang keterangan dihitung berikut baris kode pengiriman, karena baris
    // itu ikut terkirim dan ikut memakan jatah batas WhatsApp.
    const footer = (await previewUniqueCodeFooter('pratinjau|panjang')) ?? '';
    const panjangFooter = footer ? footer.length + 2 : 0; // +2 = baris kosong pemisah
    const muat = periksaPanjangKeterangan(messageBody, panjangFooter);
    if (!muat.ok) return { error: muat.error };

    const tersimpan = await simpanBerkasLampiran(berkas);
    if (!tersimpan) return { error: 'Berkas lampiran tidak bisa disimpan.' };
    media = { path: tersimpan.relativePath, mime: tersimpan.mime, name: tersimpan.originalName };
  }

  const identity = await getHospitalIdentity();
  const ctx = await loadBroadcastContext(messageBody);

  const campaign = await BroadcastCampaign.create({
    createdBy: session!.user.username,
    filterJson: JSON.stringify({
      // null = tanpa batas waktu. Jejak audit harus bisa membedakan itu dari
      // jendela tanggal tertentu -- keduanya menghasilkan segmen yang sangat
      // berbeda dari filter yang sama persis selebihnya.
      dateFrom: filters.dateFrom ? formatSqlDate(filters.dateFrom) : null,
      dateTo: filters.dateTo ? formatSqlDate(filters.dateTo) : null,
      kdKab: filters.kdKab,
      kdKec: filters.kdKec,
      kdPj: filters.kdPj,
      cari: filters.cari,
    }),
    messageBody,
    mediaPath: media?.path ?? null,
    mediaMime: media?.mime ?? null,
    mediaName: media?.name ?? null,
    recipientCount: recipients.length,
  });

  const now = new Date();
  for (const row of recipients) {
    await enqueueMessage(
      {
        idempotencyKey: buildIdempotencyKey('BROADCAST', campaign.id, row.no_rkm_medis),
        noRkmMedis: row.no_rkm_medis,
        rawPhone: row.no_tlp,
        eventAt: now,
        kdPoli: row.kd_poli,
        vars: { ...identityVars(identity), nama_pasien: row.nm_pasien ?? '', no_rm: row.no_rkm_medis },
        campaignId: campaign.id,
        media,
      },
      ctx,
    );
  }

  await logAudit(
    session!.user.username,
    'broadcast_send',
    String(campaign.id),
    media ? `${recipients.length} penerima, lampiran ${media.name}` : `${recipients.length} penerima`,
  );
  revalidatePath('/broadcast');
  redirect(`/broadcast?sent=${campaign.id}`);
}
