/**
 * Pratinjau pemicu HIBAH terhadap database Khanza MANA PUN, bukan hanya yang
 * sedang dipakai produksi.
 *
 * Kenapa terpisah dari `poll:dryrun`, dan kenapa ini BUKAN kenyamanan melainkan
 * satu-satunya cara membuktikan fiturnya: `hibah_obat_bhp` KOSONG di kedua
 * database di mesin ini. Terhadap `alca`, satu-satunya "bukti" yang bisa didapat
 * adalah nol baris -- yang sama sekali tidak membedakan "query-nya benar dan
 * rumah sakit ini memang belum pernah mencatat hibah" dari "query-nya salah".
 * Alasan yang sama persis melahirkan `dryrun:bpjs`.
 *
 *   npm run dryrun:hibah -- [nama-database]
 *
 * Tanpa argumen, ia memakai database produksi (`SIK_DB_NAME`) -- yang justru
 * berguna sebagai pemeriksaan sebelum menyalakan sakelarnya: kalau di sana nol,
 * fiturnya memang belum akan mengirim apa pun.
 *
 * Yang WAJIB diperhatikan kalau berkas ini diubah: nama database di-override
 * SESUDAH `lib/env` selesai memuat `.env` (yang MENIMPA process.env), lalu modul
 * yang membaca konfigurasi diimpor SECARA DINAMIS. Mengubah impor di dalam
 * main() menjadi `import` biasa di puncak berkas membuat override-nya tidak
 * berpengaruh sama sekali -- dan gejalanya bukan galat, melainkan hasil yang
 * diam-diam berasal dari database yang salah.
 *
 * TIDAK menulis ke outbox, TIDAK mengirim apa pun. `.env` tidak disentuh, jadi
 * worker yang sedang berjalan tidak terpengaruh.
 */
import './../src/lib/env';

const dbArg = process.argv[2];
if (dbArg) process.env.SIK_DB_NAME = dbArg;

async function main() {
  const { sikDbConfig } = await import('../src/lib/env');
  const { sik } = await import('../src/db/sik');
  const { db } = await import('../src/db/wakhanza');
  const { pollHibahJendela, ambilDetailHibah } = await import('../src/khanza/hibah');
  const { kelompokkanDetailHibah } = await import('../src/core/hibah');
  const { susunVarsHibah, TRIGGER_HIBAH } = await import('../src/worker/hibahRunner');
  const { hitungJendelaPindai } = await import('../src/core/jendelaPindai');
  const { renderTemplate } = await import('../src/core/template');
  const { getSetting, getSettingBool, getSettingNumber } = await import('../src/models');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { identityVars, loadUniqueCodeTemplate } = await import('../src/worker/pipeline');
  const { appendUniqueCode } = await import('../src/core/uniqueCode');
  const { buildIdempotencyKey } = await import('../src/core/idempotency');

  console.log(`=== dryrun:hibah terhadap database "${sikDbConfig().database}" -- tidak menulis apa pun ===\n`);

  const kutip = (teks: string) => teks.replace(/^/gm, '  | ');

  try {
    const sertakanNilai = await getSettingBool('farmasi.hibah_nilai', true);
    const lookback = await getSettingNumber('farmasi.hibah_lookback_hari', 7);

    /**
     * DUA jendela dicetak, dan itu disengaja.
     *
     * Yang pertama adalah jendela yang benar-benar dipakai worker -- jawaban atas
     * "apakah ada yang akan terkirim sekarang". Yang kedua jauh lebih lebar dan
     * menjawab pertanyaan yang berbeda: "apakah query-nya benar-benar bisa
     * membaca tabel ini". Tanpa yang kedua, nol baris pada jendela sempit tidak
     * bisa dibedakan dari query yang rusak -- persis kekaburan yang membuat
     * skrip ini ada.
     */
    const jendela = hitungJendelaPindai(new Date(), lookback, null);
    const sempit = await pollHibahJendela(jendela.dari, jendela.sampai);
    console.log(`Jendela worker (${jendela.dari} .. ${jendela.sampai}): ${sempit.length} baris`);

    const luas = await pollHibahJendela('2000-01-01', '2099-12-31');
    console.log(`Seluruh riwayat (2000-01-01 .. 2099-12-31): ${luas.length} baris`);
    console.log(
      `Nilai PER BARANG ikut dibaca: ${sertakanNilai ? 'ya' : 'TIDAK (farmasi.hibah_nilai mati)'}` +
        '  -- kedua total header selalu dibaca\n',
    );

    if (luas.length === 0) {
      console.log('Tidak ada satu pun baris hibah di database ini.');
      console.log('Itu bukan galat -- rumah sakit yang belum pernah memakai menu "Hibah Obat & BHP"');
      console.log('di Khanza memang tidak punya barisnya. Arahkan ke database lain untuk melihat');
      console.log('bentuk pesannya:  npm run dryrun:hibah -- <nama-database-lain>');
      return;
    }

    const body = (await getSetting('farmasi.template_hibah', '')) ?? '';
    const idVars = identityVars(await getHospitalIdentity());
    const kodeTemplate = await loadUniqueCodeTemplate();

    // Yang dicetak adalah baris TERAKHIR -- yang paling mungkin dikenali orang
    // yang baru saja memasukkannya, dan karena itu paling berguna untuk
    // dicocokkan dengan layar Khanza.
    const contoh = luas.slice(-2);
    const detail = await ambilDetailHibah(
      contoh.map((h) => h.no_hibah),
      sertakanNilai,
    );
    const perNomor = kelompokkanDetailHibah(detail);

    for (const h of contoh) {
      const rincian = perNomor.get(h.no_hibah) ?? [];
      console.log(`\n  --- ${h.no_hibah} | ${h.tgl_hibah} | ${rincian.length} barang ---`);
      const bagian = susunVarsHibah(h, rincian, new Date());
      for (const [i, vars] of bagian.entries()) {
        const kunci = buildIdempotencyKey(TRIGGER_HIBAH, h.no_hibah, 'contoh@g.us');
        console.log(kutip(appendUniqueCode(renderTemplate(body, { ...idVars, ...vars }), kunci, kodeTemplate, new Date())));
        if (i < bagian.length - 1) console.log('  | ...');
      }
    }

    /**
     * Pagar privasi diperiksa pada OBJEK BARISNYA, bukan dengan membaca SQL.
     * Kolom yang tidak ada di sini tidak mungkin bocor lewat template mana pun --
     * dan saat `farmasi.hibah_nilai` mati, daftar ini yang membuktikan kolom
     * nilainya memang tidak pernah sampai ke proses ini.
     */
    console.log(`\n  kolom header yang benar-benar terbaca : ${Object.keys(luas[0] ?? {}).join(', ')}`);
    console.log(`  kolom rincian yang benar-benar terbaca: ${Object.keys(detail[0] ?? {}).join(', ')}`);
  } finally {
    await sik.close();
    await db.close();
  }
}

main().catch((err) => {
  console.error('[dryrun:hibah] gagal:', err);
  process.exit(1);
});
