/**
 * Pratinjau pemicu KONTROL_ULANG (pengingat surat kontrol NON-BPJS) terhadap
 * database Khanza MANA PUN, dan terhadap TANGGAL mana pun.
 *
 * Dua alasan berkas ini terpisah dari `poll:dryrun`, dan keduanya tentang
 * pembedaan yang sama: memisahkan "query-nya salah" dari "memang tidak ada
 * yang jatuh tempo".
 *
 * 1. `skdp_bpjs` KOSONG di database produksi (`alca`). Terhadap sana,
 *    satu-satunya "bukti" yang bisa didapat adalah nol baris. Alasan yang sama
 *    persis melahirkan `dryrun:bpjs` dan `dryrun:hibah`.
 *
 * 2. Pemicunya HARIAN dan menyasar tanggal `hari ini + N`. Arsip yang berisi
 *    riwayat surat kontrol menyimpan tanggal-tanggal LAMPAU, jadi menjalankan
 *    pratinjau apa adanya terhadapnya juga menghasilkan nol baris -- benar,
 *    dan sama sekali tidak informatif. Karena itu tanggal acuannya bisa
 *    diserahkan sebagai argumen.
 *
 *   npm run dryrun:kontrol -- [nama-database] [tanggal-acuan YYYY-MM-DD]
 *
 * Tanpa argumen, ia memakai database produksi dan hari ini -- yang justru
 * berguna sebagai pemeriksaan sebelum mengaktifkan templatenya: kalau di sana
 * nol, pemicunya memang belum akan mengirim apa pun.
 *
 * Ia mencetak DUA bagian: jendela worker yang sesungguhnya (H-N dari tanggal
 * acuan) DAN seluruh riwayat tabelnya. Tanpa yang kedua, "belum ada yang jatuh
 * tempo" dan "tabelnya memang belum pernah berisi" terbaca sama persis.
 *
 * Yang WAJIB diperhatikan kalau berkas ini diubah: nama database di-override
 * SESUDAH `lib/env` selesai memuat `.env` (yang MENIMPA process.env), lalu modul
 * yang membaca konfigurasi diimpor SECARA DINAMIS. Mengubah impor di dalam
 * main() menjadi `import` biasa di puncak berkas membuat override-nya tidak
 * berpengaruh sama sekali -- dan gejalanya bukan galat, melainkan hasil yang
 * diam-diam berasal dari database yang salah.
 *
 * TIDAK menulis ke outbox, TIDAK mengirim apa pun, TIDAK menyentuh `.env`.
 */
import './../src/lib/env';

const dbArg = process.argv[2];
if (dbArg) process.env.SIK_DB_NAME = dbArg;
const tanggalArg = process.argv[3];

async function main() {
  const { sikDbConfig } = await import('../src/lib/env');
  const { sik, sikSelect } = await import('../src/db/sik');
  const { db } = await import('../src/db/wakhanza');
  const { pollKontrolUlang } = await import('../src/khanza/kontrolUlang');
  const { varsKontrolUlang, TRIGGER_KONTROL_ULANG } = await import('../src/worker/kontrolUlangRunner');
  const { bacaHariSebelum, sasaranKontrol } = await import('../src/core/bpjs');
  const { renderTemplate } = await import('../src/core/template');
  const { checkPrivacy } = await import('../src/core/privacy');
  const { Template, getSetting, getSettingJson } = await import('../src/models');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { identityVars, loadUniqueCodeTemplate } = await import('../src/worker/pipeline');
  const { appendUniqueCode } = await import('../src/core/uniqueCode');
  const { buildIdempotencyKey } = await import('../src/core/idempotency');
  const { normalizePhone } = await import('../src/core/phone');

  const acuan = tanggalArg ? new Date(`${tanggalArg}T12:00:00`) : new Date();
  if (Number.isNaN(acuan.getTime())) throw new Error(`tanggal acuan tidak sah: ${tanggalArg}`);

  console.log(`=== dryrun:kontrol terhadap database "${sikDbConfig().database}" -- tidak menulis apa pun ===`);
  console.log(`tanggal acuan: ${acuan.toISOString().slice(0, 10)}${tanggalArg ? ' (dari argumen)' : ' (hari ini)'}\n`);

  const tpl = await Template.findByPk(TRIGGER_KONTROL_ULANG);
  console.log(`baris template : ${tpl ? `ADA, is_active=${tpl.isActive ? 1 : 0}, tujuan_mode=${tpl.tujuanMode}` : 'TIDAK ADA -- migrasi 032 belum jalan'}`);
  const body = tpl?.body ?? '';

  const rawHari = (await getSetting('schedule.kontrol_ulang_hari_sebelum', '1')) ?? '1';
  const hariSebelum = bacaHariSebelum(rawHari);
  const sasaran = sasaranKontrol(hariSebelum, acuan);
  console.log(`hari sebelum   : "${rawHari}" -> menyasar tanggal ${sasaran.map((s) => s.tanggal).join(', ') || '(tidak ada)'}\n`);

  // --- Bagian 1: seluruh riwayat, supaya "kosong" bisa dibedakan -------------
  const total = await sikSelect<{ n: number; awal: string | null; akhir: string | null }>(
    'SELECT COUNT(*) AS n, MIN(DATE(tanggal_datang)) AS awal, MAX(DATE(tanggal_datang)) AS akhir FROM skdp_bpjs',
  );
  const ringkas = total[0];
  console.log('--- seluruh isi skdp_bpjs (BUKAN yang akan dikirim) ---');
  if (!ringkas || Number(ringkas.n) === 0) {
    console.log('  0 baris -- menu "Surat Kontrol" di Khanza belum pernah dipakai di database ini.');
    console.log('  Query-nya tidak bisa dibuktikan dari sini; arahkan ke database lain yang berisi.\n');
  } else {
    console.log(`  ${ringkas.n} baris, tanggal kontrol ${ringkas.awal} s/d ${ringkas.akhir}\n`);
  }

  // --- Bagian 2: yang benar-benar akan dikirim ------------------------------
  const rows = await pollKontrolUlang(sasaran.map((s) => s.tanggal));
  console.log(`--- KONTROL_ULANG: ${rows.length} baris kandidat pada tanggal acuan ---`);
  if (rows.length === 0) {
    console.log('  (tidak ada surat kontrol berstatus "Menunggu" yang jatuh persis di tanggal sasaran)');
    console.log('  Coba tanggal lain: npm run dryrun:kontrol -- <database> <YYYY-MM-DD>\n');
  }

  if (rows.length > 0) {
    // Dibuktikan pada OBJEK barisnya, bukan dengan membaca SQL: keenam kolom
    // klinis (`diagnosa`, `terapi`, `alasan1/2`, `rtl1/2`) harus benar-benar
    // tidak ada di sini, bukan sekadar tidak dirender.
    console.log(`  kolom yang benar-benar terbaca: ${Object.keys(rows[0]!).join(', ')}`);
    const bocor = ['diagnosa', 'terapi', 'alasan1', 'alasan2', 'rtl1', 'rtl2'].filter((k) => k in rows[0]!);
    console.log(`  kolom klinis yang ikut terbaca: ${bocor.length === 0 ? 'TIDAK ADA (benar)' : `BOCOR -> ${bocor.join(', ')}`}\n`);

    const identity = await getHospitalIdentity();
    const idVars = identityVars(identity);
    const uniqueCodeTemplate = await loadUniqueCodeTemplate();
    const sensitivePoli = await getSettingJson<string[]>('privacy.sensitive_poli_codes', []);
    const sensitiveExam = await getSettingJson<string[]>('privacy.sensitive_exam_codes', []);
    const selisih = new Map(sasaran.map((s) => [s.tanggal, s.hariSebelum]));

    let tanpaNomor = 0;
    let tanpaPoli = 0;
    for (const r of rows) {
      if (!normalizePhone(r.no_tlp).ok) tanpaNomor++;
      if (!r.kd_poli) tanpaPoli++;
    }
    console.log(`  tanpa nomor sah  : ${tanpaNomor} / ${rows.length}`);
    console.log(`  tanpa poli       : ${tanpaPoli} / ${rows.length}  (poli hanya ada bila Khanza membuatkan bookingnya)`);
    console.log(`  contoh (maks 3):`);

    for (const r of rows.slice(0, 3)) {
      const hari = selisih.get(r.tgl_kontrol) ?? 0;
      const privacy = checkPrivacy({ kdPoli: r.kd_poli }, sensitivePoli, sensitiveExam);
      const nomor = normalizePhone(r.no_tlp);
      const kunci = buildIdempotencyKey(
        TRIGGER_KONTROL_ULANG,
        `${r.tahun}-${r.no_antrian}`,
        r.tgl_kontrol,
        String(hari),
      );
      const teks = appendUniqueCode(
        renderTemplate(privacy.safe ? body : '(pesan generik privasi)', { ...idVars, ...varsKontrolUlang(r, hari) }),
        kunci,
        uniqueCodeTemplate,
        new Date(),
      );
      console.log(
        `  - surat ${r.tahun}/${r.no_antrian} RM ${r.no_rkm_medis ?? '-'} -> ${nomor.ok ? nomor.value : 'TIDAK ADA NOMOR'}` +
          `${privacy.safe ? '' : ' [PRIVASI: diganti generik]'}`,
      );
      console.log(teks.replace(/^/gm, '      | '));
    }
  }

  console.log('\n=== selesai -- tidak ada perubahan di outbox, app_setting, atau sik ===');
  await sik.close();
  await db.close();
}

main().catch((err) => {
  console.error('[dryrun:kontrol] gagal:', err);
  process.exit(1);
});
