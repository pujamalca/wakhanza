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
import { appendUniqueCode } from '../src/core/uniqueCode';
import { buildIdempotencyKey } from '../src/core/idempotency';
import { getHospitalIdentity } from '../src/khanza/common';
import { identityVars, loadUniqueCodeTemplate } from '../src/worker/pipeline';
// Pemetaan baris -> variabel WAJIB dipinjam dari worker, bukan ditulis ulang
// di sini. Sebelumnya ditulis ulang, dan penambahan {cara_bayar} langsung
// membuktikan kenapa itu salah: pratinjaunya menampilkan variabel kosong
// sementara worker mengisinya.
import {
  varsQueueReg,
  varsResultReady,
  varsPharmacyReady,
  varsBillingReady,
  varsBooking,
} from '../src/worker/triggerVars';
import { sik } from '../src/db/sik';
import { db } from '../src/db/wakhanza';
import { pollQueueReg } from '../src/khanza/antrian';
import { pollResultReady, type PenunjangJenis } from '../src/khanza/penunjang';
import { pollPharmacyReady } from '../src/khanza/farmasi';
import { pollBillingReady } from '../src/khanza/billing';
import { pollUpcomingBookings } from '../src/khanza/booking';

const SAMPLE_SIZE = 5;
const DISTANT_PAST = new Date('2000-01-01');

/**
 * Diisi sekali di main(). Dibaca lewat fungsi produksi yang sama
 * (loadUniqueCodeTemplate) supaya pratinjau ikut mati saat fitur kode unik
 * dimatikan di Pengaturan -- dryrun tidak boleh menampilkan baris yang tidak
 * akan benar-benar terkirim.
 */
let uniqueCodeTemplate = '';

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
  for (const [i, row] of rows.slice(0, SAMPLE_SIZE).entries()) {
    const preview = await previewPhone(row.noRkmMedis, row.rawPhone);
    const privacy = checkPrivacy({ kdPoli: row.kdPoli, kdJenisPrw: row.kdJenisPrw }, sensitivePoli, sensitiveExam);
    // Kunci idempoten sungguhan dibangun dari kolom alami tiap pemicu (no_rawat
    // dsb.) yang tidak ikut dibawa ke sini, jadi kode di bawah SEBENTUK tapi
    // bukan nilai yang nanti benar-benar terkirim. Nomor urut baris ikut
    // di-seed supaya sifat yang dibuktikan tetap benar: dua pesan berbeda --
    // termasuk dua pesan untuk pasien yang SAMA -- mendapat kode berbeda.
    const body = appendUniqueCode(
      renderTemplate(privacy.safe ? template.body : '(pesan generik privasi)', row.vars),
      buildIdempotencyKey(triggerCode, row.noRkmMedis, i),
      uniqueCodeTemplate,
      // Dry run tidak mengantre apa pun, jadi tidak ada scheduled_at yang bisa
      // dipakai; "sekarang" adalah perkiraan terdekat untuk waktu kirimnya.
      new Date(),
    );
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
  uniqueCodeTemplate = await loadUniqueCodeTemplate();
  console.log(
    uniqueCodeTemplate
      ? `kode unik per pesan: AKTIF (format "${uniqueCodeTemplate}") -- baris terakhir tiap contoh di bawah`
      : 'kode unik per pesan: MATI (dispatch.unique_code_enabled)',
  );

  const queueRows = await pollQueueReg(DISTANT_PAST, lookbackDays);
  await reportSection(
    'QUEUE_REG',
    queueRows.map((r) => ({
      noRkmMedis: r.no_rkm_medis,
      rawPhone: r.no_tlp,
      kdPoli: r.kd_poli,
      vars: { ...idVars, ...varsQueueReg(r) },
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
        vars: { ...idVars, ...varsResultReady(r, jenis) },
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
      vars: { ...idVars, ...varsPharmacyReady(r) },
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
      vars: { ...idVars, ...varsBillingReady(r) },
    })),
    sensitivePoli,
    sensitiveExam,
  );

  const bookings = await pollUpcomingBookings();
  const confirmRows = bookings.filter((b) => b.status === 'Belum');
  const cancelRows = bookings.filter((b) => b.status === 'Batal' || b.status === 'Dokter Berhalangan');
  const bookingVars = (b: (typeof bookings)[number]) => ({ ...idVars, ...varsBooking(b) });
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
