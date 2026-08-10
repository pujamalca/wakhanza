import { PatientContact, OptOut, getSettingJson } from '@/models';
import { normalizePhone } from '@/core/phone';
import { checkPrivacy } from '@/core/privacy';
import type { PatientSegmentRow } from '@/khanza/pasienSegment';

export interface SegmentPreviewRow {
  row: PatientSegmentRow;
  phoneE164: string | null;
  safe: boolean;
}

export interface SegmentSummary {
  total: number;
  noContact: number;
  optedOut: number;
  sensitive: number;
  reachable: number;
  preview: SegmentPreviewRow[];
}

export const PREVIEW_LIMIT = 30;

/**
 * Sama seperti scripts/poll-dryrun.ts's previewPhone -- baca saja lewat
 * PatientContact.findByPk + normalizePhone langsung, TIDAK PERNAH menulis
 * (resolvePhone yang mengupsert 'auto' dipakai hanya saat benar-benar
 * enqueue di actions.ts, bukan di sini). Dibatch, bukan per-baris, karena
 * bisa sampai ribuan baris dalam satu pratinjau.
 */
export async function summarizeSegment(
  rows: PatientSegmentRow[],
  /**
   * Bisa dilonggarkan untuk mode "hanya yang dipilih": di sana tabelnya bukan
   * cuplikan sebuah segmen melainkan DAFTAR PENERIMANYA, dan daftar penerima
   * yang dipotong di 30 adalah daftar yang menyembunyikan orang ke-31 dari
   * satu-satunya layar tempat ia bisa dibatalkan.
   */
  previewLimit: number = PREVIEW_LIMIT,
): Promise<SegmentSummary> {
  const [contacts, sensitivePoli, sensitiveExam] = await Promise.all([
    rows.length > 0 ? PatientContact.findAll({ where: { noRkmMedis: rows.map((r) => r.no_rkm_medis) } }) : [],
    getSettingJson<string[]>('privacy.sensitive_poli_codes', []),
    getSettingJson<string[]>('privacy.sensitive_exam_codes', []),
  ]);
  const contactMap = new Map(contacts.map((c) => [c.noRkmMedis, c]));

  const phones: (string | null)[] = rows.map((row) => {
    const existing = contactMap.get(row.no_rkm_medis);
    if (existing?.source === 'manual') return existing.phoneE164;
    const result = normalizePhone(row.no_tlp);
    return result.ok ? result.value : null;
  });

  const distinctPhones = [...new Set(phones.filter((p): p is string => !!p))];
  const optOuts = distinctPhones.length > 0 ? await OptOut.findAll({ where: { phoneE164: distinctPhones } }) : [];
  const optedOutSet = new Set(optOuts.map((o) => o.phoneE164));

  let noContact = 0;
  let optedOut = 0;
  let sensitive = 0;
  const preview: SegmentPreviewRow[] = [];

  rows.forEach((row, i) => {
    const phoneE164 = phones[i] ?? null;
    const privacy = checkPrivacy({ kdPoli: row.kd_poli }, sensitivePoli, sensitiveExam);
    if (!phoneE164) noContact++;
    else if (optedOutSet.has(phoneE164)) optedOut++;
    if (!privacy.safe) sensitive++;
    if (preview.length < previewLimit) preview.push({ row, phoneE164, safe: privacy.safe });
  });

  return { total: rows.length, noContact, optedOut, sensitive, reachable: rows.length - noContact - optedOut, preview };
}
