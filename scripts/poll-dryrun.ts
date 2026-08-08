/**
 * IMPLEMENTATION_PLAN Fase 2 & 5.1: "cetak apa yang AKAN dikirim, tanpa
 * mengirim" -- satu-satunya cara mengarahkan poller ke salinan data rumah
 * sakit sungguhan dan memeriksa hasilnya tanpa risiko mengirim WhatsApp
 * keliru. TIDAK menulis ke outbox, TIDAK memajukan poll_cursor, TIDAK
 * mengirim apa pun -- hanya query sik (read-only) + pratinjau render.
 */
import { PatientContact, Template, getSetting, getSettingNumber, getSettingJson } from '../src/models';
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
  varsPermintaan,
} from '../src/worker/triggerVars';
import { sik } from '../src/db/sik';
import { db } from '../src/db/wakhanza';
import { pollQueueReg } from '../src/khanza/antrian';
import { pollResultReady, type PenunjangJenis } from '../src/khanza/penunjang';
import { pollPharmacyReady } from '../src/khanza/farmasi';
import { pollBillingReady } from '../src/khanza/billing';
import { pollUpcomingBookings } from '../src/khanza/booking';
import { pollPermintaan, type PermintaanJenis } from '../src/khanza/permintaanPenunjang';
import { pollBpjsBatal } from '../src/khanza/bpjsBatal';
import { pollBpjsKontrol } from '../src/khanza/bpjsKontrol';
import { varsBatal, varsKontrol } from '../src/worker/bpjsRunner';
import { pollKontrolUlang } from '../src/khanza/kontrolUlang';
import { varsKontrolUlang } from '../src/worker/kontrolUlangRunner';
import { pollKontrolTerbit } from '../src/khanza/kontrolTerbit';
import { varsKontrolTerbit } from '../src/worker/kontrolTerbitRunner';
import { hitungJendelaPindai } from '../src/core/jendelaPindai';
import { bacaHariSebelum, sasaranKontrol } from '../src/core/bpjs';

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
): Promise<void> {
  // Label bagian = kode pemicunya, tanpa kekecualian. Dulu ada parameter
  // `triggerCode` terpisah karena hasil penunjang tampil sebagai
  // "RESULT_READY(lab)"/"RESULT_READY(radiologi)" sementara templatenya satu
  // baris bernama RESULT_READY. Sejak migrations/034 kodenya memang dua
  // (LAB_RESULT/RAD_RESULT), jadi kekecualiannya hilang -- dan parameter
  // dengan nilai bawaan yang tidak dipakai siapa pun adalah persis tempat
  // pratinjau dan produksi mulai menyimpang tanpa satu pun galat.
  const triggerCode = label;
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

/**
 * BPJS berdiri terpisah dari reportSection() di atas karena isi pesannya
 * TIDAK berasal dari tabel `template` melainkan dari `app_setting` -- persis
 * seperti notifikasi farmasi. `Template.findByPk('BPJS_BATAL')` akan selalu
 * mengembalikan null dan seluruh bagiannya dilaporkan "belum ada template".
 *
 * Yang penerimanya STAF (BPJS_BATAL) tidak diperiksa nomornya sama sekali:
 * tujuannya `chat_id`, dan menampilkan kolom "tanpa nomor valid" untuknya akan
 * membuat pembacanya menyimpulkan pesan-pesan itu gagal terkirim.
 */
async function reportBpjs(
  sensitivePoli: string[],
  sensitiveExam: string[],
  idVars: Partial<Record<TemplateVariable, string>>,
): Promise<void> {
  const rawHari = (await getSetting('bpjs.kontrol_hari_sebelum', '1')) ?? '1';
  const hariSebelum = bacaHariSebelum(rawHari);
  const sasaran = sasaranKontrol(hariSebelum, new Date());

  // --- Pembatalan Mobile JKN -> loket ---
  const batalRows = await pollBpjsBatal(DISTANT_PAST);
  console.log(`\n=== BPJS_BATAL: ${batalRows.length} baris kandidat (tujuan: GRUP/PETUGAS, bukan pasien) ===`);
  if (batalRows.length > 0) {
    const body = (await getSetting('bpjs.template_batal', '')) ?? '';
    const generik = (await getSetting('bpjs.template_batal_generic', '')) ?? '';
    let sensitif = 0;
    for (const r of batalRows) {
      if (!checkPrivacy({ kdPoli: r.kd_poli }, sensitivePoli, sensitiveExam).safe) sensitif++;
    }
    console.log(`  poli sensitif     : ${sensitif} / ${batalRows.length}`);
    console.log(`  contoh (maks ${SAMPLE_SIZE}):`);
    for (const [i, r] of batalRows.slice(0, SAMPLE_SIZE).entries()) {
      const privacy = checkPrivacy({ kdPoli: r.kd_poli }, sensitivePoli, sensitiveExam);
      const teks = appendUniqueCode(
        renderTemplate(privacy.safe ? body : generik, { ...idVars, ...varsBatal(r) }),
        buildIdempotencyKey('BPJS_BATAL', r.nobooking, i),
        uniqueCodeTemplate,
        new Date(),
      );
      console.log(`  - booking ${r.nobooking} (poli ${r.kd_poli ?? '-'})${privacy.safe ? '' : ' [PRIVASI: diganti generik]'}`);
      console.log(`      "${teks}"`);
    }
  }

  // --- Pengingat surat kontrol -> pasien ---
  const kontrolRows = await pollBpjsKontrol(sasaran.map((s) => s.tanggal));
  console.log(
    `\n=== BPJS_KONTROL: ${kontrolRows.length} baris kandidat (H-${rawHari} -> tanggal ${sasaran.map((s) => s.tanggal).join(', ')}) ===`,
  );
  if (kontrolRows.length === 0) {
    console.log('  (tidak ada surat kontrol yang tanggal rencananya jatuh persis di situ hari ini)');
    return;
  }

  const body = (await getSetting('bpjs.template_kontrol', '')) ?? '';
  const selisih = new Map(sasaran.map((s) => [s.tanggal, s.hariSebelum]));
  let noContact = 0;
  let diselamatkanSep = 0;
  for (const r of kontrolRows) {
    const utama = await previewPhone(r.no_rkm_medis ?? '', r.no_tlp);
    if (!utama.phoneE164) {
      // Cadangan SEP -- lihat nomorUntukKontrol() di worker/bpjsRunner.ts.
      if (normalizePhone(r.notelep).ok) diselamatkanSep++;
      else noContact++;
    }
  }
  console.log(`  tanpa nomor valid : ${noContact} / ${kontrolRows.length}`);
  console.log(`  diselamatkan SEP  : ${diselamatkanSep} / ${kontrolRows.length}`);
  console.log(`  contoh (maks ${SAMPLE_SIZE}):`);
  for (const r of kontrolRows.slice(0, SAMPLE_SIZE)) {
    const hari = selisih.get(r.tgl_rencana) ?? 0;
    const utama = await previewPhone(r.no_rkm_medis ?? '', r.no_tlp);
    const sep = normalizePhone(r.notelep);
    const nomor = utama.phoneE164 ?? (sep.ok ? sep.value : null);
    const asal = utama.phoneE164 ? utama.note : sep.ok ? 'cadangan dari SEP' : 'tidak ada';
    const privacy = checkPrivacy({ kdPoli: r.kd_poli }, sensitivePoli, sensitiveExam);
    const teks = appendUniqueCode(
      renderTemplate(privacy.safe ? body : '(pesan generik privasi)', { ...idVars, ...varsKontrol(r, hari) }),
      buildIdempotencyKey('BPJS_KONTROL', r.no_surat, r.tgl_rencana, String(hari)),
      uniqueCodeTemplate,
      new Date(),
    );
    console.log(`  - RM ${r.no_rkm_medis ?? '-'} -> ${nomor ?? 'TIDAK ADA NOMOR'} [${asal}]${privacy.safe ? '' : ' [PRIVASI: diganti generik]'}`);
    console.log(`      "${teks}"`);
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

  // PERMINTAAN sebelum HASIL, mengikuti urutan kejadiannya di dunia nyata.
  // Keempatnya berkode per jenis sejak migrations/034 (LAB_REQUEST/RAD_REQUEST
  // dan LAB_RESULT/RAD_RESULT), jadi keempat bagian di bawah berlabel persis
  // seperti kode pemicunya.
  for (const jenis of ['lab', 'radiologi'] as PermintaanJenis[]) {
    const rows = await pollPermintaan(jenis, DISTANT_PAST, lookbackDays);
    await reportSection(
      jenis === 'lab' ? 'LAB_REQUEST' : 'RAD_REQUEST',
      rows.map((r) => ({
        noRkmMedis: r.no_rkm_medis,
        rawPhone: r.no_tlp,
        kdPoli: r.kd_poli,
        kdJenisPrw: r.kd_jenis_prw_list?.split(',') ?? [],
        vars: { ...idVars, ...varsPermintaan(r, jenis) },
      })),
      sensitivePoli,
      sensitiveExam,
    );
  }

  for (const jenis of ['lab', 'radiologi'] as PenunjangJenis[]) {
    const rows = await pollResultReady(jenis, DISTANT_PAST, lookbackDays);
    await reportSection(
      jenis === 'lab' ? 'LAB_RESULT' : 'RAD_RESULT',
      rows.map((r) => ({
        noRkmMedis: r.no_rkm_medis,
        rawPhone: r.no_tlp,
        kdPoli: r.kd_poli,
        kdJenisPrw: r.kd_jenis_prw_list?.split(',') ?? [],
        vars: { ...idVars, ...varsResultReady(r, jenis) },
      })),
      sensitivePoli,
      sensitiveExam,
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

  /**
   * Pengingat surat kontrol NON-BPJS.
   *
   * Sasarannya dihitung dari setelan yang SAMA yang dipakai worker
   * (`schedule.kontrol_ulang_hari_sebelum` -> `sasaranKontrol`), bukan dari
   * jendela lookback seperti pemicu di atasnya -- ini pemicu harian H-N, dan
   * pratinjau yang memakai jendela berbeda dari produksi akan menampilkan baris
   * yang tidak akan pernah dikirim.
   */
  const rawHariKontrol = (await getSetting('schedule.kontrol_ulang_hari_sebelum', '1')) ?? '1';
  const sasaranKu = sasaranKontrol(bacaHariSebelum(rawHariKontrol), new Date());
  const selisihKu = new Map(sasaranKu.map((s) => [s.tanggal, s.hariSebelum]));
  const kontrolUlangRows = await pollKontrolUlang(sasaranKu.map((s) => s.tanggal));
  console.log(`\n--- KONTROL_ULANG menyasar tanggal: ${sasaranKu.map((s) => s.tanggal).join(', ') || '(tidak ada)'} ---`);
  await reportSection(
    'KONTROL_ULANG',
    kontrolUlangRows.map((r) => ({
      noRkmMedis: r.no_rkm_medis ?? '',
      rawPhone: r.no_tlp,
      kdPoli: r.kd_poli,
      vars: { ...idVars, ...varsKontrolUlang(r, selisihKu.get(r.tgl_kontrol) ?? 0) },
    })),
    sensitivePoli,
    sensitiveExam,
  );

  /**
   * Surat kontrol DITERBITKAN -- jendela pindainya, bukan sasaran H-N.
   * Lantai aktivasinya sengaja TIDAK diterapkan di sini: pratinjau yang
   * menyembunyikan baris justru pada pemicu yang belum pernah menyala membuat
   * staf tidak bisa melihat apa pun sebelum memutuskan menyalakannya.
   */
  const lookbackTerbit = await getSettingNumber('schedule.kontrol_terbit_lookback_hari', 3);
  const jendelaTerbit = hitungJendelaPindai(new Date(), lookbackTerbit, null);
  const terbitRows = await pollKontrolTerbit(jendelaTerbit.dari, jendelaTerbit.sampai);
  console.log(`\n--- KONTROL_TERBIT jendela surat: ${jendelaTerbit.dari} s/d ${jendelaTerbit.sampai} (lantai aktivasi diabaikan di pratinjau) ---`);
  await reportSection(
    'KONTROL_TERBIT',
    terbitRows.map((r) => ({
      noRkmMedis: r.no_rkm_medis ?? '',
      rawPhone: r.no_tlp,
      kdPoli: r.kd_poli,
      vars: { ...idVars, ...varsKontrolTerbit(r) },
    })),
    sensitivePoli,
    sensitiveExam,
  );

  await reportBpjs(sensitivePoli, sensitiveExam, idVars);

  console.log('\n=== selesai -- tidak ada perubahan di outbox, poll_cursor, atau sik ===');

  await sik.close();
  await db.close();
}

main().catch((err) => {
  console.error('[poll:dryrun] gagal:', err);
  process.exit(1);
});
