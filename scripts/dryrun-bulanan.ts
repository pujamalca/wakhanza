/**
 * Pratinjau REKAP BULANAN FARMASI (migrations/046) terhadap database Khanza MANA
 * PUN, berikut pemeriksaan pagar privasinya.
 *
 *   npm run dryrun:bulanan -- [nama-database] [bulan YYYYMM]
 *
 * Tanpa argumen, ia memakai database produksi (`SIK_DB_NAME`) dan bulan yang
 * BENAR-BENAR akan dibaca worker (bulan sebelum bulan berjalan).
 *
 * Untuk menunjuk BULAN saja, nama databasenya tetap harus disebut:
 *
 *   npm run dryrun:bulanan -- alca 202607
 *
 * Bentuk `-- "" 202607` bekerja di bash tapi TIDAK di PowerShell, yang membuang
 * argumen string kosong sebelum Node melihatnya -- sehingga bulannya bergeser
 * jadi nama database dan gagal dengan `ER_DBACCESS_DENIED_ERROR` yang
 * menyesatkan ke arah izin, bukan ke arah argumen.
 *
 * ==========================================================================
 * Kenapa BULAN bisa diserahkan, dan kenapa itu bukan kenyamanan
 * ==========================================================================
 *
 * Rekap ini hanya pernah membaca SATU bulan, dan bulan berjalan selalu setengah
 * jadi. Dijalankan tanggal 1 tanpa argumen, ia membaca bulan lalu -- benar, tapi
 * dijalankan tanggal 31 ia tetap membaca bulan lalu juga, sehingga tidak ada
 * cara memeriksa bulan tertentu saat menelusuri angka yang dipertanyakan staf.
 * Kelas kegagalan yang sama sudah dibayar di `dryrun:kontrol` dan `dryrun:resep`.
 *
 * ==========================================================================
 * Yang WAJIB diperhatikan kalau berkas ini diubah
 * ==========================================================================
 *
 * Nama database di-override SESUDAH `lib/env` selesai memuat `.env` (yang
 * MENIMPA process.env), lalu modul yang membaca konfigurasi diimpor SECARA
 * DINAMIS. Mengubah impor di dalam main() menjadi `import` biasa di puncak
 * berkas membuat override-nya tidak berpengaruh sama sekali -- dan gejalanya
 * bukan galat, melainkan hasil yang diam-diam berasal dari database yang salah.
 *
 * TIDAK menulis ke outbox, TIDAK mengirim apa pun.
 */
import './../src/lib/env';

const dbArg = process.argv[2];
const bulanArg = process.argv[3];
if (dbArg) process.env.SIK_DB_NAME = dbArg;

async function main() {
  const { sikDbConfig } = await import('../src/lib/env');
  const { sik } = await import('../src/db/sik');
  const { db } = await import('../src/db/wakhanza');
  const { rekapFarmasiBulanan } = await import('../src/khanza/farmasiBulanan');
  const { gabungBulanan } = await import('../src/core/farmasiBulanan');
  const { bulanRekap, labelBulan, bacaTanggalKirim } = await import('../src/core/rekapBulan');
  const { susunVarsBulanan, TRIGGER_FARMASI_BULANAN, muatTargetBulanan } = await import(
    '../src/worker/farmasiBulananRunner'
  );
  const { renderTemplate } = await import('../src/core/template');
  const { formatRupiah } = await import('../src/core/notaBarang');
  const { getSetting, getSettingBool } = await import('../src/models');
  const { identityVars, loadUniqueCodeTemplate } = await import('../src/worker/pipeline');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { appendUniqueCode } = await import('../src/core/uniqueCode');
  const { buildIdempotencyKey } = await import('../src/core/idempotency');

  console.log(
    `=== dryrun:bulanan terhadap database "${sikDbConfig().database}" -- tidak menulis apa pun ===\n`,
  );

  try {
    const sekarang = new Date();
    const bulan = bulanArg ?? bulanRekap(sekarang);

    const aktif = await getSettingBool('farmasi.bulanan_enabled', false);
    const tglRaw = (await getSetting('farmasi.bulanan_tanggal', '3')) ?? '3';
    const jam = (await getSetting('farmasi.bulanan_jam', '08:00')) ?? '08:00';
    const penanda = (await getSetting('farmasi.bulanan_last_run', '')) ?? '';
    const tujuan = await muatTargetBulanan();

    console.log(`  sakelar farmasi.bulanan_enabled : ${aktif ? 'MENYALA' : 'MATI'}`);
    console.log(
      `  jadwal kirim                    : tanggal ${tglRaw} pukul ${jam}` +
        (bacaTanggalKirim(tglRaw) === null ? '  [TANGGAL TIDAK SAH -- worker akan memakai bawaan 3]' : ''),
    );
    console.log(`  terakhir dikirim                : ${penanda || '(belum pernah)'}`);
    console.log(
      `  tujuan bercentang "bulanan"     : ${tujuan.length === 0 ? 'BELUM ADA -- rekap tidak akan pergi ke mana pun' : tujuan.map((t) => t.label).join(', ')}`,
    );
    console.log(
      `  bulan yang dibaca               : ${bulan} (${labelBulan(bulan)})` +
        (bulanArg ? '  [diserahkan lewat argumen]' : '  [bulan sebelum bulan berjalan]'),
    );

    const agregat = await rekapFarmasiBulanan(bulan);

    /**
     * PAGAR PRIVASI, diperiksa pada `Object.keys()` baris HASILNYA -- bukan
     * dengan membaca SQL.
     *
     * Pemeriksaan terpenting di skrip ini, dan di sini ia memikul lebih daripada
     * di `dryrun:resep`: rekap bulanan MENYEBUT `reg_periksa` (satu kali, di
     * `buildBulananPasienSql()`), jadi klaim "yang keluar cuma satu angka" harus
     * dibuktikan alih-alih dipercaya. `no_rkm_medis` ada di daftar terlarang
     * justru karena ia dipakai sebagai argumen `COUNT(DISTINCT ...)` -- kalau ia
     * suatu saat ikut jadi kolom hasil, inilah yang berbunyi.
     *
     * `no_rawat` ikut dilarang dan itu BUKAN berlebihan: ia kunci menuju
     * `reg_periksa`, jadi kehadirannya berarti jalan menuju identitas pasien
     * sudah terbuka walau namanya belum ikut terbaca.
     *
     * `keterangan` ikut karena `penjualan` memuatnya -- teks bebas yang diketik
     * kasir, terukur memuat nama orang pada sebagian barisnya (migrations/040).
     */
    const TERLARANG = [
      'no_rkm_medis',
      'nm_pasien',
      'no_rawat',
      'kd_poli',
      'nm_poli',
      'kode_brng',
      'nama_brng',
      'aturan_pakai',
      'nama_racik',
      'keterangan',
      // Kedua puluh kolom hasil telaah -- penilaian klinis atas resep seseorang.
      // Yang dibaca cuma ADA-TIDAKNYA barisnya, tidak pernah isinya.
      'resep_tepat_dosis',
      'resep_interaksi_obat',
      'resep_kontra_indikasi_obat',
      'resep_identifikasi_pasien',
    ];
    const kolom = [
      ...new Set(
        Object.values(agregat)
          .filter((b): b is Record<string, unknown> => b !== null && typeof b === 'object')
          .flatMap((b) => Object.keys(b)),
      ),
    ];
    const bocor = kolom.filter((k) => TERLARANG.includes(k));
    console.log(`\n  kolom yang benar-benar terbaca: ${kolom.length > 0 ? kolom.join(', ') : '(tidak ada baris)'}`);
    console.log(
      bocor.length === 0
        ? '  [ok] PAGAR PRIVASI -- tidak satu pun kolom pasien, obat, dosis, atau hasil telaah terbaca'
        : `  [BOCOR] kolom terlarang terbaca: ${bocor.join(', ')} -- lihat komentar pembuka khanza/farmasiBulanan.ts`,
    );
    if (bocor.length > 0) process.exitCode = 1;

    const r = gabungBulanan(bulan, agregat);
    console.log(
      `\n  ${r.jmlResep} resep untuk ${r.jmlPasien} pasien (${r.jmlKunjungan} kunjungan); ` +
        `${r.jmlBaris} baris obat, ${r.jmlRacikan} racikan, nilai ${formatRupiah(r.nilaiObat)}`,
    );
    console.log(
      `  belum divalidasi ${r.jmlBelumValidasi}, belum diserahkan ${r.jmlBelumSerah}, belum ditelaah ${r.jmlTanpaTelaah}`,
    );
    console.log(
      `  pengadaan ${r.pengadaan.jml} (${formatRupiah(r.pengadaan.nilai)}), ` +
        `pemesanan ${r.pemesanan.jml} (${formatRupiah(r.pemesanan.nilai)}), ` +
        `hibah ${r.hibah.jml} (${formatRupiah(r.hibah.nilai)}), ` +
        `penjualan ${r.penjualan.jml} (${formatRupiah(r.penjualan.nilai)})`,
    );

    /**
     * Janji yang dibaca orang dari pesannya, diperiksa di sini juga: ia
     * menjumlahkan dua angka di layar dan mengharapkan angka ketiga. Kalau suatu
     * saat `jmlDiserahkan`/`jmlAdaTelaah` berhenti diturunkan, ini yang berbunyi.
     */
    const genapSerah = r.jmlDiserahkan + r.jmlBelumSerah === r.jmlResep;
    const genapTelaah = r.jmlAdaTelaah + r.jmlTanpaTelaah === r.jmlResep;
    console.log(
      genapSerah
        ? '  [ok] diserahkan + belum diserahkan = jumlah resep'
        : `  [SALAH] ${r.jmlDiserahkan} + ${r.jmlBelumSerah} != ${r.jmlResep}`,
    );
    console.log(
      genapTelaah
        ? '  [ok] ditelaah + belum ditelaah = jumlah resep'
        : `  [SALAH] ${r.jmlAdaTelaah} + ${r.jmlTanpaTelaah} != ${r.jmlResep}`,
    );
    if (!genapSerah || !genapTelaah) process.exitCode = 1;

    const identitas = await getHospitalIdentity();
    const idVars = identityVars(identitas);
    const kodeTemplate = await loadUniqueCodeTemplate();

    const body = (await getSetting('farmasi.template_bulanan', '')) ?? '';
    const bodyKosong = (await getSetting('farmasi.template_bulanan_kosong', '')) ?? '';
    const dipakai = r.kosong ? (bodyKosong.trim() ? bodyKosong : null) : body;

    if (dipakai === null) {
      console.log(
        '\n  Bulan itu tidak ada SATU PUN kegiatan farmasi (nol resep, nol pengadaan, nol pemesanan,',
      );
      console.log('  nol hibah, nol penjualan), dan "pesan saat kosong" dibiarkan kosong -- jadi sistem sengaja DIAM.');
      console.log('  Untuk melihat bentuk pesannya, jalankan ulang dengan bulan lain:');
      console.log('    npm run dryrun:bulanan -- alca 202607');
    } else if (!dipakai.trim()) {
      console.log('\n  (isi pesan rekap masih kosong -- isi di /farmasi?tab=bulanan)');
    } else {
      const teks = appendUniqueCode(
        renderTemplate(dipakai, { ...idVars, ...susunVarsBulanan(r, sekarang) }),
        buildIdempotencyKey(TRIGGER_FARMASI_BULANAN, bulan, 'contoh@g.us'),
        kodeTemplate,
        sekarang,
      );
      console.log(`\n${teks}\n`);
    }
  } finally {
    await sik.close();
    await db.close();
  }
}

void main();
