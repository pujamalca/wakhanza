/**
 * IMPLEMENTATION_PLAN Fase 2 & 5.1: "cetak apa yang AKAN dikirim, tanpa
 * mengirim" -- satu-satunya cara mengarahkan poller ke salinan data rumah
 * sakit sungguhan dan memeriksa hasilnya tanpa risiko mengirim WhatsApp
 * keliru. TIDAK menulis ke outbox, TIDAK memajukan poll_cursor, TIDAK
 * mengirim apa pun -- hanya query sik (read-only) + pratinjau render.
 */
import { PatientContact, Template, getSettingNumber, getSettingJson } from '../src/models';
import { normalizePhone, type PhoneResult } from '../src/core/phone';
import { checkPrivacy } from '../src/core/privacy';
import { renderTemplate, type TemplateVariable } from '../src/core/template';
import { getHospitalIdentity } from '../src/khanza/common';
import { identityVars } from '../src/worker/pipeline';
import { sik } from '../src/db/sik';
import { db } from '../src/db/wakhanza';
import { pollQueueReg } from '../src/khanza/antrian';
import { pollResultReady, type PenunjangJenis } from '../src/khanza/penunjang';
import { pollPharmacyReady } from '../src/khanza/farmasi';
import { pollBillingReady } from '../src/khanza/billing';
import { pollUpcomingBookings } from '../src/khanza/booking';

const SAMPLE_SIZE = 5;
const DISTANT_PAST = new Date('2000-01-01');

interface Preview {
  phoneE164: string | null;
  note: string;
}

async function previewPhone(noRkmMedis: string, rawPhone: string | null): Promise<Preview> {
  const existing = await PatientContact.findByPk(noRkmMedis);
  if (existing?.source === 'manual') {
    return { phoneE164: existing.phoneE164, note: 'koreksi manual tersimpan' };
  }
  const result: PhoneResult = normalizePhone(rawPhone);
  return result.ok ? { phoneE164: result.value, note: 'auto' } : { phoneE164: null, note: `ditolak (${result.reason})` };
}

async function reportSection(
  label: string,
  rows: Array<{
    noRkmMedis: string;
    rawPhone: string | null;
    kdPoli?: string | null;
    kdJenisPrw?: string | string[] | null;
    vars: Partial<Record<TemplateVariable, string>>;
  }>,
  sensitivePoli: string[],
  sensitiveExam: string[],
  triggerCode: string = label, // beberapa label tampilan (mis. "RESULT_READY(lab)") berbeda dari trigger_code template sungguhan
): Promise<void> {
  console.log(`\n=== ${label}: ${rows.length} baris kandidat ===`);
  if (rows.length === 0) return;

  const template = await Template.findByPk(triggerCode);
  if (!template) {
    console.log('  (belum ada template untuk pemicu ini -- akan dilewati oleh worker sungguhan)');
    return;
  }
  if (!template.isActive) {
    console.log('  (template nonaktif -- akan dilewati oleh worker sungguhan)');
  }

  let noContact = 0;
  let sensitive = 0;

  for (const row of rows) {
    const preview = await previewPhone(row.noRkmMedis, row.rawPhone);
    if (!preview.phoneE164) noContact++;
    const privacy = checkPrivacy({ kdPoli: row.kdPoli, kdJenisPrw: row.kdJenisPrw }, sensitivePoli, sensitiveExam);
    if (!privacy.safe) sensitive++;
  }
  console.log(`  tanpa nomor valid : ${noContact} / ${rows.length}`);
  console.log(`  layanan sensitif  : ${sensitive} / ${rows.length}`);

  console.log(`  contoh (maks ${SAMPLE_SIZE}):`);
  for (const row of rows.slice(0, SAMPLE_SIZE)) {
    const preview = await previewPhone(row.noRkmMedis, row.rawPhone);
    const privacy = checkPrivacy({ kdPoli: row.kdPoli, kdJenisPrw: row.kdJenisPrw }, sensitivePoli, sensitiveExam);
    const body = renderTemplate(privacy.safe ? template.body : '(pesan generik privasi)', row.vars);
    console.log(`  - RM ${row.noRkmMedis} -> ${preview.phoneE164 ?? 'TIDAK ADA NOMOR'} [${preview.note}]${privacy.safe ? '' : ' [PRIVASI: diganti generik]'}`);
    console.log(`      "${body}"`);
  }
}

async function main() {
  console.log('=== poll:dryrun -- TIDAK menulis ke outbox, TIDAK memajukan cursor, TIDAK mengirim apa pun ===');

  const lookbackDays = await getSettingNumber('polling.lookback_days', 30);
  const sensitivePoli = await getSettingJson<string[]>('privacy.sensitive_poli_codes', []);
  const sensitiveExam = await getSettingJson<string[]>('privacy.sensitive_exam_codes', []);
  const identity = await getHospitalIdentity();
  const idVars = identityVars(identity);

  const queueRows = await pollQueueReg(DISTANT_PAST, lookbackDays);
  await reportSection(
    'QUEUE_REG',
    queueRows.map((r) => ({
      noRkmMedis: r.no_rkm_medis,
      rawPhone: r.no_tlp,
      kdPoli: r.kd_poli,
      vars: { ...idVars, nama_pasien: r.nm_pasien ?? '', no_rm: r.no_rkm_medis, no_antrian: r.no_reg, nama_poli: r.nm_poli ?? '', nama_dokter: r.nm_dokter ?? '', tanggal: r.tgl_registrasi, jam: r.jam_reg },
    })),
    sensitivePoli,
    sensitiveExam,
  );

  for (const jenis of ['lab', 'radiologi'] as PenunjangJenis[]) {
    const rows = await pollResultReady(jenis, DISTANT_PAST, lookbackDays);
    await reportSection(
      `RESULT_READY(${jenis})`,
      rows.map((r) => ({
        noRkmMedis: r.no_rkm_medis,
        rawPhone: r.no_tlp,
        kdPoli: r.kd_poli,
        kdJenisPrw: r.kd_jenis_prw_list?.split(',') ?? [],
        vars: { ...idVars, nama_pasien: r.nm_pasien ?? '', no_rm: r.no_rkm_medis, nama_poli: r.nm_poli ?? '', tanggal: r.tgl_periksa, jam: r.jam_terakhir, jenis_layanan: jenis === 'lab' ? 'Laboratorium' : 'Radiologi' },
      })),
      sensitivePoli,
      sensitiveExam,
      'RESULT_READY',
    );
  }

  const pharmacyRows = await pollPharmacyReady(DISTANT_PAST, lookbackDays);
  await reportSection(
    'PHARMACY_READY',
    pharmacyRows.map((r) => ({
      noRkmMedis: r.no_rkm_medis,
      rawPhone: r.no_tlp,
      kdPoli: r.kd_poli,
      vars: { ...idVars, nama_pasien: r.nm_pasien ?? '', no_rm: r.no_rkm_medis, nama_poli: r.nm_poli ?? '', tanggal: r.tgl_penyerahan, jam: r.jam_penyerahan, jenis_layanan: 'Farmasi' },
    })),
    sensitivePoli,
    sensitiveExam,
  );

  const billingRows = await pollBillingReady(DISTANT_PAST, lookbackDays);
  await reportSection(
    'BILLING_READY',
    billingRows.map((r) => ({
      noRkmMedis: r.no_rkm_medis,
      rawPhone: r.no_tlp,
      kdPoli: r.kd_poli,
      vars: { ...idVars, nama_pasien: r.nm_pasien ?? '', no_rm: r.no_rkm_medis, tanggal: r.tanggal, jam: r.jam, jenis_layanan: 'Kasir' },
    })),
    sensitivePoli,
    sensitiveExam,
  );

  const bookings = await pollUpcomingBookings();
  const confirmRows = bookings.filter((b) => b.status === 'Belum');
  const cancelRows = bookings.filter((b) => b.status === 'Batal' || b.status === 'Dokter Berhalangan');
  const bookingVars = (b: (typeof bookings)[number]) => ({
    ...idVars,
    nama_pasien: b.nm_pasien ?? '',
    no_rm: b.no_rkm_medis,
    nama_poli: b.nm_poli ?? '',
    nama_dokter: b.nm_dokter ?? '',
    tanggal: b.tanggal_periksa,
    jam: b.jam_booking ?? '',
  });
  await reportSection(
    'BOOK_CONFIRM',
    confirmRows.map((r) => ({ noRkmMedis: r.no_rkm_medis, rawPhone: r.no_tlp, kdPoli: r.kd_poli, vars: bookingVars(r) })),
    sensitivePoli,
    sensitiveExam,
  );
  await reportSection(
    'BOOK_CANCEL',
    cancelRows.map((r) => ({ noRkmMedis: r.no_rkm_medis, rawPhone: r.no_tlp, kdPoli: r.kd_poli, vars: bookingVars(r) })),
    sensitivePoli,
    sensitiveExam,
  );

  console.log('\n=== selesai -- tidak ada perubahan di outbox, poll_cursor, atau sik ===');

  await sik.close();
  await db.close();
}

main().catch((err) => {
  console.error('[poll:dryrun] gagal:', err);
  process.exit(1);
});
