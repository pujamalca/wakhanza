/**
 * Pratinjau pemicu SURAT PEMESANAN terhadap database Khanza MANA PUN, bukan
 * hanya yang sedang dipakai produksi.
 *
 * Kenapa terpisah dari `poll:dryrun`: `surat_pemesanan_medis` di database
 * produksi mesin ini berisi TEPAT SATU baris, bertanggal Maret 2024. Cukup untuk
 * membuktikan query-nya benar, jauh dari cukup untuk melihat bentuk pesannya
 * pada nota yang berisi banyak barang, terpecah, atau tanpa rincian sama sekali.
 * Alasan yang sama persis melahirkan `dryrun:bpjs` dan `dryrun:hibah`.
 *
 * Di sini taruhannya lebih tinggi daripada pada hibah, dan itu sebabnya skrip ini
 * wajib dijalankan terhadap database yang BERISI sebelum fiturnya dipercaya:
 * pemangkas `no_pemesanan` memakai tahun DUA digit (`SPM` + `YYMMDD`), berbeda
 * dari `PG`/`HO` yang memakai `YYYYMMDD`. Pemangkas yang salah tidak menghasilkan
 * galat apa pun -- ia mengembalikan nol baris, selamanya, dan terlihat persis
 * seperti tabel yang memang kosong.
 *
 *   npm run dryrun:pemesanan -- [nama-database]
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
  const { pollPemesananJendela, ambilDetailPemesanan } = await import('../src/khanza/pemesanan');
  const { kelompokkanDetailPemesanan } = await import('../src/core/pemesanan');
  const { susunVarsPemesanan, TRIGGER_PEMESANAN } = await import('../src/worker/pemesananRunner');
  const { hitungJendelaPindai } = await import('../src/core/jendelaPindai');
  const { renderTemplate } = await import('../src/core/template');
  const { getSetting, getSettingBool, getSettingNumber } = await import('../src/models');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { identityVars, loadUniqueCodeTemplate } = await import('../src/worker/pipeline');
  const { appendUniqueCode } = await import('../src/core/uniqueCode');
  const { buildIdempotencyKey } = await import('../src/core/idempotency');

  console.log(`=== dryrun:pemesanan terhadap database "${sikDbConfig().database}" -- tidak menulis apa pun ===\n`);

  const kutip = (teks: string) => teks.replace(/^/gm, '  | ');

  try {
    const sertakanHarga = await getSettingBool('farmasi.pemesanan_harga', true);
    const lookback = await getSettingNumber('farmasi.pemesanan_lookback_hari', 7);

    /**
     * DUA jendela dicetak, dan itu disengaja.
     *
     * Yang pertama adalah jendela yang benar-benar dipakai worker -- jawaban atas
     * "apakah ada yang akan terkirim sekarang". Yang kedua jauh lebih lebar dan
     * menjawab pertanyaan yang berbeda: "apakah pemangkas prefiksnya benar".
     * Tanpa yang kedua, nol baris pada jendela sempit tidak bisa dibedakan dari
     * prefiks yang salah -- dan prefiks di sinilah satu-satunya tempat yang bisa
     * membuat seluruh fitur ini diam tanpa galat.
     */
    const jendela = hitungJendelaPindai(new Date(), lookback, null);
    const sempit = await pollPemesananJendela(jendela.dari, jendela.sampai);
    console.log(`Jendela worker (${jendela.dari} .. ${jendela.sampai}): ${sempit.length} baris`);

    const luas = await pollPemesananJendela('2000-01-01', '2099-12-31');
    console.log(`Seluruh riwayat (2000-01-01 .. 2099-12-31): ${luas.length} baris`);
    console.log(
      `Harga PER BARANG ikut dibaca: ${sertakanHarga ? 'ya' : 'TIDAK (farmasi.pemesanan_harga mati)'}` +
        '  -- kelima angka header selalu dibaca\n',
    );

    if (luas.length === 0) {
      console.log('Tidak ada satu pun baris surat pemesanan di database ini.');
      console.log('Itu bukan galat -- rumah sakit yang belum pernah memakai menu "Surat Pemesanan');
      console.log('Obat & BHP" di Khanza memang tidak punya barisnya. Arahkan ke database lain');
      console.log('untuk melihat bentuk pesannya:  npm run dryrun:pemesanan -- <nama-database-lain>');
      console.log('');
      console.log('CATATAN: jangan menyimpulkan "kosong" dari information_schema.TABLE_ROWS --');
      console.log('nilainya PERKIRAAN pada InnoDB dan membulat ke nol pada tabel kecil. Angka di');
      console.log('atas adalah hitungan sungguhan lewat query yang sama dipakai worker.');
      return;
    }

    const body = (await getSetting('farmasi.template_pemesanan', '')) ?? '';
    const idVars = identityVars(await getHospitalIdentity());
    const kodeTemplate = await loadUniqueCodeTemplate();

    // Yang dicetak adalah baris TERAKHIR -- yang paling mungkin dikenali orang
    // yang baru saja memasukkannya, dan karena itu paling berguna untuk
    // dicocokkan dengan layar Khanza.
    const contoh = luas.slice(-2);
    const detail = await ambilDetailPemesanan(
      contoh.map((h) => h.no_pemesanan),
      sertakanHarga,
    );
    const perNomor = kelompokkanDetailPemesanan(detail);

    for (const h of contoh) {
      const rincian = perNomor.get(h.no_pemesanan) ?? [];
      console.log(`\n  --- ${h.no_pemesanan} | ${h.tanggal} | ${h.status} | ${rincian.length} barang ---`);
      /**
       * Pesanan tanpa rincian dilaporkan apa adanya, bukan dirender.
       *
       * Worker MELEWATINYA (lihat `pemesananRunner.ts`), jadi mencetak notanya di
       * sini akan menampilkan pesan yang tidak akan pernah terkirim. Bentuk
       * datanya nyata: sembilan dari sepuluh header di arsip `sik` begitu.
       */
      if (rincian.length === 0) {
        console.log('  | (tanpa satu baris rincian pun -- worker MELEWATI pesanan seperti ini)');
        continue;
      }
      const bagian = susunVarsPemesanan(h, rincian, new Date());
      for (const [i, vars] of bagian.entries()) {
        const kunci = buildIdempotencyKey(TRIGGER_PEMESANAN, h.no_pemesanan, 'contoh@g.us');
        console.log(
          kutip(appendUniqueCode(renderTemplate(body, { ...idVars, ...vars }), kunci, kodeTemplate, new Date())),
        );
        if (i < bagian.length - 1) console.log('  | ...');
      }
    }

    /**
     * Pagar privasi diperiksa pada OBJEK BARISNYA, bukan dengan membaca SQL.
     * Kolom yang tidak ada di sini tidak mungkin bocor lewat template mana pun --
     * dan saat `farmasi.pemesanan_harga` mati, daftar ini yang membuktikan kolom
     * harganya memang tidak pernah sampai ke proses ini.
     */
    console.log(`\n  kolom header yang benar-benar terbaca : ${Object.keys(luas[0] ?? {}).join(', ')}`);
    console.log(`  kolom rincian yang benar-benar terbaca: ${Object.keys(detail[0] ?? {}).join(', ')}`);

    /**
     * Pemeriksaan prefiks, dicetak sebagai angka supaya tidak perlu dipercaya
     * begitu saja: kalau pemangkasnya keliru memakai YYYYMMDD, jendela luas di
     * atas sudah akan mengembalikan nol. Yang ini menjawab pertanyaan berikutnya
     * -- apakah tanggal yang tersandi di nomornya memang cocok dengan kolom
     * `tanggal`, yang menentukan apakah jendela sempit boleh dipercaya.
     */
    let cocok = 0;
    let beda = 0;
    for (const h of luas) {
      const dariNomor = h.no_pemesanan.slice(3, 9); // YYMMDD
      const dariKolom = (h.tanggal ?? '').replace(/-/g, '').slice(2);
      if (dariNomor === dariKolom) cocok++;
      else beda++;
    }
    console.log(`\n  prefiks nomor vs kolom tanggal: ${cocok} cocok, ${beda} berbeda (dari ${luas.length})`);
  } finally {
    await sik.close();
    await db.close();
  }
}

main().catch((err) => {
  console.error('[dryrun:pemesanan] gagal:', err);
  process.exit(1);
});
