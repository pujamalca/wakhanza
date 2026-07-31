'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/authz';
import { fetchPatientSegment } from '@/khanza/pasienSegment';
import { getHospitalIdentity, formatSqlDate } from '@/khanza/common';
import { findUnknownVariables, BROADCAST_TEMPLATE_VARIABLES } from '@/core/template';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadBroadcastContext, enqueueMessage, identityVars } from '@/worker/pipeline';
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
  if (filters.dateFrom > filters.dateTo) {
    return { error: 'Tanggal mulai tidak boleh setelah tanggal akhir.' };
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

  const identity = await getHospitalIdentity();
  const ctx = await loadBroadcastContext(messageBody);

  const campaign = await BroadcastCampaign.create({
    createdBy: session!.user.username,
    filterJson: JSON.stringify({
      dateFrom: formatSqlDate(filters.dateFrom),
      dateTo: formatSqlDate(filters.dateTo),
      kdKab: filters.kdKab,
      kdKec: filters.kdKec,
      kdPj: filters.kdPj,
      cari: filters.cari,
    }),
    messageBody,
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
      },
      ctx,
    );
  }

  await logAudit(session!.user.username, 'broadcast_send', String(campaign.id), `${recipients.length} penerima`);
  revalidatePath('/broadcast');
  redirect(`/broadcast?sent=${campaign.id}`);
}
