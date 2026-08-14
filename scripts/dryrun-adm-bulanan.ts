/**
 * Pratinjau REKAP BULANAN ADMINISTRASI (migrations/047) terhadap database Khanza
 * MANA PUN, berikut pemeriksaan pagar privasinya.
 *
 *   npm run dryrun:adm-bulanan -- [nama-database] [bulan YYYYMM]
 *
 * Tanpa argumen, ia memakai database produksi (`SIK_DB_NAME`) dan bulan yang
 * BENAR-BENAR akan dibaca worker (bulan sebelum bulan berjalan).
 *
 * Untuk menunjuk BULAN saja, nama databasenya tetap harus disebut:
 *
 *   npm run dryrun:adm-bulanan -- alca 202607
 *
 * Bentuk `-- "" 202607` bekerja di bash tapi TIDAK di PowerShell, yang membuang
 * argumen string kosong sebelum Node melihatnya -- sehingga bulannya bergeser
 * jadi nama database dan gagal dengan `ER_DBACCESS_DENIED_ERROR` yang
 * menyesatkan ke arah izin, bukan ke arah argumen.
 *
 * ==========================================================================
 * Kenapa pemeriksaan privasi di sini MEMIKUL lebih daripada di dryrun lain
 * ==========================================================================
 *
 * `dryrun:bulanan` (farmasi) memeriksa query yang berangkat dari `resep_obat` dan
 * menyebut `reg_periksa` tepat sekali. Yang ini berangkat DARI `reg_periksa` --
 * tabel yang memuat `no_rkm_medis`, `kd_poli`, `p_jawab`, dan `almt_pj` sekaligus
 * -- dan menyentuh empat tabel rekam medis lewat `EXISTS`. Klaim "yang keluar cuma
 * angka" karena itu harus DIBUKTIKAN pada objek barisnya, bukan dipercaya dari
 * membaca SQL.
 *
 * Skrip ini keluar dengan kode 1 bila ada satu saja kolom terlarang terbaca,
 * supaya ia bisa dipasang sebagai gerbang alih-alih cuma dibaca orang.
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
  const { rekapAdministrasiBulanan } = await import('../src/khanza/administrasiBulanan');
  const { gabungAdmBulanan } = await import('../src/core/administrasiBulanan');
  const { bulanRekap, labelBulan, bacaTanggalKirim } = await import('../src/core/rekapBulan');
  const { susunVarsAdmBulanan, TRIGGER_ADMINISTRASI_BULANAN, muatTargetAdmBulanan } = await import(
    '../src/worker/administrasiBulananRunner'
  );
  const { renderTemplate } = await import('../src/core/template');
  const { getSetting, getSettingBool } = await import('../src/models');
  const { identityVars, loadUniqueCodeTemplate } = await import('../src/worker/pipeline');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { appendUniqueCode } = await import('../src/core/uniqueCode');
  const { buildIdempotencyKey } = await import('../src/core/idempotency');

  console.log(
    `=== dryrun:adm-bulanan terhadap database "${sikDbConfig().database}" -- tidak menulis apa pun ===\n`,
  );

  try {
    const sekarang = new Date();
    const bulan = bulanArg ?? bulanRekap(sekarang);

    const aktif = await getSettingBool('administrasi.bulanan_enabled', false);
    const tglRaw = (await getSetting('administrasi.bulanan_tanggal', '3')) ?? '3';
    const jam = (await getSetting('administrasi.bulanan_jam', '08:00')) ?? '08:00';
    const penanda = (await getSetting('administrasi.bulanan_last_run', '')) ?? '';
    const tujuan = await muatTargetAdmBulanan();

    console.log(`  sakelar administrasi.bulanan_enabled : ${aktif ? 'MENYALA' : 'MATI'}`);
    console.log(
      `  jadwal kirim                         : tanggal ${tglRaw} pukul ${jam}` +
        (bacaTanggalKirim(tglRaw) === null ? '  [TANGGAL TIDAK SAH -- worker akan memakai bawaan 3]' : ''),
    );
    console.log(`  terakhir dikirim                     : ${penanda || '(belum pernah)'}`);
    console.log(
      `  tujuan bercentang "bulanan"          : ${tujuan.length === 0 ? 'BELUM ADA -- rekap tidak akan pergi ke mana pun' : tujuan.map((t) => t.label).join(', ')}`,
    );
    console.log(
      `  bulan yang dibaca                    : ${bulan} (${labelBulan(bulan)})` +
        (bulanArg ? '  [diserahkan lewat argumen]' : '  [bulan sebelum bulan berjalan]'),
    );

    const agregat = await rekapAdministrasiBulanan(bulan);

    /**
     * PAGAR PRIVASI, diperiksa pada `Object.keys()` baris HASILNYA -- bukan
     * dengan membaca SQL.
     *
     * `no_rkm_medis` ada di daftar terlarang justru karena ia BOLEH dipakai
     * sebagai argumen `COUNT(DISTINCT ...)` dan sebagai `GROUP BY` di dalam tabel
     * turunan. Kalau ia suatu saat ikut jadi kolom hasil, inilah yang berbunyi.
     *
     * `no_rawat` ikut dilarang dan itu BUKAN berlebihan: ia kunci menuju seorang
     * pasien, jadi kehadirannya berarti jalannya sudah terbuka walau namanya
     * belum ikut terbaca.
     *
     * Keempat kolom klinis di bawahnya berasal dari tabel yang disentuh lewat
     * `EXISTS` -- dan justru itu intinya: `EXISTS` menghasilkan boolean, jadi
     * kehadiran salah satunya di sini berarti seseorang mengubahnya jadi JOIN.
     */
    const TERLARANG = [
      'no_rkm_medis',
      'nm_pasien',
      'no_rawat',
      'kd_poli',
      'nm_poli',
      'p_jawab',
      'almt_pj',
      // pemeriksaan_ralan -- SOAPIE, teks bebas yang diketik dokter
      'keluhan',
      'pemeriksaan',
      'penilaian',
      'evaluasi',
      'instruksi',
      'rtl',
      // diagnosa_pasien / resume_pasien
      'kd_penyakit',
      'diagnosa_utama',
      'kd_diagnosa_utama',
      'keluhan_utama',
      // penilaian_awal_keperawatan_ralan
      'alergi',
      'rpd',
      'skala_nyeri',
      'status_psiko',
      // skdp_bpjs / bridging_surat_kontrol_bpjs
      'diagnosa',
      'terapi',
      'status_prb',
      'HBA1C',
    ];

    /**
     * `caraBayar` sengaja ikut diperiksa walau ia LARIK, bukan satu baris.
     *
     * Ia satu-satunya agregat yang memang mengambil sebuah NAMA (`png_jawab`),
     * jadi ia yang paling mungkin dilebarkan diam-diam -- "sekalian ambil
     * `kd_poli` supaya bisa dipecah per poli" adalah satu baris yang tidak
     * menghasilkan galat apa pun.
     */
    const kolom = [
      ...new Set(
        Object.values(agregat)
          .flatMap((b) => (Array.isArray(b) ? b : [b]))
          .filter((b): b is Record<string, unknown> => b !== null && typeof b === 'object')
          .flatMap((b) => Object.keys(b)),
      ),
    ];
    const bocor = kolom.filter((k) => TERLARANG.includes(k));
    console.log(`\n  kolom yang benar-benar terbaca: ${kolom.length > 0 ? kolom.join(', ') : '(tidak ada baris)'}`);
    console.log(
      bocor.length === 0
        ? '  [ok] PAGAR PRIVASI -- tidak satu pun kolom identitas, poli, atau isi rekam medis terbaca'
        : `  [BOCOR] kolom terlarang terbaca: ${bocor.join(', ')} -- lihat komentar pembuka khanza/administrasiBulanan.ts`,
    );
    if (bocor.length > 0) process.exitCode = 1;

    const r = gabungAdmBulanan(bulan, agregat);
    console.log(
      `\n  ${r.jmlKunjungan} kunjungan dari ${r.jmlPasien} pasien; ` +
        `${r.jmlBaru} baru, ${r.jmlLama} lama, ${r.jmlBatal} batal`,
    );
    console.log(
      `  berulang ${r.jmlBerulang} pasien (${r.jmlKunjunganBerulang} kunjungan); ` +
        `belum closing billing ${r.jmlBelumBayar}`,
    );
    console.log(
      `  berkas terisi -- resep ${r.jmlAdaResep}, SOAPIE ${r.jmlAdaSoapie}, diagnosa ${r.jmlAdaDiagnosa}, ` +
        `resume ${r.jmlAdaResume}, asesmen ${r.jmlBaruAdaAsesmen}/${r.jmlBaru}`,
    );
    console.log(`  surat sakit ${r.jmlSuratSakit}, surat kontrol ${r.jmlSuratKontrol}`);
    console.log(
      `  cara bayar    : ${r.caraBayar.length === 0 ? '(tidak ada)' : r.caraBayar.map((b) => `${b.nama || b.kode} ${b.kunjungan}`).join(', ')}`,
    );

    /**
     * Janji yang dibaca orang dari pesannya, diperiksa di sini juga: ia
     * menjumlahkan dua angka di layar dan mengharapkan angka ketiga. Kalau suatu
     * saat ketiganya berhenti diturunkan, ini yang berbunyi.
     */
    const genap: [string, boolean, string][] = [
      ['baru + lama = kunjungan', r.jmlBaru + r.jmlLama === r.jmlKunjungan, `${r.jmlBaru} + ${r.jmlLama} != ${r.jmlKunjungan}`],
      [
        'ada resep + tanpa resep = kunjungan',
        r.jmlAdaResep + r.jmlTanpaResep === r.jmlKunjungan,
        `${r.jmlAdaResep} + ${r.jmlTanpaResep} != ${r.jmlKunjungan}`,
      ],
      [
        'asesmen terisi + belum = pasien baru',
        r.jmlBaruAdaAsesmen + r.jmlBaruTanpaAsesmen === r.jmlBaru,
        `${r.jmlBaruAdaAsesmen} + ${r.jmlBaruTanpaAsesmen} != ${r.jmlBaru}`,
      ],
    ];
    console.log('');
    for (const [nama, ok, salah] of genap) {
      console.log(ok ? `  [ok] ${nama}` : `  [SALAH] ${nama}: ${salah}`);
      if (!ok) process.exitCode = 1;
    }

    /**
     * Pecahan cara bayar WAJIB berjumlah dengan totalnya.
     *
     * Kalau tidak, penjamin yang barisnya tidak terbaca hilang dari layar tanpa
     * satu pun keterangan -- dan yang terlihat cuma pecahan yang tidak sampai
     * seratus persen. Terukur, `LEFT JOIN` yang menahannya.
     */
    const jumlahPecahan = r.caraBayar.reduce((n, b) => n + b.kunjungan, 0);
    const pecahanGenap = jumlahPecahan === r.jmlKunjungan;
    console.log(
      pecahanGenap
        ? '  [ok] jumlah pecahan cara bayar = jumlah kunjungan'
        : `  [SALAH] pecahan cara bayar ${jumlahPecahan} != ${r.jmlKunjungan} kunjungan`,
    );
    if (!pecahanGenap) process.exitCode = 1;

    const identitas = await getHospitalIdentity();
    const idVars = identityVars(identitas);
    const kodeTemplate = await loadUniqueCodeTemplate();

    const body = (await getSetting('administrasi.template_bulanan', '')) ?? '';
    const bodyKosong = (await getSetting('administrasi.template_bulanan_kosong', '')) ?? '';
    const dipakai = r.kosong ? (bodyKosong.trim() ? bodyKosong : null) : body;

    if (dipakai === null) {
      console.log('\n  Bulan itu tidak ada SATU PUN kunjungan tercatat, dan "pesan saat kosong" dibiarkan');
      console.log('  kosong -- jadi sistem sengaja DIAM. Kalau bulan itu seharusnya berisi, yang perlu');
      console.log('  diperiksa bukan pesannya melainkan kenapa query-nya tidak membaca apa-apa.');
      console.log('  Untuk melihat bentuk pesannya, jalankan ulang dengan bulan lain:');
      console.log('    npm run dryrun:adm-bulanan -- alca 202607');
    } else if (!dipakai.trim()) {
      console.log('\n  (isi pesan rekap masih kosong -- isi di /administrasi?tab=bulanan)');
    } else {
      const teks = appendUniqueCode(
        renderTemplate(dipakai, { ...idVars, ...susunVarsAdmBulanan(r, sekarang) }),
        buildIdempotencyKey(TRIGGER_ADMINISTRASI_BULANAN, bulan, 'contoh@g.us'),
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
